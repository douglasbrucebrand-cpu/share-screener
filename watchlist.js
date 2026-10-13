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

  function openAdd(group) {
    if (!Portfolio.connected()) return needConnection();
    const tab = currentTab();
    const opts = tab.groups.map(g => `<option${g.name === group ? ' selected' : ''}>${esc(g.name)}</option>`).join('');
    const inTab = sym => tab.groups.filter(g => g.tickers.includes(sym)).map(g => g.name);
    const d = dialog(`<form method="dialog" novalidate><div class="dlg-h">Add a share to “${esc(tab.name)}”</div>
      <div class="dlg-b">
        <label class="field">Company name or Yahoo symbol
          <span class="wl-searchrow"><input class="txt" name="q" autocomplete="off" spellcheck="false" placeholder="e.g. MTN, Capitec, Microsoft">
          <button type="button" class="ghost" id="wl-search">Search</button></span></label>
        <div class="wl-results" id="wl-results" role="radiogroup" aria-label="Search results"></div>
        <label class="field">Add to group
          <select class="txt" name="group">${opts}<option value="__new">+ New group…</option></select></label>
        <input class="txt" name="newGroup" placeholder="Name of the new group" maxlength="60" hidden>
        <p class="warnline small wl-error" hidden></p>
      </div>
      <div class="dlg-f"><button value="cancel" class="ghost">Cancel</button><button value="ok" disabled>Add share</button></div></form>`);
    const q = d.querySelector('[name=q]'), results = d.querySelector('#wl-results');
    const sel = d.querySelector('[name=group]'), newGroup = d.querySelector('[name=newGroup]');
    const ok = d.querySelector('[value=ok]');
    const looksLikeSymbol = s => /^\^?[A-Z0-9][A-Z0-9.\-=]{0,14}$/i.test(s.trim());

    function pick() { ok.disabled = busy || !d.querySelector('[name=pick]:checked'); }
    function list(items, note) {
      const typed = q.value.trim().toUpperCase();
      const rows = items.map(x => ({...x, symbol: x.symbol.toUpperCase()}));
      if (looksLikeSymbol(typed) && !rows.some(x => x.symbol === typed)) rows.push({symbol: typed, name: 'Use exactly as typed', exchange: '', typed: true});
      // Only pre-select when there is exactly one choice: with several (MTN vs MTN.JO) you must pick.
      results.innerHTML = (note ? `<p class="dim small">${esc(note)}</p>` : '') + (rows.length ? rows.map(x => {
        const already = inTab(x.symbol);
        return `<label class="wl-result"><input type="radio" name="pick" value="${esc(x.symbol)}"${rows.length === 1 && !already.length ? ' checked' : ''}>
          <span><b>${esc(x.symbol)}</b> <span class="dim">${esc(x.name)}${x.exchange ? ' · ' + esc(x.exchange) : ''}</span>
          ${already.length ? `<span class="warnline small"> already in ${esc(already.join(', '))}</span>` : ''}</span></label>`;
      }).join('') : '<p class="dim small">Nothing found. Try another name, or type the exact Yahoo symbol.</p>');
      pick();
    }
    async function search() {
      const term = q.value.trim();
      if (!term) return;
      results.innerHTML = '<p class="dim small">Searching…</p>';
      try {
        const r = await Portfolio.sheetCall({action: 'search', q: term});
        list(r.results || []);
      } catch (e) {
        list([], e.message);
      }
    }
    d.querySelector('#wl-search').addEventListener('click', search);
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    results.addEventListener('change', pick);
    sel.addEventListener('change', () => { newGroup.hidden = sel.value !== '__new'; if (!newGroup.hidden) newGroup.focus(); });
    q.focus();

    d.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      if (e.submitter && e.submitter.value !== 'ok') return d.close();
      const sym = d.querySelector('[name=pick]:checked')?.value;
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

  return {adopt, barHtml, groupControl, rowControl, isPending: () => !!pending()};
})();
