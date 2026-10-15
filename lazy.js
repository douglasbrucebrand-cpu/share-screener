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

  // ---------- signals feed ("what do I need to look at this week") ----------
  const KINDS = [
    ['triggered', 'New triggers', 'Closed back above EMA15 with the EMAs lined up: waiting for a higher close to confirm.'],
    ['in_trade', 'Confirmed: new entries', 'A higher close confirmed the trigger.'],
    ['exited', 'Exits', ''],
    ['cancelled', 'Cancelled triggers', 'Closed back below EMA15 before confirming.'],
  ];
  const TAB_KEY = 'signals_tab_v1';
  const plain = (x, ccy) => money(x, ccy).replace(/<[^>]+>/g, '');

  function tabsOf(data, sym) {
    const out = [];
    for (const t of data.tabs) for (const g of t.groups) if (g.tickers.includes(sym)) out.push(`${t.name} / ${g.name}`);
    return out;
  }

  function itemHtml(e, data) {
    const r = data.tickers[e.symbol] || {}, ccy = r.currency;
    let detail = '';
    if (e.state === 'triggered') detail = `closed ${plain(e.close, ccy)}, waiting for a higher close`;
    if (e.state === 'in_trade') detail = `entry ${plain(e.entry, ccy)} &middot; starting stop ${plain(e.stop, ccy)}`;
    if (e.state === 'cancelled') detail = `closed ${plain(e.close, ccy)}, back below EMA15`;
    if (e.state === 'exited') {
      const why = e.reason === 'trailing stop' ? 'hit the 20% trailing stop' : 'made a lower low (below the last swing low)';
      detail = `closed ${plain(e.close, ccy)}, ${why}` + (e.ret != null
        ? ` &middot; trade <span class="${e.ret >= 0 ? 'pos' : 'neg'}">${e.ret >= 0 ? '+' : ''}${(e.ret * 100).toFixed(1)}%</span>` +
          (e.entry_date ? ` <span class="dim">(in ${fmtDate(e.entry_date)} at ${plain(e.entry, ccy)})</span>` : '') : '');
    }
    const where = tabsOf(data, e.symbol).join(', ');
    return `<li class="sig-item">
      <a class="tick" href="${tickerUrl(e.symbol)}">${esc(e.symbol)}</a>
      ${r.composite != null ? `<span class="score ${scoreColor(r.composite)}" title="Composite score">${r.composite}</span>` : ''}
      ${e.latest ? '<span class="b g" title="Happened on the latest bar, i.e. since the last run">Latest</span>' : ''}
      <span class="name inline">${esc(r.name || '')}</span>
      <div class="small">${detail}</div>
      ${where ? `<div class="dim small">${esc(where)}</div>` : ''}</li>`;
  }

  function section(events, data, tf) {
    const byDate = {};
    for (const e of events) (byDate[e.date] = byDate[e.date] || []).push(e);
    // Always show the latest bar, even when nothing happened on it, so it's clear it was checked.
    const latestBar = Object.values(data.tickers).map(r => r.lazy && r.lazy[tf] && r.lazy[tf].date).filter(Boolean).sort().pop();
    const label = d => `${tf === 'weekly' ? 'Week ending ' : ''}${fmtDate(d)}${tf === 'daily' ? ` <span class="dim">(${new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', {weekday: 'long', timeZone: 'UTC'})})</span>` : ''}`;
    const quiet = latestBar && !byDate[latestBar]
      ? `<div class="sig-day"><h4>${label(latestBar)}</h4><p class="dim small">Nothing new ${tf === 'weekly' ? 'this week' : 'on the latest day'}.</p></div>` : '';
    if (!events.length) return quiet || `<p class="dim">No ${tf} signals in this period.</p>`;
    return quiet + Object.keys(byDate).sort().reverse().map(d => {
      const list = byDate[d];
      return `<div class="sig-day"><h4>${label(d)}</h4>
        ${KINDS.map(([k, label, help]) => {
          const items = list.filter(e => e.state === k);
          if (!items.length) return '';
          return `<div class="sig-kind ${k === 'cancelled' ? 'muted' : ''}"><div class="sig-label">${label} (${items.length})
            ${help ? `<span class="dim small" title="${esc(help)}">ⓘ</span>` : ''}</div>
            <ul class="sig-list">${items.map(e => itemHtml(e, data)).join('')}</ul></div>`;
        }).join('')}</div>`;
    }).join('');
  }

  /** The Signals tab. */
  function renderSignalsTab(host, data) {
    const feed = data.lazy_feed || [];
    let which = store.get(TAB_KEY) || 'all';
    if (which !== 'all' && !data.tabs.some(t => t.id === which)) which = 'all';
    const inTab = sym => which === 'all' || data.tabs.find(t => t.id === which).groups.some(g => g.tickers.includes(sym));
    const shown = feed.filter(e => inTab(e.symbol));
    const weekly = shown.filter(e => e.tf === 'weekly'), daily = shown.filter(e => e.tf === 'daily');
    host.innerHTML = `
      <div class="note">What changed in Simon Brown's lazy trading system: new <b>triggers</b>, <b>confirmed</b> entries and
        <b>exits</b> (plus cancelled triggers). <b>Latest</b> marks signals on the most recent bar, i.e. since the last run.
        Weekly is Simon's preferred timeframe. A trend signal to look at, not a buy instruction.</div>
      <div class="pf-toolbar"><label class="small">Show <select class="txt lz-filter" data-sig-tab>
        <option value="all">All watchlists</option>${data.tabs.map(t => `<option value="${esc(t.id)}"${t.id === which ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
      </select></label></div>
      <div class="cols sig-cols">
        <section class="panel"><h3>Weekly <span class="dim">· last 4 weeks</span></h3>${section(weekly, data, 'weekly')}</section>
        <section class="panel"><h3>Daily <span class="dim">· last 5 trading days</span></h3>${section(daily, data, 'daily')}</section>
      </div>`;
  }
  document.addEventListener('change', e => {
    const t = e.target.closest('[data-sig-tab]');
    if (!t) return;
    store.set(TAB_KEY, t.value);
    renderTab();
  });

  /** One line for a watchlist tab: signals on the latest bar for its shares, linking to the Signals tab. */
  function summaryLine(tab, data) {
    const syms = new Set(tab.groups.flatMap(g => g.tickers));
    const latest = (data.lazy_feed || []).filter(e => e.latest && syms.has(e.symbol));
    if (!latest.length) return '';
    const count = (tf, state, word) => {
      const n = latest.filter(e => e.tf === tf && e.state === state).length;
      return n ? `${n} ${word}${n === 1 ? '' : 's'}` : '';
    };
    const part = (tf, label) => {
      const bits = [count(tf, 'triggered', 'trigger'), count(tf, 'in_trade', 'new entry').replace('entrys', 'entries'), count(tf, 'exited', 'exit')].filter(Boolean);
      return bits.length ? `<b>${label}:</b> ${bits.join(' · ')}` : '';
    };
    const text = [part('weekly', 'This week'), part('daily', 'Latest day')].filter(Boolean).join(' &nbsp; ');
    return text ? `<span class="sig-summary">${text} <a href="#signals">See Signals</a></span>` : '';
  }

  return {cell, sortKey, matches, active, filterBar, legend, STATES, renderSignalsTab, summaryLine};
})();
