"""Tests for Simon Brown's lazy trading system (pipeline/lazy.py).

Hand-made price series where the right answer is obvious, plus checks against pandas and for
look-ahead. Small EMA spans (3/5/8) keep the series short; the logic is the same as 15/30/60.

Run: .venv/bin/python -m unittest -v tests.test_lazy
"""
import random
import unittest

import pandas as pd

from pipeline import lazy

S = {"ema": [3, 5, 8], "trailing_stop_pct": 20, "swing_lookback": 2,
     "timeframes": {"weekly": True, "daily": True}}
UP = [10 + i for i in range(15)]          # a steady rise: EMA3 > EMA5 > EMA8


def days(n, start="2026-01-01"):
    d0 = pd.Timestamp(start)
    return [(d0 + pd.Timedelta(days=i)).strftime("%Y-%m-%d") for i in range(n)]


def run(close, low=None, high=None, settings=S, direction="long"):
    return lazy.run(days(len(close)), close, low or close, high or close, settings, direction)


def states(r):
    return [(e["state"], e["close"]) for e in r["events"]]


class Rules(unittest.TestCase):
    def test_clean_trigger_and_confirmation(self):
        r = run(UP + [23, 22, 24, 25, 26])
        # 22 is below EMA3; 24 crosses back above it with the EMAs lined up = trigger;
        # 25 is a higher close still above EMA3 = confirmed, entry 25.
        self.assertEqual(states(r), [("triggered", 24), ("in_trade", 25)])
        self.assertEqual((r["state"], r["entry"], r["phase"]), ("in_trade", 25, 1))
        self.assertAlmostEqual(r["stop"], 26 * 0.8)          # 20% under the highest close (26)

    def test_waiting_when_close_is_not_higher(self):
        r = run(UP + [23, 22, 24, 23.9])                     # above EMA3 but not above 24: keep waiting
        self.assertEqual(r["state"], "triggered")

    def test_trigger_cancelled(self):
        r = run(UP + [23, 22, 24, 21])                       # closes back below EMA3
        self.assertEqual(states(r), [("triggered", 24), ("cancelled", 21)])

    def test_no_trigger_without_ema_alignment(self):
        down = [40 - i for i in range(15)]                   # falling: EMAs lined up the wrong way
        r = run(down + [27, 28, 29])
        self.assertEqual(r["state"], "no_setup")
        self.assertEqual(r["trend"], "bearish")

    def test_phase_1_trailing_stop_exit(self):
        r = run(UP + [23, 22, 24, 25, 26, 27, 20])           # highest 27 -> stop 21.60; 20 is below it
        self.assertEqual(r["state"], "exited")
        self.assertEqual(r["trades"][0]["reason"], "trailing stop")
        self.assertEqual((r["trades"][0]["entry"], r["trades"][0]["exit"]), (25, 20))

    def test_phase_2_lower_low_exit(self):
        # entry 25; 32 lifts the stop to 25.60 (above entry) -> phase 2. 29 is a swing low
        # (lower than the 2 bars either side), known once 33 closes; 28.5 closes below it.
        r = run(UP + [23, 22, 24, 25, 28, 32, 30, 29, 31, 33, 34, 28.5])
        self.assertIn(("phase_2", 32), states(r))
        self.assertEqual(r["trades"][0]["reason"], "lower low")
        self.assertEqual(r["trades"][0]["exit"], 28.5)

    def test_phase_2_ignores_swing_low_not_yet_confirmed(self):
        # Same, but stop the series one bar after 29: 29 isn't a known swing low yet (needs 2 later bars).
        r = run(UP + [23, 22, 24, 25, 28, 32, 30, 29, 31])
        self.assertEqual(r["state"], "in_trade")
        self.assertEqual(r["phase"], 2)

    def test_swing_lookback_is_a_setting(self):
        s = dict(S, swing_lookback=3)
        r = run(UP + [23, 22, 24, 25, 28, 32, 30, 29, 31, 33, 34, 28.5], settings=s)
        # with 3 bars either side, 29 is no longer a swing low (32 is only 2 bars before), so no exit
        self.assertEqual(r["state"], "in_trade")

    def test_shorts_are_the_mirror_image(self):
        # A falling market: bounce above EMA3 (27, 28), cross back below (26) = trigger, lower close
        # (25) = short entry, lowest close 23 -> stop 20% above = 27.60; 30 closes above it = exit.
        down = [40 - i for i in range(15)]
        r = run(down + [27, 28, 26, 25, 24, 23, 30], direction="short")
        self.assertEqual(states(r), [("triggered", 26), ("in_trade", 25), ("exited", 30)])
        self.assertEqual(r["trades"][0]["reason"], "trailing stop")
        self.assertAlmostEqual(r["trades"][0]["return"], 25 / 30 - 1)

    def test_too_little_history(self):
        self.assertEqual(run([10, 11, 12])["state"], "insufficient")


class Calculations(unittest.TestCase):
    def test_ema_matches_pandas(self):
        rnd = random.Random(1)
        values = [100 + rnd.gauss(0, 5) for _ in range(300)]
        for span in (15, 30, 60):
            expected = pd.Series(values).ewm(span=span, adjust=False).mean().tolist()
            for a, b in zip(lazy.ema(values, span), expected):
                self.assertAlmostEqual(a, b, places=9)

    def test_weekly_bars_end_friday_and_skip_unfinished_week(self):
        # Mon 5 Oct .. Wed 14 Oct 2026, weekdays only
        d = [x for x in days(10, "2026-10-05") if pd.Timestamp(x).weekday() < 5]
        c = list(range(1, len(d) + 1))
        wd, wc, wl, wh = lazy.weekly_bars(d, c, c, c, last_complete="2026-10-13")
        self.assertEqual(wd, ["2026-10-09"])                 # week of 12 Oct isn't over on Wed 14 Oct
        self.assertEqual((wc, wl, wh), ([5], [1], [5]))       # close = Friday's, low/high over the week

    def test_week_ending_on_a_friday_holiday_counts_once_friday_has_passed(self):
        d = ["2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24"]   # Friday 25 Dec closed
        wd, *_ = lazy.weekly_bars(d, [1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4], last_complete="2026-12-25")
        self.assertEqual(wd, ["2026-12-24"])
        wd, *_ = lazy.weekly_bars(d, [1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4], last_complete="2026-12-24")
        self.assertEqual(wd, [])

    def test_no_look_ahead(self):
        # The state reported for any bar must be the same whether or not later bars exist.
        rnd = random.Random(7)
        p, c = 100.0, []
        for _ in range(400):
            p *= 1 + rnd.gauss(0.001, 0.02)
            c.append(round(p, 2))
        lows = [x * (1 - abs(rnd.gauss(0, 0.01))) for x in c]
        full = run(c, lows, c)
        for cut in range(80, 400, 23):
            part = run(c[:cut], lows[:cut], c[:cut])
            seen = [e for e in full["events"] if e["date"] <= days(cut)[-1]]
            self.assertEqual(part["events"], seen, f"differs when cut at bar {cut}")

    def test_summary_is_small(self):
        r = lazy.summary(run(UP + [23, 22, 24, 25, 26]))
        self.assertEqual(set(r), {"state", "since", "bars", "trend", "entry", "entry_date", "phase", "stop", "date"})


if __name__ == "__main__":
    unittest.main()
