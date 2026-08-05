/* ============================================================================
   ตารางราคาและไซส์ — แหล่งความจริงเดียวของทั้งระบบ
   หน้าเว็บดึงตารางนี้ผ่าน GET /api/config แล้ววาดตารางเลือกจำนวนจากมัน
   ยอดเงินทุกบาทคำนวณด้วยฟังก์ชันในไฟล์นี้ที่ฝั่งเซิร์ฟเวอร์เท่านั้น
   เลขที่หน้าเว็บคำนวณเองมีไว้แสดงผลระหว่างกรอกเท่านั้น ไม่เคยถูกเชื่อ
   ========================================================================= */

/* ขึ้นเลขนี้ทุกครั้งที่แก้ราคา ไซส์ หรือส่วนเพิ่ม
   แถวเก่าใน D1 เก็บ price_version ของตัวเองไว้ ยอดที่เรียกเก็บไปแล้วจึงไม่เปลี่ยนตาม
   และหน้าแอดมินจะขึ้นธงเตือนถ้ายอดที่เก็บไว้ไม่ตรงกับที่คำนวณใหม่ได้ด้วยตารางปัจจุบัน */
export const PRICE_VERSION = 1;

export const SHIRT_PRICE = 500;   // ราคาฐานต่อตัว (SS–XL) รวมค่าจัดส่งแล้ว
export const SIZE_MAX = 99;       // เพดานต่อหนึ่งไซส์ — กันพิมพ์พลาด ไม่ใช่โควตา
export const BULK_HINT = 10;      // เกินนี้แค่เตือนให้กรรมการโทรยืนยัน ยังสั่งได้
export const SIZE_TOLERANCE_IN = 1;
export const MAX_DONATION = 2_000_000; // กันพิมพ์เกิน — ถ้ามีคนบริจาคเกินนี้จริงให้ติดต่อกรรมการ

export interface SizeSpec {
  s: string; chest: number; shoulder: number; len: number; extra: number;
}

/* extra = ส่วนเพิ่มต่อตัวจากราคาฐาน · ตัวเลขขนาดเป็นนิ้ววัดจากเสื้อวางราบ
   หมายเหตุ: ภาพ size-chart.jpg จากผู้ผลิตมีถึง 3XL เท่านั้น 4XL/5XL เพิ่มทีหลัง */
export const SIZES: SizeSpec[] = [
  { s: 'SS',  chest: 34, shoulder: 15,   len: 23.5, extra: 0 },
  { s: 'S',   chest: 37, shoulder: 16.5, len: 25.5, extra: 0 },
  { s: 'M',   chest: 40, shoulder: 17.5, len: 28,   extra: 0 },
  { s: 'L',   chest: 44, shoulder: 18.5, len: 29,   extra: 0 },
  { s: 'XL',  chest: 46, shoulder: 20,   len: 30,   extra: 0 },
  { s: '2XL', chest: 48, shoulder: 21,   len: 31,   extra: 20 },
  { s: '3XL', chest: 50, shoulder: 21.5, len: 32,   extra: 30 },
  { s: '4XL', chest: 52, shoulder: 22,   len: 33,   extra: 40 },
  { s: '5XL', chest: 54, shoulder: 22.5, len: 34,   extra: 50 }
];

export const SIZE_ORDER = SIZES.map((s) => s.s);

/* บัญชีปลายทาง — ถอดเป็นข้อความจากภาพสมุดบัญชี ไม่เผยแพร่ไฟล์ภาพ
   เพราะภาพต้นฉบับมีลายเซ็นผู้มีอำนาจและตราประทับธนาคารติดมาด้วย
   การสะกดชื่อยืนยันโดยผู้จัดงาน — "ชัชวาลชัยทรัพย์" ใช้ ช แม้ตัวอักษรในภาพจะดูเหมือน ซ
   อย่าแก้กลับโดยอ้างภาพสมุดบัญชีอย่างเดียว ต้องถามผู้จัดงานก่อน */
export const BANK = {
  bank: 'ธนาคารกรุงไทย (Krungthai)',
  branch: 'สาขาเซ็นทรัล เชียงใหม่ (รหัสสาขา 1326)',
  number: '666-1-17730-6',
  numberPlain: '6661177306',
  name: 'น.ส.ปิ่นปินันท์ ร่มโพธิ์ และ นายธเนศ ชัชวาลชัยทรัพย์',
  note: 'บัญชีร่วม 2 ชื่อ — ต้องขึ้นชื่อครบทั้งสองท่านจึงจะถูกบัญชี'
};

