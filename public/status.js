"use strict";

const overviewMarks = { operational: "✓", degraded: "!", outage: "!", maintenance: "◷", unknown: "?" };
const groupIcons = new Map([["Websites", "web"], ["Platform", "platform"], ["Infrastructure", "storage"]]);
const incidentTones = { investigating: "degraded", identified: "degraded", monitoring: "maintenance", resolved: "operational" };
const defaultStaleMinutes = 15;
const timeZone = "Asia/Bangkok";
const get = (id) => document.getElementById(id);
const i18n = globalThis.statusI18n;
const preferences = globalThis.statusPreferences;
const refresh = get("refresh");
const backupLink = get("backup-link");
if (backupLink.origin === window.location.origin) {
  backupLink.href = "https://status.koomean.com/";
  backupLink.dataset.i18n = "primaryPage";
}

let language;
let timeFormat;
let dayFormat;
let percentFormat;
let lastRender;
let lastSnapshot;
let loading = false;
let lastAnnouncement = "";

const t = (key, vars) => i18n.text(language, key, vars);
const plural = (key, count, vars) => i18n.plural(language, key, count, vars);
const statusLabel = (state) => t(`status.${state}`);

function applyLanguage() {
  const choice = preferences.get("language");
  const next = choice === "system"
    ? i18n.systemLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]) : choice;
  if (language === next) return;
  language = next;
  const locale = i18n.locale(language);
  timeFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone });
  dayFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone });
  percentFormat = new Intl.NumberFormat(locale, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.documentElement.lang = language;
  document.title = t("title");
  document.querySelector('meta[name="description"]').content = t("description");
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll("[data-i18n-label]")) node.setAttribute("aria-label", t(node.dataset.i18nLabel));
  if (lastRender) render(...lastRender);
}

function setupPreferences() {
  const menu = get("preferences");
  for (const key of ["theme", "language"]) {
    const select = get(`${key}-select`);
    select.value = preferences.get(key);
    select.addEventListener("change", () => {
      preferences.set(key, select.value);
      if (key === "language") applyLanguage();
    });
  }
  document.addEventListener("click", (event) => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !menu.open) return;
    menu.open = false;
    menu.querySelector("summary").focus();
  });
  window.addEventListener("languagechange", applyLanguage);
  menu.hidden = false;
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = content;
  return node;
}

function dateMs(value) {
  return typeof value === "string" ? Date.parse(value) : NaN;
}

function formatTime(value) {
  const parsed = dateMs(value);
  return Number.isFinite(parsed) ? timeFormat.format(parsed) : "";
}

function timeNode(value) {
  const node = element("time", "", formatTime(value));
  if (node.textContent) node.dateTime = value;
  return node;
}

function rowStatus(value) {
  return Object.hasOwn(overviewMarks, value) ? value : "unknown";
}

function pill(state, label = statusLabel(state)) {
  const badge = element("span", "pill", label);
  badge.dataset.state = state;
  return badge;
}

function empty(message) {
  return element("p", "empty-state", message);
}

