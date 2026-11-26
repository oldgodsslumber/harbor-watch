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
| `api.weather.gov/alerts/active` | Gale / Small Craft warnings, zones ANZ230 + ANZ251 | yes |
| `api.weather.gov/stations/KBOS` | live observed wind | yes |
| Open-Meteo | hourly gust forecast, 3 days | yes |
| NOAA CO-OPS `8443970` | water level, tide predictions, surge | yes |
| RainViewer | animated radar tiles | yes |

Caveat worth knowing: CO-OPS station 8443970 (Boston) serves water level but
**not** the wind product — that endpoint returns an error. Live wind comes from
KBOS instead.

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

    node test/parser.test.mjs

11 assertions against a real captured buoy file. The one that matters: `WVHT`
is `MM` on most rows, so the parser scans down per-field for the most recent
real value instead of trusting the newest row.

## Not a safety system

GitHub's scheduler is best-effort. The page only updates while it is open. For
anything that matters, the official forecast is at
[marine.weather.gov](https://marine.weather.gov/MapClick.php?zoneid=ANZ230).
