// Parser for NDBC realtime2 fixed-width/whitespace station files.
// Format notes (verified against live 44013 on 2026-11-26):
//  - two leading '#' lines: column names, then units
//  - newest observation FIRST, 10-minute cadence
//  - missing values are the literal string "MM"
//  - individual fields go missing independently: WVHT/DPD/MWD are
//    typically only populated every other row, so you must scan DOWN
//    per-field for the most recent real value, not trust row 0.
//  - all timestamps are UTC; WSPD/GST are m/s, WVHT is m, temps degC

export const MS_TO_KT = 1.94384;
export const M_TO_FT  = 3.28084;

export function parseNdbc(text) {
  const lines = String(text).split('\n').map(l => l.trimEnd()).filter(l => l.trim() !== '');
  const headLine = lines.find(l => l.startsWith('#'));
  if (!headLine) throw new Error('ndbc: no header line');
  const cols = headLine.replace(/^#/, '').trim().split(/\s+/);
  const rows = [];
  for (const l of lines) {
    if (l.startsWith('#')) continue;
    const parts = l.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const rec = {};
    cols.forEach((c, i) => { rec[c] = parts[i] === undefined ? 'MM' : parts[i]; });
    const [Y, M, D, h, m] = [rec.YY, rec.MM, rec.DD, rec.hh, rec.mm].map(Number);
    if (!Number.isFinite(Y) || !Number.isFinite(M)) continue;
    rec._t = new Date(Date.UTC(Y, M - 1, D, h, m));
    rows.push(rec);
  }
  if (!rows.length) throw new Error('ndbc: no data rows');
  rows.sort((a, b) => b._t - a._t); // newest first, defensively
  return { cols, rows };
}

// Most recent row where `field` is not "MM". Returns {v, t} or null.
export function latest(rows, field) {
  for (const r of rows) {
    const raw = r[field];
    if (raw === undefined || raw === 'MM') continue;
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    return { v, t: r._t };
  }
  return null;
}

const r1 = (x, n = 1) => (x == null ? null : Number(x.toFixed(n)));

export function summarize(text, meta) {
  const { rows } = parseNdbc(text);
  const wspd = latest(rows, 'WSPD');
  const gst  = latest(rows, 'GST');
  const wdir = latest(rows, 'WDIR');
  const wvht = latest(rows, 'WVHT');
  const dpd  = latest(rows, 'DPD');
  const mwd  = latest(rows, 'MWD');
  const pres = latest(rows, 'PRES');
  const atmp = latest(rows, 'ATMP');
  const wtmp = latest(rows, 'WTMP');

  // rolling samples for trend/history, newest first
  const samples = rows.slice(0, 288).map(r => {
    const s = r.WSPD === 'MM' ? null : Number(r.WSPD) * MS_TO_KT;
    const g = r.GST  === 'MM' ? null : Number(r.GST)  * MS_TO_KT;
    const w = r.WVHT === 'MM' ? null : Number(r.WVHT) * M_TO_FT;
    const d = r.WDIR === 'MM' ? null : Number(r.WDIR);
    if (s == null && g == null && w == null) return null;
    return { t: r._t.toISOString(), s: r1(s), g: r1(g), d, wv: r1(w) };
  }).filter(Boolean);

  return {
    id: meta.id,
    name: meta.name,
    lat: meta.lat,
    lon: meta.lon,
    observed_at: rows[0]._t.toISOString(),
    wind: wspd || gst ? {
      sustained_kt: wspd ? r1(wspd.v * MS_TO_KT) : null,
      gust_kt:      gst  ? r1(gst.v  * MS_TO_KT) : null,
      dir_deg:      wdir ? wdir.v : null,
      at: (gst || wspd).t.toISOString()
    } : null,
    waves: wvht ? {
      height_ft: r1(wvht.v * M_TO_FT),
      dominant_period_s: dpd ? dpd.v : null,
      dir_deg: mwd ? mwd.v : null,
      at: wvht.t.toISOString()
    } : null,
    pressure_hpa: pres ? pres.v : null,
    air_temp_f:   atmp ? r1(atmp.v * 9 / 5 + 32) : null,
    water_temp_f: wtmp ? r1(wtmp.v * 9 / 5 + 32) : null,
    samples
  };
}
