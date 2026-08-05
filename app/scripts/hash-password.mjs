#!/usr/bin/env node
/* ============================================================================
   สร้างรายการแอดมินสำหรับใส่ใน secret ADMIN_USERS

   ใช้:
     node scripts/hash-password.mjs pin "ปิ่นปินันท์"        ← สุ่มรหัสผ่านให้
     node scripts/hash-password.mjs pin "ปิ่นปินันท์" <รหัส>  ← ใช้รหัสที่มีอยู่แล้ว

   **ควรปล่อยให้สคริปต์สุ่มรหัสให้เสมอ**
   เหตุผลอยู่ใน functions/lib/crypto.ts — Workers แผนฟรีจำกัด CPU 10 มิลลิวินาที
   ต่อการเรียกหนึ่งครั้ง จึงตั้งจำนวนรอบ PBKDF2 ได้แค่ 25,000 ไม่ใช่สองแสนตามตำรา
   ความปลอดภัยจึงต้องมาจาก "รหัสผ่านเดาไม่ได้" แทน "แฮชช้า"
   16 ตัวจากชุด 58 ตัวอักษร ≈ 94 บิต ต่อให้แฮชเร็วก็เดาไม่ออก
   ========================================================================= */

import { pbkdf2Sync, randomBytes, randomInt } from 'node:crypto';

const ITERATIONS = 25_000;
/* ตัดตัวที่อ่านสับสน (I l 1 O 0) ออก เพราะรหัสนี้จะถูกส่งต่อกันในไลน์แล้วพิมพ์ตาม */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

const b64u = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function makePassword(len = 16) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

function hash(password) {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');
  return `pbkdf2-sha256$${ITERATIONS}$${b64u(salt)}$${b64u(derived)}`;
}

const [user, displayName, given] = process.argv.slice(2);

if (!user) {
  console.error('ใช้:  node scripts/hash-password.mjs <ชื่อผู้ใช้> [ชื่อที่แสดง] [รหัสผ่าน]');
  process.exit(1);
}

const password = given || makePassword();
const entry = { u: user, name: displayName || user, hash: hash(password) };

console.log('');
console.log('  ชื่อผู้ใช้ :', user);
console.log('  รหัสผ่าน  :', password);
console.log(given ? '  (ใช้รหัสที่ระบุมา)' : '  (สุ่มให้ — เก็บใส่ password manager แล้วอย่าส่งในแชทกลุ่ม)');
console.log('');
console.log('  เอาบรรทัดนี้ไปต่อใน ADMIN_USERS (เป็น JSON array รวมทุกคน):');
console.log('  ' + JSON.stringify(entry));
console.log('');
console.log('  ตั้งค่าตอน deploy:');
console.log('    npx wrangler pages secret put ADMIN_USERS');
console.log('  แล้ววาง JSON array ทั้งก้อน เช่น  [' + JSON.stringify(entry) + ']');
console.log('');
