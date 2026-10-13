// Tests for google-sheet/Code.gs against the stand-in in sheet_mock.js.
// Run: node tests/sheet_script_test.js   (also run from tests/test_sheet_script.py)
const assert = require('assert');
const path = require('path');
const {load} = require('./sheet_mock');

const CODE = path.join(__dirname, '..', 'google-sheet', 'Code.gs');
const PASS = 'test-phrase-123';
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok  ', name); }
  catch (e) { console.log('FAIL', name, '\n     ', e.message); process.exitCode = 1; }
}

const trade = (id, extra = {}) => Object.assign({
  id, status: 'open', symbol: 'NPN.JO', name: 'Naspers Ltd -N-', currency: 'ZAR',
  buy_date: '2026-10-09', buy_price: 721.69, amount: 10000, units: 13.856, composite_at_buy: 52,
  mom_at_buy: 20, fund_at_buy: 100, benchmark: 'STX40.JO', bench_buy_price: 102.59,
  created_at: '2026-10-11T19:20:00.000Z',
}, extra);

test('refuses to work until the example passphrase is changed', () => {
  const s = load(CODE);   // as shipped: CHANGE-ME
  const r = s.call({pass: 'CHANGE-ME', action: 'ping'});
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /example passphrase/);
});

test('wrong or missing passphrase is refused and nothing is written', () => {
  const s = load(CODE, PASS);
  assert.strictEqual(s.call({pass: 'nope', action: 'apply', ops: [{op: 'upsert', position: trade('a')}]}).ok, false);
  assert.strictEqual(s.call({action: 'ping'}).ok, false);
  assert.strictEqual(s.call('not json').ok, false);
  assert.strictEqual(Object.keys(s.sheets).length, 0);
});

test('ping creates the Trades tab with headings', () => {
  const s = load(CODE, PASS);
  const r = s.call({pass: PASS, action: 'ping'});
  assert.deepStrictEqual([r.ok, r.sheet, r.count], [true, 'Paper portfolio', 0]);
  const head = s.sheets.Trades.getRange(1, 1, 1, 21).getValues()[0];
  assert.strictEqual(head[0], 'Trade ID');
  assert.strictEqual(head[2], 'Ticker');
});

test('a trade round-trips exactly, dates stay as text', () => {
  const s = load(CODE, PASS);
  const r = s.call({pass: PASS, action: 'apply', ops: [{op: 'upsert', position: trade('a')}]});
  assert.ok(r.ok);
  const p = r.positions[0];
  assert.strictEqual(p.buy_date, '2026-10-09');
  assert.strictEqual(p.created_at, '2026-10-11T19:20:00.000Z');
  assert.strictEqual(p.buy_price, 721.69);
  assert.strictEqual(p.close_date, null);
  const cell = s.sheets.Trades.getRange(2, 6).getValues()[0][0];
  assert.strictEqual(typeof cell, 'string', 'Bought on must be stored as text, not turned into a date');
});

test('updating a trade replaces its row (closing a position)', () => {
  const s = load(CODE, PASS);
  s.call({pass: PASS, action: 'apply', ops: [{op: 'upsert', position: trade('a')}, {op: 'upsert', position: trade('b')}]});
  const r = s.call({pass: PASS, action: 'apply', ops: [{op: 'upsert', position: trade('a', {
    status: 'closed', close_date: '2026-11-02', close_price: 760, return_pct: 0.053, bench_return_pct: 0.01, composite_at_close: 61})}]});
  assert.strictEqual(r.positions.length, 2);
  const a = r.positions.find(p => p.id === 'a');
  assert.deepStrictEqual([a.status, a.close_date, a.return_pct], ['closed', '2026-11-02', 0.053]);
});

test('delete removes only that trade', () => {
  const s = load(CODE, PASS);
  s.call({pass: PASS, action: 'apply', ops: [{op: 'upsert', position: trade('a')}, {op: 'upsert', position: trade('b')}]});
  const r = s.call({pass: PASS, action: 'apply', ops: [{op: 'delete', id: 'a'}]});
  assert.deepStrictEqual(r.positions.map(p => p.id), ['b']);
});

test('replace swaps the whole list', () => {
  const s = load(CODE, PASS);
  s.call({pass: PASS, action: 'apply', ops: [{op: 'upsert', position: trade('a')}, {op: 'upsert', position: trade('b')}]});
  const r = s.call({pass: PASS, action: 'apply', ops: [{op: 'replace', positions: [trade('c'), trade('d')]}]});
  assert.deepStrictEqual(r.positions.map(p => p.id), ['c', 'd']);
});

