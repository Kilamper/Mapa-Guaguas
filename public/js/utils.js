// utils.js
// Proyecciones Web Mercator, mapeo de coordenadas y utilidades de tiempo

export const minlon = -15.979614257812502;
export const maxlon = -15.218811035156252;
export const minlat = 27.898562920006924;
export const maxlat = 28.25782008117972;

export function lonToWebMercatorX(lon) {
  return lon * 6378137 * Math.PI / 180;
}

export function latToWebMercatorY(lat) {
  return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * 6378137;
}

export function webMercatorXToLon(x) {
  return (x / (6378137 * Math.PI)) * 180;
}

export function webMercatorYToLat(y) {
  return (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI;
}

export function Mapeo(val, vmin, vmax, dmin, dmax) {
  let t = (val - vmin) / (vmax - vmin);
  return dmin + t * (dmax - dmin);
}

export function MapeoX(lon, mapsx) {
  let x = lonToWebMercatorX(lon);
  let minx = lonToWebMercatorX(minlon);
  let maxx = lonToWebMercatorX(maxlon);
  return Mapeo(x, minx, maxx, -mapsx / 2, mapsx / 2);
}

export function MapeoY(lat, mapsy) {
  let y = latToWebMercatorY(lat);
  let miny = latToWebMercatorY(minlat);
  let maxy = latToWebMercatorY(maxlat);
  return Mapeo(y, miny, maxy, -mapsy / 2, mapsy / 2);
}

/**
 * Convierte cadena de hora 'HH:MM:SS' a segundos desde medianoche (0 a 86399 o superior para servicios nocturnos)
 */
export function timeStringToSeconds(horaStr) {
  if (!horaStr) return -1;
  const parts = horaStr.split(":");
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  const s = parseInt(parts[2], 10) || 0;
  return h * 3600 + m * 60 + s;
}

/**
 * Convierte segundos a formato legible 'HH:MM'
 */
export function secondsToTimeString(totalSeconds) {
  if (totalSeconds < 0) return "--:--";
  const h = Math.floor(totalSeconds / 3600) % 24;
  const m = Math.floor((totalSeconds % 3600) / 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

export function convertirHora(horaStr, fechaActual) {
  if (!horaStr) return null;
  const [horas, minutos, segundos] = horaStr.split(":").map(Number);
  const year = fechaActual.getFullYear();
  return new Date(year, fechaActual.getMonth(), fechaActual.getDate(), horas, minutos, segundos || 0);
}
