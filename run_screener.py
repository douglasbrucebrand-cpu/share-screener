"""Fetch data, score every ticker in watchlists.json, and write the JSON files the site reads.

Usage (from the project folder):
    .venv/bin/python run_screener.py                       # normal daily run
    .venv/bin/python run_screener.py --refresh-fundamentals  # force fundamentals now

Outputs:
    data/latest.json          scores, signals, valuation, last-updated time
    data/prices/<TICKER>.json daily price history (about 2 years)
    data/history.json         one row per ticker per run date
    data/fundamentals.json    cached statements + valuation (refreshed weekly)
"""
import argparse
import json
import math
import os
import sys
from datetime import date, datetime, timedelta, timezone

from pipeline import changes, fetch, lazy, scoring

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
PRICES = os.path.join(DATA, "prices")
FUND_MAX_AGE = timedelta(days=7)
SPARK_DAYS = 60

# "Expensive" badge: forward P/E above 40, or, when no profit is expected (forward
# P/E missing or negative), price-to-sales above 10. A label only: it never
# changes the composite score.
EXPENSIVE_FWD_PE = 40
EXPENSIVE_PS_LOSSMAKER = 10


# ---------- small file helpers ----------

def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path, obj, indent=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=indent, allow_nan=False, separators=None if indent else (",", ":"))
        f.write("\n")
    os.replace(tmp, path)  # write-then-rename so a crash never leaves half a file


def price_path(symbol):
    return os.path.join(PRICES, f"{symbol}.json")


def rnd(x, n=4):
    return None if x is None or not math.isfinite(x) else round(x, n)


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


# ---------- steps ----------

class WatchlistError(Exception):
    pass


def read_watchlists(path):
    """Read and check watchlists.json, explaining any mistake in plain English."""
    try:
        with open(path) as f:
            wl = json.load(f)
    except FileNotFoundError:
        raise WatchlistError("watchlists.json is missing.")
    except json.JSONDecodeError as e:
        raise WatchlistError(
            f"watchlists.json has a typo near line {e.lineno}, column {e.colno} ({e.msg}). "
            "Usually a missing or extra comma, or a missing quote mark, on that line or the one before.")
    if not isinstance(wl, dict) or not isinstance(wl.get("tabs"), list) or not wl["tabs"]:
        raise WatchlistError('watchlists.json needs a "tabs" list with at least one tab.')
    ids = set()
    for n, tab in enumerate(wl["tabs"], 1):
        where = f'tab {n} ("{tab.get("name", "?")}")' if isinstance(tab, dict) else f"tab {n}"
        if not isinstance(tab, dict) or not tab.get("id") or not tab.get("name"):
            raise WatchlistError(f'{where} needs an "id" and a "name".')
        if tab["id"] in ids or tab["id"] == "portfolio":
            raise WatchlistError(f'{where}: the id "{tab["id"]}" is already used. Each tab needs its own id.')
        ids.add(tab["id"])
        if not isinstance(tab.get("groups"), list) or not tab["groups"]:
            raise WatchlistError(f'{where} needs a "groups" list with at least one group.')
        for g in tab["groups"]:
            if not isinstance(g, dict) or not g.get("name") or not isinstance(g.get("tickers"), list):
                raise WatchlistError(f'{where}: every group needs a "name" and a "tickers" list.')
            if not all(isinstance(t, str) for t in g["tickers"]):
                raise WatchlistError(f'{where}, group "{g["name"]}": tickers must be in quotes, e.g. "NVDA".')
    if not isinstance(wl.get("benchmarks", {}), dict):
        raise WatchlistError('"benchmarks" should look like {"USD": "SPY", "ZAR": "STX40.JO"}.')
    tracked = wl.get("tracked", [])
    if not isinstance(tracked, list) or not all(isinstance(t, str) for t in tracked):
        raise WatchlistError('"tracked" should be a list of tickers in quotes, e.g. ["MTN.JO", "MSFT"].')
    return wl


