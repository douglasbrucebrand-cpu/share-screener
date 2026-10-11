// Ticker detail page: ticker.html?s=NVDA
// Reads data/latest.json (scores, breakdown, valuation), data/prices/<T>.json (chart)
// and data/history.json (score history). Charts are plain SVG, no libraries.

const STALE_DAYS = 3;
const SYMBOL = (new URLSearchParams(location.search).get('s') || '').toUpperCase();

// Chart colours (validated for colour-blind separation and contrast on the dark panel).
const C = {price: '#3987e5', s20: '#d95926', s50: '#199e70', s100: '#c98500',
           composite: '#3987e5', mom: '#d95926', fund: '#199e70',
           volume: '#3a4552', grid: '#232b36', axis: '#8b98a8', panel: '#161c24'};

const RANGES = [['3M', 63], ['6M', 126], ['1Y', 252], ['2Y', Infinity]];
let range = store.get('detail_range') || '1Y';
let PRICES = null, ROW = null, HIST = [];

// ---------- small helpers ----------
const fmtPts = x => (Math.abs(x - Math.round(x)) < 0.005 ? String(Math.round(x)) : x.toFixed(1));
function compact(x) {
  const a = Math.abs(x);
  if (a >= 1e9) return (x / 1e9).toFixed(1) + 'bn';
  if (a >= 1e6) return (x / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'm';
  if (a >= 1e3) return (x / 1e3).toFixed(0) + 'k';
  return String(Math.round(x));
}
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
function niceStep(span, n) {
  const raw = span / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------- generic line chart (+ optional volume panel underneath, sharing the date axis) ----------
// o = {dates, series:[{name, color, values, width}], yMin, yMax, fmtY, height, volume, tip(i)}
function lineChart(host, o) {
  const n = o.dates.length;
  const W = Math.max(280, host.clientWidth);
  const volH = o.volume ? 60 : 0, gap = o.volume ? 12 : 0;
  const m = {l: 58, r: 50, t: 8, b: 22};
  const pw = W - m.l - m.r, ph = o.height - m.t - m.b - volH - gap;
  const X = i => m.l + (n > 1 ? i / (n - 1) : 0.5) * pw;

  let lo = o.yMin, hi = o.yMax;
  if (lo == null || hi == null) {
    const vals = o.series.flatMap(s => s.values).filter(v => v != null);
    const mn = Math.min(...vals), mx = Math.max(...vals), pad = (mx - mn || mx || 1) * 0.06;
    lo = lo ?? mn - pad; hi = hi ?? mx + pad;
  }
  const Y = v => m.t + ph - (v - lo) / (hi - lo) * ph;
  const step = niceStep(hi - lo, 4);
  let svg = '';

  // grid + y labels
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    const y = Y(v).toFixed(1);
    svg += `<line x1="${m.l}" x2="${m.l + pw}" y1="${y}" y2="${y}" stroke="${C.grid}"/>` +
      `<text x="${m.l - 8}" y="${y}" dy="0.32em" text-anchor="end" class="ax">${esc(o.fmtY(v, step))}</text>`;
  }

  // x labels at month starts, thinned so they don't collide
  let lastX = -1e9, firstLabel = true;
  const daily = n <= 40;   // short spans (early score history): label days, not months
  for (let i = 0; i < n && daily; i++) {
    const x = X(i);
    if (x - lastX < 46) continue;
    lastX = x;
    svg += `<text x="${x.toFixed(1)}" y="${o.height - 6}" text-anchor="middle" class="ax xt">${fmtDate(o.dates[i]).slice(0, 5)}</text>`;
  }
  for (let i = 0; i < n && !daily; i++) {
    const mo = o.dates[i].slice(5, 7);
    if (i > 0 && mo === o.dates[i - 1].slice(5, 7)) continue;
    if (i === 0) continue;                    // partial first month: skip
    const x = X(i);
    if (x - lastX < 58 || x > m.l + pw - 20) continue;
    lastX = x;
    const label = MONTHS[+mo - 1] + (mo === '01' || firstLabel ? ` ’${o.dates[i].slice(2, 4)}` : '');
    firstLabel = false;
    svg += `<text x="${x.toFixed(1)}" y="${o.height - 6}" text-anchor="middle" class="ax xt">${label}</text>`;
  }

  // volume bars
  if (o.volume) {
    const vt = m.t + ph + gap, vmax = Math.max(...o.volume, 1);
    const bw = Math.max(1, pw / n - (pw / n > 4 ? 2 : 0));
    let bars = '';
    o.volume.forEach((v, i) => {
      const h = v / vmax * volH;
      if (h > 0) bars += `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${(vt + volH - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}"/>`;
    });
    svg += `<g fill="${C.volume}">${bars}</g>` +
      `<text x="${m.l - 8}" y="${vt + 4}" dy="0.32em" text-anchor="end" class="ax">${compact(vmax)}</text>` +
      `<text x="${m.l - 8}" y="${vt + volH}" text-anchor="end" class="ax">Vol</text>`;
  }

  // lines
  for (const s of o.series) {
    let d = '', pen = false;
    s.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1);
      pen = true;
    });
    svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 1.5}" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  // direct labels at the right-hand end, nudged apart so they don't overlap
  const ends = o.series.map(s => {
    let i = s.values.length - 1;
    while (i >= 0 && s.values[i] == null) i--;
    return i < 0 ? null : {s, y: Y(s.values[i])};
  }).filter(Boolean).sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;
  for (const e of ends) {
    svg += `<line x1="${m.l + pw + 5}" x2="${m.l + pw + 13}" y1="${e.y.toFixed(1)}" y2="${e.y.toFixed(1)}" stroke="${e.s.color}" stroke-width="2.5" stroke-linecap="round"/>` +
      `<text x="${m.l + pw + 16}" y="${e.y.toFixed(1)}" dy="0.32em" class="ax lbl">${esc(e.s.short || e.s.name)}</text>`;
  }

  const label = `${o.title}. ${n} points from ${fmtDate(o.dates[0])} to ${fmtDate(o.dates[n - 1])}. Use left and right arrow keys to read values.`;
  host.innerHTML = `<svg width="${W}" height="${o.height}" tabindex="0" role="img" aria-label="${esc(label)}">${svg}
    <g class="xh" style="display:none"><line class="xl" y1="${m.t}" y2="${m.t + ph + gap + volH}" stroke="${C.axis}" stroke-dasharray="3 3"/>
    ${o.series.map(s => `<circle r="4" fill="${s.color}" stroke="${C.panel}" stroke-width="2"/>`).join('')}</g>
    <rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph + gap + volH}" fill="transparent"/></svg>
    <div class="tip" hidden></div>`;

  // hover / touch / keyboard read-out
  const el = host.querySelector('svg'), xh = el.querySelector('.xh'), tip = host.querySelector('.tip');
  const dots = xh.querySelectorAll('circle');
  let cur = -1;
  function show(i) {
    cur = Math.max(0, Math.min(n - 1, i));
    const x = X(cur);
    xh.style.display = '';
    xh.querySelector('.xl').setAttribute('x1', x); xh.querySelector('.xl').setAttribute('x2', x);
    o.series.forEach((s, k) => {
      const v = s.values[cur];
      dots[k].style.display = v == null ? 'none' : '';
      if (v != null) { dots[k].setAttribute('cx', x); dots[k].setAttribute('cy', Y(v)); }
    });
    tip.hidden = false;
    tip.innerHTML = o.tip(cur);
    const tw = tip.offsetWidth;
    tip.style.left = (x + 14 + tw > W ? x - 14 - tw : x + 14) + 'px';
    tip.style.top = m.t + 'px';
  }
  function hide() { xh.style.display = 'none'; tip.hidden = true; }
  const at = e => Math.round((e.clientX - el.getBoundingClientRect().left - m.l) / pw * (n - 1));
  el.addEventListener('pointermove', e => show(at(e)));
  el.addEventListener('pointerdown', e => show(at(e)));
  el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
  el.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); show((cur < 0 ? n - 1 : cur) + (e.key === 'ArrowLeft' ? -1 : 1));
    } else if (e.key === 'Escape') hide();
  });
  el.addEventListener('blur', hide);
}

const legend = series => `<div class="legend-row">${series.map(s =>
  `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;

// ---------- price chart ----------
function drawPrice() {
  const host = $('pricechart');
  if (!host || !PRICES) return;
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

    <section class="panel">
      <div class="panel-h"><h3>Price</h3>
        <div class="seg" role="group" aria-label="Chart range">${RANGES.map(([k]) =>
          `<button data-range="${k}" aria-pressed="${k === range}">${k}</button>`).join('')}</div></div>
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

    <section class="panel">
      <h3>Score history</h3>
      <div id="histlegend"></div>
      <div class="chart" id="histchart"></div>
      ${historyTable()}
    </section>`;

  $('content').querySelector('.seg').addEventListener('click', e => {
    const b = e.target.closest('[data-range]');
    if (!b) return;
    range = b.dataset.range; store.set('detail_range', range);
    $('content').querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', x.dataset.range === range));
    drawPrice();
  });
  drawPrice();
  drawHistory();
}

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
