import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls";
import { parseCSVStops, parseCSVShapes, parseCSVTrips, parseCSVRoutes, parseCSVStopTimes } from "./parsers.js";
import { minlon, maxlon, minlat, maxlat, MapeoX as utilsMapeoX, MapeoY as utilsMapeoY, lonToWebMercatorX, latToWebMercatorY, convertirHora as utilsConvertirHora } from "./utils.js";

let scene, renderer, camera, controls;
let mapsx, mapsy;

// Latitud y longitud moved to utils.js

let fechaActual;
let fecha2show;
const datosStops = [];
const datosShapes = [];
const datosTrips = [];
const datosRoutes = [];
const datosStopTimes = [];

let selectedRouteId = null;
let activeSpheres = [];
let routeLines = [];
let stopSprites = [];
const stopIconTexture = new THREE.TextureLoader().load("/assets/images/parada-icon.png");
const guaguaIconTexture = new THREE.TextureLoader().load("/assets/images/guagua-icon.png");

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

  // Calculate visible stops
  let visibleStopIds = new Set();
  if (selectedRouteId && selectedRouteId !== "") {
    cachedTrips.forEach(trip => {
      const stopTimes = cachedStopTimes[trip.trip_id];
      if (stopTimes) {
        stopTimes.forEach(st => visibleStopIds.add(st.stop_id));
      }
    });
  }

  // Update stops visibility on map
  stopSprites.forEach(({ sprite, stop_id }) => {
    if (!selectedRouteId || selectedRouteId === "") {
      sprite.visible = true;
    } else {
      sprite.visible = visibleStopIds.has(stop_id);
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

// Projection functions moved to utils.js
function MapeoX(lon) { return utilsMapeoX(lon, mapsx); }
function MapeoY(lat) { return utilsMapeoY(lat, mapsy); }

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
    0.01,
    10000
  );
  // Posición de la cámara (z = zoom, x y= paneo)
  camera.position.set(15, 5, 25);

  // Setup WebGL Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x9bd8f6, 1); // Water color matching OSM
  document.body.appendChild(renderer.domElement);

  scene.add(tileGroup);

  controls = new MapControls(camera, renderer.domElement); // Controls run on WebGL overlay
  controls.target.set(15, 5, 0); // Fija el punto al que mira la cámara para que mantenga su picado recto
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
  const parsedStops = parseCSVStops(content);
  datosStops.push(...parsedStops);

  parsedStops.forEach(stop => {
    let mlon = MapeoX(stop.lon);
    let mlat = MapeoY(stop.lat);

    const material = new THREE.SpriteMaterial({
      map: stopIconTexture,
      depthTest: false,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(mlon, mlat, 0);
    sprite.renderOrder = 1;
    sprite.scale.set(0.05, 0.05, 1);
    scene.add(sprite);
    stopSprites.push({ sprite, stop_id: stop.id });
  });
}

function procesarCSVShapes(content) {
  const { datosShapes: parsedShapes, rutas } = parseCSVShapes(content);
  datosShapes.push(...parsedShapes);

  for (const shape_id in rutas) {
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
  const parsedTrips = parseCSVTrips(content);
  datosTrips.push(...parsedTrips);
}

function procesarCSVRoutes(content) {
  const parsedRoutes = parseCSVRoutes(content);
  datosRoutes.push(...parsedRoutes);
  populateRouteSelect();
}

function procesarCSVStopTimes(content) {
  const parsedTimes = parseCSVStopTimes(content);
  datosStopTimes.push(...parsedTimes);
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

// Conversion function now mapped from utils
function convertirHora(horaStr) { return utilsConvertirHora(horaStr, fechaActual); }

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

// Removed old addStopModel logic

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

  const material = new THREE.SpriteMaterial({
    map: guaguaIconTexture,
    depthTest: false,
    depthWrite: false
  });
  const sphere = new THREE.Sprite(material);
  sphere.position.set(points[0].x, points[0].y, 0);
  sphere.renderOrder = 2; // Always render the buses on top of the map and stops
  sphere.scale.set(0.08, 0.08, 1); // Using slightly larger scale than stop icons if desired, adjust as necessary
  scene.add(sphere);
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
