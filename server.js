// server.js
// Servidor Express optimizado con compresión, variables de entorno (.env) y caché inteligente para datos GTFS

require('dotenv').config();

const express = require('express');
const compression = require('compression');
const fs = require('fs');
const path = require('path');

const app = express();

// Configuración de entorno
const GTFS_BASE_URL = process.env.GUAGUAS_GTFS_URL;
const CACHE_TTL_HOURS = parseInt(process.env.CACHE_TTL_HOURS, 10) || 24;
const CACHE_TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000;
const cacheDir = path.join(__dirname, process.env.CACHE_DIR);

// Logger de peticiones y CORS universal para desarrollo
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url} (Origin: ${req.headers.origin || 'same-origin'})`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json());

// Servir Three.js directamente desde node_modules local para máxima velocidad y fiabilidad sin depender de CDNs externas
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three'), {
  maxAge: '1d',
  etag: true
}));

// Habilitar compresión HTTP gzip para todas las respuestas (reduce stop_times de 6MB a ~900KB)
app.use(compression());

// Servir archivos estáticos desde public/ sin caché durante desarrollo
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Endpoint de configuración pública para el frontend
app.get("/api/config", (req, res) => {
  res.json({
    defaultMapStyle: process.env.DEFAULT_MAP_STYLE || "streets",
    gtfsSource: GTFS_BASE_URL
  });
});

// Logger de errores del cliente
app.post("/api/client-log", (req, res) => {
  console.log(`[CLIENT-REPORT]`, JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// Rutas principales
app.get(["/", "/index.html", "/views/index.html"], function (request, response) {
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  response.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Sistema de caché en memoria y persistencia local para datos de Guaguas Municipales
const memoryCache = new Map();

if (!fs.existsSync(cacheDir)) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch (err) {
    console.warn("No se pudo crear directorio de caché local:", err.message);
  }
}

// Mapa para deduplicar peticiones simultáneas en vuelo
const pendingFetches = new Map();

async function getTransitData(filename) {
  const now = Date.now();

  // 1. Comprobar caché en memoria
  const memoryEntry = memoryCache.get(filename);
  if (memoryEntry && (now - memoryEntry.timestamp < CACHE_TTL_MS)) {
    return { data: memoryEntry.data, source: 'memory' };
  }

  // 2. Comprobar caché en disco
  const diskPath = path.join(cacheDir, filename);
  if (fs.existsSync(diskPath)) {
    try {
      const stats = fs.statSync(diskPath);
      if (now - stats.mtimeMs < CACHE_TTL_MS) {
        const diskData = fs.readFileSync(diskPath, 'utf8');
        memoryCache.set(filename, { data: diskData, timestamp: stats.mtimeMs });
        return { data: diskData, source: 'disk' };
      }
    } catch (e) {
      console.warn(`Error leyendo caché de disco para ${filename}:`, e.message);
    }
  }

  // 3. Deduplicar peticiones en curso
  if (pendingFetches.has(filename)) {
    return pendingFetches.get(filename);
  }

  const fetchPromise = (async () => {
    try {
      console.log(`[GTFS Proxy] Descargando de origen remoto: ${filename}...`);
      const fetchResponse = await fetch(`${GTFS_BASE_URL}/${filename}`);
      if (!fetchResponse.ok) {
        throw new Error(`Upstream responded with ${fetchResponse.status}: ${fetchResponse.statusText}`);
      }
      const data = await fetchResponse.text();

      // Guardar en memoria
      memoryCache.set(filename, { data, timestamp: now });

      // Guardar en disco asíncronamente
      fs.writeFile(diskPath, data, 'utf8', (err) => {
        if (err) console.warn(`Error escribiendo en disco ${filename}:`, err.message);
      });

      return { data, source: 'network' };
    } catch (err) {
      // Si falla la red pero tenemos versión antigua en disco, usarla como salvaguarda
      if (fs.existsSync(diskPath)) {
        console.warn(`[GTFS Proxy] Fallo de red para ${filename}, sirviendo caché antigua.`);
        const staleData = fs.readFileSync(diskPath, 'utf8');
        return { data: staleData, source: 'stale-disk' };
      }
      throw err;
    } finally {
      pendingFetches.delete(filename);
    }
  })();

  pendingFetches.set(filename, fetchPromise);
  return fetchPromise;
}

// Proxy transit data con compresión y caché de 24 horas
app.get("/api/transit/:filename", async (request, response) => {
  const filename = path.basename(request.params.filename);

  // Asegurar que solo se soliciten archivos csv o txt seguros
  if (!/^[a-zA-Z0-9_\-]+\.(csv|txt)$/.test(filename)) {
    return response.status(400).send("Nombre de archivo no válido");
  }

  try {
    const { data, source } = await getTransitData(filename);
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Cache-Control", "public, max-age=86400"); // 1 día para el cliente
    response.setHeader("X-Cache-Source", source);
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.send(data);
  } catch (error) {
    console.error(`Error obteniendo ${filename}:`, error.message);
    response.status(502).send(`Error al obtener datos de tránsito: ${error.message}`);
  }
});

// Endpoint de diagnóstico y estado
app.get("/api/transit-status", (req, res) => {
  const cachedFiles = Array.from(memoryCache.keys()).map(name => ({
    file: name,
    ageSeconds: Math.round((Date.now() - memoryCache.get(name).timestamp) / 1000)
  }));
  res.json({
    status: "ok",
    memoryCacheCount: memoryCache.size,
    cachedFiles
  });
});

// Inicialización del servidor
const PORT = process.env.PORT || 3000;
const listener = app.listen(PORT, function () {
  console.log(`[Mapa Guaguas] Servidor activo en http://localhost:${listener.address().port}`);
});
