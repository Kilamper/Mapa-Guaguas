import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { loadStopModel } from "./render_objects.js";

let scene, renderer, camera, controls;
let mapa, mapsx, mapsy;
//let stopModelPromise = loadStopModel();

// Latitud y longitud de los extremos del mapa de la imagen
let minlon = -15.979614257812502,
  maxlon = -15.218811035156252;
let minlat = 27.898562920006924,
  maxlat = 28.25782008117972;
// Dimensiones textura (mapa)
let txwidth, txheight;

const fechaInicio = new Date(); // Hora actual
let fechaActual;
let totalMinutos = 0,
  fecha2show;

let objetos = [];
const datosStops = [];
const datosShapes = [];
const datosTrips = [];
const datosRoutes = [];
const datosStopTimes = [];

let selectedRouteId = null;
let activeSpheres = [];
let routeLines = [];

const selectDiv = document.createElement("div");
selectDiv.style.position = "absolute";
selectDiv.style.top = "0";
selectDiv.style.left = "0";
selectDiv.style.width = "320px";
selectDiv.style.height = "100%";
selectDiv.style.backgroundColor = "rgba(15, 23, 42, 0.92)";
selectDiv.style.color = "white";
selectDiv.style.zIndex = "10";
selectDiv.style.padding = "30px 20px";
selectDiv.style.boxSizing = "border-box";
selectDiv.style.boxShadow = "4px 0 15px rgba(0,0,0,0.3)";
selectDiv.style.fontFamily = "'Segoe UI', Roboto, Helvetica, sans-serif";
selectDiv.style.display = "flex";
selectDiv.style.flexDirection = "column";

const title = document.createElement("h2");
title.innerText = "Mapa Guaguas";
title.style.marginTop = "0";
title.style.marginBottom = "25px";
title.style.fontSize = "26px";
title.style.fontWeight = "700";
title.style.color = "#f8fafc";
selectDiv.appendChild(title);

const label = document.createElement("label");
label.innerText = "Línea seleccionada:";
label.style.marginBottom = "10px";
label.style.fontSize = "14px";
label.style.color = "#94a3b8";
selectDiv.appendChild(label);

const routeSelect = document.createElement("select");
routeSelect.id = "routeSelect";
routeSelect.style.width = "100%";
routeSelect.style.padding = "12px 10px";
routeSelect.style.borderRadius = "8px";
routeSelect.style.border = "1px solid #334155";
routeSelect.style.backgroundColor = "#1e293b";
routeSelect.style.color = "white";
routeSelect.style.fontSize = "16px";
routeSelect.style.outline = "none";
routeSelect.style.cursor = "pointer";

const placeholder = document.createElement("option");
placeholder.text = "Todas las rutas";
placeholder.value = "";
placeholder.selected = true;
routeSelect.appendChild(placeholder);

selectDiv.appendChild(routeSelect);

const buttonsContainer = document.createElement("div");
buttonsContainer.style.display = "none";
buttonsContainer.style.flexDirection = "column";
buttonsContainer.style.gap = "12px";
buttonsContainer.style.marginTop = "25px";

function createPremiumButton(text) {
  const btn = document.createElement("a");
  btn.innerText = text;
  btn.target = "_blank";
  btn.style.display = "block";
  btn.style.textAlign = "center";
  btn.style.padding = "12px 15px";
  btn.style.backgroundColor = "#2563eb";
  btn.style.color = "white";
  btn.style.textDecoration = "none";
  btn.style.borderRadius = "6px";
  btn.style.fontWeight = "600";
  btn.style.fontSize = "14px";
  btn.style.transition = "background-color 0.2s";
  btn.style.boxShadow = "0 2px 4px rgba(0,0,0,0.2)";
  btn.onmouseover = () => btn.style.backgroundColor = "#1d4ed8";
  btn.onmouseout = () => btn.style.backgroundColor = "#2563eb";
  return btn;
}

const btnPlanos = createPremiumButton("🗺️ Plano de la Ruta");
const btnHorarios = createPremiumButton("🕒 Horarios de la Ruta");

