/* ============================================================================
   รหัสอ้างอิง — กุญแจดอกเดียวที่เปิดดูรายการของตัวเองได้

   ต้นแบบใช้ 4 ตัว = 1,048,576 ค่า ซึ่งพอตอนข้อมูลอยู่ใน localStorage เพราะไม่มี
   API ให้ยิง แต่พอมี GET /api/status/:ref ของจริง สคริปต์ตัวเดียวไล่ครบทั้งชุดได้
   ในไม่กี่ชั่วโมงแล้วดูดยอด ไซส์ จังหวัดและไปรษณีย์ของทุกคนออกไป ซึ่งทำลาย
   หลักการของเว็บนี้ตรง ๆ (โปร่งใสได้เพราะไม่มีใครสืบย้อนว่าเงินก้อนไหนของใคร)

   6 ตัว = 1,073,741,824 ค่า ประกอบกับจำกัด 20 ครั้ง/นาที/IP = ยิงไม่ไหว
   ชุดตัวอักษรตัด I O 0 1 ออกเหมือนเดิม เพราะคนต้องอ่านจากหน้าจอแล้วพิมพ์ต่อ
   ========================================================================= */

export const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 ตัว
export const REF_LENGTH = 6;
export const REF_PATTERN = /^AMS49-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

/* ชุดมี 32 ตัวพอดี 256 หารลงตัว การ mod จึงไม่เอนเอียง ไม่ต้อง reject sampling */
export function randomRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(REF_LENGTH));
  let s = '';
  for (const b of bytes) s += REF_ALPHABET[b & 31];
  return `AMS49-${s}`;
}

/* สุ่มจนกว่าจะได้ตัวที่ยังไม่มีในฐาน — โอกาสชนแทบเป็นศูนย์ แต่ถ้าชนแล้วไม่ตรวจ
   INSERT จะระเบิดที่ PRIMARY KEY แล้วผู้ใช้ที่โอนเงินไปแล้วจะเจอ error หน้าสุดท้าย */
export async function allocateRef(db: D1Database, tries = 6): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const ref = randomRef();
    const hit = await db.prepare('SELECT 1 FROM orders WHERE ref = ?1').bind(ref).first();
    if (!hit) return ref;
  }
  throw new Error('allocate_ref_failed');
}

/* ทำความสะอาดสิ่งที่ผู้ใช้พิมพ์ — ตัดช่องว่าง ทำเป็นตัวใหญ่ เติมคำนำหน้าให้ถ้าลืม
   **ตั้งใจไม่เดาตัวอักษรที่พิมพ์ผิดให้** เช่นเห็น O แล้วดัดเป็น Q
   เพราะการเดาผิดหนึ่งตัวหมายถึงเปิดรายการของ "คนอื่น" ให้ดู ซึ่งแย่กว่าการบอกว่าไม่เจอ
   ตัวที่ไม่มีในชุดจะถูกจับได้ที่ describeRefProblem() แล้วบอกผู้ใช้ตรง ๆ ว่าผิดตรงไหน */
export function normalizeRef(input: string): string {
  let s = String(input || '').trim().toUpperCase().replace(/[\s​]+/g, '');
  if (!s.startsWith('AMS49-')) {
    if (s.startsWith('AMS49')) s = `AMS49-${s.slice(5)}`;
    else if (/^[A-Z0-9]{6}$/.test(s)) s = `AMS49-${s}`;
  }
  return s;
}

/* คืนข้อความอธิบายว่าทำไมรหัสนี้ผิดรูป หรือ null ถ้ารูปแบบถูกต้อง
   แยกตัวอักษรต้องห้ามออกมาบอกชัด ๆ เพราะเป็นสาเหตุที่พบบ่อยที่สุด */
export function describeRefProblem(ref: string): string | null {
  if (!ref) return 'กรอกรหัสอ้างอิงก่อน';
  if (REF_PATTERN.test(ref)) return null;
  if (!ref.startsWith('AMS49-')) return 'รหัสต้องขึ้นต้นด้วย AMS49-';
  const tail = ref.slice(6);
  const forbidden = [...new Set(tail.split('').filter((c) => 'IO01'.includes(c)))];
  if (forbidden.length) {
    /* บอกตัวที่น่าจะใช่ให้ แต่ไม่ดัดให้เอง — เดาผิดหนึ่งตัวคือเปิดรายการของคนอื่นให้ดู */
    const hints = [...new Set(forbidden.map((c) => (c === 'I' || c === '1' ? 'J หรือ L' : 'Q หรือ D')))];
    return `รหัสอ้างอิงไม่มีตัว ${forbidden.join(' ')} เลย — ลองดูอีกครั้งว่าเป็น ${hints.join(' / ')} หรือเปล่า`;
  }
  if (tail.length !== REF_LENGTH) return `หลัง AMS49- ต้องมี ${REF_LENGTH} ตัว (ตอนนี้มี ${tail.length} ตัว)`;
  return 'รูปแบบรหัสไม่ถูกต้อง';
}
