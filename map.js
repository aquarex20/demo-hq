if (!window.map) throw new Error("Map not initialized yet");

// -------------------------
// Panes (z-order)
// -------------------------
window.map.createPane("continentLabelPane");
window.map.getPane("continentLabelPane").style.zIndex = 720;
window.map.getPane("continentLabelPane").style.pointerEvents = "none";
const continentLabels = L.featureGroup().addTo(window.map);

window.map.createPane("continentBorderPane");
window.map.getPane("continentBorderPane").style.zIndex = 690;
window.map.getPane("continentBorderPane").style.pointerEvents = "none";


window.map.createPane("terrainPane");
window.map.getPane("terrainPane").style.zIndex = 200;

window.map.createPane("tempsPane");
window.map.getPane("tempsPane").style.zIndex = 400;

window.map.createPane("coastPane");
window.map.getPane("coastPane").style.zIndex = 680;
window.map.getPane("coastPane").style.pointerEvents = "none";

window.map.createPane("borderPane");
window.map.getPane("borderPane").style.zIndex = 700;
window.map.getPane("borderPane").style.pointerEvents = "none";

window.map.createPane("labelPane");
window.map.getPane("labelPane").style.zIndex = 750;
window.map.getPane("labelPane").style.pointerEvents = "none";

// Terrain tiles (under temps)
const terrainLayer = L.tileLayer(
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}",
  { pane: "terrainPane", maxZoom: 13 }
).addTo(window.map);

// Expose terrain layer for toggling
window.terrainLayer = terrainLayer;

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

// Expose globally for use in borders.js
window.shiftGeoJsonLng = shiftGeoJsonLng;

// Groups
const coastGroup   = L.featureGroup().addTo(map);
const labelsGroup  = L.featureGroup().addTo(map);

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

  const z = window.map.getZoom();
  const maxRank = maxLabelRankForZoom(z);

  labelsGroup.clearLayers();
  if (z < 4) return;

  const bounds = window.map.getBounds().pad(0.15);

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
      const pt = window.map.latLngToContainerPoint(latlng);

      const { w, h } = estimateLabelBoxPx(c.name);
      const box = { x1: pt.x - w / 2, y1: pt.y - h / 2, x2: pt.x + w / 2, y2: pt.y + h / 2 };

      if (box.x2 < 0 || box.y2 < 0 || box.x1 > window.map.getSize().x || box.y1 > window.map.getSize().y) continue;

      let ok = true;
      for (const b of placed) { if (boxesOverlap(box, b)) { ok = false; break; } }
      if (!ok) continue;

      placed.push(box);
      placedCount++;


      // Scale font size based on zoom for smoother transition from continent to country labels
      const baseFontSize = 12;
      const zoomScale = Math.min(1.2, Math.max(0.85, (z - 2) * 0.1 + 0.85)); // Scale from 0.85x at z=3 to 1.2x at z=5+
      const fontSize = baseFontSize * zoomScale;
      
      const icon = L.divIcon({
        className: "country-label-wrap", // wrapper class
        html: `<div class="country-label" style="font-size: ${fontSize}px;">${c.name}</div>`,
        iconSize: [w, h],
        iconAnchor: [w / 2, h / 2], // ✅ true center anchor
      });
      
      L.marker(latlng, {
        pane: "labelPane",
        interactive: false,
        icon
      }).addTo(labelsGroup);
    }
  }
}

// -------------------------
// Coastline (wrapped)
// -------------------------
let coastRaw = null;

function lineIntersectsBounds(lineCoords, bounds) {
  // Check if any point of the line is within bounds
  for (const coord of lineCoords) {
    const [lng, lat] = coord;
    if (bounds.contains([lat, lng])) return true;
  }
  
  // Check if line segments cross the bounds rectangle
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  
  // Check each segment
  for (let i = 0; i < lineCoords.length - 1; i++) {
    const [lng1, lat1] = lineCoords[i];
    const [lng2, lat2] = lineCoords[i + 1];
    
    // Check if segment intersects any edge of the bounds rectangle
    // This is a simplified check - if both points are outside but on opposite sides, it likely crosses
    const p1Inside = lat1 >= sw.lat && lat1 <= ne.lat && lng1 >= sw.lng && lng1 <= ne.lng;
    const p2Inside = lat2 >= sw.lat && lat2 <= ne.lat && lng2 >= sw.lng && lng2 <= ne.lng;
    
    if (p1Inside || p2Inside) return true;
    
    // Check if segment crosses bounds (more thorough check)
    const minLat = Math.min(lat1, lat2);
    const maxLat = Math.max(lat1, lat2);
    const minLng = Math.min(lng1, lng2);
    const maxLng = Math.max(lng1, lng2);
    
    // If bounding box of segment overlaps with viewport bounds, likely intersects
    if (maxLat >= sw.lat && minLat <= ne.lat && maxLng >= sw.lng && minLng <= ne.lng) {
      return true;
    }
  }
  
  return false;
}

