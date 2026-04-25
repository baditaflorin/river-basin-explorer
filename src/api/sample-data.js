import { SAMPLE_MANIFEST_PATH } from "../config.js";

let manifestPromise;

export async function loadSampleManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(SAMPLE_MANIFEST_PATH)
      .then((response) => {
        if (!response.ok) throw new Error("Sample manifest not available");
        return response.json();
      })
      .catch(() => ({ version: 1, samples: [] }));
  }

  return manifestPromise;
}

export async function loadSampleBundle(entry) {
  const response = await fetch(entry.file);
  if (!response.ok) throw new Error(`Sample bundle unavailable for ${entry.label}`);
  return response.json();
}

export function findSampleEntry(manifest, ref, options = {}) {
  return (manifest?.samples || []).find((entry) => {
    return (
      entry.ref === ref &&
      Number(entry.options?.maxOrder) === Number(options.maxOrder) &&
      Number(entry.options?.toleranceM) === Number(options.toleranceM) &&
      Number(entry.options?.paddingDeg) === Number(options.paddingDeg)
    );
  });
}
