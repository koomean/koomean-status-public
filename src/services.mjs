const api = 'https://koomean-proxy.meanchannel52.workers.dev/';
const drive = 'https://drive.koomean.com';

const serviceUrls = {
  portal: 'https://koomean.com/',
  blog: 'https://blog.koomean.com/',
  link: 'https://link.koomean.com/',
  lunav: 'https://lunavision.koomean.com/',
  terms: 'https://termsofservice.koomean.com/',
  privacy: 'https://privacypolicy.koomean.com/',
  shorturl: 'https://shorturl.koomean.com/',
  dashboard: 'https://dashboard.koomean.com/',
  api: `${api}?action=ping`,
  synology: `${drive}/`,
};

function website(url, title) {
  return { id: 'website', label: 'หน้าเว็บไซต์', labelEn: 'Website', url, title };
}

function sharedApi(id, label, labelEn, query, json) {
  return { id, label, labelEn, url: `${api}?${query}`, json, fresh: true, sharedMaintenance: true };
}

const applications = sharedApi('applications', 'ข้อมูลแอปในฐานข้อมูล', 'App catalogue database reads',
  'client=portal&action=bootstrap', (payload) => Array.isArray(payload?.applications));
const posts = sharedApi('posts', 'ข้อมูลโพสต์ในฐานข้อมูล', 'Blog post database reads',
  'client=blog&action=postsOnly&limit=1', (payload) => payload?.success === true && Array.isArray(payload.posts));
const links = sharedApi('links', 'ข้อมูลลิงก์ในฐานข้อมูล', 'Link directory database reads',
  'client=site&action=bootstrap', (payload) => Array.isArray(payload?.links));
const sharedDatabase = {
  id: 'database', label: 'การเชื่อมต่อฐานข้อมูล D1', labelEn: 'D1 database connectivity',
  url: `${api}?action=maintenanceStatus`,
  json: (payload) => payload?.success === true && typeof payload.maintenance?.active === 'boolean',
};

const checks = {
  portal: [website(serviceUrls.portal, /^Koo Mean Portal$/i), applications],
  blog: [website(serviceUrls.blog, /^Koo Mean Blog$/i), posts],
  link: [website(serviceUrls.link, /^Koo Mean SITE(?: V[.\s]*\d+(?:\.\d+)*)?$/i), links],
  dashboard: [website(serviceUrls.dashboard, /Koo Mean.*Admin Dashboard/i), sharedDatabase],
  terms: [website(serviceUrls.terms, /ข้อกำหนดการใช้บริการ|terms of service/i)],
  privacy: [website(serviceUrls.privacy, /นโยบายความเป็นส่วนตัว|privacy policy/i)],
  lunav: [website(serviceUrls.lunav, /^LunaV(?:\s|$)/i)],
  shorturl: [
    { id: 'database', label: 'การเชื่อมต่อฐานข้อมูลลิงก์', labelEn: 'Short link database connectivity',
      url: `${serviceUrls.shorturl}health`, json: (payload) => payload?.ok === true && typeof payload.version === 'string' },
    { id: 'login', label: 'หน้าเข้าสู่ระบบ Short URL', labelEn: 'Short URL sign-in page',
      url: `${serviceUrls.shorturl}login`, title: /^เข้าสู่ระบบ · Koo Mean$/i,
      maintenanceTitle: /^กำลังปรับปรุงระบบ · Koo Mean$/i },
    { id: 'redirect', label: 'การทำงานของลิงก์สั้น', labelEn: 'Short link redirect',
      url: `${serviceUrls.shorturl}statuscheck`, redirectTo: 'https://status.koomean.com/', method: 'HEAD' },
  ],
  api: [sharedDatabase, applications, posts],
  synology: [
    website(`${serviceUrls.synology}?launchApp=SYNO.SDS.Drive.Application`, /^Koo(?:\s|&nbsp;)+Mean(?:\s|&nbsp;)+NAS$/i),
    { id: 'database', label: 'ระบบข้อมูลภายใน Drive', labelEn: 'Internal Drive data services', url: null },
  ],
};

const components = [
  { id: 'portal', name: 'Koo Mean Portal', group: 'Websites', description: 'หน้าเว็บรวมแอปและบริการ', descriptionEn: 'Directory of apps and services', critical: true },
  { id: 'blog', name: 'Koo Mean Blog', group: 'Websites', description: 'หน้าโพสต์และบทความ', descriptionEn: 'Blog posts and articles' },
  { id: 'link', name: 'Koo Mean Site', group: 'Websites', description: 'หน้าโปรไฟล์และลิงก์', descriptionEn: 'Profile and links' },
  { id: 'lunav', name: 'LunaV', group: 'Websites', description: 'เว็บไซต์โครงการ LunaV', descriptionEn: 'LunaV project website' },
  { id: 'terms', name: 'Terms of Service', group: 'Websites', description: 'หน้าข้อกำหนดการใช้บริการ', descriptionEn: 'Terms of service' },
  { id: 'privacy', name: 'Privacy Policy', group: 'Websites', description: 'หน้านโยบายความเป็นส่วนตัว', descriptionEn: 'Privacy policy' },
  { id: 'shorturl', name: 'Short URL', group: 'Platform', description: 'ระบบบริการลิงก์สั้น', descriptionEn: 'Link shortening service', critical: true },
  { id: 'dashboard', name: 'Admin Dashboard', group: 'Platform', description: 'หน้าเข้าสู่ระบบของผู้ดูแล', descriptionEn: 'Administrator sign-in page' },
  { id: 'api', name: 'Shared API', group: 'Platform', description: 'ข้อมูลแอปใน Portal และโพสต์ใน Blog', descriptionEn: 'Public data for Portal apps and Blog posts', critical: true },
  { id: 'synology', name: 'Koo Mean Drive', group: 'Infrastructure', description: 'หน้าเข้าสู่ระบบ Koo Mean Drive', descriptionEn: 'Koo Mean Drive sign-in page' },
];

export const services = components.map((component) => ({
  ...component,
  url: serviceUrls[component.id],
  checks: checks[component.id],
}));

function httpsTarget(value) {
  try {
    const target = new URL(value);
    if (target.protocol === 'https:' && !target.username && !target.password) return target;
  } catch {
    // An optional check requires a valid HTTPS destination.
  }
  return null;
}

export function checksFor(service, env) {
  if (service.id === 'shorturl') {
    const slug = env.STATUS_SHORTURL_CANARY_SLUG;
    const target = httpsTarget(env.STATUS_SHORTURL_CANARY_TARGET);
    if (typeof slug === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(slug) && target) {
      return service.checks.map((check) => check.id === 'redirect' ? {
        ...check,
        url: `${serviceUrls.shorturl}${slug}`,
        redirectTo: target.href,
      } : check);
    }
  }
  if (service.id === 'synology') {
    const path = env.STATUS_SYNOLOGY_HEALTH_PATH;
    if (typeof path === 'string' && /^(?:\/[a-z0-9_-]+(?:\.[a-z0-9_-]+)*)+\/?$/i.test(path)) {
      return service.checks.map((check) => check.id === 'database' ? {
        ...check, url: `${drive}${path}`, json: (payload) => payload?.ok === true,
      } : check);
    }
  }
  return service.checks;
}
