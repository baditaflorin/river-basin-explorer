import { loadRiverGeometry, loadWaterwaysInBounds, searchRivers } from "./api/overpass.js";
import { clampAttempts, sleep } from "./api/retry.js";
import { classifyBasin } from "./geo/classifier.js";
import {
  boundsForWaterways,
  collectionLengthKm,
  expandBounds,
  inferFlowEndpoints,
  km,
  meters,
  splitBounds
} from "./geo/geometry.js";
import { clearRiver, createMap, drawBasin, drawMainRiver, setLayerVisible } from "./ui/map.js";

const state = {
  candidates: [],
  selected: null,
  mainWaterways: [],
  classification: null
};

const els = {
  form: document.getElementById("riverSearchForm"),
  search: document.getElementById("riverSearch"),
  candidateList: document.getElementById("candidateList"),
  candidateStatus: document.getElementById("candidateStatus"),
  selectedStatus: document.getElementById("selectedStatus"),
  riverSummary: document.getElementById("riverSummary"),
  basinSummary: document.getElementById("basinSummary"),
  loadBasin: document.getElementById("loadBasin"),
  basinStatus: document.getElementById("basinStatus"),
  mapStatus: document.getElementById("mapStatus"),
  retryStatus: document.getElementById("retryStatus"),
  networkStatus: document.getElementById("networkStatus"),
  retryAttempts: document.getElementById("retryAttempts"),
  outletTolerance: document.getElementById("outletTolerance"),
  upstreamOrder: document.getElementById("upstreamOrder"),
  basinPadding: document.getElementById("basinPadding")
};

createMap();
wireEvents();
renderIcons();

function wireEvents() {
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    runSearch();
  });

  document.querySelectorAll("[data-example]").forEach((button) => {
    button.addEventListener("click", () => {
      els.search.value = button.dataset.example;
      runSearch();
    });
  });

  els.candidateList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-candidate-index]");
    if (!button) return;
    selectCandidate(Number(button.dataset.candidateIndex));
  });

  els.loadBasin.addEventListener("click", () => loadBasinShapes());

  document.querySelectorAll("[data-layer]").forEach((input) => {
    input.addEventListener("change", () => setLayerVisible(input.dataset.layer, input.checked));
  });
}

async function runSearch() {
  const name = els.search.value.trim();
  if (!name) return;

  clearRiver();
  state.candidates = [];
  state.selected = null;
  state.mainWaterways = [];
  state.classification = null;
  els.loadBasin.disabled = true;
  setStatus("Searching");
  els.candidateStatus.textContent = "searching";
  els.candidateList.innerHTML = emptyRow("Searching OpenStreetMap river records and waterway relations...");

  try {
    const candidates = await searchRivers(name, {
      attempts: retryAttempts(),
      onAttempt: updateRetryStatus
    });

    state.candidates = candidates;
    renderCandidates(candidates);
    setStatus("Ready");
  } catch (error) {
    setStatus("Search failed", true);
    els.candidateStatus.textContent = "failed";
    els.candidateList.innerHTML = emptyRow(error.message);
  }
}

function renderCandidates(candidates) {
  els.candidateStatus.textContent = `${candidates.length} matches`;
  if (!candidates.length) {
    els.candidateList.innerHTML = emptyRow("No matching OSM river relations or ways found.");
    return;
  }

  els.candidateList.innerHTML = candidates
    .map((candidate, index) => {
      const detail = [
        candidate.osmType,
        candidate.wikidata || "no wikidata",
        candidate.wikipedia || candidate.localName
      ]
        .filter(Boolean)
        .join(" · ");
      return `
        <article class="candidate-row">
          <span>
            <strong>${escapeHtml(candidate.name)}</strong>
            <small>${escapeHtml(detail)}</small>
          </span>
          <button type="button" data-candidate-index="${index}" title="Load ${escapeHtml(candidate.name)}">
            <i data-lucide="map-pin" aria-hidden="true"></i>
          </button>
        </article>
      `;
    })
    .join("");
  renderIcons();
}

