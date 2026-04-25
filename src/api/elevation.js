import { retryWithBackoff } from "./retry.js";

const OPENTOPO_ENDPOINT = "https://api.opentopodata.org/v1/aster30m";

export async function loadElevationProfile(samples, options = {}) {
  const attempts = options.attempts ?? 6;
  const url = new URL(OPENTOPO_ENDPOINT);
  url.searchParams.set(
    "locations",
    samples.map((sample) => `${sample.point[0]},${sample.point[1]}`).join("|")
  );

  const data = await retryWithBackoff(
    async () => {
      const response = await fetch(url);

      if (!response.ok) {
        const error = new Error(`Elevation request failed with ${response.status}`);
        error.retryable = response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504;
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

  return samples.map((sample, index) => {
    const result = data.results?.[index] || {};
    return {
      ...sample,
      elevationM: Number.isFinite(result.elevation) ? result.elevation : null,
      dataset: result.dataset || ""
    };
  });
}
