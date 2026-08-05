/* GET /api/admin/export?filter=...&q=...  → CSV

   คอลัมน์ครบพอที่จะทำใบปะหน้าพัสดุและงบดุลได้จากไฟล์เดียว ไม่ต้องกลับมาเปิดเว็บ

   กัน CSV formula injection:
   ต้นแบบครอบแค่เครื่องหมายคำพูด ซึ่งพอสำหรับให้ไฟล์ไม่พัง แต่ไม่พอสำหรับความปลอดภัย —
   ช่องที่ผู้ใช้พิมพ์เอง (ชื่อ ที่อยู่ LINE ID) ถ้าขึ้นต้นด้วย = + - @ Excel จะตีความ
   เป็นสูตรแล้วรันทันทีที่เปิดไฟล์ และคนที่เปิดไฟล์นี้คือกรรมการที่เห็นข้อมูลของทุกคน
   วิธีแก้คือใส่ ' นำหน้า ทำให้ Excel มองเป็นข้อความเสมอ */

import { Env, thNow } from '../../lib/http';
import { parseSizes, composeAddress, OrderRow } from '../../lib/shape';
import { sizeSummary, recomputeFromSizes } from '../../lib/pricing';
import { log } from '../../lib/audit';
import { AdminData } from './_middleware';

const HEAD = [
  'ref', 'status', 'transferAt', 'submittedAt', 'verifiedAt', 'shippedAt',
  'donation', 'shirtAmount', 'shirtSurcharge', 'total', 'priceVersion', 'recomputedTotal', 'priceDrift',
  'shirtQty', 'sizes',
  'name', 'studentId', 'phone', 'email', 'lineId',
  'recipient', 'recipientPhone', 'addrLine', 'province', 'zip', 'address', 'shipNote',
  'slipName', 'note'
];

const DANGEROUS = /^[=+\-@\t\r]/;

function cell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (DANGEROUS.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export const onRequestGet: PagesFunction<Env, string, AdminData> = async ({ request, env, data }) => {
  const url = new URL(request.url);
  const filter = url.searchParams.get('filter') || 'all';

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

  const rows = await env.DB
    .prepare(
      `SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY transfer_at DESC, created_at DESC`
    )
    .bind(...bind)
    .all<OrderRow>();

  const list = rows.results || [];
  const lines = [HEAD.join(',')];

  for (const r of list) {
    const sizes = parseSizes(r.sizes);
    const again = recomputeFromSizes(sizes, r.donation);
    const rec: Record<string, unknown> = {
      ref: r.ref, status: r.status,
      transferAt: r.transfer_at, submittedAt: r.submitted_at,
      verifiedAt: r.verified_at, shippedAt: r.shipped_at,
      donation: r.donation, shirtAmount: r.shirt_amount, shirtSurcharge: r.surcharge,
      total: r.total, priceVersion: r.price_version,
      recomputedTotal: again.total, priceDrift: again.total === r.total ? '' : 'YES',
      shirtQty: r.shirt_qty, sizes: sizeSummary(sizes),
      name: r.name, studentId: r.student_id, phone: r.phone, email: r.email, lineId: r.line_id,
      recipient: r.recipient, recipientPhone: r.recipient_phone,
      addrLine: r.addr_line, province: r.province, zip: r.zip,
      address: composeAddress(r.addr_line, r.province, r.zip),
      shipNote: r.ship_note,
      slipName: r.slip_name, note: r.note
    };
    lines.push(HEAD.map((k) => cell(rec[k])).join(','));
  }

  await log(env.DB, data.admin.actor, 'export', null, `${filter} · ${list.length} รายการ`);

  /* BOM นำหน้า ไม่งั้น Excel บน Windows อ่านภาษาไทยเป็นตัวยึกยือ */
  const body = '﻿' + lines.join('\r\n') + '\r\n';
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="ams49-${filter}-${thNow().slice(0, 10)}.csv"`,
      'cache-control': 'no-store'
    }
  });
};