def load_watchlists(path=None):
    try:
        wl = read_watchlists(path or os.path.join(ROOT, "watchlists.json"))
    except WatchlistError as e:
        sys.exit(f"PROBLEM WITH watchlists.json: {e}")
    symbols = []
    for tab in wl["tabs"]:
        for g in tab["groups"]:
            g["tickers"] = [t.strip().upper() for t in g["tickers"] if t.strip()]
            symbols += [t for t in g["tickers"] if t not in symbols]
    # Benchmarks for the paper portfolio: price history only, never scored or shown in the tables.
    wl["benchmarks"] = {k: v.strip().upper() for k, v in wl.get("benchmarks", {}).items()}
    # Shares tagged in analyst calls but not on any watchlist: price history only, never shown on the tabs.
    wl["tracked"] = list(dict.fromkeys(t.strip().upper() for t in wl.get("tracked", []) if t.strip()))
    return wl, symbols


def refresh_fundamentals(symbols, cache, force):
    """Refresh statements/valuation for tickers whose data is over a week old."""
    now = datetime.now(timezone.utc)
    due = []
    for s in symbols:
        fetched = cache.get(s, {}).get("fetched_at")
        if force or not fetched or now - datetime.fromisoformat(fetched) > FUND_MAX_AGE:
            due.append(s)
    if not due:
        print("Fundamentals: all fresh (refreshed within 7 days), skipping.")
        return
    print(f"Fundamentals: refreshing {len(due)} ticker(s)...")
    for i, s in enumerate(due, 1):
        old = cache.get(s, {})
        try:
            new = fetch.fetch_fundamentals(s)
            if not new["income"] and old.get("income"):
                # Never swap good statements for an empty response.
                new["income"] = old["income"]
                new["error"] = "income statement came back empty; kept previous"
            else:
                new["error"] = None
            new["fetched_at"] = now_iso()
            cache[s] = new
            print(f"  [{i}/{len(due)}] {s}: ok ({len(new['income'])} years)")
        except Exception as e:
            old["error"] = str(e)
            old["last_attempt"] = now_iso()
            cache[s] = old
            print(f"  [{i}/{len(due)}] {s}: FAILED, keeping previous data ({e})")


def refresh_prices(symbols, cache, years=2):
    """Batch-download prices; save the last 2 years of each to data/prices/.

    Returns ({symbol: error}, {symbol: full history}) where the full history (up to `years`, with
    daily lows and highs) is only used for calculations such as the lazy system, never published.
    """
    print(f"Prices: downloading {len(symbols)} ticker(s), {years} years, in one batch...")
    got, errors = fetch.fetch_prices(symbols, period=f"{max(2, int(years))}y")
    full = {}
    for s, rows in got.items():
        rows = fetch.drop_unfinished_day(s, rows)   # no half-day "closes" during trading hours
        ccy, div = fetch.quote_unit(s, cache.get(s, {}).get("quote_currency_raw"))
        full[s] = {
            "dates": [r[0] for r in rows],
            "close": [r[1] / div for r in rows],
            "low": [(r[3] if len(r) > 3 else r[1]) / div for r in rows],
            "high": [(r[4] if len(r) > 4 else r[1]) / div for r in rows],
        }
        if rows:   # publish 2 years, as before
            cutoff = (date.fromisoformat(rows[-1][0]) - timedelta(days=730)).isoformat()
            rows = [r for r in rows if r[0] >= cutoff]
        old = load_json(price_path(s), None)
        old_n = len(old["dates"]) if old else 0
        if len(rows) < 0.5 * old_n:
            errors[s] = f"only {len(rows)} days returned (had {old_n}); kept previous"
            full.pop(s, None)
            continue
        save_json(price_path(s), {
            "symbol": s,
            "currency": ccy,
            "updated_at": now_iso(),
            "dates": [r[0] for r in rows],
            "close": [round(r[1] / div, 4) for r in rows],
            "volume": [r[2] for r in rows],
        })
    for s, e in errors.items():
        print(f"  {s}: {e}")
    print(f"  {len(got)} ok, {len(errors)} problem(s).")
    return errors, full


FEED_BARS = {"weekly": 4, "daily": 5}   # signals feed: the last 4 weeks and 5 trading days


