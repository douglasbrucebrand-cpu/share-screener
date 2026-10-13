// Share Screener page: reads data/latest.json (written by run_screener.py) and draws it.
// No build step, no libraries. Needs common.js, chart.js, portfolio.js, watchlist.js and calls.js (loaded first by index.html).

const STALE_DAYS = 3;

// If the browser has an older cached index.html, containers added in later versions may be
// missing. Create them rather than letting the whole script fail.
function ensureContainers() {
  if (!document.getElementById('changes')) {
    const d = document.createElement('div'); d.id = 'changes';
    const top = document.getElementById('topflags');
    top ? top.before(d) : document.querySelector('main')?.prepend(d);
  }
  if (!document.getElementById('wlbar')) {
    const d = document.createElement('div'); d.id = 'wlbar'; d.className = 'wlbar';
    document.getElementById('groups').before(d);
  }
  if (!document.getElementById('calls')) {
    const d = document.createElement('div'); d.id = 'calls'; d.hidden = true;
    document.getElementById('groups').after(d);
  }
  if (!document.getElementById('portfolio')) {
    const d = document.createElement('div'); d.id = 'portfolio'; d.hidden = true;
    document.getElementById('groups').after(d);
  }
}

// The paper portfolio is an extra tab after the watchlists.
const CALLS_TAB = {id: 'calls', name: 'Calls'};
const PORTFOLIO_TAB = {id: 'portfolio', name: 'Paper portfolio'};
const allTabs = () => [...DATA.tabs, CALLS_TAB, PORTFOLIO_TAB];

let DATA = null;
let activeTab = null;
let sortState = {key: 'composite', dir: -1};   // shared by every table in the tab


function sparkline(c) {
  if (!c || c.length < 2) return '';
  const w = 90, h = 24, mn = Math.min(...c), mx = Math.max(...c), rng = mx - mn || 1;
  const pts = c.map((v, i) => `${(i / (c.length - 1) * w).toFixed(1)},${(h - (v - mn) / rng * h).toFixed(1)}`).join(' ');
  const up = c[c.length - 1] >= c[0];
  return `<svg class="spark" width="${w}" height="${h}" role="img" aria-label="60-day price trend ${up ? 'up' : 'down'}"><polyline fill="none" stroke="${up ? '#3fb950' : '#e5534b'}" stroke-width="1.5" points="${pts}"/></svg>`;
}

