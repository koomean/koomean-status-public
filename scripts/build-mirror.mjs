import { appendFile, copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runChecks } from '../src/monitor.mjs';
import { services } from '../src/services.mjs';

const minute = 60_000;
const day = 1_440 * minute;
const historyDays = 30;
const staleAfterMinutes = 24;
const sampleSlot = 5 * minute;
const timestamp = (date) => Date.parse(date);
const iso = (time) => new Date(time).toISOString();
const thaiDate = (time) => iso(time + 7 * 60 * minute).slice(0, 10);
const checkStates = ['operational', 'degraded', 'outage'];
const knownServices = new Set(services.map(({ id }) => id));
const assets = ['index.html', 'styles.css', 'status.js', 'status-icon.png'];
const primaryDefault = 'https://status.koomean.com/';
const mirrorDefault = 'https://koomean.github.io/koomean-status-public/';

function publicNotice(notice) {
  if (!notice || typeof notice.id !== 'string' || typeof notice.title !== 'string' || typeof notice.body !== 'string') return null;
  const { id, title, body, components } = notice;
  const affected = Array.isArray(components) ? components.filter((id) => knownServices.has(id)) : [];
  return affected.length ? { id, title, body, components: affected } : null;
}

function incidentsFrom(snapshot, now) {
  return (snapshot?.incidents ?? []).flatMap((incident) => {
    const notice = publicNotice(incident);
    if (!notice) return [];
    const { status, startedAt, updatedAt, resolvedAt, updates } = incident;
    if (!Number.isFinite(timestamp(startedAt)) || !Number.isFinite(timestamp(updatedAt))) return [];
    if (resolvedAt != null && !(timestamp(resolvedAt) >= now - 90 * day)) return [];
    const history = (Array.isArray(updates) ? updates : []).filter((item) =>
      typeof item?.body === 'string' && typeof item.status === 'string' && Number.isFinite(timestamp(item.createdAt))
    ).map(({ body, status, createdAt }) => ({ body, status, createdAt }));
    return [{ ...notice, status, startedAt, updatedAt, resolvedAt: resolvedAt ?? null, updates: history }];
  });
}

function maintenanceFrom(snapshot, now) {
  return (snapshot?.maintenance ?? []).flatMap((item) => {
    const notice = publicNotice(item);
    if (!notice) return [];
    const { startsAt, endsAt } = item;
    return timestamp(endsAt) > now && timestamp(startsAt) < timestamp(endsAt) ? [{ ...notice, startsAt, endsAt }] : [];
  });
}

function historyFor({ prior, check, previous, primary, now }) {
  const priorDays = new Map((Array.isArray(prior?.days) ? prior.days : []).map((entry) => [entry?.date, entry]));
  const inherited = new Map();
  for (const component of [previous, primary]) {
    for (const { date, status } of Array.isArray(component?.days) ? component.days.filter(Boolean) : []) {
      if (checkStates.includes(status)) inherited.set(date, status);
    }
  }
  const counts = [];
  let available = 0;
  let total = 0;
  const dates = Array.from({ length: historyDays }, (_, index) => thaiDate(now - (historyDays - 1 - index) * day));
  const days = dates.map((date) => {
    const last = priorDays.get(date);
    const slot = check && Math.floor(timestamp(check.checkedAt) / sampleSlot);
    const entry = { date, slot: Number.isInteger(last?.slot) ? last.slot : -1 };
    for (const status of checkStates) entry[status] = Number.isInteger(last?.[status]) && last[status] >= 0 && last[status] <= 288 ? last[status] : 0;
    if (slot > entry.slot && checkStates.includes(check.status) && thaiDate(timestamp(check.checkedAt)) === date) {
      entry[check.status]++;
      entry.slot = slot;
    }
    const seen = entry.operational + entry.degraded + entry.outage;
    if (!seen) return { date, status: inherited.get(date) ?? 'unknown' };
    counts.push(entry);
    available += entry.operational + entry.degraded;
    total += seen;
    let status = entry.outage === seen ? 'outage' : entry.outage || entry.degraded ? 'degraded' : 'operational';
    const earlier = inherited.get(date);
    if (earlier && earlier !== status) status = 'degraded';
    return { date, status };
  });
  return { days, counts, uptime: total ? Math.round(available * 10_000 / total) / 100 : null };
}

