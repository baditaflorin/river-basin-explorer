import { readCachedJson, writeCachedJson, clearCachedData, supportsDataCache } from "./api/data-cache.js";
import { loadElevationProfile } from "./api/elevation.js";
import {
  candidateRef,
  loadRiverGeometry,
  loadWaterwaysInBounds,
  searchRivers
} from "./api/overpass.js";
import { findSampleEntry, loadSampleBundle, loadSampleManifest } from "./api/sample-data.js";
import { clampAttempts, sleep } from "./api/retry.js";
import { BASEMAPS, DEFAULT_SETTINGS } from "./config.js";
import { classifyBasin } from "./geo/classifier.js";
import {
  boundsForWaterways,
  collectionLengthKm,
  expandBounds,
  inferFlowEndpoints,
  km,
  lineLengthKm,
  mergeWaterwaysIntoPath,
  samplePointsAlongPath,
  splitBounds
} from "./geo/geometry.js";
import {
  clearSavedPreferences,
  defaultPaletteForRiver,
  deleteRiverPalette,
  loadSavedPalettes,
  loadSettings,
  saveRiverPalette,
  saveSettings
} from "./preferences.js";
import {
  clearRiver,
  createMap,
  fitToRiver,
  highlightProfileSample,
  removeRiver,
  renderRiver,
  setBasemap,
  setLayerVisible
} from "./ui/map.js";

const state = {
  candidates: [],
  rivers: new Map(),
  riverOrder: [],
  focusRiverRef: null,
  sampleManifest: { samples: [] },
  settings: loadSettings(),
  savedPalettes: loadSavedPalettes()
};

const els = {
  form: document.getElementById("riverSearchForm"),
  search: document.getElementById("riverSearch"),
  sampleList: document.getElementById("sampleList"),
  sampleStatus: document.getElementById("sampleStatus"),
  candidateList: document.getElementById("candidateList"),
  candidateStatus: document.getElementById("candidateStatus"),
  activeRiverList: document.getElementById("activeRiverList"),
  activeStatus: document.getElementById("activeStatus"),
  selectedStatus: document.getElementById("selectedStatus"),
  riverSummary: document.getElementById("riverSummary"),
  elevationStatus: document.getElementById("elevationStatus"),
  elevationSummary: document.getElementById("elevationSummary"),
  elevationProfile: document.getElementById("elevationProfile"),
  basinSummary: document.getElementById("basinSummary"),
  basinStatus: document.getElementById("basinStatus"),
  loadBasin: document.getElementById("loadBasin"),
  refreshBasin: document.getElementById("refreshBasin"),
  mapStatus: document.getElementById("mapStatus"),
  retryStatus: document.getElementById("retryStatus"),
  networkStatus: document.getElementById("networkStatus"),
  appearanceStatus: document.getElementById("appearanceStatus"),
  retryAttempts: document.getElementById("retryAttempts"),
  outletTolerance: document.getElementById("outletTolerance"),
  upstreamOrder: document.getElementById("upstreamOrder"),
  basinPadding: document.getElementById("basinPadding"),
  preferSampleCache: document.getElementById("preferSampleCache"),
  preferLocalCache: document.getElementById("preferLocalCache"),
  basemapSelect: document.getElementById("basemapSelect"),
  shareUrl: document.getElementById("shareUrl"),
  copyLink: document.getElementById("copyLink"),
  clearCache: document.getElementById("clearCache"),
  resetSettings: document.getElementById("resetSettings")
};

createMap(state.settings.basemap);
populateBasemapOptions();
applySettingsToInputs(state.settings);
applyMapSettings();
wireEvents();
renderCandidates([]);
renderSampleList();
renderActiveRivers();
renderFocusedRiver();
renderIcons();
void boot();

async function boot() {
  state.sampleManifest = await loadSampleManifest();
  renderSampleList();

  const urlState = parseUrlState();
  applyUrlOverrides(urlState);
  renderShareUrl();

  if (!urlState.rivers.length) return;

  for (const ref of urlState.rivers) {
    if (urlState.basins.includes(ref) && urlState.sample) {
      const entry = findSampleEntry(state.sampleManifest, ref, currentBasinOptions());
      if (entry) {
        await loadSampleEntry(entry, { fit: false });
        continue;
      }
    }

    await addRiverByRef(ref, { fit: false });
  }

  for (const ref of urlState.basins) {
    if (!state.rivers.has(ref)) continue;
    setFocusRiver(ref, { fit: false });
    const river = state.rivers.get(ref);
    if (!river.classification) {
      await loadFocusedBasin({ forceLive: !urlState.sample, fit: false });
    }
  }

  if (urlState.focus && state.rivers.has(urlState.focus)) {
    setFocusRiver(urlState.focus, { fit: false });
  }

  const focused = focusedRiver();
  if (focused) fitToRiver(focused);
  renderShareUrl();
}

