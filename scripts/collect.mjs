// Harbor Watch collector. Runs in GitHub Actions, writes data/latest.json.
// Server-side so it can read sources the browser can't (NDBC sends no CORS
// headers). Everything here is keyless and public.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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

// Monitoring-only stations. These do NOT feed the alarm ladder — that stays on
// the two primary buoys and KBOS. They are pulled so the regional picture can be
// reviewed and compared. To keep latest.json small only their newest reading is
// carried per run; their full samples go to the daily archive.
const WATCH_NDBC = [
  { id: '44098', name: 'Jeffreys Ledge',        lat: 42.798, lon: -70.168 },
  { id: '44018', name: 'Cape Cod',              lat: 42.206, lon: -70.143 },
  { id: 'IOSN3', name: 'Isle of Shoals',        lat: 42.967, lon: -70.623 }
];
const WATCH_COOPS = [
  { id: '8444069', name: 'Castle Island (waterside)', lat: 42.3409, lon: -71.0123 }
];
const WATCH_NWS = [
  { id: 'KBVY', name: 'Beverly Airport', lat: 42.584, lon: -70.916 }
];
const OBS_STATION = 'KBOS';
const TIDE_STATION = '8443970';
// latest.json stays lean because it is rewritten and committed every 10 min.
// Anything older lives in per-day archive files, which each change once a day,
// plus a tiny all-time daily rollup.
const HISTORY_DAYS = 3;
const ARCHIVE_DIR  = 'data/archive';
const DAILY_FILE   = 'data/daily.json';
// Lead times probed each run so forecast-vs-observed can be checked later.
const PROBE_LEADS  = [1, 3, 6, 12, 24];

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
  const F = c => (c == null ? null : +(c * 9 / 5 + 32).toFixed(1));
  return {
    station: OBS_STATION, name: p.stationName, observed_at: p.timestamp,
    sustained_kt: kt(p.windSpeed), gust_kt: kt(p.windGust),
    dir_deg: p.windDirection?.value ?? null,
    text: p.textDescription || null,
    temp_f: F(p.temperature?.value),
    dewpoint_f: F(p.dewpoint?.value),
    windchill_f: F(p.windChill?.value),
    humidity_pct: p.relativeHumidity?.value == null ? null
      : Math.round(p.relativeHumidity.value),
    visibility_mi: p.visibility?.value == null ? null
      : +(p.visibility.value / 1609.344).toFixed(1)
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
  // Units are per-quantity: knots for wind, Fahrenheit, inches of precip.
  const d = await j('https://api.open-meteo.com/v1/forecast?latitude=' + HARBOR.lat +
    '&longitude=' + HARBOR.lon +
    '&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,' +
    'precipitation_probability,snowfall,weather_code,temperature_2m,apparent_temperature' +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,' +
    'weather_code,is_day' +
    '&wind_speed_unit=kn&temperature_unit=fahrenheit&precipitation_unit=inch' +
    '&forecast_days=3&timezone=America%2FNew_York');
  const h = d.hourly;
  return {
    current: d.current || null,
    hours: h.time.map((t, i) => ({
      t, s: h.wind_speed_10m[i], g: h.wind_gusts_10m[i], d: h.wind_direction_10m[i],
      p: h.precipitation[i], pp: h.precipitation_probability[i],
      sn: h.snowfall[i], wc: h.weather_code[i],
      tc: h.temperature_2m[i], fl: h.apparent_temperature[i]
    }))
  };
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

/* ---------- monitoring stations ---------- */
const R_NM = 3440.065, rad = d => d * Math.PI / 180;
function geo(lat, lon) {
  const p1 = rad(HARBOR.lat), p2 = rad(lat), dp = p2 - p1, dl = rad(lon - HARBOR.lon);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const dist = 2 * R_NM * Math.asin(Math.sqrt(h));
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  const b = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  const pts = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW',
               'W','WNW','NW','NNW'];
  return { dist_nm: +dist.toFixed(1), bearing_deg: Math.round(b),
           bearing: pts[Math.round(b / 22.5) % 16] };
}
const stations = [];
const watchSamples = {};

// primaries first, so the panel shows everything in one list
for (const b of BUOYS) {
  const s = buoys[b.id];
  if (!s) continue;
  stations.push(Object.assign({ id: b.id, name: b.name, kind: 'buoy', primary: true,
    at: s.wind?.at || s.observed_at, s: s.wind?.sustained_kt ?? null,
    g: s.wind?.gust_kt ?? null, d: s.wind?.dir_deg ?? null,
    wv: s.waves?.height_ft ?? null, water_f: s.water_temp_f,
    pressure: s.pressure_hpa }, geo(b.lat, b.lon)));
}
if (obs) stations.push(Object.assign({ id: obs.station, name: obs.name || obs.station,
  kind: 'land', primary: true, at: obs.observed_at, s: obs.sustained_kt,
  g: obs.gust_kt, d: obs.dir_deg, temp_f: obs.temp_f }, geo(42.36, -71.01)));

