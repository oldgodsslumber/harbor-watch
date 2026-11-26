import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// collect.mjs writes relative to cwd, so run the whole thing in a scratch dir
// and never anywhere near the repo's real data/.
const ROOT = process.cwd();
process.chdir(mkdtempSync(join(tmpdir(), 'harborwatch-')));
const fixture = readFileSync(join(ROOT,'test/fixture_44013.txt'),'utf8');
globalThis.fetch = async (url) => {
  const u=String(url); const ok=b=>({ok:true,status:200,json:async()=>b,text:async()=>JSON.stringify(b)});
  if(u.includes('realtime2/44013')) return {ok:true,status:200,text:async()=>fixture};
  if(u.includes('realtime2/44029')) return {ok:false,status:404};
  if(u.includes('/observations/latest')) return ok({properties:{stationName:'Logan',
    timestamp:new Date().toISOString(),windSpeed:{unitCode:'wmoUnit:km_h-1',value:35.172},
    windGust:{unitCode:'wmoUnit:km_h-1',value:44.46},windDirection:{value:70},
    temperature:{value:8},dewpoint:{value:3},relativeHumidity:{value:65},
    windChill:{value:2},visibility:{value:16093}}});
  if(u.includes('alerts/active')) return ok({features:[
    {properties:{event:'Gale Warning',areaDesc:'Mass Bay',onset:'x',ends:'y'}}]});
  if(u.includes('open-meteo')) return ok({hourly:{
    time:Array.from({length:30},(_,i)=>new Date(Date.now()+i*3600e3).toISOString().slice(0,16)),
    wind_speed_10m:Array(30).fill(20),wind_gusts_10m:Array.from({length:30},(_,i)=>25+i),
    wind_direction_10m:Array(30).fill(70),precipitation:Array(30).fill(0.01),
    precipitation_probability:Array(30).fill(40),snowfall:Array(30).fill(0),
    weather_code:Array(30).fill(61),temperature_2m:Array(30).fill(44),
    apparent_temperature:Array(30).fill(35)},
    current:{temperature_2m:44,apparent_temperature:35,relative_humidity_2m:65,
      weather_code:3,is_day:1}});
  if(u.includes('product=water_level')) return ok({data:[{t:'2026-11-26 16:18',v:'9.5'}]});
  if(u.includes('interval=hilo')) return ok({predictions:[{t:'2026-11-26 18:00',v:'-1.4',type:'L'}]});
  if(u.includes('product=predictions')) return ok({predictions:[
    {t:'2026-11-26 16:00',v:'9.9'},{t:'2026-11-26 16:30',v:'9.0'}]});
  return {ok:false,status:500};
};
mkdirSync('data',{recursive:true});
// seed history containing TWO older days plus today
const now=Date.now(), DAY=864e5;
const mk=(ms,g)=>({t:new Date(ms).toISOString(),s:20,g,d:70,wv:5,p:1020});
writeFileSync('data/latest.json',JSON.stringify({history:{'44013':[
  mk(now-2*DAY,44),mk(now-2*DAY+36e5,41),
  mk(now-1*DAY,33),mk(now-1*DAY+36e5,30),
  mk(now-36e5,27)]}}));

await import(new URL('file://'+join(ROOT,'scripts/collect.mjs')).href+'?v=1');
const d=JSON.parse(readFileSync('data/latest.json','utf8'));
const daily=JSON.parse(readFileSync('data/daily.json','utf8'));
let pass=0;const fail=[];const t=(n,f)=>{try{f();pass++;}catch(e){fail.push(n+': '+e.message);}};
const a=(c,m)=>{if(!c)throw new Error(m);};
const key=ms=>new Date(ms).toISOString().slice(0,10);

t('finished days were flushed to archive files',()=>{
  a(existsSync('data/archive/'+key(now-2*DAY)+'.json'),'day -2 missing');
  a(existsSync('data/archive/'+key(now-1*DAY)+'.json'),'day -1 missing');});
t('today is NOT archived yet (still accumulating)',()=>
  a(!existsSync('data/archive/'+key(now)+'.json'),'today was written early'));
t('archive holds the full-resolution samples',()=>{
  const ar=JSON.parse(readFileSync('data/archive/'+key(now-2*DAY)+'.json','utf8'));
  const arr=ar.buoys['44013'];
  a(arr.length>=2,'got '+arr.length);
  a(arr.some(x=>x.g===44),'the seeded 44 kt sample was lost');
  a(arr.every((x,i)=>i===0||new Date(arr[i-1].t)<=new Date(x.t)),'not sorted');
  a(new Set(arr.map(x=>x.t)).size===arr.length,'duplicate timestamps');});
t('daily rollup has a line per day incl. today',()=>{
  a(daily.days.length>=3,'got '+daily.days.length);
  const older=daily.days.find(x=>x.date===key(now-2*DAY));
  a(older.max_gust_kt===44,'max '+older.max_gust_kt);});
t('peak_all_time spans the whole record, not just latest.json',()=>
  a(d.peak_all_time&&d.peak_all_time.gust_kt===44,JSON.stringify(d.peak_all_time)));
t('today_log carries obs and tide for the current day',()=>{
  a(d.today_log&&d.today_log.date===key(now),'date');
  a(d.today_log.obs.length===1,'obs '+d.today_log.obs.length);
  a(d.today_log.tide.length===1,'tide '+d.today_log.tide.length);});
t('latest.json stayed lean',()=>{
  const kb=statSync('data/latest.json').size/1024;
  a(kb<120,'latest.json is '+kb.toFixed(0)+' KB');});
t('observation extras captured',()=>{
  a(d.obs.temp_f===46.4,'temp '+d.obs.temp_f);
  a(d.obs.humidity_pct===65&&d.obs.visibility_mi===10,'hum/vis');});

// second run must NOT rewrite the archives
const before=['-2','-1'].map((o,i)=>statSync('data/archive/'+key(now-(2-i)*DAY)+'.json').mtimeMs);
await new Promise(r=>setTimeout(r,15));
await import(new URL('file://'+join(ROOT,'scripts/collect.mjs')).href+'?v=2');
const after=['-2','-1'].map((o,i)=>statSync('data/archive/'+key(now-(2-i)*DAY)+'.json').mtimeMs);
t('a second run does not rewrite finished archives',()=>
  a(JSON.stringify(before)===JSON.stringify(after),'archives were rewritten'));

console.log(pass+' passed, '+fail.length+' failed');fail.forEach(f=>console.log('  FAIL '+f));
process.exit(fail.length?1:0);
