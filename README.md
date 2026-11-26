# Harbor Watch

Wind, sea state and gale-warning dashboard for a moored boat. Built for an
always-on iPad. No backend, no API keys, no auth.

## How it works

A GitHub Action runs every 10 minutes, fetches from five public sources, merges
them with the previous run's history, and commits `data/latest.json`. GitHub
Pages serves the page and that file. The page reads the file first and falls
back to fetching the browser-reachable sources directly if the file is missing
or stale.

The Action exists for one reason: **NDBC buoy files send no CORS headers**, so a
browser cannot read them. Server-side there is no such restriction, which is how
real on-water wind and wave height get in. It also means NOAA sees one poller
instead of one per open iPad.

Writes come only from the Action. Anyone can read the page and the JSON.

## Sources

| Source | Gives | CORS |
|---|---|---|
| NDBC `realtime2/44013`, `44029` | on-water wind, gusts, wave height, period | **no** — Action only |
| `api.weather.gov/alerts/active` | Gale / Small Craft (marine zones ANZ230 + ANZ251) **and** Coastal Flood / High Wind (land zone MAZ007) | yes |
| `api.weather.gov/stations/KBOS` | live observed wind | yes |
| Open-Meteo | hourly gust forecast, 3 days | yes |
| NOAA CO-OPS `8443970` | water level, tide predictions, surge | yes |
| RainViewer | animated radar tiles | yes |
| NDBC `44098`, `44018`, `IOSN3` | monitoring only — regional wind and seas | **no** — Action only |
| CO-OPS `8444069` Castle Island | monitoring only — waterside wind in Boston Harbor | yes |
| `api.weather.gov/stations/KBVY` | monitoring only — Beverly, north of the harbour | yes |

Monitoring stations never feed the alarm. The ladder stays on the two primary
buoys and KBOS; the extra feeds exist so the spread can be watched. That spread
is the point — Logan and Castle Island, 1 nm apart, routinely differ by several
knots in the same breeze because one anemometer is at an airport and the other
is at the water's edge. None of them is Lynn Harbour itself.

Caveat worth knowing: CO-OPS station 8443970 (Boston) serves water level but
**not** the wind product — that endpoint returns an error. Live wind comes from
KBOS instead.

## Mooring loads

ABYC H-40, the table everyone quotes for ground tackle, covers 20–60 ft. This
boat is 100 ft and ~100 tons, so `scripts/rig.mjs` computes from the drag
equation instead. The only available validation is the one point where the
ranges touch: the method reproduces ABYC's published 50 ft @ 60 kt figure
(6,400 lb) to within 5%, and `test/rig.test.mjs` asserts it.

Lashed to dolphins is the important detail — the vessel cannot weathervane, so
a beam-on wind stays beam-on, and beam-on load is about five times end-on.

The mooring is a mixed set, so the model takes an inventory rather than one
diameter: `1x3, 1x1.25, 7x1` (add `db` for double braid). Nylon lines of similar
length share load roughly in proportion to axial stiffness, which goes as d², and
strength also goes as d² — so a well-set mixed set sits at about the same
utilisation on every line, and the real spread comes from unequal lengths and
angles rather than from size.

**The bow hawser is left out of the beam-on figure by default.** A 3" line on the
bow resists fore-and-aft superbly and athwartships poorly, and counting its
stiffness share abeam would flatter the result badly — it moves estimated failure
from 65 kt to 93 kt.

### Duration, not the gust

A gust lasts seconds and rarely parts anything; hours at high load do. Published
data for wet nylon: creep is the dominant fatigue mechanism above ~30% of
breaking strength, below which life is long and abrasion-limited, and a line can
fail in under 5 hours held at 80%. For cyclic loading the literature treats the
peak as if held continuously, which is the assumption used here. `hoursToFailure`
is a log-linear fit anchored at those two published points, and `cumulativeDamage`
applies Miner's rule across the forecast, so the page can say what a whole blow
costs rather than only how hard the worst gust pulls.

None of this is a survey. Chafe where the lines bear on the dolphins, not tensile
failure, is the usual way mooring lines actually part.

## Data retention

`data/latest.json` is rewritten and committed every 10 minutes, so its size is
multiplied by 144 a day. It therefore holds only 3 days of samples (~42 KB) and
everything older is flushed to `data/archive/YYYY-MM-DD.json` — written **once**,
after that day is over, never rewritten. `data/daily.json` keeps one small line
per day forever: max and mean gust, max wave, max surge, sample count, and which
warnings were in force.

The three days in `latest.json` are deliberate slack: GitHub's scheduler drops
runs, so the flush must be able to pick up a day late without losing samples.

Net churn went **down**, from ~15 MB/day to ~6 MB/day, because the per-run file
shrank by more than the archive adds.

`today_log` inside `latest.json` carries the current day's observations, tide
readings and forecast probes until the day is flushed. Probes record what the
forecast said at +1/3/6/12/24 h, sampled on the half hour, so forecast-vs-observed
can be checked after the fact — the thing no amount of live data can tell you.

## Setup

1. Push this repo to GitHub.
2. Settings → Pages → deploy from `main`, root.
3. Settings → Actions → General → Workflow permissions → **Read and write**.
4. Actions tab → *Collect harbor data* → **Run workflow** to seed the first file.

## Tuning

Everything lives in the Settings panel on the page and persists in
`localStorage` per device: thresholds, the alarm level, the exposed arc, the
observation station and the harbor coordinates.

**Exposed arc** is the compass range the mooring has no shelter from. Default
`20°–120°` is east through northeast, the open-water direction for Lynn Harbor.
Gusts from inside it are outlined on the timeline and the arc is drawn on the
map. 35 kt from the southwest is not the same event as 35 kt from the east.

Site-level defaults (buoy list, zones, history length) are at the top of
`scripts/collect.mjs`.

## Tests

    node test/parser.test.mjs    # 11 — NDBC parsing against a real captured file
    node test/sun.test.mjs       #  7 — sun times vs NWS published values
    node test/archive.test.mjs   #  9 — day flushing, rollup, no-rewrite guarantee
    node test/rig.test.mjs       # 15 — mooring load model, validated against ABYC

The parser assertion that matters: `WVHT` is `MM` on most rows, so it scans down
per-field for the most recent real value instead of trusting the newest row.

The sun assertion that matters: 5 PM on 26 Nov is **dark** at this latitude.
Sunset is 4:14 PM, so the hardcoded 20:00 "night" the page started with was
calling four hours of darkness daylight — on a day the alarm threshold is
crossed after sunset. Times are checked against `astronomicalData` from
`api.weather.gov/points`.

## Not a safety system

GitHub's scheduler is best-effort. The page only updates while it is open. For
anything that matters, the official forecast is at
[marine.weather.gov](https://marine.weather.gov/MapClick.php?zoneid=ANZ230).