buttonsContainer.appendChild(btnPlanos);
buttonsContainer.appendChild(btnHorarios);
selectDiv.appendChild(buttonsContainer);

let cachedTrips = [];
let cachedStopTimes = {};

routeSelect.addEventListener("change", (event) => {
  selectedRouteId = event.target.value;
  cacheTripsAndStopTimes();

  // Update line visibility on map
  routeLines.forEach(({ line, shape_id }) => {
    if (!selectedRouteId || selectedRouteId === "") {
      line.visible = true;
    } else {
      const tripMatch = datosTrips.find(t => t.shape_id === shape_id && t.route_id === selectedRouteId);
      line.visible = !!tripMatch;
    }
  });

  // Toggle buttons visibility and update URLs
  if (selectedRouteId && selectedRouteId !== "") {
    buttonsContainer.style.display = "flex";
    btnPlanos.href = `https://www.guaguas.com/pdf/lineas/linea${selectedRouteId}.pdf`;
    btnHorarios.href = `https://www.guaguas.com/pdf/lineas/L${selectedRouteId}CaraB.pdf`;
  } else {
    buttonsContainer.style.display = "none";
  }
});

function cacheTripsAndStopTimes() {
  cachedTrips = datosTrips.filter((trip) => trip.route_id === selectedRouteId);
  cachedStopTimes = {};
  cachedTrips.forEach((trip) => {
    cachedStopTimes[trip.trip_id] = datosStopTimes.filter(
      (stopTime) => stopTime.trip_id === trip.trip_id
    );
  });
}

function checkAndStartTrips() {
  if (!selectedRouteId) return;

  const currentMillis = fechaActual.getTime();

  cachedTrips.forEach((trip) => {
    if (!trip.shape_id) return; // Skip if shape_id is undefined

    const stopTimes = cachedStopTimes[trip.trip_id];
    if (stopTimes.length === 0) return; // Skip if no stop times

    const firstStopTime = convertirHora(stopTimes[0].arrival_time).getTime();
    const lastStopTime = convertirHora(stopTimes[stopTimes.length - 1].arrival_time).getTime();

    if (currentMillis >= firstStopTime && currentMillis <= lastStopTime) {
      if (!activeSpheres.some(active => active.trip_id === trip.trip_id)) {
        startAnimation(trip, stopTimes);
      }
    }
  });
}

// Convert Lat/Lon to Web Mercator Projection
function lonToWebMercatorX(lon) {
  return lon * 6378137 * Math.PI / 180;
}

function latToWebMercatorY(lat) {
  return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * 6378137;
}

function MapeoX(lon) {
  let x = lonToWebMercatorX(lon);
  let minx = lonToWebMercatorX(minlon);
  let maxx = lonToWebMercatorX(maxlon);
  return Mapeo(x, minx, maxx, -mapsx / 2, mapsx / 2);
}

function MapeoY(lat) {
  let y = latToWebMercatorY(lat);
  let miny = latToWebMercatorY(minlat);
  let maxy = latToWebMercatorY(maxlat);
  return Mapeo(y, miny, maxy, -mapsy / 2, mapsy / 2);
}

const MAX_MERCATOR = 20037508.342789244;
let cx, cy, METER_TO_UNIT;
let currentTiles = new Map();
const tileGroup = new THREE.Group();
const textureLoader = new THREE.TextureLoader();

