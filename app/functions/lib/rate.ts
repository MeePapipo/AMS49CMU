/* ============================================================================
   จำกัดอัตราการเรียก — เก็บตัวนับใน D1
   งานนี้ traffic น้อยมาก (คนรุ่นเดียว) D1 จึงเพียงพอ ไม่ต้องเสียเงินซื้อ KV
   หมายเหตุ: การนับผ่าน D1 ไม่ได้ atomic ข้าม region แต่สำหรับงานนี้ผลต่างระดับ
   หนึ่งสองครั้งไม่มีความหมาย สิ่งที่ต้องกันคือสคริปต์ยิงพันครั้ง ไม่ใช่คนกดเร็วสองครั้ง
   ========================================================================= */

import { sha256hex } from './http';

export interface RateResult { ok: boolean; remaining: number; retryAfter: number; }

export async function consume(
  db: D1Database, bucket: string, limit: number, windowMs: number
): Promise<RateResult> {
  const now = Date.now();
  const resetAt = now + windowMs;

  const row = await db
    .prepare(
      `INSERT INTO rate (bucket, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(bucket) DO UPDATE SET
         count    = CASE WHEN rate.reset_at <= ?3 THEN 1   ELSE rate.count + 1 END,
         reset_at = CASE WHEN rate.reset_at <= ?3 THEN ?2  ELSE rate.reset_at  END
       RETURNING count, reset_at`
    )
    .bind(bucket, resetAt, now)
    .first<{ count: number; reset_at: number }>();

  const count = row?.count ?? 1;
  const until = row?.reset_at ?? resetAt;

  return {
    ok: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfter: Math.max(1, Math.ceil((until - now) / 1000))
  };
}

/* คืนตัวนับให้เมื่อการเรียกนั้น "สำเร็จ" และเราไม่อยากให้มันกินโควตา
   ใช้กับล็อกอิน: นับเฉพาะครั้งที่ผิด คนที่พิมพ์ถูกไม่ควรโดนล็อกเพราะเข้าออกบ่อย */
export async function refund(db: D1Database, bucket: string): Promise<void> {
  await db.prepare('UPDATE rate SET count = MAX(0, count - 1) WHERE bucket = ?1').bind(bucket).run();
}

export async function bucketFor(kind: string, ip: string): Promise<string> {
  return `${kind}:${(await sha256hex(ip)).slice(0, 24)}`;
}

/* เก็บกวาดแถวที่หมดอายุ — เรียกแบบไฟไหม้ไม่ต้องรอ (waitUntil) จาก endpoint ที่ถูกเรียกบ่อย */
export async function sweep(db: D1Database): Promise<void> {
  try {
    await db.prepare('DELETE FROM rate WHERE reset_at <= ?1').bind(Date.now()).run();
  } catch { /* กวาดไม่ได้ก็ไม่เป็นไร ตารางนี้โตช้ามาก */ }
}