function listed(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

function makeDetail(containerId, id, className, open = false) {
  const node = element("details", className);
  node.id = `${containerId}-${id}`;
  node.open = document.getElementById(node.id)?.open ?? open;
  return node;
}

function historyStrip(days) {
  const sorted = listed(days)
    .filter(({ date }) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(dateMs(date)))
    .sort((first, second) => first.date.localeCompare(second.date))
    .slice(-90);
  if (!sorted.length) return;

  const group = element("div", "history");
  const heading = element("div", "history-heading");
  heading.append(element("span", "", t("dailyResults")));
  if (sorted.length > 1) heading.append(element("span", "", plural("dayCount", sorted.length)));
  group.append(heading);

  const bars = element("div", "history-bars");
  const dayCounts = {};
  for (const day of sorted) {
    const state = rowStatus(day.status);
    const dayLabel = dayFormat.format(dateMs(day.date));
    const bar = element("span");
    bar.dataset.state = state;
    bar.title = `${dayLabel} · ${statusLabel(state)}`;
    bar.setAttribute("aria-hidden", "true");
    bars.append(bar);
    dayCounts[state] = (dayCounts[state] || 0) + 1;
  }

  const summary = Object.entries(dayCounts).map(([state, count]) => plural("statusDays", count, { status: statusLabel(state) })).join(", ");
  group.append(element("span", "visually-hidden", summary), bars);

  const range = element("div", "history-range");
  range.append(element("span", "", dayFormat.format(dateMs(sorted[0].date))));
  if (sorted.length > 1) range.append(element("span", "", dayFormat.format(dateMs(sorted.at(-1).date))));
  group.append(range);
  return group;
}

function serviceAddress(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function serviceRow(service) {
  const row = element("article", "service");
  row.id = `service-${service.id}`;
  row.dataset.state = service.status;
  const wasOpen = get(row.id)?.querySelector(".service-toggle")?.getAttribute("aria-expanded") === "true";
  const headline = element("div", "service-row");
  const address = serviceAddress(service.url);
  const label = element(address ? "a" : "span", "service-label");
  if (address) label.href = address.href;
  label.append(element("span", "service-name", service.name));
  if (address && service.id === "synology") label.append(element("span", "service-host", address.hostname));

  const content = element("div", "service-detail");
  content.id = `${row.id}-history`;
  const toggle = element("button", "service-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-label", t("historyFor", { name: service.name }));
  toggle.setAttribute("aria-controls", content.id);
  toggle.title = t("viewHistory");
  const showHistory = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    content.hidden = !open;
    row.classList.toggle("history-open", open);
  };
  toggle.addEventListener("click", () => showHistory(content.hidden));
  showHistory(wasOpen);
  headline.append(label, pill(service.status), toggle);
  row.append(headline);

  const description = language === "en" ? service.descriptionEn : service.description;
  if (description) content.append(element("p", "", description));
  const meta = element("div", "service-meta");
  const hasCheck = Number.isFinite(dateMs(service.checkedAt));
  const checked = element("span", "", hasCheck ? `${t("lastChecked")} ` : t("noResults"));
  if (hasCheck) checked.append(timeNode(service.checkedAt));
  meta.append(checked);

  if (Number.isFinite(service.uptime)) {
    const uptime = element("span", "", `${t("successfulChecks")} `);
    uptime.append(element("strong", "", percentFormat.format(service.uptime / 100)));
    meta.append(uptime);
  }
  content.append(meta, historyStrip(service.days) || element("p", "", t("noDailyHistory")));
  row.append(content);
  return row;
}

function renderServices(services) {
  const list = get("service-groups");
  const focused = document.activeElement;
  const activeId = focused?.closest(".service")?.id;
  const focusSelector = focused?.classList.contains("service-toggle") ? ".service-toggle" : "a.service-label";
  if (!services.length) {
    list.replaceChildren(empty(t("noServices")));
    return;
  }

  const groups = new Map([...groupIcons.keys()].map((key) => [key, []]));
  for (const service of services) {
    const key = groupIcons.has(service.group) ? service.group : "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(service);
  }

  const main = element("div", "group-stack");
  const side = element("div", "group-stack");
  for (const [key, group] of groups) {
    if (!group.length) continue;
    const wrapper = element("section", "service-group");
    const heading = element("h3", "group-heading");
    const icon = groupIcons.get(key) ?? "platform";
    const name = t(key === "Other" ? "otherServices" : `group.${key}`);
    const mark = element("span", "group-icon");
    mark.dataset.icon = icon;
    mark.setAttribute("aria-hidden", "true");
    heading.append(mark, document.createTextNode(name), element("span", "group-size", plural("serviceCount", group.length)));
    wrapper.append(heading, ...group.map(serviceRow));
    (key === "Websites" ? main : side).append(wrapper);
  }
  list.replaceChildren(...[main, side].filter((column) => column.childElementCount));
  if (activeId) get(activeId)?.querySelector(focusSelector)?.focus({ preventScroll: true });
}

function addAffected(body, ids, names) {
  const affected = Array.isArray(ids) ? ids.map((id) => names.get(id)).filter(Boolean) : [];
  if (affected.length) body.append(element("p", "event-services", affected.join(", ")));
}

function eventUpdates(items) {
  const updates = listed(items).sort((first, second) => dateMs(second.createdAt) - dateMs(first.createdAt));
  if (!updates.length) return;
  const list = element("ol", "event-updates");
  for (const update of updates) {
    const row = element("li");
    const state = Object.hasOwn(incidentTones, update.status) ? t(`incident.${update.status}`) : "";
    const heading = element("p", "update-heading", state ? `${state} ` : "");
    heading.append(timeNode(update.createdAt));
    row.append(heading, element("p", "detail-copy", update.body));
    list.append(row);
  }
  return list;
}

function incidentCard(incident, names) {
  const tone = Object.hasOwn(incidentTones, incident.status) ? incidentTones[incident.status] : "unknown";
  const label = tone === "unknown" ? statusLabel(tone) : t(`incident.${incident.status}`);
  const details = makeDetail("incident", incident.id, "event-card incident", incident.status !== "resolved");
  const summary = element("summary");
  const timing = element("span", "event-time", `${t(incident.status === "resolved" && incident.resolvedAt ? "resolvedAt" : "startedAt")} `);
  timing.append(timeNode(incident.resolvedAt || incident.startedAt));
  summary.append(element("span", "event-title", incident.title), pill(tone, label), timing);
  const body = element("div", "event-body");
  addAffected(body, incident.components, names);
  if (incident.body) body.append(element("p", "detail-copy", incident.body));
  const updates = eventUpdates(incident.updates);
  if (updates) body.append(updates);
  details.append(summary, body);
  return details;
}

function renderIncidents(incidents, names, current) {
  const container = get("incident-list");
  const activeId = document.activeElement?.closest("details[id]")?.id;
  if (!incidents.length) {
    container.replaceChildren(empty(t(current ? "noIncidents" : "incidentsUnavailable")));
    return;
  }

  const ordered = [...incidents].sort((first, second) =>
    Number(first.status === "resolved") - Number(second.status === "resolved") ||
    dateMs(second.updatedAt || second.startedAt) - dateMs(first.updatedAt || first.startedAt));
  const list = element("div", "incident-list");
  for (const item of ordered) {
    list.append(incidentCard(item, names));
  }
  const previous = current ? [] : [empty(t("savedIncidents"))];
  container.replaceChildren(...previous, list);
  if (activeId && container.contains(get(activeId))) get(activeId).querySelector("summary")?.focus({ preventScroll: true });
}

function plannedMaintenance(items, now) {
  return items
    .filter((item) => Number.isFinite(dateMs(item.startsAt)) && dateMs(item.endsAt) > now)
    .sort((first, second) => dateMs(first.startsAt) - dateMs(second.startsAt));
}

function renderMaintenance(windows, names, current, now) {
  const container = get("maintenance-list");
  if (!windows.length) {
    container.replaceChildren(empty(t(current ? "noMaintenance" : "maintenanceUnavailable")));
    return;
  }
  const list = element("div", "maintenance-list");
  for (const item of windows) {
    const card = element("article", "event-card");
    const heading = element("div", "maintenance-heading");
    const underway = current && dateMs(item.startsAt) <= now;
    heading.append(element("h3", "event-title", item.title), pill("maintenance", t(underway ? "maintenanceUnderway" : "scheduled")));
    const window = element("p", "event-time");
    window.append(timeNode(item.startsAt), document.createTextNode(` ${t("until")} `), timeNode(item.endsAt));
    const body = element("div", "event-body");
    addAffected(body, item.components, names);
    if (item.body) body.append(element("p", "detail-copy", item.body));
    card.append(heading, window, body);
    list.append(card);
  }
  const previous = current ? [] : [empty(t("savedMaintenance"))];
  container.replaceChildren(...previous, list);
}

function fresh(value, maxAge, now) {
  const timestamp = dateMs(value);
  return timestamp <= now + 120000 && now - timestamp <= maxAge;
}

function maxAgeOf(data) {
  const minutes = Number(data?.staleAfterMinutes);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : defaultStaleMinutes) * 60000;
}

