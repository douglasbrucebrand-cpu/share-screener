"""Works out what changed between runs, from the rows in data/history.json.

  * newly Steady  - has the "Steady" badge now but did not at the previous run
  * top six       - names that entered (and left) a tab's top six since the previous run
  * biggest moves - largest composite changes against the run closest to 7 days ago
                    (or the oldest run available while a week of history builds up)
"""
from datetime import date, timedelta

TREND_RUNS = 30   # how many runs the score-trend sparkline covers
MOVERS = 3        # risers and fallers shown per tab


def tab_order(tab):
    """Tickers in the order they appear in the tab, each once."""
    seen = []
    for g in tab["groups"]:
        for s in g["tickers"]:
            if s not in seen:
                seen.append(s)
    return seen


def top_six(order, rows):
    """Same ranking as the page's cards: composite high to low, ties keep watchlist order."""
    ranked = [s for s in order if s in rows and rows[s].get("composite") is not None]
    ranked.sort(key=lambda s: -rows[s]["composite"])  # sort is stable, like JavaScript's
    return ranked[:6]


def _by_date(hist_rows):
    out = {}
    for r in hist_rows:
        out.setdefault(r["date"], {})[r["symbol"]] = r
    return out


def build(tabs, hist_rows, run_date):
    by_date = _by_date(hist_rows)
    earlier = sorted(d for d in by_date if d < run_date)
    prev = earlier[-1] if earlier else None

    target = (date.fromisoformat(run_date) - timedelta(days=7)).isoformat()
    week_ago = [d for d in earlier if d <= target]
    base = week_ago[-1] if week_ago else (earlier[0] if earlier else None)

    now = by_date.get(run_date, {})
    before = by_date.get(prev, {})
    at_base = by_date.get(base, {})

    out_tabs = {}
    for tab in tabs:
        order = tab_order(tab)
        new_steady = [s for s in order if s in now and s in before
                      and "Steady" in now[s]["badges"] and "Steady" not in before[s]["badges"]]
        t_now, t_prev = top_six(order, now), top_six(order, before)
        moves = [{"symbol": s, "from": at_base[s]["composite"], "to": now[s]["composite"],
                  "change": now[s]["composite"] - at_base[s]["composite"]}
                 for s in order
                 if s in now and s in at_base
                 and now[s]["composite"] is not None and at_base[s]["composite"] is not None]
        risers = sorted((m for m in moves if m["change"] > 0), key=lambda m: -m["change"])[:MOVERS]
        fallers = sorted((m for m in moves if m["change"] < 0), key=lambda m: m["change"])[:MOVERS]
        out_tabs[tab["id"]] = {
            "new_steady": new_steady if prev else [],
            "top6_in": [s for s in t_now if s not in t_prev] if prev else [],
            "top6_out": [s for s in t_prev if s not in t_now] if prev else [],
            "risers": risers,
            "fallers": fallers,
        }
    return {
        "run_date": run_date,
        "previous_date": prev,
        "week_base_date": base,
        "week_days": (date.fromisoformat(run_date) - date.fromisoformat(base)).days if base else None,
        "tabs": out_tabs,
    }


def trends(hist_rows, runs=TREND_RUNS):
    """{symbol: [[date, composite], ...]} for the last `runs` runs (oldest first)."""
    out = {}
    for r in sorted(hist_rows, key=lambda r: r["date"]):
        if r.get("composite") is not None:
            out.setdefault(r["symbol"], []).append([r["date"], r["composite"]])
    return {s: v[-runs:] for s, v in out.items()}
