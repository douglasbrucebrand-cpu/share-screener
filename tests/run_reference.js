// Runs the original JavaScript scoring on cases read from stdin and prints the results.
// Input:  {cases:[{id, closes:[...], volumes:[...], income:[{rev,gp,ni}]|null}], grid:true|false}
// Missing numbers arrive as null and are turned into NaN, which is what the original
// page got from `+undefined` when a field was absent.
const {momentum, fundamentals, compositeOf} = require('./reference_scoring.js');

const toNum = x => (x === null || x === undefined ? NaN : x);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));

const out = {cases: {}, grid: null};
for (const c of input.cases) {
  const prices = c.closes.map((close, i) => ({close: toNum(close), volume: c.volumes[i]}));
  const income = c.income ? c.income.map(r => ({rev: toNum(r.rev), gp: toNum(r.gp), ni: toNum(r.ni)})) : null;
  const m = momentum(prices), f = fundamentals(income);
  out.cases[c.id] = {m, f, composite: compositeOf(m, f)};
}
if (input.grid) {
  out.grid = [];
  for (let a = 0; a <= 100; a++) for (let b = 0; b <= 100; b++)
    out.grid.push(compositeOf({score: a}, {score: b}));
}
// JSON has no NaN/Infinity, so send those as strings.
process.stdout.write(JSON.stringify(out, (k, v) =>
  typeof v === 'number' && !Number.isFinite(v) ? String(v) : v));
