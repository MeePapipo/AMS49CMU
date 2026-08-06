/* ============================================================================
   รหัสผ่านแอดมิน และ session cookie
   ทั้งหมดใช้ WebCrypto ที่มีอยู่แล้วใน Workers ไม่มี dependency ภายนอก
   ========================================================================= */

const enc = new TextEncoder();

/* ---- base64url ----------------------------------------------------------- */
export function b64uEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64uDecode(str: string): Uint8Array {
  const s = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* เทียบแบบไม่หลุดเวลา — ป้องกันการเดาทีละไบต์จากเวลาที่ใช้ตอบ */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ---- รหัสผ่าน -------------------------------------------------------------
   รูปแบบที่เก็บ:  pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>
   จำนวนรอบอยู่ในสตริงเอง จึงเพิ่มได้ทีหลังโดยไม่ต้องแก้โค้ดและไม่ทำของเก่าใช้ไม่ได้

   ทำไมถึงไม่ใช้ 200,000+ รอบตามที่ OWASP แนะนำ:
   Workers แผนฟรีจำกัด CPU 10 มิลลิวินาทีต่อการเรียกหนึ่งครั้ง PBKDF2 สองแสนรอบ
   กินเกินนั้นแน่นอน แล้วหน้าล็อกอินจะพังบนของจริงทั้งที่ทำงานได้ตอน dev
   ทางออกคือ **บังคับให้รหัสผ่านเป็นค่าที่สุ่มมา ไม่ใช่คำที่คนคิดเอง** —
   scripts/hash-password.mjs สุ่มให้ 16 ตัวจากชุด 58 ตัวอักษร ≈ 94 บิต
   ต่อให้แฮชเร็วแค่ไหนก็เดาไม่ออกในช่วงอายุจักรวาล ประกอบกับจำกัด 5 ครั้ง/15 นาที
   ถ้าย้ายไปแผนเสียเงินเมื่อไร แค่สร้างแฮชใหม่ด้วยรอบสูงขึ้น ระบบอ่านได้ทันที */
export const DEFAULT_ITERATIONS = 25_000;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = DEFAULT_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${b64uEncode(salt)}$${b64uEncode(hash)}`;
}

/* ตรวจแค่ "รูปแบบ" ของแฮช ยังไม่ได้ตรวจรหัสผ่าน
   แยกออกมาเป็นฟังก์ชันของตัวเองเพราะแฮชที่พังจะทำให้ verifyPassword คืน false เงียบ ๆ
   แยกไม่ออกจากรหัสผ่านผิด — เคสจริงคือแฮชถูกก๊อปวางแล้วขาด `$` ไปท่อนหนึ่ง
   หรือถูกตัดท้ายตอนวางในช่อง secret แล้วกรรมการคนนั้นเข้าไม่ได้อยู่คนเดียว
   หน้าล็อกอินเรียกตัวนี้เพื่อเขียนสาเหตุจริงลงบันทึก โดยยังไม่บอกผู้ใช้ */
export function isHashFormatValid(stored: string): boolean {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 1000 || iterations > 1_000_000) return false;
  try {
    b64uDecode(parts[2]);
    return b64uDecode(parts[3]).length === 32;   // SHA-256 = 32 ไบต์ สั้นกว่านี้คือโดนตัดมา
  } catch {
    return false;
  }
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!isHashFormatValid(stored)) return false;
  const parts = stored.split('$');
  const actual = await pbkdf2(password, b64uDecode(parts[2]), parseInt(parts[1], 10));
  return timingSafeEqual(actual, b64uDecode(parts[3]));
}

/* ---- session cookie -------------------------------------------------------
   token = <payload b64url>.<HMAC-SHA256 b64url>
   payload มีวันหมดอายุอยู่ข้างใน และถูกเซ็นรวมไปด้วย จึงแก้เวลาเองไม่ได้
   ไม่ต้องมีตาราง session ใน D1 — เว็บนี้ไม่ต้องการ "เตะออกจากระบบทันที"
   ถ้าวันหนึ่งต้องการ ให้ใส่ค่า v (version) ใน payload แล้วเทียบกับค่าใน env */
export interface SessionPayload {
  u: string;      // ชื่อผู้ใช้แอดมิน
  n: string;      // ชื่อที่แสดง
  exp: number;    // epoch ms
  iat: number;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = b64uEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return `${body}.${b64uEncode(new Uint8Array(sig))}`;
}

export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  const dot = String(token || '').indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot), sig = token.slice(dot + 1);
  let sigBytes: Uint8Array;
  try { sigBytes = b64uDecode(sig); } catch { return null; }
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sigBytes, enc.encode(body));
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64uDecode(body))) as SessionPayload;
    if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

/* ---- cookie ---- */
export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export const SESSION_COOKIE = 'ams49_sess';

/* เพดานแข็งของอายุ session ตรวจที่เซิร์ฟเวอร์จาก exp ที่เซ็นไว้ใน token
   ต่อให้ cookie ถูกก๊อปไปหรือถูกเบราว์เซอร์กู้กลับมา ก็ใช้ได้ไม่เกินเวลานี้นับจากตอนล็อกอิน
   ลดจาก 8 ชั่วโมงเหลือ 3 เพราะรอบตรวจสลิปจริงใช้เวลาไม่กี่สิบนาที
   และหน้านี้เห็นชื่อ เบอร์ ที่อยู่ และสลิปของทุกคน */
export const SESSION_TTL_MS = 3 * 60 * 60 * 1000;

export function sessionCookieHeader(token: string, url: URL): string {
  /* **ตั้งใจไม่ใส่ Max-Age / Expires** — ทำให้เป็น session cookie ที่เบราว์เซอร์
     ลบทิ้งเองเมื่อปิดโปรแกรม ก่อนหน้านี้ใส่ Max-Age=8h ซึ่งเขียนลงดิสก์เป็น
     persistent cookie แล้วรอดข้ามการปิดเบราว์เซอร์ — กรรมการที่ลืมกดออกจากระบบ
     จึงเปิดเว็บมาใหม่แล้วเข้าหน้าแอดมินได้เลย

     ชั้นนี้ไม่ได้กันได้ 100%: Chrome/Edge ที่เปิด "เปิดต่อจากที่ค้างไว้" จะกู้
     session cookie กลับมาให้ และเบราว์เซอร์มือถือแทบไม่เคยถูกปิดจริง
     ตัวที่กันได้จริงคือ SESSION_TTL_MS ด้านบน กับตัวจับเวลาไม่ใช้งานใน page-admin.js

     Secure ปิดเฉพาะตอน dev บน http://localhost ไม่งั้นเบราว์เซอร์ทิ้ง cookie ทั้งอัน */
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}
