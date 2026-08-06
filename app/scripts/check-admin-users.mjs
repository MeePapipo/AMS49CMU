#!/usr/bin/env node
/* ============================================================================
   ตรวจ JSON ของ ADMIN_USERS ก่อนเอาขึ้น production

   ใช้:
     node scripts/check-admin-users.mjs admin-users.json
     node scripts/check-admin-users.mjs admin-users.json jib 'รหัสผ่าน'   ← ลองรหัสจริง
     pbpaste | node scripts/check-admin-users.mjs -                       ← อ่านจาก stdin

   ทำไมต้องมี:
   Cloudflare secret อ่านกลับไม่ได้ พอวางผิดแล้วไม่มีใครรู้จนกว่าจะมีคนเข้าไม่ได้
   และหน้าล็อกอินตอบข้อความเดียวกันหมดไม่ว่าจะพลาดตรงไหน (ตั้งใจ — ดู login.ts)
   ที่แย่ที่สุดคือ functions/lib/auth.ts จะ **กรอง entry ที่ขาดคีย์ u หรือ hash ทิ้งเงียบ ๆ**
   พิมพ์คีย์ผิดคนเดียว คนนั้นหายไปคนเดียว อีกสองคนยังใช้ได้ตามปกติ จับได้ยากมาก
   สคริปต์นี้เลยตรวจให้ครบทุกจุดที่เคยพัง ก่อนที่จะไป secret put

   ตรรกะต้องตรงกับ functions/lib/crypto.ts (isHashFormatValid) และ
   functions/lib/auth.ts (normUser) — แก้ที่นั่นแล้วอย่าลืมแก้ที่นี่ด้วย
   ========================================================================= */

import { readFileSync } from 'node:fs';
import { pbkdf2Sync, timingSafeEqual } from 'node:crypto';

const RESET = '\x1b[0m', RED = '\x1b[31m', YEL = '\x1b[33m', GRN = '\x1b[32m', DIM = '\x1b[2m';
const bad = (s) => `${RED}✗ ${s}${RESET}`;
const warn = (s) => `${YEL}▲ ${s}${RESET}`;
const good = (s) => `${GRN}✓ ${s}${RESET}`;

const INVISIBLE = /[\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060\uFEFF]/g;
const normUser = (s) =>
  String(s || '').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().toLowerCase();

const b64uDecode = (str) =>
  Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/* โชว์ไบต์ของตัวที่มองไม่เห็น เพื่อให้เห็นว่ามีอะไรแอบอยู่ในชื่อ */
function reveal(s) {
  return [...String(s)]
    .map((ch) => {
      const cp = ch.codePointAt(0);
      if (cp < 0x20 || cp === 0x7f) return `${DIM}\\x${cp.toString(16).padStart(2, '0')}${RESET}`;
      if (cp > 0x7e) return `${YEL}\\u${cp.toString(16).padStart(4, '0')}${RESET}`;
      return ch;
    })
    .join('');
}

/* ---- รับ input ------------------------------------------------------------ */
const [pathArg, testUser, testPassword] = process.argv.slice(2);

if (!pathArg) {
  console.error('ใช้:  node scripts/check-admin-users.mjs <ไฟล์.json | -> [ชื่อผู้ใช้] [รหัสผ่าน]');
  process.exit(1);
}

let raw;
try {
  raw = pathArg === '-' ? readFileSync(0, 'utf8') : readFileSync(pathArg, 'utf8');
} catch (e) {
  console.error(bad(`อ่านไฟล์ไม่ได้: ${e.message}`));
  process.exit(1);
}

let errors = 0, warnings = 0;
const fail = (s) => { errors++; console.log('  ' + bad(s)); };
const caution = (s) => { warnings++; console.log('  ' + warn(s)); };

/* BOM หน้าไฟล์ทำให้ JSON.parse ล้ม แล้ว parseAdminUsers จะคืน [] ทั้งก้อน
   = ทุกคนเข้าไม่ได้พร้อมกัน ขึ้น 503 "ยังไม่ได้ตั้งรายชื่อแอดมิน" */
if (raw.charCodeAt(0) === 0xfeff) {
  caution('ไฟล์ขึ้นต้นด้วย BOM — ตัดออกก่อนวางลง secret ไม่งั้น JSON.parse ล้มทั้งก้อน');
  raw = raw.slice(1);
}

