import { sunTimes, isDaylight } from '../scripts/sun.mjs';
import assert from 'node:assert/strict';
let pass=0; const fail=[];
const t=(n,f)=>{try{f();pass++;}catch(e){fail.push(n+': '+e.message);}};

const LAT=42.465, LON=-70.945;                       // Lynn Harbor
const fmt=d=>d.toLocaleTimeString('en-US',{timeZone:'America/New_York',
  hour:'2-digit',minute:'2-digit',hour12:false});
const mins=(a,b)=>Math.abs(a-b)/60000;

// Ground truth from api.weather.gov/points/42.465,-70.945 astronomicalData
t('matches NWS sunrise/sunset for 2026-11-26 within 2 min',()=>{
  const s=sunTimes(new Date('2026-11-26T17:00:00Z'),LAT,LON);
  const truthRise=new Date('2026-11-26T06:48:14-05:00');
  const truthSet =new Date('2026-11-26T16:14:00-05:00');
  assert.ok(mins(s.sunrise,truthRise)<2,'sunrise '+fmt(s.sunrise)+' vs 06:48 — off by '+
    mins(s.sunrise,truthRise).toFixed(1)+' min');
  assert.ok(mins(s.sunset,truthSet)<2,'sunset '+fmt(s.sunset)+' vs 16:14 — off by '+
    mins(s.sunset,truthSet).toFixed(1)+' min');
});
t('matches NWS civil twilight within 3 min',()=>{
  const s=sunTimes(new Date('2026-11-26T17:00:00Z'),LAT,LON);
  assert.ok(mins(s.dawn,new Date('2026-11-26T06:17:16-05:00'))<3,'dawn '+fmt(s.dawn));
  assert.ok(mins(s.dusk,new Date('2026-11-26T16:44:58-05:00'))<3,'dusk '+fmt(s.dusk));
});
t('sunset is before sunrise+12h in late November (short day)',()=>{
  const s=sunTimes(new Date('2026-11-26T17:00:00Z'),LAT,LON);
  const len=(s.sunset-s.sunrise)/3600e3;
  assert.ok(len>9&&len<9.7,'day length '+len.toFixed(2)+' h');
});
t('summer solstice is a long day',()=>{
  const s=sunTimes(new Date('2027-06-21T16:00:00Z'),LAT,LON);
  const len=(s.sunset-s.sunrise)/3600e3;
  assert.ok(len>15&&len<15.5,'solstice day length '+len.toFixed(2)+' h');
});
t('isDaylight: 5 PM on 2026-11-26 is DARK (the hardcoded 8pm got this wrong)',()=>{
  assert.equal(isDaylight(new Date('2026-11-26T17:00:00-05:00'),LAT,LON),false);
});
t('isDaylight: noon is light, 3 AM is dark',()=>{
  assert.equal(isDaylight(new Date('2026-11-26T12:00:00-05:00'),LAT,LON),true);
  assert.equal(isDaylight(new Date('2026-11-26T03:00:00-05:00'),LAT,LON),false);
});
t('handles a polar latitude without throwing',()=>{
  const s=sunTimes(new Date('2026-12-21T12:00:00Z'),78.2,15.6);   // Svalbard
  assert.ok(s===null||s.sunrise instanceof Date);
  assert.equal(typeof isDaylight(new Date('2026-12-21T12:00:00Z'),78.2,15.6),'boolean');
});
console.log(pass+' passed, '+fail.length+' failed');
fail.forEach(f=>console.log('  FAIL '+f));
process.exit(fail.length?1:0);