test('an empty apply just lists the trades', () => {
  const s = load(CODE, PASS);
  s.call({pass: PASS, action: 'apply', ops: [{op: 'upsert', position: trade('a')}]});
  assert.deepStrictEqual(s.call({pass: PASS, action: 'apply', ops: []}).positions.map(p => p.id), ['a']);
});

test('unknown fields are dropped, junk numbers blanked, incomplete trades ignored', () => {
  const s = load(CODE, PASS);
  const r = s.call({pass: PASS, action: 'apply', ops: [
    {op: 'upsert', position: trade('a', {evil: '=IMPORTXML()', amount: 'lots', status: 'weird'})},
    {op: 'upsert', position: {id: 'x', symbol: 'MU'}},   // no buy date
  ]});
  assert.strictEqual(r.positions.length, 1);
  const p = r.positions[0];
  assert.strictEqual('evil' in p, false);
  assert.strictEqual(p.amount, null);
  assert.strictEqual(p.status, 'open');
});

test('your own extra columns are kept when a trade is updated', () => {
  const s = load(CODE, PASS);
  s.call({pass: PASS, action: 'apply', ops: [{op: 'upsert', position: trade('a')}]});
  const sh = s.sheets.Trades;
  sh.getRange(1, 22).setValues([['My notes']]);
  sh.getRange(2, 22).setValues([['bought on the dip']]);
  s.call({pass: PASS, action: 'apply', ops: [{op: 'upsert', position: trade('a', {amount: 5000})}]});
  assert.strictEqual(sh.getRange(2, 22).getValues()[0][0], 'bought on the dip');
  assert.strictEqual(sh.getRange(2, 8).getValues()[0][0], 5000);
});

test('columns are found by heading, even if you reorder them', () => {
  const s = load(CODE, PASS);
  s.call({pass: PASS, action: 'apply', ops: [{op: 'upsert', position: trade('a')}]});
  const sh = s.sheets.Trades;
  // swap the Ticker and Company columns (headings and data)
  const v = sh.getRange(1, 1, 2, 21).getValues();
  for (const row of v) [row[2], row[3]] = [row[3], row[2]];
  sh.getRange(1, 1, 2, 21).setValues(v);
  const r = s.call({pass: PASS, action: 'apply', ops: []});
  assert.deepStrictEqual([r.positions[0].symbol, r.positions[0].name], ['NPN.JO', 'Naspers Ltd -N-']);
});

test('opening the web app address in a browser says it is working', () => {
  assert.strictEqual(load(CODE, PASS).get().ok, true);
});

// ---------- watchlist editing ----------
const fs = require('fs');
const REAL = fs.readFileSync(path.join(__dirname, '..', 'watchlists.json'), 'utf8');
const TOKEN = 'fake-github-key';
const withGH = (opts = {}) => load(CODE, PASS, Object.assign({token: TOKEN, watchlist: REAL}, opts));
const edit = (s, body) => s.call(Object.assign({pass: PASS, action: 'watchlist_edit'}, body));
const tickers = (s, tab, group) => JSON.parse(s.gh.text).tabs.find(t => t.id === tab).groups.find(g => g.name === group).tickers;

test('rewriting the real watchlists.json without changes gives the identical file', () => {
  assert.strictEqual(withGH().format(JSON.parse(REAL)), REAL);
});

test('ping reports whether watchlist editing is set up', () => {
  assert.strictEqual(withGH().call({pass: PASS, action: 'ping'}).watchlistEditing, true);
  assert.strictEqual(load(CODE, PASS).call({pass: PASS, action: 'ping'}).watchlistEditing, false);
});

test('adding a share saves it to GitHub, at the end of the group, with a clear commit message', () => {
  const s = withGH();
  const r = edit(s, {tab: 'my-watchlist', group: 'JSE', add: 'mtn.jo'});
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(tickers(s, 'my-watchlist', 'JSE').slice(-2), ['ABG.JO', 'MTN.JO']);
  assert.deepStrictEqual(s.gh.puts, ['Watchlist: add MTN.JO to My watchlist / JSE (from the website)']);
  assert.ok(r.tabs.find(t => t.id === 'my-watchlist').groups[0].tickers.includes('MTN.JO'));
  assert.strictEqual(r.message, 'Added MTN.JO to My watchlist / JSE.');
  // only that one line of the file changed
  const before = REAL.split('\n'), after = s.gh.text.split('\n');
  assert.strictEqual(after.length, before.length);
  assert.strictEqual(after.filter((l, i) => l !== before[i]).length, 1);
});

test('adding a share that is already there changes nothing', () => {
  const s = withGH();
  const r = edit(s, {tab: 'my-watchlist', group: 'JSE', add: 'NPN.JO'});
  assert.deepStrictEqual([r.ok, r.unchanged, s.gh.puts.length], [true, true, 0]);
});

