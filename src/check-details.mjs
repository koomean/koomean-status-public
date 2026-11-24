export const checkStates = new Set(['operational', 'degraded', 'outage', 'maintenance', 'unknown']);
const reasons = new Set([
  'reachable', 'slow_response', 'upstream_maintenance', 'access_blocked', 'network_error',
  'timeout', 'http_error', 'unexpected_response', 'not_configured', 'not_checked',
]);

export function filterDetails(checks, descriptors = []) {
  if (!Array.isArray(checks)) return [];
  const known = new Set(descriptors.map(({ id }) => id));
  return checks.slice(0, descriptors.length).flatMap((check) => {
    const { id, status, reason, httpStatus } = check ?? {};
    if (!known.delete(id) || !checkStates.has(status) || !reasons.has(reason)) return [];
    const details = { id, status, reason };
    if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) details.httpStatus = httpStatus;
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