function renderCoast() {
  if (!coastRaw) return;

  const z = window.map.getZoom();
  // Use larger padding when zoomed out to ensure coastlines are visible
  const padding = z <= 3 ? 0.3 : 0.1;
  const bounds = window.map.getBounds().pad(padding);
  
  // Only show shadow when zoom > 2 AND zoom <= 4 (when continents are visible)
  const shouldShowShadow = z > 2 && z <= 4;

  coastGroup.clearLayers();

  for (const shift of [-360, 0, 360]) {
    const shifted = shiftGeoJsonLng(coastRaw, shift);
    
    L.geoJSON(shifted, {
      pane: "coastPane",
      interactive: false,
      filter: (f) => {
        // Only show coastlines that intersect the viewport
        const geom = f.geometry;
        if (!geom) return false;
        
        if (geom.type === "LineString") {
          return lineIntersectsBounds(geom.coordinates, bounds);
        } else if (geom.type === "MultiLineString") {
          return geom.coordinates.some(line => lineIntersectsBounds(line, bounds));
        }
        return false;
      },
      style: () => ({
        color: "#111",
        weight: 1.4,
        opacity: 0.9,
        className: shouldShowShadow ? "coast-shadow" : ""
      })
    }).addTo(coastGroup);
  }
}

async function loadCoast() {
  coastRaw = await (await fetch("/data/ne_coastline.geojson")).json();
  renderCoast();
}

// Throttle coastline rendering during zoom for performance
let coastRenderTimeout = null;
let coastRenderRAF = null;

function scheduleCoastRender() {
  if (coastRenderTimeout) clearTimeout(coastRenderTimeout);
  if (coastRenderRAF) cancelAnimationFrame(coastRenderRAF);
  
  // Use requestAnimationFrame for smooth updates
  coastRenderRAF = requestAnimationFrame(() => {
    renderCoast();
    coastRenderRAF = null;
  });
  
  // Also set a timeout as backup
  coastRenderTimeout = setTimeout(() => {
    if (!coastRenderRAF) {
      renderCoast();
    }
    coastRenderTimeout = null;
  }, 100);
}

// update on both zoom + pan (focus-level)



// kick off
loadLabels();
loadCoast();

window.continentsRaw = null; // Expose for borders.js

const CONTINENTS = [
  { name: "North America", lat: 45, lng: -105 },
  { name: "South America", lat: -15, lng: -60 },
  { name: "Europe", lat: 52, lng: 15 },
  { name: "Africa", lat: 5, lng: 20 },
  { name: "Asia", lat: 40, lng: 90 },
  { name: "Oceania", lat: -22, lng: 140 },
  { name: "Antarctica", lat: -78, lng: 0 }
];

function renderContinentLabels() {
  const z = window.map.getZoom();
  continentLabels.clearLayers();

  if (z > 2) return; // ✅ only when dezoomed

  // Scale font size based on zoom for smoother transition
  const baseSize = 28;
  const fontSize = Math.max(24, baseSize - (2 - z) * 2); // Scale from 24px at z=2 to 28px at z=0

  for (const c of CONTINENTS) {
    for (const shift of [-360, 0, 360]) {
      L.marker([c.lat, c.lng + shift], {
        pane: "continentLabelPane",
        interactive: false,
        icon: L.divIcon({
          className: "continent-label-wrap",
          html: `<span class="continent-label" style="font-size: ${fontSize}px;">${c.name}</span>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0]
        })
      }).addTo(continentLabels);
    }
  }
}

renderContinentLabels();

function renderContinentBorders() {
  if (!window.continentsRaw) return;

  const z = window.map.getZoom();
  continentBorders.clearLayers();

  // show at low zooms only (continents-level)
  if (z > 4) return;

  for (const shift of [-360, 0, 360]) {
    const shifted = shiftGeoJsonLng(window.continentsRaw, shift);

    // Shadow stroke (draw first)
    L.geoJSON(shifted, {
      pane: "continentBorderPane",
      interactive: false,
      style: () => ({
        color: "rgba(0,0,0,0.25)",
        weight: 6,           // thicker = shadow halo
        opacity: 1,
        lineCap: "round",
        lineJoin: "round"
      })
    }).addTo(continentBorders);

    // Main stroke (draw second)
    L.geoJSON(shifted, {
      pane: "continentBorderPane",
      interactive: false,
      style: () => ({
        color: "rgba(30,30,30,0.55)",
        weight: 2,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round"
      })
    }).addTo(continentBorders);
  }
}


