if (!window.map) throw new Error("Map not initialized yet");

const continentBorders = L.featureGroup().addTo(window.map);
const continentGroup = L.featureGroup().addTo(window.map);
const countryLowGroup = L.featureGroup().addTo(window.map);
const countryHighGroup = L.featureGroup().addTo(window.map);

// Groups
const bordersGroup = L.featureGroup().addTo(window.map);

let borders50mRaw, borders10mRaw;

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

  const z = window.map.getZoom();
  const maxRank = maxBorderRankForZoom(z);

  bordersGroup.clearLayers();

  for (const shift of [-360, 0, 360]) {
    L.geoJSON(window.shiftGeoJsonLng(bordersRaw, shift), {
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

function updateBordersByZoom() {
    const z = window.map.getZoom();
  
    continentGroup.clearLayers();
    countryLowGroup.clearLayers();
    countryHighGroup.clearLayers();
  
    if (z <= 2) {
      drawContinents();
    } else if (z <= 5) {
      drawCountryBordersLow();
    } else {
      drawCountryBordersHigh();
    }
  }
  
  window.map.on("zoomend", updateBordersByZoom);
  
  function drawContinents() {
    if (!window.continentsRaw) return;
    L.geoJSON(window.continentsRaw, {
      pane: "borderPane",
      style: {
        color: "#555",
        weight: 0.8,
        opacity: 0.8
      }
    }).addTo(continentGroup);
  }
  function drawCountryBordersLow() {
    // TODO: implement low detail borders
    if (borders110mRaw) {
        L.geoJSON(borders110mRaw, {
          pane: "borderPane",
          style: {
            color: "#666",
            weight: 1.0,
            opacity: 0.85,
            lineCap: "round",
            lineJoin: "round"
          }
        }).addTo(countryLowGroup);
      }
else {
    if (borders50mRaw) {
      L.geoJSON(borders50mRaw, {
        pane: "borderPane",
        style: {
          color: "#666",
          weight: 1.0,
          opacity: 0.85,
          lineCap: "round",
          lineJoin: "round"
        }
      }).addTo(countryLowGroup);
    }
}
  }
  function drawCountryBordersHigh() {
    if (borders10mRaw) {
      L.geoJSON(borders10mRaw, {
        pane: "borderPane",
        style: {
          color: "#666",
          weight: 1.3,
          opacity: 0.9,
          lineCap: "round",
          lineJoin: "round"
        }
      }).addTo(countryHighGroup);
    }
  }

// Also update during zoom for smoother rendering

// kick off
loadBorders();
  