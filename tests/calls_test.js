// Tests for the analyst-call helpers in calls.js (entry price rule and form checks).
// Run: node tests/calls_test.js   (also run from tests/test_calls_js.py)
const assert = require('assert');
const Calls = require('../calls.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok  ', name); }
  catch (e) { console.log('FAIL', name, '\n     ', e.message); process.exitCode = 1; }
}

// Fri 9 Oct, Mon 12 Oct, Tue 13 Oct 2026 (weekend in between)
const px = {dates: ['2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13'], close: [290, 292.1, 295, 297.5]};

test('a call on a trading day uses that day\'s close', () => {
  assert.deepStrictEqual(Calls.resolveEntry('2026-10-09', false, px), {date: '2026-10-09', price: 292.1});
});
test('a call at the weekend uses the next trading day\'s close', () => {
  assert.deepStrictEqual(Calls.resolveEntry('2026-10-10', false, px), {date: '2026-10-12', price: 295});
  assert.deepStrictEqual(Calls.resolveEntry('2026-10-11', false, px), {date: '2026-10-12', price: 295});
});
test('a call after the close uses the next trading day\'s close', () => {
  assert.deepStrictEqual(Calls.resolveEntry('2026-10-09', true, px), {date: '2026-10-12', price: 295});
});
test('if that close has not happened yet, the entry is pending', () => {
  assert.deepStrictEqual(Calls.resolveEntry('2026-10-13', true, px), {pending: true});
  assert.deepStrictEqual(Calls.resolveEntry('2026-10-14', false, px), {pending: true});
});
test('a share with no prices yet is pending', () => {
  assert.deepStrictEqual(Calls.resolveEntry('2026-10-09', false, null), {pending: true});
});
test('a call older than the price history says so instead of using a later price', () => {
  assert.deepStrictEqual(Calls.resolveEntry('2026-10-01', false, px), {tooOld: true, first: '2026-10-08'});
});

test('a price saved during trading hours is not used as a close', () => {
  // saved 12:22 Johannesburg time on 13 Oct: the 13 Oct JSE price was still moving
  const partial = Object.assign({}, px, {updated_at: '2026-10-13T10:22:03+00:00'});
  assert.deepStrictEqual(Calls.resolveEntry('2026-10-13', false, partial, 'NPN.JO'), {pending: true});
  // earlier days in the same file are fine
  assert.deepStrictEqual(Calls.resolveEntry('2026-10-12', false, partial, 'NPN.JO'), {date: '2026-10-12', price: 295});
  // saved at 18:00 Johannesburg time: final
  const final = Object.assign({}, px, {updated_at: '2026-10-13T16:00:00+00:00'});
  assert.deepStrictEqual(Calls.resolveEntry('2026-10-13', false, final, 'NPN.JO'), {date: '2026-10-13', price: 297.5});
  // a US share saved at 21:00 Johannesburg time (15:00 New York) is still trading
  assert.strictEqual(Calls.isFinal('MU', '2026-10-13', '2026-10-13T19:00:00+00:00'), false);
  assert.strictEqual(Calls.isFinal('MU', '2026-10-13', '2026-10-14T05:00:00+00:00'), true);
});

test('the reason for the entry date is explained', () => {
  assert.strictEqual(Calls.entryRule({call_date: '2026-10-09', entry_date: '2026-10-09'}), 'close on the call date');
  assert.match(Calls.entryRule({call_date: '2026-10-10', entry_date: '2026-10-12'}), /not a trading day/);
  assert.match(Calls.entryRule({call_date: '2026-10-09', entry_date: '2026-10-12', after_close: true}), /after the close/);
  assert.strictEqual(Calls.entryRule({call_date: '2026-10-09'}), '');
});

const good = {who: '  Simon   Brown ', firm: 'Moneyweb', symbol: 'sbk.jo', call_date: '2026-10-13', direction: 'Bullish', target: '1 250.50', source: ' https://www.moneyweb.co.za/x '};
test('a good call is tidied up', () => {
  const {errors, call} = Calls.validate(good, '2026-10-13');
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual([call.who, call.symbol, call.direction, call.target, call.source, call.after_close],
    ['Simon Brown', 'SBK.JO', 'bullish', 1250.5, 'https://www.moneyweb.co.za/x', false]);
});
test('optional fields can be left empty', () => {
  const {errors, call} = Calls.validate({who: 'A', symbol: 'MU', call_date: '2026-10-01', direction: 'neutral'}, '2026-10-13');
  assert.deepStrictEqual([errors, call.firm, call.target, call.source], [[], '', null, '']);
});
test('missing or wrong fields are explained', () => {
  const {errors} = Calls.validate({who: '', symbol: 'not a share!', call_date: '', direction: 'up', target: '-5'}, '2026-10-13');
  assert.strictEqual(errors.length, 5);
});
test('a call date in the future is refused', () => {
  assert.match(Calls.validate(Object.assign({}, good, {call_date: '2026-10-14'}), '2026-10-13').errors[0], /future/);
});
test('only http(s) addresses become links', () => {
  assert.strictEqual(Calls.sourceLink('https://www.moneyweb.co.za/a').hostname, 'www.moneyweb.co.za');
  assert.strictEqual(Calls.sourceLink('javascript:alert(1)'), null);
  assert.strictEqual(Calls.sourceLink('Radio interview'), null);
});

console.log(`\n${passed} passed`);