function updateTiles() {
  if (!METER_TO_UNIT) return;
  const screenWidthUnits = camera.position.z * 2 * Math.tan((camera.fov * Math.PI / 180) / 2) * camera.aspect;
  const screenWidthMeters = screenWidthUnits / METER_TO_UNIT;
  const targetTileWidthMeters = screenWidthMeters / (window.innerWidth / 256);
  let z = Math.round(Math.log2((MAX_MERCATOR * 2) / targetTileWidthMeters));
  z = Math.max(0, Math.min(19, z));
  const centerWorldX = (camera.position.x / METER_TO_UNIT) + cx;
  const centerWorldY = (camera.position.y / METER_TO_UNIT) + cy;
  const tileWidthMeters = (MAX_MERCATOR * 2) / Math.pow(2, z);
  const rX = screenWidthMeters / 2;
  const rY = screenWidthMeters / (2 * camera.aspect);
  const minWx = centerWorldX - rX;
  const maxWx = centerWorldX + rX;
  const minWy = centerWorldY - rY;
  const maxWy = centerWorldY + rY;
  const minTx = Math.floor((minWx + MAX_MERCATOR) / tileWidthMeters);
  const maxTx = Math.floor((maxWx + MAX_MERCATOR) / tileWidthMeters);
  const minTy = Math.floor((MAX_MERCATOR - maxWy) / tileWidthMeters);
  const maxTy = Math.floor((MAX_MERCATOR - minWy) / tileWidthMeters);
  const visibleKeys = new Set();

  for (let tx = minTx - 3; tx <= maxTx + 3; tx++) {
    for (let ty = minTy - 3; ty <= maxTy + 3; ty++) {
      if (tx < 0 || tx >= Math.pow(2, z) || ty < 0 || ty >= Math.pow(2, z)) continue;
      const key = `${z}_${tx}_${ty}`;
      visibleKeys.add(key);
      if (!currentTiles.has(key)) {
        addTile(z, tx, ty, tileWidthMeters);
      }
    }
  }

  for (const [key, mesh] of currentTiles.entries()) {
    if (!visibleKeys.has(key)) {
      tileGroup.remove(mesh);
      if (mesh.material.map) mesh.material.map.dispose();
      mesh.material.dispose();
      mesh.geometry.dispose();
      currentTiles.delete(key);
    }
  }
}

function addTile(z, tx, ty, tileWidthMeters) {
  const url = `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`;
  const geometry = new THREE.PlaneGeometry(tileWidthMeters * METER_TO_UNIT, tileWidthMeters * METER_TO_UNIT);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1;
  mesh.visible = false;
  const centerWx = (tx + 0.5) * tileWidthMeters - MAX_MERCATOR;
  const centerWy = MAX_MERCATOR - (ty + 0.5) * tileWidthMeters;
  mesh.position.set((centerWx - cx) * METER_TO_UNIT, (centerWy - cy) * METER_TO_UNIT, 0);
  const key = `${z}_${tx}_${ty}`;
  currentTiles.set(key, mesh);
  tileGroup.add(mesh);
  textureLoader.load(url, (texture) => {
    material.map = texture;
    material.needsUpdate = true;
    mesh.visible = true;
  });
}

init();
animate();

