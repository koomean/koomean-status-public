"use strict";

const statusLabels = {
  operational: "ปกติ",
  degraded: "มีปัญหาบางส่วน",
  outage: "ใช้งานไม่ได้",
  maintenance: "ซ่อมบำรุง",
  unknown: "ยังยืนยันไม่ได้",
};

const overviewContent = {
  operational: { title: "ทุกบริการทำงานปกติ", detail: "ระบบตรวจอัตโนมัติทุก 5 นาที", mark: "✓" },
  degraded: { title: "บางบริการมีปัญหา", detail: "ดูบริการที่ได้รับผลกระทบและความคืบหน้าด้านล่าง", mark: "!" },
  outage: { title: "มีบริการที่ใช้งานไม่ได้", detail: "ดูบริการที่ได้รับผลกระทบและความคืบหน้าด้านล่าง", mark: "!" },
  maintenance: { title: "อยู่ระหว่างซ่อมบำรุง", detail: "ดูกำหนดการและบริการที่ได้รับผลกระทบด้านล่าง", mark: "◷" },
  unknown: { title: "ยังยืนยันสถานะไม่ได้", detail: "บางบริการยังไม่มีผลตรวจล่าสุด", mark: "?" },
};

const groupLabels = new Map([
  ["Websites", { name: "เว็บไซต์", icon: "web" }],
  ["Platform", { name: "แพลตฟอร์ม", icon: "platform" }],
  ["Infrastructure", { name: "โครงสร้างพื้นฐาน", icon: "storage" }],
]);

const incidentLabels = {
  investigating: { label: "กำลังตรวจสอบ", tone: "degraded" },
  identified: { label: "พบสาเหตุแล้ว", tone: "degraded" },
  monitoring: { label: "เฝ้าติดตาม", tone: "maintenance" },
  resolved: { label: "แก้ไขแล้ว", tone: "operational" },
};

const defaultStaleMinutes = 15;
const timeFormat = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok",
});
const dayFormat = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
  day: "numeric", month: "short", timeZone: "Asia/Bangkok",
});

const get = (id) => document.getElementById(id);
const refresh = get("refresh");
const backupLink = get("backup-link");
if (backupLink && backupLink.origin === window.location.origin) {
  backupLink.href = "https://status.koomean.com/";
  backupLink.textContent = "หน้าสถานะหลัก";
}
let lastSnapshot;
let loading = false;
let lastAnnouncement = "";

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
  return Object.hasOwn(statusLabels, value) ? value : "unknown";
}

function pill(state, label = statusLabels[state]) {
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
  heading.append(element("span", "", "ผลตรวจรายวัน"));
  if (sorted.length > 1) heading.append(element("span", "", `${sorted.length} วัน`));
  group.append(heading);

  const bars = element("div", "history-bars");
  const dayCounts = {};
  for (const day of sorted) {
    const state = rowStatus(day.status);
    const dayLabel = dayFormat.format(dateMs(day.date));
    const bar = element("span");
    bar.dataset.state = state;
    bar.title = `${dayLabel} · ${statusLabels[state]}`;
    bar.setAttribute("aria-hidden", "true");
    bars.append(bar);
    dayCounts[state] = (dayCounts[state] || 0) + 1;
  }

  const summary = Object.entries(dayCounts).map(([state, count]) => `${statusLabels[state]} ${count} วัน`).join(", ");
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
  const detail = makeDetail("service", service.id, "service");
  detail.dataset.state = service.status;
  const headline = element("summary");
  const address = serviceAddress(service.url);
  const label = element("span", "service-label");
  label.append(element("span", "service-name", service.name));
  if (address) label.append(element("span", "service-host", address.hostname));
  headline.append(label, pill(service.status));
  detail.append(headline);

  const content = element("div", "service-detail");
  if (service.description || address) {
    const intro = element("div", "service-intro");
    if (service.description) intro.append(element("p", "", service.description));
    if (address) {
      const link = element("a", "service-link", `เปิด ${service.name}`);
      link.href = address.href;
      intro.append(link);
    }
    content.append(intro);
  }
  const meta = element("div", "service-meta");
  const checked = element("span", "", service.checkedAt && formatTime(service.checkedAt) ? "ตรวจล่าสุด " : "ยังไม่มีผลตรวจ");
  if (service.checkedAt && formatTime(service.checkedAt)) checked.append(timeNode(service.checkedAt));
  meta.append(checked);

  if (Number.isFinite(service.uptime)) {
    const uptime = element("span", "", "ผลตรวจผ่าน ");
    uptime.append(element("strong", "", `${service.uptime.toFixed(2)}%`));
    meta.append(uptime);
  }
  content.append(meta);

  const history = historyStrip(service.days);
  content.append(history || element("p", "", "ยังไม่มีประวัติผลตรวจรายวัน"));
  detail.append(content);
  return detail;
}

