import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { classifyBasin } from "../src/geo/classifier.js";
import {
  boundsForWaterways,
  collectionLengthKm,
  expandBounds,
  inferFlowEndpoints,
  mergeWaterwaysIntoPath,
  samplePointsAlongPath,
  splitBounds
} from "../src/geo/geometry.js";
import { retryWithBackoff, sleep } from "../src/api/retry.js";

const execFileAsync = promisify(execFile);
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const samplesDir = resolve(rootDir, "data", "samples");

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const ELEVATION_ENDPOINT = "https://api.opentopodata.org/v1/aster30m";
const LARGE_BUFFER = 128 * 1024 * 1024;

const defaultOptions = {
  toleranceM: 900,
  maxOrder: 2,
  paddingDeg: 0.25,
  attempts: 6
};

const targets = [
  { name: "Mureș", slug: "mures", label: "Mureș repo sample", continent: "Europe", options: { ...defaultOptions, maxOrder: 4 } },
  { name: "Olt", slug: "olt", label: "Olt repo sample", continent: "Europe", options: { ...defaultOptions, maxOrder: 4 } },
  { name: "Dunărea", slug: "danube", label: "Dunărea repo sample", continent: "Europe", options: { ...defaultOptions, maxOrder: 4, paddingDeg: 0.1 } },
  { name: "Argeș", slug: "arges", label: "Argeș repo sample", continent: "Europe", options: { ...defaultOptions, maxOrder: 4 } },
  { name: "Dâmbovița", slug: "dambovita", label: "Dâmbovița repo sample", continent: "Europe", options: { ...defaultOptions, maxOrder: 4 } },
  { name: "Thames", slug: "thames", label: "Thames repo sample", continent: "Europe", options: { ...defaultOptions, maxOrder: 4 } },
  { name: "Loire", slug: "loire", label: "Loire repo sample", continent: "Europe", options: { ...defaultOptions, maxOrder: 4 } },
  { name: "Po", slug: "po", label: "Po repo sample", continent: "Europe", searchAliases: ["Fiume Po", "Po, Italia", "Po river Italy"], options: { ...defaultOptions, maxOrder: 4 } },
  { name: "Vistula", slug: "vistula", label: "Vistula repo sample", continent: "Europe", options: { ...defaultOptions, maxOrder: 4 } },
  { name: "Hudson River", slug: "hudson", label: "Hudson River repo sample", continent: "North America", options: { ...defaultOptions, maxOrder: 4 } },
  { name: "Tennessee River", slug: "tennessee", label: "Tennessee River repo sample", continent: "North America", options: { ...defaultOptions, maxOrder: 4 } },
  { name: "Chao Phraya", slug: "chaophraya", label: "Chao Phraya repo sample", continent: "Asia", options: { ...defaultOptions, maxOrder: 4 } },
  { name: "Tigris", slug: "tigris", label: "Tigris repo sample", continent: "Asia", options: { ...defaultOptions, maxOrder: 4 } },
  { name: "Han River", slug: "han", label: "Han River repo sample", continent: "Asia", searchAliases: ["Han Gang", "한강", "Han River Korea", "Hangang"], options: { ...defaultOptions, maxOrder: 4 } },
  { name: "Senegal River", slug: "senegal", label: "Senegal River repo sample", continent: "Africa", options: { ...defaultOptions, maxOrder: 4 } },
  { name: "Limpopo", slug: "limpopo", label: "Limpopo repo sample", continent: "Africa", options: { ...defaultOptions, maxOrder: 4 } },
  { name: "Zambezi", slug: "zambezi", label: "Zambezi repo sample", continent: "Africa", options: { ...defaultOptions, maxOrder: 4 } },
  { name: "Magdalena River", slug: "magdalena", label: "Magdalena repo sample", continent: "South America", options: { ...defaultOptions, maxOrder: 4 } },
  { name: "Murray River", slug: "murray", label: "Murray repo sample", continent: "Oceania", options: { ...defaultOptions, maxOrder: 4 } }
];

const requestedTargets = new Set(process.argv.slice(2).map((value) => value.toLocaleLowerCase()));
const activeTargets = requestedTargets.size
  ? targets.filter((target) => requestedTargets.has(target.slug) || requestedTargets.has(target.name.toLocaleLowerCase()))
  : targets;

await mkdir(samplesDir, { recursive: true });

const writtenManifestEntries = [];

for (const target of activeTargets) {
  const targetOptions = { ...defaultOptions, ...(target.options || {}) };
  console.log(`Building ${target.label} (maxOrder=${targetOptions.maxOrder}, padding=${targetOptions.paddingDeg})...`);
  const candidate = await resolveCandidate(target);
  const mainWaterways = await loadRiverGeometry(candidate, targetOptions);
  const elevationProfile = await buildElevationProfile(mainWaterways);
  const classificationBundle = await buildBasinBundle(candidate, mainWaterways, targetOptions);

  const ref = candidateRef(candidate);
  const builtAt = new Date().toISOString();

  const tiers = await writeTieredBundles({
    target,
    targetOptions,
    candidate,
    ref,
    mainWaterways,
    elevationProfile,
    classification: classificationBundle.classification,
    builtAt
  });

  for (const entry of tiers) writtenManifestEntries.push(entry);

  console.log(`Saved ${target.label} tiers (main + order1${targetOptions.maxOrder >= 2 ? "..." + targetOptions.maxOrder : ""})`);
  await writeManifest(writtenManifestEntries);
}