for (const w of WATCH_NDBC) {
  const r = await tryGet('watch ' + w.id, async () => {
    const txt = await j('https://www.ndbc.noaa.gov/data/realtime2/' + w.id + '.txt',
      { text: true });
    return summarize(txt, w);
  });
  if (!r) continue;
  watchSamples[w.id] = r.samples || [];
  stations.push(Object.assign({ id: w.id, name: w.name, kind: 'buoy', primary: false,
    at: r.wind?.at || r.observed_at, s: r.wind?.sustained_kt ?? null,
    g: r.wind?.gust_kt ?? null, d: r.wind?.dir_deg ?? null,
    wv: r.waves?.height_ft ?? null, water_f: r.water_temp_f,
    pressure: r.pressure_hpa }, geo(w.lat, w.lon)));
}
for (const w of WATCH_COOPS) {
  const r = await tryGet('watch ' + w.id, async () => {
    const d = await j('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter' +
      '?product=wind&station=' + w.id + '&date=latest&units=english' +
      '&time_zone=lst_ldt&format=json');
    const x = d?.data?.[0];
    if (!x) throw new Error('no data');
    return { t: x.t, s: +x.s, g: +x.g, d: +x.d };      // CO-OPS english wind is knots
  });
  if (!r) continue;
  stations.push(Object.assign({ id: w.id, name: w.name, kind: 'land', primary: false,
    at: r.t, s: r.s, g: r.g, d: r.d }, geo(w.lat, w.lon)));
}
for (const w of WATCH_NWS) {
  const r = await tryGet('watch ' + w.id, async () => {
    const p = (await j('https://api.weather.gov/stations/' + w.id + '/observations/latest',
      { headers: { Accept: 'application/geo+json' } })).properties;
    const kt = o => { if (!o || o.value == null) return null;
      const u = o.unitCode || '';
      return u.includes('km_h') ? +(o.value / 1.852).toFixed(1)
           : u.includes('m_s') ? +(o.value * 1.94384).toFixed(1) : o.value; };
    return { t: p.timestamp, s: kt(p.windSpeed), g: kt(p.windGust),
      d: p.windDirection?.value ?? null,
      temp_f: p.temperature?.value == null ? null
        : +(p.temperature.value * 9 / 5 + 32).toFixed(1), text: p.textDescription };
  });
  if (!r) continue;
  stations.push(Object.assign({ id: w.id, name: w.name, kind: 'land', primary: false,
    at: r.t, s: r.s, g: r.g === null ? r.s : r.g, d: r.d, temp_f: r.temp_f,
    text: r.text }, geo(w.lat, w.lon)));
}
stations.sort((a, b) => a.dist_nm - b.dist_nm);

/* ---------- durable archive ----------
   Cost discipline: latest.json is rewritten and committed every 10 minutes, so
   its size is multiplied by 144 a day. Keeping 7 days of samples in it cost
   ~104 KB a run, ~15 MB of blob churn a day. The archive therefore does NOT get
   rewritten every run — a day's file is written once, after that day is over.
   latest.json carries 3 days as slack so a few missed runs cannot lose samples
   before the flush. Net effect is LESS writing than before, not more, because
   the per-run file shrank. */
const nowIso = new Date().toISOString();
const dayKey = d => new Date(d).toISOString().slice(0, 10);
const today  = dayKey(Date.now());
const readJson = (p, fb) => { try { return JSON.parse(readFileSync(p, 'utf8')); }
                              catch { return fb; } };
mkdirSync(ARCHIVE_DIR, { recursive: true });

// Today's low-rate extras ride along in latest.json and are flushed with the
// day. Probes are sampled on the half hour, not every run, to keep this small.
const carry = readJson(OUT, {}).today_log || { date: today, obs: [], tide: [], probes: [] };
if (carry.date !== today) { carry.date = today; carry.obs = []; carry.tide = []; carry.probes = []; }
const push = (arr, key, rec) => {
  if (!rec[key]) return; const m = new Map(arr.map(x => [x.t, x]));
  m.set(rec.t, rec); return [...m.values()].sort((a, b) => new Date(a.t) - new Date(b.t));
};
if (obs?.observed_at)
  carry.obs = push(carry.obs, 't', { t: obs.observed_at, s: obs.sustained_kt,
    g: obs.gust_kt, d: obs.dir_deg, temp: obs.temp_f }) || carry.obs;
if (tide?.observed_at)
  carry.tide = push(carry.tide, 't', { t: tide.observed_at, v: tide.observed_ft,
    surge: tide.surge_ft }) || carry.tide;
