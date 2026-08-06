/* ============================================================================
   ใครมีสิทธิ์เข้าหลังบ้าน

   สองชั้น ตั้งค่าได้ว่าจะใช้ชั้นไหน:

   1. Cloudflare Access (ถ้าตั้ง ACCESS_TEAM_DOMAIN + ACCESS_AUD ใน wrangler.toml)
      กรรมการล็อกอินด้วย Google ของตัวเอง Cloudflare ปิดประตูให้ตั้งแต่ขอบเครือข่าย
      แล้วส่ง JWT มากับ header Cf-Access-Jwt-Assertion — เราตรวจลายเซ็นซ้ำที่นี่
      **ต้องตรวจซ้ำเสมอ** เพราะถ้าใครหา URL ของ Pages deployment ตัวอื่นเจอ
      (เช่น <hash>.ams49-reunion.pages.dev) เขาจะเลี่ยง Access ที่ผูกกับโดเมนหลักได้
      เปิดโหมดนี้เมื่อไร รหัสผ่านจะใช้ไม่ได้อีก — Access กลายเป็นทางเข้าเดียว

   2. รหัสผ่านฝั่งเซิร์ฟเวอร์ (ค่าเริ่มต้น ใช้ได้ทันทีไม่ต้องตั้ง Zero Trust)
      ตรวจกับ PBKDF2 ที่เก็บใน secret ADMIN_USERS แล้วออก session cookie ที่เซ็นด้วย HMAC

   ทั้งสองชั้นเกิดที่เซิร์ฟเวอร์ ไม่ใช่ที่เบราว์เซอร์ — ต่างจากต้นแบบเดิมที่เทียบรหัส
   ด้วย JavaScript ในหน้าเว็บ ซึ่งใครกด Ctrl+U ก็อ่านรหัสได้
   ========================================================================= */

import { Env } from './http';
import { SESSION_COOKIE, readCookie, verifySession, b64uDecode } from './crypto';

export interface AdminIdentity {
  actor: string;              // ชื่อผู้ใช้ หรืออีเมลจาก Access — ลงใน audit
  name: string;
  via: 'password' | 'access';
}

export interface AdminUser { u: string; name?: string; hash: string; }

export function accessEnabled(env: Env): boolean {
  return !!(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
}

export function parseAdminUsers(env: Env): AdminUser[] {
  try {
    const list = JSON.parse(env.ADMIN_USERS || '[]');
    return Array.isArray(list) ? list.filter((x) => x && x.u && x.hash) : [];
  } catch {
    return [];
  }
}

/* อักขระที่มองไม่เห็นแต่ติดมากับการก๊อปวางจากไลน์ Word หรือ PDF
   soft hyphen, zero-width ทั้งตระกูล, ตัวสั่งทิศทางข้อความ, BOM */
const INVISIBLE = /[\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060\uFEFF]/g;

/* เทียบชื่อผู้ใช้ตาม "สิ่งที่คนตั้งใจพิมพ์" ไม่ใช่ตามไบต์

   เดิมเทียบด้วย === ตรง ๆ ซึ่งแปลว่า `Jib` `jib ` และ `jib` เป็นคนละคน
   ค่าที่ผู้ใช้พิมพ์เข้ามาถูก trim แล้ว แต่ค่าที่อยู่ใน secret ไม่เคยถูก trim
   ช่องว่างท้ายชื่อที่ติดมาตอนวาง JSON จึงทำให้คนนั้นล็อกอินไม่ได้ตลอดกาล
   โดยไม่มีอะไรบอกสาเหตุ เพราะข้อความที่ตอบกลับเหมือนรหัสผ่านผิดทุกประการ

   ชื่อผู้ใช้ที่นี่เป็นชื่อเล่นภาษาอังกฤษของกรรมการไม่กี่คน การไม่แยกตัวพิมพ์
   ไม่ได้ลดความปลอดภัยลงเลย เพราะความปลอดภัยอยู่ที่รหัสผ่านสุ่ม 94 บิต */
export function normUser(s: string): string {
  return String(s || '').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/* ---- Cloudflare Access JWT ------------------------------------------------ */

interface Jwks { keys: JsonWebKey[] & { kid?: string }[] }
let jwksCache: { at: number; domain: string; jwks: Jwks } | null = null;

async function getJwks(teamDomain: string): Promise<Jwks> {
  const fresh = jwksCache && jwksCache.domain === teamDomain && Date.now() - jwksCache.at < 60 * 60 * 1000;
  if (fresh) return jwksCache!.jwks;
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const res = await fetch(url, { cf: { cacheTtl: 3600 } as RequestInitCfProperties });
  if (!res.ok) throw new Error(`access_certs_${res.status}`);
  const jwks = (await res.json()) as Jwks;
  jwksCache = { at: Date.now(), domain: teamDomain, jwks };
  return jwks;
}

export async function verifyAccessJwt(token: string, env: Env): Promise<{ email: string } | null> {
  const teamDomain = (env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!teamDomain || !env.ACCESS_AUD) return null;

  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;

  let header: { kid?: string; alg?: string };
  let claims: { aud?: string | string[]; email?: string; exp?: number; iss?: string; nbf?: number };
  try {
    header = JSON.parse(new TextDecoder().decode(b64uDecode(h)));
    claims = JSON.parse(new TextDecoder().decode(b64uDecode(p)));
  } catch { return null; }

  if (header.alg !== 'RS256') return null;

  const jwks = await getJwks(teamDomain);
  const jwk = (jwks.keys || []).find((k) => (k as { kid?: string }).kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    'jwk', jwk as JsonWebKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64uDecode(s), new TextEncoder().encode(`${h}.${p}`)
  );
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp < now) return null;
  if (typeof claims.nbf === 'number' && claims.nbf > now + 60) return null;
  if (claims.iss !== `https://${teamDomain}`) return null;

  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(env.ACCESS_AUD)) return null;

  const email = String(claims.email || '').toLowerCase();
  if (!email) return null;

  /* allow-list เพิ่มอีกชั้น — เผื่อ policy ใน Zero Trust ถูกแก้พลาดให้กว้างเกินไป */
  const allowed = (env.ACCESS_EMAILS || '')
    .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(email)) return null;

  return { email };
}

/* ---- ตัวตัดสินหลัก -------------------------------------------------------- */
export async function resolveAdmin(request: Request, env: Env): Promise<AdminIdentity | null> {
  if (accessEnabled(env)) {
    const token = request.headers.get('cf-access-jwt-assertion');
    if (!token) return null;
    const id = await verifyAccessJwt(token, env);
    if (!id) return null;
    return { actor: id.email, name: id.email.split('@')[0], via: 'access' };
  }

  if (!env.SESSION_SECRET) return null;  // ไม่ตั้งความลับ = ปิดประตูไว้ ดีกว่าเปิดโดยไม่ตั้งใจ
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const payload = await verifySession(token, env.SESSION_SECRET);
  if (!payload) return null;

  /* ผู้ใช้ที่ถูกถอดออกจาก ADMIN_USERS แล้ว ต้องใช้ cookie เก่าต่อไม่ได้
     เทียบด้วย normUser ให้ตรงกับตอนล็อกอิน ไม่งั้นถ้ามีใครแก้ตัวพิมพ์ในชื่อที่ secret
     คนที่ล็อกอินค้างอยู่จะโดนเตะออกกลางคันโดยไม่มีเหตุผลที่อธิบายได้ */
  const users = parseAdminUsers(env);
  if (!users.some((u) => normUser(u.u) === normUser(payload.u))) return null;

  return { actor: payload.u, name: payload.n || payload.u, via: 'password' };
}