async function resolveCandidate(target) {
  const queries = Array.from(
    new Set([
      target.name,
      `River ${target.name}`,
      ...(target.searchAliases || [])
    ])
  );
  const matches = [];

  for (const query of queries) {
    const results = await runNominatim(query);
    matches.push(
      ...results
        .filter((place) => {
          return (
            (place.osm_type === "relation" || place.osm_type === "way") &&
            place.category === "waterway" &&
            ["river", "stream", "canal"].includes(place.type)
          );
        })
        .map((place) => ({
          osmType: place.osm_type,
          id: Number(place.osm_id),
          name: place.name || place.display_name?.split(",")[0] || target.name,
          localName: place.display_name || "",
          wikidata: place.extratags?.wikidata || "",
          wikipedia: place.extratags?.wikipedia || "",
          center: place.lat && place.lon ? [Number(place.lat), Number(place.lon)] : null,
          tags: place.extratags || {}
        }))
    );
  }

  const unique = dedupeCandidates(matches);
  const exact = unique.find((candidate) => {
    return candidate.osmType === "relation" && normalizeName(candidate.name) === normalizeName(target.name);
  });

  if (exact) return exact;
  if (unique[0]) return unique[0];
  throw new Error(`No river candidate found for ${target.name}`);
}

async function loadRiverGeometry(candidate, options = defaultOptions) {
  const query =
    candidate.osmType === "relation"
      ? `
        [out:json][timeout:60];
        relation(${candidate.id});
        out body;
        way(r);
        out geom;
      `
      : `
        [out:json][timeout:60];
        way(${candidate.id});
        out tags geom;
      `;

  const data = await runOverpass(query, options);
  return overpassToWaterways(data, candidate);
}

async function loadWaterwaysInBounds(bounds, options = defaultOptions) {
  const query = `
    [out:json][timeout:70];
    way["waterway"~"^(river|stream|canal|drain|ditch)$"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
    out tags geom;
  `;

  const data = await runOverpass(query, options);
  return overpassToWaterways(data);
}

async function buildBasinBundle(candidate, mainWaterways, options = defaultOptions) {
  const bounds = expandBounds(boundsForWaterways(mainWaterways), options.paddingDeg);
  const tiles = splitBounds(bounds, 1);
  const allWaterways = new Map();

  for (const [index, tile] of tiles.entries()) {
    const waterways = await loadWaterwaysInBounds(tile, options);
    waterways.forEach((waterway) => allWaterways.set(waterway.id, waterway));
    if (index < tiles.length - 1) await sleep(700);
  }

  const classification = classifyBasin(Array.from(allWaterways.values()), mainWaterways, {
    toleranceM: options.toleranceM,
    maxOrder: options.maxOrder
  });

  return {
    classification,
    loadedCount: allWaterways.size
  };
}

async function buildElevationProfile(mainWaterways) {
  const endpoints = inferFlowEndpoints(mainWaterways);
  const mergedPath = mergeWaterwaysIntoPath(mainWaterways, endpoints);
  const samples = samplePointsAlongPath(mergedPath, 10);
  return runElevation(samples);
}

async function runOverpass(query, options = defaultOptions) {
  return retryWithBackoff(async () => {
    const { stdout } = await execFileAsync(
      "curl",
      [
        "--silent",
        "--show-error",
        "--max-time",
        "120",
        "-X",
        "POST",
        OVERPASS_ENDPOINT,
        "--data-urlencode",
        `data=${query}`
      ],
      { maxBuffer: LARGE_BUFFER }
    );

    const trimmed = stdout.trim();
    if (!trimmed.startsWith("{")) {
      const error = new Error(trimmed.slice(0, 240));
      error.retryable = true;
      throw error;
    }

    const json = JSON.parse(trimmed);
    if (json.remark) {
      const error = new Error(json.remark);
      error.retryable = true;
      throw error;
    }

    return json;
  }, { attempts: options.attempts, baseDelayMs: 1300, maxDelayMs: 18000 });
}

async function runNominatim(query) {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "--silent",
      "--show-error",
      "--max-time",
      "60",
      "-G",
      NOMINATIM_ENDPOINT,
      "--data-urlencode",
      `q=${query}`,
      "--data",
      "format=jsonv2",
      "--data",
      "limit=10",
      "--data",
      "dedupe=1",
      "--data",
      "extratags=1"
    ],
    { maxBuffer: LARGE_BUFFER }
  );

  return JSON.parse(stdout);
}

