const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 700;

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "HttpError";
    this.status = status || 0;
  }
}

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

export async function getJSON(url, { timeout = 20000, signal } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const guard = timeoutSignal(timeout);
    try {
      const response = await fetch(url, { signal: signal || guard.signal });

      if (!response.ok) {
        if (RETRY_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, BACKOFF_MS * attempt));
          continue;
        }
        throw new HttpError(await readError(response), response.status);
      }
      return await response.json();
    } catch (error) {
      if (error.name === "AbortError" && signal && signal.aborted) throw error;
      lastError = error;
      if (attempt >= MAX_ATTEMPTS) break;
      await new Promise(r => setTimeout(r, BACKOFF_MS * attempt));
    } finally {
      guard.done();
    }
  }

  throw lastError instanceof HttpError
    ? lastError
    : new HttpError("Could not reach the network. Check the connection and try again.", 0);
}

async function readError(response) {
  try {
    const body = await response.json();
    return body.status_message || body.error || `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

// Apps Script cannot answer a CORS preflight, and text/plain is the one JSON
// carrier that never triggers one. The script parses the body itself.
export async function postPlain(url, payload, { timeout = 30000 } = {}) {
  const guard = timeoutSignal(timeout);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow",
      signal: guard.signal
    });
    if (!response.ok) throw new HttpError(`The write bridge answered ${response.status}.`, response.status);
    return await response.json();
  } finally {
    guard.done();
  }
}
