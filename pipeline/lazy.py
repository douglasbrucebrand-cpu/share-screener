"""Simon Brown's "lazy trading system" (Just One Lap), as a trend-following signal.

Sits alongside the screener's scores and never changes them. Rules (longs; shorts mirror):

  Trend     bullish if EMA30 > EMA60, bearish if below.
  Trigger   a close crosses above EMA15 (previous close at or below the previous EMA15, this close
            above this EMA15) while EMA15 > EMA30 > EMA60.
  Confirm   while triggered, a later close above the previous close (and above EMA15) confirms:
            entry = that close. A close below EMA15 cancels; anything else keeps waiting.
  Exit      phase 1: close below a trailing stop 20% under the highest close since entry.
            Once that stop reaches the entry price (breakeven), phase 2: close below the most
            recent swing low, a bar whose low is lower than the `lookback` bars either side.

No look-ahead: each bar is judged only on data up to and including its own close. In particular a
swing low at bar j is only "known" once the `lookback` bars after it have closed (bar j + lookback).
"""
import json
import os
from datetime import date, timedelta

STATES = ("no_setup", "triggered", "in_trade", "exited", "cancelled")
DEFAULTS = {"ema": [15, 30, 60], "trailing_stop_pct": 20, "swing_lookback": 2,
            "timeframes": {"weekly": True, "daily": True}, "market_benchmarks": ["QQQ", "STX40.JO"],
            "cost_per_trade_pct": 0, "auto_paper_trades": True, "history_years": 10}


def load_settings(path):
    try:
        with open(path) as f:
            s = json.load(f)
    except FileNotFoundError:
        s = {}
    out = dict(DEFAULTS)
    out.update({k: v for k, v in s.items() if k in DEFAULTS})
    return out


def ema(values, span):
    """Exponential moving average, the same as pandas' close.ewm(span=n, adjust=False).mean()."""
    alpha = 2 / (span + 1)
    out, prev = [], None
    for v in values:
        prev = v if prev is None else alpha * v + (1 - alpha) * prev
        out.append(prev)
    return out


def weekly_bars(dates, close, low, high, last_complete=None):
    """Weekly bars (weeks ending Friday) from daily bars, leaving out a week that isn't finished.

    dates are 'YYYY-MM-DD' strings in order. A week counts as finished once its Friday has passed
    (`last_complete` is the last date that is definitely over, normally today minus one day) or
    the daily data already contains that Friday's close.
    Returns (dates, close, low, high) with each week labelled by the date of its last trading day.
    """
    weeks = {}
    order = []
    for d, c, lo, hi in zip(dates, close, low, high):
        y, m, dd = map(int, d.split("-"))
        day = date(y, m, dd)
        friday = day + timedelta(days=(4 - day.weekday()) % 7)
        w = weeks.get(friday)
        if w is None:
            weeks[friday] = w = {"last": d, "close": c, "low": lo, "high": hi}
            order.append(friday)
        else:
            w["last"], w["close"] = d, c
            w["low"], w["high"] = min(w["low"], lo), max(w["high"], hi)
    if not order:
        return [], [], [], []
    last_daily = dates[-1]
    out = ([], [], [], [])
    for friday in order:
        f = friday.isoformat()
        finished = f <= last_daily or (last_complete is not None and f <= last_complete)
        if not finished:
            continue
        w = weeks[friday]
        for lst, v in zip(out, (w["last"], w["close"], w["low"], w["high"])):
            lst.append(v)
    return out


def _swing_points(values, k, lows=True):
    """Indexes j that are swing lows (or highs): strictly beyond the k bars either side."""
    pts = []
    for j in range(k, len(values) - k):
        v = values[j]
        side = values[j - k:j] + values[j + 1:j + k + 1]
        if (lows and all(v < x for x in side)) or (not lows and all(v > x for x in side)):
            pts.append(j)
    return pts


