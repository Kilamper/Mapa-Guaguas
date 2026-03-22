export function parseCSVStops(content) {
  const sep = ",";
  const filas = content.split("\n");
  const encabezados = filas[0].split(sep);
  const indices = {
    id: encabezados.indexOf("stop_id"),
    nombre: encabezados.indexOf("stop_name"),
    lat: encabezados.indexOf("stop_lat"),
    lon: encabezados.indexOf("stop_lon"),
  };

  const datosStops = [];
  for (let i = 1; i < filas.length; i++) {
    const columna = filas[i].split(sep);
    if (columna.length > 1) {
      datosStops.push({
        id: columna[indices.id],
        nombre: columna[indices.nombre],
        lat: columna[indices.lat],
        lon: columna[indices.lon],
      });
    }
  }
  return datosStops;
}

export function parseCSVShapes(content) {
  const sep = ",";
  const filas = content.split("\n");
  const encabezados = filas[0].split(sep);
  const indices = {
    shape_id: encabezados.indexOf("shape_id"),
    lat: encabezados.indexOf("shape_pt_lat"),
    lon: encabezados.indexOf("shape_pt_lon"),
    sequence: encabezados.indexOf("shape_pt_sequence"),
  };

  const rutas = {};
  const datosShapes = [];
  for (let i = 1; i < filas.length; i++) {
    const columna = filas[i].split(sep);
    if (columna.length > 1) {
      datosShapes.push({
        shape_id: columna[indices.shape_id],
        lat: columna[indices.lat],
        lon: columna[indices.lon],
        sequence: columna[indices.sequence],
      });
      const shape_id = columna[indices.shape_id];
      if (!rutas[shape_id]) {
        rutas[shape_id] = [];
      }
      rutas[shape_id].push({
        lat: parseFloat(columna[indices.lat]),
        lon: parseFloat(columna[indices.lon]),
        sequence: parseInt(columna[indices.sequence]),
      });
    }
  }
  
  for (const shape_id in rutas) {
    rutas[shape_id].sort((a, b) => a.sequence - b.sequence);
  }
  
  return { datosShapes, rutas };
}

export function parseCSVTrips(content) {
  const sep = ",";
  const filas = content.split("\n");
  const encabezados = filas[0].split(sep);
  const indices = {
    route_id: encabezados.indexOf("route_id"),
    trip_id: encabezados.indexOf("trip_id"),
    direction_id: encabezados.indexOf("direction_id"),
    shape_id: encabezados.indexOf("shape_id"),
  };

  const datosTrips = [];
  for (let i = 1; i < filas.length; i++) {
    const columna = filas[i].split(sep);
    if (columna.length > 1) {
      datosTrips.push({
        route_id: columna[indices.route_id],
        trip_id: columna[indices.trip_id],
        direction_id: parseInt(columna[indices.direction_id]),
        shape_id: columna[indices.shape_id],
      });
    }
  }
  return datosTrips;
}

export function parseCSVRoutes(content) {
  const sep = ",";
  const filas = content.split("\n");
  const encabezados = filas[0].split(sep);
  const indices = {
    route_id: encabezados.indexOf("route_id"),
    route_name: encabezados.indexOf("route_long_name"),
    route_url: encabezados.indexOf("route_url"),
    route_color: encabezados.indexOf("route_color"),
  };

  const datosRoutes = [];
  for (let i = 1; i < filas.length; i++) {
    const columna = filas[i].split(sep);
    if (columna.length > 1) {
      datosRoutes.push({
        route_id: columna[indices.route_id],
        route_name: columna[indices.route_name],
        route_url: columna[indices.route_url],
        route_color: columna[indices.route_color],
      });
    }
  }
  return datosRoutes;
}

export function parseCSVStopTimes(content) {
  const sep = ",";
  const filas = content.split("\n");
  const encabezados = filas[0].split(sep);
  const indices = {
    trip_id: encabezados.indexOf("trip_id"),
    arrival_time: encabezados.indexOf("arrival_time"),
    departure_time: encabezados.indexOf("departure_time"),
    stop_id: encabezados.indexOf("stop_id"),
    stop_sequence: encabezados.indexOf("stop_sequence"),
  };

  const datosStopTimes = [];
  for (let i = 1; i < filas.length; i++) {
    const columna = filas[i].split(sep);
    if (columna.length > 1) {
      datosStopTimes.push({
        trip_id: columna[indices.trip_id],
        arrival_time: columna[indices.arrival_time],
        departure_time: columna[indices.departure_time],
        stop_id: columna[indices.stop_id],
        stop_sequence: columna[indices.stop_sequence],
      });
    }
  }
  return datosStopTimes;
}
