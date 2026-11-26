// Mooring-line load model for a vessel lashed to fixed dolphins.
//
// Why first principles rather than a standard: ABYC H-40 Table I is the usual
// reference for ground tackle, but it only covers 20–60 ft LOA. A 100 ft, 100 ton
// excursion boat is outside it. The method here is the standard drag equation,
// and it reproduces ABYC's published 50 ft @ 60 kt figure (6,400 lb) to within
// about 5%, which is the only validation available.
//
// Lashed to dolphins matters: the vessel cannot weathervane, so a beam-on wind
// stays beam-on. Beam-on load is roughly five times end-on for this hull form.

export const RHO = 0.00242;      // slug/ft^3, air near 45 F
export const KT  = 1.6878;       // ft/s per knot

export function windLoadLb(V_kt, areaFt2, Cd = 1.2) {
  return 0.5 * RHO * Math.pow(V_kt * KT, 2) * Cd * areaFt2;
}

// New breaking strengths, lb. 1" figures are published (New England Ropes /
// typical catalogue); larger sizes scale with d^2, which slightly UNDER-predicts
// the published 1-1/4" three-strand (35.3k vs 37.5k), so it errs safe.
const BASE_1IN = { '3strand': 22600, 'doublebraid': 32750 };
export function lineBreakLb(diaIn, construction = '3strand') {
  const base = BASE_1IN[construction] ?? BASE_1IN['3strand'];
  return base * Math.pow(diaIn, 2);
}

// Condition derates. A line's history is usually unknown, and nylon fatigues:
// a single winter gale can cycle a dockline thousands of times above its
// working load, so an old line is not a new line.
export const CONDITION = { new: 1.0, good: 0.85, aged: 0.65, unknown: 0.65, poor: 0.45 };

export const RIG_DEFAULTS = {
  loa: 100, windage_h: 16, beam: 28, exposure: 'beam',
  dia: 1.0, construction: '3strand', condition: 'unknown',
  lines: 4, worst_share: 0.5,   // the hardest-working line, not 1/n
  gust: 1.4,                    // gust + yaw against a fixed structure
  snatch: 2.0,                  // surge shock on a short, stiff lead
  splice: 0.9                   // eye splice costs ~10%
};

export function rigAnalysis(rig, V_kt) {
  const r = { ...RIG_DEFAULTS, ...(rig || {}) };
  const beamOn = r.exposure !== 'bow';
  const area = beamOn ? r.loa * r.windage_h : r.beam * r.windage_h;
  const Cd   = beamOn ? 1.2 : 0.9;
  const steady = windLoadLb(V_kt, area, Cd);
  const peak   = steady * r.gust * r.snatch;
  const worst  = peak * r.worst_share;
  const brkNew = lineBreakLb(r.dia, r.construction);
  const brk    = brkNew * (CONDITION[r.condition] ?? 0.65) * r.splice;
  return {
    area_ft2: Math.round(area), steady_lb: Math.round(steady),
    peak_lb: Math.round(peak), worst_line_lb: Math.round(worst),
    break_new_lb: Math.round(brkNew), break_derated_lb: Math.round(brk),
    pct_of_break: brk > 0 ? +(worst / brk * 100).toFixed(1) : null
  };
}

// Wind speed at which the worst-loaded line reaches `frac` of its derated break.
export function windAtFraction(rig, frac) {
  const r = { ...RIG_DEFAULTS, ...(rig || {}) };
  const beamOn = r.exposure !== 'bow';
  const area = beamOn ? r.loa * r.windage_h : r.beam * r.windage_h;
  const Cd   = beamOn ? 1.2 : 0.9;
  const brk  = lineBreakLb(r.dia, r.construction) *
               (CONDITION[r.condition] ?? 0.65) * r.splice;
  const k = 0.5 * RHO * KT * KT * Cd * area * r.gust * r.snatch * r.worst_share;
  return k > 0 ? Math.sqrt(brk * frac / k) : null;
}

// Thresholds derived from the rig rather than from generic small-craft numbers.
//   33% — nylon's fatigue region; repeated loading above this shortens life
//   50% — serious; well past any published working load
//   80% — approaching failure of the most-loaded line
export function thresholdsFor(rig) {
  const w = f => { const v = windAtFraction(rig, f); return v == null ? null : Math.round(v); };
  return { watch: w(0.33), concern: w(0.50), critical: w(0.80),
           failure: w(1.00) };
}
