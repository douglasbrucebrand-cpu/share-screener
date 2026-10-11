"""Tests for the "What changed" logic.  Run: .venv/bin/python -m unittest -v tests.test_changes"""
import unittest

from pipeline import changes

TABS = [{"id": "t", "name": "T", "groups": [
    {"name": "A", "tickers": ["A1", "A2", "A3", "A4"]},
    {"name": "B", "tickers": ["B1", "B2", "B3", "A1"]},   # A1 appears twice: must count once
]}]


def row(date, sym, comp, steady=False):
    return {"date": date, "symbol": sym, "composite": comp, "badges": ["Steady"] if steady else []}


def day(date, scores, steady=()):
    return [row(date, s, c, s in steady) for s, c in scores.items()]


class ChangesTest(unittest.TestCase):
    def test_first_run_has_nothing_to_compare(self):
        h = day("2026-10-12", {"A1": 50, "A2": 60})
        c = changes.build(TABS, h, "2026-10-12")
        self.assertIsNone(c["previous_date"])
        self.assertIsNone(c["week_base_date"])
        t = c["tabs"]["t"]
        self.assertEqual((t["new_steady"], t["top6_in"], t["top6_out"], t["risers"], t["fallers"]), ([], [], [], [], []))

    def test_steady_top_six_and_moves(self):
        base = {"A1": 90, "A2": 80, "A3": 70, "A4": 60, "B1": 50, "B2": 40, "B3": 30}
        h = (day("2026-10-01", {**base, "A4": 10})              # 11 days before: too old to be the week base
             + day("2026-10-05", base)                         # 7 days before: the week base
             + day("2026-10-09", base, steady={"A2"})          # previous run
             + day("2026-10-12", {**base, "B3": 85, "A3": 55, "B1": 49}, steady={"A2", "A3", "B2"}))
        c = changes.build(TABS, h, "2026-10-12")
        self.assertEqual(c["previous_date"], "2026-10-09")
        self.assertEqual(c["week_base_date"], "2026-10-05")
        self.assertEqual(c["week_days"], 7)
        t = c["tabs"]["t"]
        self.assertEqual(t["new_steady"], ["A3", "B2"])        # A2 was already Steady
        self.assertEqual(t["top6_in"], ["B3"])
        self.assertEqual(t["top6_out"], ["B2"])
        self.assertEqual([(m["symbol"], m["change"]) for m in t["risers"]], [("B3", 55)])
        self.assertEqual([(m["symbol"], m["change"]) for m in t["fallers"]], [("A3", -15), ("B1", -1)])

    def test_partial_week_uses_oldest_run(self):
        h = day("2026-10-10", {"A1": 40}) + day("2026-10-11", {"A1": 45}) + day("2026-10-12", {"A1": 52})
        c = changes.build(TABS, h, "2026-10-12")
        self.assertEqual((c["week_base_date"], c["week_days"]), ("2026-10-10", 2))
        self.assertEqual(c["tabs"]["t"]["risers"][0]["change"], 12)

    def test_top_six_ties_keep_watchlist_order(self):
        now = {s: {"composite": 50} for s in ["B3", "A1", "A2", "A3", "A4", "B1", "B2"]}
        self.assertEqual(changes.top_six(changes.tab_order(TABS[0]), now), ["A1", "A2", "A3", "A4", "B1", "B2"])

    def test_trends_keep_last_runs_oldest_first(self):
        h = [row(f"2026-09-{d:02d}", "A1", d) for d in range(1, 31)] + [row("2026-10-01", "A1", None)]
        t = changes.trends(h, runs=5)["A1"]
        self.assertEqual(t, [["2026-09-26", 26], ["2026-09-27", 27], ["2026-09-28", 28],
                             ["2026-09-29", 29], ["2026-09-30", 30]])


if __name__ == "__main__":
    unittest.main()
