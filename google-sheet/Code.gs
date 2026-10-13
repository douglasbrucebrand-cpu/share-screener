/**
 * @OnlyCurrentDoc
 * (Limits this script to the one spreadsheet it is attached to.)
 *
 * Share Screener: paper portfolio storage in this Google Sheet.
 *
 * Setup (full steps in the README, section "Saving trades to a Google Sheet"):
 *   1. In your Google Sheet: Extensions > Apps Script. Delete any sample code and paste this file.
 *   2. Set your passphrase (NOT your Google password): either as a PASSPHRASE script property
 *      (Project Settings > Script properties), or by changing the PASSPHRASE line below. Save.
 *   3. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Deploy.
 *   4. Copy the Web app URL (it ends in /exec) and paste it, with your passphrase,
 *      into "Connect Google Sheet" on the Paper portfolio tab of the site.
 *
 * The site sends trades here; this script writes them to a "Trades" tab, one row per trade.
 * Anyone without the passphrase is refused. You can add your own columns to the right
 * of the existing ones (notes, say): the script leaves them alone.
 *
 * It also stores analyst calls on a "Calls" tab (README section 13), the same way.
 *
 * Optional: editing the watchlist from the website (README section 12). The script then also
 * saves watchlists.json on GitHub, using a GitHub key kept in this project's Script Properties
 * as GITHUB_TOKEN. The key is never written in this code, on the website or on GitHub.
 *
 * Tip: put your passphrase in Script Properties as PASSPHRASE too. Then updating this code is
 * just paste and deploy, with no line to edit.
 */

const PASSPHRASE = 'CHANGE-ME';   // <-- or leave this and set a PASSPHRASE script property (README section 11)
const GITHUB_REPO = 'douglasbrucebrand-cpu/share-screener';
const GITHUB_FILE = 'watchlists.json';
const GITHUB_BRANCH = 'main';

// What each tab of the sheet holds: [field the site uses, column heading, kind of value, max length].
const TABLES = {
  trades: {
    sheet: 'Trades', listKey: 'positions', required: ['id', 'symbol', 'buy_date'],
    columns: [
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
    ],
    tidy: q => { q.status = q.status === 'closed' ? 'closed' : 'open'; },
  },
  calls: {
    sheet: 'Calls', listKey: 'calls', required: ['id', 'who', 'symbol', 'call_date', 'direction'],
    columns: [
      ['id', 'Call ID', 'text'],
      ['call_date', 'Call date', 'text'],
      ['who', 'Who', 'text', 80],
      ['firm', 'Firm or outlet', 'text', 80],
      ['symbol', 'Ticker', 'text'],
      ['name', 'Company', 'text'],
      ['direction', 'Direction', 'text'],
      ['after_close', 'After the close', 'yesno'],
      ['target', 'Target price', 'money'],
      ['source', 'Source or note', 'text', 500],
      ['entry_date', 'Entry date', 'text'],
      ['entry_price', 'Entry price', 'money'],
      ['entry_status', 'Entry status', 'text'],
      ['history_starts', 'Price history starts', 'text'],
      ['created_at', 'Recorded at', 'text'],
      ['updated_at', 'Updated at', 'text'],
    ],
    tidy: q => { if (['bullish', 'bearish', 'neutral'].indexOf(q.direction) < 0) q.direction = ''; },
  },
};
// Text columns are formatted as plain text first, so Sheets never turns "2026-10-09" into a date.
const FORMATS = {text: '@', yesno: '@', money: '#,##0.00', units: '0.0000', whole: '0', pct: '0.0%'};
const MAX_OPS = 500;

function doGet() {
  return reply({ok: true, app: 'share-screener paper portfolio',
    note: 'This web app is working. Connect it from the Paper portfolio tab of the site.'});
}

