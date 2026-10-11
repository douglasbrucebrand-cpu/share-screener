// Shared by the screener (app.js) and the ticker detail page (ticker.js).
const CCY = {USD: '$', ZAR: 'R', EUR: '€', GBP: '£'};
const $ = id => document.getElementById(id);

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
    (x < 0 ? '-' : '') + sym(c) + Math.abs(x).toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}
function bigMoney(x, c) {
  if (x == null) return DASH;
  const a = Math.abs(x), s = (x < 0 ? '-' : '') + sym(c);
  if (a >= 1e12) return s + (a / 1e12).toFixed(2) + 'tn';
  if (a >= 1e9) return s + (a / 1e9).toFixed(a >= 1e11 ? 0 : 1) + 'bn';
  return s + (a / 1e6).toFixed(0) + 'm';
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

// Link to a ticker's detail page.
const tickerUrl = s => 'ticker.html?s=' + encodeURIComponent(s);
