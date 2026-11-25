import { checksFor, services } from './services.mjs';
import { validReopenAt } from './check-details.mjs';

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
  const contentType = response.headers.get('content-type') ?? '';
  if (response.status === 503 && check.sharedMaintenance && /^application\/json\b/i.test(contentType)) {
    const body = await readBody(response, { limit: 16_384 });
    try {
      const message = JSON.parse(body);
      if (message?.error === 'maintenance' && message?.maintenance?.active === true) {
        return { status: 'maintenance', detail: 'upstream_maintenance', reopenAt: validReopenAt(message.maintenance.reopenAt) };
      }
    } catch {
      // Invalid error bodies still represent an unsuccessful HTTP response.
    }
  }
  if ((check.title || check.maintenanceTitle) && /^text\/html\b/i.test(contentType)) {
    const isMaintenanceResponse = response.status === 503 && Boolean(check.maintenanceTitle);
    const body = await readBody(response, { limit: isMaintenanceResponse ? 16_384 : 65_536, stopAtTitle: !isMaintenanceResponse });
    const title = body.match(/<title(?:\s[^>]*)?>([^<]*)<\/title\s*>/i)?.[1]?.trim();
    if (title && isMaintenanceResponse && check.maintenanceTitle.test(title)) {
      const until = body.match(/<body\b[^>]*\bdata-until=["'](\d{10,16})["']/i)?.[1];
      return { status: 'maintenance', detail: 'upstream_maintenance', reopenAt: validReopenAt(Number(until)) };
    }
    if (title && response.ok && check.title?.test(title)) return null;
  }
  if (check.redirectTo && matchesRedirect(response, check)) return null;
  if (!response.ok && !redirectStatuses.includes(response.status)) return { status: 'outage', detail: 'http_error' };
  if (response.ok && check.json && /^application\/json\b/i.test(contentType)) {
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
  if (!check.url) return { status: 'unknown', detail: 'not_configured', latencyMs: null };
  const started = Date.now();
  const controller = new AbortController();
  let timer;
  let httpStatus;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      resolve({ status: 'outage', detail: 'timeout' });
      controller.abort();
    }, timeoutMs);
  });

  const request = async () => {
    let response;
    try {
      const url = new URL(check.url);
      if (check.fresh) url.searchParams.set('status_probe', crypto.randomUUID());
      response = await fetcher(url.href, {
        cache: 'no-store',
        method: check.method ?? 'GET',
        redirect: 'manual',
        credentials: 'omit',
        headers: { 'User-Agent': `KooMean-Status/1.0 (${external ? 'external' : 'worker'})` },
        signal: controller.signal,
      });
      httpStatus = response.status;
      return await inspectResponse(response, check);
    } catch {
      return { status: 'outage', detail: controller.signal.aborted ? 'timeout' : 'network_error' };
    } finally {
      if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
    }
  };

  const result = await Promise.race([deadline, request()]);
  clearTimeout(timer);
  const latencyMs = Math.max(0, Date.now() - started);
  const observation = { latencyMs, ...(httpStatus && { httpStatus }) };
  if (result) return { ...result, ...observation };
  if (latencyMs >= slowAfterMs) return { ...observation, status: 'degraded', detail: 'slow_response' };
  return { ...observation, status: 'operational', detail: 'reachable' };
}

function summarize(results) {
  const configured = results.filter((result) => result.detail !== 'not_configured');
  const maintenance = configured.find((result) => result.status === 'maintenance');
  if (maintenance && configured.some((result) => ['operational', 'degraded'].includes(result.status))) return maintenance;
  const outage = configured.find((result) => result.status === 'outage');
  if (outage) {
    if (configured.every((result) => result.status === 'outage')) return outage;
    return { status: 'degraded', detail: 'partial_failure' };
  }
  return maintenance
    ?? configured.find((result) => result.status === 'unknown')
    ?? configured.find((result) => result.status === 'degraded')
    ?? configured[0]
    ?? { status: 'unknown', detail: 'not_configured' };
}

export async function runChecks({ fetcher = fetch, env = {}, external = false } = {}) {
  const plans = services.map((service) => ({ id: service.id, checks: checksFor(service, env) }));
  const queue = [...new Set(plans.flatMap((plan) => plan.checks))];
  const observations = new Map();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(5, queue.length) }, async () => {
    while (next < queue.length) {
      const check = queue[next++];
      observations.set(check, await probe(check, fetcher, external));
    }
  }));
  const checkedAt = new Date().toISOString();
  return plans.map(({ id, checks }) => {
    const results = checks.map((check) => observations.get(check));
    const { status, detail } = summarize(results);
    const latencies = results.map((result) => result.latencyMs).filter(Number.isFinite);
    return {
      id,
      status,
      checkedAt,
      latencyMs: latencies.length ? Math.max(...latencies) : null,
      detail,
      checks: checks.map((check) => {
        const { status, detail, httpStatus, reopenAt } = observations.get(check);
        return { id: check.id, status, reason: detail, ...(httpStatus && { httpStatus }), ...(reopenAt && { reopenAt }) };
      }),
    };
  });
}