let list;
try {
  list = JSON.parse(raw.trim());
} catch (e) {
  console.log(bad(`JSON ไม่ถูกต้อง: ${e.message}`));
  console.log(warn('ถ้าค่านี้ขึ้น production ทุกคนจะเข้าไม่ได้พร้อมกัน (auth.ts คืน [] เงียบ ๆ)'));
  process.exit(1);
}

if (!Array.isArray(list)) {
  console.log(bad('ต้องเป็น JSON array เช่น [{"u":"...","name":"...","hash":"..."}] '));
  process.exit(1);
}
if (list.length === 0) {
  console.log(bad('array ว่าง — ไม่มีใครเข้าระบบได้'));
  process.exit(1);
}

/* ---- ตรวจทีละคน ----------------------------------------------------------- */
console.log(`\nพบ ${list.length} รายการ\n`);

const normed = [];

list.forEach((entry, i) => {
  const label = entry && typeof entry.u === 'string' ? entry.u : `(รายการที่ ${i + 1})`;
  console.log(`${i + 1}. ${label}`);

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    fail('ไม่ใช่ object — auth.ts จะกรองทิ้ง');
    console.log('');
    return;
  }

  /* คีย์ที่สะกดผิดคือสาเหตุที่คน ๆ เดียวหายไปโดยไม่มีอะไรฟ้อง */
  const known = new Set(['u', 'name', 'hash']);
  const extra = Object.keys(entry).filter((k) => !known.has(k));
  if (extra.length) {
    caution(`มีคีย์ที่ระบบไม่รู้จัก: ${extra.map((k) => JSON.stringify(k)).join(', ')} ` +
      '— สะกดผิดหรือเปล่า (ต้องเป็น u / name / hash เท่านั้น)');
  }

  /* -- ชื่อผู้ใช้ -- */
  if (typeof entry.u !== 'string' || !entry.u) {
    fail('ไม่มีคีย์ "u" หรือเป็นค่าว่าง — auth.ts:38 จะกรองรายการนี้ทิ้งเงียบ ๆ ' +
      'คนนี้จะเข้าไม่ได้โดยที่คนอื่นยังใช้ได้ปกติ');
  } else {
    const u = entry.u;
    console.log(`   ชื่อผู้ใช้ : ${reveal(u)}  ${DIM}(${[...u].length} ตัวอักษร)${RESET}`);
    if (u !== u.trim()) caution('มีช่องว่างหน้า/หลังชื่อ — ตัดออกให้เรียบร้อย');
    if (/\s/.test(u.trim())) caution('มีช่องว่างกลางชื่อ — พิมพ์ตามยาก ควรเอาออก');
    if (INVISIBLE.test(u)) { INVISIBLE.lastIndex = 0; caution('มีอักขระที่มองไม่เห็น (zero-width/BOM) ติดมาจากการก๊อปวาง'); }
    if (u !== u.toLowerCase()) caution('มีตัวพิมพ์ใหญ่ — ใช้พิมพ์เล็กล้วนจะสื่อสารกับกรรมการง่ายกว่า');
    if (/[^\x20-\x7e]/.test(u)) caution('มีอักขระนอก ASCII — บอกให้เจ้าตัวพิมพ์ตามได้ยาก');
    if ([...u].length > 60) fail('ยาวเกิน 60 ตัว — login.ts:40 ตัดค่าที่รับเข้ามาที่ 60 จะเทียบไม่ตรง');
    normed.push({ i: i + 1, u, key: normUser(u) });
  }

  /* -- ชื่อที่แสดง -- */
  if (entry.name === undefined) {
    console.log(`   ${DIM}ชื่อที่แสดง: (ไม่ได้ตั้ง — จะใช้ชื่อผู้ใช้แทน)${RESET}`);
  } else if (typeof entry.name !== 'string') {
    caution('"name" ไม่ใช่สตริง');
  } else {
    console.log(`   ชื่อที่แสดง: ${entry.name}`);
  }

  /* -- แฮช -- */
  if (typeof entry.hash !== 'string' || !entry.hash) {
    fail('ไม่มีคีย์ "hash" หรือเป็นค่าว่าง — auth.ts:38 จะกรองรายการนี้ทิ้งเงียบ ๆ');
    console.log('');
    return;
  }

  const h = entry.hash;
  const parts = h.split('$');
  if (parts.length !== 4) {
    fail(`แฮชควรมี 4 ท่อนคั่นด้วย $ แต่นับได้ ${parts.length} ` +
      '— มักเกิดตอนวางผ่าน shell ที่กิน $ หรือก๊อปมาไม่ครบ');
  } else if (parts[0] !== 'pbkdf2-sha256') {
    fail(`ท่อนแรกต้องเป็น "pbkdf2-sha256" แต่ได้ "${parts[0]}"`);
  } else {
    const iter = parseInt(parts[1], 10);
    let salt = null, derived = null, decodeErr = null;
    try { salt = b64uDecode(parts[2]); derived = b64uDecode(parts[3]); }
    catch (e) { decodeErr = e.message; }

    if (!Number.isFinite(iter) || iter < 1000 || iter > 1_000_000) {
      fail(`จำนวนรอบ "${parts[1]}" อยู่นอกช่วงที่ crypto.ts ยอมรับ (1,000–1,000,000)`);
    } else if (decodeErr) {
      fail(`ถอด base64url ไม่ได้: ${decodeErr}`);
    } else if (derived.length !== 32) {
      fail(`ส่วนแฮชถอดแล้วได้ ${derived.length} ไบต์ ต้องเป็น 32 — น่าจะโดนตัดตอนวาง`);
    } else {
      if (salt.length !== 16) caution(`salt ${salt.length} ไบต์ (ปกติ 16) — ใช้ได้ แต่ไม่ได้มาจาก hash-password.mjs`);
      if (iter !== 25_000) caution(`จำนวนรอบ ${iter.toLocaleString()} ต่างจากค่ามาตรฐาน 25,000 ` +
        '— ถ้าสูงกว่านี้มากอาจชน CPU 10ms ของ Workers แผนฟรี');
      console.log(`   แฮช      : ${good(`รูปแบบถูกต้อง · ${iter.toLocaleString()} รอบ · salt ${salt.length}B · hash ${derived.length}B`)}`);
    }
  }

  /* -- ทดสอบรหัสผ่านจริง -- */
  if (testUser && testPassword && normUser(entry.u) === normUser(testUser) && parts.length === 4) {
    try {
      const actual = pbkdf2Sync(testPassword, b64uDecode(parts[2]), parseInt(parts[1], 10), 32, 'sha256');
      const expected = b64uDecode(parts[3]);
      const match = actual.length === expected.length && timingSafeEqual(actual, expected);
      console.log(`   ทดสอบรหัส: ${match ? good('รหัสผ่านนี้เข้าได้') : bad('รหัสผ่านนี้เข้าไม่ได้')}`);
      if (!match) errors++;
    } catch (e) {
      fail(`ทดสอบรหัสผ่านไม่ได้: ${e.message}`);
    }
  }

  console.log('');
});

