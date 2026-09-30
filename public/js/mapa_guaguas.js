// mapa_guaguas.js
// Visualizador 3D interactivo y de alto rendimiento para Guaguas Municipales de Las Palmas de Gran Canaria

import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import {
  parseCSVStops,
  parseCSVShapes,
  parseCSVTrips,
  parseCSVRoutes,
  parseCSVStopTimes,
} from "./parsers.js";
import {
  minlon,
  maxlon,
  minlat,
  maxlat,
  MapeoX as utilsMapeoX,
  MapeoY as utilsMapeoY,
  lonToWebMercatorX,
  latToWebMercatorY,
  timeStringToSeconds,
  secondsToTimeString,
} from "./utils.js";

// ========================================================
// VARIABLES GLOBALES Y ESTADO DEL SISTEMA
// ========================================================
let scene, renderer, camera, controls;
let mapsx, mapsy;
let cx, cy, METER_TO_UNIT;
const MAX_MERCATOR = 20037508.342789244;

// Almacén de datos GTFS
const datosStops = [];
const datosShapes = [];
const datosTrips = [];
const datosRoutes = [];
const datosStopTimes = [];

// Índices relacionales para consultas ultra-rápidas O(1)
const stopsById = new Map();
const routesById = new Map();
const tripsById = new Map();
const tripsByRoute = new Map();
const stopToRoutesMap = new Map();
const stopDeparturesMap = new Map(); // stop_id -> [{ route_id, timeSec, timeStr, headsign }]
const stopTimesByTrip = new Map(); // trip_id -> [stopTime, ...]

// Elementos visuales en Three.js
let selectedRouteId = null;
let activeSpheres = [];
let routeLines = [];
let stopSprites = [];
let tileGroup;
let stopsGroup;
let busesGroup;

// Visibilidad de capas
let showStops = true;
let showBuses = true;

// Raycaster e interactividad
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredObject = null;
let selectedStopData = null;

// Texturas y caché
const textureLoader = new THREE.TextureLoader();
const stopIconTexture = textureLoader.load("/assets/images/parada-icon.png");
const guaguaIconTexture = textureLoader.load("/assets/images/guagua-icon.png");

// Configuración de Teselas y Eliminación de Parpadeo
const textureCache = new Map(); // key -> THREE.Texture (LRU)
const MAX_TEXTURE_CACHE = 256;
const activeTileMeshes = new Map(); // key -> { mesh, z, tx, ty, isLoaded }
let currentMapStyle = "streets"; // Por defecto: Esri Streets (sin marcas de agua, alta definición, 100% gratuito)

