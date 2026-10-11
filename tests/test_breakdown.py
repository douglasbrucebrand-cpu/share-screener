"""The detail page's rule-by-rule breakdown must add up to exactly the real score.

Run: .venv/bin/python -m unittest -v tests.test_breakdown
"""
import json
import unittest

from pipeline import scoring
from tests.test_parity import FIXTURE, synthetic_cases

# Which badge each rule produces when it passes (None = no badge of its own).
MOM_BADGE = {"above50": "Above 50-day", "short_trend": "Short trend up", "sma50_rising": "50-day rising",
             "ret1m": "1M ", "steady": "Steady", "volume": "Volume rising", "not_stretched": None}
FUND_BADGE = {"revg": "Rev ", "accel": "Accelerating", "margins": "Margins up"}


def cases():
    with open(FIXTURE) as f:
        return json.load(f)["cases"] + synthetic_cases()


class BreakdownTest(unittest.TestCase):
    def test_points_add_up_to_score(self):
        for c in cases():
            with self.subTest(case=c["id"]):
                m = scoring.momentum(c["closes"], c["volumes"])
                f = scoring.fundamentals(c["income"])
                self.assertEqual(scoring.breakdown_total(scoring.momentum_breakdown(c["closes"], c["volumes"])), m["score"])
                self.assertEqual(scoring.breakdown_total(scoring.fundamentals_breakdown(c["income"])), f["score"])

    def test_passed_rules_match_badges(self):
        for c in cases():
            with self.subTest(case=c["id"]):
                m = scoring.momentum(c["closes"], c["volumes"])
                rules = scoring.momentum_breakdown(c["closes"], c["volumes"]) or []
                labels = [s[0] for s in m["sig"]]
                for r in rules:
                    badge = MOM_BADGE[r["key"]]
                    if badge:
                        self.assertEqual(r["passed"], any(l.startswith(badge) for l in labels), (r["key"], labels))
                self.assertEqual(any(r.get("warn") for r in rules), "Overextended" in labels)
                f = scoring.fundamentals(c["income"])
                flabels = [s[0] for s in f["sig"]]
                for r in scoring.fundamentals_breakdown(c["income"]) or []:
                    if r["key"] != "revg":   # revenue badge also shows for zero/negative growth
                        self.assertEqual(r["passed"], FUND_BADGE[r["key"]] in flabels, (r["key"], flabels))

    def test_maximums_are_100(self):
        c = cases()[0]
        self.assertEqual(sum(r["max"] for r in scoring.momentum_breakdown(c["closes"], c["volumes"])), 100)
        self.assertEqual(sum(r["max"] for r in scoring.fundamentals_breakdown(c["income"])), 100)


if __name__ == "__main__":
    unittest.main()
