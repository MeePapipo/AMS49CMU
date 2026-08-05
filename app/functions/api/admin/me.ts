/* GET /api/admin/me — หน้าแอดมินถามว่า "ตอนนี้ฉันเข้าระบบอยู่หรือเปล่า และเป็นใคร"
   ตอบ 401 เมื่อยังไม่ได้เข้า (middleware จัดการให้) หน้าเว็บจึงรู้ว่าต้องโชว์ฟอร์มล็อกอิน
   หรือเข้าคอนโซลได้เลย (กรณี Cloudflare Access ผู้ใช้ผ่านมาแล้วตั้งแต่ขอบเครือข่าย) */

import { Env, json } from '../../lib/http';
import { AdminData } from './_middleware';

export const onRequestGet: PagesFunction<Env, string, AdminData> = async ({ data }) => {
  return json({ ok: true, actor: data.admin.actor, name: data.admin.name, via: data.admin.via });
};
