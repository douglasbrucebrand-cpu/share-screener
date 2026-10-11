"""Everything that talks to Yahoo Finance (via yfinance) lives here."""
import math
import time
import warnings

import pandas as pd
import yfinance as yf

warnings.filterwarnings("ignore")

# Some exchanges quote in the minor unit (cents/pence). Map to (major currency, divisor).
MINOR_UNITS = {"ZAc": ("ZAR", 100), "ZAC": ("ZAR", 100), "GBp": ("GBP", 100), "GBX": ("GBP", 100), "ILA": ("ILS", 100)}
SUFFIX_GUESS = {".JO": "ZAc", ".L": "GBp"}


def quote_unit(symbol, raw_currency=None):
    """Return (major_currency, divisor) for a ticker's price feed."""
    raw = raw_currency
    if not raw:
        raw = next((cur for suf, cur in SUFFIX_GUESS.items() if symbol.upper().endswith(suf)), "USD")
    return MINOR_UNITS.get(raw, (raw, 1))


def _clean(x):
    """Turn NaN / inf / numpy numbers into plain floats or None."""
    if x is None:
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


# ---------- prices ----------

def _download(symbols):
    return yf.download(
        symbols, period="2y", interval="1d", group_by="ticker",
        auto_adjust=True, threads=True, progress=False,
    )


def _extract(df, symbol):
    """Pull one ticker's (date, close, volume) rows out of a batch download."""
    if df is None or df.empty:
        return None
    try:
        sub = df[symbol] if isinstance(df.columns, pd.MultiIndex) else df
    except KeyError:
        return None
    if "Close" not in sub:
        return None
    sub = sub[["Close", "Volume"]].dropna(subset=["Close"])
    if sub.empty:
        return None
    return [
        (idx.strftime("%Y-%m-%d"), float(row.Close), 0 if pd.isna(row.Volume) else int(row.Volume))
        for idx, row in sub.iterrows()
    ]


def fetch_prices(symbols, attempts=4, base_delay=5):
    """Batch-download ~2 years of daily closes and volume.

    Retries the tickers that came back empty, waiting longer each time
    (5s, 15s, 45s). Returns ({symbol: rows}, {symbol: error message}).
    """
    got, pending, last_err = {}, list(symbols), {}
    for attempt in range(attempts):
        if not pending:
            break
        if attempt:
            wait = base_delay * 3 ** (attempt - 1)
            print(f"  retrying {len(pending)} ticker(s) in {wait}s: {', '.join(pending)}")
            time.sleep(wait)
        try:
            df = _download(pending)
        except Exception as e:  # network trouble, rate limit, etc.
            for s in pending:
                last_err[s] = f"download failed: {e}"[:200]
            continue
        still = []
        for s in pending:
            rows = _extract(df, s)
            if rows:
                got[s] = rows
            else:
                still.append(s)
                last_err[s] = "no price data returned"
        pending = still
    return got, {s: last_err.get(s, "no price data returned") for s in pending}


# ---------- fundamentals & valuation ----------

def _income_rows(stmt):
    """Annual income statement -> list of {period_end, rev, gp, ni}, newest first, max 4."""
    if stmt is None or stmt.empty:
        return []
    cols = sorted(stmt.columns, reverse=True)[:4]

    def get(label, col):
        return _clean(stmt.at[label, col]) if label in stmt.index else None

    rows = [
        {"period_end": pd.Timestamp(c).strftime("%Y-%m-%d"),
         "rev": get("Total Revenue", c), "gp": get("Gross Profit", c), "ni": get("Net Income", c)}
        for c in cols
    ]
    # Yahoo sometimes adds an older column with nothing in it; drop trailing empty years.
    while rows and rows[-1]["rev"] is None and rows[-1]["ni"] is None:
        rows.pop()
    return rows


def fetch_fundamentals(symbol, attempts=3, base_delay=3):
    """Return a dict with name, currencies, income rows and raw valuation fields.

    Raises an exception if nothing usable came back after retries.
    """
    last = None
    for attempt in range(attempts):
        if attempt:
            time.sleep(base_delay * 2 ** (attempt - 1))
        try:
            tk = yf.Ticker(symbol)
            info = tk.info or {}
            if not (info.get("currency") or info.get("shortName")):
                raise ValueError("empty quote info")
            try:
                income = _income_rows(tk.income_stmt)
            except Exception:
                income = []
            return {
                "name": info.get("shortName") or info.get("longName") or symbol,
                "quote_currency_raw": info.get("currency"),
                "financial_currency": info.get("financialCurrency"),
                "income": income,
                "trailing_pe": _clean(info.get("trailingPE")),
                "forward_pe": _clean(info.get("forwardPE")),
                "market_cap": _clean(info.get("marketCap")),
                "total_revenue": _clean(info.get("totalRevenue")),
                "yahoo_price_to_sales": _clean(info.get("priceToSalesTrailing12Months")),
            }
        except Exception as e:
            last = e
    raise RuntimeError(f"fundamentals failed: {last}"[:200])


def fetch_fx(pairs):
    """pairs: set of (from_ccy, to_ccy). Returns {(from, to): rate}."""
    out = {}
    for a, b in pairs:
        if a == b:
            out[(a, b)] = 1.0
            continue
        for attempt in range(3):
            try:
                df = yf.download(f"{a}{b}=X", period="5d", progress=False, auto_adjust=True)
                close = df["Close"].dropna()
                if isinstance(close, pd.DataFrame):
                    close = close.iloc[:, 0]
                if len(close):
                    out[(a, b)] = float(close.iloc[-1])
                    break
            except Exception:
                pass
            time.sleep(2 * (attempt + 1))
    return out
