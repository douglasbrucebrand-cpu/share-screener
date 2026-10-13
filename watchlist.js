// Editing the watchlist from the website.
// A change goes: this page -> your Apps Script (passphrase) -> watchlists.json on GitHub
// -> the automatic update runs (about 2 minutes) -> the new scores appear here.
// Needs common.js and portfolio.js (which holds the Google Sheet connection).

const Watchlist = (() => {
  const PENDING_KEY = 'watchlist_pending_v1';   // edited lists, shown until the update has run
  const PENDING_MAX = 20 * 60e3;                // give up waiting after 20 minutes
  let editing = false, timer = null, busy = false;

  // ---------- "change on its way" ----------
  function pending() {
    try {
      const p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
      return p && Date.now() - p.at < PENDING_MAX ? p : null;
    } catch (e) { return null; }
  }
  function setPending(tabs) { try { localStorage.setItem(PENDING_KEY, JSON.stringify({tabs, at: Date.now()})); } catch (e) {} }
  function clearPending() { try { localStorage.removeItem(PENDING_KEY); } catch (e) {} }
  const shape = tabs => JSON.stringify(tabs.map(t => [t.id, t.groups.map(g => [g.name, g.tickers])]));

  // Called once latest.json has loaded: if an edit hasn't come through yet, show the edited lists.
  function adopt(data) {
    const p = pending();
    if (!p) return;
    if (shape(data.tabs) === shape(p.tabs)) { clearPending(); return; }
    data.tabs = p.tabs;
    startPolling();
  }

  function startPolling() {
    if (timer) return;
    timer = setInterval(async () => {
      const p = pending();
      if (!p) { stopPolling(); renderTab(); return; }
      try {
        const d = await fetch('data/latest.json', {cache: 'no-cache'}).then(r => r.json());
        if (shape(d.tabs) !== shape(p.tabs)) return;
        clearPending(); stopPolling();
        DATA = d;
        renderStatic(); renderTab();
        Portfolio.toast('The watchlist update has finished: new scores are in.');
      } catch (e) { /* try again next time */ }
    }, 20000);
  }
  function stopPolling() { clearInterval(timer); timer = null; }

  // ---------- pieces drawn into the screener ----------
  function barHtml() {
    const p = pending();
    const wait = p ? `<span class="small wl-wait">⏳ Watchlist change saved. New scores arrive in about 2 minutes.</span>` : '';
    if (!editing) return `<button class="ghost" id="wl-edit">Edit watchlist</button>${wait}`;
    return `<button class="btn" id="wl-done">Done</button>
      <button class="ghost" data-wl-add="">+ Add share</button>
      <span class="dim small">Changes are saved to GitHub; the site updates about 2 minutes later.</span>${wait}`;
  }
  const groupControl = group => (editing ? ` <button class="ghost subtle wl-small" data-wl-add="${esc(group)}">+ Add</button>` : '');
  const rowControl = (group, sym) => (editing
    ? `<button class="wl-remove" data-wl-remove="${esc(sym)}" data-wl-group="${esc(group)}" title="Remove from ${esc(group)}">Remove</button>` : '');

  // ---------- talking to the script ----------
  async function send(body) {
    const tab = currentTab();
    const r = await Portfolio.sheetCall(Object.assign({action: 'watchlist_edit', tab: tab.id}, body));
    if (r.unchanged) { Portfolio.toast(esc(r.message)); return; }
    DATA.tabs = r.tabs;
    setPending(r.tabs);
    renderTab();
    startPolling();
    Portfolio.toast(`${esc(r.message)} New scores arrive in about 2 minutes.`);
  }
  const currentTab = () => DATA.tabs.find(t => t.id === activeTab) || DATA.tabs[0];

  // ---------- dialogs ----------
  function dialog(html) {
    let d = document.getElementById('wl-dialog');
    if (!d) { d = document.createElement('dialog'); d.id = 'wl-dialog'; document.body.appendChild(d); }
    d.innerHTML = html;
    d.showModal();
    d.querySelector('[value=cancel]')?.addEventListener('click', e => { e.preventDefault(); d.close(); });
    return d;
  }
  function setBusy(d, on, label) {
    busy = on;
    const ok = d.querySelector('[value=ok]');
    if (ok) { ok.disabled = on; if (label) ok.textContent = label; }
  }
  function showError(d, msg) {
    const el = d.querySelector('.wl-error');
    el.textContent = msg; el.hidden = false;
  }

  function needConnection() {
    dialog(`<form method="dialog"><div class="dlg-h">Edit the watchlist</div>
      <div class="dlg-b"><p>Editing the watchlist from the website works through your Google Sheet connection, which
        also needs a GitHub key added to the script. It's a one-time setup of about 5 minutes.</p>
        <p><a href="https://github.com/douglasbrucebrand-cpu/share-screener#12-editing-the-watchlist-from-the-website" target="_blank" rel="noopener">Setup steps (README section 12)</a></p>
        <p class="dim small">Then connect your sheet on the <a href="index.html#portfolio">Paper portfolio</a> tab, if you haven't already.</p></div>
      <div class="dlg-f"><button value="cancel" class="ghost">Close</button></div></form>`);
  }

  // A search box for picking a share by company name or symbol, drawn into `root`.
  // Used by the watchlist editor and by calls.js. opts.note(symbol) adds a warning to a result;
  // opts.onChange(selected) runs whenever the choice changes.
  function symbolPicker(root, opts = {}) {
    root.innerHTML = `<label class="field">Company name or Yahoo symbol
        <span class="wl-searchrow"><input class="txt" name="q" autocomplete="off" spellcheck="false" placeholder="e.g. MTN, Capitec, Microsoft">
        <button type="button" class="ghost" data-sp-search>Search</button></span></label>
      <div class="wl-results" role="radiogroup" aria-label="Search results"></div>`;
    const q = root.querySelector('[name=q]'), results = root.querySelector('.wl-results');
    const looksLikeSymbol = s => /^\^?[A-Z0-9][A-Z0-9.\-=]{0,14}$/i.test(s.trim());
    let rows = [];
    const selected = () => {
      const v = root.querySelector('[name=pick]:checked')?.value;
      return v ? rows.find(r => r.symbol === v) || null : null;
    };
    const changed = () => opts.onChange && opts.onChange(selected());
    function list(items, note) {
      const typed = q.value.trim().toUpperCase();
      rows = items.map(x => ({...x, symbol: x.symbol.toUpperCase()}));
      if (looksLikeSymbol(typed) && !rows.some(x => x.symbol === typed)) {
        rows.push({symbol: typed, exchange: '', typed: true,
          name: 'Use exactly as typed: not checked, so make sure this is the exact Yahoo symbol (Sasol, for example, is SOL.JO)'});
      }
      // Only pre-select when there is exactly one real search result. Never pre-select a typed symbol:
      // "MTN" typed is Vail Resorts in New York, not MTN Group (MTN.JO), so you must choose it yourself.
      results.innerHTML = (note ? `<p class="dim small">${esc(note)}</p>` : '') + (rows.length ? rows.map(x => {
        const warn = opts.note ? opts.note(x.symbol) : '';
        return `<label class="wl-result"><input type="radio" name="pick" value="${esc(x.symbol)}"${rows.length === 1 && !warn && !x.typed ? ' checked' : ''}>
          <span><b>${esc(x.symbol)}</b> <span class="dim">${esc(x.name)}${x.exchange ? ' · ' + esc(x.exchange) : ''}</span>
          ${warn ? `<span class="warnline small"> ${esc(warn)}</span>` : ''}</span></label>`;
      }).join('') : '<p class="dim small">Nothing found. Try another name, or type the exact Yahoo symbol.</p>');
      changed();
    }
    async function search() {
      const term = q.value.trim();
      if (!term) return;
      if (!Portfolio.connected()) {
        return list([], 'Searching by company name needs your Google Sheet connected. You can still type the exact Yahoo symbol, e.g. SBK.JO.');
      }
      results.innerHTML = '<p class="dim small">Searching…</p>';
      try {
        const r = await Portfolio.sheetCall({action: 'search', q: term});
        list(r.results || []);
      } catch (e) {
        list([], e.message);
      }
    }
    root.querySelector('[data-sp-search]').addEventListener('click', search);
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    results.addEventListener('change', changed);
    return {selected, focus: () => q.focus()};
  }

  function openAdd(group) {
    if (!Portfolio.connected()) return needConnection();
    const tab = currentTab();
    const opts = tab.groups.map(g => `<option${g.name === group ? ' selected' : ''}>${esc(g.name)}</option>`).join('');
    const inTab = sym => tab.groups.filter(g => g.tickers.includes(sym)).map(g => g.name);
    const d = dialog(`<form method="dialog" novalidate><div class="dlg-h">Add a share to “${esc(tab.name)}”</div>
      <div class="dlg-b">
        <div class="sp"></div>
        <label class="field">Add to group
          <select class="txt" name="group">${opts}<option value="__new">+ New group…</option></select></label>
        <input class="txt" name="newGroup" placeholder="Name of the new group" maxlength="60" hidden>
        <p class="warnline small wl-error" hidden></p>
      </div>
      <div class="dlg-f"><button value="cancel" class="ghost">Cancel</button><button value="ok" disabled>Add share</button></div></form>`);
    const sel = d.querySelector('[name=group]'), newGroup = d.querySelector('[name=newGroup]');
    const ok = d.querySelector('[value=ok]');
    const picker = symbolPicker(d.querySelector('.sp'), {
      note: sym => { const g = inTab(sym); return g.length ? 'already in ' + g.join(', ') : ''; },
      onChange: pick,
    });
    function pick() { ok.disabled = busy || !picker.selected(); }
    sel.addEventListener('change', () => { newGroup.hidden = sel.value !== '__new'; if (!newGroup.hidden) newGroup.focus(); });
    picker.focus();

    d.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      if (e.submitter && e.submitter.value !== 'ok') return d.close();
      const sym = picker.selected()?.symbol;
      const isNew = sel.value === '__new';
      if (!sym) return;
      if (isNew && !newGroup.value.trim()) return showError(d, 'Type a name for the new group.');
      setBusy(d, true, 'Saving…');
      try {
        await send(isNew ? {add: sym, newGroup: newGroup.value.trim()} : {add: sym, group: sel.value});
        d.close();
      } catch (err) {
        showError(d, err.message);
      } finally { setBusy(d, false, 'Add share'); pick(); }
    });
  }

  function openRemove(sym, group) {
    if (!Portfolio.connected()) return needConnection();
    const d = dialog(`<form method="dialog"><div class="dlg-h">Remove ${esc(sym)}</div>
      <div class="dlg-b"><p>Remove <b>${esc(sym)}</b> from “${esc(group)}”? Its past scores are kept, and you can add it back at any time.</p>
        <p class="warnline small wl-error" hidden></p></div>
      <div class="dlg-f"><button value="cancel" class="ghost">Cancel</button><button value="ok" class="danger">Remove</button></div></form>`);
    d.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      if (e.submitter && e.submitter.value !== 'ok') return d.close();
      setBusy(d, true, 'Removing…');
      try { await send({remove: sym, group}); d.close(); }
      catch (err) { showError(d, err.message); }
      finally { setBusy(d, false, 'Remove'); }
    });
  }

  // ---------- clicks ----------
  document.addEventListener('click', e => {
    const t = e.target.closest('#wl-edit, #wl-done, [data-wl-add], [data-wl-remove]');
    if (!t || !document.getElementById('groups')?.closest('main')?.contains(t)) return;
    if (t.id === 'wl-edit') { if (!Portfolio.connected()) return needConnection(); editing = true; renderTab(); }
    else if (t.id === 'wl-done') { editing = false; renderTab(); }
    else if ('wlAdd' in t.dataset) openAdd(t.dataset.wlAdd);
    else if (t.dataset.wlRemove) openRemove(t.dataset.wlRemove, t.dataset.wlGroup);
  });

  return {adopt, barHtml, groupControl, rowControl, symbolPicker, isPending: () => !!pending()};
})();
