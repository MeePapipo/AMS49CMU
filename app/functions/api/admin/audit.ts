/* GET /api/admin/audit?limit=100 — ใครทำอะไรกับรายการไหนเมื่อไร
   กรรมการหลายคนใช้ระบบเดียวกัน ถ้าไม่มีหน้านี้ก็ตอบไม่ได้ว่าใครกดตีกลับ
   หรือใครเปิดดูสลิปของใคร */

import { Env, json } from '../../lib/http';
import { AdminData } from './_middleware';

export const onRequestGet: PagesFunction<Env, string, AdminData> = async ({ request, env }) => {
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 120));
  const ref = (url.searchParams.get('ref') || '').trim();

  const rows = ref
    ? await env.DB.prepare('SELECT * FROM audit WHERE ref = ?1 ORDER BY id DESC LIMIT ?2')
        .bind(ref, limit).all()
    : await env.DB.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?1')
        .bind(limit).all();

  return json({ ok: true, entries: rows.results || [] });
};
