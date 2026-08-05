/* GET /api/stats
   ยอดรวมและบัญชีสาธารณะสำหรับหน้าแรก

   ข้อตัดสินใจที่ห้ามเปลี่ยน: หน้าสาธารณะแสดงได้แค่ เวลา · รหัส · สถานะ · ยอด
   endpoint นี้จึงเลือกคอลัมน์เองทีละคอลัมน์ ไม่ใช่ SELECT * แล้วค่อยกรองทีหลัง
   เพิ่มคอลัมน์ใหม่ในตารางเมื่อไร จะไม่หลุดออกมาที่นี่โดยอัตโนมัติ */

import { Env, json } from '../lib/http';
import { toPublicLedger, OrderRow } from '../lib/shape';

const LEDGER_LIMIT = 300;

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const totals = await env.DB
    .prepare(
      `SELECT status,
              COUNT(*)            AS n,
              SUM(donation)       AS donation,
              SUM(shirt_amount)   AS shirt_amount,
              SUM(shirt_qty)      AS shirt_qty,
              SUM(total)          AS total
         FROM orders
        GROUP BY status`
    )
    .all<{ status: string; n: number; donation: number; shirt_amount: number; shirt_qty: number; total: number }>();

  const by: Record<string, { n: number; donation: number; shirtAmount: number; shirtQty: number; total: number }> = {};
  for (const r of totals.results || []) {
    by[r.status] = {
      n: r.n || 0,
      donation: r.donation || 0,
      shirtAmount: r.shirt_amount || 0,
      shirtQty: r.shirt_qty || 0,
      total: r.total || 0
    };
  }
  const v = by.verified || { n: 0, donation: 0, shirtAmount: 0, shirtQty: 0, total: 0 };
  const p = by.pending || { n: 0, donation: 0, shirtAmount: 0, shirtQty: 0, total: 0 };

  const rows = await env.DB
    .prepare(
      `SELECT ref, status, transfer_at, donation, shirt_amount, shirt_qty, total, note
         FROM orders
        ORDER BY transfer_at DESC, created_at DESC
        LIMIT ?1`
    )
    .bind(LEDGER_LIMIT)
    .all<OrderRow>();

  return json(
    {
      ok: true,
      stats: {
        donation: v.donation,               // เงินบริจาคที่ยืนยันแล้ว = ตัวเลขใหญ่บนหน้าแรก
        shirtRevenue: v.shirtAmount,        // ยอดขายเสื้อ นับแยกเพราะยังไม่หักต้นทุน
        verified: v.donation + v.shirtAmount,
        shirts: v.shirtQty,
        pending: p.total,
        verifiedCount: v.n,
        pendingCount: p.n,
        goal: Number(env.GOAL_AMOUNT || 500000)
      },
      ledger: (rows.results || []).map(toPublicLedger),
      truncated: (rows.results || []).length >= LEDGER_LIMIT
    },
    /* แคช 20 วินาทีที่ขอบเครือข่าย — หน้าแรกถูกเปิดบ่อยตอนแชร์ในไลน์กลุ่ม
       และยอดที่ช้าไป 20 วินาทีไม่ทำให้ใครเสียหาย แต่ช่วยให้อยู่ในโควตาฟรีสบาย ๆ */
    { headers: { 'cache-control': 'public, max-age=20' } }
  );
};
