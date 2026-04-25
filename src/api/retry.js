export function clampAttempts(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 6;
  return Math.max(4, Math.min(9, parsed));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryWithBackoff(task, options = {}) {
  const attempts = clampAttempts(options.attempts);
  const baseDelayMs = options.baseDelayMs ?? 900;
  const maxDelayMs = options.maxDelayMs ?? 12000;
  const factor = options.factor ?? 1.85;
  const jitter = options.jitter ?? 0.35;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      options.onAttempt?.({ attempt, attempts, phase: "try" });
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || error?.retryable === false) break;

      const retryAfterMs = Number.isFinite(error?.retryAfterMs) ? error.retryAfterMs : 0;
      const backoff = Math.min(maxDelayMs, baseDelayMs * factor ** (attempt - 1));
      const randomJitter = backoff * jitter * Math.random();
      const delayMs = Math.max(retryAfterMs, backoff + randomJitter);
      options.onAttempt?.({ attempt, attempts, phase: "wait", delayMs, error });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

