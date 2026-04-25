import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { collectionLengthKm } from "../src/geo/geometry.js";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const samplesDir = resolve(rootDir, "data", "samples");

const inputs = process.argv.slice(2);
const targets = inputs.length
  ? inputs.map((value) => resolve(samplesDir, value.endsWith(".json") ? value : `${value}.json`))
  : await defaultBundles();

if (!targets.length) {
  console.log("No bundles found in data/samples to slice.");
  process.exit(0);
}

const writtenEntries = [];
const obsoleteFiles = [];

for (const file of targets) {
  console.log(`Slicing ${file.replace(rootDir + "/", "")}...`);
  const bundle = JSON.parse(await readFile(file, "utf-8"));
  const tiers = await sliceBundle(bundle);
  writtenEntries.push(...tiers);

  // If the source file uses the legacy {slug}-orderN.json naming and a tier file with the
  // same maxOrder already replaces it, mark the source as obsolete.
  const replacement = tiers.find((entry) => entry.options.maxOrder === bundle.options?.maxOrder);
  if (replacement && resolve(rootDir, replacement.file) !== file) {
    obsoleteFiles.push(file);
  }
}

for (const file of obsoleteFiles) {
  console.log(`Removing legacy file ${file.replace(rootDir + "/", "")}`);
  await unlink(file).catch(() => {});
}

await mergeManifest(writtenEntries);
console.log(`Wrote ${writtenEntries.length} tier entries.`);

async function sliceBundle(bundle) {
  const direct = bundle.classification?.direct || [];
  const descendants = bundle.classification?.descendants || [];
  const directOrder1 = direct.filter((waterway) => (waterway.basinOrder ?? 1) === 1);
  const descendantsByTier = new Map();
  descendants.forEach((waterway) => {
    const order = waterway.basinOrder ?? 2;
    if (!descendantsByTier.has(order)) descendantsByTier.set(order, []);
    descendantsByTier.get(order).push(waterway);
  });

  const maxOrder = bundle.options?.maxOrder ?? 1;
  const builtAt = bundle.builtAt || new Date().toISOString();
  const baseSlug = inferBaseSlug(bundle);
  const tiers = [];

  for (let tier = 0; tier <= maxOrder; tier += 1) {
    const slice = sliceClassificationToTier({ directOrder1, descendantsByTier, tier });
    const tierLabel = tier === 0 ? "main" : `order${tier}`;
    const relativeFile = `data/samples/${baseSlug}-${tierLabel}.json`;
    const baseLabel = (bundle.label || bundle.candidate?.name || baseSlug).replace(/ ?repo sample.*$/i, "").replace(/ ?·.*$/, "").trim();
    const tierBundle = {
      version: 1,
      ref: bundle.ref,
      label: `${baseLabel} · ${tierLabel}`,
      candidate: bundle.candidate,
      mainWaterways: bundle.mainWaterways,
      elevationProfile: bundle.elevationProfile,
      classification: slice,
      loadedCount: (bundle.mainWaterways?.length || 0) + slice.direct.length + slice.descendants.length,
      options: { ...(bundle.options || {}), maxOrder: tier },
      tier,
      builtAt,
      sourceLabel: "repo sample"
    };

    await writeFile(resolve(rootDir, relativeFile), JSON.stringify(tierBundle, null, 2));

    tiers.push({
      ref: bundle.ref,
      label: tierBundle.label,
      file: relativeFile,
      options: tierBundle.options,
      tier,
      builtAt
    });
  }

  return tiers;
}

function sliceClassificationToTier({ directOrder1, descendantsByTier, tier }) {
  const direct = tier >= 1 ? directOrder1 : [];
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

function inferBaseSlug(bundle) {
  const candidate = (bundle.label || "").toLocaleLowerCase().split(/\s+/)[0];
  if (candidate && /[a-z]/.test(candidate)) {
    return candidate
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  const ref = bundle.ref || "river";
  return ref.replace(/[^a-z0-9]+/gi, "-").toLocaleLowerCase();
}

async function defaultBundles() {
  const files = await readdir(samplesDir);
  return files
    .filter((name) => name.endsWith(".json") && name !== "manifest.json")
    .filter((name) => !name.endsWith("-main.json"))
    .map((name) => resolve(samplesDir, name));
}

async function mergeManifest(newEntries) {
  const manifestPath = resolve(samplesDir, "manifest.json");
  let existing = { version: 1, samples: [] };
  try {
    existing = JSON.parse(await readFile(manifestPath, "utf-8"));
  } catch (error) {
    // start fresh
  }

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