const TILE_SERVERS = {
  streets: {
    name: "Calles (Esri)",
    url: (s, z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`,
    subdomains: [""],
    bgColor: 0xaadaff,
    maxZoom: 18,
  },
  topo: {
    name: "Topográfico (Esri)",
    url: (s, z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`,
    subdomains: [""],
    bgColor: 0xaadaff,
    maxZoom: 18,
  },
  satellite: {
    name: "Satélite (Esri)",
    url: (s, z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    subdomains: [""],
    bgColor: 0x142028,
    maxZoom: 18,
  },
  dark: {
    name: "Modo Oscuro (Esri)",
    url: (s, z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
    subdomains: [""],
    bgColor: 0x1e1e1e,
    maxZoom: 16,
  },
  canvas: {
    name: "Gris Claro (Esri)",
    url: (s, z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/${z}/${y}/${x}`,
    subdomains: [""],
    bgColor: 0xe6e6e6,
    maxZoom: 16,
  },
  natgeo: {
    name: "National Geographic (Esri)",
    url: (s, z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/${z}/${y}/${x}`,
    subdomains: [""],
    bgColor: 0xb5d0d0,
    maxZoom: 16,
  },
};

// Control de Simulación de Tiempo
let timeMode = "real"; // 'real' | 'custom'
let simulatedSeconds = 28800; // 08:00 AM en segundos
let lastRealSecondsUpdate = Date.now();
let lastCameraX = null, lastCameraY = null, lastCameraZ = null;
let isTileUpdateScheduled = false;
let pointerDownPos = { x: 0, y: 0 };
let lastTripCheckTime = 0;
let lastClockTime = 0;

// Proyecciones
function MapeoX(lon) { return utilsMapeoX(lon, mapsx); }
function MapeoY(lat) { return utilsMapeoY(lat, mapsy); }

// ========================================================
// INICIALIZACIÓN DE LA APLICACIÓN
// ========================================================
function init() {
  const container = document.body;

  // 1. Escena
  scene = new THREE.Scene();

  // 2. Grupos de renderizado jerárquicos
  tileGroup = new THREE.Group();
  tileGroup.renderOrder = -10;
  scene.add(tileGroup);

  stopsGroup = new THREE.Group();
  stopsGroup.renderOrder = 2;
  scene.add(stopsGroup);

  busesGroup = new THREE.Group();
  busesGroup.renderOrder = 5;
  scene.add(busesGroup);

  // 3. Proyecciones Mercator y Dimensiones
  const mercMinX = lonToWebMercatorX(minlon);
  const mercMaxX = lonToWebMercatorX(maxlon);
  const mercMinY = latToWebMercatorY(minlat);
  const mercMaxY = latToWebMercatorY(maxlat);

  const mercWidth = mercMaxX - mercMinX;
  const mercHeight = mercMaxY - mercMinY;

  mapsx = 100;
  mapsy = mapsx * (mercHeight / mercWidth);

  METER_TO_UNIT = mapsx / mercWidth;
  cx = (mercMinX + mercMaxX) / 2;
  cy = (mercMinY + mercMaxY) / 2;

  // 4. Cámara de Perspectiva
  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.01,
    10000
  );
  // Posición inicial centrada en Las Palmas de Gran Canaria
  camera.position.set(16.5, 4.2, 18);

  // 5. Renderizador WebGL
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(TILE_SERVERS[currentMapStyle].bgColor, 1);
  container.appendChild(renderer.domElement);

  // 6. Controles de Mapa (MapControls)
  controls = new MapControls(camera, renderer.domElement);
  controls.target.set(16.5, 4.2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.15;
  controls.enableRotate = false;
  controls.screenSpacePanning = true;
  controls.zoomSpeed = 1.2;
  controls.minDistance = 1.2;
  controls.maxDistance = 200;

  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.touches = {
    ONE: THREE.TOUCH.PAN,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };

  controls.maxAzimuthAngle = 0;
  controls.minAzimuthAngle = 0;
  controls.minPolarAngle = Math.PI / 2;
  controls.maxPolarAngle = Math.PI / 2;

  // 7. Luces
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambientLight);

  // 8. Eventos de Ventana y Ratón
  window.addEventListener("resize", onWindowResize);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerdown", onPointerDown);

  // 9. Conectar Interfaz de Usuario
  setupUIEvents();

  // 10. Carga Coordinada de Datos GTFS
  cargarDatosGTFS();
}

// ========================================================
// GESTIÓN DE TESELAS SIN PARPADEO (DOUBLE-BUFFERING & LRU)
// ========================================================
function triggerTileUpdate() {
  if (isTileUpdateScheduled) return;
  isTileUpdateScheduled = true;
  requestAnimationFrame(() => {
    updateTiles();
    isTileUpdateScheduled = false;
  });
}

function updateTiles() {
  if (!METER_TO_UNIT || !camera) return;

  const screenWidthUnits = camera.position.z * 2 * Math.tan((camera.fov * Math.PI / 180) / 2) * camera.aspect;
  const screenWidthMeters = screenWidthUnits / METER_TO_UNIT;
  const targetTileWidthMeters = screenWidthMeters / (window.innerWidth / 256);

  const styleConfig = TILE_SERVERS[currentMapStyle] || TILE_SERVERS.streets;
  const maxZ = styleConfig.maxZoom || 18;
  let z = Math.round(Math.log2((MAX_MERCATOR * 2) / targetTileWidthMeters));
  z = Math.max(8, Math.min(maxZ, z));

  const centerWorldX = (camera.position.x / METER_TO_UNIT) + cx;
  const centerWorldY = (camera.position.y / METER_TO_UNIT) + cy;
  const tileWidthMeters = (MAX_MERCATOR * 2) / Math.pow(2, z);

  const rX = screenWidthMeters * 0.75;
  const rY = (screenWidthMeters / camera.aspect) * 0.75;

  const minWx = centerWorldX - rX;
  const maxWx = centerWorldX + rX;
  const minWy = centerWorldY - rY;
  const maxWy = centerWorldY + rY;

  const maxTilesAtZoom = Math.pow(2, z);
  const minTx = Math.max(0, Math.floor((minWx + MAX_MERCATOR) / tileWidthMeters));
  const maxTx = Math.min(maxTilesAtZoom - 1, Math.floor((maxWx + MAX_MERCATOR) / tileWidthMeters));
  const minTy = Math.max(0, Math.floor((MAX_MERCATOR - maxWy) / tileWidthMeters));
  const maxTy = Math.min(maxTilesAtZoom - 1, Math.floor((MAX_MERCATOR - minWy) / tileWidthMeters));

  const neededKeys = new Set();

  for (let tx = minTx; tx <= maxTx; tx++) {
    for (let ty = minTy; ty <= maxTy; ty++) {
      const key = `${currentMapStyle}_${z}_${tx}_${ty}`;
      neededKeys.add(key);

      if (!activeTileMeshes.has(key)) {
        createTileMesh(z, tx, ty, tileWidthMeters, key);
      }
    }
  }

  // Comprobar descarte seguro: solo eliminar teselas que no son necesarias
  // y que están fuera de visión o cuyos reemplazos ya están cargados
  const keysToRemove = [];
  for (const [key, entry] of activeTileMeshes.entries()) {
    if (!neededKeys.has(key)) {
      // Si la tesela pertenece a otro nivel de zoom o está lejos, eliminar de la escena
      const isFar = (entry.z !== z) || (entry.tx < minTx - 2 || entry.tx > maxTx + 2 || entry.ty < minTy - 2 || entry.ty > maxTy + 2);
      if (isFar) {
        keysToRemove.push(key);
      }
    }
  }

  keysToRemove.forEach(key => {
    const entry = activeTileMeshes.get(key);
    if (entry) {
      tileGroup.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.mesh.material.dispose();
      activeTileMeshes.delete(key);
    }
  });
}

function createTileMesh(z, tx, ty, tileWidthMeters, key) {
  const styleConfig = TILE_SERVERS[currentMapStyle] || TILE_SERVERS.streets;
  const sub = styleConfig.subdomains[Math.abs(tx + ty) % styleConfig.subdomains.length];
  const url = styleConfig.url(sub, z, tx, ty);

  const geometry = new THREE.PlaneGeometry(tileWidthMeters * METER_TO_UNIT, tileWidthMeters * METER_TO_UNIT);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthWrite: false,
    depthTest: false,
    transparent: true,
    opacity: 0,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -10;

  const centerWx = (tx + 0.5) * tileWidthMeters - MAX_MERCATOR;
  const centerWy = MAX_MERCATOR - (ty + 0.5) * tileWidthMeters;
  mesh.position.set((centerWx - cx) * METER_TO_UNIT, (centerWy - cy) * METER_TO_UNIT, -0.01);

  tileGroup.add(mesh);
  const entry = { mesh, z, tx, ty, isLoaded: false };
  activeTileMeshes.set(key, entry);

  // 1. Verificar si la textura ya está en la caché en memoria (CERO parpadeo)
  if (textureCache.has(url)) {
    const cachedTex = textureCache.get(url);
    material.map = cachedTex;
    material.opacity = 1;
    material.needsUpdate = true;
    entry.isLoaded = true;
    return;
  }

  // 2. Cargar textura desde red con fade-in suave
  textureLoader.load(
    url,
    (texture) => {
      // Guardar en caché LRU
      if (textureCache.size >= MAX_TEXTURE_CACHE) {
        const firstKey = textureCache.keys().next().value;
        const oldTex = textureCache.get(firstKey);
        oldTex.dispose();
        textureCache.delete(firstKey);
      }
      textureCache.set(url, texture);

      material.map = texture;
      material.opacity = 1;
      material.needsUpdate = true;
      entry.isLoaded = true;
    },
    undefined,
    (err) => {
      // En caso de error de red, mantener invisible sin romper la app
    }
  );
}

function setMapStyle(styleKey) {
  if (styleKey === currentMapStyle || !TILE_SERVERS[styleKey]) return;
  currentMapStyle = styleKey;
  renderer.setClearColor(TILE_SERVERS[currentMapStyle].bgColor, 1);

  // Limpiar teselas actuales para regenerar con nuevo estilo
  for (const [key, entry] of activeTileMeshes.entries()) {
    tileGroup.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    entry.mesh.material.dispose();
  }
  activeTileMeshes.clear();
  updateTiles();
}

// ========================================================
// CARGA COORDINADA Y OPTIMIZADA DE DATOS GTFS
// ========================================================
function getApiBase() {
  if (typeof window !== "undefined") {
    // Si el usuario abrió el HTML directamente (file://) o con Live Server (puerto 5500 u otro),
    // intentamos conectar con el servidor Express en el puerto 3000
    if (window.location.protocol === "file:" || (window.location.port !== "3000" && window.location.port !== "")) {
      return "http://localhost:3000/api/transit";
    }
  }
  return "/api/transit";
}

async function cargarDatosGTFS() {
  const statusText = document.getElementById("loadingStatusText");
  const progressBar = document.getElementById("loadingProgressBar");
  const overlay = document.getElementById("loadingOverlay");

  function setProgress(pct, msg) {
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (statusText) statusText.innerText = msg;
  }

  const apiBase = getApiBase();

  const fetchFile = async (name) => {
    try {
      const res = await fetch(`${apiBase}/${name}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return await res.text();
    } catch (err) {
      if (window.location.protocol === "file:") {
        throw new Error("Estás abriendo el archivo localmente como 'file://'. Abre http://localhost:3000 en el navegador con el servidor iniciado.");
      }
      throw new Error(`No se pudo conectar a ${apiBase}/${name}: ${err.message}`);
    }
  };

  try {
    // Cargar configuración de mapa y proveedores desde el backend
    try {
      const configRes = await fetch("/api/config");
      if (configRes.ok) {
        const config = await configRes.json();
        if (config.defaultMapStyle && TILE_SERVERS[config.defaultMapStyle]) {
          currentMapStyle = config.defaultMapStyle;
          if (renderer) renderer.setClearColor(TILE_SERVERS[currentMapStyle].bgColor, 1);
          document.querySelectorAll(".map-style-option").forEach((opt) => {
            opt.classList.toggle("selected", opt.dataset.style === currentMapStyle);
          });
        }
      }
    } catch (_) {}

    setProgress(15, "Descargando rutas, paradas y horarios...");

    // Carga paralela unificada de los 5 archivos
    const [stopsCSV, routesCSV, tripsCSV, shapesCSV, timesCSV] = await Promise.all([
      fetchFile("stops.csv"),
      fetchFile("routes.csv"),
      fetchFile("trips.csv"),
      fetchFile("shapes.csv"),
      fetchFile("stop_times.csv"),
    ]);

    setProgress(50, "Analizando e indexando información del transporte...");

    // 1. Rutas
    const parsedRoutes = parseCSVRoutes(routesCSV);
    for (let i = 0; i < parsedRoutes.length; i++) {
      const r = parsedRoutes[i];
      datosRoutes.push(r);
      routesById.set(r.route_id, r);
    }

    // 2. Paradas
    const parsedStops = parseCSVStops(stopsCSV);
    for (let i = 0; i < parsedStops.length; i++) {
      const s = parsedStops[i];
      datosStops.push(s);
      stopsById.set(s.id, s);
    }

    // 3. Viajes (Trips)
    const parsedTrips = parseCSVTrips(tripsCSV);
    for (let i = 0; i < parsedTrips.length; i++) {
      const t = parsedTrips[i];
      datosTrips.push(t);
      tripsById.set(t.trip_id, t);
      if (!tripsByRoute.has(t.route_id)) {
        tripsByRoute.set(t.route_id, []);
      }
      tripsByRoute.get(t.route_id).push(t);
    }

    // 4. Formas de recorrido (Shapes - 20.000+ puntos de forma segura)
    const { datosShapes: parsedShapes, rutas } = parseCSVShapes(shapesCSV);
    for (let i = 0; i < parsedShapes.length; i++) {
      datosShapes.push(parsedShapes[i]);
    }

    // 5. Horarios de Paradas (Stop Times - 150.000+ filas de forma segura sin desbordar la pila)
    const parsedTimes = parseCSVStopTimes(timesCSV);
    for (let i = 0; i < parsedTimes.length; i++) {
      datosStopTimes.push(parsedTimes[i]);
    }

    // Indexar por trip_id O(1) para evitar escaneo masivo durante animación
    parsedTimes.forEach(st => {
      let list = stopTimesByTrip.get(st.trip_id);
      if (!list) {
        list = [];
        stopTimesByTrip.set(st.trip_id, list);
      }
      list.push(st);
    });

    setProgress(75, "Cruzando líneas con cada parada...");

    // Indexar correspondencia de paradas con líneas y próximos horarios
    parsedTimes.forEach(st => {
      const trip = tripsById.get(st.trip_id);
      if (trip) {
        // Asociar línea con parada
        if (!stopToRoutesMap.has(st.stop_id)) {
          stopToRoutesMap.set(st.stop_id, new Set());
        }
        stopToRoutesMap.get(st.stop_id).add(trip.route_id);

        // Guardar horarios para consultas rápidas
        if (!stopDeparturesMap.has(st.stop_id)) {
          stopDeparturesMap.set(st.stop_id, []);
        }
        const timeSec = timeStringToSeconds(st.departure_time || st.arrival_time);
        stopDeparturesMap.get(st.stop_id).push({
          route_id: trip.route_id,
          timeSec,
          timeStr: (st.departure_time || st.arrival_time || "").substring(0, 5),
          headsign: trip.headsign || "",
        });
      }
    });

    // Ordenar salidas de cada parada cronológicamente
    for (const [sid, arr] of stopDeparturesMap.entries()) {
      arr.sort((a, b) => a.timeSec - b.timeSec);
    }

    setProgress(85, "Dibujando red de transporte en 3D...");

    // Dibujar trazados de líneas en Three.js
    dibujarLineasRutas(rutas);

    // Crear sprites de paradas
    crearSpritesParadas();

    // Poblar selector lateral moderno
    poblarListaRutas();

    setProgress(100, "¡Listo! Iniciando mapa...");

    // Ocultar pantalla de carga con transición suave
    setTimeout(() => {
      if (overlay) overlay.classList.add("hidden");
    }, 400);

    // Primera comprobación de guaguas activas
    triggerTileUpdate();
    checkAndStartTrips();
  } catch (error) {
    console.error("Error crítico cargando datos GTFS:", error);
    let errorMsg = error.message;
    if (window.location.protocol === "file:") {
      errorMsg = "Has abierto el archivo como 'file://'. Para que el mapa funcione con los datos del servidor, abre <a href='http://localhost:3000' style='color:#60a5fa;'>http://localhost:3000</a> en el navegador.";
    } else if (error.message.includes("Failed to fetch")) {
      errorMsg = "No se puede conectar con el servidor local. Asegúrate de ejecutar <code>npm start</code> en la terminal y acceder por <a href='http://localhost:3000' style='color:#60a5fa;'>http://localhost:3000</a>.";
    }
    setProgress(100, "Error de conexión");
    if (statusText) {
      statusText.style.color = "#f87171";
      statusText.innerHTML = `${errorMsg}<br><br><button onclick="location.reload()" style="background:#2563eb; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer;">Reintentar</button>`;
    }
  }
}

// ========================================================
// RENDERIZADO DE RUTAS Y PARADAS EN THREE.JS
// ========================================================
function getRouteColor(shape_id) {
  const trip = datosTrips.find((t) => t.shape_id === shape_id);
  if (trip) {
    const route = routesById.get(trip.route_id);
    if (route && route.route_color) {
      return parseInt(route.route_color, 16);
    }
  }
  return 0x2563eb;
}

function dibujarLineasRutas(rutas) {
  for (const shape_id in rutas) {
    const points = rutas[shape_id].map((p) => {
      const x = MapeoX(p.lon);
      const y = MapeoY(p.lat);
      return new THREE.Vector3(x, y, 0.005);
    });

    const routeColor = getRouteColor(shape_id);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: routeColor,
      linewidth: 2,
      transparent: true,
      opacity: 0.85,
    });
    const line = new THREE.Line(geometry, material);
    line.userData = { shape_id };
    routeLines.push({ line, shape_id });
    scene.add(line);
  }
}

function crearSpritesParadas() {
  datosStops.forEach(stop => {
    const mlon = MapeoX(stop.lon);
    const mlat = MapeoY(stop.lat);

    const material = new THREE.SpriteMaterial({
      map: stopIconTexture,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    });

    const sprite = new THREE.Sprite(material);
    sprite.position.set(mlon, mlat, 0.02);
    sprite.renderOrder = 2;
    sprite.scale.set(0.08, 0.08, 1);

    // Asociar metadatos para raycasting
    sprite.userData = {
      type: "stop",
      stop_id: stop.id,
      nombre: stop.nombre,
      code: stop.code,
      lat: stop.lat,
      lon: stop.lon,
    };

    stopsGroup.add(sprite);
    stopSprites.push({ sprite, stop_id: stop.id });
  });
}

// ========================================================
// ANIMACIÓN DE GUAGUAS CON RENDIMIENTO O(1)
// ========================================================
function checkAndStartTrips() {
  const currentSec = getSimulationCurrentSeconds();

  // Filtrar viajes a considerar
  const tripsToCheck = selectedRouteId
    ? (tripsByRoute.get(selectedRouteId) || [])
    : datosTrips;

  // Optimización: recorrer viajes y lanzar solo aquellos que estén en su franja horaria
  tripsToCheck.forEach(trip => {
    if (!trip.shape_id) return;

    // Si ya está activo, no re-lanzar
    if (activeSpheres.some(active => active.trip_id === trip.trip_id)) return;

    // Buscar stop_times de este viaje en O(1)
    if (!trip._parsedTimes) {
      const times = stopTimesByTrip.get(trip.trip_id);
      if (!times || times.length < 2) return;
      const startSec = timeStringToSeconds(times[0].departure_time || times[0].arrival_time);
      const endSec = timeStringToSeconds(times[times.length - 1].arrival_time);
      trip._parsedTimes = { times, startSec, endSec };
    }

    const { times, startSec, endSec } = trip._parsedTimes;
    if (currentSec >= startSec && currentSec <= endSec) {
      startAnimation(trip, times, startSec, endSec);
    }
  });
}

function startAnimation(trip, stopTimes, startTimeSec, endTimeSec) {
  const shapePoints = datosShapes
    .filter((shape) => shape.shape_id === trip.shape_id)
    .sort((a, b) => a.sequence - b.sequence);

  if (shapePoints.length < 2) return;

  const points = shapePoints.map((p) => {
    const x = MapeoX(p.lon);
    const y = MapeoY(p.lat);
    return new THREE.Vector3(x, y, 0.05);
  });

  // Precomputar distancias acumuladas O(1) por frame en vez de O(N) reduce()
  const cumulativeDistances = [0];
  for (let i = 1; i < points.length; i++) {
    const d = points[i - 1].distanceTo(points[i]);
    cumulativeDistances.push(cumulativeDistances[i - 1] + d);
  }
  const totalDistance = cumulativeDistances[cumulativeDistances.length - 1];
  if (totalDistance <= 0) return;

  const material = new THREE.SpriteMaterial({
    map: guaguaIconTexture,
    depthTest: false,
    depthWrite: false,
  });
  const sphere = new THREE.Sprite(material);
  sphere.position.copy(points[0]);
  sphere.renderOrder = 5;
  sphere.scale.set(0.12, 0.12, 1);

  // Metadatos de la guagua
  const route = routesById.get(trip.route_id);
  sphere.userData = {
    type: "bus",
    trip_id: trip.trip_id,
    route_id: trip.route_id,
    route_short_name: route ? route.route_short_name : trip.route_id,
    route_name: route ? route.route_name : "",
    headsign: trip.headsign || "",
  };

  busesGroup.add(sphere);
  activeSpheres.push({
    trip_id: trip.trip_id,
    sphere,
    points,
    cumulativeDistances,
    totalDistance,
    startTimeSec,
    endTimeSec,
  });
}

function updateSpheres() {
  if (activeSpheres.length === 0) return;

  const currentSec = getSimulationCurrentSeconds();
  const spheresToRemove = [];

  activeSpheres.forEach(active => {
    const { sphere, points, cumulativeDistances, totalDistance, startTimeSec, endTimeSec } = active;
    const duration = endTimeSec - startTimeSec;

    if (duration <= 0 || currentSec < startTimeSec || currentSec > endTimeSec) {
      spheresToRemove.push(active);
      return;
    }

    const t = Math.max(0, Math.min(1, (currentSec - startTimeSec) / duration));
    const targetDist = t * totalDistance;

    // Búsqueda binaria ultra-rápida de segmento O(log N)
    let low = 0;
    let high = cumulativeDistances.length - 1;
    let segIndex = 0;

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (cumulativeDistances[mid] <= targetDist) {
        segIndex = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (segIndex >= points.length - 1) {
      sphere.position.copy(points[points.length - 1]);
    } else {
      const segStartDist = cumulativeDistances[segIndex];
      const segLen = cumulativeDistances[segIndex + 1] - segStartDist;
      const segT = segLen > 0 ? (targetDist - segStartDist) / segLen : 0;
      sphere.position.lerpVectors(points[segIndex], points[segIndex + 1], segT);
    }
  });

  spheresToRemove.forEach(active => {
    busesGroup.remove(active.sphere);
    active.sphere.material.dispose();
    const idx = activeSpheres.indexOf(active);
    if (idx > -1) activeSpheres.splice(idx, 1);
  });
}

// ========================================================
// GESTIÓN DEL TIEMPO (REAL Y SIMULADO)
// ========================================================
function getSimulationCurrentSeconds() {
  if (timeMode === "real") {
    const now = new Date();
    return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  }
  return simulatedSeconds;
}

function updateSimulationClock() {
  const display = document.getElementById("timeDisplayText");
  const slider = document.getElementById("timeSlider");
  const sec = getSimulationCurrentSeconds();

  if (timeMode === "real") {
    const now = new Date();
    if (display) {
      display.innerText = now.toLocaleTimeString("es-ES");
    }
    if (slider) {
      slider.value = sec;
    }
  } else {
    if (display) {
      display.innerText = secondsToTimeString(sec) + ":00";
    }
    if (slider) {
      slider.value = sec;
    }
  }
}

// ========================================================
// INTERACCIÓN Y RAYCASTING (HOVER Y CLIC EN PARADAS)
// ========================================================
function onPointerMove(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  // Objetos interactivos a comprobar: paradas y guaguas activas
  const interactiveSprites = [];
  if (showStops) {
    stopSprites.forEach(s => {
      if (s.sprite.visible) interactiveSprites.push(s.sprite);
    });
  }
  if (showBuses) {
    activeSpheres.forEach(a => interactiveSprites.push(a.sphere));
  }

  // Ajustar sensibilidad de toque del raycaster para sprites 2D
  raycaster.params.Sprite = { threshold: 0.1 };
  const intersects = raycaster.intersectObjects(interactiveSprites, false);

  const tooltip = document.getElementById("mapTooltip");

  if (intersects.length > 0) {
    const obj = intersects[0].object;
    hoveredObject = obj;
    renderer.domElement.style.cursor = "pointer";

    if (tooltip) {
      tooltip.style.display = "block";
      tooltip.style.left = `${event.clientX}px`;
      tooltip.style.top = `${event.clientY}px`;

      if (obj.userData.type === "stop") {
        tooltip.innerHTML = `🚏 <strong>${obj.userData.nombre}</strong> <span style="opacity:0.7;">(#${obj.userData.code})</span>`;
      } else if (obj.userData.type === "bus") {
        tooltip.innerHTML = `🚌 <strong>Línea ${obj.userData.route_short_name}</strong>: ${obj.userData.headsign || obj.userData.route_name}`;
      }
    }
  } else {
    hoveredObject = null;
    renderer.domElement.style.cursor = "grab";
    if (tooltip) tooltip.style.display = "none";
  }
}

function onPointerDown(event) {
  pointerDownPos = { x: event.clientX, y: event.clientY };
}

window.addEventListener("pointerup", (event) => {
  // Evitar clic si se trató de un arrastre/paneo del mapa
  const dist = Math.hypot(event.clientX - pointerDownPos.x, event.clientY - pointerDownPos.y);
  if (dist > 5) return;

  if (hoveredObject) {
    if (hoveredObject.userData.type === "stop") {
      mostrarDetallesParada(hoveredObject.userData);
    } else if (hoveredObject.userData.type === "bus") {
      seleccionarRuta(hoveredObject.userData.route_id);
    }
  }
});

function mostrarDetallesParada(stopData) {
  selectedStopData = stopData;
  const card = document.getElementById("stopDetailsCard");
  const codeEl = document.getElementById("stopCardCode");
  const nameEl = document.getElementById("stopCardName");
  const gridEl = document.getElementById("stopCardRoutesGrid");
  const depEl = document.getElementById("stopCardDeparturesList");

  if (!card) return;

  codeEl.innerText = `PARADA #${stopData.code || stopData.stop_id}`;
  nameEl.innerText = stopData.nombre;

  // Cargar líneas que dan servicio a esta parada
  gridEl.innerHTML = "";
  const routeIds = Array.from(stopToRoutesMap.get(stopData.stop_id) || []);

  if (routeIds.length === 0) {
    gridEl.innerHTML = '<span style="font-size: 12px; color: var(--text-muted);">Sin líneas registradas</span>';
  } else {
    // Ordenar numéricamente las líneas
    routeIds.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    routeIds.forEach(rid => {
      const r = routesById.get(rid);
      const color = r ? `#${r.route_color}` : "#2563eb";
      const shortName = r ? r.route_short_name : rid;

      const chip = document.createElement("div");
      chip.className = "stop-route-chip";
      chip.style.backgroundColor = color;
      chip.innerText = `Línea ${shortName}`;
      chip.title = r ? r.route_name : `Línea ${shortName}`;
      chip.onclick = () => {
        seleccionarRuta(rid);
      };
      gridEl.appendChild(chip);
    });
  }

  // Cargar próximos horarios programados
  depEl.innerHTML = "";
  const allDepartures = stopDeparturesMap.get(stopData.stop_id) || [];
  const currentSec = getSimulationCurrentSeconds();

  // Buscar las próximas salidas a partir de la hora actual
  const upcoming = allDepartures.filter(d => d.timeSec >= currentSec).slice(0, 5);
  // Si estamos al final del día, mostrar las primeras del día siguiente
  if (upcoming.length < 5) {
    upcoming.push(...allDepartures.slice(0, 5 - upcoming.length));
  }

  if (upcoming.length === 0) {
    depEl.innerHTML = '<span style="font-size: 12px; color: var(--text-muted);">No hay salidas programadas</span>';
  } else {
    upcoming.forEach(dep => {
      const r = routesById.get(dep.route_id);
      const color = r ? `#${r.route_color}` : "#2563eb";
      const shortName = r ? r.route_short_name : dep.route_id;

      const row = document.createElement("div");
      row.className = "departure-row";
      row.innerHTML = `
        <div class="departure-line">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${color};"></span>
          <span>Línea ${shortName}</span>
          <span style="color:var(--text-muted); font-size:11px;">${dep.headsign ? `→ ${dep.headsign}` : ""}</span>
        </div>
        <div class="departure-time">${dep.timeStr}</div>
      `;
      depEl.appendChild(row);
    });
  }

  card.classList.add("active");
}

function centrarEnParada(stopData) {
  if (!stopData) return;
  const x = MapeoX(stopData.lon);
  const y = MapeoY(stopData.lat);

  // Animación suave de cámara con controles
  const startTarget = controls.target.clone();
  const endTarget = new THREE.Vector3(x, y, 0);
  const startCamPos = camera.position.clone();
  const endCamPos = new THREE.Vector3(x, y, Math.min(camera.position.z, 6));

  let t = 0;
  function smoothPan() {
    t += 0.06;
    controls.target.lerpVectors(startTarget, endTarget, Math.min(1, t));
    camera.position.lerpVectors(startCamPos, endCamPos, Math.min(1, t));
    if (t < 1) {
      requestAnimationFrame(smoothPan);
    } else {
      triggerTileUpdate();
    }
  }
  smoothPan();
}

// ========================================================
// FILTRADO Y SELECCIÓN DE LÍNEAS
// ========================================================
function poblarListaRutas(filtro = "") {
  const container = document.getElementById("routesList");
  if (!container) return;
  container.innerHTML = "";

  const term = filtro.toLowerCase().trim();

  // Elemento "Todas las líneas"
  const allItem = document.createElement("div");
  allItem.className = `route-item ${!selectedRouteId ? "selected" : ""}`;
  allItem.innerHTML = `
    <div class="route-badge" style="background: #3b82f6;">ALL</div>
    <div class="route-info">
      <div class="route-name">Todas las líneas</div>
      <div class="route-meta">Ver red completa en el mapa</div>
    </div>
  `;
  allItem.onclick = () => seleccionarRuta(null);
  container.appendChild(allItem);

  // Ordenar rutas numéricamente
  const sortedRoutes = [...datosRoutes].sort((a, b) => {
    const na = parseInt(a.route_short_name, 10);
    const nb = parseInt(b.route_short_name, 10);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.route_short_name.localeCompare(b.route_short_name);
  });

  sortedRoutes.forEach(route => {
    const matchesSearch = !term ||
      route.route_short_name.toLowerCase().includes(term) ||
      route.route_name.toLowerCase().includes(term);

    if (!matchesSearch) return;

    const item = document.createElement("div");
    item.className = `route-item ${selectedRouteId === route.route_id ? "selected" : ""}`;
    const color = `#${route.route_color || "2563eb"}`;

    item.innerHTML = `
      <div class="route-badge" style="background: ${color};">${route.route_short_name}</div>
      <div class="route-info">
        <div class="route-name">${route.route_name}</div>
        <div class="route-meta">Línea ${route.route_short_name}</div>
      </div>
    `;
    item.onclick = () => seleccionarRuta(route.route_id);
    container.appendChild(item);
  });
}

function seleccionarRuta(routeId) {
  selectedRouteId = routeId;

  // Actualizar visibilidad de trazados de líneas
  routeLines.forEach(({ line, shape_id }) => {
    if (!selectedRouteId) {
      line.visible = true;
      line.material.opacity = 0.85;
    } else {
      const match = datosTrips.find(t => t.shape_id === shape_id && t.route_id === selectedRouteId);
      line.visible = !!match;
      line.material.opacity = 1.0;
    }
  });

  // Calcular paradas asociadas a esta ruta
  const visibleStopIds = new Set();
  if (selectedRouteId) {
    const trips = tripsByRoute.get(selectedRouteId) || [];
    trips.forEach(trip => {
      const times = stopTimesByTrip.get(trip.trip_id) || [];
      times.forEach(st => visibleStopIds.add(st.stop_id));
    });
  }

  // Actualizar visibilidad de paradas
  stopSprites.forEach(({ sprite, stop_id }) => {
    if (!showStops) {
      sprite.visible = false;
    } else if (!selectedRouteId) {
      sprite.visible = true;
    } else {
      sprite.visible = visibleStopIds.has(stop_id);
    }
  });

  // Limpiar guaguas anteriores que no pertenezcan a la línea y recalcular
  activeSpheres.forEach(a => {
    busesGroup.remove(a.sphere);
    a.sphere.material.dispose();
  });
  activeSpheres = [];
  checkAndStartTrips();

  // Actualizar panel de acciones y botones oficiales
  const actionsPanel = document.getElementById("routeActionsPanel");
  const btnPlanos = document.getElementById("btnPlanoRuta");
  const btnHorarios = document.getElementById("btnHorarioRuta");

  if (selectedRouteId) {
    if (actionsPanel) actionsPanel.style.display = "flex";
    if (btnPlanos) btnPlanos.href = `https://www.guaguas.com/pdf/lineas/linea${selectedRouteId}.pdf`;
    if (btnHorarios) btnHorarios.href = `https://www.guaguas.com/pdf/lineas/L${selectedRouteId}CaraB.pdf`;
  } else {
    if (actionsPanel) actionsPanel.style.display = "none";
  }

  // Refrescar lista de rutas activa
  const searchInput = document.getElementById("routeSearchInput");
  poblarListaRutas(searchInput ? searchInput.value : "");
}

// ========================================================
// CONEXIÓN DE EVENTOS DE INTERFAZ DE USUARIO (UI)
// ========================================================
function setupUIEvents() {
  // 1. Sidebar Toggle y Cerrar
  const sidebar = document.getElementById("sidebar");
  const toggleBtn = document.getElementById("toggleSidebarBtn");
  const closeBtn = document.getElementById("closeSidebarBtn");

  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener("click", () => {
      sidebar.classList.toggle("collapsed");
    });
  }
  if (closeBtn && sidebar) {
    closeBtn.addEventListener("click", () => {
      sidebar.classList.add("collapsed");
    });
  }

  // 2. Buscador de Líneas
  const searchInput = document.getElementById("routeSearchInput");
  const clearSearchBtn = document.getElementById("clearSearchBtn");

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const val = e.target.value;
      if (clearSearchBtn) clearSearchBtn.style.display = val ? "block" : "none";
      poblarListaRutas(val);
    });
  }

  if (clearSearchBtn && searchInput) {
    clearSearchBtn.addEventListener("click", () => {
      searchInput.value = "";
      clearSearchBtn.style.display = "none";
      poblarListaRutas("");
    });
  }

  // 3. Botón "Ver todas las líneas"
  const clearSelectionBtn = document.getElementById("btnClearRouteSelection");
  if (clearSelectionBtn) {
    clearSelectionBtn.addEventListener("click", () => {
      seleccionarRuta(null);
    });
  }

  // 4. Tarjeta de Detalle de Parada
  const stopCard = document.getElementById("stopDetailsCard");
  const closeStopCardBtn = document.getElementById("closeStopCardBtn");
  const btnFocusStop = document.getElementById("btnFocusStop");

  if (closeStopCardBtn && stopCard) {
    closeStopCardBtn.addEventListener("click", () => {
      stopCard.classList.remove("active");
    });
  }

  if (btnFocusStop) {
    btnFocusStop.addEventListener("click", () => {
      if (selectedStopData) centrarEnParada(selectedStopData);
    });
  }

  // 5. Controles Flotantes del Mapa
  const btnZoomIn = document.getElementById("btnZoomIn");
  const btnZoomOut = document.getElementById("btnZoomOut");
  const btnResetView = document.getElementById("btnResetView");
  const btnToggleStops = document.getElementById("btnToggleStops");
  const btnToggleBuses = document.getElementById("btnToggleBuses");
  const btnMapStyle = document.getElementById("btnMapStyle");
  const mapStyleMenu = document.getElementById("mapStyleMenu");

  if (btnZoomIn) {
    btnZoomIn.addEventListener("click", () => {
      camera.position.z = Math.max(controls.minDistance, camera.position.z * 0.7);
      triggerTileUpdate();
    });
  }

  if (btnZoomOut) {
    btnZoomOut.addEventListener("click", () => {
      camera.position.z = Math.min(controls.maxDistance, camera.position.z * 1.4);
      triggerTileUpdate();
    });
  }

  if (btnResetView) {
    btnResetView.addEventListener("click", () => {
      controls.target.set(16.5, 4.2, 0);
      camera.position.set(16.5, 4.2, 18);
      triggerTileUpdate();
    });
  }

  if (btnToggleStops) {
    btnToggleStops.addEventListener("click", () => {
      showStops = !showStops;
      stopsGroup.visible = showStops;
      btnToggleStops.classList.toggle("active", showStops);
    });
  }

  if (btnToggleBuses) {
    btnToggleBuses.addEventListener("click", () => {
      showBuses = !showBuses;
      busesGroup.visible = showBuses;
      btnToggleBuses.classList.toggle("active", showBuses);
    });
  }

  if (btnMapStyle && mapStyleMenu) {
    btnMapStyle.addEventListener("click", () => {
      mapStyleMenu.classList.toggle("open");
    });

    document.querySelectorAll(".map-style-option").forEach(opt => {
      opt.addEventListener("click", () => {
        document.querySelectorAll(".map-style-option").forEach(o => o.classList.remove("selected"));
        opt.classList.add("selected");
        setMapStyle(opt.dataset.style);
        mapStyleMenu.classList.remove("open");
      });
    });
  }

  // 6. Controles de Simulación de Tiempo
  const timeSlider = document.getElementById("timeSlider");
  const presetReal = document.getElementById("btnPresetReal");
  const presetMorning = document.getElementById("btnPresetMorning");
  const presetNoon = document.getElementById("btnPresetNoon");

  function setPreset(mode, seconds) {
    timeMode = mode;
    if (seconds !== undefined) simulatedSeconds = seconds;
    document.querySelectorAll(".btn-time-preset").forEach(b => b.classList.remove("active"));
    checkAndStartTrips();
    updateSimulationClock();
  }

  if (presetReal) {
    presetReal.addEventListener("click", () => {
      setPreset("real");
      presetReal.classList.add("active");
    });
  }

  if (presetMorning) {
    presetMorning.addEventListener("click", () => {
      setPreset("custom", 8 * 3600 + 30 * 60); // 08:30
      presetMorning.classList.add("active");
    });
  }

  if (presetNoon) {
    presetNoon.addEventListener("click", () => {
      setPreset("custom", 14 * 3600); // 14:00
      presetNoon.classList.add("active");
    });
  }

  if (timeSlider) {
    timeSlider.addEventListener("input", (e) => {
      timeMode = "custom";
      simulatedSeconds = parseInt(e.target.value, 10);
      document.querySelectorAll(".btn-time-preset").forEach(b => b.classList.remove("active"));
      checkAndStartTrips();
      updateSimulationClock();
    });
  }
}

