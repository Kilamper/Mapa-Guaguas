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

export function convertirHora(horaStr, fechaActual) {
  if (!horaStr) return null;
  const [horas, minutos] = horaStr.split(":").map(Number);
  const year = fechaActual.getFullYear();
  return new Date(year, fechaActual.getMonth(), fechaActual.getDate(), horas, minutos);
}