def lazy_signals(symbols, full, settings, run_date, previous):
    """Simon Brown's lazy system for each share: weekly and daily state (pipeline/lazy.py).

    Returns ({symbol: {timeframe: summary}}, feed) where feed lists recent triggers, confirmations,
    exits and cancellations. A share whose prices failed to download keeps its previous result,
    marked as not updated (and adds nothing to the feed).
    """
    out, feed = {}, []
    for s in symbols:
        if s in full and full[s]["dates"]:
            h = full[s]
            res = lazy.analyse(h["dates"], h["close"], h["low"], h["high"], settings, run_date)
            out[s] = {tf: lazy.summary(r) for tf, r in res.items()}
            for tf, r in res.items():
                feed += lazy.recent_events(r, s, tf, FEED_BARS[tf])
        elif (previous.get(s) or {}).get("lazy"):
            out[s] = dict(previous[s]["lazy"], stale=True)
    feed.sort(key=lambda e: (e["tf"] != "weekly", e["date"], e["symbol"]), reverse=False)
    return out, feed


def valuation(f, price_ccy, fx):
    """Valuation fields. P/S is recomputed so revenue and market cap are in the same currency."""
    if not f:
        return {"trailing_pe": None, "forward_pe": None, "price_to_sales": None, "market_cap": None}
    ps = None
    mcap, rev, fin = f.get("market_cap"), f.get("total_revenue"), f.get("financial_currency") or price_ccy
    rate = fx.get((fin, price_ccy))
    if mcap and rev and rate:
        ps = mcap / (rev * rate)
    return {
        "trailing_pe": rnd(f.get("trailing_pe"), 2),
        "forward_pe": rnd(f.get("forward_pe"), 2),
        "price_to_sales": rnd(ps, 2),
        "market_cap": mcap,
    }


def valuation_flags(v):
    """Extra badges from valuation: [label, css class, explanation]."""
    fpe, ps = v.get("forward_pe"), v.get("price_to_sales")
    if fpe is not None and fpe > 0:
        if fpe > EXPENSIVE_FWD_PE:
            return [["Expensive", "w", f"Forward P/E {fpe:.0f} is above {EXPENSIVE_FWD_PE}"]]
    elif ps is not None and ps > EXPENSIVE_PS_LOSSMAKER:
        return [["Expensive", "w", f"No profit expected and price-to-sales {ps:.0f} is above {EXPENSIVE_PS_LOSSMAKER}"]]
    return []


def _round_points(rules):
    if rules is None:
        return None
    return [dict(r, points=round(r["points"], 2)) for r in rules]


def score_ticker(s, fcache, fx, price_err):
    p = load_json(price_path(s), None)
    f = fcache.get(s)
    errors = {}
    if price_err:
        errors["prices"] = price_err
    if f and f.get("error"):
        errors["fundamentals"] = f["error"]
    if not f:
        errors.setdefault("fundamentals", "no fundamentals yet")
    if not p:
        return {"symbol": s, "name": (f or {}).get("name", s), "errors": errors or {"prices": "no price data"},
                "mom": None, "fund": None, "composite": None, "sig": []}

    m = scoring.momentum(p["close"], p["volume"])
    income = (f or {}).get("income") or []
    fd = scoring.fundamentals(income)
    comp = scoring.composite(m["score"], fd["score"])
    val = valuation(f, p["currency"], fx)
    return {
        "symbol": s,
        "name": (f or {}).get("name", s),
        "currency": p["currency"],
        "price": p["close"][-1],
        "price_date": p["dates"][-1],
        "ret1m": rnd(m["ret1m"]),
        "ret3m": rnd(m["ret3m"]),
        "vsSMA50": rnd(m["vsSMA50"]),
        "revg": rnd(fd["revg"]),
        "mom": m["score"],
        "fund": fd["score"],
        "composite": comp,
        "sig": m["sig"] + fd["sig"],
        "valuation": val,
        "flags": valuation_flags(val),
        "breakdown": {
            "momentum": _round_points(scoring.momentum_breakdown(p["close"], p["volume"])),
            "fundamentals": _round_points(scoring.fundamentals_breakdown(income)),
        },
        "income": income,
        "financial_currency": (f or {}).get("financial_currency"),
        "fundamentals_period_end": income[0]["period_end"] if income else None,
        "fundamentals_fetched_at": (f or {}).get("fetched_at"),
        "spark": p["close"][-SPARK_DAYS:],
        "errors": errors,
    }


