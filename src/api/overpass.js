import { NOMINATIM_ENDPOINT, OVERPASS_ENDPOINT, WATERWAY_PATTERN } from "../config.js";
import { retryWithBackoff, sleep } from "./retry.js";

const SEARCH_TAGS = ["name", "name:en", "int_name", "official_name", "alt_name", "loc_name"];
const RIVER_WORDS = [
  "river",
  "rio",
  "río",
  "raul",
  "râul",
  "fluviu",
  "fleuve",
  "fluss",
  "rivier",
  "rzeka"
];

export function escapeOverpassRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function escapeOverpassString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function runOverpass(query, options = {}) {
  const attempts = options.attempts ?? 6;
  return retryWithBackoff(
    async () => {
      const response = await fetch(OVERPASS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body: new URLSearchParams({ data: query })
      });

      if (!response.ok) {
        const error = new Error(`Overpass request failed with ${response.status}`);
        error.retryable = response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504;
        const retryAfter = Number.parseFloat(response.headers.get("retry-after"));
        if (Number.isFinite(retryAfter)) error.retryAfterMs = retryAfter * 1000;
        throw error;
      }

      return response.json();
    },
    {
      attempts,
      baseDelayMs: 1100,
      maxDelayMs: 18000,
      onAttempt: options.onAttempt
    }
  );
}

export async function runNominatim(query, options = {}) {
  const attempts = options.attempts ?? 6;
  const url = new URL(NOMINATIM_ENDPOINT);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "10");
  url.searchParams.set("dedupe", "1");
  url.searchParams.set("extratags", "1");

  return retryWithBackoff(
    async () => {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        const error = new Error(`Nominatim request failed with ${response.status}`);
        error.retryable = response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504;
        const retryAfter = Number.parseFloat(response.headers.get("retry-after"));
        if (Number.isFinite(retryAfter)) error.retryAfterMs = retryAfter * 1000;
        throw error;
      }

      return response.json();
    },
    {
      attempts,
      baseDelayMs: 1300,
      maxDelayMs: 18000,
      onAttempt: options.onAttempt
    }
  );
}

export async function searchRivers(name, options = {}) {
  const exactCandidates = await searchRiversByExactTags(name, options);
  let nominatimCandidates = [];

  if (!exactCandidates.some((candidate) => candidate.osmType === "relation")) {
    try {
      nominatimCandidates = await searchRiversByNominatim(name, options);
    } catch (error) {
      if (!exactCandidates.length) throw error;
    }
  }

  return mergeCandidates([...exactCandidates, ...nominatimCandidates], name).slice(0, 20);
}

export function candidateRef(candidate) {
  return `${candidate.osmType}:${candidate.id}`;
}

export function parseCandidateRef(ref) {
  const [osmType, rawId] = String(ref).split(":");
  return {
    osmType,
    id: Number.parseInt(rawId, 10)
  };
}

async function searchRiversByExactTags(name, options = {}) {
  const clauses = buildNameVariants(name)
    .flatMap((variant) =>
      SEARCH_TAGS.flatMap((tag) => {
        const escaped = escapeOverpassString(variant);
        return [
          `relation["waterway"="river"]["${tag}"="${escaped}"];`,
          `way["waterway"="river"]["${tag}"="${escaped}"];`
        ];
      })
    )
    .join("\n");

  const query = `
    [out:json][timeout:35];
    (
      ${clauses}
    );
    out tags center 40;
  `;
  const data = await runOverpass(query, options);
  return data.elements
    .filter((element) => element.tags?.name)
    .map((element) => mapElementToCandidate(element, "overpass"));
}

async function searchRiversByNominatim(name, options = {}) {
  const queries = buildNominatimQueries(name);
  const candidates = [];

  for (const [index, query] of queries.entries()) {
    const data = await runNominatim(query, options);
    candidates.push(...data.filter(isNominatimRiver).map(nominatimToCandidate));
    if (index < queries.length - 1) await sleep(1100);
  }

  return candidates;
}

