import { DATA_CACHE_NAME } from "../config.js";

export async function readCachedJson(key, options = {}) {
  if (!supportsDataCache()) return null;

  const cache = await caches.open(DATA_CACHE_NAME);
  const response = await cache.match(cacheRequest(key));
  if (!response) return null;

  const payload = await response.json();
  const maxAgeMs = options.maxAgeMs ?? Number.POSITIVE_INFINITY;
  if (Date.now() - payload.savedAt > maxAgeMs) return null;
  return payload.data;
}

export async function writeCachedJson(key, data, meta = {}) {
  if (!supportsDataCache()) return false;

  const cache = await caches.open(DATA_CACHE_NAME);
  const response = new Response(
    JSON.stringify({
      key,
      savedAt: Date.now(),
      meta,
      data
    }),
    {
      headers: {
        "Content-Type": "application/json"
      }
    }
  );

  await cache.put(cacheRequest(key), response);
  return true;
}

export async function clearCachedData() {
  if (!supportsDataCache()) return false;
  return caches.delete(DATA_CACHE_NAME);
}

export function supportsDataCache() {
  return typeof caches !== "undefined";
}

function cacheRequest(key) {
  return new Request(`https://river-basin-cache.local/${encodeURIComponent(key)}`);
}
