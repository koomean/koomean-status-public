export const checkStates = new Set(['operational', 'degraded', 'outage', 'maintenance', 'unknown']);
const reasons = new Set([
  'reachable', 'slow_response', 'upstream_maintenance', 'access_blocked', 'network_error',
  'timeout', 'http_error', 'unexpected_response', 'not_configured', 'not_checked',
]);

export function validReopenAt(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000 ? value : null;
}

export function activeMaintenance(windows, id, now) {
  return windows.filter((item) => item.components.includes(id) && Date.parse(item.startsAt) <= now && now < Date.parse(item.endsAt));
}

export function reopeningDeadline(status, checks, windows) {
  if (status !== 'maintenance') return null;
  const monitored = checks.filter((check) => check.status === 'maintenance');
  if (monitored.some(({ reopenAt }) => !validReopenAt(reopenAt))) return null;
  const deadlines = [...monitored.map(({ reopenAt }) => reopenAt), ...windows.map(({ endsAt }) => Date.parse(endsAt))];
  return deadlines.length ? Math.max(...deadlines) : null;
}

export function filterDetails(checks, descriptors = []) {
  if (!Array.isArray(checks)) return [];
  const known = new Set(descriptors.map(({ id }) => id));
  return checks.slice(0, descriptors.length).flatMap((check) => {
    const { id, status, reason, httpStatus, reopenAt } = check ?? {};
    if (!known.delete(id) || !checkStates.has(status) || !reasons.has(reason)) return [];
    const details = { id, status, reason };
    if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) details.httpStatus = httpStatus;
    if (status === 'maintenance' && validReopenAt(reopenAt)) details.reopenAt = reopenAt;
    return [details];
  });
}

export function expandDetails(descriptors = [], samples = []) {
  const readings = samples.flatMap(({ checks, checkedAt }) =>
    filterDetails(checks, descriptors).map((check) => ({ ...check, checkedAt }))
  ).sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt));
  return descriptors.map(({ id, label, labelEn }) => {
    const matches = readings.filter((entry) => entry.id === id);
    const result = matches.find(({ status }) => status !== 'unknown') || matches[0];
    return { id, label, labelEn, ...(result ?? { status: 'unknown', reason: 'not_checked', checkedAt: null }) };
  });
}
