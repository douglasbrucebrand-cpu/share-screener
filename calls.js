// Analyst calls: tag a prediction someone made ("Simon Brown, SBK.JO, bullish, 13/10/2026")
// and record the share's price at the time, so it can be judged later.
// Phase 8, step 1: calls are saved in this browser. (Step 2 adds your Google Sheet.)
// Needs common.js, portfolio.js (messages, sheet search) and watchlist.js (share search).

const Calls = (() => {
  const KEY = 'calls_v1';
  const DIRECTIONS = {
    bullish: {label: 'Bullish', icon: '▲', cls: 'up'},
    bearish: {label: 'Bearish', icon: '▼', cls: 'down'},
    neutral: {label: 'Neutral', icon: '●', cls: 'flat'},
  };
  const SYMBOL = /^\^?[A-Z0-9][A-Z0-9.\-=]{0,14}$/;

  // ---------- pure helpers (also tested in tests/calls_test.js) ----------

  /** Today's date on this computer, as YYYY-MM-DD. */
  function today() { return new Date().toLocaleDateString('en-CA'); }

  // When a market's closing price is final (local time zone, hour, minute), matching the update script.
  const MARKET_CLOSE = {'.JO': ['Africa/Johannesburg', 17, 30]};
  const US_CLOSE = ['America/New_York', 16, 30];

  /** Was the price for `date` final when the price file was saved? (Guards against mid-day prices.) */
  function isFinal(symbol, date, savedAt) {
    if (!savedAt) return true;
    const [tz, h, m] = Object.entries(MARKET_CLOSE).find(([suf]) => symbol.toUpperCase().endsWith(suf))?.[1] || US_CLOSE;
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(new Date(savedAt)).map(x => [x.type, x.value]));
    const localDate = `${p.year}-${p.month}-${p.day}`;
    if (localDate > date) return true;
    return localDate === date && (+p.hour > h || (+p.hour === h && +p.minute >= m));
  }

  /**
   * Entry price for a call: the close on the call date, or the next trading day's close if the
   * call date wasn't a trading day or the call was made after the close.
   * Returns {date, price}, {pending: true} if that close isn't in the price file yet (or wasn't
   * final when the file was saved), or {tooOld: true, first} if the call is older than the history.
   */
  function resolveEntry(callDate, afterClose, px, symbol) {
    if (!px || !px.dates || !px.dates.length) return {pending: true};
    if (callDate < px.dates[0]) return {tooOld: true, first: px.dates[0]};
    for (let i = 0; i < px.dates.length; i++) {
      const d = px.dates[i];
      if (afterClose ? d > callDate : d >= callDate) {
        if (symbol && !isFinal(symbol, d, px.updated_at)) return {pending: true};
        return {date: d, price: px.close[i]};
      }
    }
    return {pending: true};
  }

  /** Why that entry date was used, in words. */
  function entryRule(call) {
    if (!call.entry_date) return '';
    if (call.after_close) return 'next trading day (call made after the close)';
    if (call.entry_date === call.call_date) return 'close on the call date';
    return 'next trading day (the call date was not a trading day)';
  }

  /** Check and tidy the form's values. Returns {errors: [...], call: {...}}. */
  function validate(f, now) {
    const errors = [];
    const str = (v, n) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, n);
    const call = {
      who: str(f.who, 80),
      firm: str(f.firm, 80),
      symbol: str(f.symbol, 20).toUpperCase(),
      call_date: str(f.call_date, 10),
      after_close: !!f.after_close,
      direction: str(f.direction, 10).toLowerCase(),
      target: null,
      source: String(f.source == null ? '' : f.source).trim().slice(0, 500),
    };
    if (!call.who) errors.push('Who made the call?');
    if (!SYMBOL.test(call.symbol)) errors.push('Choose a share.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(call.call_date)) errors.push('Choose the date of the call.');
    else if (call.call_date > (now || today())) errors.push("The call date can't be in the future.");
    else if (call.call_date < '2000-01-01') errors.push('That date is too far back.');
    if (!DIRECTIONS[call.direction]) errors.push('Choose bullish, bearish or neutral.');
    const t = String(f.target == null ? '' : f.target).trim().replace(/[\s,]/g, '');
    if (t) {
      const n = Number(t);
      if (!(n > 0 && n < 1e7)) errors.push('The target price should be a positive number, or left empty.');
      else call.target = n;
    }
    return {errors, call};
  }

  /** A source that is a web address becomes a link; anything else is shown as a note. */
  function sourceLink(src) {
    if (!/^https?:\/\/[^\s]+$/i.test(src || '')) return null;
    try { return new URL(src); } catch (e) { return null; }
  }

  // Nothing below runs outside a browser (the tests only use the helpers above).
  if (typeof document === 'undefined') return {resolveEntry, isFinal, entryRule, validate, sourceLink};

  // ---------- storage (this browser) ----------
  let state = null;
  function load() {
    if (state) return state;
    try { state = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { state = null; }
    if (!state || !Array.isArray(state.calls)) state = {version: 1, calls: []};
    return state;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage blocked: kept for this visit */ }
    window.dispatchEvent(new Event('calls-change'));
  }
  const all = () => load().calls;
  const forSymbol = sym => all().filter(c => c.symbol === sym);
  window.addEventListener('storage', e => { if (e.key === KEY) { state = null; window.dispatchEvent(new Event('calls-change')); } });

  // ---------- prices ----------
  const priceCache = {};
  function prices(sym) {
    return priceCache[sym] || (priceCache[sym] = fetch('data/prices/' + encodeURIComponent(sym) + '.json', {cache: 'no-cache'})
      .then(r => (r.ok ? r.json() : null)).catch(() => null));
  }
  let latest = null;   // data/latest.json, for names and currencies
  const info = sym => (latest && latest.tickers[sym]) || null;
  const currencyOf = sym => info(sym)?.currency || (sym.endsWith('.JO') ? 'ZAR' : 'USD');

  /** Fill in entry prices that couldn't be worked out before (e.g. the next close hadn't happened). */
  async function resolvePending() {
    let changed = false;
    for (const c of all().filter(x => !x.entry_date)) {
      const r = resolveEntry(c.call_date, c.after_close, await prices(c.symbol), c.symbol);
      if (r.date) { Object.assign(c, {entry_date: r.date, entry_price: r.price, entry_status: null}); changed = true; }
      else {
        const status = r.tooOld ? 'too_old' : 'pending';
        if (c.entry_status !== status) { c.entry_status = status; c.history_starts = r.first || null; changed = true; }
      }
    }
    if (changed) save();
  }

  function entryText(c) {
    if (c.entry_date) {
      const later = c.entry_date !== c.call_date;
      return `${money(c.entry_price, currencyOf(c.symbol))} <span class="dim small">${later ? 'on ' + fmtDate(c.entry_date) : ''}</span>`;
    }
    if (c.entry_status === 'too_old') return `<span class="warnline small">older than the price history (from ${fmtDate(c.history_starts)})</span>`;
    return `<span class="dim small" title="${info(c.symbol) ? "Waiting for that day's closing price" : 'This share is not tracked yet: prices start once it is'}">pending</span>`;
  }
  const dirBadge = d => { const x = DIRECTIONS[d] || DIRECTIONS.neutral; return `<span class="callbadge ${x.cls}">${x.icon} ${x.label}</span>`; };
  function sourceHtml(src) {
    if (!src) return '';
    const u = sourceLink(src);
    if (u) return `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer nofollow">${esc(u.hostname.replace(/^www\./, ''))}</a>`;
    return `<span class="dim" title="${esc(src)}">${esc(src.length > 40 ? src.slice(0, 40) + '…' : src)}</span>`;
  }

  // ---------- the tag / edit dialog ----------
  function dialog(html) {
    let d = document.getElementById('call-dialog');
    if (!d) { d = document.createElement('dialog'); d.id = 'call-dialog'; document.body.appendChild(d); }
    d.innerHTML = html;
    d.showModal();
    d.querySelector('[value=cancel]')?.addEventListener('click', e => { e.preventDefault(); d.close(); });
    return d;
  }

  /**
   * Open the form. fixed = {symbol, name} when tagging from a share's page; existing = a call to edit.
   */
  function openTag(fixed, existing) {
    load();
    const c = existing || {};
    let share = existing ? {symbol: c.symbol, name: c.name} : fixed || null;
    const names = [...new Set(all().map(x => x.who).filter(Boolean))].sort();
    const firms = [...new Set(all().map(x => x.firm).filter(Boolean))].sort();
    const dir = c.direction || '';
    const d = dialog(`<form method="dialog" novalidate>
      <div class="dlg-h">${existing ? 'Edit call' : 'Tag a call'}</div>
      <div class="dlg-b">
        <div class="call-share"></div>
        <label class="field">Who made the call
          <input class="txt" name="who" list="calls-who" maxlength="80" autocomplete="off" required value="${esc(c.who || '')}" placeholder="e.g. Simon Brown"></label>
        <datalist id="calls-who">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
        <label class="field">Firm or outlet <span class="dim">(optional)</span>
          <input class="txt" name="firm" list="calls-firm" maxlength="80" autocomplete="off" value="${esc(c.firm || '')}" placeholder="e.g. Moneyweb"></label>
        <datalist id="calls-firm">${firms.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
        <div class="call-row">
          <label class="field">Date of the call
            <input class="txt" type="date" name="call_date" max="${today()}" required value="${esc(c.call_date || today())}"></label>
          <label class="check small"><input type="checkbox" name="after_close"${c.after_close ? ' checked' : ''}>
            <span>Made after that day's market close <span class="dim">(uses the next trading day's price)</span></span></label>
        </div>
        <fieldset class="field call-dir"><legend>Direction</legend>
          ${Object.entries(DIRECTIONS).map(([k, x]) => `<label class="seg-opt ${x.cls}"><input type="radio" name="direction" value="${k}"${dir === k ? ' checked' : ''}><span>${x.icon} ${x.label}</span></label>`).join('')}
        </fieldset>
        <label class="field">Target price <span class="dim">(optional)</span>
          <span class="amt"><span class="call-ccy"></span><input name="target" type="text" inputmode="decimal" autocomplete="off" value="${c.target != null ? esc(c.target) : ''}"></span></label>
        <label class="field">Source link or note <span class="dim">(optional)</span>
          <input class="txt" name="source" maxlength="500" autocomplete="off" value="${esc(c.source || '')}" placeholder="e.g. https://www.moneyweb.co.za/… or 'Radio interview'"></label>
        <p class="dim small">Saved in this browser for now. The entry price is the close on the call date, or the next
          trading day's close if the market was shut or the call came after the close.</p>
        <p class="warnline small call-error" hidden></p>
      </div>
      <div class="dlg-f"><button value="cancel" class="ghost">Cancel</button><button value="ok">${existing ? 'Save changes' : 'Tag call'}</button></div></form>`);

    // The share: fixed (from its page), or chosen with the same search as the watchlist editor.
    const shareBox = d.querySelector('.call-share'), ccy = d.querySelector('.call-ccy');
    let picker = null;
    function showShare() {
      ccy.textContent = share ? (sym(currencyOf(share.symbol)).trim() || currencyOf(share.symbol)) : '';
      if (share) {
        shareBox.innerHTML = `<div class="field">Share <div class="call-chosen"><b>${esc(share.symbol)}</b>
          <span class="dim">${esc(share.name || info(share.symbol)?.name || '')}</span>
          ${fixed && !existing ? '' : '<button type="button" class="ghost subtle wl-small" data-change>Change</button>'}</div></div>`;
        shareBox.querySelector('[data-change]')?.addEventListener('click', () => { share = null; showShare(); });
      } else {
        picker = Watchlist.symbolPicker(shareBox, {
          onChange: s => { if (s) { share = {symbol: s.symbol, name: s.typed ? '' : s.name}; ccy.textContent = sym(currencyOf(s.symbol)).trim(); } },
        });
        picker.focus();
      }
    }
    showShare();
    if (share) d.querySelector('[name=who]').focus();

    d.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      if (e.submitter && e.submitter.value !== 'ok') return d.close();
      const f = Object.fromEntries(new FormData(e.target));
      f.after_close = !!e.target.after_close.checked;
      f.symbol = share ? share.symbol : '';
      const {errors, call} = validate(f);
      const err = d.querySelector('.call-error');
      if (errors.length) { err.textContent = errors.join(' '); err.hidden = false; return; }
      call.name = (share && share.name) || info(call.symbol)?.name || c.name || '';
      const priceMatters = !existing || existing.symbol !== call.symbol || existing.call_date !== call.call_date ||
        !!existing.after_close !== call.after_close;
      const now = new Date().toISOString();
      if (existing) {
        Object.assign(existing, call, {updated_at: now});
        if (priceMatters) Object.assign(existing, {entry_date: null, entry_price: null, entry_status: null});
      } else {
        state.calls.push(Object.assign({id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6)}, call,
          {entry_date: null, entry_price: null, entry_status: null, created_at: now, updated_at: now}));
      }
      save();
      d.close();
      resolvePending();
      Portfolio.toast(existing ? 'Call updated.' : `Tagged: ${esc(call.who)}, ${esc(call.symbol)}, ${DIRECTIONS[call.direction].label.toLowerCase()}, ${fmtDate(call.call_date)}.`);
    });
  }

  function remove(id) {
    const c = all().find(x => x.id === id);
    if (!c) return;
    const d = dialog(`<form method="dialog"><div class="dlg-h">Delete call</div>
      <div class="dlg-b"><p>Delete ${esc(c.who)}'s ${DIRECTIONS[c.direction]?.label.toLowerCase() || ''} call on <b>${esc(c.symbol)}</b>
        from ${fmtDate(c.call_date)}? This can't be undone.</p></div>
      <div class="dlg-f"><button value="cancel" class="ghost">Cancel</button><button value="ok" class="danger">Delete</button></div></form>`);
    d.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      if (e.submitter && e.submitter.value === 'ok') { state.calls = state.calls.filter(x => x.id !== id); save(); }
      d.close();
    });
  }

  // ---------- lists ----------
  function rowsHtml(list, opts = {}) {
    return list.slice().sort((a, b) => b.call_date.localeCompare(a.call_date) || (b.created_at || '').localeCompare(a.created_at || ''))
      .map(c => {
        const tracked = !!info(c.symbol);
        return `<tr>
          <td>${fmtDate(c.call_date)}${c.after_close ? ' <span class="dim small" title="Made after the close">(after close)</span>' : ''}</td>
          <td><b>${esc(c.who)}</b>${c.firm ? `<span class="name">${esc(c.firm)}</span>` : ''}</td>
          ${opts.noTicker ? '' : `<td>${tracked ? `<a class="tick" href="${tickerUrl(c.symbol)}">${esc(c.symbol)}</a>` : `<span class="tick">${esc(c.symbol)}</span>`}
            ${c.name ? `<span class="name">${esc(c.name)}</span>` : ''}</td>`}
          <td>${dirBadge(c.direction)}</td>
          <td title="${esc(entryRule(c))}">${entryText(c)}</td>
          <td>${c.target != null ? money(c.target, currencyOf(c.symbol)) : '<span class="dim">–</span>'}</td>
          <td class="call-src">${sourceHtml(c.source)}</td>
          <td class="call-actions"><button class="ghost subtle wl-small" data-call-edit="${esc(c.id)}">Edit</button>
            <button class="ghost subtle wl-small" data-call-del="${esc(c.id)}">Delete</button></td>
        </tr>`;
      }).join('');
  }
  function tableHtml(list, opts = {}) {
    return `<div class="tbl"><table class="plain calls-table"><thead><tr><th>Date</th><th>Who</th>${opts.noTicker ? '' : '<th>Share</th>'}
      <th>Direction</th><th>Entry price</th><th>Target</th><th>Source</th><th></th></tr></thead>
      <tbody>${rowsHtml(list, opts)}</tbody></table></div>`;
  }

  /** The Calls tab on the main page. */
  function renderCallsTab(host, data) {
    latest = data;
    const list = all();
    host.innerHTML = `
      <div class="note">Tag a prediction someone makes about a share: who, which share, bullish or bearish, and when.
        The share's closing price that day is recorded so the call can be judged later. Calls are saved
        <b>in this browser</b> for now.</div>
      <div class="pf-toolbar"><button class="btn" id="calls-tag">Tag a call</button>
        <span class="dim small">${list.length} call${list.length === 1 ? '' : 's'}</span></div>
      ${list.length ? tableHtml(list) : '<p class="dim">No calls yet. Press <b>Tag a call</b>, or use the button on any share\'s page.</p>'}`;
    resolvePending();
  }

  /** The calls section on a share's detail page. */
  function renderForSymbol(host, data, symbol) {
    latest = data;
    const list = forSymbol(symbol);
    host.innerHTML = list.length ? `<h3>Calls on ${esc(symbol)}</h3>${tableHtml(list, {noTicker: true})}` : '';
    host.hidden = !list.length;
    if (list.length) resolvePending();
  }

  // ---------- clicks ----------
  document.addEventListener('click', e => {
    const t = e.target.closest('#calls-tag, [data-call-edit], [data-call-del]');
    if (!t) return;
    if (t.id === 'calls-tag') openTag(null, null);
    else if (t.dataset.callEdit) openTag(null, all().find(x => x.id === t.dataset.callEdit));
    else if (t.dataset.callDel) remove(t.dataset.callDel);
  });

  return {openTag, renderCallsTab, renderForSymbol, forSymbol, setLatest: d => { latest = d; }};
})();

if (typeof module === 'object' && module.exports) module.exports = Calls;
