// -------------------------
// Panes (z-order)
// -------------------------
map.createPane("terrainPane");
map.getPane("terrainPane").style.zIndex = 200;

map.createPane("tempsPane");
map.getPane("tempsPane").style.zIndex = 400;

map.createPane("coastPane");
map.getPane("coastPane").style.zIndex = 680;
map.getPane("coastPane").style.pointerEvents = "none";

map.createPane("borderPane");
map.getPane("borderPane").style.zIndex = 700;
map.getPane("borderPane").style.pointerEvents = "none";

map.createPane("labelPane");
map.getPane("labelPane").style.zIndex = 750;
map.getPane("labelPane").style.pointerEvents = "none";

// Terrain tiles (under temps)
L.tileLayer(
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}",
  { pane: "terrainPane", maxZoom: 13 }
).addTo(map);

// Groups
const coastGroup   = L.featureGroup().addTo(map);
const bordersGroup = L.featureGroup().addTo(map);
const labelsGroup  = L.featureGroup().addTo(map);

// -------------------------
// Shift GeoJSON longitudes for wrap copies
// -------------------------
function shiftGeoJsonLng(fc, shiftDeg) {
  const shift = (c) => [c[0] + shiftDeg, c[1]];
  const t = (g) => {
    const c = g.coordinates;
    switch (g.type) {
      case "Point": return { ...g, coordinates: shift(c) };
      case "MultiPoint":
      case "LineString": return { ...g, coordinates: c.map(shift) };
      case "MultiLineString": return { ...g, coordinates: c.map(line => line.map(shift)) };
      case "Polygon": return { ...g, coordinates: c.map(r => r.map(shift)) };
      case "MultiPolygon": return { ...g, coordinates: c.map(p => p.map(r => r.map(shift))) };
      default: return g;
    }
  };
  return { type: "FeatureCollection", features: fc.features.map(f => ({ ...f, geometry: t(f.geometry) })) };
}

// -------------------------
// Borders (NE: SCALERANK + MIN_ZOOM, wrapped, gray)
// -------------------------
let bordersRaw = null;

function maxBorderRankForZoom(z) {
  if (z <= 2) return 0;
  if (z === 3) return 1;
  if (z === 4) return 2;
  if (z === 5) return 3;
  if (z === 6) return 5;
  return 10;
}

function passesMinZoom_NE(f, z) {
  const mz = f.properties?.MIN_ZOOM;
  if (mz === undefined || mz === null) return true;
  const minz = Number(mz);
  return Number.isFinite(minz) ? z >= minz : true;
}

function isRealBorder_NE(f) {
  const type = (f.properties?.TYPE || "").toLowerCase();
  const fcla = (f.properties?.FEATURECLA || "").toLowerCase();
  if (type.includes("water")) return false;
  if (fcla.includes("water")) return false;
  return true;
}

async function loadBorders() {
  bordersRaw = await (await fetch("/data/ne_borders.geojson")).json();
  renderBorders();
}

function renderBorders() {
  if (!bordersRaw) return;

  const z = map.getZoom();
  const maxRank = maxBorderRankForZoom(z);

  bordersGroup.clearLayers();

  for (const shift of [-360, 0, 360]) {
    L.geoJSON(shiftGeoJsonLng(bordersRaw, shift), {
      pane: "borderPane",
      interactive: false,
      filter: (f) => {
        const r = Number(f.properties?.SCALERANK ?? f.properties?.scalerank ?? 999);
        return r <= maxRank && passesMinZoom_NE(f, z) && isRealBorder_NE(f);
      },
      style: () => ({
        color: "#666",
        weight: z >= 6 ? 1.3 : 0.9,
        opacity: 0.85,
        lineCap: "round",
        lineJoin: "round"
      })
    }).addTo(bordersGroup);
  }
}

// -------------------------
// Labels (dedupe + viewport + declutter)
// -------------------------
let labelsRaw = null;

function maxLabelRankForZoom(z) {
  if (z <= 2) return 0;
  if (z === 3) return 1;
  if (z === 4) return 2;
  if (z === 5) return 3;
  return 10;
}

