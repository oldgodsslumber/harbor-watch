// Sunrise / sunset / civil twilight, computed locally so the daylight band can
// cover any date in the forecast window without a network call.
// Standard low-precision solar position (SunCalc-equivalent); accurate to well
// under a minute for these latitudes, which is far finer than we need.
const rad = Math.PI / 180, J2000 = 2451545, DAY = 86400000;

const toJulian   = d => d.valueOf() / DAY - 0.5 + 2440588;
const fromJulian = j => new Date((j + 0.5 - 2440588) * DAY);
const toDays     = d => toJulian(d) - J2000;

const solarMeanAnomaly = d => rad * (357.5291 + 0.98560028 * d);
function eclipticLongitude(M){
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + rad * 102.9372 + Math.PI;
}
const declination = L => Math.asin(Math.sin(rad * 23.4397) * Math.sin(L));

const julianCycle   = (d, lw) => Math.round(d - 0.0009 - lw / (2 * Math.PI));
const approxTransit = (Ht, lw, n) => 0.0009 + (Ht + lw) / (2 * Math.PI) + n;
const solarTransitJ = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
function hourAngle(h, phi, d){
  const x = (Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d));
  if (x > 1) return null;    // sun never rises that high (polar night)
  if (x < -1) return null;   // sun never sets that low (midnight sun)
  return Math.acos(x);
}

// angle: -0.833 deg = sunrise/sunset (refraction + solar radius), -6 = civil twilight
function event(date, lat, lon, angleDeg){
  const lw = rad * -lon, phi = rad * lat;
  const d = toDays(date), n = julianCycle(d, lw), ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds), L = eclipticLongitude(M), dec = declination(L);
  const Jnoon = solarTransitJ(ds, M, L);
  const w = hourAngle(rad * angleDeg, phi, dec);
  if (w === null) return null;
  const Jset = solarTransitJ(approxTransit(w, lw, n), M, L);
  return { rise: fromJulian(Jnoon * 2 - Jset), set: fromJulian(Jset), noon: fromJulian(Jnoon) };
}

export function sunTimes(date, lat, lon){
  const s = event(date, lat, lon, -0.833);
  const c = event(date, lat, lon, -6);
  return s ? { sunrise: s.rise, sunset: s.set, solarNoon: s.noon,
               dawn: c ? c.rise : null, dusk: c ? c.set : null } : null;
}

// True when `t` falls between sunrise and sunset for its own local day.
export function isDaylight(t, lat, lon){
  const s = sunTimes(t, lat, lon);
  if (!s) return true;
  return t >= s.sunrise && t <= s.sunset;
}