function scoreCandidate(searchName, candidate) {
  const query = normalizeRiverName(searchName);
  const name = normalizeRiverName(candidate.name);
  let score = 0;
  if (name === query) score += 0;
  else if (name.includes(query)) score += 10;
  else score += 20;

  if (candidate.osmType !== "relation") score += 6;
  if (!candidate.wikidata) score += 2;
  if (!candidate.wikipedia) score += 1;
  return score;
}

function buildNameVariants(name) {
  const trimmed = name.trim();
  const variants = [
    trimmed,
    `River ${trimmed}`,
    `${trimmed} River`,
    `Rio ${trimmed}`,
    `${trimmed} Rio`,
    `Río ${trimmed}`,
    `${trimmed} Río`
  ];
  return uniqueStrings(variants);
}

function buildNominatimQueries(name) {
  const trimmed = name.trim();
  const normalized = normalizeRiverName(trimmed);
  const variants = [trimmed];
  if (normalized === normalizeSearchText(trimmed)) variants.push(`River ${trimmed}`);
  return uniqueStrings(variants);
}

function isNominatimRiver(place) {
  return (
    (place.osm_type === "relation" || place.osm_type === "way") &&
    place.category === "waterway" &&
    ["river", "stream", "canal"].includes(place.type)
  );
}

function nominatimToCandidate(place) {
  const tags = place.extratags || {};
  return {
    osmType: place.osm_type,
    id: Number(place.osm_id),
    name: place.name || place.display_name?.split(",")[0] || "Unnamed river",
    localName: place.display_name || "",
    wikidata: tags.wikidata || "",
    wikipedia: tags.wikipedia || "",
    center: place.lat && place.lon ? [Number(place.lat), Number(place.lon)] : null,
    tags,
    source: "nominatim"
  };
}

function mergeCandidates(candidates, searchName) {
  const merged = new Map();
  candidates.forEach((candidate) => {
    const key = `${candidate.osmType}:${candidate.id}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, candidate);
      return;
    }
    merged.set(key, {
      ...existing,
      ...candidate,
      wikidata: existing.wikidata || candidate.wikidata,
      wikipedia: existing.wikipedia || candidate.wikipedia,
      localName: existing.localName || candidate.localName,
      tags: { ...candidate.tags, ...existing.tags },
      source: `${existing.source}+${candidate.source}`
    });
  });

  return Array.from(merged.values()).sort(
    (a, b) => scoreCandidate(searchName, a) - scoreCandidate(searchName, b) || a.name.localeCompare(b.name)
  );
}

function normalizeRiverName(value) {
  let normalized = normalizeSearchText(value);
  RIVER_WORDS.forEach((word) => {
    normalized = normalized.replace(new RegExp(`(^| )${normalizeSearchText(word)}( |$)`, "g"), " ");
  });
  return normalized.replace(/\s+/g, " ").trim();
}

function normalizeSearchText(value) {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export async function loadRiverGeometry(candidate, options = {}) {
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

export async function loadRiverCandidateByRef(ref, options = {}) {
  const parsed = parseCandidateRef(ref);
  const query = `
    [out:json][timeout:30];
    ${parsed.osmType}(${parsed.id});
    out body;
  `;
  const data = await runOverpass(query, options);
  const element = data.elements?.[0];
  if (!element) throw new Error(`Unable to load river ${ref}`);
  return mapElementToCandidate(element, "overpass");
}

export async function loadWaterwaysInBounds(bounds, options = {}) {
  const query = `
    [out:json][timeout:70];
    way["waterway"~"${WATERWAY_PATTERN}"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
    out tags geom;
  `;
  const data = await runOverpass(query, options);
  return overpassToWaterways(data);
}

export function overpassToWaterways(data, fallback = null) {
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

function mapElementToCandidate(element, source) {
  return {
    osmType: element.type,
    id: element.id,
    name: element.tags.name,
    localName: element.tags["name:en"] || element.tags["name:ro"] || element.tags["name:hu"] || "",
    wikidata: element.tags.wikidata || "",
    wikipedia: element.tags.wikipedia || "",
    center: element.center ? [element.center.lat, element.center.lon] : null,
    tags: element.tags,
    source
  };
}