function maxLabelsForZoom(z) {
  if (z <= 2) return 25;
  if (z === 3) return 45;
  if (z === 4) return 80;
  if (z === 5) return 130;
  return 220;
}

function dedupeBySovereign(fc) {
  const best = new Map();
  for (const f of fc.features) {
    const p = f.properties || {};
    const key = p.sr_sov_a3 || p.sr_adm0_a3 || p.sr_su_a3;
    const name = p.sr_subunit || p.ADMIN || p.NAME;
    if (!key || !name) continue;

    const r = Number(p.scalerank ?? p.SCALERANK ?? 999);
    const prev = best.get(key);
    if (!prev) best.set(key, f);
    else {
      const pr = Number(prev.properties?.scalerank ?? prev.properties?.SCALERANK ?? 999);
      if (r < pr) best.set(key, f);
    }
  }
  return { type: "FeatureCollection", features: [...best.values()] };
}

function estimateLabelBoxPx(name) {
  const charW = 7.2;
  const padX = 10;
  const padY = 8;
  const w = Math.min(260, name.length * charW + padX);
  const h = 18 + padY;
  return { w, h };
}

function boxesOverlap(a, b) {
  return !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
}

async function loadLabels() {
  const labels = await (await fetch("/data/ne_label_points.geojson")).json();
  labelsRaw = dedupeBySovereign(labels);
  renderLabels();
}

function renderLabels() {
  if (!labelsRaw) return;

  const z = map.getZoom();
  const maxRank = maxLabelRankForZoom(z);

  labelsGroup.clearLayers();
  if (z < 3) return;

  const bounds = map.getBounds().pad(0.15);

  const candidates = [];
  for (const f of labelsRaw.features) {
    const p = f.properties || {};
    const r = Number(p.scalerank ?? p.SCALERANK ?? 999);
    if (r > maxRank) continue;

    const name = p.sr_subunit || p.ADMIN || p.NAME;
    if (!name) continue;

    const c = f.geometry?.coordinates;
    if (!c || c.length < 2) continue;

    const lng = c[0], lat = c[1];
    if (!bounds.contains([lat, lng])) continue;

    candidates.push({ name, r, lat, lng });
  }

  candidates.sort((a, b) => a.r - b.r || a.name.length - b.name.length);

  const placed = [];
  let placedCount = 0;
  const limit = maxLabelsForZoom(z);

  for (const shift of [-360, 0, 360]) {
    for (const c of candidates) {
      if (placedCount >= limit) break;

      const latlng = L.latLng(c.lat, c.lng + shift);
      const pt = map.latLngToContainerPoint(latlng);

      const { w, h } = estimateLabelBoxPx(c.name);
      const box = { x1: pt.x - w / 2, y1: pt.y - h / 2, x2: pt.x + w / 2, y2: pt.y + h / 2 };

      if (box.x2 < 0 || box.y2 < 0 || box.x1 > map.getSize().x || box.y1 > map.getSize().y) continue;

      let ok = true;
      for (const b of placed) { if (boxesOverlap(box, b)) { ok = false; break; } }
      if (!ok) continue;

      placed.push(box);
      placedCount++;

      L.marker(latlng, {
        pane: "labelPane",
        interactive: false,
        icon: L.divIcon({ className: "country-label", html: c.name, iconSize: null })
      }).addTo(labelsGroup);
    }
  }
}

// -------------------------
// Coastline (wrapped)
// -------------------------
async function loadCoast() {
  const coast = await (await fetch("/data/ne_coastline.geojson")).json();
  coastGroup.clearLayers();

  for (const shift of [-360, 0, 360]) {
    L.geoJSON(shiftGeoJsonLng(coast, shift), {
      pane: "coastPane",
      interactive: false,
      style: () => ({ color: "#222", weight: 1.2, opacity: 0.9 })
    }).addTo(coastGroup);
  }
}

// update on both zoom + pan (focus-level)
map.on("zoomend moveend", () => {
  renderBorders();
  renderLabels();
});

// kick off
loadBorders();
loadLabels();
loadCoast();