// Composite over recent runs. Fixed minimum range of 10 points so tiny wobbles look tiny.
function scoreSpark(trend) {
  if (!trend || trend.length < 2) return `<span class="dim" title="Builds up one point per daily run">&ndash;</span>`;
  const v = trend.map(p => p[1]), w = 60, h = 20;
  let mn = Math.min(...v), mx = Math.max(...v);
  if (mx - mn < 10) { const mid = (mx + mn) / 2; mn = mid - 5; mx = mid + 5; }
  const pts = v.map((y, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - 1 - (y - mn) / (mx - mn) * (h - 2)).toFixed(1)}`).join(' ');
  const d = v[v.length - 1] - v[0];
  const col = d > 0 ? '#3fb950' : d < 0 ? '#e5534b' : '#8b98a8';
  const title = `Composite over the last ${v.length} runs: ${v[0]} → ${v[v.length - 1]} (since ${fmtDate(trend[0][0])})`;
  return `<svg class="spark" width="${w}" height="${h}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>` +
    `<polyline fill="none" stroke="${col}" stroke-width="1.5" points="${pts}"/></svg>`;
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
  {key: 'trend', label: 'Score trend', get: r => (r.trend && r.trend.length > 1 ? r.trend[r.trend.length - 1][1] - r.trend[0][1] : null),
   title: 'Composite score over the last 30 runs (sorts by the change)'},
  {key: 'pe', label: 'P/E', get: r => pos(r.valuation?.trailing_pe), grp: true, dir: 1, title: 'Trailing price / earnings'},
  {key: 'fpe', label: 'Fwd P/E', get: r => pos(r.valuation?.forward_pe), dir: 1, title: 'Price / next year’s expected earnings'},
  {key: 'ps', label: 'P/S', get: r => r.valuation?.price_to_sales, dir: 1, title: 'Market cap / last 12 months’ revenue'},
  {key: 'mcap', label: 'Mkt cap', get: r => r.valuation?.market_cap},
  {key: 'sig', label: 'Signals', grp: true},
  {key: 'spark', label: 'Trend'},
  {key: 'buy', label: ''},
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

// ---------- what changed ----------
const chip = (s, cls = '') => `<button class="b chip ${cls}" data-goto="${esc(s)}">${esc(s)}</button>`;
const chips = (list, cls) => list.length ? list.map(s => chip(s, cls)).join(' ') : '<span class="dim">none</span>';

function changesHtml(tabId) {
  const c = DATA.changes;
  if (!c) return '';
  if (!c.previous_date) {
    return `<section class="changes"><h3>What changed</h3>
      <p class="dim">Not enough history yet: this run is the first one saved. Changes appear after the next daily update.</p></section>`;
  }
  const t = c.tabs[tabId] || {new_steady: [], top6_in: [], top6_out: [], risers: [], fallers: []};
  const top = !t.top6_in.length && !t.top6_out.length ? '<span class="dim">no change</span>' :
    `<span class="dim">in</span> ${chips(t.top6_in, 'g')}${t.top6_out.length ? ` <span class="dim">&middot; out</span> ${chips(t.top6_out)}` : ''}`;
  const mv = m => `<li>${chip(m.symbol)} <span class="${m.change > 0 ? 'pos' : 'neg'}">${m.change > 0 ? '▲ +' : '▼ '}${m.change}</span>` +
    ` <span class="dim">${m.from} → ${m.to}</span></li>`;
  const span = c.week_days >= 7 ? `over 1 week <span class="dim">(since ${fmtDate(c.week_base_date)})</span>` :
    `over ${c.week_days} day${c.week_days === 1 ? '' : 's'} <span class="dim">(a full week of history builds up by ${fmtDate(addDays(c.week_base_date, 7))})</span>`;
  const moves = t.risers.length || t.fallers.length ?
    `<ul class="moves">${t.risers.map(mv).join('')}${t.fallers.map(mv).join('')}</ul>` : '<span class="dim">no moves</span>';
  return `<section class="changes">
    <h3>What changed <span class="dim">since the previous run on ${fmtDate(c.previous_date)}</span></h3>
    <div class="chg-grid">
      <div><div class="lbl">Newly Steady</div>${chips(t.new_steady, 'g')}</div>
      <div><div class="lbl">Top six</div>${top}</div>
      <div><div class="lbl">Biggest composite moves ${span}</div>${moves}</div>
    </div></section>`;
}
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// ---------- render ----------
function rowHtml(r, group) {
  const nameLine = `<span class="name" title="${esc(r.name)}">${esc(r.name)}</span>`;
  if (r.price == null) {
    const msg = Object.values(r.errors || {}).join('; ') || 'no data';
    return `<tr data-sym="${esc(r.symbol)}"><td><a class="tick" href="${tickerUrl(r.symbol)}">${esc(r.symbol)}</a>${nameLine}${Watchlist.rowControl(group, r.symbol)}</td><td colspan="${COLS.length - 1}" class="dim" style="text-align:left">${esc(msg)}</td></tr>`;
  }
  const v = r.valuation || {};
  const staleLine = r.errors?.prices ? `<span class="warnline" title="${esc(r.errors.prices)}">price update failed &middot; shown as at ${fmtDate(r.price_date)}</span>` : '';
  const badges = [...(r.sig || []), ...(r.flags || [])]
    .map(b => `<span class="b ${b[1]}"${b[2] ? ` title="${esc(b[2])}"` : ''}>${esc(b[0])}</span>`).join('');
  const fundTitle = r.fundamentals_period_end ? `Latest annual results: ${fmtDate(r.fundamentals_period_end)}` :
    (r.errors?.fundamentals || 'Fundamentals unavailable');
  return `<tr data-sym="${esc(r.symbol)}">
    <td><a class="tick" href="${tickerUrl(r.symbol)}">${esc(r.symbol)}</a><span class="mscore ${scoreColor(r.composite)}">${r.composite ?? ''}</span>${nameLine}${staleLine}${Watchlist.rowControl(group, r.symbol)}</td>
    <td>${money(r.price, r.currency)}</td>
    <td>${pct(r.ret1m)}</td>
    <td>${pct(r.ret3m)}</td>
    <td>${pct(r.vsSMA50)}</td>
    <td class="grp">${scoreCell(r.mom)}</td>
    <td>${scoreCell(r.fund, fundTitle)}</td>
    <td>${scoreCell(r.composite)}</td>
    <td>${scoreSpark(r.trend)}</td>
    <td class="grp">${ratio(v.trailing_pe, 'Not meaningful: negative earnings')}</td>
    <td>${ratio(v.forward_pe, 'Not meaningful: a loss is expected')}</td>
    <td>${ratio(v.price_to_sales)}</td>
    <td>${bigMoney(v.market_cap, r.currency)}</td>
    <td class="grp"><div class="badges">${badges}</div></td>
    <td>${sparkline(r.spark)}</td>
    <td><button class="simbtn" data-buy="${esc(r.symbol)}" title="Record a practice buy at the latest close">Simulate buy</button></td>
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
  const tab = allTabs().find(t => t.id === activeTab) || DATA.tabs[0];
  const T = DATA.tickers;

  // tab buttons
  $('tabs').innerHTML = allTabs().map(t =>
    `<button role="tab" data-tab="${esc(t.id)}" aria-selected="${t.id === tab.id}">${esc(t.name)}</button>`).join('');

  // paper portfolio tab: hide the screener parts, show the portfolio
  const isPf = tab.id === PORTFOLIO_TAB.id, isCalls = tab.id === CALLS_TAB.id, special = isPf || isCalls;
  for (const id of ['changes', 'topflags', 'wlbar', 'groups', 'legend']) $(id).hidden = special;
  const intro = document.querySelector('main > .note');
  if (intro) intro.hidden = special;
  $('portfolio').hidden = !isPf;
  $('calls').hidden = !isCalls;
  if (isPf) { Portfolio.render($('portfolio'), DATA); return; }
  if (isCalls) { Calls.renderCallsTab($('calls'), DATA); return; }

  $('changes').innerHTML = changesHtml(tab.id);

  // top six in this tab
  const seen = new Set(), all = [];
  for (const g of tab.groups) for (const s of g.tickers) {
    if (seen.has(s) || !T[s] || T[s].composite == null) continue;
    seen.add(s); all.push({...T[s], group: g.name});
  }
  all.sort((a, b) => b.composite - a.composite);
  $('topflags').innerHTML = all.length ? '<div class="cap">Top candidates this run</div>' +
    all.slice(0, 6).map(r => `<a class="card" href="${tickerUrl(r.symbol)}"><div class="t">${esc(r.symbol)}</div>
      <div class="s ${scoreColor(r.composite)}">${r.composite}</div>
      <div class="name">${esc(r.group)}</div></a>`).join('') : '';

  // one table per group
  $('wlbar').innerHTML = Watchlist.barHtml();
  const head = headHtml();
  const waiting = Watchlist.isPending() ? 'being added: scores appear after the update finishes (about 2 minutes)' : 'not fetched yet: run the screener';
  $('groups').innerHTML = tab.groups.map(g => {
    const rows = sortRows(g.tickers.map(s => T[s] || {symbol: s, name: '', errors: {prices: waiting}}));
    return `<section class="sector"><h2>${esc(g.name)}${Watchlist.groupControl(g.name)}</h2>
      <div class="tbl"><table><thead>${head}</thead><tbody>${rows.map(r => rowHtml(r, g.name)).join('')}</tbody></table></div></section>`;
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
function boot() {
ensureContainers();
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (b) setTab(b.dataset.tab, true);
});
$('tabs').addEventListener('keydown', e => {      // arrow keys move between tabs
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const ids = allTabs().map(t => t.id), i = ids.indexOf(activeTab);
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
$('groups').addEventListener('click', e => {
  const b = e.target.closest('[data-buy]');
  if (b) Portfolio.buy(DATA.tickers[b.dataset.buy], DATA);
});
$('changes').addEventListener('click', e => {
  const b = e.target.closest('[data-goto]');
  const tr = b && document.querySelector(`#groups tr[data-sym="${CSS.escape(b.dataset.goto)}"]`);
  if (!tr) return;
  tr.scrollIntoView({behavior: 'smooth', block: 'center'});
  tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash');
});
$('groups').addEventListener('keydown', onSort);
window.addEventListener('calls-change', () => { if (DATA && activeTab === CALLS_TAB.id) renderTab(); });
window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (DATA && allTabs().some(t => t.id === id)) setTab(id, false);
});

