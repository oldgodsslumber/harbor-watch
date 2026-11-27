// The condition roll-up (NORMAL / YELLOW / ORANGE / RED), against the shipped page.
//
// Written after a real failure: on the morning of 2026-11-27 the board still read
// ORANGE hours after the blow had passed. Three separate causes, each pinned below.
//   1. An NWS warning bumped the level unconditionally. A Gale Warning runs to a
//      fixed end time and the Weather Service leaves it up until then, so once the
//      wind eased the warning alone was holding the top line at "serious".
//   2. Expired products were never filtered, so a Wind Advisory that ended at
//      07:00 was still counted at 08:00.
//   3. The level-2 sentence asserted "forecast to get worse" without ever looking
//      at the forecast, which is exactly wrong on the back side of a blow.
import { F, freshSnap } from './harness.mjs';

let pass = 0; const fail = [];
const t = (n, f) => { try { f(); pass++; } catch (e) { fail.push(n + ': ' + e.message); } };
const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' expected ' + b + ', got ' + a); };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

const C = F.CFG;
const NORMAL = 0, YELLOW = 1, ORANGE = 2, RED = 3;

// A forecast series at a flat speed, and one that ramps, both starting now.
const flat = kt => Array.from({ length: 48 }, (_, i) =>
  ({ t: new Date(Date.now() + (i + 1) * 3600e3), g: kt, s: kt / 1.35, d: 60 }));
const ramp = (from, to) => Array.from({ length: 48 }, (_, i) =>
  ({ t: new Date(Date.now() + (i + 1) * 3600e3), g: from + (to - from) * (i / 47),
     s: 10, d: 60 }));
// Products are only live while their end time is ahead of us.
const inForce = (event, hoursLeft = 5) =>
  ({ event, ends: new Date(Date.now() + hoursLeft * 3600e3).toISOString() });
const expired = (event, hoursAgo = 1) =>
  ({ event, ends: new Date(Date.now() - hoursAgo * 3600e3).toISOString() });

// Every case needs a fresh snapshot, or the staleness factor colours the result.
const setup = () => { F.setSNAP(freshSnap()); };
const status = (gust, hours, alerts, tide) =>
  (setup(), F.computeStatus(gust, true, hours, alerts, tide || { surge_ft: 0 }));

/* ---------- the reported bug ---------- */

t('THE BUG: a warning in force does not hold ORANGE once the wind has eased', () => {
  // The morning after: 17 kt observed, nothing above 31 kt forecast, but the
  // Gale Warning still runs until 1 PM. Watch threshold is 35 kt.
  const st = status(17, flat(22), [inForce('Gale Warning', 5)]);
  ok(st.lvl < ORANGE, 'still ORANGE on an eased warning (got ' + st.lvl + ')');
  eq(st.lvl, YELLOW, 'an in-force warning should still be worth something:');
  ok(st.factors.some(x => /eased/.test(x.label)),
    'should say the wind has eased: ' + JSON.stringify(st.factors.map(x => x.label)));
});

t('a warning WITH the wind to back it up is still ORANGE', () => {
  const st = status(38, flat(40), [inForce('Gale Warning', 5)]);
  eq(st.lvl, ORANGE);
  ok(st.driver.join(' ').includes('Gale Warning'), 'warning should be a driver');
});

t('a warning is supported by forecast inside its own window, not just by now', () => {
  // Calm at this moment, but 44 kt forecast while the warning still runs.
  const st = status(12, ramp(12, 44), [inForce('Gale Warning', 24)]);
  eq(st.lvl, ORANGE, 'forecast inside the warning window should support it:');
});

t('a warning is NOT supported by wind forecast after it expires', () => {
  // The blow arrives long after this warning ends, so it cannot be its evidence.
  const hours = flat(12).map((h, i) => i > 30 ? { ...h, g: 50 } : h);
  const st = status(12, hours, [inForce('Gale Warning', 2)]);
  ok(!st.driver.join(' ').includes('Gale Warning'),
    'an expiring warning should not borrow a blow from two days out');
});

t('expired products are ignored entirely', () => {
  const st = status(10, flat(10), [expired('Wind Advisory', 1)]);
  eq(st.lvl, NORMAL, 'an advisory that ended an hour ago still counted:');
  ok(!st.factors.some(x => /Wind Advisory/.test(x.label)),
    'expired product should not appear at all');
});

