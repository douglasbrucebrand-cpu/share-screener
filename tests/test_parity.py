"""Checks that pipeline/scoring.py gives exactly the same answers as the original JavaScript.

Run from the project folder:
    .venv/bin/python -m unittest -v tests.test_parity

Needs Node.js (to run the original JavaScript). The 5 real tickers are a frozen
snapshot in tests/fixtures/parity_tickers.json, so the test does not need the internet.
"""
import json
import math
import os
import random
import shutil
import subprocess
import unittest

from pipeline import scoring

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "fixtures", "parity_tickers.json")


def js_safe(v):
    """Mirror the JS harness: NaN/Infinity become strings, recursively."""
    if isinstance(v, float) and not math.isfinite(v):
        return "NaN" if v != v else ("Infinity" if v > 0 else "-Infinity")
    if isinstance(v, dict):
        return {k: js_safe(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [js_safe(x) for x in v]
    return v


def python_result(case):
    m = scoring.momentum(case["closes"], case["volumes"])
    f = scoring.fundamentals(case["income"])
    return js_safe({"m": m, "f": f, "composite": scoring.composite(m["score"], f["score"])})


def synthetic_cases():
    """Edge cases plus random price paths, to cover branches the 5 real tickers may miss."""
    rnd = random.Random(42)
    cases = []

    def walk(n, drift, vol, start=100.0):
        p, out = start, []
        for _ in range(n):
            p *= 1 + rnd.gauss(drift, vol)
            out.append(round(max(p, 0.01), 4))
        return out

    for i in range(150):
        n = rnd.choice([30, 59, 60, 61, 63, 64, 69, 70, 71, 100, 220, 500])
        closes = walk(n, rnd.uniform(-0.004, 0.006), rnd.uniform(0.005, 0.05))
        volumes = [rnd.choice([0, None, rnd.randint(100_000, 50_000_000)]) if i % 10 == 0 else rnd.randint(100_000, 50_000_000)
                   for _ in range(n)]
        years = rnd.choice([0, 1, 2, 3, 4])
        income = [{"rev": rnd.choice([rnd.uniform(-1e8, 5e10), 0, None]) if i % 7 == 0 else rnd.uniform(1e7, 5e10),
                   "gp": None if i % 5 == 0 else rnd.uniform(0, 3e10),
                   "ni": rnd.uniform(-1e9, 1e10)} for _ in range(years)] or None
        cases.append({"id": f"random-{i}", "closes": closes, "volumes": volumes, "income": income})

    flat = [50.0] * 120
    cases += [
        {"id": "flat-prices-zero-volume", "closes": flat, "volumes": [0] * 120,
         "income": [{"rev": 100, "gp": 50, "ni": 5}, {"rev": 100, "gp": 50, "ni": 5}]},
        {"id": "overextended", "closes": [100.0] * 60 + [100 * 1.02 ** k for k in range(1, 41)],
         "volumes": [1e6] * 100, "income": None},
        {"id": "exactly-60-days", "closes": walk(60, 0.002, 0.01), "volumes": [1e6] * 60,
         "income": [{"rev": 130, "gp": 70, "ni": 1}, {"rev": 100, "gp": 50, "ni": 1}, {"rev": 90, "gp": 40, "ni": 1}]},
        {"id": "half-percent-labels", "closes": [100.0] * 80 + [102.5] * 22, "volumes": [1e6] * 102,
         "income": [{"rev": 102.5, "gp": None, "ni": 1}, {"rev": 100, "gp": None, "ni": 1}]},
        {"id": "falling-revenue", "closes": walk(200, -0.003, 0.02), "volumes": [1e6] * 200,
         "income": [{"rev": 80, "gp": 30, "ni": -5}, {"rev": 100, "gp": 50, "ni": 1}, {"rev": 95, "gp": 45, "ni": 1}]},
    ]

    # Values chosen so a score or label lands exactly on .5, where JavaScript's rounding
    # differs from Python's default. These catch a port that uses round() or "{:.0f}".
    def ramp(start, end, flat=81, days=21):
        return [start] * flat + [start + (end - start) * k / days for k in range(1, days)] + [end]

    for end in (111.1, 111.7, 90.0):  # 1M term = 18.5 / 19.5; 80 -> 90 below gives a "1M 12.5%" label
        start = 80.0 if end == 90.0 else 100.0
        cases.append({"id": f"half-momentum-{end}", "closes": ramp(start, end), "volumes": [1e6] * 102,
                      "income": None})
    cases += [
        {"id": "half-fund-score", "closes": ramp(100.0, 101.0), "volumes": [1e6] * 102,
         "income": [{"rev": 101.5, "gp": None, "ni": 1}, {"rev": 100, "gp": None, "ni": 1}]},   # 2.5 points
        {"id": "half-rev-label", "closes": ramp(100.0, 101.0), "volumes": [1e6] * 102,
         "income": [{"rev": 100.5, "gp": None, "ni": 1}, {"rev": 100, "gp": None, "ni": 1}]},   # "Rev 0.5%"
    ]
    return cases


@unittest.skipUnless(shutil.which("node"), "Node.js is needed to run the original JavaScript")
class ParityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(FIXTURE) as f:
            cls.real = json.load(f)["cases"]
        cls.synthetic = synthetic_cases()
        payload = json.dumps({"cases": cls.real + cls.synthetic, "grid": True})
        proc = subprocess.run(["node", os.path.join(HERE, "run_reference.js")],
                              input=payload, capture_output=True, text=True, check=True)
        cls.js = json.loads(proc.stdout)

    def check(self, case):
        py = python_result(case)
        js = self.js["cases"][case["id"]]
        # Exact equality on purpose: same arithmetic, same answer, down to the last bit.
        self.assertEqual(py, js, f"mismatch for {case['id']}")

    def test_five_real_tickers(self):
        self.assertEqual(len(self.real), 5)
        for case in self.real:
            with self.subTest(ticker=case["id"]):
                self.check(case)
                print(f"\n    {case['id']:8} mom={self.js['cases'][case['id']]['m']['score']} "
                      f"fund={self.js['cases'][case['id']]['f']['score']} "
                      f"composite={self.js['cases'][case['id']]['composite']}  (Python == JavaScript)", end="")

    def test_synthetic_edge_cases(self):
        for case in self.synthetic:
            with self.subTest(case=case["id"]):
                self.check(case)

    def test_composite_every_score_pair(self):
        py = [scoring.composite(a, b) for a in range(101) for b in range(101)]
        self.assertEqual(py, self.js["grid"])

    def test_catches_wrong_rounding(self):
        # Guard against a vacuous test: a port with Python-style rounding must FAIL.
        orig_round, orig_fixed = scoring.js_round, scoring.js_to_fixed0
        try:
            for name, broken in [("js_round", lambda x: int(round(x))),
                                 ("js_to_fixed0", lambda x: f"{x:.0f}")]:
                setattr(scoring, name, broken)
                bad = [c["id"] for c in self.synthetic if python_result(c) != self.js["cases"][c["id"]]]
                self.assertTrue(bad, f"swapping {name} for Python rounding went unnoticed")
                scoring.js_round, scoring.js_to_fixed0 = orig_round, orig_fixed
        finally:
            scoring.js_round, scoring.js_to_fixed0 = orig_round, orig_fixed

    def test_history_length_does_not_matter(self):
        # The original page only kept the last 220 days; the pipeline keeps ~2 years.
        # The scores must be identical either way.
        for case in self.real:
            full = scoring.momentum(case["closes"], case["volumes"])
            cut = scoring.momentum(case["closes"][-220:], case["volumes"][-220:])
            self.assertEqual(full, cut, case["id"])


if __name__ == "__main__":
    unittest.main()
