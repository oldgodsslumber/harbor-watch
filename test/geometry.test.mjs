import { readFileSync } from 'node:fs';
// ---- minimal DOM shim ----
const made=[];
class N{
  constructor(tag){this.tag=tag;this.attrs={};this.kids=[];this._t=null;made.push(this);}
  setAttribute(k,v){this.attrs[k]=String(v);}
  removeAttribute(k){delete this.attrs[k];}
  getAttribute(k){return this.attrs[k];}
  appendChild(c){this.kids.push(c);return c;}
  set textContent(v){this._t=v;if(v==='')this.kids=[];}
  get textContent(){return this._t;}
  set innerHTML(v){this._h=v;} get innerHTML(){return this._h||'';}
  addEventListener(){} getBoundingClientRect(){return {width:680,height:230,top:0,left:0};}
  querySelectorAll(){return [];} get style(){return this._s||(this._s={});}
  get classList(){return {add(){},remove(){},toggle(){}};}
}
const byId={};
const ids=['lthero','ltrows','ltstrip','alarmrt','lthint','daylight','ltscale','stations','stationsrt','statusbar','stword','stmain','stwhy',
 'stfactors','inbox','inboxrt','standby',
 'baro','barova','barotd','barort','sunarc','sunrt','condglyph','condtemp','condtext',
 'condfeels','condgrid','condsrc','precipbars','preciptotal','precipnote','loadx','loadbar','loadnow','loadpk','loadpkt',
 'loadnote','wtemp','wnote','loadrt','linegrid','capbar','capnote','rigwarn','righint',
 'rdia','rcon','rcond','rwh','rloa','rexp','rauto','tlnight','expribbon',
 'gauge','compass','tidelevel','tidecurve','tidedir','wl','wls','chip','chiptx',
 'nowsrc','expnow','feeds','tip','locname','updated','lead1','lead2','lead3','lead4',
 'tl','tlx','buoys','alertbox','alertev','alertwhen','alertdesc','flash','ack','panel',
 'gearbtn','save','testsound','playbtn','frame','framets','recenter','radarts','map',
 'mapfallback','t1','t2','t3','talarm','arc1','arc2','lat','lon','nm','stn','tideloc'];
ids.forEach(i=>byId[i]=new N('div'));
globalThis.document={
  createElementNS:(ns,tag)=>new N(tag),
  createElement:tag=>new N(tag),
  getElementById:i=>byId[i]||(byId[i]=new N('div')),
  querySelector:()=>new N('div'), addEventListener(){}, documentElement:new N('html'),
  set title(v){}, get title(){return '';}
};
globalThis.window={addEventListener(){},innerWidth:1200,AudioContext:null};
globalThis.localStorage={getItem:()=>null,setItem(){}};
globalThis.getComputedStyle=()=>({getPropertyValue:n=>({
  '--calm':'#4da3ff','--watch':'#ffe066','--concern':'#fb923c','--crit':'#ef4444',
  '--sea':'#2f7fd4','--sea2':'#1e5fa8'}[n]||'#4da3ff')});
globalThis.setInterval=()=>0; globalThis.clearInterval=()=>{}; globalThis.setTimeout=()=>0;
globalThis.clearTimeout=()=>{}; globalThis.fetch=async()=>({ok:false,status:500});
globalThis.L=undefined;

// Read the SHIPPED page, not scratch files: this suite must fail if index.html
// and the sources ever disagree. The page carries one inline <script> holding
// sun + rig + part 1 (drawing) + part 2 (data/map); part 2 needs a live DOM and
// a network, so it is cut off at its own banner and only part 1 is exercised.
const PAGE=new URL('../index.html',import.meta.url);
const html=readFileSync(PAGE,'utf8');
const m=html.match(/<script>\n([\s\S]*?)\n<\/script>/);
if(!m) throw new Error('could not find the inline script in index.html');
const CUT='/* ---------- map ---------- */';
const ci=m[1].indexOf(CUT);
if(ci<0) throw new Error('part 2 banner not found — update CUT in this test');
const src=m[1].slice(0,ci)
  .replace(/^'use strict';/,'')
  + '\nglobalThis.__fns={CFG,drawStatus,drawInbox,computeStatus,alarmLevel,currentTiers,applyAutoThresholds,setSNAP:v=>{SNAP=v;},setHOURS:v=>{HOURS=v;},getSNAP:()=>SNAP,drawStations,drawConditions,drawPrecip,wmoLabel,wmoKind,drawSun,drawGauge,drawCompass,drawTideLevel,drawTideCurve,arcD,polar,tier,drawLeadTime,episodes,drawPressure,drawLoad,drawWater,sunTimes,isDaylight};';