fetch('data/latest.json', {cache: 'no-cache'})
  .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
  .then(d => {
    DATA = d;
    Watchlist.adopt(d);
    const want = [location.hash.slice(1), store.get('screener_tab')];
    activeTab = want.find(id => id && allTabs().some(t => t.id === id)) || d.tabs[0].id;
    renderStatic();
    renderTab();
  })
  .catch(e => {
    $('updated').textContent = '';
    $('groups').innerHTML = `<div class="error">Could not load the data (${esc(e.message)}). Try refreshing the page.</div>`;
  });
}

// An older cached index.html may not load the shared scripts; fetch any that are missing.
(function loadMissing() {
  const missing = [];
  if (typeof fmtDate === 'undefined') missing.push('common.js?v=16');
  if (typeof lineChart === 'undefined') missing.push('chart.js?v=16');
  if (typeof Portfolio === 'undefined') missing.push('portfolio.js?v=16');
  if (typeof Watchlist === 'undefined') missing.push('watchlist.js?v=16');
  if (typeof Calls === 'undefined') missing.push('calls.js?v=16');
  (function next() {
    if (!missing.length) return boot();
    const sc = document.createElement('script');
    sc.src = missing.shift(); sc.onload = next;
    document.head.appendChild(sc);
  })();
})();
