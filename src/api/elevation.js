import { retryWithBackoff } from "./retry.js";

const OPENTOPO_BASE = "https://api.opentopodata.org/v1";
const FALLBACK_DATASETS = ["aster30m", "srtm30m", "srtm90m", "eudem25m"];

export async function loadElevationProfile(samples, options = {}) {
  const attempts = options.attempts ?? 6;
  const datasets = options.datasets ?? FALLBACK_DATASETS;
  const locations = samples.map((sample) => `${sample.point[0]},${sample.point[1]}`).join("|");
  let lastError = null;

  for (const dataset of datasets) {
    const url = new URL(`${OPENTOPO_BASE}/${dataset}`);
    url.searchParams.set("locations", locations);

    try {
      const data = await retryWithBackoff(
        async () => {
          const response = await fetch(url);

          if (!response.ok) {
            const error = new Error(`Elevation request failed with ${response.status}`);
            error.retryable =
              response.status === 429 ||
              response.status === 502 ||
              response.status === 503 ||
              response.status === 504;
            throw error;
          }

          return response.json();
        },
        {
          attempts,
          baseDelayMs: 1100,
          maxDelayMs: 18000,
          onAttempt: options.onAttempt
            ? (info) => options.onAttempt({ ...info, dataset })
            : undefined
        }
      );

      return samples.map((sample, index) => {
        const result = data.results?.[index] || {};
        return {
          ...sample,
          elevationM: Number.isFinite(result.elevation) ? result.elevation : null,
          dataset: result.dataset || dataset
        };
      });
    } catch (error) {
      lastError = error;
      options.onAttempt?.({ phase: "dataset-fail", dataset, error });
    }
  }

  throw lastError ?? new Error("Elevation lookup failed");
}