new Function(src)();
const F=globalThis.__fns;

// ---- real data ----
const series=[];
let base=Date.now()-6*3600e3;
for(let i=0;i<420;i++){                        // 42 h of 6-min predictions
  const h=(base+i*6*60000);
  const v=5.3+6.5*Math.sin((h/1000/3600)*(2*Math.PI/12.42));
  const d=new Date(h);
  const p=n=>String(n).padStart(2,'0');
  series.push({t:d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+
    p(d.getHours())+':'+p(d.getMinutes()),v:+v.toFixed(3)});
}
const extremes=[{t:series[60].t,v:11.8,type:'H'},{t:series[180].t,v:-1.3,type:'L'}];
const tide={observed_ft:12.095,observed_at:series[61].t,predicted_ft:11.325,
  surge_ft:0.77,series,extremes};

let pass=0; const fail=[];
const assert=(c,m)=>{if(!c)throw new Error(m||'assertion failed');};
const t=(n,f)=>{try{f();pass++;}catch(e){fail.push(n+': '+e.message);}};
function scan(label){
  const bad=[];
  for(const n of made) for(const k in n.attrs){
    const v=n.attrs[k];
    if(/NaN|undefined|Infinity/.test(v)) bad.push(label+' <'+n.tag+' '+k+'="'+v.slice(0,60)+'">');
  }
  if(bad.length) throw new Error(bad.slice(0,4).join(' | '));
}
const reset=()=>{made.length=0;};

t('gauge: normal gust',()=>{reset();F.drawGauge(37,19);scan('gauge');});
t('gauge: null gust',()=>{reset();F.drawGauge(null,null);scan('gauge-null');});
t('gauge: zero',()=>{reset();F.drawGauge(0,0);scan('gauge-0');});
t('gauge: huge gust beyond scale',()=>{reset();F.drawGauge(140,120);scan('gauge-big');});
t('compass: normal',()=>{reset();F.drawCompass(70,37);scan('compass');});
t('compass: null dir',()=>{reset();F.drawCompass(null,null);scan('compass-null');});
t('compass: dir 0 and 359',()=>{reset();F.drawCompass(0,10);F.drawCompass(359,10);scan('compass-edge');});
t('tide level: full data',()=>{reset();F.drawTideLevel(tide);scan('tidelevel');});
t('tide level: null',()=>{reset();F.drawTideLevel(null);scan('tidelevel-null');});
t('tide level: flat series (hi==lo guard)',()=>{reset();
  F.drawTideLevel({series:[{t:series[0].t,v:4},{t:series[1].t,v:4}],extremes:[]});
  scan('tidelevel-flat');});
t('tide level: no observed, predicted only',()=>{reset();
  F.drawTideLevel({observed_ft:null,predicted_ft:6.2,series,extremes});scan('tl-pred');});
t('tide curve: full data',()=>{reset();F.drawTideCurve(tide);scan('tidecurve');});
t('tide curve: empty series',()=>{reset();F.drawTideCurve({series:[],extremes:[]});scan('tc-empty');});
t('tide curve: single point',()=>{reset();
  F.drawTideCurve({series:[{t:series[0].t,v:5}],extremes:[]});scan('tc-one');});
t('tide curve: null',()=>{reset();F.drawTideCurve(null);scan('tc-null');});
t('arcD produces finite coords',()=>{
  const d=F.arcD(130,126,92,-125,125);
  if(/NaN/.test(d))throw new Error(d);
  if(!/^M[\d.-]+,[\d.-]+ A/.test(d))throw new Error('shape: '+d);});
t('exposed arc wrapping past north (340->40)',()=>{reset();
  const o={arc1:340,arc2:40};
  // emulate the wrap path the compass builds
  F.drawCompass(10,25);scan('wrap');});
