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

console.log(`\n${passed} passed`);
