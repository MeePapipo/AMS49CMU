/* GET   /api/admin/orders/:ref        อ่านรายการเดียว
   PATCH /api/admin/orders/:ref  { action, ... }

   action ที่รองรับ
   ─ verify   ยืนยันยอด → ขึ้นหน้าสาธารณะทันที
   ─ reject   ตีกลับพร้อมเหตุผล (ผู้บริจาคเห็นข้อความนี้ในหน้าเช็คสถานะ)
   ─ reopen   ดึงกลับมาเป็น "รอตรวจสอบ" เผื่อกดผิด
   ─ ship     ส่งของแล้ว → **ลบที่อยู่ทิ้งทันที** ตามที่สัญญาไว้ในฟอร์มยินยอม
   ─ purge    ปิดโครงการ → ลบข้อมูลส่วนบุคคลทั้งชุดและไฟล์สลิป เหลือแค่ยอดกับรหัส

   ship กับ purge คือส่วนที่ต้นแบบไม่มี ทั้งที่ข้อความยินยอมเขียนสัญญาไว้แล้วว่า
   "ใช้ทำใบปะหน้าพัสดุแล้วลบทิ้งเมื่อส่งครบ" — สัญญาที่ไม่มีปุ่มให้กดคือสัญญาที่ไม่มีวันเกิดขึ้น */

import { Env, json, badRequest, notFound, thNow } from '../../../lib/http';
import { normalizeRef, REF_PATTERN } from '../../../lib/ref';
import { toAdminView, OrderRow } from '../../../lib/shape';
import { text, LIMITS } from '../../../lib/validate';
import { log } from '../../../lib/audit';
import { AdminData } from '../_middleware';

function refOf(params: Record<string, string | string[]>): string {
  const raw = Array.isArray(params.ref) ? params.ref[0] : String(params.ref || '');
  return normalizeRef(decodeURIComponent(raw));
}

export const onRequestGet: PagesFunction<Env, string, AdminData> = async ({ env, params }) => {
  const ref = refOf(params);
  if (!REF_PATTERN.test(ref)) return badRequest('รูปแบบรหัสไม่ถูกต้อง');
  const row = await env.DB.prepare('SELECT * FROM orders WHERE ref = ?1').bind(ref).first<OrderRow>();
  if (!row) return notFound();
  return json({ ok: true, order: toAdminView(row) });
};

export const onRequestPatch: PagesFunction<Env, string, AdminData> = async ({ request, env, params, data }) => {
  const ref = refOf(params);
  if (!REF_PATTERN.test(ref)) return badRequest('รูปแบบรหัสไม่ถูกต้อง');

  let body: { action?: string; reason?: string };
  try { body = await request.json(); } catch { return badRequest('อ่านข้อมูลที่ส่งมาไม่ได้'); }

  const row = await env.DB.prepare('SELECT * FROM orders WHERE ref = ?1').bind(ref).first<OrderRow>();
  if (!row) return notFound();
  if (row.purged_at) return badRequest('รายการนี้ถูกลบข้อมูลส่วนบุคคลไปแล้ว แก้ไขต่อไม่ได้', 'purged');

  const actor = data.admin.actor;
  const now = thNow();

  switch (body.action) {
    case 'verify': {
      await env.DB
        .prepare(`UPDATE orders SET status='verified', verified_at=?2, note='' WHERE ref=?1`)
        .bind(ref, now).run();
      await log(env.DB, actor, 'verify', ref, `ยอด ${row.total}`);
      break;
    }

    case 'reject': {
      const reason = text(body.reason, LIMITS.note);
      if (reason.length < 5) {
        return badRequest('ระบุเหตุผลอย่างน้อย 5 ตัวอักษร ผู้บริจาคจะเห็นข้อความนี้', 'reason_required');
      }
      await env.DB
        .prepare(`UPDATE orders SET status='rejected', verified_at=NULL, note=?2 WHERE ref=?1`)
        .bind(ref, reason).run();
      await log(env.DB, actor, 'reject', ref, reason);
      break;
    }

    case 'reopen': {
      await env.DB
        .prepare(`UPDATE orders SET status='pending', verified_at=NULL, note='' WHERE ref=?1`)
        .bind(ref).run();
      await log(env.DB, actor, 'reopen', ref, `จาก ${row.status}`);
      break;
    }

    case 'ship': {
      if (row.status !== 'verified') return badRequest('ต้องยืนยันยอดก่อนจึงจะกดส่งของได้');
      if (row.shirt_qty === 0) return badRequest('รายการนี้ไม่ได้สั่งเสื้อ ไม่มีของต้องส่ง');
      await env.DB
        .prepare(
          `UPDATE orders SET shipped_at=?2,
             recipient='', recipient_phone='', addr_line='', province='', zip='', ship_note=''
           WHERE ref=?1`
        )
        .bind(ref, now).run();
      await log(env.DB, actor, 'ship', ref, 'ส่งของแล้วและลบที่อยู่จัดส่งทิ้ง');
      break;
    }

    case 'purge': {
      /* ลบไฟล์สลิปออกจากที่เก็บจริง ๆ ไม่ใช่แค่ตัดลิงก์ในฐานข้อมูล */
      if (row.slip_key) await env.SLIPS.delete(row.slip_key).catch(() => {});
      await env.DB
        .prepare(
          `UPDATE orders SET purged_at=?2,
             name='', student_id='', phone='', email='', line_id='',
             recipient='', recipient_phone='', addr_line='', province='', zip='', ship_note='',
             slip_key=NULL, slip_type=NULL, slip_size=NULL, slip_name=NULL,
             ip_hash='', user_agent=''
           WHERE ref=?1`
        )
        .bind(ref, now).run();
      await log(env.DB, actor, 'purge', ref, 'ลบข้อมูลส่วนบุคคลและไฟล์สลิป');
      break;
    }

    default:
      return badRequest('ไม่รู้จักคำสั่งนี้');
  }

  const after = await env.DB.prepare('SELECT * FROM orders WHERE ref = ?1').bind(ref).first<OrderRow>();
  return json({ ok: true, order: after ? toAdminView(after) : null });
};
