/* ============================================================================
   แปลงแถวใน D1 เป็นสิ่งที่แต่ละหน้าเห็นได้
   สามฟังก์ชันนี้คือจุดเดียวที่ตัดสินว่า "ข้อมูลไหนออกไปถึงใคร"
   ถ้าจะเพิ่มฟิลด์ใหม่ ต้องมาตัดสินใจที่นี่ว่าเปิดเผยได้แค่ไหน ไม่ใช่ส่งทั้งแถวไป
   ========================================================================= */

import { recomputeFromSizes, sizeSummary } from './pricing';

export interface OrderRow {
  ref: string; status: string;
  donation: number; shirt_amount: number; surcharge: number; total: number;
  price_version: number; shirt_qty: number; sizes: string;
  transfer_at: string | null; submitted_at: string; verified_at: string | null; note: string;
  name: string; student_id: string; phone: string; email: string; line_id: string;
  recipient: string; recipient_phone: string;
  addr_line: string; province: string; zip: string; ship_note: string;
  slip_key: string | null; slip_type: string | null; slip_size: number | null; slip_name: string | null;
  shipped_at: string | null; purged_at: string | null;
  ip_hash: string; user_agent: string; created_at: string;
}

export function parseSizes(raw: string | null): string[] {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

/* ประกอบที่อยู่เป็นบรรทัดเดียวสำหรับแสดงผลและใบปะหน้าพัสดุ
   ตั้งใจไม่รวม shipNote ("โทรก่อนส่ง") เพราะเป็นคำสั่งถึงคนส่ง ไม่ใช่ส่วนหนึ่งของที่อยู่
   ถ้าปนเข้าไปจะไปโผล่บนใบปะหน้าพัสดุด้วย */
export function composeAddress(line: string, province: string, zip: string): string {
  if (!line) return '';
  return [line, `จ.${province}`, zip].filter(Boolean).join(' ');
}

/* ---- หน้าสาธารณะ (index.html) --------------------------------------------
   ข้อตัดสินใจที่ห้ามเปลี่ยน: หน้าสาธารณะแสดงได้แค่ เวลา · รหัส · สถานะ · ยอด
   ชื่อ เบอร์ ที่อยู่ สลิป อยู่หลังหลังบ้านเท่านั้น */
export function toPublicLedger(r: OrderRow) {
  return {
    ref: r.ref,
    status: r.status,
    transferAt: r.transfer_at,
    donation: r.donation,
    shirtAmount: r.shirt_amount,
    shirtQty: r.shirt_qty,
    total: r.total,
    note: r.status === 'rejected' ? r.note : ''
  };
}

/* ---- หน้าเช็คสถานะ (status.html) ------------------------------------------
   เปิดได้ด้วยรหัสอ้างอิงอย่างเดียว ถ้ารหัสหลุดไปอยู่ในมือคนอื่น
   อย่างน้อยที่อยู่บ้าน ชื่อ และเบอร์ต้องไม่หลุดตามไปด้วย — จึงส่งแค่จังหวัด+ไปรษณีย์ */
export function toStatusView(r: OrderRow) {
  const sizes = parseSizes(r.sizes);
  return {
    ref: r.ref,
    status: r.status,
    donation: r.donation,
    shirtAmount: r.shirt_amount,
    surcharge: r.surcharge,
    shirtQty: r.shirt_qty,
    total: r.total,
    sizes,
    sizeText: sizeSummary(sizes),
    transferAt: r.transfer_at,
    submittedAt: r.submitted_at,
    verifiedAt: r.verified_at,
    note: r.status === 'rejected' ? r.note : '',
    province: r.province,
    zip: r.zip,
    shipped: !!r.shipped_at
  };
}

/* ---- หลังบ้าน -------------------------------------------------------------
   เห็นทุกอย่าง แต่ยังไม่ส่ง ip_hash / user_agent ออกไปที่หน้าเว็บโดยไม่จำเป็น
   priceDrift = ยอดที่เก็บไว้ไม่ตรงกับที่คำนวณใหม่ได้ด้วยตารางราคาปัจจุบัน
   ไม่ใช่ error — แปลว่าตารางราคาถูกแก้หลังจากรายการนี้เข้ามาแล้ว ต้องให้กรรมการเห็น */
export function toAdminView(r: OrderRow) {
  const sizes = parseSizes(r.sizes);
  const again = recomputeFromSizes(sizes, r.donation);
  return {
    ref: r.ref,
    status: r.status,
    donation: r.donation,
    shirtAmount: r.shirt_amount,
    surcharge: r.surcharge,
    total: r.total,
    priceVersion: r.price_version,
    priceDrift: again.total !== r.total ? { recomputedTotal: again.total } : null,
    shirtQty: r.shirt_qty,
    sizes,
    sizeText: sizeSummary(sizes),
    transferAt: r.transfer_at,
    submittedAt: r.submitted_at,
    verifiedAt: r.verified_at,
    note: r.note,
    name: r.name,
    studentId: r.student_id,
    phone: r.phone,
    email: r.email,
    lineId: r.line_id,
    recipient: r.recipient,
    recipientPhone: r.recipient_phone,
    addrLine: r.addr_line,
    province: r.province,
    zip: r.zip,
    shipNote: r.ship_note,
    address: composeAddress(r.addr_line, r.province, r.zip),
    hasSlip: !!r.slip_key,
    slipName: r.slip_name || '',
    slipType: r.slip_type || '',
    slipSize: r.slip_size || 0,
    shippedAt: r.shipped_at,
    purgedAt: r.purged_at,
    createdAt: r.created_at
  };
}
