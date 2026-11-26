import { readFileSync } from 'node:fs';
import { parseNdbc, latest, summarize, MS_TO_KT } from '../scripts/ndbc.mjs';
import assert from 'node:assert/strict';

const txt = readFileSync(new URL('./fixture_44013.txt', import.meta.url), 'utf8');
let pass = 0; const fail = [];
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail.push(name + ': ' + e.message); } };

t('parses header columns', () => {
  const { cols } = parseNdbc(txt);
  assert.equal(cols[0], 'YY');
  assert.ok(cols.includes('WVHT'));
  assert.ok(cols.includes('GST'));
});

t('parses all data rows', () => {
  const { rows } = parseNdbc(txt);
  assert.ok(rows.length > 500, 'got ' + rows.length);
});

t('newest row first and is UTC', () => {
  const { rows } = parseNdbc(txt);
  assert.equal(rows[0]._t.toISOString(), '2026-11-26T17:00:00.000Z');
  assert.ok(rows[0]._t > rows[1]._t);
});

t('row 0 WVHT is MM — latest() must scan down', () => {
  const { rows } = parseNdbc(txt);
  assert.equal(rows[0].WVHT, 'MM', 'fixture assumption broke');
  const w = latest(rows, 'WVHT');
  assert.equal(w.v, 1.8);
  assert.equal(w.t.toISOString(), '2026-11-26T16:50:00.000Z');
});

t('latest() skips MM for wind too', () => {
  const { rows } = parseNdbc(txt);
  assert.equal(latest(rows, 'WSPD').v, 10.0);
  assert.equal(latest(rows, 'GST').v, 12.0);
});

t('converts m/s to knots', () => {
  const s = summarize(txt, { id: '44013', name: 'Boston', lat: 42.35, lon: -70.651 });
  assert.equal(s.wind.sustained_kt, Number((10.0 * MS_TO_KT).toFixed(1)));
  assert.equal(s.wind.gust_kt, 23.3);
  assert.equal(s.wind.dir_deg, 70);
});

t('converts wave metres to feet', () => {
  const s = summarize(txt, { id: '44013', name: 'Boston', lat: 42.35, lon: -70.651 });
  assert.equal(s.waves.height_ft, 5.9);
});

t('temps converted to F', () => {
  const s = summarize(txt, { id: '44013', name: 'B', lat: 0, lon: 0 });
  assert.equal(s.air_temp_f, 45.9);
  assert.equal(s.water_temp_f, 52.5);
});

t('samples are non-empty, newest first, capped', () => {
  const s = summarize(txt, { id: '44013', name: 'B', lat: 0, lon: 0 });
  assert.ok(s.samples.length > 100);
  assert.ok(s.samples.length <= 288);
  assert.ok(new Date(s.samples[0].t) > new Date(s.samples[5].t));
});

t('handles a wind-missing row without crashing', () => {
  const s = summarize(txt, { id: '44013', name: 'B', lat: 0, lon: 0 });
  assert.ok(s.samples.every(x => x.t));
});

t('tolerates truncated/garbage input', () => {
  assert.throws(() => parseNdbc('#hdr\n'), /no data rows/);
  const ok = parseNdbc('#YY MM DD hh mm WSPD\n2026 11 26 17 00 9.0\n');
  assert.equal(ok.rows.length, 1);
});

console.log(pass + ' passed, ' + fail.length + ' failed');
if (fail.length) { fail.forEach(f => console.log('  FAIL ' + f)); process.exit(1); }