function init() {
  // Muestra fecha en la barra lateral
  fecha2show = document.createElement("div");
  fecha2show.style.marginTop = "auto";
  fecha2show.style.marginBottom = "10px";
  fecha2show.style.padding = "15px";
  fecha2show.style.backgroundColor = "rgba(0, 0, 0, 0.2)";
  fecha2show.style.borderRadius = "8px";
  fecha2show.style.textAlign = "center";
  fecha2show.style.color = "#94a3b8";
  fecha2show.style.fontSize = "15px";
  fecha2show.style.fontFamily = "'Courier New', Courier, monospace";
  fecha2show.innerHTML = "";

  selectDiv.appendChild(fecha2show);

  // Leyenda de Guaguas Municipales
  const leyenda = document.createElement("div");
  leyenda.innerHTML = 'Datos e información propiedad de <a href="https://www.guaguas.com/" target="_blank" style="color: #60a5fa; text-decoration: none;">Guaguas Municipales</a>';
  leyenda.style.fontSize = "12px";
  leyenda.style.color = "#64748b";
  leyenda.style.textAlign = "center";
  leyenda.style.padding = "5px";

  selectDiv.appendChild(leyenda);
  document.body.appendChild(selectDiv);

  scene = new THREE.Scene();
  // We remove the solid scene background because we need it transparent!
  // scene.background = new THREE.Color(0xd5ebf0);

  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    1,
    10000
  );
  // Posición de la cámara
  camera.position.set(0, 0, 100);

  // Setup WebGL Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x9bd8f6, 1); // Water color matching OSM
  document.body.appendChild(renderer.domElement);

  scene.add(tileGroup);

  controls = new MapControls(camera, renderer.domElement); // Controls run on WebGL overlay
  controls.enableDamping = true; // Activar amortiguación
  controls.dampingFactor = 0.25; // Ajusta la suavidad del movimiento
  controls.enableRotate = false; // Desactivar la rotación
  controls.screenSpacePanning = true; // Activar desplazamiento en espacio de pantalla
  controls.zoomSpeed = 1; // Ajustar la velocidad de zoom

  // Límite de zoom
  controls.minDistance = 1; // Distancia mínima
  controls.maxDistance = 250; // Distancia máxima

  // Bloqueo de rotación de cámara
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN, // Evita la rotación con clic derecho
  };
  controls.touches = {
    ONE: THREE.TOUCH.PAN,
    TWO: THREE.TOUCH.DOLLY_PAN, // Evita la rotación con dos dedos
  };

  // Restricciones de ángulo: fijar el paneo pero permitimos que la cámara
  // mantenga su perspectiva Z natural constante.
  controls.maxAzimuthAngle = 0;
  controls.minAzimuthAngle = 0;
  // Al estar el mapa en el plano X/Y, mirar de frente implica un polar angle de 90 grados (PI/2).
  controls.minPolarAngle = Math.PI / 2;
  controls.maxPolarAngle = Math.PI / 2;

  // Calculate Map Mercator Bounds
  const mercMinX = lonToWebMercatorX(minlon);
  const mercMaxX = lonToWebMercatorX(maxlon);
  const mercMinY = latToWebMercatorY(minlat);
  const mercMaxY = latToWebMercatorY(maxlat);

  const mercWidth = mercMaxX - mercMinX;
  const mercHeight = mercMaxY - mercMinY;

  mapsx = 100; // Base reference sizing width
  mapsy = mapsx * (mercHeight / mercWidth); // Exact Aspect Ratio

  METER_TO_UNIT = mapsx / mercWidth;
  cx = (mercMinX + mercMaxX) / 2;
  cy = (mercMinY + mercMaxY) / 2;

  // Add ambient light
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8); // Soft white light
  scene.add(ambientLight);

  // Add directional light for better shading
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
  directionalLight.position.set(1, 1, 1).normalize();
  scene.add(directionalLight);

  // Cargar datos CSV
  fetchData("stops.csv", procesarCSVStops);
  fetchData("trips.csv", procesarCSVTrips);
  fetchData("routes.csv", procesarCSVRoutes);
  fetchData("shapes.csv", procesarCSVShapes);
  fetchData("stop_times.csv", procesarCSVStopTimes);
}

function fetchData(filename, callback) {
  fetch(
    `/api/transit/${filename}`
  )
    .then((response) => {
      if (!response.ok) throw new Error("Error: " + response.statusText);
      return response.text();
    })
    .then((content) => callback(content))
    .catch((error) => console.error(`Error al cargar ${filename}:`, error));
}

function procesarCSVStops(content) {
  const sep = ","; // Separador ;
  const filas = content.split("\n");

  const encabezados = filas[0].split(sep);
  const indices = {
    id: encabezados.indexOf("stop_id"),
    nombre: encabezados.indexOf("stop_name"),
    lat: encabezados.indexOf("stop_lat"),
    lon: encabezados.indexOf("stop_lon"),
  };

  for (let i = 1; i < filas.length; i++) {
    const columna = filas[i].split(sep);
    if (columna.length > 1) {
      datosStops.push({
        id: columna[indices.id],
        nombre: columna[indices.nombre],
        lat: columna[indices.lat],
        lon: columna[indices.lon],
      });

      let mlon = MapeoX(columna[indices.lon]);
      let mlat = MapeoY(columna[indices.lat]);

      /*stopModelPromise
        .then((model) => {
          addStopModel(mlon, mlat, 0, model);
        })
        .catch((error) => {
          console.error("Error loading stop model:", error);
        });*/
    }
  }
}

