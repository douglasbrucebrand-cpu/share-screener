// A small stand-in for Google Sheets + Apps Script (and the GitHub and Yahoo services the
// script calls), so google-sheet/Code.gs can be tested on a computer without any accounts.
// Only the parts Code.gs uses are imitated.
// Like real Sheets, a date-looking string typed into a cell that is NOT formatted as
// plain text ('@') turns into a Date, so the tests catch formatting mistakes.
const fs = require('fs');
const vm = require('vm');

class Sheet {
  constructor(name) { this.name = name; this.v = []; this.f = []; }
  cell(grid, r, c) { return (grid[r - 1] || [])[c - 1]; }
  put(grid, r, c, x) { (grid[r - 1] = grid[r - 1] || [])[c - 1] = x; }
  getLastRow() {
    for (let r = this.v.length; r >= 1; r--) if ((this.v[r - 1] || []).some(x => x !== '' && x != null)) return r;
    return 0;
  }
  getLastColumn() {
    let m = 0;
    this.v.forEach(row => (row || []).forEach((x, i) => { if (x !== '' && x != null) m = Math.max(m, i + 1); }));
    return m;
  }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  setFrozenRows() {}
  deleteRow(r) { this.v.splice(r - 1, 1); this.f.splice(r - 1, 1); }
}

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, {sh, r, c, nr, nc}); }
  each(fn) { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(fn(this.r + i, this.c + j, i, j)); out.push(row); } return out; }
  getValues() { return this.each((r, c) => { const x = this.sh.cell(this.sh.v, r, c); return x == null ? '' : x; }); }
  getNumberFormats() { return this.each((r, c) => this.sh.cell(this.sh.f, r, c) || 'General'); }
  setNumberFormats(fm) { this.each((r, c, i, j) => this.sh.put(this.sh.f, r, c, fm[i][j])); return this; }
  setValues(vals) {
    if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error('setValues: size mismatch');
    this.each((r, c, i, j) => {
      let x = vals[i][j];
      const fmt = this.sh.cell(this.sh.f, r, c);
      if (typeof x === 'string' && fmt !== '@' && /^\d{4}-\d{2}-\d{2}/.test(x)) x = new Date(x);   // Sheets' auto-convert
      this.sh.put(this.sh.v, r, c, x);
    });
    return this;
  }
  setFontWeight() { return this; }
  clearContent() { this.each((r, c) => this.sh.put(this.sh.v, r, c, '')); return this; }
}

// Pretend GitHub "contents" API holding one file, and a pretend Yahoo search.
function fakeServices(opts) {
  const gh = {text: opts.watchlist || '{"tabs": []}\n', sha: 'sha0', n: 0, puts: [], getCode: 200, putCode: null, conflictOnce: false};
  const yahoo = {down: false, quotes: {
    mtn: [{symbol: 'MTN', shortname: 'Vail Resorts, Inc.', exchDisp: 'NYSE', quoteType: 'EQUITY'},
          {symbol: 'MTN=F', shortname: 'Micro Ultra 10-Year', exchDisp: 'CBOT', quoteType: 'FUTURE'},
          {symbol: 'MTN.JO', shortname: 'MTN Group Ltd', exchDisp: 'Johannesburg Stock Exchange', quoteType: 'EQUITY'}],
  }};
  const resp = (code, body) => ({getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body))});
  function fetch(url, o = {}) {
    if (url.startsWith('https://query2.finance.yahoo.com/v1/finance/search')) {
      if (yahoo.down) return resp(503, '<html>Service unavailable</html>');
      const q = decodeURIComponent(url.split('q=')[1] || '').toLowerCase();
      return resp(200, {quotes: yahoo.quotes[q] || []});
    }
    if (url.startsWith('https://api.github.com/repos/')) {
      if ((o.headers || {}).Authorization !== 'Bearer ' + opts.token) return resp(401, {message: 'Bad credentials'});
      if ((o.method || 'get') === 'get') {
        if (gh.getCode !== 200) return resp(gh.getCode, {message: 'nope'});
        const b64 = Buffer.from(gh.text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');
        return resp(200, {content: b64, sha: gh.sha});
      }
      const body = JSON.parse(o.payload);
      if (gh.putCode) return resp(gh.putCode, {message: 'nope'});
      if (gh.conflictOnce) { gh.conflictOnce = false; gh.sha = 'sha-other'; return resp(409, {message: 'conflict'}); }
      if (body.sha !== gh.sha) return resp(409, {message: 'sha mismatch'});
      gh.text = Buffer.from(body.content, 'base64').toString('utf8');
      gh.sha = 'sha' + (++gh.n);
      gh.puts.push(body.message);
      return resp(200, {commit: {html_url: 'https://github.com/x/commit/' + gh.sha}});
    }
    throw new Error('unexpected fetch ' + url);
  }
  return {gh, yahoo, fetch};
}

function makeEnv(opts = {}) {
  const sheets = {};
  const services = fakeServices(opts);
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = new Sheet(n)),
    getName: () => 'Paper portfolio',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST/edit',
    getSpreadsheetTimeZone: () => 'Africa/Johannesburg',
  };
  const env = {
    SpreadsheetApp: {getActive: () => ss},
    LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
    PropertiesService: {getScriptProperties: () => ({getProperty: k => (k === 'GITHUB_TOKEN' ? opts.token || null : null)})},
    UrlFetchApp: {fetch: services.fetch},
    Utilities: {
      sleep() {},
      formatDate: (d, tz, fmt) => (fmt.includes('HH') ? d.toISOString().slice(0, 19) : d.toISOString().slice(0, 10)),
      Charset: {UTF_8: 'UTF-8'},
      base64Encode: s => Buffer.from(s, 'utf8').toString('base64'),
      base64Decode: s => Buffer.from(s, 'base64'),
      newBlob: bytes => ({getDataAsString: () => Buffer.from(bytes).toString('utf8')}),
    },
    ContentService: {
      MimeType: {JSON: 'application/json'},
      createTextOutput: s => ({content: s, setMimeType() { return this; }, getContent() { return s; }}),
    },
    sheets,
    services,
  };
  return env;
}

// Load Code.gs, optionally swapping in a passphrase.
// opts: {token: pretend GitHub key in Script Properties, watchlist: starting watchlists.json text}
// Returns {call(body), get(), sheets, gh, yahoo, format(obj)}.
function load(codePath, passphrase, opts = {}) {
  let src = fs.readFileSync(codePath, 'utf8');
  if (passphrase != null) src = src.replace(/const PASSPHRASE = '[^']*';/, `const PASSPHRASE = ${JSON.stringify(passphrase)};`);
  const env = makeEnv(opts);
  const ctx = vm.createContext({...env, console, JSON, Date, Math, Number, String, Array, Object, isFinite, encodeURIComponent});
  vm.runInContext(src + '\n;this.__doPost = doPost; this.__doGet = doGet; this.__format = formatWatchlists;', ctx);
  return {
    call: body => JSON.parse(ctx.__doPost({postData: {contents: typeof body === 'string' ? body : JSON.stringify(body)}}).getContent()),
    get: () => JSON.parse(ctx.__doGet().getContent()),
    sheets: env.sheets,
    gh: env.services.gh,
    yahoo: env.services.yahoo,
    format: obj => ctx.__format(JSON.parse(JSON.stringify(obj))),
  };
}

module.exports = {load};