async function selectCandidate(index) {
  const candidate = state.candidates[index];
  if (!candidate) return;

  setStatus("Loading river");
  els.selectedStatus.textContent = "loading";
  els.mapStatus.textContent = `Loading ${candidate.name}`;
  els.loadBasin.disabled = true;

  try {
    const waterways = await loadRiverGeometry(candidate, {
      attempts: retryAttempts(),
      onAttempt: updateRetryStatus
    });

    state.selected = candidate;
    state.mainWaterways = waterways;
    state.classification = null;
    const endpoints = drawMainRiver(waterways, candidate.name);
    renderRiverSummary(candidate, waterways, endpoints);
    els.loadBasin.disabled = false;
    els.selectedStatus.textContent = candidate.name;
    els.mapStatus.textContent = `${candidate.name}: ${waterways.length} OSM segments`;
    setStatus("River loaded");
  } catch (error) {
    setStatus("Load failed", true);
    els.selectedStatus.textContent = "failed";
    els.mapStatus.textContent = error.message;
  }
}

async function loadBasinShapes() {
  if (!state.mainWaterways.length) return;

  const padding = Number.parseFloat(els.basinPadding.value);
  const bounds = expandBounds(boundsForWaterways(state.mainWaterways), padding);
  const tiles = splitBounds(bounds, 2);
  const allWaterways = new Map();

  setStatus("Loading basin");
  els.basinStatus.textContent = `${tiles.length} tiles`;
  els.loadBasin.disabled = true;

  try {
    for (const [index, tile] of tiles.entries()) {
      els.basinStatus.textContent = `tile ${index + 1}/${tiles.length}`;
      els.mapStatus.textContent = `Loading waterway tile ${index + 1}/${tiles.length}`;
      const waterways = await loadWaterwaysInBounds(tile, {
        attempts: retryAttempts(),
        onAttempt: updateRetryStatus
      });
      waterways.forEach((waterway) => allWaterways.set(waterway.id, waterway));
      if (index < tiles.length - 1) await sleep(700);
    }

    const classification = classifyBasin(Array.from(allWaterways.values()), state.mainWaterways, {
      toleranceM: Number.parseInt(els.outletTolerance.value, 10),
      maxOrder: Number.parseInt(els.upstreamOrder.value, 10)
    });

    state.classification = classification;
    drawBasin(classification);
    renderBasinSummary(classification, allWaterways.size);
    setStatus("Basin loaded");
    els.mapStatus.textContent = `${classification.stats.waterwayCount} basin waterways classified`;
  } catch (error) {
    setStatus("Basin failed", true);
    els.mapStatus.textContent = error.message;
  } finally {
    els.loadBasin.disabled = false;
  }
}

function renderRiverSummary(candidate, waterways, endpoints) {
  const length = collectionLengthKm(waterways);
  els.riverSummary.innerHTML = `
    <span><strong>${waterways.length.toLocaleString("en-US")}</strong> main segments</span>
    <span><strong>${km(length)}</strong> mapped length</span>
    <span><strong>${formatPoint(endpoints.source)}</strong> source candidate</span>
    <span><strong>${formatPoint(endpoints.mouth)}</strong> mouth candidate</span>
  `;
}

function renderBasinSummary(classification, loadedCount) {
  const stats = classification.stats;
  els.basinStatus.textContent = "classified";
  els.basinSummary.innerHTML = `
    <span><strong>${stats.directCount.toLocaleString("en-US")}</strong> direct tributaries</span>
    <span><strong>${stats.descendantCount.toLocaleString("en-US")}</strong> descendants</span>
    <span><strong>${loadedCount.toLocaleString("en-US")}</strong> loaded shapes</span>
    <span><strong>${km(stats.totalKm)}</strong> mapped basin length</span>
  `;
}

function updateRetryStatus(info) {
  if (info.phase === "try") {
    els.retryStatus.textContent = `Attempt ${info.attempt}/${info.attempts}`;
    return;
  }

  els.retryStatus.textContent = `Backoff ${Math.round(info.delayMs / 1000)}s after attempt ${info.attempt}`;
}

function retryAttempts() {
  return clampAttempts(els.retryAttempts.value);
}

function setStatus(message, warn = false) {
  els.networkStatus.textContent = message;
  els.networkStatus.classList.toggle("is-warn", warn);
}

function formatPoint(point) {
  if (!point) return "n/a";
  return `${point[0].toFixed(3)}, ${point[1].toFixed(3)}`;
}

function emptyRow(message) {
  return `
    <article class="candidate-row is-empty">
      <span>
        <strong>${escapeHtml(message)}</strong>
      </span>
    </article>
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

function renderIcons() {
  if (window.lucide) window.lucide.createIcons();
}
