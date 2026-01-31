if (!window.map) throw new Error("Map not initialized yet");

// -----------------------
// Existing Leaflet.draw (you can keep it)
// -----------------------
const drawnItems = new L.FeatureGroup();
window.map.addLayer(drawnItems);

// -----------------------
// Selection helpers
// -----------------------
function pointInPolygon(point, vs) {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function getSelectedCells(polygonLatLngs) {
  const poly = polygonLatLngs.map(p => [p.lng, p.lat]); // [lng, lat]
  const selected = [];
  for (let i = 0; i < Nlat; i++) {
    for (let j = 0; j < Nlon; j++) {
      const latCenter = -90 + (i + 0.5) * dLat;
      const lonCenter = -180 + (j + 0.5) * dLon;
      if (pointInPolygon([lonCenter, latCenter], poly)) selected.push({ i, j });
    }
  }
  return selected;
}

let lassoOn = false;
let lassoPoints = [];
let lassoLayer = null;
let drawing = false;

// throttle so you don't freeze the browser
let lastAdd = 0;
const ADD_EVERY_MS = 16; // ~60fps
const MIN_DIST_PX = 3;   // ignore tiny jitter

const freehandBtn = document.getElementById("freehandBtn");
const polygonBtn = document.getElementById("polygonBtn");

function clearToolsUI() {
    freehandBtn.classList.remove("active");
    polygonBtn.classList.remove("active");
  }
  
function setLasso(on) {
  lassoOn = on;

  if (!on) {
    // cleanup any in-progress drawing
    drawing = false;
    lassoPoints = [];
    if (lassoLayer) {
      window.map.removeLayer(lassoLayer);
      lassoLayer = null;
    }
    window.map.dragging.enable();
  }

}

function disablePolygonMode() {
    window.map.pm.disableDraw();
    window.map.pm.disableEdit();
    window.map.pm.disableRemove();
  }
  
freehandBtn.addEventListener("click", () => {
  if (freehandBtn.classList.contains("active")) {
    clearToolsUI();
    freehandBtn.classList.remove("active");
    setLasso(false);
    return;
  }
  clearToolsUI();
  freehandBtn.classList.add("active");
  setLasso(true);
  disablePolygonMode();
});


function addPoint(latlng) {
  // avoid adding points that are too close in screen space
  if (lassoPoints.length) {
    const prev = lassoPoints[lassoPoints.length - 1];
    const a = window.map.latLngToContainerPoint(prev);
    const b = window.map.latLngToContainerPoint(latlng);
    if (a.distanceTo(b) < MIN_DIST_PX) return;
  }
  lassoPoints.push(latlng);

  if (!lassoLayer) {
    lassoLayer = L.polygon(lassoPoints, {
      stroke: true,
      weight: 2,
      color: "#111",
      fill: true,
      fillOpacity: 0.12
    }).addTo(window.map);
  } else {
    lassoLayer.setLatLngs(lassoPoints);
  }
}

// Start drawing on map mousedown
window.map.on("mousedown", (e) => {
  if (!lassoOn) return;
  drawing = true;
  lassoPoints = [];
  lastAdd = 0;

  // stop the map from panning while drawing
  window.map.dragging.disable();

  // start with the first point
  addPoint(e.latlng);
});

// Collect points while moving
window.map.on("mousemove", (e) => {
  if (!lassoOn || !drawing) return;

  const now = performance.now();
  if (now - lastAdd < ADD_EVERY_MS) return;
  lastAdd = now;

  addPoint(e.latlng);
});

// Finish on mouseup
window.map.on("mouseup", () => {
  if (!lassoOn || !drawing) return;
  drawing = false;

  if (!lassoPoints || lassoPoints.length < 3) {
    window.map.dragging.enable();
    return;
  }

  // Optional: simplify the lasso to reduce points (prevents freezing later)
  // Leaflet expects array of Points for simplify
  const pts = lassoPoints.map(ll => window.map.latLngToLayerPoint(ll));
  const simplified = L.LineUtil.simplify(pts, 2); // tolerance in pixels
  lassoPoints = simplified.map(p => window.map.layerPointToLatLng(p));

  // Update the displayed layer with simplified points and close it nicely
  if (lassoLayer) lassoLayer.setLatLngs(lassoPoints);

  // Select grid cells inside lasso
  selectedCells = getSelectedCells(lassoPoints);

  panel.style.display = "block";
  cellsLabel.textContent = `${selectedCells.length} cell${selectedCells.length !== 1 ? 's' : ''} selected`;

  // re-enable map panning after finishing
  window.map.dragging.enable();
});

// Safety: if mouse leaves window while drawing
window.addEventListener("mouseup", () => {
  if (lassoOn && drawing) window.map.fire("mouseup");
});

// -----------------------
// Slider UI
// -----------------------
let selectedCells = [];

const panel = document.getElementById("tempPanel");
const slider = document.getElementById("tempSlider");
const deltaLabel = document.getElementById("tempDelta");
const applyBtn = document.getElementById("applyTemp");
const cellsLabel = document.getElementById("tempPanelCells");

slider.addEventListener("input", () => {
  const value = parseFloat(slider.value);
  deltaLabel.textContent = value > 0 ? `+${value}` : value;
  
  // Color coding for positive/negative values
  deltaLabel.classList.remove("positive", "negative");
  if (value > 0) {
    deltaLabel.classList.add("positive");
  } else if (value < 0) {
    deltaLabel.classList.add("negative");
  }
});

applyBtn.addEventListener("click", () => {
    const dT = parseFloat(slider.value);

    for (const { i, j } of selectedCells) temps[i][j] += dT;

    slider.value = "0";
    deltaLabel.textContent = "0";
    deltaLabel.classList.remove("positive", "negative");

    window.refreshTemps();
});

// -----------------------
// Polygon integration
// -----------------------
// Start polygon on click
function enablePolygonMode() {
  // Disable map drag while drawing so it doesn't pan
  window.map.dragging.disable();

  window.map.pm.enableDraw("Polygon", {
    snappable: false,
    // THIS enables freehand drawing in Geoman
    freehand: true,
    freehandOptions: { smoothFactor: 0.3 },
    pathOptions: { fillOpacity: 0.2 }
  });
}

polygonBtn.addEventListener("click", () => {
  if (polygonBtn.classList.contains("active")) {
    clearToolsUI();
    polygonBtn.classList.remove("active");
    disablePolygonMode();
    return;
  }
  clearToolsUI();
  polygonBtn.classList.add("active");
  setLasso(false);
  enablePolygonMode();
});

// Re-enable dragging when drawing ends
window.map.on("pm:drawend", () => {
  window.map.dragging.enable();
});

// When the lasso is finished
window.map.on("pm:create", (e) => {

  if (e.shape !== "Polygon") return;

  const poly = e.layer.getLatLngs()[0];
  selectedCells = getSelectedCells(poly);

  panel.style.display = "block";
  cellsLabel.textContent = `${selectedCells.length} cell${selectedCells.length !== 1 ? 's' : ''} selected`;
});

