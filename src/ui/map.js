import { COLORS } from "../config.js";
import { boundsForWaterways, collectionLengthKm, inferFlowEndpoints, km } from "../geo/geometry.js";

let map;
let layers;

export function createMap() {
  map = L.map("map", {
    zoomControl: false,
    preferCanvas: true
  }).setView([45.8, 24.8], 6);

  L.control.zoom({ position: "topright" }).addTo(map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
  }).addTo(map);

  layers = {
    main: L.layerGroup().addTo(map),
    direct: L.layerGroup().addTo(map),
    descendant: L.layerGroup().addTo(map),
    points: L.layerGroup().addTo(map)
  };

  return { map, layers };
}

export function setLayerVisible(name, visible) {
  if (!layers?.[name]) return;
  if (visible) {
    layers[name].addTo(map);
  } else {
    map.removeLayer(layers[name]);
  }
}

export function clearRiver() {
  Object.values(layers).forEach((layer) => layer.clearLayers());
}

export function drawMainRiver(waterways, riverName) {
  layers.main.clearLayers();
  layers.points.clearLayers();

  waterways.forEach((waterway) => {
    L.polyline(waterway.points, {
      color: COLORS.main,
      weight: 6,
      opacity: 0.9,
      lineCap: "round",
      lineJoin: "round"
    })
      .bindPopup(popup(riverName, `${km(collectionLengthKm(waterways))} mapped main geometry`))
      .addTo(layers.main);
  });

  const endpoints = inferFlowEndpoints(waterways);
  addEndpoint(endpoints.source, "Source candidate");
  addEndpoint(endpoints.mouth, "Mouth candidate");

  const bounds = boundsForWaterways(waterways);
  map.fitBounds([
    [bounds.south, bounds.west],
    [bounds.north, bounds.east]
  ], { padding: [28, 28] });

  return endpoints;
}

export function drawBasin(classification) {
  layers.direct.clearLayers();
  layers.descendant.clearLayers();
  drawWaterways(classification.direct, layers.direct, COLORS.direct, 3.2, "Direct tributary");
  drawWaterways(classification.descendants, layers.descendant, COLORS.descendant, 2.1, "Upstream descendant");
}

function drawWaterways(waterways, layer, color, weight, label) {
  waterways.forEach((waterway) => {
    L.polyline(waterway.points, {
      color,
      weight,
      opacity: 0.72,
      lineCap: "round",
      lineJoin: "round"
    })
      .bindPopup(popup(waterway.name, `${label} · ${waterway.waterway} · ${km(collectionLengthKm([waterway]))}`))
      .addTo(layer);
  });
}

function addEndpoint(coords, label) {
  L.circleMarker(coords, {
    radius: 7,
    color: "#ffffff",
    weight: 2,
    fillColor: COLORS.endpoint,
    fillOpacity: 0.92
  })
    .bindPopup(popup(label, `${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}`))
    .addTo(layers.points);
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