function renderServices(services) {
  const list = get("service-groups");
  const activeId = document.activeElement?.closest("details[id]")?.id;
  if (!services.length) {
    list.replaceChildren(empty("ยังโหลดรายการบริการไม่ได้ โปรดลองรีเฟรชสถานะ"));
    return;
  }

  const groups = new Map([...groupLabels].map(([key]) => [key, []]));
  for (const service of services) {
    const key = service.group || "บริการอื่น ๆ";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(service);
  }

  const main = element("div", "group-stack");
  const side = element("div", "group-stack");
  for (const [key, group] of groups) {
    if (!group.length) continue;
    const wrapper = element("section", "service-group");
    const heading = element("h3", "group-heading");
    const { name, icon } = groupLabels.get(key) || { name: key, icon: "platform" };
    const mark = element("span", "group-icon");
    mark.dataset.icon = icon;
    mark.setAttribute("aria-hidden", "true");
    heading.append(mark, document.createTextNode(name), element("span", "group-size", `${group.length} บริการ`));
    wrapper.append(heading, ...group.map(serviceRow));
    (key === "Websites" ? main : side).append(wrapper);
  }
  list.replaceChildren(...[main, side].filter((column) => column.childElementCount));
  if (activeId && list.contains(get(activeId))) get(activeId).querySelector("summary")?.focus({ preventScroll: true });
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
    const state = incidentLabels[update.status]?.label;
    const heading = element("p", "update-heading", state ? `${state} ` : "");
    heading.append(timeNode(update.createdAt));
    row.append(heading, element("p", "detail-copy", update.body));
    list.append(row);
  }
  return list;
}

