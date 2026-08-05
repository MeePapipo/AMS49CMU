/* ตัวช่วยตอบกลับ + ตัวช่วยอ่าน request — รวมไว้ที่เดียวให้ทุก endpoint ตอบหน้าตาเหมือนกัน */

export interface Env {
  DB: D1Database;
  /* ที่เก็บไฟล์สลิป — เป็น KV ไม่ใช่ R2 เพราะการเปิด R2 ต้องผูกบัตร (ดู wrangler.toml)
     ชนิดไฟล์และขนาดเก็บไว้ใน D1 (slip_type / slip_size) ไม่ได้พึ่ง metadata ของ KV */
  SLIPS: KVNamespace;
  SESSION_SECRET?: string;
  ADMIN_USERS?: string;
  TURNSTILE_ENABLED?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_EMAILS?: string;
  GOAL_AMOUNT?: string;
  EVENT_DATE?: string;
}

const NO_STORE = 'no-store, no-cache, must-revalidate';

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) headers.set('cache-control', NO_STORE);
  return new Response(JSON.stringify(data), { ...init, headers });
}

/* ข้อความ error ทุกอันเป็นภาษาไทย เพราะมันไปโผล่บนหน้าเว็บให้ผู้ใช้อ่านตรง ๆ
   code เอาไว้ให้ฝั่งหน้าเว็บแยกกรณีได้โดยไม่ต้องเทียบข้อความ */
export function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return json({ ok: false, code, message, ...extra }, { status });
}

export const badRequest = (m: string, code = 'bad_request') => fail(400, code, m);
export const unauthorized = (m = 'ต้องเข้าสู่ระบบก่อน') => fail(401, 'unauthorized', m);
export const notFound = (m = 'ไม่พบรายการนี้') => fail(404, 'not_found', m);
export const tooMany = (m: string, retryAfter: number) =>
  fail(429, 'rate_limited', m, { retryAfter });

/* ---- เวลา ----------------------------------------------------------------
   ทั้งระบบเก็บเวลาเป็นสตริง 'YYYY-MM-DDTHH:MM' ตามเวลาไทย (UTC+7) แบบเดียวกับ
   ค่าที่ <input type="datetime-local"> ให้มา ไม่มี timezone suffix
   Worker รันที่ UTC เสมอ จึงต้องบวก 7 ชั่วโมงเอง ห้ามพึ่ง toLocaleString ของ runtime */
const TH_OFFSET_MS = 7 * 60 * 60 * 1000;

export function thNow(): string {
  return new Date(Date.now() + TH_OFFSET_MS).toISOString().slice(0, 16);
}
export function thNowFull(): string {
  return new Date(Date.now() + TH_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}

/* ---- ผู้เรียก ------------------------------------------------------------ */
export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '0.0.0.0';
}

export async function sha256hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* hash ของ IP ไม่ใช่ IP ตรง ๆ — พอใช้จับคนยิงซ้ำได้ แต่ไม่ได้เก็บข้อมูลระบุตัวตนไว้เฉย ๆ
   ผูกกับ SESSION_SECRET เพื่อไม่ให้ใครที่ได้ฐานข้อมูลไปไล่ rainbow table หา IP กลับได้ */
export async function ipHash(req: Request, env: Env): Promise<string> {
  return (await sha256hex(clientIp(req) + '|' + (env.SESSION_SECRET || 'dev'))).slice(0, 32);
}
