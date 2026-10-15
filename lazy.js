// Simon Brown's lazy trading system on the screener. The signals are worked out by the daily
// update (pipeline/lazy.py); this file only shows them: a column, its sorting and the filters.
// Needs common.js.

const Lazy = (() => {
  const STATES = {
    in_trade: {label: 'In trade', cls: 'g', rank: 5},
    triggered: {label: 'Triggered', cls: 'w', rank: 4},
    exited: {label: 'Exited', cls: '', rank: 2},
    cancelled: {label: 'Cancelled', cls: '', rank: 1},
    no_setup: {label: 'No setup', cls: '', rank: 0},
    insufficient: {label: 'Too new', cls: '', rank: -1},
  };
  const FILTER_KEY = 'lazy_filters_v1';
  const STATE_FILTERS = [
    ['any', 'Any'], ['active', 'In trade or triggered'], ['in_trade', 'In trade'], ['triggered', 'Triggered'],
    ['exited', 'Exited'], ['cancelled', 'Cancelled'], ['no_setup', 'No setup'],
  ];
  const TREND_FILTERS = [['any', 'Any'], ['bullish', 'Bullish'], ['bearish', 'Bearish']];

  let filters = (() => {
    try { return Object.assign({w: 'any', d: 'any', trend: 'any'}, JSON.parse(store.get(FILTER_KEY) || '{}')); }
    catch (e) { return {w: 'any', d: 'any', trend: 'any'}; }
  })();

  const sig = (r, tf) => (r && r.lazy && r.lazy[tf]) || null;

  function age(s, unit) {
    if (s.bars == null) return '';
    const n = s.bars, word = unit === 'w' ? (n === 1 ? 'week' : 'weeks') : (n === 1 ? 'trading day' : 'trading days');
    return `<span class="dim small" title="Since ${fmtDate(s.since)}: ${n} ${word}">${n === 0 ? 'new' : n + unit}</span>`;
  }

  function stateTitle(s, ccy) {
    const st = STATES[s.state] || STATES.no_setup;
    let t = `${st.label}${s.since ? ' since ' + fmtDate(s.since) : ''}.`;
    if (s.state === 'in_trade') {
      t += ` Entry ${money(s.entry, ccy).replace(/<[^>]+>/g, '')} on ${fmtDate(s.entry_date)}.`;
      if (s.stop != null) {
        t += s.phase === 2 ? ` Exit if a close falls below the last swing low (${money(s.stop, ccy).replace(/<[^>]+>/g, '')}).`
          : ` Trailing stop ${money(s.stop, ccy).replace(/<[^>]+>/g, '')} (20% under the highest close since entry).`;
      }
    }
    if (s.state === 'insufficient') t = 'Not enough price history yet for the 60-period average.';
    if (s.stale) t += ' Not updated on the last run (prices failed to download).';
    return t;
  }

  function part(s, unit, ccy) {
    if (!s) return '';
    const st = STATES[s.state] || STATES.no_setup;
    const bull = s.trend === 'bullish';
    const trend = s.trend ? `<span class="${bull ? 'pos' : 'neg'}" title="Primary trend: ${bull ? 'bullish (EMA30 above EMA60)' : 'bearish (EMA30 below EMA60)'}">${bull ? '▲' : '▼'}</span>` : '';
    return `<div class="lz"><span class="lz-tf">${unit === 'w' ? 'W' : 'D'}</span>${trend}
      <span class="b ${st.cls}" title="${esc(stateTitle(s, ccy))}">${st.label}${s.stale ? '*' : ''}</span>${age(s, unit)}</div>`;
  }

  /** The table cell: weekly on top, daily underneath. */
  function cell(r) {
    const w = sig(r, 'weekly'), d = sig(r, 'daily');
    if (!w && !d) return DASH;
    return `<div class="lzcell">${part(w, 'w', r.currency)}${part(d, 'd', r.currency)}</div>`;
  }

  /** Sorting: weekly state first (in trade, triggered, ...), newest first within a state, then daily. */
  function sortKey(r) {
    const w = sig(r, 'weekly'), d = sig(r, 'daily');
    if (!w && !d) return null;
    const rank = s => (s ? (STATES[s.state] || STATES.no_setup).rank : -2);
    return rank(w) * 10000 - Math.min((w && w.bars) || 0, 999) * 10 + rank(d);
  }

  function stateMatches(s, want) {
    if (want === 'any') return true;
    if (!s) return false;
    return want === 'active' ? s.state === 'in_trade' || s.state === 'triggered' : s.state === want;
  }
  function matches(r) {
    const w = sig(r, 'weekly');
    return stateMatches(w, filters.w) && stateMatches(sig(r, 'daily'), filters.d) &&
      (filters.trend === 'any' || (w && w.trend === filters.trend));
  }
  const active = () => filters.w !== 'any' || filters.d !== 'any' || filters.trend !== 'any';

  function filterBar() {
    const sel = (name, opts, value) => `<select class="txt lz-filter" data-lz="${name}">${opts.map(([v, l]) =>
      `<option value="${v}"${v === value ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    return `<span class="lz-label" title="Simon Brown's lazy trading system (EMA 15/30/60)">Lazy system</span>
      <label>Weekly ${sel('w', STATE_FILTERS, filters.w)}</label>
      <label>Daily ${sel('d', STATE_FILTERS, filters.d)}</label>
      <label>Weekly trend ${sel('trend', TREND_FILTERS, filters.trend)}</label>
      ${active() ? '<button class="ghost subtle wl-small" data-lz-clear>Clear</button>' : ''}`;
  }

  const legend = '<b>Lazy W / D</b> = Simon Brown’s lazy trading system on weekly (W) and daily (D) bars: ' +
    '▲/▼ primary trend (EMA30 above/below EMA60); <i>Triggered</i> = closed back above EMA15 with EMA15 &gt; EMA30 &gt; EMA60; ' +
    '<i>In trade</i> = confirmed by a higher close; <i>Exited</i> = hit the 20% trailing stop or, after breakeven, a lower low. ' +
    'The number is how long it has been in that state. A trend signal, separate from the scores.';

  document.addEventListener('change', e => {
    const t = e.target.closest('[data-lz]');
    if (!t) return;
    filters[t.dataset.lz] = t.value;
    store.set(FILTER_KEY, JSON.stringify(filters));
    renderTab();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('[data-lz-clear]')) return;
    filters = {w: 'any', d: 'any', trend: 'any'};
    store.set(FILTER_KEY, JSON.stringify(filters));
    renderTab();
  });

  return {cell, sortKey, matches, active, filterBar, legend, STATES};
})();
