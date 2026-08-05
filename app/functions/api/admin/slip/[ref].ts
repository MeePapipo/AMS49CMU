/* GET /api/admin/slip/:ref — สตรีมไฟล์สลิปจากที่เก็บ (Workers KV)

   KV namespace ไม่มี URL สาธารณะให้เข้าถึงตรง ๆ อยู่แล้ว ทางเดียวที่จะเห็นไฟล์
   คือผ่าน endpoint นี้ ซึ่งอยู่หลัง _middleware ของ /api/admin/* แล้ว

   Content-Disposition เป็น inline เพื่อให้เปิดดูในหน้าเว็บได้ แต่บังคับ content-type
   จากที่ตรวจไบต์ไว้ตอนอัปโหลด (เก็บใน D1 คอลัมน์ slip_type) ไม่ใช่จากชื่อไฟล์
   และมี nosniff จาก middleware หลักแล้ว */

import { Env, badRequest, notFound } from '../../../lib/http';
import { normalizeRef, REF_PATTERN } from '../../../lib/ref';
import { log } from '../../../lib/audit';
import { AdminData } from '../_middleware';

export const onRequestGet: PagesFunction<Env, string, AdminData> = async ({ env, params, data, waitUntil }) => {
  const raw = Array.isArray(params.ref) ? params.ref[0] : String(params.ref || '');
  const ref = normalizeRef(decodeURIComponent(raw));
  if (!REF_PATTERN.test(ref)) return badRequest('รูปแบบรหัสไม่ถูกต้อง');

  const row = await env.DB
    .prepare('SELECT slip_key, slip_type, slip_name FROM orders WHERE ref = ?1')
    .bind(ref)
    .first<{ slip_key: string | null; slip_type: string | null; slip_name: string | null }>();

  if (!row || !row.slip_key) return notFound('ไม่มีไฟล์สลิปของรายการนี้');

  const body = await env.SLIPS.get(row.slip_key, 'stream');
  if (!body) return notFound('ไฟล์สลิปหายไปจากที่เก็บ');

  /* บันทึกทุกครั้งที่มีคนเปิดดูสลิป — เอกสารการเงินของคนอื่น ต้องรู้ว่าใครเปิดเมื่อไร */
  waitUntil(log(env.DB, data.admin.actor, 'view-slip', ref));

  return new Response(body, {
    headers: {
      'content-type': row.slip_type || 'application/octet-stream',
      'content-disposition': `inline; filename="${ref}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff'
    }
  });
};
