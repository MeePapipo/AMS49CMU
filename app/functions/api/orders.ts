/* POST /api/orders   (multipart/form-data)
   สร้างรายการใหม่ — จุดเดียวในระบบที่คนนอกเขียนข้อมูลลงฐานได้

   ลำดับการตรวจตั้งใจเรียงจาก "ถูกที่สุด" ไป "แพงที่สุด"
   จำกัดอัตรา → ขนาด body → Turnstile → คิดยอด → ตรวจฟิลด์ → ตรวจไบต์ไฟล์ → เขียน
   คนที่ยิงมั่วจะถูกตีตกก่อนที่เราจะเสีย CPU กับการอ่านไฟล์ 5 MB

   ยอดเงิน: เซิร์ฟเวอร์คิดเองเสมอจาก counts ที่ส่งมา ไม่เคยรับตัวเลขยอดจากไคลเอนต์
   clientTotal ที่แนบมาไม่ได้เอาไปใช้คิด แต่เอามา "เทียบ" ว่าเลขที่ผู้ใช้เห็นบนหน้าจอ
   ตอนกดส่งตรงกับที่ระบบจะบันทึกไหม ไม่ตรง = ไม่บันทึก แล้วบอกให้โหลดหน้าใหม่
   เพราะคนที่กำลังจะโอนเงินต้องไม่มีวันเห็นเลขคนละตัวกับที่ระบบรอ */

import { Env, json, badRequest, fail, thNow, clientIp, ipHash } from '../lib/http';
import { computeQuote, QuoteError, PRICE_VERSION } from '../lib/pricing';
import { consume, bucketFor } from '../lib/rate';
import { allocateRef } from '../lib/ref';
import { readDonor, validateDonor, MAX_SLIP_BYTES, SLIP_EXT, sniffType, text } from '../lib/validate';

const MAX_BODY = MAX_SLIP_BYTES + 512 * 1024; // ไฟล์ 5 MB + ช่องข้อความอีกครึ่ง MB

