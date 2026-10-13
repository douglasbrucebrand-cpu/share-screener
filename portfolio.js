// Paper portfolio: simulated buys. Saved in this browser (localStorage) and, if you connect
// one, in your own Google Sheet (see google-sheet/Code.gs). Nothing about trades is ever
// written to the repo or sent anywhere else. Needs common.js and chart.js.
//
// Returns use the dividend-adjusted price history in data/prices/, for both the share
// and its benchmark, so the two are compared like for like (total return).

const Portfolio = (() => {
  const KEY = 'paper_portfolio_v1';
  const SHEET_KEY = 'paper_sheet_v1';        // {url, pass, name, sheetUrl}: this browser only
  const QUEUE_KEY = 'paper_sheet_queue_v1';  // changes not yet saved to the sheet
  const DEFAULT_AMOUNT = {ZAR: 10000, USD: 1000};
  let state = null;
  let storageOK = null;
  let sheetCfg = null, queue = [];
  let sync = {state: 'off', msg: '', at: null};
  let inflight = null, autoTried = false;

  // ---------- storage ----------
  function probe() {
    try { localStorage.setItem('__pf_probe', '1'); localStorage.removeItem('__pf_probe'); return true; }
    catch (e) { return false; }
  }
  function load() {
    if (state) return state;
    storageOK = probe();
    let parsed = null;
    try { parsed = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { parsed = null; }
    state = parsed && Array.isArray(parsed.positions) ? parsed : {version: 1, positions: []};
    sheetCfg = sheetCfg || lsGet(SHEET_KEY);
    queue = lsGet(QUEUE_KEY) || queue;
    if (sheetCfg && sync.state === 'off') sync = {state: queue.length ? 'pending' : 'ok', msg: '', at: null};
    return state;
  }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function saveLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); storageOK = true; }
    catch (e) { storageOK = false; }
  }
  const changed = () => window.dispatchEvent(new Event('portfolio-change'));
  function save() { saveLocal(); changed(); }

  // ---------- Google Sheet ----------
  // Every change is queued, then sent to the sheet. If the sheet can't be reached the change
  // stays queued (in this browser) and is sent next time. The sheet's list is the master copy.
  const SHEET_URL = /^https:\/\/script\.google\.com\/(a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/;
  const LOCAL_TEST_URL = /^http:\/\/(localhost|127\.0\.0\.1):\d+\/exec$/;   // for testing on a computer

  async function api(cfg, body) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 30000);
    let res;
    try {
      // Sent as plain text, which Google's web apps accept from another site without extra checks.
      res = await fetch(cfg.url, {method: 'POST', body: JSON.stringify(Object.assign({}, body, {pass: cfg.pass})), signal: ctl.signal});
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'Google took too long to answer.' :
        "Couldn't reach the sheet. Check you're online, and that the web app's access is set to \"Anyone\".");
    } finally { clearTimeout(timer); }
    let j;
    try { j = JSON.parse(await res.text()); } catch (e) {
      throw new Error("The sheet's web app didn't answer properly. Check it is deployed as a web app with access set to \"Anyone\".");
    }
    if (!j.ok) {
      // An older script doesn't know newer requests (search, watchlist editing, calls).
      if (j.error === 'Unknown action.') {
        throw new Error('Your Google Sheet script is an older version. Paste the latest Code.gs, then Deploy → Manage deployments → pencil → Version: New version → Deploy (README section 11).');
      }
      // Google didn't ask for the "connect to an external service" permission when the script was deployed.
      if (/permission to call UrlFetchApp/i.test(j.error || '')) {
        throw new Error('The script needs one more Google permission. In Apps Script, choose "authorize" in the function menu above the code (paste the latest Code.gs first if it isn\'t there), press Run, then Review permissions → your account → Advanced → Go to … → tick everything → Allow (README section 12).');
      }
      throw new Error(j.error || 'The sheet refused the request.');
    }
    return j;
  }

  function record(op) {
    if (!sheetCfg) return;
    queue.push(op);
    lsSet(QUEUE_KEY, queue);
    flush();
  }

  function flush() {
    if (!sheetCfg) return Promise.resolve();
    if (inflight) return inflight.then(() => (queue.length ? flush() : undefined));
    sync = {state: 'syncing', msg: '', at: sync.at};
    changed();
    inflight = (async () => {
      try {
        for (;;) {
          const ops = queue.slice();
          const j = await api(sheetCfg, {action: 'apply', ops});
          queue = queue.slice(ops.length);
          lsSet(QUEUE_KEY, queue);
          if (!queue.length) {            // nothing new arrived meanwhile: take the sheet's list
            load().positions = (j.positions || []).map(clean).filter(Boolean);
            saveLocal();
            break;
          }
        }
        sync = {state: 'ok', msg: '', at: new Date()};
      } catch (e) {
        sync = {state: queue.length ? 'pending' : 'error', msg: e.message, at: sync.at};
      } finally {
        inflight = null;
        changed();
      }
    })();
    return inflight;
  }

  // Load from the sheet once per page visit.
  function autoSync() {
    load();
    if (sheetCfg && !autoTried) { autoTried = true; flush(); }
  }
  window.addEventListener('online', () => { if (sheetCfg && queue.length) flush(); });

  async function connect() {
    load();
    const n = positions().length;
    const dlg = await modal({
      title: 'Connect Google Sheet', ok: 'Connect',
      html: `<p>Paste the <b>web app address</b> from your sheet's Apps Script and the <b>passphrase</b> you put in the script.
          <a href="https://github.com/douglasbrucebrand-cpu/share-screener#11-saving-trades-to-a-google-sheet" target="_blank" rel="noopener">Setup steps</a></p>
        <label class="field">Web app address
          <input class="txt" name="url" type="url" required autocomplete="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec"></label>
        <label class="field">Passphrase
          <input class="txt" name="pass" type="password" required autocomplete="off"></label>
        ${n ? `<label class="check"><input type="checkbox" name="copy" checked><span>Copy the ${n} trade${n > 1 ? 's' : ''} saved in this browser into the sheet.
          <span class="dim">If unticked, this browser will show only the trades already in the sheet.</span></span></label>` : ''}
        <p class="dim small">Both are saved only in this browser, never on GitHub. Use a passphrase you don't use anywhere else.</p>`,
    });
    if (!dlg) return;
    const url = dlg.querySelector('[name=url]').value.trim(), pass = dlg.querySelector('[name=pass]').value;
    const copy = !!(dlg.querySelector('[name=copy]') || {}).checked;
    if (!SHEET_URL.test(url) && !LOCAL_TEST_URL.test(url)) {
      return toast("That isn't an Apps Script web app address. It should start with https://script.google.com/macros/s/ and end in /exec.");
    }
    sync = {state: 'syncing', msg: 'Connecting…', at: null};
    changed();
    let j;
    try { j = await api({url, pass}, {action: 'ping'}); }
    catch (e) { sync = {state: 'off', msg: '', at: null}; changed(); return toast('Could not connect: ' + esc(e.message)); }
    sheetCfg = {url, pass, name: j.sheet, sheetUrl: j.url};
    lsSet(SHEET_KEY, sheetCfg);
    queue = copy ? positions().map(p => ({op: 'upsert', position: p})) : [];
    lsSet(QUEUE_KEY, queue);
    autoTried = true;
    await flush();
    toast(sync.state === 'ok' ? `Connected to “${esc(j.sheet)}”. Trades are now saved there.` : `Connected, but saving failed: ${esc(sync.msg)}`);
  }

  async function disconnect() {
    const waiting = queue.length;
    const dlg = await modal({title: 'Disconnect Google Sheet', ok: 'Disconnect', danger: !!waiting,
      html: `<p>Stop saving trades to “${esc(sheetCfg.name || 'your sheet')}” from this browser? The sheet itself is not changed,
        and this browser keeps its own copy of the trades.</p>
        ${waiting ? `<p class="warnline">${waiting} change${waiting > 1 ? 's have' : ' has'} not reached the sheet yet and will stay in this browser only.</p>` : ''}`});
    if (!dlg) return;
    sheetCfg = null; queue = [];
    lsSet(SHEET_KEY, null); lsSet(QUEUE_KEY, null);
    sync = {state: 'off', msg: '', at: null};
    changed();
  }

  function sheetBar() {
    if (!sheetCfg) {
      return `<button class="ghost" id="pf-connect"${sync.state === 'syncing' ? ' disabled' : ''}>${sync.state === 'syncing' ? 'Connecting…' : 'Connect Google Sheet'}</button>
        <span class="dim small">Trades are saved in this browser only.</span>`;
    }
    const name = esc(sheetCfg.name || 'your sheet');
    const when = sync.at ? ' &middot; ' + sync.at.toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit'}) : '';
    const text = {
      syncing: `<span class="sync">Saving to Google Sheet “${name}”…</span>`,
      ok: `<span class="sync ok">✓ Saved to Google Sheet “${name}”${when}</span>`,
      pending: `<span class="sync warn">⚠ ${queue.length} change${queue.length === 1 ? '' : 's'} not yet saved to the sheet. Will retry. <span class="dim">${esc(sync.msg)}</span></span>`,
      error: `<span class="sync warn">⚠ Couldn't load from the sheet; showing this browser's copy. <span class="dim">${esc(sync.msg)}</span></span>`,
    }[sync.state] || `<span class="sync">Google Sheet “${name}”</span>`;
    return `${text}
      ${sheetCfg.sheetUrl && /^https:\/\/docs\.google\.com\//.test(sheetCfg.sheetUrl) ? `<a class="small" href="${esc(sheetCfg.sheetUrl)}" target="_blank" rel="noopener">Open sheet</a>` : ''}
      <button class="ghost subtle" id="pf-sync"${sync.state === 'syncing' ? ' disabled' : ''}>Sync now</button>
      <button class="ghost subtle" id="pf-disconnect">Disconnect</button>`;
  }
  const positions = () => load().positions;
  const openFor = sym => positions().filter(p => p.symbol === sym && p.status === 'open');

  // ---------- price files ----------
  const cache = {};
  function prices(sym) {
    if (!sym) return Promise.resolve(null);
    return cache[sym] || (cache[sym] = fetch('data/prices/' + encodeURIComponent(sym) + '.json', {cache: 'no-cache'})
      .then(r => (r.ok ? r.json() : null)).catch(() => null));
  }
  function closeOnOrBefore(px, date) {          // last close on or before a date
    if (!px) return null;
    let i = px.dates.length - 1;
    while (i >= 0 && px.dates[i] > date) i--;
    return i < 0 ? null : {i, date: px.dates[i], close: px.close[i]};
  }

  // ---------- maths ----------
  function stats(p, data, px, bx) {
    const now = data && data.tickers[p.symbol];
    const out = {compNow: now ? now.composite : null, ret: null, bret: null, end: null, series: null};
    if (p.status === 'closed') {
      Object.assign(out, {ret: p.return_pct, bret: p.bench_return_pct, end: p.close_date});
    } else {
      const start = closeOnOrBefore(px, p.buy_date);
      if (start && start.date === p.buy_date) {
        const last = px.close.length - 1;
        out.ret = px.close[last] / start.close - 1;
        out.end = px.dates[last];
        out.lastPrice = px.close[last];
        const b0 = closeOnOrBefore(bx, p.buy_date), b1 = closeOnOrBefore(bx, out.end);
        if (b0 && b1) out.bret = b1.close / b0.close - 1;
        // value over time, and the same amount in the benchmark
        const dates = px.dates.slice(start.i), val = [], ben = [];
        dates.forEach((d, k) => {
          val.push(p.amount * px.close[start.i + k] / start.close);
          const b = b0 && closeOnOrBefore(bx, d);
          ben.push(b ? p.amount * b.close / b0.close : null);
        });
        out.series = {dates, val, ben};
      } else if (now && now.price) {              // no matching price history: fall back to raw prices
        out.ret = now.price / p.buy_price - 1;
        out.end = now.price_date;
        out.lastPrice = now.price;
      }
    }
    out.value = out.ret == null ? null : p.amount * (1 + out.ret);
    return out;
  }

  // ---------- formatting ----------
  const amt = (x, c) => (x < 0 ? '-' : '') + sym(c) + Math.abs(x).toLocaleString('en-GB', {maximumFractionDigits: 0});
  const signedPct = x => (x == null ? DASH : `<span class="${x >= 0 ? 'pos' : 'neg'}">${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%</span>`);
  const pts = x => (x == null ? DASH : `<span class="${x >= 0 ? 'pos' : 'neg'}">${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)} pts</span>`);
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
  const benchName = s => (s ? s.replace(/\.JO$/, '') : '–');

  // ---------- dialogs (no confirm()/prompt(): those are blocked in some embeds) ----------
  function modal({title, html, ok, danger, onOpen}) {
    let dlg = document.getElementById('pf-dialog');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'pf-dialog';
      document.body.appendChild(dlg);
    }
    dlg.innerHTML = `<form method="dialog">
      <div class="dlg-h">${title}</div>
      <div class="dlg-b">${html}</div>
      <div class="dlg-f"><button value="cancel" class="ghost" formnovalidate>Cancel</button>
        <button value="ok" class="${danger ? 'danger' : ''}">${ok}</button></div></form>`;
    return new Promise(resolve => {
      // Act on the button press itself (the dialog's own "close" event can be delayed by the browser).
      dlg.querySelector('form').onsubmit = e => resolve(e.submitter && e.submitter.value === 'ok' ? dlg : null);
      dlg.oncancel = () => resolve(null);          // Esc key
      dlg.onclose = () => resolve(null);           // anything else; ignored if already answered
      dlg.returnValue = '';
      dlg.showModal();
      if (onOpen) onOpen(dlg);
    });
  }
  function toast(html) {
    let t = document.getElementById('pf-toast');
    if (!t) { t = document.createElement('div'); t.id = 'pf-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.innerHTML = html;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 5000);
  }

  // ---------- actions ----------
  async function buy(row, data) {
    if (!row || row.price == null) return;
    const c = row.currency, def = DEFAULT_AMOUNT[c] || 1000;
    const bench = (data.benchmarks || {})[c] || null;
    const dlg = await modal({
      title: `Simulate buy: ${esc(row.symbol)}`,
      ok: 'Record simulated buy',
      html: `<p>Buys at the close of <b>${fmtDate(row.price_date)}</b>: <b>${money(row.price, c)}</b>.
          Composite now <b>${row.composite ?? '–'}</b>.</p>
        <label class="field">Notional amount (${esc(c)})
          <span class="amt"><span>${esc(sym(c).trim() || c)}</span>
          <input name="amount" type="number" inputmode="decimal" min="1" step="any" value="${def}" required></span></label>
        <p class="dim small" id="pf-units"></p>
        <p class="dim small">Compared against ${bench ? esc(benchName(bench)) : 'no benchmark'} over the same period.
          Saved in this browser only.${storageOK === false ? ' <b class="warnline">Storage is blocked here, so this will be lost when the page closes.</b>' : ''}</p>`,
      onOpen: d => {
        const inp = d.querySelector('[name=amount]'), u = d.querySelector('#pf-units');
        const upd = () => { const a = +inp.value; u.textContent = a > 0 ? `= ${(a / row.price).toLocaleString('en-GB', {maximumFractionDigits: 4})} units` : ''; };
        inp.addEventListener('input', upd); upd(); inp.select();
      },
    });
    if (!dlg) return;
    const amount = +dlg.querySelector('[name=amount]').value;
    if (!(amount > 0)) return;
    const bx = await prices(bench), b0 = closeOnOrBefore(bx, row.price_date);
    load();
    state.positions.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      symbol: row.symbol, name: row.name || row.symbol, currency: c,
      buy_date: row.price_date, buy_price: row.price, amount, units: amount / row.price,
      composite_at_buy: row.composite, mom_at_buy: row.mom, fund_at_buy: row.fund,
      benchmark: bench, bench_buy_price: b0 ? b0.close : null,
      created_at: new Date().toISOString(), status: 'open',
    });
    save();
    record({op: 'upsert', position: state.positions[state.positions.length - 1]});
    toast(`Recorded a simulated buy of ${esc(row.symbol)} (${amt(amount, c)})${sheetCfg ? ', saving to your Google Sheet' : ''}.
      <a href="index.html#portfolio">Open paper portfolio</a>`);
  }

  async function close(id, data) {
    const p = positions().find(x => x.id === id);
    if (!p || p.status !== 'open') return;
    const [px, bx] = await Promise.all([prices(p.symbol), prices(p.benchmark)]);
    const s = stats(p, data, px, bx);
    if (s.ret == null) return toast('No current price for this share, so it cannot be closed yet.');
    const dlg = await modal({
      title: `Close ${esc(p.symbol)}`,
      ok: 'Close position',
      html: `<p>Sell at the latest close (<b>${fmtDate(s.end)}</b>${s.lastPrice != null ? `, ${money(s.lastPrice, p.currency)}` : ''}).</p>
        <p>This locks in ${signedPct(s.ret)} (${amt(s.value, p.currency)}) against ${signedPct(s.bret)} for ${esc(benchName(p.benchmark))}.
        The trade then moves to the closed list.</p>`,
    });
    if (!dlg) return;
    Object.assign(p, {status: 'closed', close_date: s.end, close_price: s.lastPrice ?? null,
      return_pct: s.ret, bench_return_pct: s.bret, composite_at_close: s.compNow, closed_at: new Date().toISOString()});
    save();
    record({op: 'upsert', position: p});
  }

  async function remove(id) {
    const p = positions().find(x => x.id === id);
    if (!p) return;
    const dlg = await modal({title: `Delete ${esc(p.symbol)} trade`, ok: 'Delete', danger: true,
      html: `<p>Delete the simulated ${esc(p.symbol)} trade bought on ${fmtDate(p.buy_date)}? This can't be undone unless you have an exported backup.</p>`});
    if (!dlg) return;
    state.positions = state.positions.filter(x => x.id !== id);
    save();
    record({op: 'delete', id});
  }

  function exportFile() {
    const body = JSON.stringify({app: 'share-screener paper portfolio', version: 1,
      exported_at: new Date().toISOString(), positions: positions()}, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], {type: 'application/json'}));
    a.download = `paper-portfolio-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Only known fields of the right type survive an import.
  function clean(p) {
    const num = x => (typeof x === 'number' && isFinite(x) ? x : null);
    const str = (x, n) => (typeof x === 'string' && x.length <= n ? x : null);
    const date = x => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
    const q = {
      id: str(p.id, 40) || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      symbol: str(p.symbol, 20), name: str(p.name, 120), currency: str(p.currency, 5),
      buy_date: date(p.buy_date), buy_price: num(p.buy_price), amount: num(p.amount), units: num(p.units),
      composite_at_buy: num(p.composite_at_buy), mom_at_buy: num(p.mom_at_buy), fund_at_buy: num(p.fund_at_buy),
      benchmark: str(p.benchmark, 20), bench_buy_price: num(p.bench_buy_price),
      created_at: str(p.created_at, 40), status: p.status === 'closed' ? 'closed' : 'open',
    };
    if (q.status === 'closed') Object.assign(q, {close_date: date(p.close_date), close_price: num(p.close_price),
      return_pct: num(p.return_pct), bench_return_pct: num(p.bench_return_pct),
      composite_at_close: num(p.composite_at_close), closed_at: str(p.closed_at, 40)});
    const ok = q.symbol && /^[A-Z0-9.\-=^]+$/i.test(q.symbol) && q.currency && q.buy_date &&
      q.buy_price > 0 && q.amount > 0 && (q.status === 'open' || (q.close_date && q.return_pct != null));
    return ok ? q : null;
  }

  function importFile(file) {
    if (!file) return;
    if (file.size > 2e6) return toast('That file is too big to be a paper-portfolio export.');
    file.text().then(async txt => {
      let j;
      try { j = JSON.parse(txt); } catch (e) { return toast('That file is not valid JSON.'); }
      const list = Array.isArray(j) ? j : j && j.positions;
      if (!Array.isArray(list)) return toast('No trades found in that file.');
      const good = list.map(clean).filter(Boolean);
      if (!good.length) return toast('No valid trades found in that file.');
      const dlg = await modal({title: 'Import paper portfolio', ok: 'Replace with imported trades', danger: true,
        html: `<p>The file has <b>${good.length}</b> valid trade${good.length > 1 ? 's' : ''}${good.length < list.length ? ` (${list.length - good.length} skipped as invalid)` : ''}.</p>
          <p>This replaces the <b>${positions().length}</b> trade${positions().length === 1 ? '' : 's'} currently in this browser${sheetCfg ? ' <b>and in your Google Sheet</b>' : ''}.</p>`});
      if (!dlg) return;
      load(); state.positions = good; save();
      record({op: 'replace', positions: good});
      toast(`Imported ${good.length} trade${good.length > 1 ? 's' : ''}.`);
    });
  }

  // ---------- portfolio tab ----------
  function summary(open, statsById) {
    const by = {};
    for (const p of open) {
      const s = statsById[p.id], g = by[p.currency] || (by[p.currency] = {inv: 0, val: 0, binv: 0, bval: 0, n: 0, missing: 0});
      g.n++;
      g.inv += p.amount;
      if (s.value == null) { g.missing++; g.val += p.amount; } else g.val += s.value;
      if (s.bret != null) { g.binv += p.amount; g.bval += p.amount * (1 + s.bret); }
    }
    return Object.entries(by).map(([c, g]) => `<div class="card pf-sum">
      <div class="lbl">Open positions in ${esc(c)} (${g.n})</div>
      <div class="s ${g.val >= g.inv ? 'pos' : 'neg'}">${signedPct(g.val / g.inv - 1)}</div>
      <div class="small">${amt(g.inv, c)} invested &rarr; <b>${amt(g.val, c)}</b></div>
      <div class="small dim">Benchmarks over the same periods: ${g.binv ? signedPct(g.bval / g.binv - 1) : '–'}</div></div>`).join('');
  }

  function card(p, s) {
    const days = s.end ? daysBetween(p.buy_date, s.end) : null;
    return `<article class="panel pf-card">
      <div class="pf-head">
        <div><a class="tick" href="${tickerUrl(p.symbol)}">${esc(p.symbol)}</a> <span class="name inline">${esc(p.name || '')}</span>
          <div class="small dim">Bought ${fmtDate(p.buy_date)} at ${money(p.buy_price, p.currency)} &middot; ${amt(p.amount, p.currency)}
            &middot; ${(+p.units || p.amount / p.buy_price).toLocaleString('en-GB', {maximumFractionDigits: 4})} units</div></div>
        <div class="pf-ret">${signedPct(s.ret)}<div class="small">${s.value == null ? '' : amt(s.value, p.currency)}</div></div>
      </div>
      <dl class="kv pf-kv">
        <dt>${esc(benchName(p.benchmark))} same period</dt><dd>${signedPct(s.bret)}</dd>
        <dt>vs benchmark</dt><dd>${s.ret != null && s.bret != null ? pts(s.ret - s.bret) : DASH}</dd>
        <dt>Composite bought &rarr; now</dt><dd>${p.composite_at_buy ?? '–'} &rarr; ${s.compNow ?? '–'}</dd>
        <dt>Held</dt><dd>${days == null ? '–' : days + ' day' + (days === 1 ? '' : 's')}</dd>
      </dl>
      <div class="pf-legend"></div>
      <div class="chart pf-chart" data-id="${esc(p.id)}"></div>
      <div class="pf-actions"><button class="ghost" data-close="${esc(p.id)}">Close position</button>
        <button class="ghost subtle" data-del="${esc(p.id)}">Delete</button></div>
    </article>`;
  }

  function closedTable(closed, statsById) {
    if (!closed.length) return '';
    const rows = closed.slice().sort((a, b) => (b.close_date || '').localeCompare(a.close_date || '')).map(p => {
      const s = statsById[p.id];
      return `<tr><td><a class="tick" href="${tickerUrl(p.symbol)}">${esc(p.symbol)}</a></td>
        <td>${fmtDate(p.buy_date)}</td><td>${fmtDate(p.close_date)}</td><td>${daysBetween(p.buy_date, p.close_date)}</td>
        <td>${amt(p.amount, p.currency)}</td><td>${signedPct(s.ret)}</td><td>${amt(p.amount * (1 + s.ret) - p.amount, p.currency)}</td>
        <td>${signedPct(s.bret)} <span class="dim">${esc(benchName(p.benchmark))}</span></td>
        <td>${s.bret != null ? pts(s.ret - s.bret) : DASH}</td>
        <td>${p.composite_at_buy ?? '–'} &rarr; ${p.composite_at_close ?? '–'}</td>
        <td><button class="ghost subtle" data-del="${esc(p.id)}">Delete</button></td></tr>`;
    }).join('');
    return `<h2 class="pf-h2">Closed trades</h2><div class="tbl"><table class="plain">
      <thead><tr><th>Ticker</th><th>Bought</th><th>Sold</th><th>Days</th><th>Amount</th><th>Return</th><th>Gain</th>
        <th>Benchmark</th><th>vs bench</th><th>Composite</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  let lastData = null, lastHost = null;
  async function render(host, data) {
    lastData = data; lastHost = host;
    autoSync();
    const all = positions();
    const needed = [...new Set(all.flatMap(p => [p.symbol, p.benchmark]).filter(Boolean))];
    const files = Object.fromEntries(await Promise.all(needed.map(async s => [s, await prices(s)])));
    if (host !== lastHost) return;   // tab changed while loading
    const statsById = {};
    for (const p of all) statsById[p.id] = stats(p, data, files[p.symbol], files[p.benchmark]);
    const open = all.filter(p => p.status === 'open').sort((a, b) => b.buy_date.localeCompare(a.buy_date));
    const closed = all.filter(p => p.status === 'closed');

    host.innerHTML = `
      <div class="note">Practice trades only. Use <b>Simulate buy</b> on any share to add one.
        ${sheetCfg ? `Trades are saved to <b>your Google Sheet</b>, with a copy in this browser for when the sheet can't be reached.
          Connect the same sheet on your other devices to see the same trades.` :
          `Trades are saved <b>only in this browser</b> &mdash; not on GitHub and not shared. A different browser, device or a Google Sites
          embed keeps its own separate list. <b>Connect Google Sheet</b> to keep one list everywhere, or use <b>Export</b> to back up.`}
        Returns include dividends, for both the share and its benchmark (SPY for US shares, STX40 for JSE shares).</div>
      ${storageOK === false ? (sheetCfg ?
        `<div class="stale"><b>This browser is blocking storage here</b>, so you'll need to connect the sheet again next visit. Your trades are safe in the sheet.</div>` :
        `<div class="stale"><b>This browser is blocking storage here</b>, so trades will be lost when the page closes.
        Open the site directly (not inside an embed), connect a Google Sheet, or export before leaving.</div>`) : ''}
      <div class="pf-toolbar pf-sheet">${sheetBar()}</div>
      <div class="pf-toolbar">
        <button class="ghost" id="pf-export"${all.length ? '' : ' disabled'}>Export</button>
        <button class="ghost" id="pf-import">Import</button>
        <input type="file" id="pf-file" accept="application/json,.json" hidden>
        <span class="dim small">${open.length} open &middot; ${closed.length} closed</span>
      </div>
      ${open.length ? `<div class="topflags">${summary(open, statsById)}</div>
        <div class="pf-grid">${open.map(p => card(p, statsById[p.id])).join('')}</div>` :
        `<p class="dim">No open positions. Press <b>Simulate buy</b> on a share in any tab, or on its detail page.</p>`}
      ${closedTable(closed, statsById)}`;

    host.querySelectorAll('.pf-chart').forEach(el => {
      const p = all.find(x => x.id === el.dataset.id), s = statsById[p.id];
      if (!s.series || s.series.dates.length < 2) {
        el.innerHTML = `<p class="dim small">The value chart starts after the next daily update.</p>`;
        return;
      }
      const series = [
        {name: 'Your position', short: 'You', color: C.value, values: s.series.val, width: 2},
        {name: `Same amount in ${benchName(p.benchmark)}`, short: benchName(p.benchmark), color: C.bench, values: s.series.ben},
      ];
      el.previousElementSibling.innerHTML = legend(series);
      lineChart(el, {
        title: `Value of the ${p.symbol} position over time, against the same amount in ${benchName(p.benchmark)}`,
        dates: s.series.dates, series, height: 190,
        fmtY: (v, st) => sym(p.currency) + v.toLocaleString('en-GB', {maximumFractionDigits: st < 1 ? 2 : 0}),
        tip: i => `<b>${fmtDate(s.series.dates[i])}</b>` + series.map(x =>
          `<div><i style="background:${x.color}"></i>${esc(x.short)}<span>${x.values[i] == null ? '–' : amt(x.values[i], p.currency)}</span></div>`).join(''),
      });
    });
  }

  // one set of listeners for the portfolio tab's buttons
  document.addEventListener('click', e => {
    const t = e.target.closest('#pf-export, #pf-import, #pf-connect, #pf-sync, #pf-disconnect, [data-close], [data-del]');
    if (!t || !lastHost || !lastHost.contains(t)) return;
    if (t.id === 'pf-connect') connect();
    else if (t.id === 'pf-sync') flush();
    else if (t.id === 'pf-disconnect') disconnect();
    else if (t.id === 'pf-export') exportFile();
    else if (t.id === 'pf-import') lastHost.querySelector('#pf-file').click();
    else if (t.dataset.close) close(t.dataset.close, lastData);
    else if (t.dataset.del) remove(t.dataset.del);
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'pf-file') { importFile(e.target.files[0]); e.target.value = ''; }
  });
  window.addEventListener('portfolio-change', () => {
    if (lastHost && lastHost.isConnected && !lastHost.hidden) render(lastHost, lastData);
  });
  // keep tabs in sync if trades change in another window
  window.addEventListener('storage', e => {
    if ([KEY, SHEET_KEY, QUEUE_KEY].includes(e.key)) { state = null; sheetCfg = null; window.dispatchEvent(new Event('portfolio-change')); }
  });

  // Used by watchlist.js: send a request through the connected sheet's script.
  function sheetCall(body) {
    load();
    if (!sheetCfg) return Promise.reject(new Error('Connect your Google Sheet first (Paper portfolio tab).'));
    return api(sheetCfg, body);
  }

  return {buy, openFor, render, autoSync, toast, sheetCall, connected: () => (load(), !!sheetCfg),
    syncState: () => (load(), {connected: !!sheetCfg, state: sync.state, waiting: queue.length, name: sheetCfg && sheetCfg.name}),
    storageBlocked: () => (load(), storageOK === false)};
})();
