const api = 'https://koomean-proxy.meanchannel52.workers.dev/';
const drive = 'https://drive.koomean.com';

const checks = {
  portal: [{ url: 'https://koomean.com/', title: /^Koo Mean Portal$/i }],
  blog: [{ url: 'https://blog.koomean.com/', title: /^Koo Mean Blog$/i }],
  link: [{ url: 'https://link.koomean.com/', title: /^Koo Mean SITE(?: V[.\s]*\d+(?:\.\d+)*)?$/i }],
  dashboard: [{ url: 'https://dashboard.koomean.com/', title: /Koo Mean.*Admin Dashboard/i }],
  terms: [{ url: 'https://termsofservice.koomean.com/', title: /ข้อกำหนดการใช้บริการ|terms of service/i }],
  privacy: [{ url: 'https://privacypolicy.koomean.com/', title: /นโยบายความเป็นส่วนตัว|privacy policy/i }],
  lunav: [{ url: 'https://lunavision.koomean.com/', title: /^LunaV(?:\s|$)/i }],
  shorturl: [{ url: 'https://shorturl.koomean.com/health', json: (payload) => payload?.ok === true && typeof payload.version === 'string' }],
  api: [
    { url: `${api}?client=portal&action=bootstrap`, json: (payload) => Array.isArray(payload?.applications) },
    { url: `${api}?client=blog&action=postsOnly&limit=1`, json: (payload) => payload?.success === true && Array.isArray(payload.posts) },
  ],
  synology: [{ url: `${drive}/?launchApp=SYNO.SDS.Drive.Application`, title: /^Koo(?:\s|&nbsp;)+Mean(?:\s|&nbsp;)+NAS$/i }],
};

const components = [
  { id: 'portal', name: 'Koo Mean Portal', group: 'Websites', description: 'หน้าเว็บรวมแอปและบริการ', critical: true },
  { id: 'blog', name: 'Koo Mean Blog', group: 'Websites', description: 'หน้าโพสต์และบทความ' },
  { id: 'link', name: 'Koo Mean Site', group: 'Websites', description: 'หน้าโปรไฟล์และลิงก์' },
  { id: 'lunav', name: 'LunaV', group: 'Websites', description: 'เว็บไซต์โครงการ LunaV' },
  { id: 'terms', name: 'Terms of Service', group: 'Websites', description: 'หน้าข้อกำหนดการใช้บริการ' },
  { id: 'privacy', name: 'Privacy Policy', group: 'Websites', description: 'หน้านโยบายความเป็นส่วนตัว' },
  { id: 'shorturl', name: 'Short URL', group: 'Platform', description: 'ระบบบริการลิงก์สั้น', critical: true },
  { id: 'dashboard', name: 'Admin Dashboard', group: 'Platform', description: 'หน้าเข้าสู่ระบบของผู้ดูแล' },
  { id: 'api', name: 'Shared API', group: 'Platform', description: 'ข้อมูลแอปใน Portal และโพสต์ใน Blog', critical: true },
  { id: 'synology', name: 'Synology Drive', group: 'Infrastructure', description: 'หน้าเข้าสู่ระบบ Synology Drive' },
];

export const services = components.map((component) => ({
  ...component,
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
        url: `https://shorturl.koomean.com/${slug}`,
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
