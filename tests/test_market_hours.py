"""Today's still-moving price must not be saved as a close while that market is open.

Run: .venv/bin/python -m unittest -v tests.test_market_hours
"""
import unittest
from datetime import datetime, timezone

from pipeline.fetch import drop_unfinished_day

ROWS = [("2026-10-12", 100.0, 1), ("2026-10-13", 101.0, 1)]


def utc(*a):
    return datetime(*a, tzinfo=timezone.utc)


class MarketHoursTest(unittest.TestCase):
    def test_jse_during_trading_drops_today(self):
        # 12:22 SAST on Tue 13 Oct = 10:22 UTC: JSE still open
        self.assertEqual(drop_unfinished_day("NPN.JO", ROWS, utc(2026, 10, 13, 10, 22))[-1][0], "2026-10-12")

    def test_jse_after_close_keeps_today(self):
        # 18:00 SAST = 16:00 UTC
        self.assertEqual(drop_unfinished_day("NPN.JO", ROWS, utc(2026, 10, 13, 16, 0))[-1][0], "2026-10-13")

    def test_scheduled_run_keeps_yesterday(self):
        # the normal 05:00 UTC run: last row is yesterday's final close, nothing dropped
        self.assertEqual(drop_unfinished_day("NPN.JO", ROWS[:1], utc(2026, 10, 13, 5, 0)), ROWS[:1])

    def test_us_share_uses_new_york_hours(self):
        # 15:00 ET (19:00 UTC) still open; 17:00 ET (21:00 UTC) closed
        self.assertEqual(drop_unfinished_day("MU", ROWS, utc(2026, 10, 13, 19, 0))[-1][0], "2026-10-12")
        self.assertEqual(drop_unfinished_day("MU", ROWS, utc(2026, 10, 13, 21, 0))[-1][0], "2026-10-13")

    def test_us_evening_in_south_africa_is_still_trading_in_new_york(self):
        # 21:00 SAST on 13 Oct = 19:00 UTC = 15:00 ET: US market open, so today's US row goes
        self.assertEqual(len(drop_unfinished_day("SPY", ROWS, utc(2026, 10, 13, 19, 0))), 1)

    def test_empty(self):
        self.assertEqual(drop_unfinished_day("MU", [], utc(2026, 10, 13, 19, 0)), [])


if __name__ == "__main__":
    unittest.main()