function renderBoard(services) {
  const board = get("overview-board");
  board.hidden = !services.length;
  if (!services.length) return;

  const counts = new Map(Object.keys(overviewMarks).map((state) => [state, 0]));
  const segments = services.map(({ name, status }) => {
    counts.set(status, counts.get(status) + 1);
    const segment = element("span", "board-segment");
    segment.dataset.state = status;
    segment.title = `${name} · ${statusLabel(status)}`;
    return segment;
  });
  get("board-segments").replaceChildren(...segments);

  const count = get("board-count");
  count.replaceChildren(element("strong", "", counts.get("operational")), document.createTextNode(` / ${services.length}`));
  const legend = [...counts].filter(([, amount]) => amount > 0).map(([state, amount]) => {
    const item = element("li", "", t("legendCount", { count: amount, status: statusLabel(state) }));
    item.dataset.state = state;
    return item;
  });
  const statusLegend = get("board-legend");
  statusLegend.hidden = counts.get("operational") === services.length;
  statusLegend.replaceChildren(...legend);
}

function renderOverview(services, state, previous, fromMirror) {
  const title = t(`overview.${state}.title`);
  get("overview").dataset.state = state;
  get("overall-mark").textContent = overviewMarks[state];
  get("overview-state").textContent = statusLabel(state);
  get("overall-title").textContent = title;
  let detail = t(`overview.${state}.detail`);
  if (previous) detail = t(previous);
  else if (state === "unknown" && services.some((service) => service.status === "operational")) detail = t("partialUnknown");
  else if (state === "operational" && fromMirror) detail = t("overallOperationalMirror");
  get("overall-message").textContent = detail;

  const lastChecked = get("last-checked");
  const timestamps = services.map((service) => service.checkedAt).filter((value) => Number.isFinite(dateMs(value)));
  const latest = timestamps.sort((first, second) => dateMs(second) - dateMs(first))[0];
  lastChecked.replaceChildren(document.createTextNode(latest ? `${t("lastChecked")} ` : t("noCheckTime")));
  if (latest) lastChecked.append(timeNode(latest));
  const known = services.filter((service) => service.status !== "unknown").length;
  const count = known < services.length ? t("confirmedCount", { known, total: services.length }) : "";
  get("overview-count").textContent = [count, fromMirror ? t("mirrorData") : ""].filter(Boolean).join(" · ");
  renderBoard(services);

  const announcement = `${title} ${detail}`;
  if (announcement !== lastAnnouncement) get("announcement").textContent = announcement;
  lastAnnouncement = announcement;
}

