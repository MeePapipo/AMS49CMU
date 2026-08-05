#!/usr/bin/env node
/* ============================================================================
   ทดสอบ API จริงกับเซิร์ฟเวอร์ที่รันอยู่  —  node scripts/smoke.mjs [base-url]

   ครึ่งหนึ่งของเทสต์ในไฟล์นี้เป็นเคสที่ "ต้องล้มเหลว"
   เพราะสิ่งที่ต้องพิสูจน์ไม่ใช่แค่ว่าคนกรอกถูกแล้วผ่าน แต่คือคนที่ยิง API ตรง ๆ
   แล้วไม่ผ่าน — ยอดที่แก้เอง ไฟล์ปลอม เข้าหลังบ้านโดยไม่ล็อกอิน ยิงรัว ๆ

   หมายเหตุเรื่อง CF-Connecting-IP:
   สคริปต์ส่ง header นี้เองเพื่อให้แต่ละเทสต์มีถังจำกัดอัตราของตัวเอง
   รันซ้ำติด ๆ กันได้โดยไม่ติดลิมิตของรอบก่อน
   บนของจริง Cloudflare เป็นคนตั้ง header นี้และทับค่าที่ไคลเอนต์ส่งมาเสมอ
   จึงไม่ใช่ช่องโหว่ — แต่ก็อย่าเอาเทคนิคนี้ไปใช้เทสต์กับ production
   ========================================================================= */