/** The passphrase: from Script Properties if set there (so updating the code never resets it), else from the code. */
function passphrase() {
  return PropertiesService.getScriptProperties().getProperty('PASSPHRASE') || PASSPHRASE;
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return reply({ok: false, error: 'Bad request.'}); }
  const pass = passphrase();
  if (!pass || pass === 'CHANGE-ME') {
    return reply({ok: false, error: 'The script still has the example passphrase. Set a PASSPHRASE script property (or change it in the code), save, and deploy a new version.'});
  }
  if (!req || req.pass !== pass) {
    Utilities.sleep(1500);   // slows down anyone guessing
    return reply({ok: false, error: 'Wrong passphrase.'});
  }
  if (req.action === 'search') {
    try { return reply(searchYahoo(req.q)); }
    catch (err) { return reply({ok: false, error: 'Search failed: ' + err.message}); }
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);      // one change at a time
  try {
    if (req.action === 'watchlist_edit') return reply(editWatchlist(req));
    if (req.action === 'track') return reply(trackSymbols(req.symbols));
    if (req.action === 'ping') {
      const ss = SpreadsheetApp.getActive();
      return reply({ok: true, sheet: ss.getName(), url: ss.getUrl(), count: readAll(open('trades')).length,
        watchlistEditing: !!PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN')});
    }
    // 'apply' = paper trades (the original action), 'calls_apply' = analyst calls
    const table = req.action === 'apply' ? 'trades' : req.action === 'calls_apply' ? 'calls' : null;
    if (table) {
      const ctx = open(table);
      const ops = Array.isArray(req.ops) ? req.ops.slice(0, MAX_OPS) : [];
      for (const op of ops) {
        if (op.op === 'upsert') upsert(ctx, op.item || op.position);
        else if (op.op === 'delete') remove(ctx, op.id);
        else if (op.op === 'replace') replaceAll(ctx, op.items || op.positions);
      }
      return reply({ok: true, [TABLES[table].listKey]: readAll(ctx)});
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

/** A tab of the sheet, creating it and any missing headings. Columns are found by heading, not position. */
function open(table) {
  const t = TABLES[table];
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(t.sheet) || ss.insertSheet(t.sheet);
  const lastCol = sh.getLastColumn();
  const head = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  let changed = false;
  for (const [, title] of t.columns) {
    if (head.indexOf(title) < 0) { head.push(title); changed = true; }
  }
  if (changed) {
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  const col = {};
  for (const [key, title] of t.columns) col[key] = head.indexOf(title);   // 0-based
  return {t, sh, col, width: head.length, tz: ss.getSpreadsheetTimeZone()};
}

/** Only known fields, of the right kind, ever reach the sheet. */
function clean(t, p) {
  if (!p || typeof p !== 'object') return null;
  const q = {};
  for (const [key, , kind, max] of t.columns) {
    const v = p[key];
    if (kind === 'yesno') { q[key] = v === true || v === 'yes' ? 'yes' : ''; continue; }
    if (v === null || v === undefined || v === '') { q[key] = ''; continue; }
    if (kind === 'text') q[key] = String(v).slice(0, max || 200);
    else { const n = Number(v); q[key] = isFinite(n) ? n : ''; }
  }
  t.tidy(q);
  for (const k of t.required) if (!q[k]) return null;
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
  const q = clean(ctx.t, p);
  if (!q) return;
  let r = rowOf(ctx, q.id);
  if (r < 0) r = ctx.sh.getLastRow() + 1;
  const range = ctx.sh.getRange(r, 1, 1, ctx.width);
  const values = range.getValues()[0];          // keeps any columns you added yourself
  const formats = range.getNumberFormats()[0];
  for (const [key, , kind] of ctx.t.columns) {
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
    for (const [key, , kind] of ctx.t.columns) {
      let v = row[ctx.col[key]];
      if (v instanceof Date) v = Utilities.formatDate(v, ctx.tz, key.endsWith('_at') ? "yyyy-MM-dd'T'HH:mm:ss" : 'yyyy-MM-dd');
      if (kind === 'yesno') { p[key] = v === 'yes' || v === true; continue; }
      if (v === '' || v === null || v === undefined) v = null;
      else if (kind !== 'text') { v = Number(v); if (!isFinite(v)) v = null; }
      else v = String(v);
      p[key] = v;
    }
    if (ctx.t.required.every(k => p[k])) out.push(p);
  }
  return out;
}

// ---------- watchlist editing (via GitHub) ----------

/** Yahoo Finance search, so you can type a company name instead of knowing the symbol. */
function searchYahoo(q) {
  q = String(q || '').trim().slice(0, 40);
  if (!q) return {ok: true, results: []};
  const res = UrlFetchApp.fetch('https://query2.finance.yahoo.com/v1/finance/search?quotesCount=10&newsCount=0&q=' +
    encodeURIComponent(q), {muteHttpExceptions: true, headers: {'User-Agent': 'Mozilla/5.0'}});
  let j = null;
  try { j = JSON.parse(res.getContentText()); } catch (e) { j = null; }
  if (res.getResponseCode() !== 200 || !j) {
    return {ok: false, error: "Yahoo's search isn't answering right now. You can still add a share by typing its exact Yahoo symbol."};
  }
  const results = (j.quotes || [])
    .filter(x => x.symbol && (x.quoteType === 'EQUITY' || x.quoteType === 'ETF'))
    .slice(0, 8)
    .map(x => ({symbol: String(x.symbol), name: String(x.shortname || x.longname || x.symbol),
      exchange: String(x.exchDisp || x.exchange || ''), type: x.quoteType}));
  return {ok: true, results};
}

function symbolOf(s) {
  s = String(s || '').trim().toUpperCase();
  return /^\^?[A-Z0-9][A-Z0-9.\-=]{0,14}$/.test(s) ? s : '';
}

/** Add or remove one ticker in one group, then save watchlists.json on GitHub. */
function editWatchlist(req) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) {
    return {ok: false, error: 'The script has no GitHub key yet. Add GITHUB_TOKEN under Apps Script > Project Settings > Script properties (README section 12).'};
  }
  const add = symbolOf(req.add), remove = symbolOf(req.remove);
  if (req.add && !add) return {ok: false, error: `"${String(req.add).slice(0, 20)}" doesn't look like a Yahoo symbol.`};
  if (!add && !remove) return {ok: false, error: 'Nothing to change.'};

  for (let attempt = 0; attempt < 2; attempt++) {
    const file = githubGet(token);
    if (!file.ok) return file;
    const wl = file.json;
    const tab = (wl.tabs || []).find(t => t.id === req.tab);
    if (!tab) return {ok: false, error: 'That tab no longer exists. Refresh the page and try again.'};
    let what, done, group;
    if (add) {
      const newName = String(req.newGroup || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (newName) {
        group = tab.groups.find(g => g.name.toLowerCase() === newName.toLowerCase());
        if (!group) { group = {name: newName, tickers: []}; tab.groups.push(group); }
      } else {
        group = tab.groups.find(g => g.name === req.group);
      }
      if (!group) return {ok: false, error: 'That group no longer exists. Refresh the page and try again.'};
      if (group.tickers.indexOf(add) >= 0) {
        return {ok: true, unchanged: true, message: `${add} is already in ${group.name}.`, tabs: wl.tabs};
      }
      group.tickers.push(add);
      what = `add ${add} to ${tab.name} / ${group.name}`;
      done = `Added ${add} to ${tab.name} / ${group.name}.`;
    } else {
      group = tab.groups.find(g => g.name === req.group);
      if (!group || group.tickers.indexOf(remove) < 0) {
        return {ok: true, unchanged: true, message: `${remove} is not in that group any more.`, tabs: wl.tabs};
      }
      group.tickers = group.tickers.filter(t => t !== remove);
      if (!group.tickers.length) {
        if (tab.groups.length === 1) {
          return {ok: false, error: `${remove} is the last share in "${tab.name}". A tab needs at least one share, so add another first.`};
        }
        tab.groups = tab.groups.filter(g => g !== group);
      }
      what = `remove ${remove} from ${tab.name} / ${group.name}`;
      done = `Removed ${remove} from ${tab.name} / ${group.name}.`;
    }
    const put = githubPut(token, formatWatchlists(wl), file.sha, `Watchlist: ${what} (from the website)`);
    if (put.conflict) continue;          // someone else saved first: re-read and redo
    if (!put.ok) return put;
    return {ok: true, message: done, tabs: wl.tabs};
  }
  return {ok: false, error: 'The watchlist was changed somewhere else at the same moment. Please try again.'};
}

/**
 * Make sure the daily update fetches prices for these tickers (e.g. a share someone made a call on
 * that isn't on a watchlist). Adds them to "tracked" in watchlists.json: tickers only, nothing else.
 */
function trackSymbols(list) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) {
    return {ok: false, error: 'The script has no GitHub key yet, so prices for new shares can\'t be added (README section 12).'};
  }
  const wanted = (Array.isArray(list) ? list : []).map(symbolOf).filter(Boolean).slice(0, 50);
  if (!wanted.length) return {ok: false, error: 'No valid tickers to track.'};
  for (let attempt = 0; attempt < 2; attempt++) {
    const file = githubGet(token);
    if (!file.ok) return file;
    const wl = file.json;
    const known = new Set([].concat(...(wl.tabs || []).map(t => [].concat(...t.groups.map(g => g.tickers))),
      Object.values(wl.benchmarks || {}), wl.tracked || []));
    const add = wanted.filter((s, i) => !known.has(s) && wanted.indexOf(s) === i);
    if (!add.length) return {ok: true, unchanged: true, tracked: wl.tracked || []};
    wl.tracked = (wl.tracked || []).concat(add);
    const put = githubPut(token, formatWatchlists(wl), file.sha, `Track prices: ${add.join(', ')} (from the website)`);
    if (put.conflict) continue;
    if (!put.ok) return put;
    return {ok: true, added: add, tracked: wl.tracked};
  }
  return {ok: false, error: 'The watchlist was changed somewhere else at the same moment. Please try again.'};
}

function githubHeaders(token) {
  return {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'};
}

function githubProblem(code) {
  if (code === 401) return 'GitHub says the key is wrong or has expired. Make a new key and update GITHUB_TOKEN (README section 12).';
  if (code === 403 || code === 404) return 'GitHub says the key is not allowed to edit share-screener. Check it has Contents: Read and write for that repository (README section 12).';
  return 'GitHub answered with an error (' + code + '). Try again in a minute.';
}

function githubGet(token) {
  const res = UrlFetchApp.fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}?ref=${GITHUB_BRANCH}`,
    {headers: githubHeaders(token), muteHttpExceptions: true});
  const code = res.getResponseCode();
  if (code !== 200) return {ok: false, error: githubProblem(code)};
  const meta = JSON.parse(res.getContentText());
  const text = Utilities.newBlob(Utilities.base64Decode(String(meta.content).replace(/\s/g, ''))).getDataAsString('UTF-8');
  try {
    return {ok: true, json: JSON.parse(text), sha: meta.sha};
  } catch (e) {
    return {ok: false, error: 'watchlists.json on GitHub has a typo, so it can\'t be edited from the website until that is fixed there.'};
  }
}

function githubPut(token, text, sha, message) {
  const res = UrlFetchApp.fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`, {
    method: 'put', contentType: 'application/json', headers: githubHeaders(token), muteHttpExceptions: true,
    payload: JSON.stringify({message, content: Utilities.base64Encode(text, Utilities.Charset.UTF_8), sha, branch: GITHUB_BRANCH}),
  });
  const code = res.getResponseCode();
  if (code === 200 || code === 201) return {ok: true};
  if (code === 409 || code === 422) return {ok: false, conflict: true};
  return {ok: false, error: githubProblem(code)};
}

/** Writes watchlists.json in the same easy-to-read layout as the original: one group per line. */
function formatWatchlists(wl) {
  const q = JSON.stringify;
  const flat = v => (Array.isArray(v) ? '[' + v.map(x => q(x)).join(', ') + ']'
    : v && typeof v === 'object' ? '{' + Object.keys(v).map(k => q(k) + ': ' + q(v[k])).join(', ') + '}' : q(v));
  const out = ['{', '  "tabs": ['];
  wl.tabs.forEach((t, i) => {
    out.push('    {', `      "id": ${q(t.id)},`, `      "name": ${q(t.name)},`, '      "groups": [');
    t.groups.forEach((g, j) => out.push(
      `        {"name": ${q(g.name)}, "tickers": [${g.tickers.map(x => q(x)).join(', ')}]}${j < t.groups.length - 1 ? ',' : ''}`));
    out.push('      ]', '    }' + (i < wl.tabs.length - 1 ? ',' : ''));
  });
  const rest = Object.keys(wl).filter(k => k !== 'tabs');
  out.push('  ]' + (rest.length ? ',' : ''));
  rest.forEach((k, i) => out.push(`  ${q(k)}: ${flat(wl[k])}` + (i < rest.length - 1 ? ',' : '')));
  out.push('}');
  return out.join('\n') + '\n';
}