function render(snapshot, previous = "") {
  lastRender = [snapshot, previous];
  const data = snapshot?.data;
  const current = Boolean(data && !previous);
  const now = Date.now();
  const maxAge = maxAgeOf(data);
  const incidents = listed(data?.incidents);
  const maintenance = plannedMaintenance(listed(data?.maintenance), now);
  const currentlyMaintained = new Set(maintenance
    .filter((item) => dateMs(item.startsAt) <= now)
    .flatMap((item) => Array.isArray(item.components) ? item.components : []));
  const currentlyAffected = new Set(incidents
    .filter((item) => ["investigating", "identified", "monitoring"].includes(item.status))
    .flatMap((item) => Array.isArray(item.components) ? item.components : []));
  const services = listed(data?.components)
    .filter(({ id, name }) => typeof id === "string" && typeof name === "string")
    .map((item) => {
      let status = "unknown";
      if (current && currentlyMaintained.has(item.id)) status = "maintenance";
      else if (current && fresh(item.checkedAt, maxAge, now)) status = rowStatus(item.status);
      if (current && currentlyAffected.has(item.id) && (status === "operational" || status === "unknown")) status = "degraded";
      return { ...item, status };
    });
  const states = new Set(services.map(({ status }) => status));
  const overall = ["outage", "degraded", "maintenance", "unknown", "operational"]
    .find((state) => states.has(state)) || "unknown";
  const names = new Map(services.map((service) => [service.id, service.name]));
  renderOverview(services, overall, previous, snapshot?.source === "mirror");
  renderServices(services);
  renderIncidents(incidents, names, current);
  renderMaintenance(maintenance, names, current, now);
}

async function fetchSnapshot(path, source) {
  try {
    const response = await fetch(path, {
      cache: "no-store", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(7000),
    });
    if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json")) return;
    const data = await response.json();
    if (!Array.isArray(data.components)) return;
    if (source === "mirror" && data.source === "catalog") return { data, source: "catalog" };
    if (typeof data.generatedAt !== "string") return;
    return { data, source };
  } catch {
    return undefined;
  }
}

function currentSnapshot(snapshot) {
  return snapshot && fresh(snapshot.data.generatedAt, maxAgeOf(snapshot.data), Date.now());
}

async function refreshStatus() {
  if (loading) return;
  loading = true;
  refresh.setAttribute("aria-busy", "true");
  refresh.setAttribute("aria-disabled", "true");
  try {
    const live = await fetchSnapshot("./api/status", "live");
    if (currentSnapshot(live)) {
      lastSnapshot = live;
      render(live);
      return;
    }

    const mirror = await fetchSnapshot("./status-data.json", "mirror");
    if (currentSnapshot(mirror)) {
      lastSnapshot = mirror;
      render(mirror);
      return;
    }

    const old = [live, mirror, lastSnapshot].filter(Boolean)
      .sort((first, second) => (dateMs(second.data.generatedAt) || 0) - (dateMs(first.data.generatedAt) || 0))[0];
    lastSnapshot = old;
    render(old, live || mirror?.source === "mirror" ? "stale" : "offline");
  } finally {
    loading = false;
    refresh.removeAttribute("aria-busy");
    refresh.removeAttribute("aria-disabled");
  }
}

applyLanguage();
setupPreferences();
refresh.addEventListener("click", refreshStatus);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshStatus();
});
window.setInterval(() => {
  if (!document.hidden) refreshStatus();
}, 60000);
refreshStatus();
