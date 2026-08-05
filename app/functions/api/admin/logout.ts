/* POST /api/admin/logout — ลบ cookie ทิ้ง
   ไม่มีตาราง session ให้ลบ token ที่ถูกก๊อปไว้แล้วจึงยังใช้ได้จนหมดอายุ 8 ชั่วโมง
   ยอมรับได้สำหรับงานนี้ ถ้าวันหนึ่งต้องเตะออกทันที ให้เปลี่ยน SESSION_SECRET
   ซึ่งจะทำให้ทุก token ที่ออกไปแล้วใช้ไม่ได้พร้อมกัน */

import { Env, json } from '../../lib/http';
import { SESSION_COOKIE } from '../../lib/crypto';
import { AdminData } from './_middleware';
import { log } from '../../lib/audit';

export const onRequestPost: PagesFunction<Env, string, AdminData> = async ({ request, env, data }) => {
  await log(env.DB, data.admin.actor, 'logout');
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return json(
    { ok: true },
    { headers: { 'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}` } }
  );
};