async function verifyTurnstile(env: Env, token: string, ip: string): Promise<boolean> {
  if (env.TURNSTILE_ENABLED !== '1') return true;
  if (!env.TURNSTILE_SECRET) {
    /* เปิดสวิตช์ไว้แต่ไม่ได้ใส่ความลับ = ตั้งค่าพลาด ต้องไม่ปล่อยผ่านเงียบ ๆ */
    console.error('TURNSTILE_ENABLED=1 but TURNSTILE_SECRET is missing');
    return false;
  }
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET);
  body.append('response', token);
  body.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const out = (await res.json()) as { success?: boolean };
  return !!out.success;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const ip = clientIp(request);

  /* 1 · จำกัดอัตรา — 3 ครั้ง/นาที กันกดรัว · 12 ครั้ง/ชั่วโมง กันสคริปต์ถล่ม
     ตั้งไว้หลวมพอที่คนบ้านเดียวกันหลายคนสั่งจาก wifi เดียวกันได้ */
  const minute = await consume(env.DB, await bucketFor('submit-m', ip), 3, 60_000);
  if (!minute.ok) {
    return fail(429, 'rate_limited',
      `ส่งถี่เกินไป ลองใหม่ในอีก ${minute.retryAfter} วินาที — ถ้ากดส่งไปแล้วให้เช็คหน้าสถานะก่อน`,
      { retryAfter: minute.retryAfter });
  }
  const hour = await consume(env.DB, await bucketFor('submit-h', ip), 12, 3_600_000);
  if (!hour.ok) {
    return fail(429, 'rate_limited',
      'ส่งครบจำนวนสูงสุดของชั่วโมงนี้แล้ว ถ้าต้องส่งมากกว่านี้ กรุณาทักกรรมการรุ่น',
      { retryAfter: hour.retryAfter });
  }

  /* 2 · ขนาด body — ตัดตั้งแต่ยังไม่อ่าน */
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY) {
    return fail(413, 'too_large', 'ไฟล์ใหญ่เกิน 5 MB ลองถ่ายภาพหน้าจอแทนการส่งไฟล์ต้นฉบับ');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest('อ่านข้อมูลที่ส่งมาไม่ได้ ลองส่งใหม่อีกครั้ง');
  }

  /* 3 · Turnstile */
  const passed = await verifyTurnstile(env, String(form.get('turnstileToken') || ''), ip);
  if (!passed) {
    return fail(403, 'turnstile', 'ระบบยืนยันว่าไม่ใช่บอทไม่ผ่าน กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง');
  }

  /* 4 · คิดยอดจากของที่สั่ง */
  let counts: unknown;
  try {
    counts = JSON.parse(String(form.get('counts') || '{}'));
  } catch {
    return badRequest('รายการเสื้อที่ส่งมาอ่านไม่ได้');
  }

  let q;
  try {
    q = computeQuote(counts, form.get('donation'));
  } catch (e) {
    if (e instanceof QuoteError) return badRequest(e.message, e.code);
    throw e;
  }

  if (!q.qty && !q.donation) {
    return badRequest('ยังไม่ได้เลือกอะไรเลย — ใส่จำนวนเสื้ออย่างน้อย 1 ตัว หรือระบุยอดบริจาค', 'empty_order');
  }

  const clientTotal = Number(form.get('clientTotal'));
  if (Number.isFinite(clientTotal) && clientTotal !== q.total) {
    return fail(409, 'total_mismatch',
      'ยอดที่แสดงบนหน้าจอไม่ตรงกับที่ระบบคำนวณ กรุณากด Ctrl+Shift+R โหลดหน้าใหม่แล้วทำรายการอีกครั้ง — ' +
      'อย่าเพิ่งโอนเงินตามยอดเดิม',
      { serverTotal: q.total, clientTotal });
  }

  /* 5 · ตรวจฟิลด์ */
  const donor = readDonor(form);
  const errors = validateDonor(donor, q.qty > 0);
  if (errors.length) {
    return json({ ok: false, code: 'invalid', message: 'ข้อมูลยังไม่ครบ', errors }, { status: 400 });
  }

  /* 6 · ตรวจไฟล์สลิปจากไบต์จริง ไม่เชื่อ content-type ที่ไคลเอนต์แจ้งมา */
  const slip = form.get('slip');
  if (!(slip instanceof File) || slip.size === 0) {
    return json({ ok: false, code: 'invalid', message: 'ต้องแนบสลิปการโอน',
      errors: [{ field: 'slip', message: 'ต้องแนบสลิปการโอน' }] }, { status: 400 });
  }
  if (slip.size > MAX_SLIP_BYTES) {
    return json({ ok: false, code: 'invalid', message: 'ไฟล์ใหญ่เกิน 5 MB',
      errors: [{ field: 'slip', message: `ไฟล์ใหญ่เกิน 5 MB (ไฟล์นี้ ${(slip.size / 1048576).toFixed(1)} MB)` }] },
      { status: 400 });
  }

  const bytes = new Uint8Array(await slip.arrayBuffer());
  const realType = sniffType(bytes.subarray(0, 16));
  if (!realType || !SLIP_EXT.has(realType)) {
    return json({ ok: false, code: 'invalid', message: 'ชนิดไฟล์ไม่ถูกต้อง',
      errors: [{ field: 'slip', message: 'ไฟล์ต้องเป็น JPG, PNG, WEBP หรือ PDF เท่านั้น' }] },
      { status: 400 });
  }

  /* 7 · เขียน — ไฟล์ก่อน แล้วค่อย D1
     ถ้าเขียน D1 ไม่สำเร็จ ต้องลบไฟล์ทิ้ง ไม่งั้นจะเหลือสลิปกำพร้าที่ไม่มีใครเป็นเจ้าของ
     กลับกัน ถ้าเขียน D1 ก่อนแล้วอัปโหลดพัง จะได้รายการที่กรรมการตรวจไม่ได้เลย

     ที่เก็บเป็น KV (ดูเหตุผลใน wrangler.toml) จึงเก็บได้แค่ไบต์ล้วน ไม่มี httpMetadata
     ชนิดไฟล์ที่ตรวจได้จริงถูกบันทึกลง D1 คอลัมน์ slip_type แล้วเอามาใช้ตอนเสิร์ฟ
     metadata ของ KV เก็บซ้ำไว้เผื่อวันหนึ่งต้องกู้ไฟล์โดยไม่มี D1 */
  const ref = await allocateRef(env.DB);
  const now = thNow();
  const ext = SLIP_EXT.get(realType) as string;
  const key = `slips/${now.slice(0, 4)}/${ref}.${ext}`;

  await env.SLIPS.put(key, bytes, {
    metadata: { ref, type: realType, uploadedAt: now }
  });

  try {
    await env.DB
      .prepare(
        `INSERT INTO orders (
           ref, status, donation, shirt_amount, surcharge, total, price_version,
           shirt_qty, sizes, transfer_at, submitted_at, verified_at, note,
           name, student_id, phone, email, line_id,
           recipient, recipient_phone, addr_line, province, zip, ship_note,
           slip_key, slip_type, slip_size, slip_name,
           ip_hash, user_agent, created_at
         ) VALUES (
           ?1, 'pending', ?2, ?3, ?4, ?5, ?6,
           ?7, ?8, ?9, ?10, NULL, '',
           ?11, ?12, ?13, ?14, ?15,
           ?16, ?17, ?18, ?19, ?20, ?21,
           ?22, ?23, ?24, ?25,
           ?26, ?27, ?28
         )`
      )
      .bind(
        ref, q.donation, q.shirtAmount, q.surcharge, q.total, PRICE_VERSION,
        q.qty, JSON.stringify(q.sizes), donor.transferAt, now,
        donor.name, donor.studentId, donor.phone, donor.email, donor.lineId,
        /* ไม่ได้สั่งเสื้อ = ไม่มีของต้องส่ง = ไม่เก็บข้อมูลจัดส่งเลย แม้ไคลเอนต์จะส่งมา */
        q.qty ? donor.recipient : '', q.qty ? donor.recipientPhone : '',
        q.qty ? donor.addrLine : '', q.qty ? donor.province : '',
        q.qty ? donor.zip : '', q.qty ? donor.shipNote : '',
        key, realType, slip.size, text(slip.name, 120),
        await ipHash(request, env), text(request.headers.get('user-agent'), 200), now
      )
      .run();
  } catch (e) {
    await env.SLIPS.delete(key).catch(() => {});
    console.error('insert order failed', e);
    return fail(500, 'save_failed',
      'บันทึกรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง — ถ้าโอนเงินไปแล้วให้ทักกรรมการรุ่นพร้อมสลิป');
  }

  return json({
    ok: true,
    ref,
    total: q.total,
    donation: q.donation,
    shirtAmount: q.shirtAmount,
    surcharge: q.surcharge,
    shirtQty: q.qty,
    sizes: q.sizes,
    submittedAt: now,
    transferAt: donor.transferAt,
    status: 'pending'
  }, { status: 201 });
};
