/* GET /api/admin/orders?filter=pending&q=...
   รายการทั้งหมดพร้อมข้อมูลผู้บริจาค + ตัวเลขสรุปที่หน้าหลังบ้านต้องใช้

   ตัวกรอง "shipping" = ยืนยันยอดแล้ว + มีเสื้อ + มีที่อยู่ + ยังไม่ได้ส่ง
   ใช้ทำใบปะหน้าพัสดุ จึงต้องตัดรายการที่ส่งไปแล้ว (ที่อยู่ถูกลบทิ้งตาม PDPA) ออก */

import { Env, json } from '../../lib/http';
import { toAdminView, parseSizes, OrderRow } from '../../lib/shape';
import { SIZE_ORDER } from '../../lib/pricing';
import { AdminData } from './_middleware';

export const onRequestGet: PagesFunction<Env, string, AdminData> = async ({ request, env }) => {
  const url = new URL(request.url);
  const filter = url.searchParams.get('filter') || 'pending';
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60);

  const where: string[] = [];
  const bind: unknown[] = [];

  if (filter === 'shipping') {
    where.push(`status = 'verified' AND shirt_qty > 0 AND addr_line <> '' AND shipped_at IS NULL`);
  } else if (filter === 'shipped') {
    where.push('shipped_at IS NOT NULL');
  } else if (filter !== 'all') {
    where.push('status = ?');
    bind.push(filter);
  }

  if (q) {
    /* หนีอักขระ wildcard ของ LIKE ก่อน — ไม่งั้นค้นด้วย % เดียวจะได้ทุกแถวออกมา */
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(
      `(ref LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'` +
      ` OR phone LIKE ? ESCAPE '\\' OR student_id LIKE ? ESCAPE '\\')`
    );
    bind.push(like, like, like, like);
  }

  const sql =
    `SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,
               transfer_at DESC, created_at DESC
      LIMIT 1000`;

  const rows = await env.DB.prepare(sql).bind(...bind).all<OrderRow>();

  /* ตัวเลขสรุปคิดจากทั้งฐานเสมอ ไม่ใช่จากผลที่กรองไว้ — ไม่งั้นสลับตัวกรองแล้วยอดเปลี่ยน */
  const allRows = await env.DB
    .prepare(`SELECT status, donation, shirt_amount, shirt_qty, total, sizes, addr_line, shipped_at
                FROM orders`)
    .all<OrderRow>();

  let donation = 0, shirtRevenue = 0, shirts = 0, verifiedCount = 0;
  let pending = 0, pendingCount = 0, rejectedCount = 0;
  let shirtsAll = 0, noAddress = 0, toShip = 0;
  const bySize: Record<string, number> = {};

  for (const r of allRows.results || []) {
    if (r.status === 'verified') {
      donation += r.donation; shirtRevenue += r.shirt_amount; shirts += r.shirt_qty; verifiedCount++;
      if (r.shirt_qty > 0 && !r.addr_line && !r.shipped_at) noAddress++;
      if (r.shirt_qty > 0 && r.addr_line && !r.shipped_at) toShip++;
    } else if (r.status === 'pending') {
      pending += r.total; pendingCount++;
      if (r.shirt_qty > 0 && !r.addr_line) noAddress++;
    } else if (r.status === 'rejected') {
      rejectedCount++;
    }
    /* นับไซส์เพื่อสั่งผลิต — รวมรายการที่ยังรอตรวจด้วย เพราะโรงงานต้องรู้ยอด
       ก่อนเงินเคลียร์ แต่ไม่รวมที่ตีกลับ */
    if (r.status !== 'rejected') {
      shirtsAll += r.shirt_qty;
      for (const s of parseSizes(r.sizes)) bySize[s] = (bySize[s] || 0) + 1;
    }
  }

  return json({
    ok: true,
    filter,
    orders: (rows.results || []).map(toAdminView),
    stats: {
      donation, shirtRevenue, verified: donation + shirtRevenue,
      shirts, shirtsAll, noAddress, toShip,
      pending, verifiedCount, pendingCount, rejectedCount,
      bySize, sizeOrder: SIZE_ORDER,
      goal: Number(env.GOAL_AMOUNT || 500000)
    }
  });
};
