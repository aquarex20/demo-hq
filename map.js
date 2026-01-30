// -------------------------
// Panes (z-order)
// -------------------------

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

// REMOVE this if you want hillshade visible:
// L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", ...).addTo(map);

map.createPane("terrainPane");
map.getPane("terrainPane").style.zIndex = 200;

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
// Borders (zoom-aware)
// -------------------------
function maxBorderRankForZoom(z) {
  if (z <= 2) return 0;
  if (z === 3) return 1;
  if (z === 4) return 2;
  if (z === 5) return 3;
  if (z === 6) return 5;
  return 10;
}

let bordersRaw = null;

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
      filter: (f) => Number(f.properties?.scalerank ?? 999) <= maxRank,
      style: () => ({
        color: "#111",
        weight: z >= 5 ? 1.2 : 0.8,
        opacity: 0.9
      })
    }).addTo(bordersGroup);
  }
}

// -------------------------
// Labels (dedup + zoom-aware)
// -------------------------
function maxLabelRankForZoom(z) {
  if (z <= 2) return 0;
  if (z === 3) return 1;
  if (z === 4) return 2;
  if (z === 5) return 3;
  return 10;
}

function dedupeBySovereign(fc) {
  const best = new Map(); // sr_sov_a3 -> feature
  for (const f of fc.features) {
    const p = f.properties || {};
    const key = p.sr_sov_a3 || p.sr_adm0_a3 || p.sr_su_a3;
    const name = p.sr_subunit;
    if (!key || !name) continue;

    const r = Number(p.scalerank ?? 999);
    const prev = best.get(key);
    if (!prev) best.set(key, f);
    else {
      const pr = Number(prev.properties?.scalerank ?? 999);
      if (r < pr) best.set(key, f);
    }
  }
  return { type: "FeatureCollection", features: [...best.values()] };
}

let labelsRaw = null;

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

  for (const shift of [-360, 0, 360]) {
    L.geoJSON(shiftGeoJsonLng(labelsRaw, shift), {
      pane: "labelPane",
      interactive: false,
      pointToLayer: (f, latlng) => {
        const p = f.properties || {};
        if (Number(p.scalerank ?? 999) > maxRank) return null;

        const name = p.sr_subunit;
        if (!name) return null;

        return L.marker(latlng, {
          pane: "labelPane",
          interactive: false,
          icon: L.divIcon({ className: "country-label", html: name, iconSize: null })
        });
      }
    }).addTo(labelsGroup);
  }
}

// -------------------------
// Coastline (loaded once)
// -------------------------
async function loadCoast() {
  const coast = await (await fetch("/data/ne_coastline.geojson")).json();
  coastGroup.clearLayers();

  for (const shift of [-360, 0, 360]) {
    L.geoJSON(shiftGeoJsonLng(coast, shift), {
      pane: "coastPane",
      interactive: false,
      style: () => ({ color: "#111", weight: 1.2, opacity: 0.9 })
    }).addTo(coastGroup);
  }
}

// ONE zoom handler
map.on("zoomend", () => {
  renderBorders();
  renderLabels();
});

// Kick off loads
loadBorders();
loadLabels();
loadCoast();
  