test('a new group can be created while adding', () => {
  const s = withGH();
  assert.ok(edit(s, {tab: 'my-watchlist', newGroup: '  US  ideas ', add: 'MSFT'}).ok);
  assert.deepStrictEqual(tickers(s, 'my-watchlist', 'US ideas'), ['MSFT']);
});

test('removing a share takes it out of that group only', () => {
  const s = withGH();
  assert.ok(edit(s, {tab: 'tech-growth', group: 'Foundry', remove: 'TSM'}).ok);
  assert.ok(!tickers(s, 'tech-growth', 'Foundry').includes('TSM'));
  assert.ok(tickers(s, 'tech-growth', 'Logic & processors').includes('TSM'));
});

test('removing the last share of a group removes the group, but a tab can never be emptied', () => {
  const s = withGH();
  for (const t of ['MU', 'WDC', 'STX']) assert.ok(edit(s, {tab: 'tech-growth', group: 'Memory & storage', remove: t}).ok);
  assert.ok(!JSON.parse(s.gh.text).tabs[0].groups.some(g => g.name === 'Memory & storage'));
  const s2 = withGH({watchlist: '{"tabs": [{"id": "a", "name": "A", "groups": [{"name": "G", "tickers": ["X"]}]}]}\n'});
  const r = edit(s2, {tab: 'a', group: 'G', remove: 'X'});
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /last share/);
});

test('every edited file still passes the pipeline\'s own checks', () => {
  const s = withGH();
  edit(s, {tab: 'my-watchlist', group: 'JSE', add: 'MTN.JO'});
  edit(s, {tab: 'my-watchlist', newGroup: 'US ideas', add: 'BRK-B'});
  edit(s, {tab: 'tech-growth', group: 'Foundry', remove: 'UMC'});
  if (process.env.WL_OUT) fs.writeFileSync(process.env.WL_OUT, s.gh.text);   // checked by test_sheet_script.py
  JSON.parse(s.gh.text);
});

test('bad symbols, unknown tabs and wrong passphrases are refused', () => {
  const s = withGH();
  assert.match(edit(s, {tab: 'my-watchlist', group: 'JSE', add: 'NOT A SYMBOL!'}).error, /doesn't look like/);
  assert.match(edit(s, {tab: 'nope', group: 'JSE', add: 'MTN.JO'}).error, /no longer exists/);
  assert.strictEqual(s.call({pass: 'wrong', action: 'watchlist_edit', tab: 'my-watchlist', group: 'JSE', add: 'MTN.JO'}).ok, false);
  assert.strictEqual(s.gh.puts.length, 0);
});

test('missing, wrong or under-powered GitHub keys give plain messages', () => {
  assert.match(edit(load(CODE, PASS, {watchlist: REAL}), {tab: 'my-watchlist', group: 'JSE', add: 'MTN.JO'}).error, /no GitHub key/);
  const wrong = load(CODE, PASS, {token: TOKEN, watchlist: REAL});
  wrong.gh.getCode = 401;
  assert.match(edit(wrong, {tab: 'my-watchlist', group: 'JSE', add: 'MTN.JO'}).error, /wrong or has expired/);
  const weak = withGH(); weak.gh.putCode = 403;
  assert.match(edit(weak, {tab: 'my-watchlist', group: 'JSE', add: 'MTN.JO'}).error, /not allowed/);
});

test('if someone else saves at the same moment, the change is redone on the newer file', () => {
  const s = withGH(); s.gh.conflictOnce = true;
  assert.ok(edit(s, {tab: 'my-watchlist', group: 'JSE', add: 'MTN.JO'}).ok);
  assert.strictEqual(s.gh.puts.length, 1);
});

test('a typo in watchlists.json on GitHub is reported, not overwritten', () => {
  const s = withGH({watchlist: '{"tabs": [ broken'});
  assert.match(edit(s, {tab: 'a', group: 'G', add: 'MU'}).error, /typo/);
  assert.strictEqual(s.gh.puts.length, 0);
});

test('search finds shares and funds by name, showing the exchange, and skips futures', () => {
  const s = withGH();
  const r = s.call({pass: PASS, action: 'search', q: 'MTN'});
  assert.deepStrictEqual(r.results.map(x => `${x.symbol} ${x.exchange}`), ['MTN NYSE', 'MTN.JO Johannesburg Stock Exchange']);
  s.yahoo.down = true;
  assert.match(s.call({pass: PASS, action: 'search', q: 'MTN'}).error, /isn't answering/);
  assert.strictEqual(s.call({pass: 'wrong', action: 'search', q: 'MTN'}).ok, false);
});

console.log(`\n${passed} passed`);