def run(dates, close, low, high, settings=None, direction="long"):
    """Run the system bar by bar. Returns a dict with the current state and the full history.

    direction: 'long' (shown) or 'short' (the mirror image, ready for later).
    """
    s = settings or DEFAULTS
    fast, mid, slow = s["ema"]
    stop_pct = s["trailing_stop_pct"] / 100
    k = int(s["swing_lookback"])
    n = len(close)
    up = direction == "long"
    if n < slow:
        return {"state": "insufficient", "bars_available": n, "events": [], "trades": []}

    e1, e2, e3 = ema(close, fast), ema(close, mid), ema(close, slow)
    swings = _swing_points(low if up else high, k, lows=up)
    swing_ptr, last_swing = 0, None     # most recent swing point already confirmed at bar t

    state, since = "no_setup", 0
    entry = entry_i = extreme = None
    phase = None
    events, trades = [], []

    def go(new, t, **extra):
        nonlocal state, since
        state, since = new, t
        events.append(dict({"state": new, "date": dates[t], "close": close[t]}, **extra))

    def beyond(a, b):          # "above" for longs, "below" for shorts
        return a > b if up else a < b

    for t in range(1, n):
        c, pc = close[t], close[t - 1]
        while swing_ptr < len(swings) and swings[swing_ptr] + k <= t:   # confirmed by bar t
            last_swing = swings[swing_ptr]
            swing_ptr += 1
        if t < slow - 1:
            continue                       # not enough bars for the slow EMA yet

        if state == "in_trade":
            if phase == 1:
                stop = extreme * (1 - stop_pct) if up else extreme * (1 + stop_pct)
                if beyond(stop, c):        # close fell through the trailing stop
                    tr = _close_trade(trades, dates, entry_i, entry, t, c, "trailing stop", up)
                    go("exited", t, reason="trailing stop", stop=stop, entry=entry, entry_date=dates[entry_i], ret=tr["return"])
                    continue
                extreme = max(extreme, c) if up else min(extreme, c)
                new_stop = extreme * (1 - stop_pct) if up else extreme * (1 + stop_pct)
                if not beyond(entry, new_stop):   # stop has reached breakeven
                    phase = 2
                    events.append({"state": "phase_2", "date": dates[t], "close": c, "stop": new_stop})
            else:
                level = (low if up else high)[last_swing] if last_swing is not None else None
                if level is not None and beyond(level, c):
                    reason = "lower low" if up else "higher high"
                    tr = _close_trade(trades, dates, entry_i, entry, t, c, reason, up)
                    go("exited", t, reason=reason, stop=level, entry=entry, entry_date=dates[entry_i], ret=tr["return"])
                    continue
            continue

        if state == "triggered":
            if beyond(e1[t], c):                       # closed back through EMA15: cancel
                go("cancelled", t)
            elif beyond(c, pc) and beyond(c, e1[t]):   # higher close, still beyond EMA15: confirmed
                entry, entry_i, extreme, phase = c, t, c, 1
                go("in_trade", t, entry=c, stop=c * (1 - stop_pct) if up else c * (1 + stop_pct))
            continue

        # no_setup / exited / cancelled: look for a new trigger
        crossed = (not beyond(pc, e1[t - 1])) and beyond(c, e1[t])
        aligned = beyond(e1[t], e2[t]) and beyond(e2[t], e3[t])
        if crossed and aligned:
            go("triggered", t)

    last = n - 1
    out = {
        "state": state,
        "since": dates[since] if events else None,
        "bars": last - since if events else None,
        "trend": "bullish" if e2[last] > e3[last] else "bearish",
        "ema": [round(e1[last], 4), round(e2[last], 4), round(e3[last], 4)],
        "close": close[last],
        "date": dates[last],
        "events": events,
        "trades": trades,
        "bar_dates": dates,
        "series": {"close": close, "ema": [e1, e2, e3]},
    }
    if state == "in_trade":
        if phase == 1:
            stop = extreme * (1 - stop_pct) if up else extreme * (1 + stop_pct)
        else:
            stop = (low if up else high)[last_swing] if last_swing is not None else None
        out.update(entry=entry, entry_date=dates[entry_i], phase=phase, stop=stop)
    return out


def _close_trade(trades, dates, entry_i, entry, t, price, reason, up):
    ret = price / entry - 1 if up else entry / price - 1
    trade = {"entry_date": dates[entry_i], "entry": entry, "exit_date": dates[t], "exit": price,
             "return": ret, "reason": reason, "bars": t - entry_i}
    trades.append(trade)
    return trade


def summary(result):
    """The small part of a result that goes into latest.json for the tables."""
    keys = ("state", "since", "bars", "trend", "entry", "entry_date", "phase", "stop", "date")
    out = {k: result.get(k) for k in keys if result.get(k) is not None}
    for k in ("entry", "stop"):
        if k in out:
            out[k] = round(out[k], 4)
    if result.get("state") == "insufficient":
        out["bars_available"] = result.get("bars_available")
    return out


FEED_STATES = ("triggered", "in_trade", "exited", "cancelled")


def chart_data(result, since):
    """What the detail-page chart needs for one timeframe: bars from `since` on (closes and the
    three EMAs, which were worked out over the full history so they're properly settled), the
    signals in that window, and the current state (with the trailing stop if in a trade)."""
    if result.get("state") == "insufficient" or not result.get("bar_dates"):
        return {"state": result.get("state", "insufficient")}
    dates = result["bar_dates"]
    start = next((i for i, d in enumerate(dates) if d >= since), len(dates))
    r4 = lambda xs: [round(x, 4) for x in xs[start:]]
    return {
        "dates": dates[start:],
        "close": r4(result["series"]["close"]),
        "ema": [r4(e) for e in result["series"]["ema"]],
        "events": [dict({k: (round(v, 4) if isinstance(v, float) else v) for k, v in e.items()})
                   for e in result["events"] if e["date"] >= dates[min(start, len(dates) - 1)] and e["state"] in FEED_STATES],
        "current": summary(result),
    }


def recent_events(result, symbol, timeframe, bars):
    """Signals (triggers, confirmations, exits, cancellations) on the last `bars` bars of a result.

    Each event says whether it happened on the very latest bar ("latest"), i.e. since the last run.
    """
    events = result.get("events") or []
    if not events or not result.get("bar_dates"):
        return []
    window = result["bar_dates"][-bars:]
    first, last = window[0], window[-1]
    out = []
    for e in events:
        if e["state"] in FEED_STATES and first <= e["date"] <= last:
            item = {"symbol": symbol, "tf": timeframe, "state": e["state"], "date": e["date"],
                    "close": round(e["close"], 4), "latest": e["date"] == last}
            for k in ("entry", "stop", "ret"):
                if e.get(k) is not None:
                    item[k] = round(e[k], 4) if k != "ret" else round(e[k], 5)
            for k in ("reason", "entry_date"):
                if e.get(k):
                    item[k] = e[k]
            out.append(item)
    return out


def analyse(dates, close, low, high, settings, today):
    """Weekly and daily results for one share. `today` is the run date ('YYYY-MM-DD')."""
    out = {}
    if settings["timeframes"].get("weekly", True):
        yesterday = (date.fromisoformat(today) - timedelta(days=1)).isoformat()
        wd, wc, wl, wh = weekly_bars(dates, close, low, high, last_complete=yesterday)
        out["weekly"] = run(wd, wc, wl, wh, settings)
    if settings["timeframes"].get("daily", True):
        out["daily"] = run(dates, close, low, high, settings)
    return out