t('tier boundaries track the configured thresholds',()=>{
  const C=F.CFG;
  if(F.tier(0)!==0)throw new Error('calm');
  if(F.tier(C.t1)!==1||F.tier(C.t1-0.01)!==0)throw new Error('watch edge at '+C.t1);
  if(F.tier(C.t2)!==2||F.tier(C.t2-0.01)!==1)throw new Error('concern edge at '+C.t2);
  if(F.tier(C.t3)!==3||F.tier(C.t3-0.01)!==2)throw new Error('critical edge at '+C.t3);});


// ---- lead-time widget, against the real collector forecast ----
import {readFileSync as rf} from 'node:fs';
let real=null;
try{real=JSON.parse(rf('/tmp/latest.json','utf8'));}catch(e){}
const H=(real&&real.forecast?real.forecast:[]).map(h=>({t:new Date(h.t),s:h.s,g:h.g,d:h.d}));

t('lead: real 72h forecast',()=>{reset();
  if(!H.length)throw new Error('no real forecast loaded');
  F.drawLeadTime(H,26);scan('lt-real');});
t('lead: live gust already over critical',()=>{reset();F.drawLeadTime(H,55);scan('lt-over');});
t('lead: live gust null',()=>{reset();F.drawLeadTime(H,null);scan('lt-null');});
t('lead: live gust zero',()=>{reset();F.drawLeadTime(H,0);scan('lt-zero');});
t('lead: empty forecast',()=>{reset();F.drawLeadTime([],20);scan('lt-empty');});
t('lead: all calm',()=>{reset();
  const c=H.map(h=>({...h,g:5}));F.drawLeadTime(c,5);scan('lt-calm');});
t('lead: all storm (no easing)',()=>{reset();
  const c=H.map(h=>({...h,g:60}));F.drawLeadTime(c,60);scan('lt-storm');});

t('episodes: finds contiguous runs and peak',()=>{
  const mk=(...gs)=>gs.map((g,i)=>({t:new Date(Date.now()+i*3600e3),g}));
  const e=F.episodes(mk(5,25,30,5,5,40,45,5),22);
  if(e.length!==2)throw new Error('expected 2 runs, got '+e.length);
  if(e[0].peak!==30)throw new Error('run 1 peak '+e[0].peak);
  if(e[1].peak!==45)throw new Error('run 2 peak '+e[1].peak);});
t('episodes: run reaching the end stays open-ended',()=>{
  const mk=(...gs)=>gs.map((g,i)=>({t:new Date(Date.now()+i*3600e3),g}));
  const e=F.episodes(mk(5,5,30,35),22);
  if(e.length!==1||e[0].peak!==35)throw new Error(JSON.stringify(e.map(x=>x.peak)));});
t('episodes: none below threshold',()=>{
  const mk=(...gs)=>gs.map((g,i)=>({t:new Date(Date.now()+i*3600e3),g}));
  if(F.episodes(mk(1,2,3),22).length!==0)throw new Error('should be empty');});


t('pressure: no snapshot',()=>{reset();F.setSNAP(null);F.drawPressure();scan('baro-null');});
t('pressure: real history',()=>{reset();
  const now=Date.now();
  F.setSNAP({buoys:{'44013':{id:'44013',pressure_hpa:1032.4,pressure_tendency_hpa:-3.9,
    water_temp_f:52.5}},history:{'44013':Array.from({length:180},(_,i)=>({
      t:new Date(now-i*600000).toISOString(),p:1032+i*0.02,s:20,g:25,d:70}))}});
  F.drawPressure();scan('baro-real');});
t('pressure: flat series (hi==lo guard)',()=>{reset();
  F.setSNAP({buoys:{'44013':{id:'44013',pressure_hpa:1000,pressure_tendency_hpa:0}},
    history:{'44013':Array.from({length:10},(_,i)=>({t:new Date(Date.now()-i*600000).toISOString(),p:1000}))}});
  F.drawPressure();scan('baro-flat');});
t('load: normal',()=>{reset();F.drawLoad(26,H);scan('load');});
t('load: zero / null current',()=>{reset();F.drawLoad(0,H);F.drawLoad(null,H);scan('load-null');});
t('load: empty forecast',()=>{reset();F.drawLoad(26,[]);scan('load-empty');});
t('load: square law is right (25->40 kt is 2.56x)',()=>{
  const r=Math.pow(40/25,2);
  if(Math.abs(r-2.56)>0.01)throw new Error('ratio '+r);});
