import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { classifyBasin } from "../src/geo/classifier.js";
import {
  boundsForWaterways,
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

const sampleOptions = {
  toleranceM: 900,
  maxOrder: 2,
  paddingDeg: 0.25,
  attempts: 6
};

const targets = [
  {
    name: "Mureș",
    slug: "mures-order2",
    label: "Mureș repo sample"
  },
  {
    name: "Olt",
    slug: "olt-order2",
    label: "Olt repo sample"
  }
];

const requestedTargets = new Set(process.argv.slice(2).map((value) => value.toLocaleLowerCase()));
const activeTargets = requestedTargets.size
  ? targets.filter((target) => requestedTargets.has(target.slug) || requestedTargets.has(target.name.toLocaleLowerCase()))
  : targets;

await mkdir(samplesDir, { recursive: true });

for (const target of activeTargets) {
  console.log(`Building ${target.label}...`);
  const candidate = await resolveCandidate(target);
  const mainWaterways = await loadRiverGeometry(candidate);
  const elevationProfile = await buildElevationProfile(mainWaterways);
  const classificationBundle = await buildBasinBundle(candidate, mainWaterways);

  const bundle = {
    version: 1,
    ref: candidateRef(candidate),
    label: target.label,
    candidate,
    mainWaterways,
    elevationProfile,
    classification: classificationBundle.classification,
    loadedCount: classificationBundle.loadedCount,
    options: sampleOptions,
    builtAt: new Date().toISOString(),
    sourceLabel: "repo sample"
  };

  const relativeFile = `data/samples/${target.slug}.json`;
  await writeFile(resolve(rootDir, relativeFile), JSON.stringify(bundle, null, 2));

  console.log(`Saved ${target.label}`);
}

await writeManifest();

async function resolveCandidate(target) {
  const queries = [target.name, `River ${target.name}`];
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

async function loadRiverGeometry(candidate) {
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

  const data = await runOverpass(query);
  return overpassToWaterways(data, candidate);
}

async function loadWaterwaysInBounds(bounds) {
  const query = `
    [out:json][timeout:70];
    way["waterway"~"^(river|stream|canal|drain|ditch)$"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
    out tags geom;
  `;

  const data = await runOverpass(query);
  return overpassToWaterways(data);
}

async function buildBasinBundle(candidate, mainWaterways) {
  const bounds = expandBounds(boundsForWaterways(mainWaterways), sampleOptions.paddingDeg);
  const tiles = splitBounds(bounds, 1);
  const allWaterways = new Map();

  for (const [index, tile] of tiles.entries()) {
    const waterways = await loadWaterwaysInBounds(tile);
    waterways.forEach((waterway) => allWaterways.set(waterway.id, waterway));
    if (index < tiles.length - 1) await sleep(700);
  }

  const classification = classifyBasin(Array.from(allWaterways.values()), mainWaterways, {
    toleranceM: sampleOptions.toleranceM,
    maxOrder: sampleOptions.maxOrder
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

async function runOverpass(query) {
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
  }, { attempts: sampleOptions.attempts, baseDelayMs: 1300, maxDelayMs: 18000 });
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

async function writeManifest() {
  const manifest = {
    version: 1,
    samples: []
  };

  for (const target of targets) {
    const relativeFile = `data/samples/${target.slug}.json`;

    try {
      const bundle = JSON.parse(await readFile(resolve(rootDir, relativeFile), "utf-8"));
      manifest.samples.push({
        ref: bundle.ref,
        label: target.label,
        file: relativeFile,
        options: bundle.options,
        builtAt: bundle.builtAt
      });
    } catch (error) {
      // Ignore samples that have not been generated yet.
    }
  }

  await writeFile(resolve(samplesDir, "manifest.json"), JSON.stringify(manifest, null, 2));
}
