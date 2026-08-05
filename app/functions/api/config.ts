/* GET /api/config
   ตารางไซส์ ราคา และเลขบัญชี — หน้าเว็บวาดตารางเลือกจำนวนจากค่าที่นี่
   มีที่เดียวจึงไม่มีวันที่หน้าเว็บกับเซิร์ฟเวอร์คิดราคาคนละแบบ
   (ต้นแบบประกาศ SIZES ไว้ใน app.js ฝั่งเบราว์เซอร์อย่างเดียว) */

import { Env, json } from '../lib/http';
import {
  SIZES, SHIRT_PRICE, SIZE_MAX, BULK_HINT, SIZE_TOLERANCE_IN, MAX_DONATION,
  PRICE_VERSION, BANK
} from '../lib/pricing';
import { REF_LENGTH } from '../lib/ref';
import { MAX_SLIP_BYTES } from '../lib/validate';
import { accessEnabled } from '../lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  return json(
    {
      ok: true,
      priceVersion: PRICE_VERSION,
      shirtPrice: SHIRT_PRICE,
      sizes: SIZES,
      sizeMax: SIZE_MAX,
      bulkHint: BULK_HINT,
      sizeToleranceIn: SIZE_TOLERANCE_IN,
      maxDonation: MAX_DONATION,
      maxSlipBytes: MAX_SLIP_BYTES,
      refLength: REF_LENGTH,
      bank: BANK,
      goal: Number(env.GOAL_AMOUNT || 500000),
      eventDate: env.EVENT_DATE || '2026-11-21',
      turnstile: env.TURNSTILE_ENABLED === '1' ? { siteKey: env.TURNSTILE_SITE_KEY || '' } : null,
      adminVia: accessEnabled(env) ? 'access' : 'password'
    },
    /* แคชสั้น ๆ ได้ ตารางราคาไม่เปลี่ยนบ่อย แต่ต้องไม่นานจนแก้ราคาแล้วไม่มีผล */
    { headers: { 'cache-control': 'public, max-age=60' } }
  );
};
