/* GET /api/status/:ref
   หน้าเช็คสถานะ — เปิดได้ด้วยรหัสอ้างอิงอย่างเดียว ไม่มีการค้นด้วยชื่อและจะไม่มี
   (รุ่นเดียวคนไม่เยอะ ค้นด้วยชื่อเมื่อไรก็เดาออกทันทีว่าใครบริจาคเท่าไร)

   สองอย่างที่ต้องมีเพราะกลายเป็น API สาธารณะแล้ว:
   1. จำกัดอัตรา — รหัส 6 ตัวมีพันล้านค่า แต่ก็ยังต้องกันคนเขียนสคริปต์ไล่ยิง
   2. ตอบ "ไม่พบ" หน้าตาเดียวกันเสมอ ทั้งกรณีรหัสผิดรูป รหัสไม่มีจริง และโดนจำกัดอัตรา
      ต้องแยก 429 ออกมาเพราะผู้ใช้จริงต้องรู้ว่าให้รอ แต่ 404 ต้องไม่บอกอะไรมากกว่านั้น */

import { Env, json, notFound, tooMany, clientIp } from '../../lib/http';
import { normalizeRef, describeRefProblem, REF_PATTERN } from '../../lib/ref';
import { consume, bucketFor, sweep } from '../../lib/rate';
import { toStatusView, OrderRow } from '../../lib/shape';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  const raw = Array.isArray(params.ref) ? params.ref[0] : String(params.ref || '');
  const ref = normalizeRef(decodeURIComponent(raw));

  const bucket = await bucketFor('status', clientIp(request));
  const rl = await consume(env.DB, bucket, 20, 60_000);
  if (!rl.ok) {
    return tooMany(`ค้นถี่เกินไป ลองใหม่ในอีก ${rl.retryAfter} วินาที`, rl.retryAfter);
  }
  waitUntil(sweep(env.DB));

  /* รูปแบบผิดตอบพร้อมคำอธิบายได้ เพราะไม่ได้บอกอะไรเกี่ยวกับข้อมูลในระบบ
     — และเป็นสาเหตุที่คนพิมพ์ผิดเจอบ่อยที่สุด (I O 0 1 ไม่มีในชุดตัวอักษร) */
  const problem = describeRefProblem(ref);
  if (problem || !REF_PATTERN.test(ref)) {
    return json({ ok: false, code: 'bad_ref', message: problem || 'รูปแบบรหัสไม่ถูกต้อง' }, { status: 400 });
  }

  const row = await env.DB
    .prepare('SELECT * FROM orders WHERE ref = ?1')
    .bind(ref)
    .first<OrderRow>();

  if (!row) return notFound('ไม่พบรหัสนี้');

  return json({ ok: true, order: toStatusView(row) });
};