async function runElevation(samples) {
  const locations = samples.map((sample) => `${sample.point[0]},${sample.point[1]}`).join("|");
  const { stdout } = await execFileAsync(
    "curl",
    [
      "--silent",
      "--show-error",
      "--max-time",
      "60",
      "-G",
      ELEVATION_ENDPOINT,
      "--data-urlencode",
      `locations=${locations}`
    ],
    { maxBuffer: LARGE_BUFFER }
  );

  const json = JSON.parse(stdout);
  return samples.map((sample, index) => {
    const result = json.results?.[index] || {};
    return {
      ...sample,
      elevationM: Number.isFinite(result.elevation) ? result.elevation : null,
      dataset: result.dataset || ""
    };
  });
}

function overpassToWaterways(data, fallback = null) {
  return data.elements
    .filter((element) => element.type === "way" && element.geometry?.length > 1)
    .map((way) => ({
      id: way.id,
      osmType: "way",
      relationId: fallback?.osmType === "relation" ? fallback.id : null,
      name: way.tags?.name || fallback?.name || way.tags?.waterway || "unnamed waterway",
      waterway: way.tags?.waterway || "river",
      wikidata: way.tags?.wikidata || fallback?.wikidata || "",
      points: way.geometry.map((point) => [point.lat, point.lon]),
      tags: way.tags || {}
    }));
}

function candidateRef(candidate) {
  return `${candidate.osmType}:${candidate.id}`;
}

function dedupeCandidates(candidates) {
  const map = new Map();
  candidates.forEach((candidate) => {
    const key = candidateRef(candidate);
    if (!map.has(key)) map.set(key, candidate);
  });
  return Array.from(map.values());
}

function normalizeName(value) {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function writeTieredBundles(context) {
  const { target, targetOptions, candidate, ref, mainWaterways, elevationProfile, classification, builtAt } = context;
  const direct = classification.direct || [];
  const descendants = classification.descendants || [];
  const directByOrder = direct.filter((waterway) => waterway.basinOrder === 1);
  const descendantsByTier = new Map();
  descendants.forEach((waterway) => {
    const order = waterway.basinOrder;
    if (!descendantsByTier.has(order)) descendantsByTier.set(order, []);
    descendantsByTier.get(order).push(waterway);
  });

  const tiers = [];
  const baseSlug = target.slug.replace(/-(?:order\d+|main)$/, "");

  for (let tier = 0; tier <= targetOptions.maxOrder; tier += 1) {
    const slice = sliceClassificationToTier({ directByOrder, descendantsByTier, tier });
    const tierLabel = tier === 0 ? "main" : `order${tier}`;
    const relativeFile = `data/samples/${baseSlug}-${tierLabel}.json`;
    const bundle = {
      version: 1,
      ref,
      label: `${target.label.replace(/ repo sample$/i, "")} · ${tierLabel}`,
      candidate,
      mainWaterways,
      elevationProfile,
      classification: slice,
      loadedCount: mainWaterways.length + slice.direct.length + slice.descendants.length,
      options: { ...targetOptions, maxOrder: tier },
      tier,
      builtAt,
      sourceLabel: "repo sample",
      continent: target.continent || ""
    };

    await writeFile(resolve(rootDir, relativeFile), JSON.stringify(bundle, null, 2));

    tiers.push({
      ref,
      label: bundle.label,
      file: relativeFile,
      options: bundle.options,
      tier,
      builtAt,
      continent: target.continent || ""
    });
  }

  return tiers;
}

function sliceClassificationToTier({ directByOrder, descendantsByTier, tier }) {
  const direct = tier >= 1 ? directByOrder : [];
  const descendants = [];
  if (tier >= 2) {
    for (let order = 2; order <= tier; order += 1) {
      const list = descendantsByTier.get(order) || [];
      descendants.push(...list);
    }
  }

  return {
    direct,
    descendants,
    stats: {
      directCount: direct.length,
      descendantCount: descendants.length,
      waterwayCount: direct.length + descendants.length,
      directKm: collectionLengthKm(direct),
      descendantKm: collectionLengthKm(descendants),
      totalKm: collectionLengthKm(direct) + collectionLengthKm(descendants)
    }
  };
}

async function writeManifest(newEntries) {
  const manifestPath = resolve(samplesDir, "manifest.json");
  const existing = await readExistingManifest(manifestPath);

  // Drop entries that point to missing files or that we have just rewritten
  const newKeys = new Set(newEntries.map((entry) => entry.file));
  const survivors = [];
  for (const entry of existing.samples || []) {
    if (newKeys.has(entry.file)) continue;
    try {
      await readFile(resolve(rootDir, entry.file));
      survivors.push(entry);
    } catch (error) {
      // file gone — skip
    }
  }

  const manifest = {
    version: 1,
    samples: [...survivors, ...newEntries].sort((a, b) => {
      if (a.ref !== b.ref) return a.ref.localeCompare(b.ref);
      return (a.tier ?? 0) - (b.tier ?? 0);
    })
  };

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

async function readExistingManifest(manifestPath) {
  try {
    return JSON.parse(await readFile(manifestPath, "utf-8"));
  } catch (error) {
    return { version: 1, samples: [] };
  }
}
