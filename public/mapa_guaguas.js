import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { loadStopModel } from "./render_objects.js";

let scene, renderer, camera, controls;
let mapa, mapsx, mapsy;
let stopModelPromise = loadStopModel();

// Latitud y longitud de los extremos del mapa de la imagen
let minlon = -15.58702,
  maxlon = -15.36202;
let minlat = 28.04844,
  maxlat = 28.18623;
// Dimensiones textura (mapa)
let txwidth, txheight;

const fechaInicio = new Date(2023, 0, 1); //Desde mayo (enero es 0)
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

const selectDiv = document.createElement("div");
selectDiv.style.width = "100%";
selectDiv.style.position = "absolute";
selectDiv.style.display = "flex";
selectDiv.style.top = "50px";
selectDiv.style.justifyContent = "center";
selectDiv.style.zIndex = "1";
const routeSelect = document.createElement("select");
routeSelect.id = "routeSelect";

const placeholder = document.createElement("option");
placeholder.text = "Select a route";
placeholder.disabled = true;
placeholder.selected = true;
routeSelect.appendChild(placeholder);

selectDiv.appendChild(routeSelect);

let cachedTrips = [];
let cachedStopTimes = {};

routeSelect.addEventListener("change", (event) => {
  selectedRouteId = event.target.value;
  cacheTripsAndStopTimes();
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

  cachedTrips.forEach((trip) => {
    if (!trip.shape_id) return; // Skip if shape_id is undefined

    const stopTimes = cachedStopTimes[trip.trip_id];
    if (stopTimes.length === 0) return; // Skip if no stop times

    const firstStopTime = convertirHora(stopTimes[0].arrival_time).getTime();
    if (fechaActual.getTime() === firstStopTime) {
      startAnimation(trip, stopTimes);
    }
  });
}

init();
animate();

function init() {
  //Muestra fecha como título
  fecha2show = document.createElement("div");
  fecha2show.style.position = "absolute";
  fecha2show.style.top = "30px";
  fecha2show.style.width = "100%";
  fecha2show.style.textAlign = "center";
  fecha2show.style.color = "#000";
  fecha2show.style.fontWeight = "bold";
  fecha2show.style.backgroundColor = "transparent";
  fecha2show.style.zIndex = "1";
  fecha2show.style.fontFamily = "Monospace";
  fecha2show.innerHTML = "";
  document.body.appendChild(fecha2show);
  document.body.appendChild(selectDiv);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd5ebf0);
  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    1,
    10000
  );
  // Posición de la cámara
  camera.position.set(0, 0, 100);

  renderer = new THREE.WebGLRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true; // Activar amortiguación
  controls.dampingFactor = 0.25; // Ajusta la suavidad del movimiento
  controls.enableRotate = false; // Desactivar la rotación
  controls.screenSpacePanning = true; // Activar desplazamiento en espacio de pantalla
  controls.zoomSpeed = 1; // Ajustar la velocidad de zoom

  // Límite de zoom
  controls.minDistance = 10; // Distancia mínima
  controls.maxDistance = 120; // Distancia máxima

  // Enable tilt with ctrl + drag
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.PAN,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.touches = {
    ONE: THREE.TOUCH.PAN,
    TWO: THREE.TOUCH.DOLLY_ROTATE,
  };

  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey) {
      controls.enableRotate = true;
    }
  });

  window.addEventListener("keyup", (event) => {
    if (!event.ctrlKey) {
      controls.enableRotate = false;
    }
  });

  // Crear el plano de mapa
  mapsx = 100;
  mapsy = 100;
  Plano(0, 0, 0, mapsx, mapsy);

  // Cargar textura del mapa
  const tx1 = new THREE.TextureLoader().load(
    "https://cdn.glitch.me/16da4edb-53fe-4801-9575-2b429ea86330/mapaLPGC.svg?v=1731458312478",
    function (texture) {
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.NearestFilter;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

      mapa.material.map = texture;
      mapa.material.needsUpdate = true;

      txwidth = texture.image.width;
      txheight = texture.image.height;

      if (txheight > txwidth) {
        let factor = txheight / txwidth;
        mapa.scale.set(1, factor, 1);
        mapsy *= factor;
      } else {
        let factor = txwidth / txheight;
        mapa.scale.set(factor, 1, 1);
        mapsx *= factor;
      }
    }
  );

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
      console.log(response);
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

      let mlon = Mapeo(
        columna[indices.lon],
        minlon,
        maxlon,
        -mapsx / 2,
        mapsx / 2
      );
      let mlat = Mapeo(
        columna[indices.lat],
        minlat,
        maxlat,
        -mapsy / 2,
        mapsy / 2
      );

      stopModelPromise
        .then((model) => {
          addStopModel(mlon, mlat, 0, model);
        })
        .catch((error) => {
          console.error("Error loading stop model:", error);
        });
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
      const x = Mapeo(p.lon, minlon, maxlon, -mapsx / 2, mapsx / 2);
      const y = Mapeo(p.lat, minlat, maxlat, -mapsy / 2, mapsy / 2);
      return new THREE.Vector3(x, y, 0);
    });
    const routeColor = getRouteColor(shape_id);
    drawRoute(points, routeColor);
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

function drawRoute(points, color) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color: parseInt(color, 16) });
  const line = new THREE.Line(geometry, material);
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
  let material = new THREE.MeshBasicMaterial({});
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
  totalMinutos += 1;
  // Añade fecha de partida
  fechaActual = new Date(fechaInicio.getTime() + totalMinutos * 60000);

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
    const x = Mapeo(p.lon, minlon, maxlon, -mapsx / 2, mapsx / 2);
    const y = Mapeo(p.lat, minlat, maxlat, -mapsy / 2, mapsy / 2);
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
  activeSpheres.push({ sphere, points, stopTimes, currentIndex: 0 });
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
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