const BASE = (process.argv[2] || 'http://localhost:8788').replace(/\/$/, '');
const ADMIN_USER = process.env.SMOKE_USER || 'admin';
const ADMIN_PASS = process.env.SMOKE_PASS || 'dev-local-only-AMS49';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else {
    fail++; failures.push(name);
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? '  → ' + detail : ''}`);
  }
}
function section(t) { console.log(`\n\x1b[1m${t}\x1b[0m`); }

/* แต่ละเทสต์ได้ IP สมมติของตัวเอง ถังจำกัดอัตราจึงไม่ปนกัน
   และแต่ละ "รอบการรัน" ได้ช่วง IP ของตัวเองด้วย ไม่งั้นรันซ้ำภายใน 15 นาที
   จะไปเจอถังที่เทสต์ล็อกอินผิด ๆ ของรอบก่อนล็อกไว้ แล้วได้ 429 แทน 401 */
const RUN = [Math.floor(Math.random() * 256), Math.floor(Math.random() * 256)];
let ipSeed = 1;
const nextIp = () => `10.${RUN[0]}.${RUN[1]}.${(ipSeed++) % 254 + 1}`;

async function call(path, { method = 'GET', body, json, ip, cookie, origin, headers = {} } = {}) {
  const h = { 'cf-connecting-ip': ip || nextIp(), ...headers };
  if (cookie) h.cookie = cookie;
  if (origin !== null) h.origin = origin || BASE;
  let payload = body;
  if (json !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(json); }
  const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: 'manual' });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, data, res };
}

function orderForm(over = {}) {
  const fd = new FormData();
  const base = {
    counts: JSON.stringify({ M: 2, '5XL': 1 }),
    donation: '1000',
    clientTotal: '2550',
    name: 'ทดสอบ ระบบ',
    studentId: '491119999',
    phone: '0812345678',
    email: 'smoke@example.com',
    lineId: 'smoke_line',
    recipient: 'ทดสอบ ระบบ',
    recipientPhone: '0812345678',
    addrLine: '1 ถ.ทดสอบ ต.สุเทพ อ.เมือง',
    province: 'เชียงใหม่',
    zip: '50200',
    shipNote: '',
    transferAt: new Date(Date.now() - 3600_000).toISOString().slice(0, 16),
    consent: 'true'
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) {
    if (v !== undefined) fd.append(k, v);
  }
  const file = over.__file || new File([PNG_1PX], 'slip.png', { type: 'image/png' });
  fd.append('slip', file, file.name);
  return fd;
}

const main = async () => {
  console.log(`\nทดสอบ ${BASE}\n${'─'.repeat(48)}`);

  /* ---------- 1 · public ---------- */
  section('1 · API สาธารณะ');
  const cfg = await call('/api/config');
  ok('GET /api/config ตอบ 200', cfg.status === 200, `ได้ ${cfg.status}`);
  ok('config มีตารางไซส์ครบ 9 ไซส์', cfg.data?.sizes?.length === 9);
  ok('config ไม่หลุดความลับใด ๆ',
    !JSON.stringify(cfg.data).match(/SESSION_SECRET|pbkdf2|hash/i));

  const quote = await call('/api/quote', { method: 'POST', json: { counts: { M: 2, '5XL': 1 }, donation: 1000 } });
  ok('POST /api/quote คิดยอดถูก (500×2 + 550 + 1000 = 2550)', quote.data?.total === 2550,
    `ได้ ${quote.data?.total}`);
  ok('quote แยกส่วนเพิ่มไซส์ใหญ่ออกมา 50', quote.data?.surcharge === 50);

  const badSize = await call('/api/quote', { method: 'POST', json: { counts: { XXL: 1 }, donation: 0 } });
  ok('quote ปฏิเสธไซส์ที่ไม่มีในตาราง (XXL)', badSize.status === 400 && badSize.data.code === 'bad_size');

  const negative = await call('/api/quote', { method: 'POST', json: { counts: {}, donation: -500 } });
  ok('quote ปฏิเสธยอดบริจาคติดลบ', negative.status === 400);

  const statsBefore = await call('/api/stats');
  ok('GET /api/stats ตอบ 200', statsBefore.status === 200);
  ok('บัญชีสาธารณะไม่มีชื่อ/เบอร์/ที่อยู่ปนออกมา',
    !JSON.stringify(statsBefore.data.ledger).match(/name|phone|addr|email|slip/i));

  /* ---------- 2 · ส่งรายการ ---------- */
  section('2 · ส่งรายการจริง');
  const submitIp = nextIp();
  const created = await call('/api/orders', { method: 'POST', body: orderForm(), ip: submitIp });
  ok('POST /api/orders สร้างรายการได้', created.status === 201,
    `ได้ ${created.status} ${JSON.stringify(created.data).slice(0, 160)}`);
  const ref = created.data?.ref;
  ok('ได้รหัสอ้างอิงรูปแบบ AMS49-XXXXXX (6 ตัว)', /^AMS49-[A-Z2-9]{6}$/.test(ref || ''), ref);
  ok('ยอดที่บันทึกตรงกับที่เซิร์ฟเวอร์คิด', created.data?.total === 2550);

  const status = await call(`/api/status/${ref}`);
  ok('GET /api/status/:ref เจอรายการ สถานะ pending', status.data?.order?.status === 'pending');
  ok('หน้าสถานะไม่ส่งชื่อ/เบอร์/ที่อยู่เต็มออกมา',
    !JSON.stringify(status.data.order).match(/ทดสอบ ระบบ|0812345678|ถ\.ทดสอบ/));
  ok('หน้าสถานะส่งแค่จังหวัดกับไปรษณีย์',
    status.data.order.province === 'เชียงใหม่' && status.data.order.zip === '50200');

  /* ---------- 3 · เคสที่ต้องล้มเหลว ---------- */
  section('3 · เคสที่ต้องถูกปฏิเสธ');

  const tampered = await call('/api/orders', {
    method: 'POST', body: orderForm({ clientTotal: '10' }), ip: nextIp()
  });
  ok('ยอดที่ไคลเอนต์แจ้งไม่ตรงกับที่เซิร์ฟเวอร์คิด → 409',
    tampered.status === 409 && tampered.data.code === 'total_mismatch', `ได้ ${tampered.status}`);
  ok('ข้อความบอกยอดจริงของเซิร์ฟเวอร์กลับไปด้วย', tampered.data?.serverTotal === 2550);

  const fakeImage = new File([Buffer.from('MZ\x90\x00 this is not an image')], 'slip.png', { type: 'image/png' });
  const badFile = await call('/api/orders', {
    method: 'POST', body: orderForm({ __file: fakeImage }), ip: nextIp()
  });
  ok('ไฟล์ที่แค่เปลี่ยนนามสกุลเป็น .png → ถูกปฏิเสธจากไบต์จริง',
    badFile.status === 400 && JSON.stringify(badFile.data).includes('JPG'), `ได้ ${badFile.status}`);

  const noConsent = await call('/api/orders', {
    method: 'POST', body: orderForm({ consent: 'false' }), ip: nextIp()
  });
  ok('ไม่ยินยอม PDPA → ถูกปฏิเสธ',
    noConsent.status === 400 && noConsent.data.errors?.some((e) => e.field === 'consent'));

  const futureTime = await call('/api/orders', {
    method: 'POST',
    body: orderForm({ transferAt: new Date(Date.now() + 86400_000).toISOString().slice(0, 16) }),
    ip: nextIp()
  });
  ok('เวลาโอนในอนาคต → ถูกปฏิเสธ',
    futureTime.status === 400 && futureTime.data.errors?.some((e) => e.field === 'transferAt'));

  const noAddr = await call('/api/orders', {
    method: 'POST', body: orderForm({ addrLine: '', province: '', zip: '' }), ip: nextIp()
  });
  ok('สั่งเสื้อแต่ไม่มีที่อยู่ → ถูกปฏิเสธ',
    noAddr.status === 400 && noAddr.data.errors?.some((e) => e.field === 'addrLine'));

  const noAuth = await call('/api/admin/orders');
  ok('GET /api/admin/orders โดยไม่ล็อกอิน → 401', noAuth.status === 401, `ได้ ${noAuth.status}`);
  const noAuthSlip = await call(`/api/admin/slip/${ref}`);
  ok('GET /api/admin/slip/:ref โดยไม่ล็อกอิน → 401', noAuthSlip.status === 401);
  const noAuthExport = await call('/api/admin/export');
  ok('GET /api/admin/export โดยไม่ล็อกอิน → 401', noAuthExport.status === 401);

  const wrongPass = await call('/api/admin/login', {
    method: 'POST', json: { user: ADMIN_USER, password: 'ผิดแน่นอน' }, ip: nextIp()
  });
  ok('ล็อกอินรหัสผิด → 401 และไม่บอกว่าผิดช่องไหน',
    wrongPass.status === 401 && !/ชื่อผู้ใช้ไม่|รหัสผ่านไม่ถูก$/.test(wrongPass.data.message || ''));

  const bruteIp = nextIp();
  let lockedAt = 0;
  for (let i = 1; i <= 7; i++) {
    const r = await call('/api/admin/login', {
      method: 'POST', json: { user: ADMIN_USER, password: 'ผิด' + i }, ip: bruteIp
    });
    if (r.status === 429) { lockedAt = i; break; }
  }
  ok('ลองรหัสผิดรัว ๆ ถูกล็อกภายใน 6 ครั้ง', lockedAt > 0 && lockedAt <= 6, `ล็อกที่ครั้งที่ ${lockedAt}`);

  const rlIp = nextIp();
  let rl = 0;
  for (let i = 0; i < 25; i++) {
    const r = await call('/api/status/AMS49-ZZZZZZ', { ip: rlIp });
    if (r.status === 429) { rl = i + 1; break; }
  }
  ok('ยิงหน้าเช็คสถานะรัว ๆ โดน 429', rl > 0 && rl <= 22, `โดนที่ครั้งที่ ${rl}`);

  const badRef = await call('/api/status/AMS49-O0I1XX');
  ok('รหัสที่มีตัว I O 0 1 ได้คำอธิบายว่าผิดตรงไหน',
    badRef.status === 400 && /I|O|0|1/.test(badRef.data.message || ''), badRef.data?.message);

  /* ---------- 4 · หลังบ้าน ---------- */
  section('4 · หลังบ้าน');
  const login = await call('/api/admin/login', {
    method: 'POST', json: { user: ADMIN_USER, password: ADMIN_PASS }, ip: nextIp()
  });
  ok('ล็อกอินถูกต้อง → 200', login.status === 200, `ได้ ${login.status} ${JSON.stringify(login.data).slice(0, 120)}`);

  const setCookie = login.res.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  ok('ได้ session cookie แบบ HttpOnly', /HttpOnly/i.test(setCookie));
  ok('cookie ตั้ง SameSite=Lax', /SameSite=Lax/i.test(setCookie));
  /* ห้ามมี Max-Age/Expires — ไม่งั้นเบราว์เซอร์เขียนลงดิสก์แล้วรอดข้ามการปิดโปรแกรม
     กรรมการที่ลืมกดออกจากระบบจะเปิดเว็บมาใหม่แล้วเข้าคอนโซลได้เลย */
  ok('cookie เป็นแบบหายเมื่อปิดเบราว์เซอร์ (ไม่มี Max-Age / Expires)',
    !/Max-Age|Expires/i.test(setCookie), setCookie.replace(/=[^;]+/, '=<hidden>'));

  if (!cookie.startsWith('ams49_sess=')) {
    console.log('\n  หยุดเทสต์หลังบ้าน เพราะล็อกอินไม่สำเร็จ\n');
    return report();
  }

  const me = await call('/api/admin/me', { cookie });
  ok('GET /api/admin/me บอกว่าเราเป็นใคร', me.data?.actor === ADMIN_USER);

  const noOrigin = await call(`/api/admin/orders/${ref}`, {
    method: 'PATCH', json: { action: 'verify' }, cookie, origin: 'https://evil.example.com'
  });
  ok('PATCH จากโดเมนอื่น (CSRF) → 403', noOrigin.status === 403, `ได้ ${noOrigin.status}`);

  const list = await call('/api/admin/orders?filter=pending', { cookie });
  ok('GET /api/admin/orders เห็นรายการที่เพิ่งส่ง',
    (list.data?.orders || []).some((o) => o.ref === ref));
  ok('หลังบ้านเห็นชื่อและที่อยู่ได้',
    (list.data?.orders || []).find((o) => o.ref === ref)?.name === 'ทดสอบ ระบบ');

  const slip = await call(`/api/admin/slip/${ref}`, { cookie });
  ok('เปิดไฟล์สลิปจาก KV ได้', slip.status === 200);
  ok('สลิปถูกเสิร์ฟเป็น image/png ตามไบต์จริง',
    (slip.res.headers.get('content-type') || '').includes('image/png'));
  ok('สลิปห้ามถูกแคช', /no-store/.test(slip.res.headers.get('cache-control') || ''));

  const verify = await call(`/api/admin/orders/${ref}`, { method: 'PATCH', json: { action: 'verify' }, cookie });
  ok('ยืนยันยอดสำเร็จ', verify.data?.order?.status === 'verified');

  const afterVerify = await call(`/api/status/${ref}`, { ip: nextIp() });
  ok('หน้าเช็คสถานะเห็นเป็น "ยืนยันแล้ว" ทันที', afterVerify.data?.order?.status === 'verified');

  const statsAfter = await call('/api/stats');
  ok('ยอดสาธารณะเพิ่มขึ้นตามรายการที่ยืนยัน',
    statsAfter.data.stats.verified === statsBefore.data.stats.verified + 2550,
    `${statsBefore.data.stats.verified} → ${statsAfter.data.stats.verified}`);

  const shortReason = await call(`/api/admin/orders/${ref}`, {
    method: 'PATCH', json: { action: 'reject', reason: 'สั้น' }, cookie
  });
  ok('ตีกลับโดยไม่มีเหตุผลที่อ่านรู้เรื่อง → ถูกปฏิเสธ', shortReason.status === 400);

  const ship = await call(`/api/admin/orders/${ref}`, { method: 'PATCH', json: { action: 'ship' }, cookie });
  ok('กด "ส่งของแล้ว" สำเร็จ', !!ship.data?.order?.shippedAt);
  ok('ที่อยู่ถูกลบทิ้งทันทีตามที่สัญญาไว้ในฟอร์มยินยอม',
    ship.data?.order?.addrLine === '' && ship.data?.order?.recipient === '' &&
    ship.data?.order?.zip === '', JSON.stringify(ship.data?.order?.addrLine));

  const afterShip = await call(`/api/status/${ref}`, { ip: nextIp() });
  ok('หน้าเช็คสถานะบอกผู้บริจาคว่าส่งแล้ว', afterShip.data?.order?.shipped === true);

  /* ---------- 5 · CSV ---------- */
  section('5 · CSV');
  const csvIp = nextIp();
  const evil = await call('/api/orders', {
    method: 'POST',
    body: orderForm({ name: '=cmd|calc!A1', counts: JSON.stringify({}), donation: '300', clientTotal: '300',
      addrLine: '', province: '', zip: '', recipient: '', recipientPhone: '' }),
    ip: csvIp
  });
  ok('รับชื่อที่ขึ้นต้นด้วย = ได้ (ไม่ปฏิเสธคนที่ชื่อแปลก)', evil.status === 201, `ได้ ${evil.status}`);

  const csv = await call('/api/admin/export?filter=all', { cookie });
  ok('ดาวน์โหลด CSV ได้', csv.status === 200);

  /* ต้องอ่านเป็นไบต์ดิบ — res.text() ของ fetch กลืน BOM ทิ้งตามสเปกการถอดรหัส UTF-8
     ถ้าเช็คจากสตริงจะเห็นว่า "ไม่มี BOM" ทั้งที่ไฟล์จริงมี */
  const csvRaw = new Uint8Array(await (await fetch(BASE + '/api/admin/export?filter=all', {
    headers: { cookie, 'cf-connecting-ip': nextIp() }
  })).arrayBuffer());
  ok('CSV มี BOM ให้ Excel บน Windows อ่านภาษาไทยออก',
    csvRaw[0] === 0xef && csvRaw[1] === 0xbb && csvRaw[2] === 0xbf,
    [...csvRaw.slice(0, 3)].join(','));
  ok('CSV ใส่ \' นำหน้าค่าที่ขึ้นต้นด้วย = (กัน formula injection)',
    typeof csv.data === 'string' && csv.data.includes(`"'=cmd|calc!A1"`));
  ok('CSV มีคอลัมน์ตรวจยอด priceDrift', typeof csv.data === 'string' && csv.data.includes('priceDrift'));

  /* ---------- 6 · หัวความปลอดภัย ---------- */
  section('6 · หัวความปลอดภัยของหน้าเว็บ');
  const page = await call('/');
  const csp = page.res.headers.get('content-security-policy') || '';
  ok('มี Content-Security-Policy', !!csp);
  ok("CSP ห้ามสคริปต์ inline (ไม่มี 'unsafe-inline' ใน script-src)",
    /script-src[^;]*/.exec(csp) && !/script-src[^;]*unsafe-inline/.test(csp), csp.slice(0, 120));
  /* หน้าสาธารณะ 'self' — เว็บอื่นยังฝังไม่ได้ (คนละ origin) แต่ _diag.html ของเราเองฝังได้
     หน้าหลังบ้าน 'none' — ห้ามถูกซ้อนเพื่อหลอกให้กดยืนยัน/ตีกลับ ไม่ว่าจากที่ไหน */
  ok("หน้าสาธารณะห้ามเว็บอื่นฝัง (frame-ancestors 'self')",
    /frame-ancestors 'self'/.test(csp), csp.slice(0, 160));
  ok('มี X-Content-Type-Options: nosniff',
    page.res.headers.get('x-content-type-options') === 'nosniff');

  const adminPage = await call('/admin');
  ok("หน้าหลังบ้านห้ามถูกฝังใน iframe ใด ๆ (frame-ancestors 'none')",
    /frame-ancestors 'none'/.test(adminPage.res.headers.get('content-security-policy') || ''));
  ok('หน้าแอดมินสั่ง noindex ที่ระดับ header',
    /noindex/.test(adminPage.res.headers.get('x-robots-tag') || ''));
  ok('หน้าแอดมินห้ามแคช', /no-store/.test(adminPage.res.headers.get('cache-control') || ''));

  const redirect = await call('/donate.html');
  ok('ลิงก์เก่า /donate.html เด้งไป /support',
    redirect.status === 301 && (redirect.res.headers.get('location') || '').includes('support'),
    `ได้ ${redirect.status}`);

  report();
};

function report() {
  console.log(`\n${'─'.repeat(48)}`);
  if (fail === 0) {
    console.log(`\x1b[32m\x1b[1mALL PASS\x1b[0m — ผ่าน ${pass} ข้อ\n`);
  } else {
    console.log(`\x1b[31m\x1b[1mFAILED\x1b[0m — ผ่าน ${pass} ข้อ · ไม่ผ่าน ${fail} ข้อ`);
    failures.forEach((f) => console.log(`   · ${f}`));
    console.log('');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('\n\x1b[31mเทสต์ล้ม:\x1b[0m', e);
  console.error('เซิร์ฟเวอร์รันอยู่หรือเปล่า?  npm run dev\n');
  process.exitCode = 1;
});