function procesarCSVShapes(content) {
  const sep = ","; // Separador ;
  const filas = content.split("\n");

  const encabezados = filas[0].split(sep);
  const indices = {
    shape_id: encabezados.indexOf("shape_id"),
    lat: encabezados.indexOf("shape_pt_lat"),
    lon: encabezados.indexOf("shape_pt_lon"),
    sequence: encabezados.indexOf("shape_pt_sequence"),
  };

  const rutas = {};

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
    const points = rutas[shape_id].map((p) => {
      const x = MapeoX(p.lon);
      const y = MapeoY(p.lat);
      return new THREE.Vector3(x, y, 0);
    });
    const routeColor = getRouteColor(shape_id);
    drawRoute(points, routeColor, shape_id);
  }
}

function procesarCSVTrips(content) {
  const sep = ","; // Separador ;
  const filas = content.split("\n");

  const encabezados = filas[0].split(sep);
  const indices = {
    route_id: encabezados.indexOf("route_id"),
    trip_id: encabezados.indexOf("trip_id"),
    direction_id: encabezados.indexOf("direction_id"),
    shape_id: encabezados.indexOf("shape_id"),
  };

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
}

function procesarCSVRoutes(content) {
  const sep = ","; // Separador ;
  const filas = content.split("\n");

  const encabezados = filas[0].split(sep);
  const indices = {
    route_id: encabezados.indexOf("route_id"),
    route_name: encabezados.indexOf("route_long_name"),
    route_url: encabezados.indexOf("route_url"),
    route_color: encabezados.indexOf("route_color"),
  };

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
  populateRouteSelect();
}

function procesarCSVStopTimes(content) {
  const sep = ","; // Separador ;
  const filas = content.split("\n");

  const encabezados = filas[0].split(sep);
  const indices = {
    trip_id: encabezados.indexOf("trip_id"),
    arrival_time: encabezados.indexOf("arrival_time"),
    departure_time: encabezados.indexOf("departure_time"),
    stop_id: encabezados.indexOf("stop_id"),
    stop_sequence: encabezados.indexOf("stop_sequence"),
  };

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

  // Start the animation after all data is loaded
  checkAndStartTrips();
}

function getRouteColor(shape_id) {
  const trip = datosTrips.find((trip) => trip.shape_id === shape_id);
  if (trip) {
    const route = datosRoutes.find((route) => route.route_id === trip.route_id);
    if (route) {
      return route.route_color || 0x0000ff; // Default color if not found
    }
  }
  return 0x0000ff; // Default color if not found
}

function drawRoute(points, color, shape_id) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color: parseInt(color, 16) });
  const line = new THREE.Line(geometry, material);
  routeLines.push({ line, shape_id });
  scene.add(line);
}

//valor, rango origen, rango destino
function Mapeo(val, vmin, vmax, dmin, dmax) {
  let t = (val - vmin) / (vmax - vmin); // Normalización desde vmin hasta vmax
  return dmin + t * (dmax - dmin);
}

function Esfera(px, py, pz, radio, nx, ny, col) {
  let geometry = new THREE.SphereGeometry(radio, nx, ny);
  let material = new THREE.MeshBasicMaterial({
    color: col,
  });
  let mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(px, py, pz);
  objetos.push(mesh);
  scene.add(mesh);
  return mesh;
}

function Plano(px, py, pz, sx, sy) {
  let geometry = new THREE.PlaneGeometry(sx, sy);
  let material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0
  });
  let mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(px, py, pz);
  scene.add(mesh);
  mapa = mesh;
}

// Función para convertir una fecha en formato DD/MM/YYYY HH:mm, presenmte en archivo de préstamos, a Date
function convertirFecha(fechaStr) {
  if (!fechaStr) return null; // Return null if fechaStr is invalid
  const [fecha, hora] = fechaStr.split(" ");
  if (!fecha || !hora) return null; // Return null if fecha or hora is invalid
  const [dia, mes, año] = fecha.split("/").map(Number);
  const [horas, minutos] = hora.split(":").map(Number);
  return new Date(año, mes - 1, dia, horas, minutos); // mes es 0-indexado
}

