/* บันทึกว่าใครทำอะไรกับรายการไหน — หน้าหลังบ้านเห็นชื่อ เบอร์ ที่อยู่ และสลิปของทุกคน
   และกรรมการหลายคนใช้ระบบเดียวกัน ถ้าไม่มีบันทึกนี้ก็ตอบไม่ได้ว่าใครกดตีกลับ */
import { thNowFull } from './http';

export async function log(
  db: D1Database, actor: string, action: string, ref: string | null = null, detail = ''
): Promise<void> {
  try {
    await db
      .prepare('INSERT INTO audit (at, actor, action, ref, detail) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(thNowFull(), actor, action, ref, detail)
      .run();
  } catch {
    /* บันทึกไม่ได้ต้องไม่ทำให้การทำงานหลักล้ม — แต่ก็ไม่กลืนเงียบทั้งหมด */
    console.error('audit write failed', { actor, action, ref });
  }
}
