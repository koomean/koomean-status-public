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

const checks = {
  portal: [{ url: serviceUrls.portal, title: /^Koo Mean Portal$/i }],
  blog: [{ url: serviceUrls.blog, title: /^Koo Mean Blog$/i }],
  link: [{ url: serviceUrls.link, title: /^Koo Mean SITE(?: V[.\s]*\d+(?:\.\d+)*)?$/i }],
  dashboard: [{ url: serviceUrls.dashboard, title: /Koo Mean.*Admin Dashboard/i }],
  terms: [{ url: serviceUrls.terms, title: /ข้อกำหนดการใช้บริการ|terms of service/i }],
  privacy: [{ url: serviceUrls.privacy, title: /นโยบายความเป็นส่วนตัว|privacy policy/i }],
  lunav: [{ url: serviceUrls.lunav, title: /^LunaV(?:\s|$)/i }],
  shorturl: [{ url: `${serviceUrls.shorturl}health`, json: (payload) => payload?.ok === true && typeof payload.version === 'string' }],
  api: [
    { url: `${api}?client=portal&action=bootstrap`, json: (payload) => Array.isArray(payload?.applications) },
    { url: `${api}?client=blog&action=postsOnly&limit=1`, json: (payload) => payload?.success === true && Array.isArray(payload.posts) },
  ],
  synology: [{ url: `${serviceUrls.synology}?launchApp=SYNO.SDS.Drive.Application`, title: /^Koo(?:\s|&nbsp;)+Mean(?:\s|&nbsp;)+NAS$/i }],
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
      return [...service.checks, {
        url: `${serviceUrls.shorturl}${slug}`,
        redirectTo: target.href,
      }];
    }
  }
  if (service.id === 'synology') {
    const path = env.STATUS_SYNOLOGY_HEALTH_PATH;
    if (typeof path === 'string' && /^(?:\/[a-z0-9_-]+(?:\.[a-z0-9_-]+)*)+\/?$/i.test(path)) {
      return [...service.checks, { url: `${drive}${path}`, json: (payload) => payload?.ok === true }];
    }
  }
  return service.checks;
}