if (forecast?.hours?.length && new Date().getUTCMinutes() < 10) {
  for (const lead of PROBE_LEADS) {
    const target = new Date(Date.now() + lead * 3600e3);
    let best = null, bd = Infinity;
    for (const h of forecast.hours) {
      const dd = Math.abs(new Date(h.t) - target);
      if (dd < bd) { bd = dd; best = h; }
    }
    if (best && bd <= 36e5)
      carry.probes.push({ issued: nowIso, lead,
        target: new Date(best.t).toISOString(), g: best.g });
  }
}

// Flush any finished day exactly once.
const byDay = {};
for (const [id, arr] of Object.entries(history))
  for (const s of arr) { const k = dayKey(s.t);
    ((byDay[k] ||= {})[id] ||= []).push(s); }
// watch buoys are archived too, but never carried in latest.json
const watchByDay = {};
for (const [id, arr] of Object.entries(watchSamples))
  for (const s of arr) { const k = dayKey(s.t);
    ((watchByDay[k] ||= {})[id] ||= []).push(s); }
for (const k of Object.keys(watchByDay)) byDay[k] ||= {};
const flushed = [];
for (const [k, buoySamples] of Object.entries(byDay)) {
  if (k === today) continue;                       // still accumulating
  const path = ARCHIVE_DIR + '/' + k + '.json';
  if (existsSync(path)) continue;                  // already written
  // history is newest-first for the UI; an archive is read chronologically.
  const asc = {};
  for (const [id, arr] of Object.entries(buoySamples)) {
    const m = new Map(arr.map(s => [s.t, s]));
    asc[id] = [...m.values()].sort((a, b) => new Date(a.t) - new Date(b.t));
  }
  const wasc = {};
  for (const [id, arr] of Object.entries(watchByDay[k] || {})) {
    const m = new Map(arr.map(s => [s.t, s]));
    wasc[id] = [...m.values()].sort((a, b) => new Date(a.t) - new Date(b.t));
  }
  const rec = { date: k, buoys: asc, watch: wasc,
    obs: carry.date === k ? carry.obs : [],
    tide: carry.date === k ? carry.tide : [],
    probes: carry.date === k ? carry.probes : [],
    alerts: [...new Set((alerts || []).map(a => a.event))] };
  writeFileSync(path, JSON.stringify(rec));
  flushed.push(k);
}
if (flushed.includes(carry.date)) { carry.obs = []; carry.tide = []; carry.probes = []; }

// One small line per day, kept forever — the index worth reading back.
const daily = readJson(DAILY_FILE, { days: [] });
const dmap = new Map(daily.days.map(d => [d.date, d]));
const summarise = (k, buoys, tideArr) => {
  const gusts = [], waves = [], surges = [];
  for (const arr of Object.values(buoys || {}))
    for (const s of arr) { if (s.g != null) gusts.push(s.g); if (s.wv != null) waves.push(s.wv); }
  for (const x of (tideArr || [])) if (x.surge != null) surges.push(x.surge);
  const mx = v => v.length ? +Math.max(...v).toFixed(1) : null;
  const mean = v => v.length ? +(v.reduce((p, q) => p + q, 0) / v.length).toFixed(1) : null;
  return { date: k, max_gust_kt: mx(gusts), mean_gust_kt: mean(gusts),
    max_wave_ft: mx(waves), max_surge_ft: mx(surges), samples: gusts.length };
};
for (const k of flushed)
  dmap.set(k, Object.assign(summarise(k, readJson(ARCHIVE_DIR + '/' + k + '.json', {}).buoys, []),
    { events: [...new Set((alerts || []).map(a => a.event))] }));
if (byDay[today]) {
  const prevToday = dmap.get(today) || {};
  dmap.set(today, Object.assign(summarise(today, byDay[today], carry.tide),
    { events: [...new Set(((prevToday.events) || []).concat(
        (alerts || []).map(a => a.event)))] }));
}
daily.days = [...dmap.values()].sort((a, b) => a.date.localeCompare(b.date));
daily.updated_at = nowIso;
writeFileSync(DAILY_FILE, JSON.stringify(daily, null, 1));

const allTime = daily.days.reduce((a, d) =>
  (d.max_gust_kt != null && (!a || d.max_gust_kt > a.max_gust_kt)) ? d : a, null);
const cutoff7 = dayKey(Date.now() - 7 * 864e5);
const last7 = daily.days.filter(d => d.date >= cutoff7).reduce((a, d) =>
  (d.max_gust_kt != null && (!a || d.max_gust_kt > a.max_gust_kt)) ? d : a, null);

const out = {
  generated_at: nowIso,
  archive: { dir: ARCHIVE_DIR, days: daily.days.length,
             first: daily.days[0]?.date || null, flushed_now: flushed },
  today_log: carry,
  peak_all_time: allTime ? { gust_kt: allTime.max_gust_kt, date: allTime.date } : null,
  peak_7d_daily: last7 ? { gust_kt: last7.max_gust_kt, date: last7.date } : null,
  harbor: HARBOR,
  buoys, obs, alerts, tide, stations,
  forecast: forecast ? forecast.hours : null,
  current_model: forecast ? forecast.current : null,
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
