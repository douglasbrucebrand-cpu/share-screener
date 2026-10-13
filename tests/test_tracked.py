"""A full (offline) run of the update: tracked shares get price files, but are not scored or shown on tabs.

Run: .venv/bin/python -m unittest -v tests.test_tracked
"""
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

import run_screener as rs


def fake_rows(n=120):
    return [(f"2026-{5 + i // 28:02d}-{1 + i % 28:02d}", 100.0 + i, 1000) for i in range(n)]


class TrackedSharesTest(unittest.TestCase):
    def test_tracked_shares_get_prices_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, "watchlists.json"), "w") as f:
                json.dump({"tabs": [{"id": "a", "name": "A", "groups": [{"name": "G", "tickers": ["NVDA"]}]}],
                           "benchmarks": {"USD": "SPY"}, "tracked": ["MTN.JO", "NVDA"]}, f)
            asked = []

            def fake_prices(symbols, **kw):
                asked.extend(symbols)
                return {s: fake_rows() for s in symbols}, {}

            data = os.path.join(tmp, "data")
            with mock.patch.object(rs, "ROOT", tmp), mock.patch.object(rs, "DATA", data), \
                    mock.patch.object(rs, "PRICES", os.path.join(data, "prices")), \
                    mock.patch.object(rs.fetch, "fetch_prices", fake_prices), \
                    mock.patch.object(rs.fetch, "fetch_fx", lambda pairs: {}), \
                    mock.patch.object(sys, "argv", ["run_screener.py", "--skip-fundamentals"]):
                rs.main()

            self.assertEqual(sorted(asked), ["MTN.JO", "NVDA", "SPY"])   # NVDA fetched once, not twice
            self.assertTrue(os.path.exists(os.path.join(data, "prices", "MTN.JO.json")))
            with open(os.path.join(data, "prices", "MTN.JO.json")) as f:
                self.assertEqual(json.load(f)["currency"], "ZAR")
            with open(os.path.join(data, "latest.json")) as f:
                latest = json.load(f)
            self.assertEqual(latest["tracked"], ["MTN.JO", "NVDA"])
            self.assertNotIn("MTN.JO", latest["tickers"])                 # not scored, not on any tab
            self.assertIn("NVDA", latest["tickers"])


if __name__ == "__main__":
    unittest.main()
