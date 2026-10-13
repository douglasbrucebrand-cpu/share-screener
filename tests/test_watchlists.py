"""watchlists.json mistakes must produce a clear, plain-English message.

(The real watchlists.json is deliberately not checked here: a typo in it should be
reported by the "Fetch data and score" step, with the friendly message, not as a test failure.)

Run: .venv/bin/python -m unittest -v tests.test_watchlists
"""
import json
import os
import tempfile
import unittest

import run_screener as rs


def check(text):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        f.write(text)
    try:
        return rs.read_watchlists(f.name)
    finally:
        os.unlink(f.name)


GOOD = {"tabs": [{"id": "a", "name": "A", "groups": [{"name": "G", "tickers": ["NVDA"]}]}],
        "benchmarks": {"USD": "SPY"}}


class WatchlistTest(unittest.TestCase):
    def test_good(self):
        self.assertEqual(check(json.dumps(GOOD))["tabs"][0]["id"], "a")

    def assertProblem(self, text, *words):
        with self.assertRaises(rs.WatchlistError) as cm:
            check(text)
        for w in words:
            self.assertIn(w, str(cm.exception))

    def test_missing_comma_names_the_line(self):
        self.assertProblem('{\n "tabs": [\n  {"id": "a" "name": "A"}\n ]\n}', "line 3", "comma")

    def test_trailing_comma(self):
        self.assertProblem('{"tabs": [{"id": "a", "name": "A", "groups": [{"name": "G", "tickers": ["NVDA",]}]}]}', "typo")

    def test_duplicate_tab_id(self):
        t = json.loads(json.dumps(GOOD)); t["tabs"].append(dict(t["tabs"][0], name="B"))
        self.assertProblem(json.dumps(t), "already used")

    def test_reserved_portfolio_id(self):
        t = json.loads(json.dumps(GOOD)); t["tabs"][0]["id"] = "portfolio"
        self.assertProblem(json.dumps(t), "already used")

    def test_unquoted_ticker(self):
        t = json.loads(json.dumps(GOOD)); t["tabs"][0]["groups"][0]["tickers"] = [123]
        self.assertProblem(json.dumps(t), "in quotes")

    def test_tracked_list(self):
        t = json.loads(json.dumps(GOOD)); t["tracked"] = ["MTN.JO", "MSFT"]
        self.assertEqual(check(json.dumps(t))["tracked"], ["MTN.JO", "MSFT"])
        t["tracked"] = "MTN.JO"
        self.assertProblem(json.dumps(t), '"tracked" should be a list')

    def test_group_without_tickers(self):
        t = json.loads(json.dumps(GOOD)); del t["tabs"][0]["groups"][0]["tickers"]
        self.assertProblem(json.dumps(t), '"tickers" list')


if __name__ == "__main__":
    unittest.main()
