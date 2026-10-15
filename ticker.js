// Ticker detail page: ticker.html?s=NVDA
// Reads data/latest.json (scores, breakdown, valuation), data/prices/<T>.json (chart)
// and data/history.json (score history). Charts come from chart.js.

const STALE_DAYS = 3;
const SYMBOL = (new URLSearchParams(location.search).get('s') || '').toUpperCase();

const RANGES = [['3M', 63], ['6M', 126], ['1Y', 252], ['2Y', Infinity]];
const WEEKS = {'3M': 13, '6M': 26, '1Y': 52, '2Y': Infinity};
// Which averages the price chart shows: the screener's 20/50/100-day, or the lazy system's EMAs.
const VIEWS = [['sma', '20/50/100-day'], ['lazy_w', 'Lazy weekly'], ['lazy_d', 'Lazy daily']];
let range = store.get('detail_range') || '1Y';
let view = store.get('detail_view') || 'lazy_w';
let LAZY = undefined;   // data/lazy/<ticker>.json once loaded (null if there isn't one)
let PRICES = null, ROW = null, HIST = [], LATEST = null;

// ---------- small helpers ----------
const fmtPts = x => (Math.abs(x - Math.round(x)) < 0.005 ? String(Math.round(x)) : x.toFixed(1));
function smaSeries(c, n) {
  const out = new Array(c.length).fill(null);
  let sum = 0;
  for (let i = 0; i < c.length; i++) {
    sum += c[i];
    if (i >= n) sum -= c[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}
// ---------- price chart ----------
function drawPrice() {
  const host = $('pricechart');
  if (!host || !PRICES) return;
  if (view !== 'sma') return drawLazy();
  $('lazystatus').innerHTML = '';
  const N = RANGES.find(r => r[0] === range)[1];
  const c = PRICES.close, start = Math.max(0, c.length - N);
  const full = {s20: smaSeries(c, 20), s50: smaSeries(c, 50), s100: smaSeries(c, 100)};
  const cut = a => a.slice(start);
  const dates = cut(PRICES.dates), vol = cut(PRICES.volume);
  const ccy = PRICES.currency;
  const series = [
    {name: 'Price', short: 'Price', color: C.price, values: cut(c), width: 2},
    {name: '20-day average', short: '20d', color: C.s20, values: cut(full.s20)},
    {name: '50-day average', short: '50d', color: C.s50, values: cut(full.s50)},
    {name: '100-day average', short: '100d', color: C.s100, values: cut(full.s100)},
  ];
  $('pricelegend').innerHTML = legend(series);
  lineChart(host, {
    title: `${SYMBOL} daily closing price with 20, 50 and 100-day averages, and volume`,
    dates, series, volume: vol, height: window.innerWidth < 640 ? 300 : 360,
    fmtY: (v, step) => sym(ccy) + v.toLocaleString('en-GB', {maximumFractionDigits: step < 1 ? 2 : 0, minimumFractionDigits: step < 1 ? 2 : 0}),
    tip: i => `<b>${fmtDate(dates[i])}</b>` + series.map(s =>
      `<div><i style="background:${s.color}"></i>${s.short}<span>${s.values[i] == null ? '–' : money(s.values[i], ccy)}</span></div>`).join('') +
      `<div><i style="background:${C.volume}"></i>Volume<span>${compact(vol[i])}</span></div>`,
  });
}

// ---------- lazy system chart (price + EMA15/30/60 + signals + stop) ----------
const LZ_LABEL = {in_trade: 'In trade', triggered: 'Triggered', exited: 'Exited', cancelled: 'Cancelled',
  no_setup: 'No setup', insufficient: 'Not enough history'};

function lazyStatus(cur, tf, ccy) {
  if (!cur) return '';
  const unit = tf === 'weekly' ? 'week' : 'trading day';
  const bars = cur.bars != null ? ` (${cur.bars === 0 ? 'this ' + unit : cur.bars + ' ' + unit + (cur.bars === 1 ? '' : 's')})` : '';
  let t = `<b>${tf === 'weekly' ? 'Weekly' : 'Daily'}:</b> ${LZ_LABEL[cur.state] || cur.state}` +
    (cur.since ? ` since ${fmtDate(cur.since)}${bars}` : '') +
    (cur.trend ? ` &middot; trend <span class="${cur.trend === 'bullish' ? 'pos' : 'neg'}">${cur.trend === 'bullish' ? '▲ bullish' : '▼ bearish'}</span>` : '');
  if (cur.state === 'in_trade') {
    t += ` &middot; entry ${money(cur.entry, ccy)} on ${fmtDate(cur.entry_date)}`;
    if (cur.stop != null) t += ` &middot; ${cur.phase === 2 ? 'exit below swing low' : 'trailing stop'} ${money(cur.stop, ccy)}`;
  }
  if (cur.state === 'triggered') t += ' &middot; waiting for a higher close to confirm';
  return t;
}

async function drawLazy() {
  const host = $('pricechart');
  if (LAZY === undefined) {
    LAZY = await fetch('data/lazy/' + encodeURIComponent(SYMBOL) + '.json', {cache: 'no-cache'}).then(r => (r.ok ? r.json() : null)).catch(() => null);
  }
  const tf = view === 'lazy_w' ? 'weekly' : 'daily';
  const d = LAZY && LAZY[tf];
  const ccy = PRICES.currency;
  if (!d || !d.dates) {
    $('pricelegend').innerHTML = '';
    $('lazystatus').innerHTML = '';
    host.innerHTML = `<p class="dim">${LAZY ? 'Not enough price history for the lazy system yet.' : 'The lazy-system chart appears after the next daily update.'}</p>`;
    return;
  }
  const N = tf === 'weekly' ? WEEKS[range] : RANGES.find(r => r[0] === range)[1];
  const start = Math.max(0, d.dates.length - N);
  const cut = a => a.slice(start);
  const dates = cut(d.dates);
  const [f, m, s] = LAZY.settings.ema;
  const series = [
    {name: tf === 'weekly' ? 'Weekly close' : 'Price', short: 'Price', color: C.price, values: cut(d.close), width: 2},
    {name: `EMA${f}`, short: `EMA${f}`, color: C.s20, values: cut(d.ema[0])},
    {name: `EMA${m}`, short: `EMA${m}`, color: C.s50, values: cut(d.ema[1])},
    {name: `EMA${s}`, short: `EMA${s}`, color: C.s100, values: cut(d.ema[2])},
  ];
  const kind = {triggered: 'trigger', in_trade: 'entry', exited: 'exit', cancelled: 'cancelled'};
  const words = e => {
    const p = money(e.close, ccy).replace(/<[^>]+>/g, '');
    if (e.state === 'triggered') return `Trigger ${fmtDate(e.date)}: closed ${p} above EMA${f}`;
    if (e.state === 'in_trade') return `Entry ${fmtDate(e.date)} at ${p}`;
    if (e.state === 'cancelled') return `Cancelled ${fmtDate(e.date)}: closed ${p} below EMA${f}`;
    return `Exit ${fmtDate(e.date)} at ${p} (${e.reason})` + (e.ret != null ? `, trade ${e.ret >= 0 ? '+' : ''}${(e.ret * 100).toFixed(1)}%` : '');
  };
  const at = {};
  const markers = (d.events || []).map(e => {
    const i = dates.indexOf(e.date);
    if (i < 0) return null;
    (at[i] = at[i] || []).push(words(e));
    return {i, kind: kind[e.state], title: words(e)};
  }).filter(Boolean);
  const cur = d.current || {};
  const lines = cur.state === 'in_trade' && cur.stop != null ? [{
    y: cur.stop, from: Math.max(0, dates.indexOf(cur.entry_date)), color: C.bad,
    label: `${cur.phase === 2 ? 'Swing low' : 'Stop'} ${money(cur.stop, ccy).replace(/<[^>]+>/g, '')}`,
  }] : [];

  $('lazystatus').innerHTML = lazyStatus(cur, tf, ccy);
  $('pricelegend').innerHTML = legend(series) + `<div class="legend-row marker-key">
    <span><b class="mk up">▲</b>entry</span><span><b class="mk down">▼</b>exit</span>
    <span><b class="mk trig">●</b>trigger</span><span><b class="mk">×</b>cancelled</span>
    ${lines.length ? '<span><b class="mk down">- -</b>current stop</span>' : ''}</div>`;
  lineChart(host, {
    title: `${SYMBOL} ${tf} closing price with EMA ${f}, ${m} and ${s} and lazy-system signals`,
    dates, series, markers, lines, height: window.innerWidth < 640 ? 300 : 360,
    fmtY: (v, step) => sym(ccy) + v.toLocaleString('en-GB', {maximumFractionDigits: step < 1 ? 2 : 0, minimumFractionDigits: step < 1 ? 2 : 0}),
    tip: i => `<b>${tf === 'weekly' ? 'Week to ' : ''}${fmtDate(dates[i])}</b>` + series.map(x =>
      `<div><i style="background:${x.color}"></i>${x.short}<span>${x.values[i] == null ? '–' : money(x.values[i], ccy)}</span></div>`).join('') +
      (at[i] ? at[i].map(w => `<div class="tip-ev">${esc(w)}</div>`).join('') : ''),
  });
}

// ---------- score history ----------
function drawHistory() {
  const host = $('histchart');
  if (!host) return;
  if (HIST.length < 2) {
    host.innerHTML = `<p class="dim">Score history builds up one point per daily run.` +
      (HIST.length ? ` First recorded on ${fmtDate(HIST[0].date)} (composite ${HIST[0].composite ?? '–'}).` : '') + `</p>`;
    $('histlegend').innerHTML = '';
    return;
  }
  const dates = HIST.map(h => h.date);
  const series = [
    {name: 'Composite', short: 'Comp', color: C.composite, values: HIST.map(h => h.composite), width: 2.5},
    {name: 'Momentum', short: 'Mom', color: C.mom, values: HIST.map(h => h.mom)},
    {name: 'Fundamentals', short: 'Fund', color: C.fund, values: HIST.map(h => h.fund)},
  ];
  $('histlegend').innerHTML = legend(series);
  lineChart(host, {
    title: `${SYMBOL} composite, momentum and fundamentals scores by run date`,
    dates, series, yMin: 0, yMax: 100, height: 220, fmtY: v => String(Math.round(v)),
    tip: i => `<b>${fmtDate(dates[i])}</b>` + series.map(s =>
      `<div><i style="background:${s.color}"></i>${s.name}<span>${s.values[i] ?? '–'}</span></div>`).join(''),
  });
}

// ---------- page sections ----------
function rulesTable(title, score, rules, emptyMsg) {
  if (!rules) return `<h3>${title} <span class="dim">&ndash;</span></h3><p class="dim">${emptyMsg}</p>`;
  let total = 0;
  for (const r of rules) total += r.points;
  return `<h3>${title} <span class="score ${scoreColor(score)}">${score}</span> <span class="dim">/ 100</span></h3>
    <table class="rules"><tbody>${rules.map(r => `<tr class="${r.passed ? '' : 'off'}">
      <td class="ok" aria-label="${r.passed ? 'passed' : 'not passed'}">${r.passed ? '✓' : '✗'}</td>
      <td><div>${esc(r.label)}</div><div class="det">${esc(r.detail)}</div>${r.warn ? `<div class="warnline">⚠ ${esc(r.warn)}</div>` : ''}</td>
      <td class="pts">${fmtPts(r.points)} <span class="dim">/ ${r.max}</span></td></tr>`).join('')}
    </tbody><tfoot><tr><td></td><td>Total${Math.abs(total - score) >= 0.005 ? ` <span class="dim">(${fmtPts(total)}, rounded)</span>` : ''}</td>
      <td class="pts"><b>${score}</b> <span class="dim">/ 100</span></td></tr></tfoot></table>`;
}

function compositeLine(r) {
  if (r.mom == null) return 'No composite: not enough price history.';
  if (r.fund == null) return `Composite = momentum only (no fundamentals) = <b>${r.composite}</b>`;
  const raw = 0.6 * r.mom + 0.4 * r.fund;
  return `Composite = 0.6 &times; ${r.mom} + 0.4 &times; ${r.fund} = ${raw.toFixed(1)} &rarr; <b>${r.composite}</b>`;
}

function valuationHtml(r) {
  const v = r.valuation || {}, fc = r.financial_currency || r.currency;
  const exp = (r.flags || []).find(f => f[0] === 'Expensive');
  const rows = (r.income || []).map(y => `<tr><td>${fmtDate(y.period_end)}</td>
    <td>${bigMoney(y.rev, fc)}</td><td>${bigMoney(y.gp, fc)}</td><td>${bigMoney(y.ni, fc)}</td>
    <td>${y.rev && y.gp != null ? (y.gp / y.rev * 100).toFixed(1) + '%' : DASH}</td></tr>`).join('');
  return `<h3>Valuation</h3>
    <dl class="kv">
      <dt>Trailing P/E</dt><dd>${ratio(v.trailing_pe, 'Not meaningful: negative earnings')}</dd>
      <dt>Forward P/E</dt><dd>${ratio(v.forward_pe, 'Not meaningful: a loss is expected')}</dd>
      <dt>Price / sales</dt><dd>${ratio(v.price_to_sales)}</dd>
      <dt>Market cap</dt><dd>${bigMoney(v.market_cap, r.currency)}</dd>
    </dl>
    <p class="${exp ? 'warnline' : 'dim'}" style="margin:10px 0 0">${exp ? `<span class="b w">Expensive</span> ${esc(exp[2])}.` :
      'Not flagged as expensive (forward P/E 40 or under; or price-to-sales 10 or under if no profit is expected).'}
      Valuation does not change the score.</p>
    <h3 style="margin-top:20px">Annual results</h3>
    ${rows ? `<div class="tbl"><table class="plain"><thead><tr><th>Year end</th><th>Revenue</th><th>Gross profit</th><th>Net income</th><th>Gross margin</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      ${fc !== r.currency ? `<p class="dim small">Results are reported in ${esc(fc)}; the share price is in ${esc(r.currency)}.</p>` : ''}` :
      '<p class="dim">No annual results available.</p>'}`;
}

function historyTable() {
  if (!HIST.length) return '';
  return `<details class="small"><summary>Score history table</summary><div class="tbl"><table class="plain">
    <thead><tr><th>Run date</th><th>Price</th><th>Composite</th><th>Mom</th><th>Fund</th><th>Badges</th></tr></thead>
    <tbody>${HIST.slice().reverse().map(h => `<tr><td>${fmtDate(h.date)}</td><td>${money(h.price, h.currency)}</td>
      <td>${h.composite ?? '–'}</td><td>${h.mom ?? '–'}</td><td>${h.fund ?? '–'}</td>
      <td class="badges-cell">${(h.badges || []).map(b => `<span class="b">${esc(b)}</span>`).join(' ')}</td></tr>`).join('')}</tbody>
  </table></div></details>`;
}

function priceTable() {
  if (!PRICES) return '';
  const n = PRICES.dates.length, rows = [];
  for (let i = n - 1; i >= Math.max(0, n - 30); i--)
    rows.push(`<tr><td>${fmtDate(PRICES.dates[i])}</td><td>${money(PRICES.close[i], PRICES.currency)}</td><td>${compact(PRICES.volume[i])}</td></tr>`);
  return `<details class="small"><summary>Last 30 days as a table</summary><div class="tbl"><table class="plain">
    <thead><tr><th>Date</th><th>Close</th><th>Volume</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></details>`;
}

function render(data) {
  const r = ROW;
  document.title = `${SYMBOL} · Share Screener`;
  $('title').innerHTML = `${esc(SYMBOL)} <span class="h-price">${money(r.price, r.currency)}</span>`;
  $('subtitle').innerHTML = `${esc(r.name || '')}${r.price_date ? ` &middot; close of ${fmtDate(r.price_date)}` : ''}`;
  const errs = Object.entries(r.errors || {});
  const badges = [...(r.sig || []), ...(r.flags || [])]
    .map(b => `<span class="b ${b[1]}"${b[2] ? ` title="${esc(b[2])}"` : ''}>${esc(b[0])}</span>`).join('');

  $('content').innerHTML = `
    ${errs.length ? `<div class="stale">${errs.map(([k, m]) => `<div><b>${esc(k)}:</b> ${esc(m)}</div>`).join('')}</div>` : ''}
    <section class="summary">
      <div class="stat"><div class="lbl">Composite</div><div class="big ${scoreColor(r.composite)}">${r.composite ?? '–'}</div></div>
      <div class="stat"><div class="lbl">Momentum</div><div class="mid ${scoreColor(r.mom)}">${r.mom ?? '–'}</div></div>
      <div class="stat"><div class="lbl">Fundamentals</div><div class="mid ${scoreColor(r.fund)}">${r.fund ?? '–'}</div></div>
      <div class="stat"><div class="lbl">1 month</div><div class="mid">${pct(r.ret1m)}</div></div>
      <div class="stat"><div class="lbl">3 months</div><div class="mid">${pct(r.ret3m)}</div></div>
      <div class="stat grow"><div class="lbl">Signals</div><div class="badges left">${badges || '<span class="dim">none</span>'}</div></div>
    </section>
    <div class="sim-row">
      <button class="btn" id="simbuy"${r.price == null ? ' disabled' : ''}>Simulate buy</button>
      <button class="ghost" id="tagcall">Tag a call</button>
      <span class="small dim" id="holding"></span>
    </div>

    <section class="panel">
      <div class="panel-h"><h3>Price</h3>
        <div class="seg seg-view" role="group" aria-label="Averages shown">${VIEWS.map(([k, l]) =>
          `<button data-view="${k}" aria-pressed="${k === view}">${l}</button>`).join('')}</div>
        <div class="seg seg-range" role="group" aria-label="Chart range">${RANGES.map(([k]) =>
          `<button data-range="${k}" aria-pressed="${k === range}">${k}</button>`).join('')}</div></div>
      <div class="small lazystatus" id="lazystatus"></div>
      <div id="pricelegend"></div>
      <div class="chart" id="pricechart"></div>
      ${priceTable()}
    </section>

    <div class="cols">
      <section class="panel">
        ${rulesTable('Momentum', r.mom, r.breakdown?.momentum, 'Needs at least 60 days of prices.')}
        ${rulesTable('Fundamentals', r.fund, r.breakdown?.fundamentals, 'Needs at least 2 years of annual results (common for early-stage companies). The composite then uses momentum only.')}
        <p class="composite-line">${compositeLine(r)}</p>
      </section>
      <section class="panel">${valuationHtml(r)}</section>
    </div>

    <section class="panel" id="callsbox" hidden></section>

    <section class="panel">
      <h3>Score history</h3>
      <div id="histlegend"></div>
      <div class="chart" id="histchart"></div>
      ${historyTable()}
    </section>`;

  $('content').querySelector('.seg-range').addEventListener('click', e => {
    const b = e.target.closest('[data-range]');
    if (!b) return;
    range = b.dataset.range; store.set('detail_range', range);
    $('content').querySelectorAll('.seg-range button').forEach(x => x.setAttribute('aria-pressed', x.dataset.range === range));
    drawPrice();
  });
  $('content').querySelector('.seg-view').addEventListener('click', e => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    view = b.dataset.view; store.set('detail_view', view);
    $('content').querySelectorAll('.seg-view button').forEach(x => x.setAttribute('aria-pressed', x.dataset.view === view));
    drawPrice();
  });
  $('simbuy').addEventListener('click', () => Portfolio.buy(ROW, LATEST));
  $('tagcall').addEventListener('click', () => Calls.openTag({symbol: SYMBOL, name: ROW.name}, null));
  Calls.renderForSymbol($('callsbox'), LATEST, SYMBOL);
  holdingLine();
  Portfolio.autoSync();
  drawPrice();
  drawHistory();
}

function holdingLine() {
  const el = $('holding');
  if (!el) return;
  const open = Portfolio.openFor(SYMBOL), st = Portfolio.syncState();
  const where = st.connected ? 'Saved to your Google Sheet.' : 'Saved in this browser only.';
  const warn = st.connected && st.waiting ? ` <span class="warnline">${st.waiting} change${st.waiting > 1 ? 's' : ''} not yet saved to the sheet.</span>` : '';
  el.innerHTML = (open.length ? `You hold ${open.length} simulated position${open.length > 1 ? 's' : ''} in ${esc(SYMBOL)}
    (first bought ${fmtDate(open.map(p => p.buy_date).sort()[0])}). <a href="index.html#portfolio">See paper portfolio</a>` :
    `Records a practice buy at the latest close. ${where}`) + warn;
}
window.addEventListener('portfolio-change', holdingLine);
window.addEventListener('calls-change', () => { if ($('callsbox')) Calls.renderForSymbol($('callsbox'), LATEST, SYMBOL); });

function renderUpdated(d) {
  const age = (Date.now() - new Date(d.generated_at).getTime()) / 864e5;
  $('updated').className = 'updated' + (age > STALE_DAYS ? ' old' : '');
  $('updated').innerHTML = `<div class="lbl">Last updated</div><div class="when">${fmtDateTime(d.generated_at)}</div>
    <div class="asof">Prices to the close of ${fmtDate(d.prices_as_of)}</div>`;
  if (age > STALE_DAYS) {
    $('stale').hidden = false;
    $('stale').innerHTML = `<b>This data is ${Math.floor(age)} days old.</b> The automatic daily update may have stopped working.`;
  }
}

function fail(msg) {
  $('title').textContent = SYMBOL || 'No ticker chosen';
  $('content').innerHTML = `<div class="error">${msg}</div>`;
}

// ---------- start ----------
(function start() {
  // "All shares" goes back to the tab the viewer came from.
  const tab = store.get('screener_tab');
  if (tab) $('back').href = 'index.html#' + encodeURIComponent(tab);
  if (!SYMBOL) return fail('No ticker given. <a href="index.html">Back to the screener</a>.');

  const get = url => fetch(url, {cache: 'no-cache'}).then(r => { if (!r.ok) throw new Error(url + ': HTTP ' + r.status); return r.json(); });
  get('data/latest.json').then(d => {
    renderUpdated(d);
    LATEST = d;
    ROW = d.tickers[SYMBOL];
    if (!ROW) return fail(`${esc(SYMBOL)} is not in any watchlist. <a href="index.html">Back to the screener</a>.`);
    return Promise.all([
      get('data/prices/' + encodeURIComponent(SYMBOL) + '.json').catch(() => null),
      get('data/history.json').catch(() => ({rows: []})),
    ]).then(([p, h]) => {
      PRICES = p;
      HIST = h.rows.filter(x => x.symbol === SYMBOL).sort((a, b) => a.date.localeCompare(b.date));
      render(d);
      if (!PRICES) $('pricechart').innerHTML = '<p class="dim">No price history available.</p>';
    });
  }).catch(e => fail(`Could not load the data (${esc(e.message)}). Try refreshing the page.`));

  let lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    if (Math.abs(window.innerWidth - lastW) < 20) return;
    lastW = window.innerWidth;
    clearTimeout(window._rz);
    window._rz = setTimeout(() => { drawPrice(); drawHistory(); }, 150);
  });
})();
