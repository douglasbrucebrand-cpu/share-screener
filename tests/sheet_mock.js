// A small stand-in for Google Sheets + Apps Script, so google-sheet/Code.gs can be tested
// on a computer without a Google account. Only the parts Code.gs uses are imitated.
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

function makeEnv() {
  const sheets = {};
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
    Utilities: {
      sleep() {},
      formatDate: (d, tz, fmt) => (fmt.includes('HH') ? d.toISOString().slice(0, 19) : d.toISOString().slice(0, 10)),
    },
    ContentService: {
      MimeType: {JSON: 'application/json'},
      createTextOutput: s => ({content: s, setMimeType() { return this; }, getContent() { return s; }}),
    },
    sheets,
  };
  return env;
}

// Load Code.gs, optionally swapping in a passphrase. Returns {call(body), get(), sheets}.
function load(codePath, passphrase) {
  let src = fs.readFileSync(codePath, 'utf8');
  if (passphrase != null) src = src.replace(/const PASSPHRASE = '[^']*';/, `const PASSPHRASE = ${JSON.stringify(passphrase)};`);
  const env = makeEnv();
  const ctx = vm.createContext({...env, console, JSON, Date, Math, Number, String, Array, Object, isFinite});
  vm.runInContext(src + '\n;this.__doPost = doPost; this.__doGet = doGet;', ctx);
  return {
    call: body => JSON.parse(ctx.__doPost({postData: {contents: typeof body === 'string' ? body : JSON.stringify(body)}}).getContent()),
    get: () => JSON.parse(ctx.__doGet().getContent()),
    sheets: env.sheets,
  };
}

module.exports = {load};