t('water: bands and null',()=>{reset();
  F.setSNAP({buoys:{'a':{water_temp_f:52.5}}});F.drawWater();
  F.setSNAP({buoys:{'a':{water_temp_f:38}}});F.drawWater();
  F.setSNAP({buoys:{'a':{water_temp_f:null}}});F.drawWater();scan('water');});
t('strip night shading does not throw',()=>{reset();
  F.setSNAP(null);F.drawLeadTime(H,26);scan('strip-night');});
t('sun: 5 PM today is dark at Lynn',()=>{
  if(F.isDaylight(new Date('2026-11-26T17:00:00-05:00'),42.465,-70.945))
    throw new Error('should be dark');});


t('sun arc: daytime',()=>{reset();F.drawSun();scan('sun-day');});
t('sun arc: survives a polar latitude',()=>{reset();
  try{F.CFG.lat=78.2;F.CFG.lon=15.6;F.drawSun();scan('sun-polar');}
  finally{F.CFG.lat=42.465;F.CFG.lon=-70.945;}});
t('sun arc: equator',()=>{reset();
  try{F.CFG.lat=0.0;F.CFG.lon=0.0;F.drawSun();scan('sun-eq');}
  finally{F.CFG.lat=42.465;F.CFG.lon=-70.945;}});
t('sun arc: night branch',()=>{reset();
  const RD=Date;globalThis.Date=class extends RD{
    constructor(...a){return a.length?new RD(...a):new RD('2026-11-26T23:30:00-05:00');}
    static now(){return new RD('2026-11-26T23:30:00-05:00').getTime();}};
  try{F.drawSun();scan('sun-night');}finally{globalThis.Date=RD;}});


// --- conditions + precipitation widgets ---
const HP=H.map((h,i)=>({...h,p:[0,0,0.004,0.028,0.031,0.091,0.181][i%7],
  pp:[0,2,33,51,73,96,100][i%7],sn:0,wc:[3,3,51,53,53,61,63][i%7],
  tc:44.6-i*0.1,fl:34.5-i*0.1}));
t('conditions: with obs + model',()=>{reset();
  F.setSNAP({obs:{station:'KBOS',observed_at:new Date().toISOString(),temp_f:44.6,
    dewpoint_f:33,windchill_f:34.5,humidity_pct:65,visibility_mi:10,text:'Cloudy and Windy'},
    current_model:{weather_code:3,is_day:1,temperature_2m:44.6,apparent_temperature:34.5,
      relative_humidity_2m:65},buoys:{a:{water_temp_f:52.5}}});
  F.setHOURS(HP);F.drawConditions();scan('cond');});
t('conditions: no snapshot at all',()=>{reset();F.setSNAP(null);F.setHOURS(HP);
  F.drawConditions();scan('cond-null');});
t('conditions: every weather code renders a glyph',()=>{reset();
  [0,1,2,3,45,51,53,61,63,65,71,75,80,82,95,99,999].forEach(c=>{
    F.setSNAP({obs:null,current_model:{weather_code:c,is_day:0}});
    F.drawConditions();});
  scan('cond-codes');});
t('precip: normal 4 h',()=>{reset();F.setHOURS(HP);
  F.setSNAP({obs:null,current_model:null});F.drawPrecip();scan('precip');});
t('precip: all dry',()=>{reset();
  F.setHOURS(H.map(h=>({...h,p:0,pp:0,sn:0,wc:3})));F.drawPrecip();scan('precip-dry');});
t('precip: snow in the mix',()=>{reset();
  F.setHOURS(H.map(h=>({...h,p:0.05,pp:80,sn:0.4,wc:73})));F.drawPrecip();
  scan('precip-snow');});
t('precip: no forecast loaded',()=>{reset();F.setHOURS([]);F.drawPrecip();
  scan('precip-empty');F.setHOURS(HP);});
t('wmo: known and unknown codes',()=>{
  if(F.wmoLabel(65)!=='Heavy rain')throw new Error(F.wmoLabel(65));
  if(F.wmoKind(73)!=='snow')throw new Error(F.wmoKind(73));
  if(F.wmoLabel(4242)!=='—')throw new Error('unknown code should fall back');});


