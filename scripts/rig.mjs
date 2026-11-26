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

// Condition derates. A line's history is usually unknown, and nylon fatigues:
// a single winter gale can cycle a dockline thousands of times above its
// working load, so an old line is not a new line.
// Deliberately pessimistic where the history is unknown. Nylon loses strength to
// UV, abrasion and cyclic fatigue, and an in-service mooring line that has sat
// through a few winters is not a new line. `unknown` is treated as worse than
// `aged` precisely because nobody has looked.
export const CONDITION = { new: 1.0, good: 0.80, aged: 0.60, unknown: 0.55, poor: 0.40 };

export const RIG_DEFAULTS = {
  loa: 100, windage_h: 16, beam: 28, exposure: 'beam',
  displacement_tons: 70,        // recorded for context; wind load is area-driven
  bow_line_helps_abeam: false,  // see linesetCapacity — a bow hawser resists
                                // fore-and-aft far better than athwartships
  // A real mooring is a mixed set, not one diameter. "1x3, 1x1.25, 7x1" means
  // one 3", one 1.25" and seven 1" lines.
  lineset: [{ n: 1, dia: 3, con: '3strand' },
            { n: 1, dia: 1.25, con: '3strand' },
            { n: 7, dia: 1, con: '3strand' }],
  condition: 'good',
  unevenness: 1.8,              // worst line vs its fair share (length/angle spread)
  gust: 1.4, snatch: 2.0, splice: 0.9
};

export function parseLineset(str) {
  const out = [];
  for (const part of String(str || '').split(',')) {
    const m = part.trim().match(/^(\d+)\s*[x×]\s*([\d.]+)\s*(db|doublebraid)?$/i);
    if (!m) continue;
    const n = parseInt(m[1], 10), dia = parseFloat(m[2]);
    if (!(n > 0) || !(dia > 0)) continue;
    out.push({ n, dia, con: m[3] ? 'doublebraid' : '3strand' });
  }
  return out;
}
export const linesetToString = ls => (ls || [])
  .map(l => l.n + 'x' + l.dia + (l.con === 'doublebraid' ? 'db' : '')).join(', ');

// Nylon lines of similar length share load roughly in proportion to axial
// stiffness, which goes as the square of diameter. Strength also goes as d^2,
// so a well-set mixed set sits at a similar utilisation on every line — the
// real spread comes from unequal lengths and angles, which is `unevenness`.
export function linesetCapacity(rig, opts) {
  const r = { ...RIG_DEFAULTS, ...(rig || {}) };
  let ls = (r.lineset && r.lineset.length) ? r.lineset : RIG_DEFAULTS.lineset;
  // Beam-on, a bow hawser pulls mostly fore-and-aft and contributes little
  // athwartships. Unless told otherwise, leave the single largest line out of
  // the beam-on calculation rather than assume it carries its stiffness share.
  if ((opts && opts.beamOn) && !r.bow_line_helps_abeam && ls.length > 1) {
    const big = ls.reduce((a, l) => (l.dia > a.dia ? l : a), ls[0]);
    ls = ls.map(l => l === big ? { ...l, n: l.n - 1 } : l).filter(l => l.n > 0);
    if (!ls.length) ls = [big];
  }
  let stiff = 0, breakTotal = 0, worst = null; const all = [];
  for (const l of ls) {
    const d2 = l.dia * l.dia;
    const base = (l.con === 'doublebraid' ? 32750 : 22600);
    stiff += l.n * d2;
    breakTotal += l.n * base * d2;
    all.push({ ...l, base, d2 });
  }
  // Governing line = highest utilisation, not smallest diameter. With share
  // proportional to d^2 and strength also proportional to d^2 these come out
  // nearly equal for one construction, which is the point: a mixed set of
  // similar-length nylon lines loads every line to about the same fraction.
  for (const l of all) {
    const u = (l.d2 / stiff) / (l.base * l.d2);     // share per pound of strength
    if (!worst || u > worst._u) worst = { ...l, _u: u };
  }
  const count = ls.reduce((a, l) => a + l.n, 0);
  return { stiffness: stiff, break_total_new_lb: Math.round(breakTotal),
           count, governing: worst, lines: ls };
}

