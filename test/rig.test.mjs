import { windLoadLb, rigAnalysis, windAtFraction, thresholdsFor,
         RIG_DEFAULTS, hoursToFailure, cumulativeDamage, parseLineset,
         linesetToString, linesetCapacity } from '../scripts/rig.mjs';
import assert from 'node:assert/strict';
let pass=0; const fail=[];
const t=(n,f)=>{try{f();pass++;}catch(e){fail.push(n+': '+e.message);}};

t('reproduces ABYC 50ft @ 60kt within 10%',()=>{
  // ABYC H-40 publishes 6,400 lb for a 50 ft boat at 60 kt (incl. current+wave)
  const v=windLoadLb(60, 50*9.0, 1.2);
  assert.ok(Math.abs(v-6400)/6400 < 0.10, 'got '+v.toFixed(0));
});
t('load scales with the square of wind speed',()=>{
  const a=windLoadLb(20,1600), b=windLoadLb(40,1600);
  assert.ok(Math.abs(b/a-4)<0.001,'ratio '+(b/a));
});
t('beam-on is several times end-on',()=>{
  const beam=rigAnalysis({exposure:'beam'},40).steady_lb;
  const bow =rigAnalysis({exposure:'bow'}, 40).steady_lb;
  assert.ok(beam/bow>4 && beam/bow<6,'ratio '+(beam/bow).toFixed(1));
});
t('parses a line inventory, round-trips, ignores junk',()=>{
  const ls=parseLineset('1x3, 1x1.25, 7x1');
  assert.equal(ls.length,3);
  assert.equal(ls.reduce((a,l)=>a+l.n,0),9);
  assert.equal(parseLineset('2x0.75db')[0].con,'doublebraid');
  assert.equal(parseLineset('nonsense, , 0x5, 3x0').length,0);
  assert.equal(linesetToString(ls),'1x3, 1x1.25, 7x1');
});
t('a bow hawser is left out of the beam-on set by default',()=>{
  const rig={lineset:parseLineset('1x3, 1x1.25, 7x1')};
  const abeam=linesetCapacity(rig,{beamOn:true});
  const all  =linesetCapacity(rig,{beamOn:false});
  assert.equal(all.count,9);
  assert.equal(abeam.count,8,'the 3" line should be dropped abeam');
  assert.equal(abeam.governing.dia,1.25);
});
t('counting the bow line raises every threshold',()=>{
  const base={lineset:parseLineset('1x3, 1x1.25, 7x1'),condition:'good'};
  const off=thresholdsFor(base);
  const on =thresholdsFor({...base,bow_line_helps_abeam:true});
  assert.ok(on.failure>off.failure,on.failure+' !> '+off.failure);
});
t('more and bigger lines lower the utilisation',()=>{
  const few =rigAnalysis({lineset:parseLineset('1x3, 1x1.25, 2x1'),condition:'good'},41);
  const many=rigAnalysis({lineset:parseLineset('1x3, 1x1.25, 7x1'),condition:'good'},41);
  assert.ok(many.pct_of_break<few.pct_of_break,
    many.pct_of_break+' should be under '+few.pct_of_break);
});
t('the reported rig survives tonight comfortably',()=>{
  const rig={loa:100,windage_h:16,exposure:'beam',condition:'good',
    lineset:parseLineset('1x3, 1x1.25, 7x1')};
  const a=rigAnalysis(rig,41);
  assert.ok(a.pct_of_break<55,'41 kt should be well under half; got '+a.pct_of_break);
  const d=cumulativeDamage(rig,[31,33,35,38,41,40,36,32]);
  assert.ok(d.damage<0.05,'tonight should barely register; got '+d.damage);
});
t('creep life: indefinite below 30%, ~5 h at 80%, matches the published anchor',()=>{
  assert.equal(hoursToFailure(0.25),Infinity);
  assert.equal(hoursToFailure(0.30),Infinity);
  const h80=hoursToFailure(0.80);
  assert.ok(Math.abs(h80-5)<0.6,'80% should be ~5 h, got '+h80.toFixed(2));
  assert.ok(hoursToFailure(0.9)<h80,'life must fall as load rises');
});
t('duration is the variable: a gust is not the danger, hours are',()=>{
  const rig={lineset:parseLineset('4x1.25'),condition:'unknown'};
  const at35=rigAnalysis(rig,35).pct_of_break/100;
  const at41=rigAnalysis(rig,41).pct_of_break/100;
  assert.ok(hoursToFailure(at35)>24,'35 kt should be survivable for many hours');
  assert.ok(hoursToFailure(at41)<6,'41 kt should bite within hours');
});
t('Miner damage accumulates over a blow and is dimensionless',()=>{
  const rig={lineset:parseLineset('4x0.625'),condition:'unknown'};
  const short=cumulativeDamage(rig,[41]);
  const long =cumulativeDamage(rig,Array(10).fill(41));
  assert.ok(long.damage>short.damage*9,'ten hours should cost ~10x one hour');
  assert.equal(cumulativeDamage(rig,[6,8,9]).damage,0,'well below 30% costs nothing');
  assert.equal(cumulativeDamage(rig,[6,8,9]).hours_over_30pct,0);
  assert.ok(long.hours_over_30pct===10);
});
t('heavier double-braid set has real margin',()=>{
  const f=thresholdsFor({lineset:parseLineset('4x1.5db'),condition:'good'}).failure;
  assert.ok(f>70,'failure wind '+f);
});
t('derived thresholds are ordered and sane',()=>{
  const th=thresholdsFor(RIG_DEFAULTS);
  assert.ok(th.watch<th.concern && th.concern<th.critical && th.critical<th.failure,
    JSON.stringify(th));
  assert.ok(th.watch>10 && th.critical<60, JSON.stringify(th));
});
t('pct_of_break is consistent with windAtFraction',()=>{
  const rig={lineset:parseLineset('1x1.25, 7x1'),condition:'good'};
  const v=windAtFraction(rig,0.5);
  const a=rigAnalysis(rig,v);
  assert.ok(Math.abs(a.pct_of_break-50)<1,'got '+a.pct_of_break);
});
t('zero wind gives zero load, no NaN',()=>{
  const a=rigAnalysis(RIG_DEFAULTS,0);
  assert.equal(a.steady_lb,0); assert.equal(a.pct_of_break,0);
});
console.log(pass+' passed, '+fail.length+' failed');
fail.forEach(f=>console.log('  FAIL '+f));
process.exit(fail.length?1:0);
