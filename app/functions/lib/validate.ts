/* ============================================================================
   ตรวจข้อมูลฝั่งเซิร์ฟเวอร์
   กติกาชุดเดียวกับที่หน้าเว็บใช้ แต่ต้องมีที่นี่ด้วย เพราะกติกาฝั่งหน้าเว็บ
   เป็นแค่ความสะดวก ใครยิง API ตรง ๆ ก็ข้ามได้หมด
   เพิ่มเพดานความยาวทุกช่อง — ต้นแบบไม่มี ใครยัดข้อความ 5 MB ลงช่องชื่อก็เข้าฐานได้
   ========================================================================= */

export interface FieldError { field: string; message: string; }

export const LIMITS = {
  name: 120, studentId: 10, phone: 10, email: 160, lineId: 60,
  recipient: 120, addrLine: 300, province: 60, zip: 5, shipNote: 200,
  note: 300
};

export function digits(v: unknown): string {
  return String(v ?? '').replace(/[^0-9]/g, '');
}

/* ตัดอักขระควบคุมทิ้ง เหลือไว้แค่ tab / ขึ้นบรรทัดใหม่ (ที่อยู่เป็น textarea)
   แล้วค่อยตัดความยาว — กันทั้งข้อความยาวเกินและอักขระที่ไปเพี้ยนตอนพิมพ์ใบปะหน้าพัสดุ */
export function text(v: unknown, max: number): string {
  return String(v ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, max);
}

const RE_PHONE = /^0\d{8,9}$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export interface DonorInput {
  name: string; studentId: string; phone: string; email: string; lineId: string;
  recipient: string; recipientPhone: string;
  addrLine: string; province: string; zip: string; shipNote: string;
  transferAt: string; consent: boolean;
}

export function readDonor(form: FormData): DonorInput {
  return {
    name: text(form.get('name'), LIMITS.name),
    studentId: digits(form.get('studentId')).slice(0, LIMITS.studentId),
    phone: digits(form.get('phone')).slice(0, LIMITS.phone),
    email: text(form.get('email'), LIMITS.email),
    lineId: text(form.get('lineId'), LIMITS.lineId),
    recipient: text(form.get('recipient'), LIMITS.recipient),
    recipientPhone: digits(form.get('recipientPhone')).slice(0, LIMITS.phone),
    addrLine: text(form.get('addrLine'), LIMITS.addrLine),
    province: text(form.get('province'), LIMITS.province),
    zip: digits(form.get('zip')).slice(0, LIMITS.zip),
    shipNote: text(form.get('shipNote'), LIMITS.shipNote),
    transferAt: text(form.get('transferAt'), 16),
    consent: String(form.get('consent') ?? '') === 'true'
  };
}

export function validateDonor(d: DonorInput, needsShipping: boolean): FieldError[] {
  const errs: FieldError[] = [];
  const bad = (field: string, message: string) => errs.push({ field, message });

  if (d.name.length < 3) bad('name', 'กรอกชื่อ–นามสกุลให้ครบ');
  if (!RE_PHONE.test(d.phone)) bad('phone', 'เบอร์โทร 9–10 หลัก ขึ้นต้นด้วย 0');
  if (d.studentId && !/^\d{8,10}$/.test(d.studentId)) {
    bad('studentId', 'รหัสนักศึกษาเป็นตัวเลข 8–10 หลัก หรือเว้นว่างไว้');
  }
  if (d.email && !RE_EMAIL.test(d.email)) bad('email', 'รูปแบบอีเมลไม่ถูกต้อง หรือเว้นว่างไว้');

  if (needsShipping) {
    if (d.recipient.length < 3) bad('recipient', 'กรอกชื่อผู้รับ');
    if (!RE_PHONE.test(d.recipientPhone)) bad('recipientPhone', 'เบอร์ผู้รับ 9–10 หลัก ขึ้นต้นด้วย 0');
    if (d.addrLine.length < 10) bad('addrLine', 'ที่อยู่สั้นเกินไป ใส่ให้ครบถึงตำบล/แขวง');
    if (d.province.length < 2) bad('province', 'กรอกจังหวัด');
    if (!/^\d{5}$/.test(d.zip)) bad('zip', 'รหัสไปรษณีย์ต้องเป็นเลข 5 หลัก');
  }

  if (!d.consent) bad('consent', 'ต้องยินยอมให้เก็บข้อมูลก่อนจึงจะส่งได้');

  /* เวลาโอน — ต้องเป็นรูปแบบที่ <input type="datetime-local"> ให้มา และต้องสมเหตุสมผล
     ยอมล่วงหน้าได้ 1 ชั่วโมง เผื่อนาฬิกาเครื่องผู้ใช้เดินเร็ว และย้อนหลังได้ 1 ปี */
  if (!RE_DATETIME.test(d.transferAt)) {
    bad('transferAt', 'เลือกวันและเวลาที่โอนตามสลิป');
  } else {
    const t = Date.parse(`${d.transferAt}:00+07:00`);
    const now = Date.now();
    if (!Number.isFinite(t)) bad('transferAt', 'วันเวลาที่โอนไม่ถูกต้อง');
    else if (t > now + 60 * 60 * 1000) bad('transferAt', 'วันเวลาที่โอนอยู่ในอนาคต ตรวจอีกครั้งจากสลิป');
    else if (t < now - 365 * 24 * 60 * 60 * 1000) bad('transferAt', 'วันเวลาที่โอนเก่าเกินหนึ่งปี ตรวจอีกครั้งจากสลิป');
  }

  return errs;
}

/* ---- ไฟล์สลิป -------------------------------------------------------------
   ต้นแบบตรวจชนิดและขนาดที่เบราว์เซอร์อย่างเดียว ซึ่งข้ามได้ทั้งหมด
   ที่นี่ตรวจซ้ำ และ **ไม่เชื่อ file.type ที่ไคลเอนต์ส่งมา** — ดูไบต์แรกของไฟล์จริง
   ใครเปลี่ยนนามสกุล .exe เป็น .jpg แล้วส่งมา จะตกตรงนี้ */
export const MAX_SLIP_BYTES = 5 * 1024 * 1024;

export const SLIP_EXT = new Map<string, string>([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['application/pdf', 'pdf']
]);

export function sniffType(b: Uint8Array): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 &&
      b[4] === 0x2d) return 'application/pdf';
  return null;
}