/* ---- ตรวจข้ามรายการ ------------------------------------------------------- */
const byKey = new Map();
for (const n of normed) {
  if (!byKey.has(n.key)) byKey.set(n.key, []);
  byKey.get(n.key).push(n);
}
for (const [key, group] of byKey) {
  if (group.length > 1) {
    errors++;
    console.log(bad(`ชื่อผู้ใช้ชนกัน "${key}" — รายการที่ ${group.map((g) => g.i).join(', ')} ` +
      `(${group.map((g) => JSON.stringify(g.u)).join(' / ')})`));
    console.log(`  ${DIM}ระบบเทียบชื่อแบบไม่แยกตัวพิมพ์ใหญ่เล็ก จะเจอแค่คนแรก อีกคนล็อกอินไม่ได้เลย${RESET}`);
  }
}

if (testUser && !normed.some((n) => n.key === normUser(testUser))) {
  errors++;
  console.log(bad(`ไม่มีชื่อผู้ใช้ "${testUser}" ในรายการนี้`));
}

/* ---- สรุป ----------------------------------------------------------------- */
console.log('─'.repeat(60));
if (errors) {
  console.log(bad(`มีปัญหา ${errors} จุด${warnings ? ` และข้อควรระวัง ${warnings} จุด` : ''} — อย่าเพิ่งเอาขึ้น production`));
} else if (warnings) {
  console.log(warn(`ใช้ได้ แต่มีข้อควรระวัง ${warnings} จุด`));
} else {
  console.log(good(`ผ่านทั้งหมด ${list.length} รายการ`));
}
console.log('');
console.log(`${DIM}ขั้นต่อไป:  npx wrangler pages secret put ADMIN_USERS --project-name ams49-reunion`);
console.log(`           แล้ว **redeploy** ด้วย — secret ที่ตั้งใหม่มีผลกับ deployment ถัดไปเท่านั้น${RESET}`);
console.log('');

process.exit(errors ? 1 : 0);
