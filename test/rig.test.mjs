import { windLoadLb, lineBreakLb, rigAnalysis, windAtFraction, thresholdsFor,
         RIG_DEFAULTS } from '../scripts/rig.mjs';
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
t('line strength scales with d^2 and errs under the published 1-1/4"',()=>{
  assert.equal(Math.round(lineBreakLb(1,'3strand')),22600);
  const d125=lineBreakLb(1.25,'3strand');
  assert.ok(d125 < 37500, 'should under-predict published 37,500; got '+d125.toFixed(0));
  assert.ok(d125 > 33000, 'but not wildly; got '+d125.toFixed(0));
});
t('double braid is stronger than 3-strand at equal diameter',()=>{
  assert.ok(lineBreakLb(1,'doublebraid')>lineBreakLb(1,'3strand'));
});
t('the headline case: 1in 3-strand aged fails below tonight 41 kt peak',()=>{
  const f=thresholdsFor({dia:1.0,construction:'3strand',condition:'aged'}).failure;
  assert.ok(f>34 && f<42,'failure wind '+f);
  assert.ok(f<41,'the whole point: '+f+' kt is under the 41 kt forecast peak');
});
t('1.5in double braid has real margin',()=>{
  const f=thresholdsFor({dia:1.5,construction:'doublebraid',condition:'aged'}).failure;
  assert.ok(f>60,'failure wind '+f);
});
t('derived thresholds are ordered and sane',()=>{
  const th=thresholdsFor(RIG_DEFAULTS);
  assert.ok(th.watch<th.concern && th.concern<th.critical && th.critical<th.failure,
    JSON.stringify(th));
  assert.ok(th.watch>10 && th.critical<60, JSON.stringify(th));
});
t('a better line raises every threshold',()=>{
  const weak=thresholdsFor({dia:1.0,construction:'3strand',condition:'aged'});
  const strong=thresholdsFor({dia:1.5,construction:'doublebraid',condition:'new'});
  for(const k of ['watch','concern','critical','failure'])
    assert.ok(strong[k]>weak[k],k+': '+strong[k]+' !> '+weak[k]);
});
t('pct_of_break is consistent with windAtFraction',()=>{
  const rig={dia:1.0,construction:'3strand',condition:'aged'};
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
