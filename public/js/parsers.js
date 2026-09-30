// parsers.js
// Utilidades para análisis robusto y eficiente de datos GTFS CSV

/**
 * Divide una línea CSV respetando comillas y caracteres especiales
 */
function splitCSVLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(cleanFieldValue(cur));
      cur = '';
    } else {
      cur += char;
    }
  }
  fields.push(cleanFieldValue(cur));
  return fields;
}

function cleanFieldValue(val) {
  const trimmed = val.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.substring(1, trimmed.length - 1).trim();
  }
  return trimmed;
}

export function parseCSVStops(content) {
  const filas = content.split(/\r?\n/);
  if (filas.length < 2) return [];

  const encabezados = splitCSVLine(filas[0].trim());
  const indices = {
    id: encabezados.indexOf("stop_id"),
    nombre: encabezados.indexOf("stop_name"),
    lat: encabezados.indexOf("stop_lat"),
    lon: encabezados.indexOf("stop_lon"),
    code: encabezados.indexOf("stop_code"),
  };

  const datosStops = [];
  for (let i = 1; i < filas.length; i++) {
    const linea = filas[i].trim();
    if (!linea) continue;
    const columna = splitCSVLine(linea);
    if (columna.length > indices.lat && columna.length > indices.lon) {
      const lat = parseFloat(columna[indices.lat]);
      const lon = parseFloat(columna[indices.lon]);
      if (!isNaN(lat) && !isNaN(lon)) {
        datosStops.push({
          id: columna[indices.id],
          nombre: columna[indices.nombre] || `Parada ${columna[indices.id]}`,
          code: indices.code !== -1 ? columna[indices.code] : columna[indices.id],
          lat,
          lon,
        });
      }
    }
  }
  return datosStops;
}

export function parseCSVShapes(content) {
  const filas = content.split(/\r?\n/);
  if (filas.length < 2) return { datosShapes: [], rutas: {} };

  const encabezados = splitCSVLine(filas[0].trim());
  const indices = {
    shape_id: encabezados.indexOf("shape_id"),
    lat: encabezados.indexOf("shape_pt_lat"),
    lon: encabezados.indexOf("shape_pt_lon"),
    sequence: encabezados.indexOf("shape_pt_sequence"),
  };

  const rutas = {};
  const datosShapes = [];
  for (let i = 1; i < filas.length; i++) {
    const linea = filas[i].trim();
    if (!linea) continue;
    const columna = splitCSVLine(linea);
    if (columna.length > 3) {
      const shape_id = columna[indices.shape_id];
      const lat = parseFloat(columna[indices.lat]);
      const lon = parseFloat(columna[indices.lon]);
      const sequence = parseInt(columna[indices.sequence], 10);

      if (!isNaN(lat) && !isNaN(lon) && shape_id) {
        datosShapes.push({ shape_id, lat, lon, sequence });
        if (!rutas[shape_id]) {
          rutas[shape_id] = [];
        }
        rutas[shape_id].push({ lat, lon, sequence });
      }
    }
  }
  
  for (const shape_id in rutas) {
    rutas[shape_id].sort((a, b) => a.sequence - b.sequence);
  }
  
  return { datosShapes, rutas };
}

export function parseCSVTrips(content) {
  const filas = content.split(/\r?\n/);
  if (filas.length < 2) return [];

  const encabezados = splitCSVLine(filas[0].trim());
  const indices = {
    route_id: encabezados.indexOf("route_id"),
    trip_id: encabezados.indexOf("trip_id"),
    direction_id: encabezados.indexOf("direction_id"),
    shape_id: encabezados.indexOf("shape_id"),
    headsign: encabezados.indexOf("trip_headsign"),
  };

  const datosTrips = [];
  for (let i = 1; i < filas.length; i++) {
    const linea = filas[i].trim();
    if (!linea) continue;
    const columna = splitCSVLine(linea);
    if (columna.length > 3) {
      datosTrips.push({
        route_id: columna[indices.route_id],
        trip_id: columna[indices.trip_id],
        direction_id: indices.direction_id !== -1 ? parseInt(columna[indices.direction_id], 10) : 0,
        shape_id: columna[indices.shape_id],
        headsign: indices.headsign !== -1 ? columna[indices.headsign] : "",
      });
    }
  }
  return datosTrips;
}

export function parseCSVRoutes(content) {
  const filas = content.split(/\r?\n/);
  if (filas.length < 2) return [];

  const encabezados = splitCSVLine(filas[0].trim());
  const indices = {
    route_id: encabezados.indexOf("route_id"),
    route_short_name: encabezados.indexOf("route_short_name"),
    route_name: encabezados.indexOf("route_long_name"),
    route_url: encabezados.indexOf("route_url"),
    route_color: encabezados.indexOf("route_color"),
    route_text_color: encabezados.indexOf("route_text_color"),
  };

  const datosRoutes = [];
  for (let i = 1; i < filas.length; i++) {
    const linea = filas[i].trim();
    if (!linea) continue;
    const columna = splitCSVLine(linea);
    if (columna.length > 2) {
      const shortName = indices.route_short_name !== -1 ? columna[indices.route_short_name] : columna[indices.route_id];
      const longName = indices.route_name !== -1 ? columna[indices.route_name] : "";
      datosRoutes.push({
        route_id: columna[indices.route_id],
        route_short_name: shortName || columna[indices.route_id],
        route_name: longName || shortName || `Línea ${columna[indices.route_id]}`,
        route_url: indices.route_url !== -1 ? columna[indices.route_url] : "",
        route_color: (indices.route_color !== -1 && columna[indices.route_color]) ? columna[indices.route_color] : "2563eb",
        route_text_color: (indices.route_text_color !== -1 && columna[indices.route_text_color]) ? columna[indices.route_text_color] : "ffffff",
      });
    }
  }
  return datosRoutes;
}

export function parseCSVStopTimes(content) {
  const filas = content.split(/\r?\n/);
  if (filas.length < 2) return [];

  const encabezados = splitCSVLine(filas[0].trim());
  const indices = {
    trip_id: encabezados.indexOf("trip_id"),
    arrival_time: encabezados.indexOf("arrival_time"),
    departure_time: encabezados.indexOf("departure_time"),
    stop_id: encabezados.indexOf("stop_id"),
    stop_sequence: encabezados.indexOf("stop_sequence"),
  };

  const datosStopTimes = [];
  for (let i = 1; i < filas.length; i++) {
    const linea = filas[i].trim();
    if (!linea) continue;
    const columna = splitCSVLine(linea);
    if (columna.length > 4) {
      datosStopTimes.push({
        trip_id: columna[indices.trip_id],
        arrival_time: columna[indices.arrival_time],
        departure_time: columna[indices.departure_time],
        stop_id: columna[indices.stop_id],
        stop_sequence: parseInt(columna[indices.stop_sequence], 10),
      });
    }
  }
  return datosStopTimes;
}