function wireEvents() {
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void runSearch();
  });

  document.querySelectorAll("[data-example]").forEach((button) => {
    button.addEventListener("click", () => {
      els.search.value = button.dataset.example;
      void runSearch();
    });
  });

  els.sampleList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sample-index]");
    if (!button) return;
    const entry = state.sampleManifest.samples?.[Number(button.dataset.sampleIndex)];
    if (!entry) return;
    void loadSampleEntry(entry);
  });

  els.sampleList.addEventListener("toggle", (event) => {
    const details = event.target.closest("details.sample-continent");
    if (!details) return;
    const continent = details.dataset.continent;
    if (!continent) return;
    if (!state.sampleContinentOpen) state.sampleContinentOpen = new Map();
    state.sampleContinentOpen.set(continent, details.open);
  }, true);

  els.candidateList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-candidate-index]");
    if (!button) return;
    void addCandidate(Number(button.dataset.candidateIndex));
  });

  els.activeRiverList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-river-action]");
    if (!button) return;

    const ref = button.dataset.riverRef;
    if (!ref) return;

    switch (button.dataset.riverAction) {
      case "focus":
        setFocusRiver(ref);
        break;
      case "fit":
        if (state.rivers.has(ref)) fitToRiver(state.rivers.get(ref));
        break;
      case "sample": {
        const entry = findBestSampleForRef(ref);
        if (entry) void loadSampleEntry(entry);
        break;
      }
      case "remove":
        detachRiver(ref);
        break;
      case "reset-colors":
        resetRiverPalette(ref);
        break;
      default:
        break;
    }
  });

  els.activeRiverList.addEventListener("input", (event) => {
    const input = event.target.closest("[data-river-color]");
    if (!input) return;

    const ref = input.dataset.riverRef;
    const colorName = input.dataset.riverColor;
    const river = state.rivers.get(ref);
    if (!river || !colorName) return;

    river.palette = {
      ...river.palette,
      [colorName]: input.value
    };
    state.savedPalettes = saveRiverPalette(ref, river.palette);
    renderRiver(river);
    renderShareUrl();
  });

  els.elevationProfile.addEventListener("click", (event) => {
    const button = event.target.closest("[data-profile-index]");
    if (!button) return;
    focusElevationSample(button.dataset.riverRef, Number(button.dataset.profileIndex));
  });

  els.loadBasin.addEventListener("click", () => void loadFocusedBasin());
  els.refreshBasin.addEventListener("click", () => void loadFocusedBasin({ forceLive: true }));

  [els.retryAttempts, els.outletTolerance, els.upstreamOrder, els.basinPadding].forEach((input) => {
    input.addEventListener("change", () => {
      persistSettingsFromInputs();
      renderSampleList();
      renderShareUrl();
    });
  });

  [els.preferSampleCache, els.preferLocalCache].forEach((input) => {
    input.addEventListener("change", () => {
      persistSettingsFromInputs();
      renderShareUrl();
    });
  });

  els.basemapSelect.addEventListener("change", () => {
    persistSettingsFromInputs();
    setBasemap(els.basemapSelect.value);
    renderShareUrl();
  });

  document.querySelectorAll("[data-layer]").forEach((input) => {
    input.addEventListener("change", () => {
      setLayerVisible(input.dataset.layer, input.checked);
      persistSettingsFromInputs();
      renderShareUrl();
    });
  });

  els.copyLink.addEventListener("click", () => void copyShareUrl());
  els.clearCache.addEventListener("click", () => void clearLocalCache());
  els.resetSettings.addEventListener("click", () => resetSavedSettings());
}

