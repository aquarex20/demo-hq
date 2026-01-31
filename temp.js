
// -------------------------
// Grid + temps (2° x 2°)
// -------------------------
const dLat = 2, dLon = 2;
const Nlat = 180 / dLat; // 90
const Nlon = 360 / dLon; // 180

// temps[i][j] where i=lat index (south->north), j=lon index (west->east)
const temps = Array.from({ length: Nlat }, (_, i) => {
  return Array.from({ length: Nlon }, (_, j) => {
    const latCenter = -90 + (i + 0.5) * dLat;
    const lonCenter = -180 + (j + 0.5) * dLon;

    const latTerm = 30 - 0.5 * Math.abs(latCenter);
    const latWeight = Math.cos((latCenter * Math.PI) / 180);
    const lonTerm = 8 * latWeight * Math.sin((2 * lonCenter * Math.PI) / 180);

    return latTerm + lonTerm;
  });
});

// -------------------------
// Color gradient helpers
// -------------------------
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}
function rgbToHex({ r, g, b }) {
  const toHex = (v) => v.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const stops = [
  { t: -30, c: "#2b83ba" },
  { t:   0, c: "#abdda4" },
  { t:  15, c: "#ffffbf" },
  { t:  30, c: "#fdae61" },
  { t:  45, c: "#d7191c" }
];

function tempToColor(tempC) {
  const tMin = stops[0].t;
  const tMax = stops[stops.length - 1].t;
  const t = clamp(tempC, tMin, tMax);

  let k = 0;
  while (k < stops.length - 2 && t > stops[k + 1].t) k++;

  const a = stops[k], b = stops[k + 1];
  const u = (t - a.t) / (b.t - a.t);

  const A = hexToRgb(a.c), B = hexToRgb(b.c);
  return rgbToHex({
    r: Math.round(lerp(A.r, B.r, u)),
    g: Math.round(lerp(A.g, B.g, u)),
    b: Math.round(lerp(A.b, B.b, u))
  });
}

// -------------------------
// Temps pane (under borders/labels)
// -------------------------
map.createPane("tempsPane");
map.getPane("tempsPane").style.zIndex = 400;

// -------------------------
// Canvas tile layer (draw only visible area)
// -------------------------
function wrapLng(lng) {
  // wrap to [-180, 180)
  return ((lng + 180) % 360 + 360) % 360 - 180;
}

function lonToJ(lon) {
  lon = wrapLng(lon);
  return Math.floor((lon + 180) / dLon);
}
function latToI(lat) {
  return Math.floor((lat + 90) / dLat);
}

const TempLayer = L.GridLayer.extend({
  createTile: function (coords) {
    const tile = L.DomUtil.create("canvas", "leaflet-tile");
    const size = this.getTileSize();
    tile.width = size.x;
    tile.height = size.y;

    const ctx = tile.getContext("2d");
    ctx.globalAlpha = 0.70; // opacity

    // Tile bounds in lat/lng
    const nw = this._map.unproject([coords.x * size.x, coords.y * size.y], coords.z);
    const se = this._map.unproject([(coords.x + 1) * size.x, (coords.y + 1) * size.y], coords.z);

    const latMax = nw.lat;
    const latMin = se.lat;
    const lonMin = nw.lng;
    const lonMax = se.lng;

    // Determine i/j ranges intersecting this tile
    const i0 = clamp(latToI(latMin), 0, Nlat - 1);
    const i1 = clamp(latToI(latMax), 0, Nlat - 1);

    // lon can exceed [-180,180] because of world wrap; handle via wrapping j per cell
    // We'll iterate j by longitude steps between lonMin..lonMax in grid space
    // Compute j range in "unwrapped" longitudes, then wrap inside loop.
    const jStart = Math.floor((lonMin + 180) / dLon);
    const jEnd   = Math.floor((lonMax + 180) / dLon);

    // Iterate cells intersecting the tile
    for (let i = i0; i <= i1; i++) {
      const cellLat0 = -90 + i * dLat;
      const cellLat1 = cellLat0 + dLat;

      // convert lat bounds to pixel y in tile
      const pLat0 = this._map.project([cellLat0, 0], coords.z).y - coords.y * size.y;
      const pLat1 = this._map.project([cellLat1, 0], coords.z).y - coords.y * size.y;

      const y0 = Math.min(pLat0, pLat1);
      const y1 = Math.max(pLat0, pLat1);

      for (let ju = jStart; ju <= jEnd; ju++) {
        const lon0u = -180 + ju * dLon;
        const lon1u = lon0u + dLon;

        const j = ((ju % Nlon) + Nlon) % Nlon; // wrap index
        const t = temps[i][j];
        ctx.fillStyle = tempToColor(t);

        const pLon0 = this._map.project([0, lon0u], coords.z).x - coords.x * size.x;
        const pLon1 = this._map.project([0, lon1u], coords.z).x - coords.x * size.x;

        const x0 = Math.min(pLon0, pLon1);
        const x1 = Math.max(pLon0, pLon1);

        // draw
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }

    return tile;
  }
});

const tempLayer = new TempLayer({
  pane: "tempsPane",
  noWrap: false,
  updateWhenIdle: true,
  updateWhenZooming: false
}).addTo(map);

// call this after you change temps[][]
function refreshTemps() { tempLayer.redraw(); }

// expose to other files (draw.js)
window.temps = temps;
window.dLat = dLat;
window.dLon = dLon;
window.Nlat = Nlat;
window.Nlon = Nlon;
window.refreshTemps = refreshTemps;
window.tempToColor = tempToColor;
window.tempLayer = tempLayer;