function convertirHora(horaStr) {
  if (!horaStr) return null; // Return null if horaStr is invalid
  const [horas, minutos] = horaStr.split(":").map(Number);
  const year = fechaActual.getFullYear(); // Obtain only the year of fechaActual
  return new Date(year, fechaActual.getMonth(), fechaActual.getDate(), horas, minutos); // mes es 0-indexado
}

function actualizarFecha() {
  // Ajuste en tiempo real
  fechaActual = new Date();

  // Formatea salida
  const opciones = {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  };
  //Modifica en pantalla
  fecha2show.innerHTML = fechaActual.toLocaleString("es-ES", opciones);
}

function addStopModel(px, py, pz, model) {
  const clonedModel = model.clone();
  clonedModel.position.set(px, py, pz);
  clonedModel.scale.set(0.05, 0.05, 0.05); // Adjust the scale as needed
  objetos.push(clonedModel);
  scene.add(clonedModel);
}

function startAnimation(trip, stopTimes) {
  const shapeId = trip.shape_id;
  const shapePoints = datosShapes
    .filter((shape) => shape.shape_id === shapeId)
    .sort((a, b) => a.sequence - b.sequence);

  if (shapePoints.length === 0) return; // Skip if no shape points

  const points = shapePoints.map((p) => {
    const x = MapeoX(p.lon);
    const y = MapeoY(p.lat);
    return new THREE.Vector3(x, y, 0);
  });

  const sphere = Esfera(
    points[0].x,
    points[0].y,
    points[0].z,
    0.2,
    32,
    32,
    0xff0000
  );
  activeSpheres.push({ trip_id: trip.trip_id, sphere, points, stopTimes, currentIndex: 0 });
}

function updateSpheres() {
  const spheresToRemove = [];
  activeSpheres.forEach((activeSphere) => {
    const { sphere, points, stopTimes, currentIndex } = activeSphere;
    const startTime = convertirHora(stopTimes[0].departure_time).getTime();
    const endTime = convertirHora(stopTimes[stopTimes.length - 1].arrival_time).getTime();
    if (!startTime || !endTime) return; // Skip if invalid times
    const totalDuration = endTime - startTime;
    const currentTime = fechaActual.getTime();
    const elapsedTime = currentTime - startTime;
    const t = Math.min(elapsedTime / totalDuration, 1);

    // Calculate the total distance to travel
    const totalDistance = points.reduce((acc, point, index) => {
      if (index === 0) return acc;
      return acc + points[index - 1].distanceTo(point);
    }, 0);

    // Calculate the distance traveled so far
    const distanceTraveled = t * totalDistance;

    // Find the segment where the sphere currently is
    let distanceCovered = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const segmentDistance = points[i].distanceTo(points[i + 1]);
      if (distanceCovered + segmentDistance >= distanceTraveled) {
        const segmentT = (distanceTraveled - distanceCovered) / segmentDistance;
        sphere.position.lerpVectors(points[i], points[i + 1], segmentT);
        break;
      }
      distanceCovered += segmentDistance;
    }

    if (t >= 1) {
      // Mark the sphere for removal when the trip ends
      spheresToRemove.push(activeSphere);
    }
  });

  // Remove completed spheres outside the loop to avoid modifying the array while iterating
  spheresToRemove.forEach((activeSphere) => {
    scene.remove(activeSphere.sphere);
    const index = activeSpheres.indexOf(activeSphere);
    if (index > -1) {
      activeSpheres.splice(index, 1);
    }
  });
}

function populateRouteSelect() {
  const uniqueRoutes = [...new Set(datosRoutes.map((route) => route.route_id))];
  uniqueRoutes.forEach((route_id) => {
    const option = document.createElement("option");
    option.value = route_id;
    option.text = `Route ${route_id}`;
    routeSelect.appendChild(option);
  });
}

//Bucle de animación
function animate() {
  actualizarFecha();
  checkAndStartTrips(); // Check for new trips to start
  updateSpheres(); // Update the positions of the spheres
  updateTiles(); // Fetch and render visible OSM tiles dynamically
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
