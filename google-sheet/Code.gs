/**
 * @OnlyCurrentDoc
 * (Limits this script to the one spreadsheet it is attached to.)
 *
 * Share Screener: paper portfolio storage in this Google Sheet.
 *
 * Setup (full steps in the README, section "Saving trades to a Google Sheet"):
 *   1. In your Google Sheet: Extensions > Apps Script. Delete any sample code and paste this file.
 *   2. Change PASSPHRASE below to a phrase of your own (NOT your Google password). Save.
 *   3. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Deploy.
 *   4. Copy the Web app URL (it ends in /exec) and paste it, with your passphrase,
 *      into "Connect Google Sheet" on the Paper portfolio tab of the site.
 *
 * The site sends trades here; this script writes them to a "Trades" tab, one row per trade.
 * Anyone without the passphrase is refused. You can add your own columns to the right
 * of the existing ones (notes, say): the script leaves them alone.
 */

const PASSPHRASE = 'CHANGE-ME';   // <-- choose your own, then type the same phrase on the site
const SHEET_NAME = 'Trades';

// [field the site uses, column heading in the sheet, kind of value]
const COLUMNS = [
  ['id', 'Trade ID', 'text'],
  ['status', 'Status', 'text'],
  ['symbol', 'Ticker', 'text'],
  ['name', 'Company', 'text'],
  ['currency', 'Currency', 'text'],
  ['buy_date', 'Bought on', 'text'],
  ['buy_price', 'Buy price', 'money'],
  ['amount', 'Amount', 'money'],
  ['units', 'Units', 'units'],
  ['composite_at_buy', 'Composite at buy', 'whole'],
  ['mom_at_buy', 'Momentum at buy', 'whole'],
  ['fund_at_buy', 'Fundamentals at buy', 'whole'],
  ['benchmark', 'Benchmark', 'text'],
  ['bench_buy_price', 'Benchmark price at buy', 'money'],
  ['close_date', 'Sold on', 'text'],
  ['close_price', 'Sell price', 'money'],
  ['return_pct', 'Return', 'pct'],
  ['bench_return_pct', 'Benchmark return', 'pct'],
  ['composite_at_close', 'Composite at sell', 'whole'],
  ['created_at', 'Recorded at', 'text'],
  ['closed_at', 'Closed at', 'text'],
];
// Text columns are formatted as plain text first, so Sheets never turns "2026-10-09" into a date.
const FORMATS = {text: '@', money: '#,##0.00', units: '0.0000', whole: '0', pct: '0.0%'};
const MAX_OPS = 500;

function doGet() {
  return reply({ok: true, app: 'share-screener paper portfolio',
    note: 'This web app is working. Connect it from the Paper portfolio tab of the site.'});
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return reply({ok: false, error: 'Bad request.'}); }
  if (!PASSPHRASE || PASSPHRASE === 'CHANGE-ME') {
    return reply({ok: false, error: 'The script still has the example passphrase. Change PASSPHRASE in the script, save, and deploy a new version.'});
  }
  if (!req || req.pass !== PASSPHRASE) {
    Utilities.sleep(1500);   // slows down anyone guessing
    return reply({ok: false, error: 'Wrong passphrase.'});
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);      // one change at a time
  try {
    const ctx = open();
    if (req.action === 'ping') {
      const ss = SpreadsheetApp.getActive();
      return reply({ok: true, sheet: ss.getName(), url: ss.getUrl(), count: readAll(ctx).length});
    }
    if (req.action === 'apply') {
      const ops = Array.isArray(req.ops) ? req.ops.slice(0, MAX_OPS) : [];
      for (const op of ops) {
        if (op.op === 'upsert') upsert(ctx, op.position);
        else if (op.op === 'delete') remove(ctx, op.id);
        else if (op.op === 'replace') replaceAll(ctx, op.positions);
      }
      return reply({ok: true, positions: readAll(ctx)});
    }
    return reply({ok: false, error: 'Unknown action.'});
  } catch (err) {
    return reply({ok: false, error: 'Sheet error: ' + err.message});
  } finally {
    lock.releaseLock();
  }
}

// ---------- helpers ----------

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** The Trades tab, creating it and any missing headings. Columns are found by heading, not position. */
function open() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  const lastCol = sh.getLastColumn();
  const head = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  let changed = false;
  for (const [, title] of COLUMNS) {
    if (head.indexOf(title) < 0) { head.push(title); changed = true; }
  }
  if (changed) {
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  const col = {};
  for (const [key, title] of COLUMNS) col[key] = head.indexOf(title);   // 0-based
  return {sh, col, width: head.length, tz: ss.getSpreadsheetTimeZone()};
}

/** Only known fields, of the right kind, ever reach the sheet. */
function clean(p) {
  if (!p || typeof p !== 'object') return null;
  const q = {};
  for (const [key, , kind] of COLUMNS) {
    const v = p[key];
    if (v === null || v === undefined || v === '') { q[key] = ''; continue; }
    if (kind === 'text') q[key] = String(v).slice(0, 200);
    else { const n = Number(v); q[key] = isFinite(n) ? n : ''; }
  }
  if (!q.id || !q.symbol || !q.buy_date) return null;
  q.status = q.status === 'closed' ? 'closed' : 'open';
  return q;
}

function rowOf(ctx, id) {
  const n = ctx.sh.getLastRow() - 1;
  if (n < 1 || !id) return -1;
  const ids = ctx.sh.getRange(2, ctx.col.id + 1, n, 1).getValues();
  for (let i = 0; i < n; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

function upsert(ctx, p) {
  const q = clean(p);
  if (!q) return;
  let r = rowOf(ctx, q.id);
  if (r < 0) r = ctx.sh.getLastRow() + 1;
  const range = ctx.sh.getRange(r, 1, 1, ctx.width);
  const values = range.getValues()[0];          // keeps any columns you added yourself
  const formats = range.getNumberFormats()[0];
  for (const [key, , kind] of COLUMNS) {
    values[ctx.col[key]] = q[key];
    formats[ctx.col[key]] = FORMATS[kind];
  }
  range.setNumberFormats([formats]);             // formats first, then values
  range.setValues([values]);
}

function remove(ctx, id) {
  const r = rowOf(ctx, id);
  if (r > 0) ctx.sh.deleteRow(r);
}

function replaceAll(ctx, list) {
  const n = ctx.sh.getLastRow() - 1;
  if (n > 0) ctx.sh.getRange(2, 1, n, ctx.width).clearContent();
  for (const p of (Array.isArray(list) ? list : []).slice(0, MAX_OPS)) upsert(ctx, p);
}

function readAll(ctx) {
  const n = ctx.sh.getLastRow() - 1;
  if (n < 1) return [];
  const rows = ctx.sh.getRange(2, 1, n, ctx.width).getValues();
  const out = [];
  for (const row of rows) {
    const p = {};
    for (const [key, , kind] of COLUMNS) {
      let v = row[ctx.col[key]];
      if (v instanceof Date) v = Utilities.formatDate(v, ctx.tz, key.endsWith('_at') ? "yyyy-MM-dd'T'HH:mm:ss" : 'yyyy-MM-dd');
      if (v === '' || v === null || v === undefined) v = null;
      else if (kind !== 'text') { v = Number(v); if (!isFinite(v)) v = null; }
      else v = String(v);
      p[key] = v;
    }
    if (p.id && p.symbol && p.buy_date) out.push(p);
  }
  return out;
}