function incidentCard(incident, names) {
  const { tone, label } = incidentLabels[incident.status] || { tone: "unknown", label: "ยังยืนยันไม่ได้" };
  const details = makeDetail("incident", incident.id, "event-card incident", incident.status !== "resolved");
  const summary = element("summary");
  const timing = element("span", "event-time", incident.status === "resolved" && incident.resolvedAt ? "แก้ไขเมื่อ " : "เริ่มเมื่อ ");
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
    container.replaceChildren(empty(current ? "ไม่มีรายงานเหตุขัดข้อง" : "ยังโหลดรายงานเหตุขัดข้องล่าสุดไม่ได้"));
    return;
  }

  const ordered = [...incidents].sort((first, second) =>
    Number(first.status === "resolved") - Number(second.status === "resolved") ||
    dateMs(second.updatedAt || second.startedAt) - dateMs(first.updatedAt || first.startedAt));
  const list = element("div", "incident-list");
  for (const item of ordered) {
    list.append(incidentCard(item, names));
  }
  const previous = current ? [] : [empty("แสดงประกาศจากข้อมูลที่บันทึกไว้ล่าสุด")];
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
    container.replaceChildren(empty(current ? "ไม่มีซ่อมบำรุงตามกำหนดการ" : "ยังโหลดกำหนดการล่าสุดไม่ได้"));
    return;
  }
  const list = element("div", "maintenance-list");
  for (const item of windows) {
    const card = element("article", "event-card");
    const heading = element("div", "maintenance-heading");
    const underway = current && dateMs(item.startsAt) <= now;
    heading.append(element("h3", "event-title", item.title), pill("maintenance", underway ? "กำลังซ่อมบำรุง" : "ตามกำหนดการ"));
    const window = element("p", "event-time");
    window.append(timeNode(item.startsAt), document.createTextNode(" ถึง "), timeNode(item.endsAt));
    const body = element("div", "event-body");
    addAffected(body, item.components, names);
    if (item.body) body.append(element("p", "detail-copy", item.body));
    card.append(heading, window, body);
    list.append(card);
  }
  const previous = current ? [] : [empty("แสดงกำหนดการจากข้อมูลที่บันทึกไว้ล่าสุด")];
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

  const counts = new Map(Object.keys(statusLabels).map((state) => [state, 0]));
  const segments = services.map(({ name, status }) => {
    counts.set(status, counts.get(status) + 1);
    const segment = element("span", "board-segment");
    segment.dataset.state = status;
    segment.title = `${name} · ${statusLabels[status]}`;
    return segment;
  });
  get("board-segments").replaceChildren(...segments);

  const count = get("board-count");
  count.replaceChildren(element("strong", "", counts.get("operational")), document.createTextNode(` / ${services.length}`));
  const legend = [...counts].filter(([, amount]) => amount > 0).map(([state, amount]) => {
    const item = element("li", "", `${amount} ${statusLabels[state]}`);
    item.dataset.state = state;
    return item;
  });
  const statusLegend = get("board-legend");
  statusLegend.hidden = counts.get("operational") === services.length;
  statusLegend.replaceChildren(...legend);
}

function renderOverview(services, state, previous, fromMirror) {
  const presentation = overviewContent[state];
  get("overview").dataset.state = state;
  get("overall-mark").textContent = presentation.mark;
  get("overview-state").textContent = statusLabels[state];
  get("overall-title").textContent = presentation.title;
  const detail = previous === "offline"
    ? "เชื่อมต่อข้อมูลล่าสุดไม่ได้ โปรดลองรีเฟรชสถานะอีกครั้ง"
    : previous === "stale" ? "ผลตรวจที่ได้รับเกินเวลาที่กำหนด ระบบกำลังรอข้อมูลใหม่"
    : state === "unknown" && services.some((service) => service.status === "operational")
      ? "บริการที่ตรวจได้ทำงานปกติ ยังมีบางบริการที่รอการยืนยัน"
      : state === "operational" && fromMirror ? "ตัวตรวจภายนอกทำงานตามรอบทุก 10 นาที" : presentation.detail;
  get("overall-message").textContent = detail;

  const lastChecked = get("last-checked");
  const timestamps = services.map((service) => service.checkedAt).filter((value) => Number.isFinite(dateMs(value)));
  const latest = timestamps.sort((first, second) => dateMs(second) - dateMs(first))[0];
  lastChecked.replaceChildren(document.createTextNode(latest ? "ตรวจล่าสุด " : "ยังไม่มีเวลาตรวจ"));
  if (latest) lastChecked.append(timeNode(latest));
  const known = services.filter((service) => service.status !== "unknown").length;
  const count = known < services.length ? `ยืนยันแล้ว ${known} จาก ${services.length} บริการ` : "";
  get("overview-count").textContent = [count, fromMirror ? "ข้อมูลสำรอง" : ""].filter(Boolean).join(" · ");
  renderBoard(services);

  const announcement = `${presentation.title} ${detail}`;
  if (announcement !== lastAnnouncement) get("announcement").textContent = announcement;
  lastAnnouncement = announcement;
}

function render(snapshot, previous = "") {
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

refresh.addEventListener("click", refreshStatus);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshStatus();
});
window.setInterval(() => {
  if (!document.hidden) refreshStatus();
}, 60000);
refreshStatus();
