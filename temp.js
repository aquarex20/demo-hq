    // -------------------------
    // Map
    // -------------------------
    const map = L.map("map", {
        worldCopyJump: true
      }).setView([0, 0], 2);
  
      // ONE tile layer (you had it twice)
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        noWrap: false,
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(map);
  
      // -------------------------
      // Grid + temps (5° x 5° here)
      // -------------------------
      const dLat = 5, dLon = 5;
      const Nlat = 180 / dLat; // 36
      const Nlon = 360 / dLon; // 72
  
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
      // Build GeoJSON grid
      // -------------------------
      function cellFeature(i, j) {
        const lat0 = -90 + i * dLat;
        const lat1 = lat0 + dLat;
        const lon0 = -180 + j * dLon;
        const lon1 = lon0 + dLon;
  
        return {
          type: "Feature",
          properties: { i, j, temp: temps[i][j] },
          geometry: {
            type: "Polygon",
            coordinates: [[
              [lon0, lat0],
              [lon1, lat0],
              [lon1, lat1],
              [lon0, lat1],
              [lon0, lat0]
            ]]
          }
        };
      }
  
      const gridFeatures = [];
      for (let i = 0; i < Nlat; i++) {
        for (let j = 0; j < Nlon; j++) {
          gridFeatures.push(cellFeature(i, j));
        }
      }
      const gridGeoJson = { type: "FeatureCollection", features: gridFeatures };
  
      // Shift longitudes by +/-360 so the grid shows on wrapped worlds
      function shiftGeoJsonLng(fc, shiftDeg) {
        return {
          type: "FeatureCollection",
          features: fc.features.map(f => ({
            ...f,
            geometry: {
              ...f.geometry,
              coordinates: f.geometry.coordinates.map(ring =>
                ring.map(([lng, lat]) => [lng + shiftDeg, lat])
              )
            }
          }))
        };
      }
  
      // -------------------------
      // Draw 3 copies (left/center/right)
      // -------------------------
      const gridGroup = L.featureGroup().addTo(map);
      function refreshAllCellColors() {
        gridGroup.eachLayer((maybeGroup) => {
          // each copy is a GeoJSON LayerGroup
          if (maybeGroup && typeof maybeGroup.eachLayer === "function") {
            maybeGroup.eachLayer((layer) => {
              if (!layer?.feature?.properties) return;
      
              const { i, j } = layer.feature.properties;
              const t = temps[i][j];
      
              // optional: keep props synced
              layer.feature.properties.temp = t;
      
              if (typeof layer.setStyle === "function") {
                layer.setStyle({ fillColor: tempToColor(t) });
              }
            });
          }
        });
      }
      function addGridCopy(shiftDeg) {
        return L.geoJSON(shiftGeoJsonLng(gridGeoJson, shiftDeg), {
          style: (feature) => ({
            stroke: false,
            fillColor: tempToColor(feature.properties.temp),
            fillOpacity: 0.65
          }),
          onEachFeature: (feature, layer) => {
            //implementer un layer on hold click pour la fonction lasso. 
            layer.on("click", () => {
              const { i, j } = feature.properties;
              temps[i][j] += 1;
  
              // Update this feature's stored temp
              feature.properties.temp = temps[i][j];
  
              // Recolor this polygon
              layer.setStyle({ fillColor: tempToColor(feature.properties.temp) });
  
              layer.bindPopup(
                `Cell (${i}, ${j})<br>Temp: ${feature.properties.temp.toFixed(1)} °C`
              ).openPopup();
            });
          }
        }).addTo(gridGroup);
      }
  
      addGridCopy(-360);
      addGridCopy(0);
      addGridCopy(360);
  