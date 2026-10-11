// Share Screener page: reads data/latest.json (written by run_screener.py) and draws it.
// No build step, no libraries.

const STALE_DAYS = 3;
const CCY = {USD: '$', ZAR: 'R', EUR: '€', GBP: '£'};
const $ = id => document.getElementById(id);

let DATA = null;
let activeTab = null;
let sortState = {key: 'composite', dir: -1};   // shared by every table in the tab

// localStorage can be blocked (private mode, some Google Sites embeds), so never rely on it.
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};

// ---------- formatting ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const DASH = '<span class="dim">&ndash;</span>';
const sym = c => CCY[c] ?? (c ? c + ' ' : '');

function fmtDate(iso) {                      // '2026-10-09' -> '09/10/2026'
  if (!iso) return '–';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
function fmtDateTime(iso) {                  // in the viewer's own time zone
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short'});
}
function money(x, c) {
  return x == null ? DASH :
    sym(c) + x.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}
function bigMoney(x, c) {
  if (x == null) return DASH;
  const a = Math.abs(x);
  if (a >= 1e12) return sym(c) + (x / 1e12).toFixed(2) + 'tn';
  if (a >= 1e9) return sym(c) + (x / 1e9).toFixed(a >= 1e11 ? 0 : 1) + 'bn';
  return sym(c) + (x / 1e6).toFixed(0) + 'm';
}
function ratio(x, title) {
  if (x == null) return DASH;
  if (x <= 0) return `<span class="dim" title="${esc(title)}">n/m</span>`;
  return x >= 100 ? x.toFixed(0) : x.toFixed(1);
}
function pct(x) { return x == null ? DASH : `<span class="${x >= 0 ? 'pos' : 'neg'}">${(x * 100).toFixed(1)}%</span>`; }
function scoreColor(s) { if (s == null) return 'dim'; if (s >= 70) return 'pos'; if (s < 40) return 'neg'; return ''; }
function scoreCell(s, title) {
  return `<span class="score ${scoreColor(s)}"${title ? ` title="${esc(title)}"` : ''}>${s ?? '&ndash;'}</span>`;
}

function sparkline(c) {
  if (!c || c.length < 2) return '';
  const w = 90, h = 24, mn = Math.min(...c), mx = Math.max(...c), rng = mx - mn || 1;
  const pts = c.map((v, i) => `${(i / (c.length - 1) * w).toFixed(1)},${(h - (v - mn) / rng * h).toFixed(1)}`).join(' ');
  const up = c[c.length - 1] >= c[0];
  return `<svg class="spark" width="${w}" height="${h}" role="img" aria-label="60-day price trend ${up ? 'up' : 'down'}"><polyline fill="none" stroke="${up ? '#3fb950' : '#e5534b'}" stroke-width="1.5" points="${pts}"/></svg>`;
}

// ---------- columns ----------
// get: value used for sorting (null always sorts last). grp: draw a divider before it.
const COLS = [
  {key: 'symbol', label: 'Ticker', get: r => r.symbol, dir: 1},
  {key: 'price', label: 'Price', get: r => r.price},
  {key: 'ret1m', label: '1M', get: r => r.ret1m},
  {key: 'ret3m', label: '3M', get: r => r.ret3m},
  {key: 'vsSMA50', label: 'vs 50d', get: r => r.vsSMA50},
  {key: 'mom', label: 'Mom', get: r => r.mom, grp: true},
  {key: 'fund', label: 'Fund', get: r => r.fund},
  {key: 'composite', label: 'Composite', get: r => r.composite},
  {key: 'pe', label: 'P/E', get: r => pos(r.valuation?.trailing_pe), grp: true, dir: 1, title: 'Trailing price / earnings'},
  {key: 'fpe', label: 'Fwd P/E', get: r => pos(r.valuation?.forward_pe), dir: 1, title: 'Price / next year’s expected earnings'},
  {key: 'ps', label: 'P/S', get: r => r.valuation?.price_to_sales, dir: 1, title: 'Market cap / last 12 months’ revenue'},
  {key: 'mcap', label: 'Mkt cap', get: r => r.valuation?.market_cap},
  {key: 'sig', label: 'Signals', grp: true},
  {key: 'spark', label: 'Trend'},
];
const pos = x => (x != null && x > 0 ? x : null);   // negative P/E isn't "cheap", so sort it with blanks

function sortRows(rows) {
  const col = COLS.find(c => c.key === sortState.key);
  return [...rows].sort((a, b) => {
    const x = col.get(a), y = col.get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sortState.dir;
  });
}

// ---------- render ----------
function rowHtml(r) {
  const nameLine = `<span class="name" title="${esc(r.name)}">${esc(r.name)}</span>`;
  if (r.price == null) {
    const msg = Object.values(r.errors || {}).join('; ') || 'no data';
    return `<tr><td><span class="tick">${esc(r.symbol)}</span>${nameLine}</td><td colspan="${COLS.length - 1}" class="dim" style="text-align:left">${esc(msg)}</td></tr>`;
  }
  const v = r.valuation || {};
  const staleLine = r.errors?.prices ? `<span class="warnline" title="${esc(r.errors.prices)}">price update failed &middot; shown as at ${fmtDate(r.price_date)}</span>` : '';
  const badges = [...(r.sig || []), ...(r.flags || [])]
    .map(b => `<span class="b ${b[1]}"${b[2] ? ` title="${esc(b[2])}"` : ''}>${esc(b[0])}</span>`).join('');
  const fundTitle = r.fundamentals_period_end ? `Latest annual results: ${fmtDate(r.fundamentals_period_end)}` :
    (r.errors?.fundamentals || 'Fundamentals unavailable');
  return `<tr>
    <td><span class="tick">${esc(r.symbol)}</span><span class="mscore ${scoreColor(r.composite)}">${r.composite ?? ''}</span>${nameLine}${staleLine}</td>
    <td>${money(r.price, r.currency)}</td>
    <td>${pct(r.ret1m)}</td>
    <td>${pct(r.ret3m)}</td>
    <td>${pct(r.vsSMA50)}</td>
    <td class="grp">${scoreCell(r.mom)}</td>
    <td>${scoreCell(r.fund, fundTitle)}</td>
    <td>${scoreCell(r.composite)}</td>
    <td class="grp">${ratio(v.trailing_pe, 'Not meaningful: negative earnings')}</td>
    <td>${ratio(v.forward_pe, 'Not meaningful: a loss is expected')}</td>
    <td>${ratio(v.price_to_sales)}</td>
    <td>${bigMoney(v.market_cap, r.currency)}</td>
    <td class="grp"><div class="badges">${badges}</div></td>
    <td>${sparkline(r.spark)}</td>
  </tr>`;
}

function headHtml() {
  return '<tr>' + COLS.map(c => {
    const cls = [c.get ? 'sortable' : '', c.grp ? 'grp' : ''].filter(Boolean).join(' ');
    if (!c.get) return `<th class="${cls}">${c.label}</th>`;
    const on = sortState.key === c.key;
    const aria = on ? (sortState.dir > 0 ? 'ascending' : 'descending') : 'none';
    return `<th class="${cls}" data-key="${c.key}" aria-sort="${aria}" tabindex="0"${c.title ? ` title="${esc(c.title)}"` : ''}>` +
      `${c.label}<span class="arrow">${on ? (sortState.dir > 0 ? '▲' : '▼') : ''}</span></th>`;
  }).join('') + '</tr>';
}

function renderTab() {
  const tab = DATA.tabs.find(t => t.id === activeTab) || DATA.tabs[0];
  const T = DATA.tickers;

  // tab buttons
  $('tabs').innerHTML = DATA.tabs.map(t =>
    `<button role="tab" data-tab="${esc(t.id)}" aria-selected="${t.id === tab.id}">${esc(t.name)}</button>`).join('');

  // top six in this tab
  const seen = new Set(), all = [];
  for (const g of tab.groups) for (const s of g.tickers) {
    if (seen.has(s) || !T[s] || T[s].composite == null) continue;
    seen.add(s); all.push({...T[s], group: g.name});
  }
  all.sort((a, b) => b.composite - a.composite);
  $('topflags').innerHTML = all.length ? '<div class="cap">Top candidates this run</div>' +
    all.slice(0, 6).map(r => `<div class="card"><div class="t">${esc(r.symbol)}</div>
      <div class="s ${scoreColor(r.composite)}">${r.composite}</div>
      <div class="name">${esc(r.group)}</div></div>`).join('') : '';

  // one table per group
  const head = headHtml();
  $('groups').innerHTML = tab.groups.map(g => {
    const rows = sortRows(g.tickers.map(s => T[s] || {symbol: s, name: '', errors: {prices: 'not fetched yet: run the screener'}}));
    return `<section class="sector"><h2>${esc(g.name)}</h2>
      <div class="tbl"><table><thead>${head}</thead><tbody>${rows.map(rowHtml).join('')}</tbody></table></div></section>`;
  }).join('');
}

function renderStatic() {
  const gen = new Date(DATA.generated_at);
  const ageDays = (Date.now() - gen.getTime()) / 864e5;
  const old = ageDays > STALE_DAYS;
  $('updated').className = 'updated' + (old ? ' old' : '');
  $('updated').innerHTML = `<div class="lbl">Last updated</div>
    <div class="when">${fmtDateTime(DATA.generated_at)}</div>
    <div class="asof">Prices to the close of ${fmtDate(DATA.prices_as_of)}</div>`;
  if (old) {
    $('stale').hidden = false;
    $('stale').innerHTML = `<b>This data is ${Math.floor(ageDays)} days old.</b> The automatic daily update may have stopped working. ` +
      `Scores and prices below are from ${fmtDate(DATA.generated_at)} and may be out of date.`;
  }

  $('legend').innerHTML = 'Composite = 0.6 &times; momentum + 0.4 &times; fundamentals. ' +
    'Fund = &ndash; means fundamentals unavailable (common for early-stage / loss-making names); composite then uses momentum only. ' +
    '<b>Expensive</b> = forward P/E above 40, or price-to-sales above 10 when no profit is expected; it does not affect the score. ' +
    'n/m = not meaningful (negative earnings). Prices in each share’s own currency. Not investment advice.';

  const errs = DATA.errors || [];
  if (errs.length) {
    $('problems').hidden = false;
    $('problems').innerHTML = `<summary>${errs.length} problem${errs.length > 1 ? 's' : ''} on the last run (older data kept where available)</summary>
      <ul>${errs.map(e => `<li><b>${esc(e.symbol)}</b> (${esc(e.stage)}): ${esc(e.message)}</li>`).join('')}</ul>`;
  }
}

// ---------- events ----------
function setTab(id, push) {
  activeTab = id;
  store.set('screener_tab', id);
  if (push) history.replaceState(null, '', '#' + id);
  renderTab();
}
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (b) setTab(b.dataset.tab, true);
});
$('tabs').addEventListener('keydown', e => {      // arrow keys move between tabs
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const ids = DATA.tabs.map(t => t.id), i = ids.indexOf(activeTab);
  setTab(ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length], true);
  $('tabs').querySelector('[aria-selected=true]').focus();
});
function onSort(e) {
  const th = e.target.closest('th[data-key]');
  if (!th || (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  const col = COLS.find(c => c.key === th.dataset.key);
  sortState = sortState.key === col.key ? {key: col.key, dir: -sortState.dir} : {key: col.key, dir: col.dir || -1};
  renderTab();
  const again = document.querySelector(`th[data-key="${col.key}"]`);
  if (again && e.type === 'keydown') again.focus();
}
$('groups').addEventListener('click', onSort);
$('groups').addEventListener('keydown', onSort);
window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (DATA && DATA.tabs.some(t => t.id === id)) setTab(id, false);
});

// ---------- start ----------
fetch('data/latest.json', {cache: 'no-cache'})
  .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
  .then(d => {
    DATA = d;
    const want = [location.hash.slice(1), store.get('screener_tab')];
    activeTab = want.find(id => id && d.tabs.some(t => t.id === id)) || d.tabs[0].id;
    renderStatic();
    renderTab();
  })
  .catch(e => {
    $('updated').textContent = '';
    $('groups').innerHTML = `<div class="error">Could not load the data (${esc(e.message)}). Try refreshing the page.</div>`;
  });