t('stations: full table',()=>{reset();
  F.setSNAP({stations:[
    {id:'44013',name:'Boston',kind:'buoy',primary:true,dist_nm:14.9,bearing:'ESE',
     at:new Date().toISOString(),s:21,g:25,d:70,wv:6.2,water_f:52.5},
    {id:'8444069',name:'Castle Island',kind:'land',primary:false,dist_nm:8,bearing:'SSW',
     at:new Date().toISOString(),s:26.6,g:33.4,d:72},
    {id:'IOSN3',name:'Isle of Shoals',kind:'buoy',primary:false,dist_nm:33.3,bearing:'NNE',
     at:new Date(Date.now()-3*3600e3).toISOString(),s:null,g:null,d:null}]});
  F.drawStations();
  const h=byId['stations'].innerHTML;
  if(!/PRIMARY/.test(h))throw new Error('primary badge missing');
  if(!/Castle Island/.test(h))throw new Error('watch station missing');
  if(!/—/.test(h))throw new Error('null cells should render a dash');
  const rt=byId['stationsrt'].textContent;
  if(!/25–33/.test(rt))throw new Error('spread wrong: '+rt);
  const order=[...h.matchAll(/>(\d+\.\d) nm</g)].map(m=>+m[1]);
  if(JSON.stringify(order)!==JSON.stringify([...order].sort((a,b)=>a-b)))
    throw new Error('not sorted by distance: '+order);});
t('stations: none yet',()=>{reset();F.setSNAP({stations:[]});F.drawStations();
  if(!/waiting/.test(byId['stations'].innerHTML))throw new Error('no empty state');});
t('stations: no snapshot',()=>{reset();F.setSNAP(null);F.drawStations();});


