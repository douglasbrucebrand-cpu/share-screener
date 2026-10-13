# Share Screener

A personal share screener. Every weekday morning it scores each share on **momentum** (is the price in a steady,
sustained uptrend?) and **fundamentals** (is revenue growing, and are margins improving?), and publishes the
results as a web page.

- **Site:** https://douglasbrucebrand-cpu.github.io/share-screener/
- **Jump straight to a tab:** add `#my-watchlist`, `#tech-growth` or `#portfolio` to the end of the address
- **Code and data:** https://github.com/douglasbrucebrand-cpu/share-screener

A high score is a *candidate worth your judgement*, not a buy signal. Not investment advice.

---

## Contents

1. [What happens automatically](#1-what-happens-automatically)
2. [Add or remove tickers](#2-add-or-remove-tickers)
3. [Run an update now](#3-run-an-update-now)
4. [If an update fails](#4-if-an-update-fails)
5. [The paper portfolio](#5-the-paper-portfolio)
6. [Putting it on Google Sites](#6-putting-it-on-google-sites)
7. [How the scores work](#7-how-the-scores-work)
8. [Changing settings](#8-changing-settings)
9. [What's in this repository](#9-whats-in-this-repository)
10. [For developers: running it on a computer](#10-for-developers-running-it-on-a-computer)
11. [Saving trades to a Google Sheet](#11-saving-trades-to-a-google-sheet)
12. [Editing the watchlist from the website](#12-editing-the-watchlist-from-the-website)

---

## 1. What happens automatically

| When | What happens |
|---|---|
| **07:00 SAST (05:00 UTC), Tuesday to Saturday** | Fetches the latest prices, scores every share and updates the site. This is after both the JSE and US markets have closed, so each run has the previous day's closing prices. |
| **Whenever `watchlists.json` changes** | The same update runs straight away, so new tickers appear within a couple of minutes. |
| **Once a week, per share** | Annual results and valuation figures (P/E, price-to-sales, market cap) are refreshed. Prices refresh every run. |

Each update first checks that the scoring still matches the original screener. If that check fails, nothing is
published and the site keeps showing the last good data.

The **"Last updated"** time at the top of the page tells you when the last successful update ran. If it is more
than 3 days old, a yellow warning appears. Over a normal weekend it won't, because Saturday's update is less
than 3 days old by Monday evening.

GitHub sometimes starts scheduled updates 5–30 minutes late when its servers are busy. That's normal.

---

## 2. Add or remove tickers

All the tickers live in one file, **`watchlists.json`**.

> **Easiest:** once it's set up, add and remove shares straight from the site with the **Edit watchlist**
> button, with a search by company name. See [section 12](#12-editing-the-watchlist-from-the-website).
> The steps below edit the file on GitHub directly, which you'll still need for adding or renaming tabs.

### Steps

1. Go to https://github.com/douglasbrucebrand-cpu/share-screener/blob/main/watchlists.json
2. Click the **pencil icon** (Edit this file) near the top right of the file.
3. Make your change (see the examples below).
4. Click the green **Commit changes…** button, then **Commit changes** again in the box that appears.
5. Wait about 2 minutes, then refresh the site. The update runs automatically after every change to this file.

### What the file looks like

```json
{
  "tabs": [
    {
      "id": "my-watchlist",
      "name": "My watchlist",
      "groups": [
        {"name": "JSE", "tickers": ["NPN.JO", "PRX.JO", "SBK.JO"]}
      ]
    }
  ],
  "benchmarks": {"USD": "SPY", "ZAR": "STX40.JO"}
}
```

- A **tab** is one of the tabs across the top of the site. It has an `id` (used in links, e.g. `#my-watchlist`:
  lowercase letters and dashes, no spaces), a `name` (what you see), and one or more **groups**.
- A **group** is one table on the page, with a heading (`name`) and a list of `tickers`.
- **benchmarks** are what the paper portfolio compares against. You won't normally need to change these.
- **tracked** (if present) lists shares that have an analyst call but aren't on a watchlist, so the daily
  update fetches their prices. The site adds to it automatically when you tag a call; it holds tickers only.
  Tracked shares don't appear on the tabs. Deleting one just stops its prices updating.

### Examples

**Add a ticker to an existing group.** Add it inside the square brackets, in quotes, with a comma before it:

```json
{"name": "JSE", "tickers": ["NPN.JO", "PRX.JO", "SBK.JO", "MTN.JO"]}
```

**Remove a ticker.** Delete it together with *one* of the commas next to it:

```json
{"name": "JSE", "tickers": ["NPN.JO", "SBK.JO"]}
```

**Add a new group** to a tab. Put a comma after the previous group:

```json
"groups": [
  {"name": "JSE", "tickers": ["NPN.JO", "PRX.JO"]},
  {"name": "US ideas", "tickers": ["MSFT", "GOOGL"]}
]
```

**Add a new tab.** Copy a whole tab block (from `{` to its matching `}`), put a comma between the tabs, and give
the new tab its own `id`:

```json
"tabs": [
  { "id": "tech-growth", "name": "Tech growth", "groups": [ ... ] },
  { "id": "my-watchlist", "name": "My watchlist", "groups": [ ... ] },
  { "id": "dividends", "name": "Dividend ideas", "groups": [ {"name": "JSE", "tickers": ["SOL.JO"]} ] }
]
```

### Ticker symbols

The screener uses **Yahoo Finance** symbols. To check one, search for the company at
https://finance.yahoo.com and copy the symbol shown next to its name.

| Market | How the symbol looks | Example |
|---|---|---|
| JSE (Johannesburg) | code + `.JO` | `NPN.JO` (Naspers), `SBK.JO` (Standard Bank) |
| US (NYSE / Nasdaq) | the plain code | `NVDA`, `MSFT` |
| US class shares | dash, not dot | `BRK-B` |

JSE prices come from Yahoo in cents. The screener converts them to rand for you.

### Good to know

- **The same ticker can appear in more than one group or tab.** It is only fetched once.
- **A wrong or delisted symbol won't break anything.** The share shows with a "no price data" message, and the
  site lists it under "problems on the last run" at the bottom of the page. Fix the symbol and it will
  sort itself out on the next update.
- **A new ticker gets its fundamentals on its first update.** It starts with no score history; its score-trend
  line and "What changed" comparisons build up from the next day.
- **Removing a ticker keeps its past history** in `data/history.json`. Any paper-portfolio trades in it still
  show, but their prices stop updating.
- **Commas are the most common mistake.** Every item in a list is separated by a comma, and there must be *no*
  comma after the last item. If you get one wrong, the update stops and its log says which line to look at
  (see [If an update fails](#4-if-an-update-fails)). The site keeps showing the previous data in the meantime.

---

## 3. Run an update now

You don't normally need to. But if you want fresh data now (for example after a market holiday):

1. Go to https://github.com/douglasbrucebrand-cpu/share-screener/actions/workflows/update-data.yml
2. Click **Run workflow** (a grey button on the right), then the green **Run workflow** button.
   - Tick **"Also refresh fundamentals now"** only if you want annual results and valuations refreshed before
     their weekly refresh, e.g. just after a company publishes results.
3. A new line appears in the list after a few seconds. It takes about a minute. A green ✓ means it worked.
4. Refresh the site about a minute later.

This also works from the **GitHub app** on your phone: open the repository → **Actions** →
**Update screener data** → **Run workflow**.

> **Seeing an old page after an update?** Your browser may be showing a saved copy. Press **Cmd + Shift + R**
> (Mac) or **Ctrl + Shift + R** (Windows) to reload it fresh. On a phone, close the tab and open the link again.

---

## 4. If an update fails

**Nothing is lost.** The site keeps showing the last good data, and the next scheduled update tries again.

### How you'll know

- GitHub emails your GitHub account address with a subject like *"Run failed: Update screener data"*.
- The Actions page shows a red ✗: https://github.com/douglasbrucebrand-cpu/share-screener/actions
- If updates stop for more than 3 days, the site shows a yellow "this data is N days old" warning.

### Finding out why

1. Open https://github.com/douglasbrucebrand-cpu/share-screener/actions and click the failed run (red ✗).
2. Click **update** in the left-hand list.
3. The step that failed has a red ✗. Click it to open its log, then scroll to the bottom for the error.

### Common problems and fixes

| Failed step / message | What it means | What to do |
|---|---|---|
| **Fetch data and score**: `PROBLEM WITH watchlists.json: … typo near line 12 …` | A typing mistake in `watchlists.json`, usually a missing or extra comma or quote mark. | Open `watchlists.json`, look at that line and the one above it, fix it and commit. The update re-runs by itself. |
| **Fetch data and score**: `PROBLEM WITH watchlists.json: … id "…" is already used` | Two tabs have the same `id` (or one is called `portfolio`, which is reserved). | Give each tab its own `id`. |
| **Check scoring still matches the original** | The scoring code was changed and no longer matches the original screener's maths. | Undo the most recent change to the files in `pipeline/`. The scoring is meant to stay exactly as the original. |
| **Fetch data and score**: lots of `download failed` / `Too Many Requests` / `no price data returned` | Yahoo Finance is having problems or is limiting requests. It usually fixes itself. | Wait a few hours and [run it again](#3-run-an-update-now). |
| The same Yahoo errors **every day for several days** | Yahoo has probably changed something and the `yfinance` library needs updating. | See *Updating yfinance* below. |
| **Commit updated data** fails | Rare: two updates tried to save at the same moment. | Run it again. |
| **Install** fails | GitHub or the Python package index had a temporary problem. | Run it again later. |

**One or two tickers failing is not a failed update.** The update still succeeds. Those tickers keep their
previous data, show "price update failed · shown as at DD/MM/YYYY" under their name, and appear in the
"problems on the last run" list at the bottom of the page. A ticker that keeps failing has usually been
delisted or renamed: check its symbol on Yahoo Finance.

### Updating yfinance

`yfinance` is the free library that reads Yahoo Finance. When Yahoo changes its website, a newer version
usually fixes it within days.

1. Check https://pypi.org/project/yfinance/ for the latest version number.
2. Edit `requirements.txt` on GitHub (pencil icon) and change the `yfinance` line, e.g. from
   `yfinance>=1.2,<2` to `yfinance>=2.0,<3` if version 2.x is out.
3. Commit. The update runs by itself with the new version.

### If the daily updates stop altogether

GitHub can pause scheduled updates on repositories it thinks are inactive. The daily data commits should
count as activity, but if you ever see a yellow banner on the Actions page saying the workflow is disabled,
click **Enable workflow**.

---

## 5. The paper portfolio

The **Paper portfolio** tab lets you practise. Press **Simulate buy** on any share (last column of the table,
or on its detail page). It records the latest close, the amount (R10,000 or $1,000 unless you change it) and
the share's composite score at that moment.

For each position you see the return since you "bought", the benchmark's return over the same period
(**SPY** for US shares, **STX40** for JSE shares), the composite then and now, and a chart of its value.
**Close position** sells at the latest close and moves it to the closed-trades list. Returns include
dividends for both the share and the benchmark, so the comparison is fair.

**Where trades are kept.** Trades are never sent to GitHub. There are two options:

- **Your Google Sheet (recommended).** Connect a sheet once on each device (see
  [section 11](#11-saving-trades-to-a-google-sheet)), and your Mac, phone and Google Sites embed all show the
  same trades. You can also sort, filter and chart them in Sheets.
- **This browser only** (what happens if you don't connect a sheet). Each browser keeps its own separate list,
  and clearing your browser's history or website data deletes it.

Either way, **Export** saves your trades to a file and **Import** loads one back (replacing the current list,
and the sheet's list too if one is connected). Use these for an extra backup.

If the page says *"This browser is blocking storage here"*, the browser can't remember anything after you
close the page. This can happen inside some embeds or private-browsing windows. With a sheet connected,
your trades are safe; you'll just need to connect again next visit. Without one, export before leaving.

---

## 6. Putting it on Google Sites

1. Open your site in the Google Sites editor.
2. In the right-hand panel choose **Insert → Embed**.
3. On the **By URL** tab, paste `https://douglasbrucebrand-cpu.github.io/share-screener/`, choose
   **Whole page**, then **Insert**.
4. Drag the embed box's bottom edge down to make it tall (the screener is a long page), and stretch it to full
   width.
5. Click **Publish**.

To open the embed on a particular tab, use the address with `#my-watchlist` (or another tab's `id`) on the
end. On phones, Google Sites shows embeds at a fixed height, so you may also want a button on that page that
links to the site address directly.

---

## 7. How the scores work

Click any ticker on the site to see its detail page. It shows every rule, whether it passed, and the points it
earned.

**Momentum (out of 100)**

| Rule | Points |
|---|---|
| Price above its 50-day average | 20 |
| 20-day average above the 50-day average | 15 |
| 50-day average higher than 20 trading days ago | 15 |
| 1-month return (full 20 points at +12% or more; scaled below that; none if negative) | up to 20 |
| Steady: the worst dip in the last month is smaller than 8% | 15 |
| Volume rising: 10-day average volume at least 5% above the 50-day | 10 |
| Not stretched: price less than 25% above its 50-day average (over 35% shows an "Overextended" warning) | 5 |

**Fundamentals (out of 100)**, from the last few years of annual results

| Rule | Points |
|---|---|
| Revenue growth in the latest year (full 50 points at +30% or more; scaled below that) | up to 50 |
| Growth accelerating: faster than the year before | 25 |
| Gross margin higher than the year before | 25 |

Banks don't report gross profit, so they can't earn the gross-margin points.

**Composite = 0.6 × momentum + 0.4 × fundamentals**, rounded. If a company has fewer than 2 years of results
(common for young or loss-making companies), the composite is the momentum score alone.

**Expensive badge:** forward P/E above 40, or price-to-sales above 10 when no profit is expected. It is a
warning label only and never changes the score.

These rules are an exact copy of the original `tech-growth-screener.html`. An automatic test checks the two
give identical answers before every update.

---

## 8. Changing settings

These are edits to code files. They are small, but make one change at a time and check the next update
succeeds.

| To change | File | What to look for |
|---|---|---|
| The **Expensive** thresholds | `run_screener.py` | `EXPENSIVE_FWD_PE = 40` and `EXPENSIVE_PS_LOSSMAKER = 10` near the top |
| How often fundamentals refresh | `run_screener.py` | `FUND_MAX_AGE = timedelta(days=7)` |
| When the update runs | `.github/workflows/update-data.yml` | `cron: "0 5 * * 2-6"`, which means minute 0, hour 5 (**UTC**, so SAST minus 2 hours), Tuesday (2) to Saturday (6) |
| The "data is old" warning (3 days) | `app.js` and `ticker.js` | `const STALE_DAYS = 3;` |
| Default paper-trade amounts | `portfolio.js` | `DEFAULT_AMOUNT = {ZAR: 10000, USD: 1000}` |

**After changing any `.js` or `.css` file**, also raise the `?v=` number on every line that loads those files
in `index.html` and `ticker.html`, and in the `loadMissing` section at the end of `app.js` (e.g. `?v=12` →
`?v=13`). This makes browsers fetch the new version instead of reusing a saved copy.

Don't change the scoring rules in `pipeline/scoring.py`: they are meant to match the original screener
exactly, and the update will refuse to run if they don't.

---

## 9. What's in this repository

The repository is **public**. It contains only code, the ticker lists and public market data. There are no
API keys, no holdings and no amounts, and paper-portfolio trades never leave your browser.

| Path | What it is |
|---|---|
| `watchlists.json` | **Your tabs, groups and tickers.** The file you'll edit most. |
| `index.html`, `app.js` | The main screener page and the paper portfolio tab |
| `ticker.html`, `ticker.js` | The detail page for one share |
| `common.js`, `chart.js`, `portfolio.js`, `style.css` | Shared formatting, charts, the paper portfolio and styling |
| `watchlist.js` | The **Edit watchlist** button: add and remove shares from the site (section 12) |
| `calls.js` | The **Calls** tab and **Tag a call**: analyst calls, kept in your Google Sheet (or browser), never in this repository |
| `google-sheet/Code.gs` | The script you paste into your Google Sheet: stores paper trades (section 11) and analyst calls, and saves watchlist edits to GitHub (section 12) |
| `run_screener.py` | The update script: fetches, scores and writes the data files |
| `pipeline/fetch.py` | Talks to Yahoo Finance (prices, results, exchange rates) |
| `pipeline/scoring.py` | The scoring rules (exact copy of the original) and the rule-by-rule breakdown |
| `pipeline/changes.py` | Works out "What changed" and the score trends |
| `data/latest.json` | Latest scores, signals and valuations, written by each update |
| `data/history.json` | One row per share per update date: price, scores and badges |
| `data/prices/<TICKER>.json` | About 2 years of daily closing prices and volume per share |
| `data/fundamentals.json` | Saved annual results and valuations (refreshed weekly) |
| `tests/` | Automatic checks, run before every update |
| `.github/workflows/update-data.yml` | The schedule and steps of the automatic update |
| `requirements.txt` | The Python libraries the update needs |

---

## 10. For developers: running it on a computer

You don't need this for normal use. It's for working on the code.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python run_screener.py                          # fetch, score, write data/
.venv/bin/python run_screener.py --refresh-fundamentals   # also force fundamentals
.venv/bin/python -m unittest -v tests.test_parity tests.test_changes tests.test_breakdown tests.test_watchlists tests.test_sheet_script tests.test_calls_js tests.test_market_hours tests.test_tracked
python3 -m http.server 8000                               # then open http://localhost:8000
```

The parity test needs Node.js, because it runs the original JavaScript scoring (copied word for word into
`tests/reference_scoring.js`) and checks that the Python gives exactly the same answers. Node also runs the
Google Sheet script tests, which use a stand-in for Google Sheets (`tests/sheet_mock.js`). To try the site
against that stand-in, run `node tests/sheet_mock_server.js 8771 some-test-phrase` and connect the site to
`http://localhost:8771/exec`.

If you run the update locally, pull first (`git pull`) and push soon after. The automatic update also
commits to `data/`, and two sets of data changes can clash.

---

## 11. Saving trades to a Google Sheet

Optional, but recommended. Once connected, every **Simulate buy**, **Close** and **Delete** is saved to a
Google Sheet in your own Google account, and every device you connect shows the same trades. The sheet is
private to you; nothing about trades goes to GitHub.

### One-time setup (about 10 minutes, on a computer)

1. **Create the sheet.** Signed in to Google, go to https://sheets.new and name the new sheet
   *Paper portfolio* (click "Untitled spreadsheet" at the top left).
2. **Open the script editor.** In the sheet's menu choose **Extensions → Apps Script**. A new tab opens with a
   code editor.
3. **Paste the script.** Delete everything in the editor. Then open
   https://github.com/douglasbrucebrand-cpu/share-screener/blob/main/google-sheet/Code.gs, click the
   **Copy raw file** button (two overlapping squares, top right of the code), and paste it into the editor.
4. **Choose your passphrase** and store it in the script's private settings. Click **Save** (the disk icon)
   first, then in the left-hand bar click **Project Settings** (the gear icon) → **Script Properties** →
   **Add script property**. Property: `PASSPHRASE`, Value: a phrase of your own, e.g. `blue kettle jazz 47`.
   **Don't use your Google password** or anything you use elsewhere. Click **Save script properties**.
   *(Older instructions had you type it into the `const PASSPHRASE = 'CHANGE-ME';` line instead. That still
   works, but with the property you never have to edit the code when it's updated.)*
5. **Publish it as a web app.** Click the blue **Deploy** button (top right) → **New deployment**. Click the
   gear next to *Select type* and choose **Web app**. Set:
   - Description: `Screener`
   - Execute as: **Me**
   - Who has access: **Anyone**

   Then click **Deploy**.
6. **Give permission.** Google asks you to authorise the script: **Authorize access** → choose your account.
   You will see *"Google hasn't verified this app"*. That's expected for a script you wrote yourself. Click
   **Advanced** → **Go to … (unsafe)** → **Allow**. The script can only use this one spreadsheet.
7. **Copy the web app address.** Google shows a *Web app* URL ending in `/exec`. Click **Copy**, then **Done**.
   (You can test it by opening the address in a new tab: it should say *"This web app is working"*.)
8. **Connect the site.** On the site, open the **Paper portfolio** tab → **Connect Google Sheet**. Paste the
   address and type your passphrase. If you already have trades in that browser, leave **"Copy the … trades
   into the sheet"** ticked so they move across. Click **Connect**.
9. **Connect your other devices.** On your phone, and inside the Google Sites embed, do step 8 again with the
   same address and passphrase, this time with "Copy" unticked unless that browser has trades of its own.

Keep the address and passphrase somewhere safe (a password manager is ideal). Together they let someone read
and change your paper trades, though nothing else in your Google account.

### Everyday use

At the top of the Paper portfolio tab you'll see one of:

| Message | Meaning |
|---|---|
| ✓ Saved to Google Sheet "Paper portfolio" · 10:42 | Everything is saved. The time is the last save. |
| Saving to Google Sheet… | A change is on its way. Takes a second or two. |
| ⚠ 1 change not yet saved to the sheet. Will retry. | The sheet couldn't be reached (e.g. you're offline). The change is kept in the browser and sent next time you open the page or press **Sync now**. |
| ⚠ Couldn't load from the sheet; showing this browser's copy. | The page shows the copy saved in the browser. Press **Sync now** to try again. |

**Open sheet** opens the spreadsheet. The **Trades** tab has one row per trade. You can add your own columns to
the right of the existing ones (notes, say); the script leaves them alone. Don't rename the column headings
or change the *Trade ID* column, because that's how the site matches rows to trades.

**Disconnect** stops this browser using the sheet. The sheet isn't changed, and the browser keeps its own copy.

### If something goes wrong

| Message | What to do |
|---|---|
| *Wrong passphrase.* | Retype it. It must match the `PASSPHRASE` line in the script exactly, including capitals and spaces. |
| *The script still has the example passphrase…* | Do step 4, then publish the change (see *Changing the script or passphrase* below). |
| *Couldn't reach the sheet. Check you're online, and that the web app's access is set to "Anyone".* | If you're online: in Apps Script, **Deploy → Manage deployments → pencil icon**, check *Who has access* is **Anyone**, then **Deploy**. |
| *That isn't an Apps Script web app address.* | Paste the address from step 7 (it starts `https://script.google.com/macros/s/` and ends `/exec`), not the spreadsheet's own address. |
| *Your Google Sheet script is an older version…* | The new code was saved but not deployed. **Deploy → Manage deployments → pencil → Version: New version → Deploy**. (Saving alone doesn't change the live web app; and don't use *New deployment*, which makes a new address.) |

### Updating the script to a new version

When the site gains features that need the script (like analyst calls), update it like this:

1. **If your passphrase is typed into the code** (the `const PASSPHRASE = '…'` line rather than a script
   property), move it to a property first: **Project Settings → Script Properties → Add script property**,
   `PASSPHRASE` = your phrase, **Save script properties**. Your passphrase doesn't change.
2. Click **Editor** (`< >`), replace all the code with the latest
   [Code.gs](https://github.com/douglasbrucebrand-cpu/share-screener/blob/main/google-sheet/Code.gs)
   (Copy raw file), and **Save**. Leave its `PASSPHRASE` line as `CHANGE-ME`; the property is used instead.
3. **Deploy → Manage deployments → pencil icon → Version: New version → Deploy.** If Google asks for
   permission again, approve it as in step 6.

The web app address stays the same, so nothing on the site needs reconnecting.

### Changing the passphrase

Change the `PASSPHRASE` script property, then press **Disconnect** and **Connect Google Sheet** on each
device and enter the new one. (No new deployment is needed for a property change.)

To cut off access completely, use **Deploy → Manage deployments → Archive**.

---

## 12. Editing the watchlist from the website

With this set up, each watchlist tab has an **Edit watchlist** button. It lets you:

- **Add a share:** press **+ Add** on a group (or **+ Add share**), type a company name or symbol, and press
  **Search**. Pick the right result, then choose a group (or **+ New group…**) and press **Add share**. Each
  result shows its exchange, because names can clash: *MTN* finds both MTN Group on the JSE (`MTN.JO`) and
  Vail Resorts in New York (`MTN`).
- **Remove a share:** press **Remove** under its name. Its past scores are kept, and you can add it back at
  any time. Removing the last share in a group removes the group too.

The change is saved to `watchlists.json` on GitHub straight away, the automatic update runs, and about
2 minutes later the new scores appear. Until then the share shows as *"being added"*, and the page
refreshes itself when the update has finished. Each change appears in the repository's history as
*"Watchlist: add MTN.JO to My watchlist / JSE (from the website)"*.

It works through your Google Sheet connection ([section 11](#11-saving-trades-to-a-google-sheet)), so set
that up first. The script then needs a **GitHub key** that lets it edit this one project.

### One-time setup (about 5 minutes, on a computer)

**A. Make the GitHub key**

1. Signed in to GitHub, go to https://github.com/settings/personal-access-tokens/new
2. **Token name:** `Screener watchlist`. **Expiration:** choose a date, e.g. 1 year (the site tells you when it
   has expired; then just make a new one).
3. **Repository access:** choose **Only select repositories** and pick **share-screener**.
4. **Permissions → Repository permissions → Contents:** set to **Read and write**. Leave everything else as it is.
5. Click **Generate token** and **copy** it (it starts with `github_pat_`). GitHub only shows it once.

This key can only change files in share-screener; it can't touch your other projects or your account.

**B. Give the key to your script**

6. Open your sheet → **Extensions → Apps Script**.
7. In the left-hand bar click **Project Settings** (the gear icon). Scroll to **Script Properties** →
   **Add script property**. Property: `GITHUB_TOKEN`, Value: paste the key. Click **Save script properties**.

The key stays inside your Google account. It isn't in the script's code, on the website or on GitHub.

**C. Update the script**

8. Click **Editor** (the `< >` icon). **First, note your passphrase** from the `const PASSPHRASE = '…';` line.
9. Replace all the code with the latest version from
   https://github.com/douglasbrucebrand-cpu/share-screener/blob/main/google-sheet/Code.gs (Copy raw file, as
   before), then **put your passphrase back** in the `PASSPHRASE` line. Click **Save**.
10. **Deploy → Manage deployments**, click the **pencil icon**, set *Version* to **New version**, click **Deploy**.
11. Google should ask for permission again, because the script now also talks to GitHub and Yahoo:
    **Authorize access** → your account → **Advanced** → **Go to … (unsafe)** → **Allow**. **If it doesn't
    ask**, give the permission yourself: in the **Editor**, choose **doGet** in the function menu above the
    code, press **Run**, then **Review permissions** and allow as above.

The web app address doesn't change, so you don't need to reconnect anything. Open a watchlist tab on the site
and press **Edit watchlist**.

### If something goes wrong

| Message | What to do |
|---|---|
| *The script has no GitHub key yet…* | Do step 7. The property name must be exactly `GITHUB_TOKEN`. |
| *GitHub says the key is wrong or has expired…* | Make a new key (steps 1–5) and replace the value in step 7. |
| *GitHub says the key is not allowed to edit share-screener…* | The key needs **Contents: Read and write** on **share-screener** (steps 3–4). Edit the key on GitHub, or make a new one. |
| *The script needs one more Google permission…* (or *"You do not have permission to call UrlFetchApp.fetch"*) | Google didn't ask for the new permission when you deployed. In Apps Script's **Editor**, choose **doGet** in the function menu above the code, press **Run**, then **Review permissions** → your account → **Advanced** → **Go to … (unsafe)** → **Allow**. No redeploy needed. |
| *Yahoo's search isn't answering right now…* | Type the exact Yahoo symbol (e.g. `MTN.JO`) and pick **Use exactly as typed**. |
| *Wrong passphrase.* (after updating the script) | The passphrase wasn't put back in step 9. Fix the line, save, and do step 10 again. |
| The share still says *"being added"* after 10 minutes | Check the [Actions page](https://github.com/douglasbrucebrand-cpu/share-screener/actions) for a failed update, then see section 4. |

To switch this off, delete the `GITHUB_TOKEN` script property, or delete the key on GitHub at
https://github.com/settings/personal-access-tokens
