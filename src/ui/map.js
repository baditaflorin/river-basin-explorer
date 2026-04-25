import { BASEMAPS } from "../config.js";
import { boundsForWaterways, collectionLengthKm, inferFlowEndpoints, km, lineLengthKm } from "../geo/geometry.js";

let map;
let basemapLayer = null;
let currentBasemap = "standard";
let layers;
const riverLayers = new Map();

export function createMap(initialBasemap = "standard") {
  map = L.map("map", {
    zoomControl: false,
    preferCanvas: true
  }).setView([45.8, 24.8], 6);

  L.control.zoom({ position: "topright" }).addTo(map);

  layers = {
    main: L.layerGroup().addTo(map),
    direct: L.layerGroup().addTo(map),
    descendant: L.layerGroup().addTo(map),
    points: L.layerGroup().addTo(map)
  };

  setBasemap(initialBasemap);
  return { map, layers };
}

export function setBasemap(name) {
  const next = BASEMAPS[name] || BASEMAPS.standard;
  currentBasemap = name in BASEMAPS ? name : "standard";

  if (basemapLayer) {
    map.removeLayer(basemapLayer);
    basemapLayer = null;
  }

  map.getContainer().style.background = next.background;

  if (next.url) {
    basemapLayer = L.tileLayer(next.url, next.options).addTo(map);
  }
}

export function setLayerVisible(name, visible) {
  if (!layers?.[name]) return;
  if (visible) {
    layers[name].addTo(map);
  } else {
    map.removeLayer(layers[name]);
  }
}

export function renderRiver(river) {
  const entry = ensureRiverLayers(river.ref);
  clearEntry(entry);

  drawMainRiver(entry, river);
  if (river.classification) drawBasin(entry, river);
}

export function removeRiver(ref) {
  const entry = riverLayers.get(ref);
  if (!entry) return;

  Object.values(entry).forEach((group) => {
    group.clearLayers();
    Object.values(layers).forEach((roleGroup) => roleGroup.removeLayer(group));
  });

  riverLayers.delete(ref);
}

export function clearRiver() {
  Array.from(riverLayers.keys()).forEach((ref) => removeRiver(ref));
}

export function fitToRiver(river) {
  const waterways = collectRiverWaterways(river);
  if (!waterways.length) return;

  const bounds = boundsForWaterways(waterways);
  map.fitBounds(
    [
      [bounds.south, bounds.west],
      [bounds.north, bounds.east]
    ],
    { padding: [30, 30] }
  );
}

export function currentBasemapId() {
  return currentBasemap;
}

export function highlightProfileSample(river, sample) {
  if (!sample?.point) return;

  riverLayers.forEach((entry) => entry.focus?.clearLayers());
  const entry = ensureRiverLayers(river.ref);
  const elevation = Number.isFinite(sample.elevationM) ? `${Math.round(sample.elevationM).toLocaleString("en-US")} m` : "n/a";
  const marker = L.circleMarker(sample.point, {
    radius: 8,
    color: "#f8fbff",
    weight: 2,
    fillColor: river.palette.endpoint,
    fillOpacity: 1
  })
    .bindPopup(
      popup(
        `${river.candidate.name} ${Math.round(sample.fraction * 100)}% sample`,
        `${elevation} · ${Math.round(sample.distanceKm).toLocaleString("en-US")} km from source`
      )
    )
    .addTo(entry.focus);

  marker.openPopup();
  map.flyTo(sample.point, Math.max(map.getZoom(), 8), {
    animate: true,
    duration: 0.8
  });
}

function ensureRiverLayers(ref) {
  if (!riverLayers.has(ref)) {
      riverLayers.set(ref, {
        main: L.featureGroup().addTo(layers.main),
        direct: L.featureGroup().addTo(layers.direct),
        descendant: L.featureGroup().addTo(layers.descendant),
        points: L.featureGroup().addTo(layers.points),
        focus: L.featureGroup().addTo(layers.points)
      });
  }

  return riverLayers.get(ref);
}

function clearEntry(entry) {
  Object.values(entry).forEach((group) => group.clearLayers());
}

function drawMainRiver(entry, river) {
  const endpoints = river.endpoints || inferFlowEndpoints(river.mainWaterways);
  const mainLength = km(river.mainLengthKm || lineLengthKm(river.mainPath || []) || collectionLengthKm(river.mainWaterways));

  river.mainWaterways.forEach((waterway) => {
    L.polyline(waterway.points, {
      color: river.palette.main,
      weight: 6,
      opacity: 0.94,
      lineCap: "round",
      lineJoin: "round"
    })
      .bindPopup(popup(river.candidate.name, `${mainLength} mapped main geometry`))
      .addTo(entry.main);
  });

  addEndpoint(entry.points, endpoints.source, "Source candidate", river.palette.endpoint);
  addEndpoint(entry.points, endpoints.mouth, "Mouth candidate", river.palette.endpoint);
}

function drawBasin(entry, river) {
  drawWaterways(entry.direct, river.classification.direct, river.palette.direct, 3.2, "Direct tributary");
  drawWaterways(entry.descendant, river.classification.descendants, river.palette.descendant, 2.3, "Upstream descendant");
}

function drawWaterways(group, waterways, color, weight, label) {
  waterways.forEach((waterway) => {
    L.polyline(waterway.points, {
      color,
      weight,
      opacity: 0.74,
      lineCap: "round",
      lineJoin: "round"
    })
      .bindPopup(popup(waterway.name, `${label} · ${waterway.waterway} · ${km(collectionLengthKm([waterway]))}`))
      .addTo(group);
  });
}

function addEndpoint(group, coords, label, fillColor) {
  if (!coords) return;

  L.circleMarker(coords, {
    radius: 7,
    color: "#f6fbff",
    weight: 2,
    fillColor,
    fillOpacity: 0.96
  })
    .bindPopup(popup(label, `${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}`))
    .addTo(group);
}

function collectRiverWaterways(river) {
  const waterways = [...(river.mainWaterways || [])];
  if (river.classification) waterways.push(...river.classification.direct, ...river.classification.descendants);
  return waterways;
}

function popup(title, body) {
  return `
    <p class="popup-title">${escapeHtml(title)}</p>
    <p class="popup-meta">${escapeHtml(body)}</p>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
