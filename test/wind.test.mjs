// The source ladder's gap-filling. A reading is assembled from whichever
// sources have each field, so this is where "the page thinks it has no wind"
// bugs live.
//
// Written after a real one on 2026-11-27: KBOS reported sustained 6 kt with a
// null gust, buoy 44013 had an 11.7 kt gust an hour old, and the board said
// "no wind reading" and sat at YELLOW. The gust is the field the alarm, the
// thresholds and the condition roll-up all key off, and it was the one field
// the ladder never filled.
import { F } from './harness.mjs';

let pass = 0; const fail = [];
const t = (n, f) => { try { f(); pass++; } catch (e) { fail.push(n + ': ' + e.message); } };
const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' expected ' + b + ', got ' + a); };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

const fill = F.fillWindGaps;
// [label, dir, sustained, gust]
const buoy  = ['NDBC 44013', 340, 7.8, 11.7];
const model = ['model', 200, 9, 14];
const empty = ['nothing', null, null, null];

t('THE BUG: a null gust with a sustained in hand is not "no reading"', () => {
  const r = fill({ s: 6, g: null, d: 10, m: true, src: 'KBOS' }, []);
  ok(r.g != null, 'gust still null — the board would read "no wind reading"');
  eq(r.g, 6, 'a steady 6 kt station should report a 6 kt gust:');
  ok(/no gust reported/.test(r.borrowed.join(' ')), 'should say what it did');
  ok(/no gust reported/.test(r.src), 'src should disclose it: ' + r.src);
});

t('a real gust from another source beats inferring from sustained', () => {
  const r = fill({ s: 6, g: null, d: 10, m: true, src: 'KBOS' }, [buoy]);
  eq(r.g, 11.7, 'should prefer the buoy measurement:');
  ok(/gust from NDBC 44013/.test(r.src), r.src);
});

t('measurements are preferred over the model for a missing gust', () => {
  const r = fill({ s: 6, g: null, d: 10, m: true, src: 'KBOS' }, [buoy, model]);
  eq(r.g, 11.7, 'buoy is listed first and should win:');
});

t('falls back to the model when no measurement has a gust', () => {
  const r = fill({ s: 6, g: null, d: 10, m: true, src: 'KBOS' }, [empty, model]);
  eq(r.g, 14);
});

t('a present gust is never overwritten', () => {
  const r = fill({ s: 20, g: 31, d: 10, m: true, src: 'KBOS' }, [buoy, model]);
  eq(r.g, 31, 'a real reading must not be replaced:');
  ok(!r.borrowed, 'nothing should have been borrowed: ' + JSON.stringify(r.borrowed));
});

t('inferring a gust never lowers a reading', () => {
  // Sustained higher than any donor gust: the inference must not pull it down.
  const r = fill({ s: 40, g: null, d: 10, m: true, src: 'KBOS' }, []);
  ok(r.g >= 40, 'inferred gust below the sustained wind: ' + r.g);
});

t('a true calm still reads as a number, not as absence', () => {
  const r = fill({ s: 0, g: null, d: 10, m: true, src: 'KBOS' }, []);
  ok(r.g != null, 'dead calm should be 0, not unknown');
  eq(r.g, 0);
});

t('direction is still borrowed (the original gap)', () => {
  const r = fill({ s: 12, g: 20, d: null, m: true, src: 'KBOS' }, [buoy]);
  eq(r.d, 340);
  ok(/direction from NDBC 44013/.test(r.src), r.src);
});

t('sustained is still borrowed, and zero counts as missing', () => {
  const r = fill({ s: 0, g: 20, d: 10, m: true, src: 'KBOS' }, [buoy]);
  eq(r.s, 7.8, 'a zero sustained alongside a 20 kt gust is a dropped field:');
});

t('several gaps are all filled and all disclosed', () => {
  const r = fill({ s: null, g: null, d: null, m: true, src: 'KBOS' }, [buoy]);
  eq(r.d, 340); eq(r.s, 7.8); eq(r.g, 11.7);
  eq(r.borrowed.length, 3, JSON.stringify(r.borrowed));
});

t('nothing to borrow from and nothing to infer leaves the gust null', () => {
  // Honest absence must stay absent — this is the case that SHOULD read
  // "no wind reading", and the status roll-up treats it as not-calm.
  const r = fill({ s: null, g: null, d: null, m: true, src: 'KBOS' }, [empty]);
  eq(r.g, null, 'with no data at all the gust must stay unknown:');
});

t('null input is passed through rather than thrown on', () => {
  eq(fill(null, [buoy]), null);
});

t('a borrowed reading never looks like a clean single-source one', () => {
  const r = fill({ s: 6, g: null, d: null, m: true, src: 'KBOS observed · 9 min ago' }, [buoy]);
  ok(r.src !== 'KBOS observed · 9 min ago', 'src was not annotated');
  ok(r.src.startsWith('KBOS observed'), 'should keep the original provenance: ' + r.src);
});

console.log(pass + ' passed, ' + fail.length + ' failed');
fail.forEach(f => console.log('  FAIL ' + f));
process.exit(fail.length ? 1 : 0);