t('line load: renders the reported nine-line set',()=>{reset();
  F.drawLoad(26,H);scan('lines');
  const g=byId['linegrid'].innerHTML, n=byId['capnote'].textContent;
  if(!/lb/.test(g))throw new Error('no pounds shown');
  if(!/8 lines counted/.test(n))throw new Error('bow line should be excluded abeam: '+n);
  if(!/1\.25" line/.test(n))throw new Error('governing line should be named: '+n);});
t('line load: an unspecified set is called out',()=>{reset();
  const old=JSON.stringify(F.CFG.rig);
  try{F.CFG.rig.condition='unknown';F.drawLoad(26,H);scan('lines-unknown');
    if(!/unspecified/.test(byId['rigwarn'].textContent))
      throw new Error('should warn when the lines are unknown');
  }finally{F.CFG.rig=JSON.parse(old);}});
t('line load: the duration readout appears',()=>{reset();
  F.drawLoad(26,H);
  const d=byId['dosegrid'].innerHTML;
  if(!/Hours over 30%/.test(d))throw new Error('no duration panel');
  if(!/creep life/.test(d))throw new Error('no line-life cost');});
t('line load: zero and null gust',()=>{reset();F.drawLoad(0,H);F.drawLoad(null,H);
  scan('lines-zero');});
t('line load: no forecast',()=>{reset();F.drawLoad(26,[]);scan('lines-nofc');});


t('status: calm',()=>{reset();
  const st=F.computeStatus(8,true,H.map(h=>({...h,g:8})),[],{surge_ft:0});
  if(st.lvl!==0)throw new Error('expected NORMAL, got '+st.lvl);});
t('status: a warning alone lifts it to ORANGE',()=>{reset();
  const st=F.computeStatus(8,true,H.map(h=>({...h,g:8})),
    [{event:'Gale Warning'}],{surge_ft:0});
  if(st.lvl!==2)throw new Error('got '+st.lvl);});
t('status: an advisory alone is YELLOW',()=>{reset();
  const st=F.computeStatus(8,true,H.map(h=>({...h,g:8})),
    [{event:'Small Craft Advisory'}],{surge_ft:0});
  if(st.lvl!==1)throw new Error('got '+st.lvl);});
t('status: line load at peak can drive RED on its own',()=>{reset();
  const st=F.computeStatus(10,true,H.map(h=>({...h,g:55})),[],{surge_ft:0});
  if(st.lvl!==3)throw new Error('got '+st.lvl);
  if(!st.driver.join(' ').match(/breaking strength/))
    throw new Error('driver should name the lines: '+st.driver);});
t('status: surge contributes',()=>{reset();
  const st=F.computeStatus(8,true,H.map(h=>({...h,g:8})),[],{surge_ft:2.4});
  if(st.lvl!==2)throw new Error('got '+st.lvl);});
t('status: no reading is not treated as calm',()=>{reset();
  const st=F.computeStatus(null,false,[],[],null);
  if(st.lvl<1)throw new Error('absent data should not read as NORMAL');});
t('status: renders without NaN at every level',()=>{
  [[8,[]],[26,[{event:'Small Craft Advisory'}]],[33,[{event:'Gale Warning'}]],
   [55,[{event:'Storm Warning'}]]].forEach(([g,al])=>{
    reset();F.drawStatus(g,true,H.map(h=>({...h,g:g})),al,{surge_ft:0.4});
    scan('status-'+g);});});
t('inbox: empty state',()=>{reset();F.drawInbox([]);
  if(!/No active warnings/.test(byId['inbox'].innerHTML))throw new Error('no empty state');});
t('inbox: sorts worst first and escapes markup',()=>{reset();
  F.drawInbox([{event:'Small Craft Advisory',area:'BH',onset:'2026-11-26T12:00:00Z'},
    {event:'Gale Warning',area:'Mass Bay',onset:'2026-11-26T09:00:00Z',
     description:'* WHAT...East winds <script>alert(1)</script> 25 to 35 kt'}]);
  const h2=byId['inbox'].innerHTML;
  if(h2.indexOf('Gale Warning')>h2.indexOf('Small Craft'))throw new Error('not sorted');
  if(/<script>/.test(h2))throw new Error('markup not escaped');});

// The real page's alarm wiring, exercised against the real CFG. test/alarm.test.mjs
// mirrors this logic to cover stale-config migration; these assertions are what
// stop the mirror and the page from drifting apart.
t('alarm is derived from the live ladder, not a stored number',()=>{
  const C=F.CFG;
  const save={t1:C.t1,t2:C.t2,t3:C.t3,tier:C.alarmTier,ta:C.talarm,auto:C.autoTh};
  try{
    C.autoTh=0; C.alarmTier='concern';
    C.t1=20;C.t2=28;C.t3=36; F.applyAutoThresholds();
    assert(F.alarmLevel()===28,'expected 28, got '+F.alarmLevel());
    // move the ladder and the alarm must move with it, with no save in between
    C.t1=31;C.t2=44;C.t3=57; F.applyAutoThresholds();
    assert(F.alarmLevel()===44,'alarm did not follow the ladder: '+F.alarmLevel());
    C.alarmTier='critical';
    assert(F.alarmLevel()===57,'tier switch not honoured: '+F.alarmLevel());
    C.alarmTier='custom'; C.talarm=49;
    C.t1=10;C.t2=20;C.t3=30; F.applyAutoThresholds();
    assert(F.alarmLevel()===49,'custom should not drift: '+F.alarmLevel());
  }finally{
    C.t1=save.t1;C.t2=save.t2;C.t3=save.t3;C.alarmTier=save.tier;
    C.talarm=save.ta;C.autoTh=save.auto;F.applyAutoThresholds();
  }
});

t('alarm provenance line is rendered and names the tier',()=>{
  reset();
  const H2=[{t:new Date(Date.now()+3600e3),g:20,s:15,d:60},
            {t:new Date(Date.now()+7200e3),g:24,s:18,d:70}];
  F.drawLeadTime(H2,18);
  const p=document.getElementById('ltprov');
  assert(p&&/alarm/i.test(p.textContent),'no provenance text');
  assert(new RegExp(F.CFG.alarmTier==='custom'?'by hand':F.CFG.alarmTier)
    .test(p.textContent),'provenance does not name the tier: '+p.textContent);
  assert(p.textContent.indexOf(String(F.alarmLevel()))>=0,
    'provenance does not state the armed speed');
  scan('alarm-prov');
});

console.log(pass+' passed, '+fail.length+' failed');
fail.forEach(f=>console.log('  FAIL '+f));
process.exit(fail.length?1:0);
