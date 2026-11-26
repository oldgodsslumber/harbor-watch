// Harbor Watch collector. Runs in GitHub Actions, writes data/latest.json.
// Server-side so it can read sources the browser can't (NDBC sends no CORS
// headers). Everything here is keyless and public.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { summarize } from './ndbc.mjs';

const OUT = 'data/latest.json';
const UA  = { 'User-Agent': 'HarborWatch/1.0 (github actions; personal mooring monitor)' };
const HARBOR = { lat: 42.465, lon: -70.945, name: 'Lynn Harbor' };
const BUOYS = [
  { id: '44013', name: 'Boston Approach (16 NM E)', lat: 42.35, lon: -70.651 },
  { id: '44029', name: 'Buoy A01 — Massachusetts Bay', lat: 42.523, lon: -70.566 }
];
// Marine zones carry Gale/Small Craft. Coastal Flood and High Wind warnings are
// issued on the LAND zone (MAZ007, Eastern Essex) — a surge-on-high-tide event,
// exactly what the tide module exists to catch, appears only there.
const ZONES = 'ANZ230,ANZ251,MAZ007';
const OBS_STATION = 'KBOS';
const TIDE_STATION = '8443970';
const HISTORY_DAYS = 7;

const errors = [];
async function j(url, opts = {}) {
  const r = await fetch(url, { headers: { ...UA, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return opts.text ? r.text() : r.json();
}
async function tryGet(label, fn) {
  try { return await fn(); }
  catch (e) { errors.push(label + ': ' + e.message); console.error('!! ' + label, e.message); return null; }
}

/* ---------- sources ---------- */
const buoys = {};
for (const b of BUOYS) {
  const s = await tryGet('ndbc ' + b.id, async () => {
    const txt = await j('https://www.ndbc.noaa.gov/data/realtime2/' + b.id + '.txt', { text: true });
    return summarize(txt, b);
  });
  if (s) buoys[b.id] = s;
}

const obs = await tryGet('nws obs', async () => {
  const p = (await j('https://api.weather.gov/stations/' + OBS_STATION + '/observations/latest',
    { headers: { Accept: 'application/geo+json' } })).properties;
  const kt = o => {
    if (!o || o.value == null) return null;
    const u = o.unitCode || '';
    if (u.includes('km_h')) return +(o.value / 1.852).toFixed(1);
    if (u.includes('m_s')) return +(o.value * 1.94384).toFixed(1);
    return o.value;
  };
  return {
    station: OBS_STATION, name: p.stationName, observed_at: p.timestamp,
    sustained_kt: kt(p.windSpeed), gust_kt: kt(p.windGust),
    dir_deg: p.windDirection?.value ?? null,
    text: p.textDescription || null
  };
});

const alerts = await tryGet('nws alerts', async () => {
  const g = await j('https://api.weather.gov/alerts/active?zone=' + ZONES,
    { headers: { Accept: 'application/geo+json' } });
  const rank = { 'Hurricane Force Wind Warning': 8, 'Storm Warning': 7, 'Gale Warning': 6,
                 'Coastal Flood Warning': 6, 'High Wind Warning': 5,
                 'Special Marine Warning': 5, 'Coastal Flood Advisory': 4,
                 'Freezing Spray Advisory': 4, 'High Wind Watch': 3,
                 'Small Craft Advisory': 3, 'Coastal Flood Watch': 3 };
  return (g.features || [])
    .map(f => f.properties)
    .sort((a, b) => (rank[b.event] || 1) - (rank[a.event] || 1))
    .map(p => ({ event: p.event, area: p.areaDesc, severity: p.severity,
                 onset: p.onset || p.effective, ends: p.ends || p.expires,
                 headline: p.headline, description: p.description, instruction: p.instruction }));
});

const forecast = await tryGet('open-meteo', async () => {
  const d = await j('https://api.open-meteo.com/v1/forecast?latitude=' + HARBOR.lat +
    '&longitude=' + HARBOR.lon +
    '&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation' +
    '&wind_speed_unit=kn&forecast_days=3&timezone=America%2FNew_York');
  return d.hourly.time.map((t, i) => ({
    t, s: d.hourly.wind_speed_10m[i], g: d.hourly.wind_gusts_10m[i],
    d: d.hourly.wind_direction_10m[i], p: d.hourly.precipitation[i]
  }));
});

const tide = await tryGet('co-ops', async () => {
  const base = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=' +
    TIDE_STATION + '&units=english&time_zone=lst_ldt&format=json&datum=MLLW';
  // Window the prediction series around now: 6 h back, 36 h forward. `date=today`
  // silently ignores `range`, so begin_date is required for a forward window.
  const d = new Date(Date.now() - 6 * 3600e3);
  const p2 = n => String(n).padStart(2, '0');
  const begin = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) +
    ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  const q = '&begin_date=' + encodeURIComponent(begin) + '&range=42';

  const [wl, pred, hl] = await Promise.all([
    j(base + '&product=water_level&date=latest').catch(() => null),
    j(base + '&product=predictions' + q).catch(() => null),          // 6-minute grid
    j(base + '&product=predictions&interval=hilo' + q).catch(() => null)
  ]);

  const toMs = t => new Date(t.replace(' ', 'T')).getTime();
  const series = (pred?.predictions || [])
    .map(x => ({ t: x.t, v: +x.v }))
    .filter(x => Number.isFinite(x.v));

  const obs = wl?.data?.[0] ? { t: wl.data[0].t, v: +wl.data[0].v } : null;

  // Surge must compare like-for-like instants. `date=latest` on the two products
  // can land on different timestamps, so interpolate the prediction AT the
  // observation's own time instead of trusting two "latest" calls to agree.
  let predAtObs = null;
  if (obs && series.length) {
    const target = toMs(obs.t);
    let lo = null, hi = null;
    for (const p of series) {
      const ms = toMs(p.t);
      if (ms <= target && (!lo || ms > toMs(lo.t))) lo = p;
      if (ms >= target && (!hi || ms < toMs(hi.t))) hi = p;
    }
    if (lo && hi) {
      const a = toMs(lo.t), b = toMs(hi.t);
      predAtObs = b === a ? lo.v : lo.v + (hi.v - lo.v) * ((target - a) / (b - a));
      predAtObs = +predAtObs.toFixed(3);
    }
  }

  return {
    station: TIDE_STATION,
    observed_ft: obs ? obs.v : null,
    observed_at: obs ? obs.t : null,
    predicted_ft: predAtObs,
    surge_ft: obs && predAtObs != null ? +(obs.v - predAtObs).toFixed(2) : null,
    series,
    extremes: (hl?.predictions || []).map(x => ({ t: x.t, v: +x.v, type: x.type }))
  };
});

/* ---------- merge rolling history ---------- */
let prev = null;
try { prev = JSON.parse(readFileSync(OUT, 'utf8')); } catch { /* first run */ }

const cutoff = Date.now() - HISTORY_DAYS * 864e5;
const history = {};
for (const id of Object.keys(buoys)) {
  const map = new Map();
  for (const s of (prev?.history?.[id] || [])) map.set(s.t, s);
  for (const s of (buoys[id].samples || [])) map.set(s.t, s);   // new wins
  history[id] = [...map.values()]
    .filter(s => new Date(s.t).getTime() >= cutoff)
    .sort((a, b) => new Date(b.t) - new Date(a.t));
  delete buoys[id].samples;  // history holds the series; keep latest.json lean
}

// peak gust seen in the stored window, per buoy
const peaks = {};
for (const [id, arr] of Object.entries(history)) {
  const w = arr.filter(s => s.g != null);
  if (w.length) {
    const m = w.reduce((a, b) => (b.g > a.g ? b : a));
    peaks[id] = { gust_kt: m.g, at: m.t };
  }
}

const out = {
  generated_at: new Date().toISOString(),
  harbor: HARBOR,
  buoys, obs, alerts, forecast, tide,
  peaks_7d: peaks,
  history,
  stale: false,
  errors
};

mkdirSync('data', { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1));
const n = Object.values(history).reduce((a, b) => a + b.length, 0);
console.log('wrote ' + OUT + ' — buoys:' + Object.keys(buoys).length +
  ' alerts:' + (alerts?.length ?? 'n/a') + ' history:' + n + ' errors:' + errors.length);
// Only fail the run if we got nothing useful at all.
if (!Object.keys(buoys).length && !obs) { console.error('no usable data'); process.exit(1); }
