/* POST /api/admin/login  { user, password }

   ตรวจกับ PBKDF2 ที่เก็บใน secret ADMIN_USERS แล้วออก session cookie ที่เซ็นด้วย HMAC
   รหัสผ่านและแฮชไม่เคยถูกส่งไปที่เบราว์เซอร์ ต่างจากต้นแบบที่ฝังรหัสไว้ในไฟล์ HTML

   ไม่บอกว่าผิดช่องไหน — บอกไปก็เท่ากับใบ้ว่าชื่อผู้ใช้นี้มีอยู่จริง
   และเมื่อพิมพ์ชื่อผู้ใช้ที่ไม่มีอยู่ ยังต้องเสียเวลาแฮชเท่า ๆ กัน ไม่งั้นเวลาที่ตอบ
   จะบอกได้เองว่าชื่อไหนมีจริง */

import { Env, json, badRequest, fail, clientIp } from '../../lib/http';
import {
  verifyPassword, signSession, sessionCookieHeader, SESSION_TTL_MS, DEFAULT_ITERATIONS, hashPassword
} from '../../lib/crypto';
import { parseAdminUsers } from '../../lib/auth';
import { consume, refund, bucketFor } from '../../lib/rate';
import { log } from '../../lib/audit';

/* แฮชหลอกไว้ให้เทียบตอนไม่มีชื่อผู้ใช้นั้น เพื่อให้เวลาที่ใช้ตอบใกล้เคียงกัน
   สร้างครั้งเดียวตอน worker ตื่น */
let dummyHash: string | null = null;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const bucket = await bucketFor('login', clientIp(request));
  const rl = await consume(env.DB, bucket, 5, 15 * 60_000);
  if (!rl.ok) {
    return fail(429, 'rate_limited',
      `ลองผิดหลายครั้งเกินไป รอ ${Math.ceil(rl.retryAfter / 60)} นาทีแล้วลองใหม่`,
      { retryAfter: rl.retryAfter });
  }

  if (!env.SESSION_SECRET) {
    console.error('SESSION_SECRET ยังไม่ได้ตั้ง — ปฏิเสธการล็อกอินทั้งหมด');
    return fail(503, 'not_configured',
      'ระบบยังตั้งค่าไม่ครบ (ยังไม่มี SESSION_SECRET) — ดูขั้นตอนใน DEPLOY.md');
  }

  let body: { user?: string; password?: string };
  try { body = await request.json(); } catch { return badRequest('อ่านข้อมูลที่ส่งมาไม่ได้'); }

  const user = String(body.user || '').trim().slice(0, 60);
  const password = String(body.password || '').slice(0, 200);
  if (!user || !password) return badRequest('กรอกชื่อผู้ใช้และรหัสผ่าน');

  const users = parseAdminUsers(env);
  if (!users.length) {
    console.error('ADMIN_USERS ว่าง — ยังไม่มีใครเข้าระบบได้');
    return fail(503, 'not_configured',
      'ยังไม่ได้ตั้งรายชื่อแอดมิน (ADMIN_USERS) — ดูขั้นตอนใน DEPLOY.md');
  }

  const found = users.find((u) => u.u === user);
  if (!dummyHash) dummyHash = await hashPassword('x'.repeat(32), DEFAULT_ITERATIONS);
  const ok = await verifyPassword(password, found ? found.hash : dummyHash);

  if (!found || !ok) {
    await log(env.DB, user || '(ว่าง)', 'login-failed', null, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    return fail(401, 'bad_credentials', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }

  /* เข้าถูกแล้วคืนโควตาให้ — ไม่อย่างนั้นคนที่เข้าออกวันละหลายครั้งจะโดนล็อกเอง */
  await refund(env.DB, bucket);

  const now = Date.now();
  const token = await signSession(
    { u: found.u, n: found.name || found.u, iat: now, exp: now + SESSION_TTL_MS },
    env.SESSION_SECRET
  );
  await log(env.DB, found.u, 'login', null, '');

  return json(
    { ok: true, actor: found.u, name: found.name || found.u, via: 'password',
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString() },
    { headers: { 'set-cookie': sessionCookieHeader(token, new URL(request.url), SESSION_TTL_MS / 1000) } }
  );
};