def update_history(rows, run_date):
    path = os.path.join(DATA, "history.json")
    hist = load_json(path, {"rows": []})
    keep = [r for r in hist["rows"] if r["date"] != run_date]  # re-running the same day replaces that day
    for r in rows:
        if r.get("composite") is None and r.get("mom") is None:
            continue
        keep.append({
            "date": run_date, "symbol": r["symbol"], "price": r.get("price"), "currency": r.get("currency"),
            "mom": r["mom"], "fund": r["fund"], "composite": r["composite"],
            "badges": [b[0] for b in r["sig"] + r.get("flags", [])],
            "lazy_w": (r.get("lazy") or {}).get("weekly", {}).get("state"),
            "lazy_d": (r.get("lazy") or {}).get("daily", {}).get("state"),
        })
    keep.sort(key=lambda r: (r["date"], r["symbol"]))
    save_json(path, {"rows": keep})
    return keep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh-fundamentals", action="store_true", help="refresh fundamentals even if fresh")
    ap.add_argument("--skip-fundamentals", action="store_true", help="prices only")
    args = ap.parse_args()

    wl, symbols = load_watchlists()
    print(f"{len(symbols)} unique tickers across {len(wl['tabs'])} tab(s).")

    fpath = os.path.join(DATA, "fundamentals.json")
    fcache = load_json(fpath, {})
    if not args.skip_fundamentals:
        refresh_fundamentals(symbols, fcache, args.refresh_fundamentals)
        save_json(fpath, fcache, indent=1)

    # Benchmarks and tracked shares: prices only (not scored, not shown on the tabs).
    extras = list(dict.fromkeys(t for t in list(wl["benchmarks"].values()) + wl["tracked"] if t not in symbols))
    lazy_settings = lazy.load_settings(os.path.join(ROOT, "lazy_settings.json"))
    price_errors, full_history = refresh_prices(symbols + extras, fcache, lazy_settings["history_years"])
    for b in extras:
        if b in price_errors:
            print(f"  warning: {b} prices not updated ({price_errors.pop(b)})")

    # Exchange rates needed to put revenue in the same currency as market cap.
    pairs = set()
    for s in symbols:
        f = fcache.get(s)
        if f and f.get("financial_currency"):
            ccy, _ = fetch.quote_unit(s, f.get("quote_currency_raw"))
            pairs.add((f["financial_currency"], ccy))
    fx = fetch.fetch_fx(pairs)
    for a, b in sorted(pairs):
        if (a, b) not in fx:
            print(f"  warning: no {a}->{b} exchange rate; P/S left blank for those tickers")

    rows = {s: score_ticker(s, fcache, fx, price_errors.get(s)) for s in symbols}
    run_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    previous = load_json(os.path.join(DATA, "latest.json"), {}).get("tickers", {})
    lazy_by_symbol, lazy_feed = lazy_signals(symbols, full_history, lazy_settings, run_date, previous)
    for s, sig in lazy_by_symbol.items():
        rows[s]["lazy"] = sig
    price_dates = [r["price_date"] for r in rows.values() if r.get("price_date")]
    latest = {
        "schema": 1,
        "generated_at": now_iso(),
        "prices_as_of": max(price_dates) if price_dates else None,
        "fx": {f"{a}{b}": round(v, 6) for (a, b), v in fx.items() if a != b},
        "tabs": wl["tabs"],
        "benchmarks": wl["benchmarks"],
        "tracked": wl["tracked"],
        "lazy_settings": lazy_settings,
        "lazy_feed": lazy_feed,
        "tickers": rows,
        "errors": [{"symbol": s, "stage": k, "message": v} for s, r in rows.items() for k, v in r["errors"].items()],
    }
    hist_rows = update_history(list(rows.values()), run_date)
    latest["changes"] = changes.build(wl["tabs"], hist_rows, run_date)
    for s, t in changes.trends(hist_rows).items():
        if s in rows:
            rows[s]["trend"] = t
    save_json(os.path.join(DATA, "latest.json"), latest)

    scored = sum(1 for r in rows.values() if r.get("composite") is not None)
    print(f"\nDone: {scored}/{len(symbols)} tickers scored, {len(latest['errors'])} problem(s) recorded.")
    print("Wrote data/latest.json, data/history.json and data/prices/*.json")


if __name__ == "__main__":
    main()
