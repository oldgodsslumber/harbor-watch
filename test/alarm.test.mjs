// The alarm used to store a bare speed. It only self-corrected when that speed
// fell OUTSIDE the new threshold band, so an old alarm that happened to land
// inside the new band stuck silently at the wrong number — which is exactly how
// a 30 kt alarm survived the move to a 35/43/52 ladder. These tests pin the
// behaviour that replaced it: the alarm stores a TIER and the speed is derived.
import assert from 'node:assert';
import { thresholdsFor, RIG_DEFAULTS } from '../scripts/rig.mjs';

let pass = 0; const fail = [];
const t = (n, f) => { try { f(); pass++; } catch (e) { fail.push(n + ': ' + e.message); } };

// Mirror of the config logic in the page. Kept in step by the assertions below
// that compare its output against thresholdsFor() for the real rig.
const TIERS = ['watch', 'concern', 'critical'];
function makeCfg(stored = {}) {
  const DEF = { t1: 22, t2: 30, t3: 40, alarmTier: 'concern', talarm: 30, autoTh: 1,
                rig: RIG_DEFAULTS };
  const CFG = Object.assign({}, DEF, stored);
  CFG.rig = Object.assign({}, DEF.rig, stored.rig || {});
  const currentTiers = () => ({ watch: CFG.t1, concern: CFG.t2, critical: CFG.t3 });

  if (!stored.alarmTier) {                       // migration
    const s = Number(CFG.talarm);
    if (!isFinite(s)) CFG.alarmTier = 'concern';
    else {
      let best = 'concern', d = Infinity;
      for (const k of TIERS) {
        const gap = Math.abs(currentTiers()[k] - s);
        if (isFinite(gap) && gap < d) { d = gap; best = k; }
      }
      CFG.alarmTier = best;
    }
  }
  if (CFG.autoTh) {                              // applyAutoThresholds
    const th = thresholdsFor(CFG.rig);
    if (th.watch) CFG.t1 = th.watch;
    if (th.concern) CFG.t2 = th.concern;
    if (th.critical) CFG.t3 = th.critical;
  }
  if (CFG.alarmTier !== 'custom' && TIERS.indexOf(CFG.alarmTier) < 0) CFG.alarmTier = 'concern';
  if (CFG.alarmTier !== 'custom') {
    const v = currentTiers()[CFG.alarmTier];
    if (isFinite(v) && v > 0) CFG.talarm = v;
  }
  CFG.alarmLevel = () => CFG.alarmTier === 'custom' ? CFG.talarm
    : (currentTiers()[CFG.alarmTier] || CFG.talarm);
  return CFG;
}

t('fresh config: alarm equals the concern threshold for the real rig', () => {
  const th = thresholdsFor(RIG_DEFAULTS);
  assert.equal(makeCfg().alarmLevel(), th.concern);
});

t('THE BUG: a stale 30 kt alarm inside the new band is re-tied, not kept', () => {
  // Saved by an older version: old ladder 22/30/40, alarm 30.
  const cfg = makeCfg({ t1: 22, t2: 30, t3: 40, talarm: 30 });
  const th = thresholdsFor(RIG_DEFAULTS);
  assert.equal(cfg.alarmTier, 'concern', 'should recognise 30 as the old concern');
  assert.equal(cfg.alarmLevel(), th.concern, 'should now fire at the new concern');
  assert.notEqual(cfg.alarmLevel(), 30, 'must not still be armed at 30 kt');
});

t('stale alarm that lands inside the new band is still corrected', () => {
  // 40 kt sits between the new watch (35) and critical (52), so the old
  // "only fix it if out of range" guard would have left it alone.
  const cfg = makeCfg({ t1: 22, t2: 30, t3: 40, talarm: 40 });
  const th = thresholdsFor(RIG_DEFAULTS);
  assert.equal(cfg.alarmTier, 'critical');
  assert.equal(cfg.alarmLevel(), th.critical);
  assert.ok(cfg.alarmLevel() > 40, 'should have moved up with the ladder');
});

t('alarm follows a rig change without any further intervention', () => {
  const strong = makeCfg();
  const weak = makeCfg({ rig: { condition: 'poor' } });
  assert.ok(weak.alarmLevel() < strong.alarmLevel(),
    'weaker lines must lower the alarm');
  assert.equal(weak.alarmLevel(), thresholdsFor(
    Object.assign({}, RIG_DEFAULTS, { condition: 'poor' })).concern);
});

t('alarm follows manual thresholds too when auto is off', () => {
  const cfg = makeCfg({ autoTh: 0, t1: 20, t2: 28, t3: 36, alarmTier: 'concern' });
  assert.equal(cfg.alarmLevel(), 28, 'manual ladder should drive it as well');
});

t('each tier selects its own threshold', () => {
  const th = thresholdsFor(RIG_DEFAULTS);
  assert.equal(makeCfg({ alarmTier: 'watch' }).alarmLevel(), th.watch);
  assert.equal(makeCfg({ alarmTier: 'concern' }).alarmLevel(), th.concern);
  assert.equal(makeCfg({ alarmTier: 'critical' }).alarmLevel(), th.critical);
});

t('custom is the only mode that pins a literal speed', () => {
  const cfg = makeCfg({ alarmTier: 'custom', talarm: 47 });
  assert.equal(cfg.alarmLevel(), 47);
  const moved = makeCfg({ alarmTier: 'custom', talarm: 47, rig: { condition: 'poor' } });
  assert.equal(moved.alarmLevel(), 47, 'custom must NOT drift with the rig');
});

t('a garbage tier falls back to concern rather than disabling the alarm', () => {
  const th = thresholdsFor(RIG_DEFAULTS);
  assert.equal(makeCfg({ alarmTier: 'bogus' }).alarmLevel(), th.concern);
});

t('alarm always sits within the ladder it was derived from', () => {
  for (const cond of ['new', 'good', 'aged', 'unknown', 'poor']) {
    const cfg = makeCfg({ rig: { condition: cond } });
    assert.ok(cfg.alarmLevel() >= cfg.t1 && cfg.alarmLevel() <= cfg.t3,
      cond + ': alarm outside its own ladder');
  }
});

console.log(pass + ' passed, ' + fail.length + ' failed');
fail.forEach(f => console.log('  FAIL ' + f));
process.exit(fail.length ? 1 : 0);