export function rigAnalysis(rig, V_kt) {
  const r = { ...RIG_DEFAULTS, ...(rig || {}) };
  const beamOn = r.exposure !== 'bow';
  const area = beamOn ? r.loa * r.windage_h : r.beam * r.windage_h;
  const Cd   = beamOn ? 1.2 : 0.9;
  const steady = windLoadLb(V_kt, area, Cd);
  const peak   = steady * r.gust * r.snatch;
  const cap = linesetCapacity(r, { beamOn });
  const derate = (CONDITION[r.condition] ?? 0.65) * r.splice;
  // worst line: its stiffness share of the peak, times the unevenness factor
  const g = cap.governing;
  const share = cap.stiffness > 0 ? (g.d2 / cap.stiffness) * r.unevenness : 1;
  const worstLoad = peak * Math.min(1, share);
  const worstBreak = g.base * g.d2 * derate;
  return {
    area_ft2: Math.round(area), steady_lb: Math.round(steady),
    peak_lb: Math.round(peak), worst_line_lb: Math.round(worstLoad),
    worst_line_dia: g.dia, line_count: cap.count,
    break_new_lb: Math.round(g.base * g.d2),
    break_derated_lb: Math.round(worstBreak),
    fleet_break_new_lb: cap.break_total_new_lb,
    worst_share: +Math.min(1, share).toFixed(3),
    pct_of_break: worstBreak > 0 ? +(worstLoad / worstBreak * 100).toFixed(1) : null
  };
}

export function windAtFraction(rig, frac) {
  const r = { ...RIG_DEFAULTS, ...(rig || {}) };
  const beamOn = r.exposure !== 'bow';
  const area = beamOn ? r.loa * r.windage_h : r.beam * r.windage_h;
  const Cd   = beamOn ? 1.2 : 0.9;
  const cap = linesetCapacity(r, { beamOn });
  const g = cap.governing;
  const derate = (CONDITION[r.condition] ?? 0.65) * r.splice;
  const share = cap.stiffness > 0 ? Math.min(1, (g.d2 / cap.stiffness) * r.unevenness) : 1;
  const brk = g.base * g.d2 * derate;
  const k = 0.5 * RHO * KT * KT * Cd * area * r.gust * r.snatch * share;
  return k > 0 ? Math.sqrt(brk * frac / k) : null;
}

// Creep-rupture life. Published anchors: nylon can fail in under 5 h held at
// 80% of breaking strength, and creep only dominates above about 30%, below
// which life is long and limited by abrasion rather than tension. A log-linear
// fit between those two points is crude but it is anchored at both ends, and it
// is the part of the picture a single gust number cannot show.
// For CYCLIC loading the literature treats the peak load as if held
// continuously, which is why peak rather than mean is used here.
export function hoursToFailure(frac) {
  if (!(frac > 0)) return Infinity;
  if (frac <= 0.30) return Infinity;            // abrasion-limited, not creep
  const logT = 4.0 - 6.6 * (frac - 0.30);       // 0.30 -> 1e4 h, 0.80 -> 5 h
  return Math.pow(10, logT);
}

// Miner's rule over the forecast: each hour spends part of the line's life.
// damage >= 1 means the model expects failure before the blow is over.
export function cumulativeDamage(rig, hourlyGusts) {
  let dmg = 0, worstFrac = 0, hoursOver30 = 0;
  for (const g of hourlyGusts) {
    const a = rigAnalysis(rig, g);
    const f = (a.pct_of_break || 0) / 100;
    if (f > worstFrac) worstFrac = f;
    if (f > 0.30) hoursOver30 += 1;
    const life = hoursToFailure(f);
    if (isFinite(life)) dmg += 1 / life;
  }
  return { damage: +dmg.toFixed(4), worst_frac: +worstFrac.toFixed(3),
           hours_over_30pct: hoursOver30,
           life_at_worst_h: hoursToFailure(worstFrac) };
}


// Wind speed at which the worst-loaded line reaches `frac` of its derated break.

// Thresholds derived from the rig rather than from generic small-craft numbers.
//   25% — published working loads for nylon run 1/10 to 1/4 of break
//   40% — into the fatigue region; repeated loading here shortens line life fast
//   65% — margin gone; a chafed or aged line can let go below this
// The fractions are modest on purpose. The estimate carries real uncertainty in
// windage area and line history, and the cost of being wrong is a 100 ton vessel
// adrift in a gale, so the thresholds sit well inside the computed failure point.
export function thresholdsFor(rig) {
  const w = f => { const v = windAtFraction(rig, f); return v == null ? null : Math.round(v); };
  // 30% is where creep fatigue starts to dominate for nylon, so that is the
  // meaningful watch line rather than an arbitrary fraction.
  return { watch: w(0.30), concern: w(0.45), critical: w(0.65),
           failure: w(1.00) };
}
