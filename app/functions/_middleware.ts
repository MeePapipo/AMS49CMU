/* ============================================================================
   หัวข้อความปลอดภัยของทุก response — ทั้งหน้าเว็บและ API

   CSP ตั้งเป็น script-src 'self' ได้ เพราะสคริปต์ของทุกหน้าถูกย้ายออกไปเป็นไฟล์
   assets/page-*.js แล้ว ไม่มี <script> inline เหลืออยู่
   (ต้นแบบมีสคริปต์ inline ก้อนใหญ่ในทุกหน้า จึงตั้ง CSP แบบนี้ไม่ได้)
   style-src ยังต้องมี 'unsafe-inline' เพราะเลย์เอาต์ใช้ style="" รายจุดเยอะมาก
   ซึ่งเป็นความเสี่ยงคนละระดับกับสคริปต์
   ========================================================================= */

const TURNSTILE = 'https://challenges.cloudflare.com';

/* frameAncestors:
   'none' สำหรับหลังบ้าน — กันการถูกเอาไปซ้อนใน iframe เว็บอื่นแล้วหลอกให้กดปุ่มยืนยัน/ตีกลับ
   'self' สำหรับหน้าสาธารณะ — เว็บอื่นยังฝังไม่ได้อยู่ดี (คนละ origin) แต่เปิดทางให้
   หน้าตรวจ layout ของเราเอง (_diag.html) โหลดหน้าจริงใส่ iframe ความกว้างคงที่
   เพื่อหาการเลื่อนแนวนอนที่จอ 320–390px ซึ่งเป็นบั๊กที่โครงการนี้เคยเสียเวลาไปแล้วครั้งหนึ่ง
   (Edge headless ถ่ายภาพที่ความกว้างเท่านั้นตรง ๆ ไม่ได้ มันบังคับความกว้างหน้าต่างขั้นต่ำ) */
function csp(frameAncestors: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${TURNSTILE}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    `frame-src 'self' ${TURNSTILE}`,
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'none'",
    "object-src 'none'"
  ].join('; ');
}

const ADMIN_PATH = /^\/(admin(\.html)?$|api\/admin)/;

export const onRequest: PagesFunction = async (ctx) => {
  const res = await ctx.next();
  const h = new Headers(res.headers);
  const isAdmin = ADMIN_PATH.test(new URL(ctx.request.url).pathname);

  h.set('content-security-policy', csp(isAdmin ? "'none'" : "'self'"));
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'strict-origin-when-cross-origin');
  h.set('permissions-policy', 'geolocation=(), microphone=(), camera=(), payment=(), interest-cohort=()');
  h.set('cross-origin-opener-policy', 'same-origin');
  /* HSTS ปลอดภัยกับ pages.dev และโดเมนที่ต่อผ่าน Cloudflare อยู่แล้ว
     ไม่ตั้งตอน dev เพราะจะทำให้ localhost ถูกบังคับเป็น https ค้างในเบราว์เซอร์ */
  if (new URL(ctx.request.url).protocol === 'https:') {
    h.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  }

  /* หน้าหลังบ้านห้ามถูกจัดเก็บโดยตัวกลางใด ๆ และห้ามเข้าดัชนีค้นหา */
  if (isAdmin) {
    h.set('cache-control', 'no-store');
    h.set('x-robots-tag', 'noindex, nofollow, noarchive');
  }

  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
};
