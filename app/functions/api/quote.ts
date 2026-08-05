/* POST /api/quote  { counts: {M:2, L:1}, donation: 1000 }
   → ยอดที่เซิร์ฟเวอร์คิด

   นี่คือหัวใจของการแก้ปัญหาที่ต้นแบบกลัวที่สุด:
   เคยเกิดจริงว่าเบราว์เซอร์แคช app.js ตัวเก่าไว้ ยอดรวมบนหน้าจอค้างไม่ขยับ
   แต่ช่องจำนวนยังกดเพิ่มได้ ผู้ใช้จึงโอนตามยอดที่ผิดโดยไม่รู้ตัว
   ต้นแบบแก้ด้วยการเทียบเลขเวอร์ชันไฟล์แล้วหยุดทั้งหน้า ซึ่งเป็นการกันอาการ
   ที่นี่แก้ที่ต้นเหตุ — ยอดที่แสดงบนขั้น "โอน" มาจากเซิร์ฟเวอร์ ไม่ใช่เลขคณิตในเบราว์เซอร์
   ต่อให้ JS ในเครื่องผู้ใช้เก่าแค่ไหน ยอดที่เห็นก็คือยอดที่ระบบจะเรียกเก็บจริง */

import { Env, json, badRequest, clientIp } from '../lib/http';
import { computeQuote, QuoteError, sizeSummary, BULK_HINT } from '../lib/pricing';
import { consume, bucketFor } from '../lib/rate';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const rl = await consume(env.DB, await bucketFor('quote', clientIp(request)), 120, 60_000);
  if (!rl.ok) return json({ ok: false, code: 'rate_limited', message: 'เรียกถี่เกินไป' }, { status: 429 });

  let body: { counts?: unknown; donation?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest('อ่านข้อมูลที่ส่งมาไม่ได้');
  }

  try {
    const q = computeQuote(body.counts, body.donation);
    return json({
      ok: true,
      ...q,
      sizeText: sizeSummary(q.sizes),
      bulkHint: q.qty > BULK_HINT
    });
  } catch (e) {
    if (e instanceof QuoteError) return badRequest(e.message, e.code);
    throw e;
  }
};