// ========================================================
// REDIMENSIONAMIENTO Y ADAPTACIÓN DE SPRITES (LOD)
// ========================================================
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  triggerTileUpdate();
}

function updateSpriteScaleLOD() {
  // Ajuste inteligente del tamaño de sprites según la distancia de cámara (LOD)
  const z = camera.position.z;
  const stopScale = Math.max(0.04, Math.min(0.2, z * 0.005));
  const busScale = Math.max(0.08, Math.min(0.35, z * 0.009));

  stopSprites.forEach(s => {
    s.sprite.scale.set(stopScale, stopScale, 1);
  });

  activeSpheres.forEach(a => {
    a.sphere.scale.set(busScale, busScale, 1);
  });
}

// ========================================================
// BUCLE DE ANIMACIÓN PRINCIPAL (60 FPS FLUIDOS)
// ========================================================
function animate(timestamp = 0) {
  requestAnimationFrame(animate);

  controls.update();

  // Comprobar si la cámara se ha movido para refrescar teselas sin saturar
  const camMoved =
    lastCameraX === null ||
    Math.abs(camera.position.x - lastCameraX) > 0.05 ||
    Math.abs(camera.position.y - lastCameraY) > 0.05 ||
    Math.abs(camera.position.z - lastCameraZ) > 0.1;

  if (camMoved) {
    lastCameraX = camera.position.x;
    lastCameraY = camera.position.y;
    lastCameraZ = camera.position.z;
    updateTiles();
    updateSpriteScaleLOD();
  }

  // Actualizar posiciones de guaguas activas en $O(1)$
  updateSpheres();

  // Comprobación de nuevos viajes cada 500 ms (no en cada frame)
  if (timestamp - lastTripCheckTime > 500) {
    checkAndStartTrips();
    lastTripCheckTime = timestamp;
  }

  // Actualización del reloj cada 1000 ms
  if (timestamp - lastClockTime > 1000) {
    updateSimulationClock();
    lastClockTime = timestamp;
  }

  renderer.render(scene, camera);
}

// Iniciar aplicación una vez definidas todas las variables y funciones
init();
animate();