async function runSearch(options = {}) {
  const name = els.search.value.trim();
  if (!name) return;

  state.candidates = [];
  els.candidateStatus.textContent = "searching";
  els.candidateList.innerHTML = emptyRow("Searching river records and cached candidates...");
  setStatus("Searching");

  try {
    const cacheKey = `search:${cacheSlug(name)}`;
    let candidates = null;

    if (!options.forceLive && state.settings.preferLocalCache) {
      candidates = await readCachedJson(cacheKey, { maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
    }

    if (!candidates) {
      candidates = await searchRivers(name, {
        attempts: retryAttempts(),
        onAttempt: updateRetryStatus
      });

      if (state.settings.preferLocalCache) {
        await writeCachedJson(cacheKey, candidates, { type: "search", query: name });
      }
    }

    state.candidates = candidates;
    renderCandidates(candidates);
    setStatus("Ready");
  } catch (error) {
    setStatus("Search failed", true);
    els.candidateStatus.textContent = "failed";
    els.candidateList.innerHTML = emptyRow(error.message);
  }
}

async function addCandidate(index, options = {}) {
  const candidate = state.candidates[index];
  if (!candidate) return;
  await addRiverFromCandidate(candidate, options);
}

async function addRiverByRef(ref, options = {}) {
  const existing = state.rivers.get(ref);
  if (existing) {
    setFocusRiver(ref, { fit: Boolean(options.fit) });
    return existing;
  }

  const entry = findBestSampleForRef(ref);
  if (entry && options.preferSample) {
    await loadSampleEntry(entry, options);
    return state.rivers.get(ref);
  }

  const candidate = candidateFromRef(ref);
  return addRiverFromCandidate(candidate, options);
}

async function addRiverFromCandidate(candidate, options = {}) {
  const ref = candidateRef(candidate);
  const existing = state.rivers.get(ref);

  if (existing) {
    setFocusRiver(ref, { fit: options.fit !== false });
    return existing;
  }

  setStatus("Loading river");
  els.selectedStatus.textContent = "loading";
  els.mapStatus.textContent = `Loading ${candidate.name}`;

  try {
    const { waterways, sourceLabel } = await loadMainWaterways(candidate, options);
    const hydratedCandidate = hydrateCandidateName(candidate, waterways);
    const geometry = deriveRiverGeometry(waterways);
    const river = upsertRiver({
      ref,
      candidate: hydratedCandidate,
      mainWaterways: waterways,
      ...geometry,
      elevationProfile: null,
      classification: null,
      loadedCount: 0,
      mainSource: sourceLabel,
      basinSource: null,
      basinOptions: null
    });

    renderRiver(river);
    setFocusRiver(ref, { fit: options.fit !== false });
    void ensureElevationProfile(ref);
    els.mapStatus.textContent = `${hydratedCandidate.name}: ${waterways.length} main segments from ${sourceLabel}`;
    setStatus("River loaded");
    return river;
  } catch (error) {
    setStatus("Load failed", true);
    els.selectedStatus.textContent = "failed";
    els.mapStatus.textContent = error.message;
    throw error;
  }
}

async function loadFocusedBasin(options = {}) {
  const river = focusedRiver();
  if (!river) return;

  const basinOptions = currentBasinOptions();
  els.loadBasin.disabled = true;
  els.refreshBasin.disabled = true;
  els.basinStatus.textContent = "loading";
  els.mapStatus.textContent = `Loading basin for ${river.candidate.name}`;
  setStatus("Loading basin");

  try {
    const sampleEntry =
      !options.forceLive && state.settings.preferSampleCache
        ? findSampleEntry(state.sampleManifest, river.ref, basinOptions)
        : null;

    if (sampleEntry) {
      await loadSampleEntry(sampleEntry, { refocus: true, fit: options.fit !== false });
      els.mapStatus.textContent = `${river.candidate.name}: loaded repo sample`;
      setStatus("Basin loaded");
      return;
    }

    const cacheKey = basinCacheKey(river.ref, basinOptions);
    let bundle = null;

    if (!options.forceLive && state.settings.preferLocalCache) {
      bundle = await readCachedJson(cacheKey, { maxAgeMs: 30 * 24 * 60 * 60 * 1000 });
      if (bundle) bundle.sourceLabel = "local cache";
    }

    if (!bundle) {
      bundle = await buildLiveBasinBundle(river, basinOptions);
      if (state.settings.preferLocalCache) {
        await writeCachedJson(cacheKey, bundle, { type: "basin", ref: river.ref, options: basinOptions });
      }
    }

    applyBundleToRiver(river.ref, bundle, { fit: options.fit !== false });
    void ensureElevationProfile(river.ref);
    els.mapStatus.textContent = `${bundle.classification.stats.waterwayCount} basin waterways from ${bundle.sourceLabel}`;
    setStatus("Basin loaded");
  } catch (error) {
    setStatus("Basin failed", true);
    els.mapStatus.textContent = error.message;
  } finally {
    updateFocusActions();
  }
}

async function loadSampleEntry(entry, options = {}) {
  setStatus("Loading sample");
  els.sampleStatus.textContent = "loading";
  applyBasinOptionsToInputs(entry.options);
  persistSettingsFromInputs();

  const bundle = await loadSampleBundle(entry);
  bundle.sourceLabel = "repo sample";
  applyBundleToRiver(candidateRef(bundle.candidate), bundle, {
    fit: options.fit !== false,
    refocus: options.refocus !== false
  });
  void ensureElevationProfile(candidateRef(bundle.candidate));

  els.sampleStatus.textContent = `${state.sampleManifest.samples.length} samples`;
  els.mapStatus.textContent = `${bundle.candidate.name}: loaded repo sample bundle`;
  setStatus("Sample ready");
}

async function loadMainWaterways(candidate, options = {}) {
  const cacheKey = `main:${candidateRef(candidate)}`;

  if (!options.forceLive && state.settings.preferLocalCache) {
    const cached = await readCachedJson(cacheKey, { maxAgeMs: 30 * 24 * 60 * 60 * 1000 });
    if (cached) {
      return {
        waterways: cached,
        sourceLabel: "local cache"
      };
    }
  }

  const waterways = await loadRiverGeometry(candidate, {
    attempts: retryAttempts(),
    onAttempt: updateRetryStatus
  });

  if (state.settings.preferLocalCache) {
    await writeCachedJson(cacheKey, waterways, { type: "main", ref: candidateRef(candidate) });
  }

  return {
    waterways,
    sourceLabel: "live"
  };
}

async function buildLiveBasinBundle(river, basinOptions) {
  const bounds = expandBounds(boundsForWaterways(river.mainWaterways), basinOptions.paddingDeg);
  const tiles = splitBounds(bounds, 1);
  const allWaterways = new Map();

  for (const [index, tile] of tiles.entries()) {
    els.basinStatus.textContent = `tile ${index + 1}/${tiles.length}`;
    els.mapStatus.textContent = `Loading tile ${index + 1}/${tiles.length} for ${river.candidate.name}`;

    const waterways = await loadWaterwaysInBounds(tile, {
      attempts: retryAttempts(),
      onAttempt: updateRetryStatus
    });

    waterways.forEach((waterway) => allWaterways.set(waterway.id, waterway));
    if (index < tiles.length - 1) await sleep(700);
  }

  const classification = classifyBasin(Array.from(allWaterways.values()), river.mainWaterways, {
    toleranceM: basinOptions.toleranceM,
    maxOrder: basinOptions.maxOrder
  });

  return {
    version: 1,
    candidate: river.candidate,
    mainWaterways: river.mainWaterways,
    elevationProfile: river.elevationProfile || null,
    classification,
    loadedCount: allWaterways.size,
    options: basinOptions,
    sourceLabel: "live"
  };
}

function applyBundleToRiver(ref, bundle, options = {}) {
  const geometry = deriveRiverGeometry(bundle.mainWaterways);
  const river = upsertRiver({
    ref,
    candidate: bundle.candidate,
    mainWaterways: bundle.mainWaterways,
    ...geometry,
    elevationProfile: normalizeElevationProfile(bundle.elevationProfile || null, geometry.mainLengthKm),
    classification: bundle.classification,
    loadedCount: bundle.loadedCount,
    mainSource: bundle.sourceLabel,
    basinSource: bundle.sourceLabel,
    basinOptions: bundle.options
  });

  renderRiver(river);
  setFocusRiver(ref, { fit: Boolean(options.fit) });
  return river;
}

function upsertRiver(next) {
  const existing = state.rivers.get(next.ref);
  const palette = state.savedPalettes[next.ref] || existing?.palette || defaultPaletteForRiver(next.ref);
  const river = {
    ...existing,
    ...next,
    palette,
    ref: next.ref
  };

  state.rivers.set(next.ref, river);

  if (!state.riverOrder.includes(next.ref)) {
    state.riverOrder.push(next.ref);
  }

  renderRiver(river);
  renderActiveRivers();
  renderFocusedRiver();
  renderCandidates(state.candidates);
  updateFocusActions();
  renderShareUrl();
  return river;
}

function deriveRiverGeometry(mainWaterways) {
  const endpoints = inferFlowEndpoints(mainWaterways);
  const mainPath = mergeWaterwaysIntoPath(mainWaterways, endpoints);
  const mainLengthKm = mainPath.length > 1 ? lineLengthKm(mainPath) : collectionLengthKm(mainWaterways);

  return {
    endpoints,
    mainPath,
    mainLengthKm
  };
}

async function ensureElevationProfile(ref) {
  const river = state.rivers.get(ref);
  if (!river || river.elevationProfile?.length) return river?.elevationProfile || [];

  try {
    const cacheKey = `elevation:${ref}:samples-10`;
    let profile = null;

    if (state.settings.preferLocalCache) {
      profile = await readCachedJson(cacheKey, { maxAgeMs: 30 * 24 * 60 * 60 * 1000 });
    }

    if (!profile) {
      const samples = samplePointsAlongPath(river.mainPath || [], 10);
      profile = await loadElevationProfile(samples, {
        attempts: retryAttempts(),
        onAttempt: updateRetryStatus
      });

      if (state.settings.preferLocalCache) {
        await writeCachedJson(cacheKey, profile, { type: "elevation", ref });
      }
    }

    river.elevationProfile = normalizeElevationProfile(profile, river.mainLengthKm);
    river.elevationError = "";
    renderActiveRivers();
    renderFocusedRiver();
    return profile;
  } catch (error) {
    river.elevationError = elevationErrorMessage(error);
    renderFocusedRiver();
    return [];
  }
}

function elevationErrorMessage(error) {
  const raw = error?.message || "Elevation lookup failed";
  if (/failed to fetch|networkerror|load failed/i.test(raw)) {
    return "Elevation service unreachable — try again later.";
  }
  if (/429|rate/i.test(raw)) {
    return "Elevation service rate-limited (1000 requests/day shared).";
  }
  return raw;
}

function detachRiver(ref) {
  state.rivers.delete(ref);
  state.riverOrder = state.riverOrder.filter((value) => value !== ref);
  removeRiver(ref);

  if (state.focusRiverRef === ref) {
    state.focusRiverRef = state.riverOrder[0] || null;
  }

  if (!state.riverOrder.length) {
    clearRiver();
  }

  renderActiveRivers();
  renderFocusedRiver();
  renderCandidates(state.candidates);
  updateFocusActions();
  renderShareUrl();
}

function setFocusRiver(ref, options = {}) {
  if (!state.rivers.has(ref)) return;
  state.focusRiverRef = ref;

  renderActiveRivers();
  renderFocusedRiver();
  updateFocusActions();
  renderShareUrl();

  if (options.fit) fitToRiver(state.rivers.get(ref));
}

function focusElevationSample(ref, index) {
  const river = state.rivers.get(ref);
  const sample = river?.elevationProfile?.[index];
  if (!river || !sample) return;

  setFocusRiver(ref, { fit: false });
  highlightProfileSample(river, sample);
  els.mapStatus.textContent = `${river.candidate.name}: centered on ${Math.round(sample.fraction * 100)}% profile sample`;
}

function focusedRiver() {
  return state.rivers.get(state.focusRiverRef) || null;
}

function normalizeElevationProfile(profile, mainLengthKm) {
  if (!profile?.length) return profile;

  return profile.map((sample, index) => {
    const fraction = Number.isFinite(sample.fraction)
      ? sample.fraction
      : profile.length === 1
        ? 0
        : index / (profile.length - 1);

    return {
      ...sample,
      index,
      fraction,
      distanceKm: Number.isFinite(mainLengthKm) ? mainLengthKm * fraction : sample.distanceKm ?? 0
    };
  });
}

const CONTINENT_ORDER = ["Europe", "Africa", "Asia", "North America", "South America", "Oceania", "Antarctica", "Other"];
const CONTINENT_OPEN_DEFAULT = new Set(["Europe"]);

function renderSampleList() {
  const samples = state.sampleManifest.samples || [];
  els.sampleStatus.textContent = samples.length ? `${samples.length} samples` : "none";

  if (!samples.length) {
    els.sampleList.innerHTML = emptyRow("No repo samples yet.", "sample-card");
    return;
  }

  const groups = new Map();
  samples.forEach((entry, index) => {
    const key = entry.ref || entry.file;
    if (!groups.has(key)) {
      groups.set(key, {
        ref: entry.ref,
        name: extractRiverName(entry),
        continent: entry.continent || "Other",
        entries: []
      });
    }
    const group = groups.get(key);
    if (entry.continent) group.continent = entry.continent;
    group.entries.push({ ...entry, index });
  });

  const byContinent = new Map();
  for (const group of groups.values()) {
    const continent = group.continent || "Other";
    if (!byContinent.has(continent)) byContinent.set(continent, []);
    byContinent.get(continent).push(group);
  }

  const sortedContinents = Array.from(byContinent.keys()).sort((a, b) => {
    const ai = CONTINENT_ORDER.indexOf(a);
    const bi = CONTINENT_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const openMemory = state.sampleContinentOpen ?? (state.sampleContinentOpen = new Map());

  els.sampleList.innerHTML = sortedContinents
    .map((continent) => {
      const groupsInContinent = byContinent.get(continent).sort((a, b) => a.name.localeCompare(b.name));
      const totalRivers = groupsInContinent.length;
      const totalTiers = groupsInContinent.reduce((acc, g) => acc + g.entries.length, 0);
      const isOpen = openMemory.has(continent) ? openMemory.get(continent) : CONTINENT_OPEN_DEFAULT.has(continent);

      const cards = groupsInContinent
        .map((group) => {
          const sortedEntries = group.entries
            .slice()
            .sort((a, b) => (a.tier ?? a.options?.maxOrder ?? 0) - (b.tier ?? b.options?.maxOrder ?? 0));

          const tierButtons = sortedEntries
            .map((entry) => {
              const tier = entry.tier ?? entry.options?.maxOrder ?? 0;
              const matchesCurrent =
                Number(entry.options.maxOrder) === Number(els.upstreamOrder.value) &&
                Number(entry.options.toleranceM) === Number(els.outletTolerance.value) &&
                Number(entry.options.paddingDeg) === Number(els.basinPadding.value);
              const label = tier === 0 ? "main" : `+order${tier}`;
              return `
                <button
                  type="button"
                  class="sample-tier ${matchesCurrent ? "is-current" : ""}"
                  data-sample-index="${entry.index}"
                  title="Load ${escapeHtml(group.name)} (${label})"
                >${escapeHtml(label)}</button>
              `;
            })
            .join("");

          return `
            <article class="sample-card sample-card--grouped">
              <span>
                <strong>${escapeHtml(group.name)}</strong>
                <small>${group.entries.length} tier${group.entries.length === 1 ? "" : "s"} cached</small>
              </span>
              <div class="sample-tiers">${tierButtons}</div>
            </article>
          `;
        })
        .join("");

      return `
        <details class="sample-continent" data-continent="${escapeHtml(continent)}"${isOpen ? " open" : ""}>
          <summary>
            <span class="sample-continent__name">${escapeHtml(continent)}</span>
            <span class="sample-continent__meta">${totalRivers} river${totalRivers === 1 ? "" : "s"} · ${totalTiers} tiers</span>
          </summary>
          <div class="sample-continent__body">${cards}</div>
        </details>
      `;
    })
    .join("");

  renderIcons();
}

function extractRiverName(entry) {
  const label = entry.label || "";
  const stripped = label.replace(/\s*·.*$/, "").replace(/\s+repo sample.*$/i, "").trim();
  return stripped || entry.ref || "Sample";
}

function renderCandidates(candidates) {
  els.candidateStatus.textContent = candidates.length ? `${candidates.length} matches` : "No search yet";

  if (!candidates.length) {
    els.candidateList.innerHTML = emptyRow("Search to add one or more rivers.", "candidate-row");
    return;
  }

  els.candidateList.innerHTML = candidates
    .map((candidate, index) => {
      const ref = candidateRef(candidate);
      const sample = findBestSampleForRef(ref);
      const detail = [
        candidate.osmType,
        candidate.wikidata || "no wikidata",
        sample ? "repo sample" : null,
        candidate.wikipedia || candidate.localName
      ]
        .filter(Boolean)
        .join(" · ");

      const active = state.rivers.has(ref);
      return `
        <article class="candidate-row">
          <span>
            <strong>${escapeHtml(candidate.name)}</strong>
            <small>${escapeHtml(detail)}</small>
          </span>
          <button type="button" data-candidate-index="${index}" title="${active ? "Focus" : "Add"} ${escapeHtml(candidate.name)}">
            <i data-lucide="${active ? "locate-fixed" : "plus"}" aria-hidden="true"></i>
            <span>${active ? "Focus" : "Add"}</span>
          </button>
        </article>
      `;
    })
    .join("");

  renderIcons();
}

function renderActiveRivers() {
  els.activeStatus.textContent = `${state.riverOrder.length} active`;

  if (!state.riverOrder.length) {
    els.activeRiverList.innerHTML = emptyRow("No rivers added yet.", "river-card");
    return;
  }

  els.activeRiverList.innerHTML = state.riverOrder
    .map((ref) => {
      const river = state.rivers.get(ref);
      const isFocus = ref === state.focusRiverRef;
      const sample = findBestSampleForRef(ref);
      const classification = river.classification;
      const sourceLabel = classification ? river.basinSource || river.mainSource : river.mainSource;

      return `
        <article class="river-card ${isFocus ? "is-focus" : ""}">
          <div class="river-card__header">
            <span>
              <strong>${escapeHtml(river.candidate.name)}</strong>
              <small>${escapeHtml(`${ref} · ${sourceLabel || "live"}`)}</small>
            </span>
            <span class="river-card__badge">${isFocus ? "focus" : "active"}</span>
          </div>

          <div class="river-card__stats">
            <span><strong>${river.mainWaterways.length.toLocaleString("en-US")}</strong> main segments</span>
            <span><strong>${km(river.mainLengthKm || collectionLengthKm(river.mainWaterways))}</strong> main stem length</span>
            <span><strong>${classification ? classification.stats.directCount.toLocaleString("en-US") : 0}</strong> direct tributaries</span>
            <span><strong>${classification ? classification.stats.descendantCount.toLocaleString("en-US") : 0}</strong> descendants</span>
          </div>

          <div class="river-card__colors">
            ${renderColorInput(ref, "main", "Main", river.palette.main)}
            ${renderColorInput(ref, "direct", "Direct", river.palette.direct)}
            ${renderColorInput(ref, "descendant", "Desc", river.palette.descendant)}
            ${renderColorInput(ref, "endpoint", "Point", river.palette.endpoint)}
          </div>

          <div class="river-card__actions">
            <button type="button" data-river-action="focus" data-river-ref="${ref}">
              <i data-lucide="crosshair" aria-hidden="true"></i>
              <span>Focus</span>
            </button>
            <button type="button" data-river-action="fit" data-river-ref="${ref}">
              <i data-lucide="maximize" aria-hidden="true"></i>
              <span>Fit</span>
            </button>
            <button type="button" data-river-action="sample" data-river-ref="${ref}" ${sample ? "" : "disabled"}>
              <i data-lucide="package-open" aria-hidden="true"></i>
              <span>${sample ? "Repo sample" : "No sample"}</span>
            </button>
            <button type="button" data-river-action="reset-colors" data-river-ref="${ref}">
              <i data-lucide="droplets" aria-hidden="true"></i>
              <span>Reset colors</span>
            </button>
            <button type="button" data-river-action="remove" data-river-ref="${ref}">
              <i data-lucide="trash-2" aria-hidden="true"></i>
              <span>Remove</span>
            </button>
          </div>

          <div class="river-card__meta">
            ${escapeHtml(classification ? basinMeta(river) : sample ? "Repo sample available for order 2 basin" : "Live main geometry loaded")}
          </div>
        </article>
      `;
    })
    .join("");

  renderIcons();
}

function renderFocusedRiver() {
  const river = focusedRiver();

  if (!river) {
    els.selectedStatus.textContent = "none";
    els.riverSummary.innerHTML = `
      <span><strong>0</strong> main segments</span>
      <span><strong>0 km</strong> mapped length</span>
      <span><strong>n/a</strong> source candidate</span>
      <span><strong>n/a</strong> mouth candidate</span>
    `;
    els.basinSummary.innerHTML = `
      <span><strong>0</strong> direct tributaries</span>
      <span><strong>0</strong> descendants</span>
      <span><strong>0</strong> waterway shapes</span>
      <span><strong>0 km</strong> mapped basin length</span>
    `;
    els.basinStatus.textContent = "waiting";
    renderElevationProfile(null);
    return;
  }

  els.selectedStatus.textContent = river.candidate.name;
  els.riverSummary.innerHTML = `
    <span><strong>${river.mainWaterways.length.toLocaleString("en-US")}</strong> main segments</span>
    <span><strong>${km(river.mainLengthKm || collectionLengthKm(river.mainWaterways))}</strong> main stem length</span>
    <span><strong>${formatPoint(river.endpoints?.source)}</strong> source candidate</span>
    <span><strong>${formatPoint(river.endpoints?.mouth)}</strong> mouth candidate</span>
  `;
  renderElevationProfile(river);

  if (!river.classification) {
    els.basinStatus.textContent = "waiting";
    els.basinSummary.innerHTML = `
      <span><strong>0</strong> direct tributaries</span>
      <span><strong>0</strong> descendants</span>
      <span><strong>0</strong> waterway shapes</span>
      <span><strong>0 km</strong> mapped basin length</span>
    `;
    return;
  }

  els.basinStatus.textContent = river.basinSource || "loaded";
  els.basinSummary.innerHTML = `
    <span><strong>${river.classification.stats.directCount.toLocaleString("en-US")}</strong> direct tributaries</span>
    <span><strong>${river.classification.stats.descendantCount.toLocaleString("en-US")}</strong> descendants</span>
    <span><strong>${river.loadedCount.toLocaleString("en-US")}</strong> loaded shapes</span>
    <span><strong>${km(river.classification.stats.totalKm)}</strong> mapped basin length</span>
  `;
}

function renderElevationProfile(river) {
  if (!river) {
    els.elevationStatus.textContent = "waiting";
    els.elevationSummary.innerHTML = `
      <span><strong>n/a</strong> source elevation</span>
      <span><strong>n/a</strong> mouth elevation</span>
      <span><strong>0 m</strong> total drop</span>
      <span><strong>10</strong> sampled points</span>
    `;
    els.elevationProfile.innerHTML = emptyRow("No elevation profile yet.", "profile-sample");
    return;
  }

  if (!river.elevationProfile?.length) {
    els.elevationStatus.textContent = river.elevationError ? "unavailable" : "loading";
    els.elevationSummary.innerHTML = `
      <span><strong>n/a</strong> source elevation</span>
      <span><strong>n/a</strong> mouth elevation</span>
      <span><strong>n/a</strong> total drop</span>
      <span><strong>10</strong> sampled points</span>
    `;
    els.elevationProfile.innerHTML = emptyRow(
      river.elevationError || "Sampling elevation at 10 points...",
      "profile-sample"
    );
    return;
  }

  const first = river.elevationProfile[0];
  const last = river.elevationProfile.at(-1);
  const dropM =
    first?.elevationM != null && last?.elevationM != null ? Math.round(first.elevationM - last.elevationM) : null;

  els.elevationStatus.textContent = "10 samples";
  els.elevationSummary.innerHTML = `
    <span><strong>${formatElevation(first?.elevationM)}</strong> source elevation</span>
    <span><strong>${formatElevation(last?.elevationM)}</strong> mouth elevation</span>
    <span><strong>${dropM == null ? "n/a" : `${dropM.toLocaleString("en-US")} m`}</strong> total drop</span>
    <span><strong>${river.elevationProfile.length}</strong> sampled points</span>
  `;

  els.elevationProfile.innerHTML = river.elevationProfile
    .map((sample) => {
      const edgeLabel = sample.index === 0 ? "Source" : sample.index === river.elevationProfile.length - 1 ? "Mouth" : "Sample";
      return `
        <button
          type="button"
          class="profile-sample"
          data-river-ref="${river.ref}"
          data-profile-index="${sample.index}"
          title="Center map on ${escapeHtml(`${river.candidate.name} ${Math.round(sample.fraction * 100)}% sample`)}"
        >
          <span class="profile-sample__dot" aria-hidden="true"></span>
          <strong>${escapeHtml(`${Math.round(sample.fraction * 100)}%`)}</strong>
          <small>${escapeHtml(edgeLabel)}</small>
          <small>${escapeHtml(formatElevation(sample.elevationM))}</small>
          <small>${escapeHtml(`${sample.distanceKm.toFixed(0)} km from source`)}</small>
        </button>
      `;
    })
    .join("");
}

function renderShareUrl() {
  const url = new URL(window.location.href);
  const activeRefs = state.riverOrder;
  const basinRefs = activeRefs.filter((ref) => state.rivers.get(ref)?.classification);

  setParam(url, "rivers", activeRefs.join(","));
  setParam(url, "focus", state.focusRiverRef || "");
  setParam(url, "basins", basinRefs.join(","));
  setParam(url, "basemap", els.basemapSelect.value !== DEFAULT_SETTINGS.basemap ? els.basemapSelect.value : "");
  setParam(url, "order", els.upstreamOrder.value !== String(DEFAULT_SETTINGS.maxOrder) ? els.upstreamOrder.value : "");
  setParam(url, "tolerance", els.outletTolerance.value !== String(DEFAULT_SETTINGS.toleranceM) ? els.outletTolerance.value : "");
  setParam(url, "padding", els.basinPadding.value !== String(DEFAULT_SETTINGS.paddingDeg) ? els.basinPadding.value : "");
  setParam(url, "sample", els.preferSampleCache.checked ? "1" : "");
  setParam(url, "cache", els.preferLocalCache.checked ? "1" : "");

  const activeLayers = document.querySelectorAll("[data-layer]:checked");
  const layerValue = Array.from(activeLayers).map((input) => input.dataset.layer).join(".");
  const defaultLayerValue = Object.entries(DEFAULT_SETTINGS.layerVisibility)
    .filter(([, visible]) => visible)
    .map(([name]) => name)
    .join(".");
  setParam(url, "layers", layerValue !== defaultLayerValue ? layerValue : "");

  const serialized = url.toString();
  els.shareUrl.value = serialized;
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

function populateBasemapOptions() {
  els.basemapSelect.innerHTML = Object.entries(BASEMAPS)
    .map(([key, value]) => `<option value="${key}">${escapeHtml(value.label)}</option>`)
    .join("");
}

function applySettingsToInputs(settings) {
  els.retryAttempts.value = String(settings.retryAttempts);
  els.outletTolerance.value = String(settings.toleranceM);
  els.upstreamOrder.value = String(settings.maxOrder);
  els.basinPadding.value = String(settings.paddingDeg);
  els.preferSampleCache.checked = Boolean(settings.preferSampleCache);
  els.preferLocalCache.checked = Boolean(settings.preferLocalCache);
  els.basemapSelect.value = settings.basemap;

  document.querySelectorAll("[data-layer]").forEach((input) => {
    input.checked = Boolean(settings.layerVisibility[input.dataset.layer]);
  });
}

function applyMapSettings() {
  setBasemap(state.settings.basemap);
  Object.entries(state.settings.layerVisibility).forEach(([name, visible]) => setLayerVisible(name, visible));
  els.appearanceStatus.textContent = supportsDataCache() ? "saved locally" : "settings only";
}

function applyUrlOverrides(urlState) {
  if (urlState.basemap) els.basemapSelect.value = urlState.basemap;
  if (urlState.order != null && urlState.order !== "") els.upstreamOrder.value = String(urlState.order);
  if (urlState.tolerance) els.outletTolerance.value = String(urlState.tolerance);
  if (urlState.padding) els.basinPadding.value = String(urlState.padding);
  if (typeof urlState.sample === "boolean") els.preferSampleCache.checked = urlState.sample;
  if (typeof urlState.cache === "boolean") els.preferLocalCache.checked = urlState.cache;

  if (urlState.layers.length) {
    document.querySelectorAll("[data-layer]").forEach((input) => {
      input.checked = urlState.layers.includes(input.dataset.layer);
    });
  }

  persistSettingsFromInputs();
  applyMapSettings();
}

function persistSettingsFromInputs() {
  state.settings = {
    retryAttempts: clampAttempts(els.retryAttempts.value),
    toleranceM: Number.parseInt(els.outletTolerance.value, 10),
    maxOrder: Number.parseInt(els.upstreamOrder.value, 10),
    paddingDeg: Number.parseFloat(els.basinPadding.value),
    basemap: els.basemapSelect.value,
    preferSampleCache: els.preferSampleCache.checked,
    preferLocalCache: els.preferLocalCache.checked,
    layerVisibility: Object.fromEntries(
      Array.from(document.querySelectorAll("[data-layer]")).map((input) => [input.dataset.layer, input.checked])
    )
  };

  saveSettings(state.settings);
}

async function copyShareUrl() {
  renderShareUrl();

  try {
    await navigator.clipboard.writeText(els.shareUrl.value);
    els.appearanceStatus.textContent = "link copied";
  } catch (error) {
    let copied = false;
    els.shareUrl.select();
    if (typeof document.execCommand === "function") {
      copied = document.execCommand("copy");
    }
    els.appearanceStatus.textContent = copied ? "link copied" : "copy manually";
  }
}

async function clearLocalCache() {
  await clearCachedData();
  els.appearanceStatus.textContent = "local cache cleared";
}

function resetSavedSettings() {
  clearSavedPreferences();
  state.savedPalettes = {};
  state.settings = loadSettings();
  applySettingsToInputs(state.settings);
  applyMapSettings();

  state.riverOrder.forEach((ref) => {
    const river = state.rivers.get(ref);
    river.palette = defaultPaletteForRiver(ref);
    renderRiver(river);
  });

  renderActiveRivers();
  renderShareUrl();
  els.appearanceStatus.textContent = "defaults restored";
}

function resetRiverPalette(ref) {
  const river = state.rivers.get(ref);
  if (!river) return;

  river.palette = defaultPaletteForRiver(ref);
  state.savedPalettes = deleteRiverPalette(ref);
  renderRiver(river);
  renderActiveRivers();
  els.appearanceStatus.textContent = `colors reset for ${river.candidate.name}`;
}

function updateFocusActions() {
  const hasFocus = Boolean(focusedRiver());
  els.loadBasin.disabled = !hasFocus;
  els.refreshBasin.disabled = !hasFocus;
}

function updateRetryStatus(info) {
  if (info.phase === "try") {
    els.retryStatus.textContent = `Attempt ${info.attempt}/${info.attempts}`;
    return;
  }

  els.retryStatus.textContent = `Backoff ${Math.round(info.delayMs / 1000)}s after attempt ${info.attempt}`;
}

function currentBasinOptions() {
  return {
    toleranceM: Number.parseInt(els.outletTolerance.value, 10),
    maxOrder: Number.parseInt(els.upstreamOrder.value, 10),
    paddingDeg: Number.parseFloat(els.basinPadding.value)
  };
}

function applyBasinOptionsToInputs(options) {
  els.outletTolerance.value = String(options.toleranceM);
  els.upstreamOrder.value = String(options.maxOrder);
  els.basinPadding.value = String(options.paddingDeg);
}

function retryAttempts() {
  return clampAttempts(els.retryAttempts.value);
}

function findBestSampleForRef(ref) {
  const exact = findSampleEntry(state.sampleManifest, ref, currentBasinOptions());
  if (exact) return exact;
  return (state.sampleManifest.samples || []).find((entry) => entry.ref === ref) || null;
}

function parseUrlState() {
  const url = new URL(window.location.href);
  const rivers = splitParam(url.searchParams.get("rivers"));
  const basins = splitParam(url.searchParams.get("basins"));
  const layers = splitParam(url.searchParams.get("layers"), ".");

  return {
    rivers,
    basins,
    focus: url.searchParams.get("focus"),
    basemap: url.searchParams.get("basemap"),
    order: url.searchParams.get("order"),
    tolerance: url.searchParams.get("tolerance"),
    padding: url.searchParams.get("padding"),
    sample: url.searchParams.has("sample") ? url.searchParams.get("sample") !== "0" : undefined,
    cache: url.searchParams.has("cache") ? url.searchParams.get("cache") !== "0" : undefined,
    layers
  };
}

function splitParam(value, separator = ",") {
  return value ? value.split(separator).map((item) => item.trim()).filter(Boolean) : [];
}

function basinCacheKey(ref, options) {
  return [
    "basin",
    ref,
    `order-${options.maxOrder}`,
    `tol-${options.toleranceM}`,
    `pad-${options.paddingDeg}`
  ].join(":");
}

function sampleDetail(entry, matchesCurrent) {
  return [
    `order ${entry.options.maxOrder}`,
    `${entry.options.toleranceM} m`,
    `${entry.options.paddingDeg} deg`,
    matchesCurrent ? "matches current loader" : "applies its own loader settings"
  ].join(" · ");
}

function basinMeta(river) {
  return [
    `${river.classification.stats.directCount.toLocaleString("en-US")} direct`,
    `${river.classification.stats.descendantCount.toLocaleString("en-US")} descendants`,
    `${river.loadedCount.toLocaleString("en-US")} loaded shapes`,
    river.basinSource || "live"
  ].join(" · ");
}

function renderColorInput(ref, role, label, value) {
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <input type="color" value="${escapeHtml(value)}" data-river-ref="${ref}" data-river-color="${role}">
    </label>
  `;
}

function setStatus(message, warn = false) {
  els.networkStatus.textContent = message;
  els.networkStatus.classList.toggle("is-warn", warn);
}

function setParam(url, key, value) {
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
}

function candidateFromRef(ref) {
  const [osmType, rawId] = String(ref).split(":");
  return {
    osmType,
    id: Number.parseInt(rawId, 10),
    name: ref,
    localName: "",
    wikidata: "",
    wikipedia: "",
    center: null,
    tags: {}
  };
}

function hydrateCandidateName(candidate, waterways) {
  const mainName = mostCommonWaterwayName(waterways);
  if (!mainName) return candidate;
  return {
    ...candidate,
    name: mainName
  };
}

function mostCommonWaterwayName(waterways) {
  const counts = new Map();

  waterways.forEach((waterway) => {
    if (!waterway.name || waterway.name.includes(":")) return;
    counts.set(waterway.name, (counts.get(waterway.name) || 0) + 1);
  });

  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function formatPoint(point) {
  if (!point) return "n/a";
  return `${point[0].toFixed(3)}, ${point[1].toFixed(3)}`;
}

function formatElevation(value) {
  if (value == null) return "n/a";
  return `${Math.round(value).toLocaleString("en-US")} m`;
}

function cacheSlug(value) {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function emptyRow(message, className = "candidate-row") {
  return `
    <article class="${className} is-empty">
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
