import { checksFor, services } from './services.mjs';

const timeoutMs = 7_000;
const slowAfterMs = 2_500;
const redirectStatuses = [301, 302, 303, 307, 308];

async function readBody(response, { limit, stopAtTitle = false }) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let remaining = limit;
  let text = '';

  try {
    while (remaining > 0) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      const chunk = value.subarray(0, remaining);
      text += decoder.decode(chunk, { stream: true });
      remaining -= chunk.length;
      if (stopAtTitle && /<\/title\s*>/i.test(text)) break;
    }
    return text + decoder.decode();
  } finally {
    void reader.cancel().catch(() => {});
  }
}

function matchesRedirect(response, check) {
  const location = response.headers.get('location');
  if (!location || !redirectStatuses.includes(response.status)) return false;
  try {
    return new URL(location, check.url).href === check.redirectTo;
  } catch {
    return false;
  }
}

async function inspectResponse(response, check) {
  if (response.headers.get('cf-mitigated') === 'challenge') {
    return { status: 'unknown', detail: 'access_blocked' };
  }
  if (check.redirectTo) {
    return matchesRedirect(response, check) ? null : { status: 'outage', detail: 'unexpected_response' };
  }
  if (!response.ok) return { status: 'outage', detail: 'http_error' };

  const contentType = response.headers.get('content-type') ?? '';
  if (check.title && /^text\/html\b/i.test(contentType)) {
    const body = await readBody(response, { limit: 65_536, stopAtTitle: true });
    const title = body.match(/<title(?:\s[^>]*)?>([^<]*)<\/title\s*>/i)?.[1]?.trim();
    if (title && check.title.test(title)) return null;
  }
  if (check.json && /^application\/json\b/i.test(contentType)) {
    const body = await readBody(response, { limit: 524_288 });
    try {
      if (check.json(JSON.parse(body))) return null;
    } catch {
      // Treat malformed JSON like any other unexpected response.
    }
  }
  return { status: 'outage', detail: 'unexpected_response' };
}

async function probe(check, fetcher, external) {
  const started = Date.now();
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      resolve({ status: 'outage', detail: 'timeout' });
      controller.abort();
    }, timeoutMs);
  });

  const request = async () => {
    let response;
    try {
      response = await fetcher(check.url, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        headers: { 'User-Agent': `KooMean-Status/1.0 (${external ? 'external' : 'worker'})` },
        signal: controller.signal,
      });
      return await inspectResponse(response, check);
    } catch {
      return { status: 'outage', detail: controller.signal.aborted ? 'timeout' : 'network_error' };
    } finally {
      if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
    }
  };

  const failure = await Promise.race([deadline, request()]);
  clearTimeout(timer);
  const latencyMs = Math.max(0, Date.now() - started);
  if (failure) return { ...failure, latencyMs };
  if (latencyMs >= slowAfterMs) return { status: 'degraded', detail: 'slow_response', latencyMs };
  return { status: 'operational', detail: 'reachable', latencyMs };
}

function summarize(results) {
  const outage = results.find((result) => result.status === 'outage');
  if (outage) {
    if (results.every((result) => result.status === 'outage')) return outage;
    return { status: 'degraded', detail: 'partial_failure' };
  }
  return results.find((result) => result.status === 'unknown')
    ?? results.find((result) => result.status === 'degraded')
    ?? results[0]
    ?? { status: 'unknown', detail: 'not_configured' };
}

export async function runChecks({ fetcher = fetch, env = {}, external = false } = {}) {
  const plans = services.map((service) => ({ service, checks: checksFor(service, env), results: [] }));
  const queue = plans.flatMap((plan) => plan.checks.map((check, index) => ({ plan, check, index })));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(5, queue.length) }, async () => {
    while (next < queue.length) {
      const { plan, check, index } = queue[next++];
      plan.results[index] = await probe(check, fetcher, external);
    }
  }));
  return plans.map(({ service, results }) => {
    const { status, detail } = summarize(results);
    return {
      id: service.id,
      status,
      checkedAt: new Date().toISOString(),
      latencyMs: results.length ? Math.max(...results.map((result) => result.latencyMs)) : null,
      detail,
    };
  });
}
