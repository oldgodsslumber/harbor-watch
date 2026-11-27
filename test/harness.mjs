// Shared test harness: a minimal DOM shim plus a loader that pulls the drawing
// half of the SHIPPED index.html and hands back its functions. Used by both
// geometry.test.mjs and status.test.mjs so the two cannot drift apart, and so
// neither can accidentally test scratch files instead of what we ship.
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
  + '\nglobalThis.__fns={CFG,drawStatus,drawInbox,computeStatus,statusSentence,fillWindGaps,liveAlertsOnly,alertWindowHours,snapAgeMin,alarmLevel,currentTiers,applyAutoThresholds,setSNAP:v=>{SNAP=v;},setHOURS:v=>{HOURS=v;},getSNAP:()=>SNAP,drawStations,drawConditions,drawPrecip,wmoLabel,wmoKind,drawSun,drawGauge,drawCompass,drawTideLevel,drawTideCurve,arcD,polar,tier,drawLeadTime,episodes,drawPressure,drawLoad,drawWater,sunTimes,isDaylight};';
new Function(src)();
const F=globalThis.__fns;

// A snapshot that is fresh as far as the page is concerned. computeStatus
// reports "no collector data" when SNAP is missing, which is correct but would
// otherwise colour every unrelated assertion.
export function freshSnap(extra){
  return Object.assign({generated_at:new Date().toISOString(),buoys:{},
    alerts:[],peaks_7d:{}},extra||{});
}
// Readers for the bits of the status widget the suites assert on.
F.stmainText=()=>byId['stmain'].textContent||'';
F.stwhyText=()=>byId['stwhy'].textContent||'';
F.stblindText=()=>byId['stblind'].textContent||'';
F.stwordText=()=>byId['stword'].textContent||'';
export { F, made, byId };
export function resetDom(){made.length=0;Object.keys(byId).forEach(k=>{
  const n=byId[k];n._h='';n._t=null;n.kids=[];});}