export function sizeInfo(code: string): SizeSpec | null {
  return SIZES.find((x) => x.s === code) || null;
}
export function priceForSize(code: string): number {
  return SHIRT_PRICE + (sizeInfo(code)?.extra || 0);
}
export function extraForSize(code: string): number {
  return sizeInfo(code)?.extra || 0;
}

export function countsToSizes(counts: Record<string, number>): string[] {
  const out: string[] = [];
  for (const code of SIZE_ORDER) {
    const n = Number(counts?.[code]) || 0;
    for (let i = 0; i < n; i++) out.push(code);
  }
  return out;
}

export function sizesToCounts(sizes: string[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const s of sizes || []) if (s) c[s] = (c[s] || 0) + 1;
  return c;
}

/* 'M×2, L×1' — เรียงไซส์เล็กไปใหญ่เสมอ ไม่ใช่ตามลำดับที่ผู้ใช้กด */
export function sizeSummary(sizes: string[]): string {
  const c = sizesToCounts(sizes);
  return SIZE_ORDER.filter((k) => c[k]).map((k) => `${k}×${c[k]}`).join(', ');
}

export interface Quote {
  counts: Record<string, number>;
  sizes: string[];
  qty: number;
  shirtAmount: number;
  surcharge: number;
  donation: number;
  total: number;
  priceVersion: number;
}

export class QuoteError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

/* คิดยอดจากสิ่งที่ผู้ใช้เลือก — ตัวนี้คือ "ยอดจริง" ที่ระบบยอมรับ
   ค่าเสื้อบวกรายตัวผ่าน priceForSize() ห้ามคิดเป็น qty × 500 เพราะ 2XL ขึ้นไปมีส่วนเพิ่ม */
export function computeQuote(rawCounts: unknown, rawDonation: unknown): Quote {
  const counts: Record<string, number> = {};
  let qty = 0, shirtAmount = 0, surcharge = 0;

  if (rawCounts != null && typeof rawCounts === 'object' && !Array.isArray(rawCounts)) {
    for (const [code, v] of Object.entries(rawCounts as Record<string, unknown>)) {
      if (!SIZE_ORDER.includes(code)) throw new QuoteError('bad_size', `ไม่รู้จักไซส์ ${code}`);
      const n = Math.floor(Number(v));
      if (!Number.isFinite(n) || n < 0) throw new QuoteError('bad_qty', `จำนวนของไซส์ ${code} ไม่ถูกต้อง`);
      if (n > SIZE_MAX) throw new QuoteError('bad_qty', `ไซส์ ${code} สั่งได้ไม่เกิน ${SIZE_MAX} ตัวต่อรายการ`);
      if (n === 0) continue;
      counts[code] = n;
      qty += n;
      shirtAmount += n * priceForSize(code);
      surcharge += n * extraForSize(code);
    }
  }

  const donation = Math.floor(Number(rawDonation) || 0);
  if (!Number.isFinite(donation) || donation < 0) {
    throw new QuoteError('bad_donation', 'ยอดบริจาคต้องเป็นจำนวนเต็มไม่ติดลบ');
  }
  if (donation > MAX_DONATION) {
    throw new QuoteError('bad_donation',
      `ยอดบริจาคเกิน ${MAX_DONATION.toLocaleString('en-US')} บาท กรุณาติดต่อกรรมการรุ่นโดยตรง`);
  }

  return {
    counts,
    sizes: countsToSizes(counts),
    qty,
    shirtAmount,
    surcharge,
    donation,
    total: donation + shirtAmount,
    priceVersion: PRICE_VERSION
  };
}

/* คิดยอดใหม่จากแถวที่เก็บไว้ ใช้เทียบกับ total ที่บันทึกไว้เพื่อจับ price drift */
export function recomputeFromSizes(sizes: string[], donation: number) {
  let shirtAmount = 0, surcharge = 0;
  for (const s of sizes || []) {
    shirtAmount += priceForSize(s);
    surcharge += extraForSize(s);
  }
  return { shirtAmount, surcharge, total: (Number(donation) || 0) + shirtAmount };
}