export function createSnapshot({ observations, primary, previous, now = Date.now() }) {
  const annunciations = primary && (!previous || timestamp(primary.generatedAt) >= timestamp(previous.generatedAt)) ? primary : previous;
  const incidents = incidentsFrom(annunciations, now);
  const maintenance = maintenanceFrom(annunciations, now);
  const checking = new Map(observations.filter(({ checkedAt, status }) =>
    timestamp(checkedAt) >= now - staleAfterMinutes * minute && timestamp(checkedAt) <= now + minute &&
    (checkStates.includes(status) || status === 'unknown')
  ).map((check) => [check.id, check]));
  const history = {};
  const components = services.map(({ id, name, group, description }) => {
    const check = checking.get(id);
    const prior = previous?.mirrorHistory?.[id];
    const checkedAt = check?.checkedAt ?? null;
    const { days, counts, uptime } = historyFor({
      prior, check, now,
      previous: previous?.components.find((item) => item?.id === id),
      primary: primary?.components.find((item) => item?.id === id),
    });
    const last = prior?.latest;
    const checkTime = timestamp(checkedAt);
    let status = check?.status ?? 'unknown';
    if (status === 'outage') {
      const previousTime = timestamp(last?.checkedAt);
      const freshFailure = last?.status === 'outage' && checkTime - previousTime <= staleAfterMinutes * minute &&
        Math.floor(previousTime / sampleSlot) < Math.floor(checkTime / sampleSlot);
      if (!freshFailure) status = 'degraded';
    }
    history[id] = { days: counts, latest: check ? { status: check.status, checkedAt } : null };
    if (maintenance.some((notice) => timestamp(notice.startsAt) <= now && notice.components.includes(id))) status = 'maintenance';
    else if (['operational', 'unknown'].includes(status) && incidents.some((incident) => !incident.resolvedAt && incident.components.includes(id))) status = 'degraded';
    return { id, name, group, description, status, checkedAt, days, uptime };
  });
  return { generatedAt: iso(now), staleAfterMinutes, components, incidents, maintenance, mirrorHistory: history };
}

function httpsBase(configured, fallback) {
  try {
    const url = new URL(configured || fallback);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url;
  } catch {
    return null;
  }
}

async function loadSnapshot(fetcher, base, path, now) {
  if (!base) return null;
  const url = new URL(path, base);
  url.searchParams.set('refresh', String(now));
  try {
    const response = await fetcher(url, {
      redirect: 'error', signal: AbortSignal.timeout(4_000), headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (Number.isFinite(timestamp(body?.generatedAt)) && timestamp(body.generatedAt) <= now + minute &&
      Array.isArray(body.components) && Array.isArray(body.incidents) && Array.isArray(body.maintenance)) return body;
  } catch {
    return null;
  }
  return null;
}

async function sendReport(fetcher, base, token, checks) {
  if (!token) return 'disabled';
  if (!base) return 'failed';
  try {
    const response = await fetcher(new URL('api/report', base), {
      method: 'POST', signal: AbortSignal.timeout(4_000), redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ checks }),
    });
    return response.ok ? 'accepted' : 'failed';
  } catch {
    return 'failed';
  }
}

export async function buildMirror({
  fetcher = fetch, env = process.env, clock = Date.now, check = runChecks,
  publicDir = fileURLToPath(new URL('../public/', import.meta.url)),
  outDir = fileURLToPath(new URL('../dist/', import.meta.url)),
} = {}) {
  const started = clock();
  const primaryBase = httpsBase(env.STATUS_PRIMARY_URL, primaryDefault);
  const mirrorBase = httpsBase(env.STATUS_MIRROR_URL, mirrorDefault);
  const [observations, primary, previous] = await Promise.all([
    check({ fetcher, env, external: true }),
    loadSnapshot(fetcher, primaryBase, 'api/status', started),
    loadSnapshot(fetcher, mirrorBase, 'status-data.json', started),
  ]);
  const now = clock();
  const primaryAvailable = primary && timestamp(primary.generatedAt) >= now - staleAfterMinutes * minute;
  const snapshot = createSnapshot({ observations, primary, previous, now });
  const report = sendReport(fetcher, primaryBase, env.STATUS_REPORT_TOKEN, observations);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    ...assets.map((name) => copyFile(join(publicDir, name), join(outDir, name))),
    writeFile(join(outDir, '.nojekyll'), ''),
    writeFile(join(outDir, 'status-data.json'), `${JSON.stringify(snapshot)}\n`),
  ]);
  const critical = services.filter((service) => service.critical &&
    snapshot.components.some(({ id, status }) => service.id === id && status === 'outage')
  ).map(({ name }) => name);
  return { primaryAvailable: Boolean(primaryAvailable), critical, report: await report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { primaryAvailable, critical, report } = await buildMirror();
  const summary = [
    `Primary status API ${primaryAvailable ? 'available' : 'unavailable'}`,
    `Reporting ${report}`,
    `Confirmed critical outages ${critical.length ? critical.join(', ') : 'none'}`,
  ];
  console.log(summary.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Status mirror\n\n${summary.map((note) => `- ${note}`).join('\n')}\n`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `alert=${!primaryAvailable || critical.length > 0}\n`);
}
