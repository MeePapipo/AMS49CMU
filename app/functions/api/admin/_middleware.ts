/* ============================================================================
   ประตูของ /api/admin/*  — ทุกอย่างที่อยู่หลังไฟล์นี้เห็นชื่อ เบอร์ ที่อยู่ และสลิปของทุกคน

   ต่างจากต้นแบบตรงที่การตรวจเกิดที่เซิร์ฟเวอร์ ไม่ใช่ที่เบราว์เซอร์
   ต้นแบบเทียบ admin/Admin001 ด้วย JavaScript ในหน้าเว็บ ซึ่งใครกด Ctrl+U ก็อ่านรหัสได้
   และตั้ง sessionStorage เองจาก console ก็เข้าได้ทันที

   ยกเว้นเส้นทางเดียวคือ /api/admin/login ที่ต้องเข้าได้โดยยังไม่มีสิทธิ์
   ========================================================================= */

import { Env, unauthorized, fail } from '../../lib/http';
import { resolveAdmin, AdminIdentity, accessEnabled } from '../../lib/auth';

export interface AdminData extends Record<string, unknown> {
  admin: AdminIdentity;
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export const onRequest: PagesFunction<Env, string, AdminData> = async (ctx) => {
  const url = new URL(ctx.request.url);

  /* หน้าล็อกอินต้องเข้าได้ตอนยังไม่มี session — แต่ถ้าเปิดโหมด Access ไว้
     รหัสผ่านถูกปิดทั้งระบบ ไม่ควรมีใครยิง endpoint นี้ได้เลย */
  if (url.pathname === '/api/admin/login') {
    if (accessEnabled(ctx.env)) {
      return fail(404, 'not_found', 'ระบบนี้ใช้การเข้าสู่ระบบผ่าน Cloudflare Access');
    }
    return ctx.next();
  }

  /* กัน CSRF อีกชั้นนอกเหนือจาก SameSite=Lax ของ cookie
     คำขอที่เปลี่ยนข้อมูลต้องมาจากหน้าเว็บของตัวเองเท่านั้น */
  if (!SAFE.has(ctx.request.method)) {
    const origin = ctx.request.headers.get('origin');
    if (!origin || new URL(origin).host !== url.host) {
      return fail(403, 'bad_origin', 'คำขอนี้ไม่ได้มาจากหน้าเว็บของระบบ');
    }
  }

  const admin = await resolveAdmin(ctx.request, ctx.env);
  if (!admin) return unauthorized();

  ctx.data.admin = admin;
  return ctx.next();
};