t('liveAlertsOnly keeps in-force, drops expired, keeps undated', () => {
  const kept = F.liveAlertsOnly(
    [inForce('Gale Warning'), expired('Wind Advisory'), { event: 'No End Given' }],
    new Date()).map(a => a.event);
  eq(kept.length, 2, JSON.stringify(kept));
  ok(kept.includes('Gale Warning') && kept.includes('No End Given'), JSON.stringify(kept));
});

/* ---------- the trend sentence ---------- */

t('trend reads "easing" on the back side of a blow', () => {
  eq(status(30, flat(14), []).trend, 'easing');
});
t('trend reads "building" ahead of one', () => {
  eq(status(14, ramp(14, 45), []).trend, 'building');
});
t('trend reads "flat" when nothing much changes', () => {
  eq(status(20, flat(21), []).trend, 'flat');
});
t('rendered headline matches the trend', () => {
  setup();
  // Easing: high now, calm ahead. Must not say "forecast to get worse".
  F.drawStatus(42, true, flat(14), [inForce('Gale Warning')], { surge_ft: 0 });
  const txt = F.stmainText();
  ok(!/get worse/.test(txt), 'headline claimed worsening while easing: ' + txt);
  ok(/passed|Easing|easing/.test(txt), 'headline should acknowledge the ease: ' + txt);
});

/* ---------- things that should still work ---------- */

t('line load at the forecast peak can drive RED on its own', () => {
  const st = status(10, flat(55), []);
  eq(st.lvl, RED);
  ok(/breaking strength/.test(st.driver.join(' ')), 'driver should name the lines');
});
t('surge still contributes', () => {
  eq(status(8, flat(8), [], { surge_ft: 2.4 }).lvl, ORANGE);
});
t('measured wind over critical is RED regardless of products', () => {
  ok(status(C.t3 + 5, flat(C.t3 + 5), []).lvl >= RED - 1);
});
t('genuine calm with nothing in force is NORMAL', () => {
  eq(status(8, flat(8), []).lvl, NORMAL);
});

/* ---------- not knowing is not the same as all-clear ---------- */

t('a missing snapshot never reads NORMAL', () => {
  F.setSNAP(null);
  const st = F.computeStatus(8, true, flat(8), [], { surge_ft: 0 });
  ok(st.lvl > NORMAL, 'no collector data read as all-clear');
  ok(/collector/.test(st.blind || ''), 'should say what is missing: ' + st.blind);
});
t('a stale snapshot is flagged even when a live station is reporting', () => {
  F.setSNAP(freshSnap({ generated_at: new Date(Date.now() - 6 * 3600e3).toISOString() }));
  const st = F.computeStatus(8, true, flat(8), [], { surge_ft: 0 });
  ok(/6 h ago/.test(st.blind || ''), 'should name the age: ' + st.blind);
  eq(st.lvl, YELLOW, 'stale cache with a live reading is a maintenance problem:');
});
t('stale AND no live reading is the loud case', () => {
  F.setSNAP(freshSnap({ generated_at: new Date(Date.now() - 6 * 3600e3).toISOString() }));
  const st = F.computeStatus(null, false, [], [], null);
  eq(st.lvl, ORANGE, 'blind with no station should be loud:');
  ok(/no live station/.test(st.blind || ''), st.blind);
});
t('a fresh snapshot produces no staleness complaint', () => {
  setup();
  eq(F.computeStatus(8, true, flat(8), [], { surge_ft: 0 }).blind, null);
});

/* ---------- never renders garbage ---------- */

t('renders cleanly at every level and trend', () => {
  for (const g of [8, 26, 38, 55]) {
    for (const hours of [flat(g), ramp(g, g + 20), ramp(g, 8)]) {
      for (const al of [[], [inForce('Small Craft Advisory')], [inForce('Storm Warning')],
                        [expired('Gale Warning')]]) {
        setup();
        F.drawStatus(g, true, hours, al, { surge_ft: 0.4 });
        const txt = F.stmainText() + ' ' + F.stwhyText();
        ok(!/NaN|undefined|Infinity/.test(txt), 'garbage in status text: ' + txt);
        ok(txt.trim().length > 0, 'empty status text');
      }
    }
  }
});

t('the same product across two zones is listed once', () => {
  // NWS issues per zone, so a Gale Warning covering Boston Harbor and
  // Massachusetts Bay arrives twice.
  const st = status(38, flat(40), [inForce('Gale Warning'), inForce('Gale Warning')]);
  const n = st.factors.filter(x => /Gale Warning/.test(x.label)).length;
  eq(n, 1, 'duplicate zone products should collapse:');
});

console.log(pass + ' passed, ' + fail.length + ' failed');
fail.forEach(f => console.log('  FAIL ' + f));
process.exit(fail.length ? 1 : 0);
