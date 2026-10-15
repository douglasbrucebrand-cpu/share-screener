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

    def test_feed_picks_recent_signals_and_marks_the_latest_bar(self):
        r = run(UP + [23, 22, 24, 25, 26, 27, 20])        # trigger 24, entry 25, exit 20 on the last bar
        feed = lazy.recent_events(r, "XYZ", "daily", 3)    # last 3 bars: 26, 27, 20
        self.assertEqual([(e["state"], e["close"], e["latest"]) for e in feed], [("exited", 20, True)])
        ex = feed[0]
        self.assertEqual((ex["symbol"], ex["tf"], ex["reason"], ex["entry"]), ("XYZ", "daily", "trailing stop", 25))
        self.assertAlmostEqual(ex["ret"], 20 / 25 - 1, places=5)
        wide = lazy.recent_events(r, "XYZ", "daily", 6)    # now includes the trigger and the entry
        self.assertEqual([e["state"] for e in wide], ["triggered", "in_trade", "exited"])
        self.assertEqual([e["latest"] for e in wide], [False, False, True])
        self.assertAlmostEqual(wide[1]["stop"], 25 * 0.8)  # a new entry shows its starting stop

    def test_feed_leaves_out_phase_changes(self):
        r = run(UP + [23, 22, 24, 25, 28, 32, 30])
        self.assertNotIn("phase_2", [e["state"] for e in lazy.recent_events(r, "X", "daily", 10)])

    def test_chart_data_window(self):
        c = UP + [23, 22, 24, 25, 26, 27, 20]
        r = run(c)
        d = days(len(c))
        cd = lazy.chart_data(r, d[10])
        self.assertEqual(cd["dates"], d[10:])
        self.assertEqual(len(cd["close"]), len(cd["dates"]))
        self.assertTrue(all(len(e) == len(cd["dates"]) for e in cd["ema"]))
        # EMAs in the window are the full-history values, not restarted at the window's start
        self.assertAlmostEqual(cd["ema"][2][0], lazy.ema(c, 8)[10], places=4)
        self.assertEqual([e["state"] for e in cd["events"]], ["triggered", "in_trade", "exited"])
        self.assertEqual(cd["current"]["state"], "exited")
        self.assertEqual(lazy.chart_data(run([1, 2, 3]), d[0]), {"state": "insufficient"})

    def test_backtest_one_losing_trade(self):
        c = UP + [23, 22, 24, 25, 26, 27, 20]               # buy 25, sell 20
        bt = lazy.backtest(run(c))
        self.assertEqual((bt["trades"], bt["wins"], bt["win_rate"]), (1, 0, 0.0))
        self.assertAlmostEqual(bt["total_return"], -0.2, places=5)
        self.assertAlmostEqual(bt["avg_loss"], -0.2, places=5)
        self.assertIsNone(bt["avg_win"])
        # value peaked at 27/25 = 1.08 and fell to 0.80: drawdown 0.80 / 1.08 - 1
        self.assertAlmostEqual(bt["max_drawdown"], 0.8 / 1.08 - 1, places=5)
        # buy-and-hold from the first bar a signal could happen (bar 7, close 17) to the end (20)
        self.assertEqual(bt["start"], days(len(c))[7])
        self.assertAlmostEqual(bt["hold_return"], 20 / 17 - 1, places=5)
        self.assertEqual(bt["trade_list"][0]["reason"], "trailing stop")

    def test_backtest_costs_come_off_each_trade(self):
        c = UP + [23, 22, 24, 25, 26, 27, 20]
        bt = lazy.backtest(run(c), cost_pct=1)
        self.assertAlmostEqual(bt["trade_list"][0]["net"], 0.8 * 0.99 - 1, places=5)
        self.assertAlmostEqual(bt["total_return"], 0.8 * 0.99 - 1, places=5)

    def test_backtest_winning_trade_and_profit_factor(self):
        # trade 1: buy 25, sell 28.5 on a lower low (+14%); trade 2: buy 32, highest 33 -> stop 26.40,
        # sell 25 (-21.875%). Profit factor 0.14 / 0.21875; total = 1.14 x 0.78125 - 1 (trades compound).
        c = UP + [23, 22, 24, 25, 28, 32, 30, 29, 31, 33, 34, 28.5, 29, 31, 32, 33, 25]
        bt = lazy.backtest(run(c))
        self.assertEqual([(t["entry"], t["exit"], t["reason"]) for t in bt["trade_list"]],
                         [(25, 28.5, "lower low"), (32, 25, "trailing stop")])
        self.assertEqual((bt["trades"], bt["wins"], bt["win_rate"]), (2, 1, 0.5))
        self.assertAlmostEqual(bt["avg_win"], 0.14, places=5)
        self.assertAlmostEqual(bt["avg_loss"], -0.21875, places=5)
        self.assertAlmostEqual(bt["profit_factor"], 0.14 / 0.21875, places=3)
        self.assertAlmostEqual(bt["total_return"], 1.14 * 0.78125 - 1, places=5)

    def test_backtest_open_trade_counts_at_last_close(self):
        bt = lazy.backtest(run(UP + [23, 22, 24, 25, 26]))   # bought 25, still holding at 26
        self.assertEqual((bt["trades"], bt["open_trade"], bt["win_rate"]), (0, True, None))
        self.assertAlmostEqual(bt["total_return"], 26 / 25 - 1, places=5)
        self.assertTrue(bt["trade_list"][-1]["open"])

    def test_backtest_equity_curve_ends_at_total_return(self):
        bt = lazy.backtest(run(UP + [23, 22, 24, 25, 26, 27, 20]))
        eq = bt["equity"]
        self.assertEqual(len(eq["dates"]), len(eq["system"]))
        self.assertAlmostEqual(eq["system"][-1], 1 + bt["total_return"], places=3)
        self.assertAlmostEqual(eq["hold"][-1], 1 + bt["hold_return"], places=3)

    def test_summary_is_small(self):
        r = lazy.summary(run(UP + [23, 22, 24, 25, 26]))
        self.assertEqual(set(r), {"state", "since", "bars", "trend", "entry", "entry_date", "phase", "stop", "date"})


if __name__ == "__main__":
    unittest.main()
