# ขึ้นเว็บจริงบน Cloudflare — ฟรีทั้งหมด ไม่ต้องผูกบัตร

ทำตามลำดับ ใช้เวลารวมประมาณ 30–40 นาที ทุกอย่างในคู่มือนี้อยู่ในโควตาฟรี
ตัวเลขที่ต้องระวังคือ Workers/Pages Functions **100,000 คำขอต่อวัน** ซึ่งงานขนาดรุ่นเดียว
ห่างจากเพดานมาก

---

## 0 · เตรียม

```bash
cd "/mnt/c/Users/praditww/Desktop/Claude Project/AMS/app"
npm install
npx wrangler login          # เปิดเบราว์เซอร์ให้ล็อกอิน Cloudflare
```

ยังไม่มีบัญชี Cloudflare ก็สมัครที่ <https://dash.cloudflare.com/sign-up> ฟรี ไม่ต้องมีโดเมน
(จะได้ที่อยู่ `ams49-reunion.pages.dev` มาใช้)

---

## 1 · สร้างฐานข้อมูลและที่เก็บสลิป

```bash
npx wrangler d1 create ams49
npx wrangler r2 bucket create ams49-slips
```

คำสั่งแรกจะพิมพ์ `database_id` ออกมา — **เอาไปใส่ใน `wrangler.toml`** แทนเลขศูนย์ทั้งแถว

```toml
[[d1_databases]]
binding = "DB"
database_name = "ams49"
database_id = "เลขที่ได้จากคำสั่งข้างบน"
```

แล้วสร้างตารางบนฐานจริง

```bash
npm run db:init:remote
```

> `schema.sql` ใช้ `CREATE TABLE IF NOT EXISTS` ทั้งไฟล์ จึงรันซ้ำได้ไม่พังข้อมูล
> **อย่ารัน `scripts/seed-dev.sql` กับฐานจริงเด็ดขาด** — บรรทัดแรกของมันคือ `DELETE FROM orders`

> **bucket `ams49-slips` ต้องเป็นแบบไม่ public ตลอดไป**
> ในหน้า R2 ของ dashboard จะมีปุ่ม "Allow Access / Public Development URL" — **ห้ามกด**
> ถ้ากดเมื่อไร ใครเดา URL ถูกจะเปิดดูสลิปของทุกคนได้โดยไม่ต้องล็อกอิน
> ทางเดียวที่ควรเข้าถึงไฟล์คือผ่าน `/api/admin/slip/:ref` ซึ่งตรวจสิทธิ์ก่อนเสมอ

---

## 2 · สร้างบัญชีแอดมินของกรรมการ

ทำทีละคน เพื่อให้บันทึกการใช้งานบอกได้ว่าใครกดอะไร

```bash
node scripts/hash-password.mjs pin   "ปิ่นปินันท์"
node scripts/hash-password.mjs tanet "ธเนศ"
```

สคริปต์จะ **สุ่มรหัสผ่านให้** — ปล่อยให้มันสุ่ม อย่าตั้งเอง
เหตุผล: Workers แผนฟรีจำกัด CPU 10 มิลลิวินาทีต่อคำขอ ระบบจึงใช้ PBKDF2 ได้แค่ 25,000 รอบ
ไม่ใช่สองแสนรอบตามตำรา ความปลอดภัยจึงต้องมาจาก "รหัสเดาไม่ออก" แทน "แฮชช้า"
รหัสที่สุ่มมา 16 ตัวคือประมาณ 94 บิต ซึ่งเดาไม่ได้ในทางปฏิบัติ

ส่งรหัสให้เจ้าตัวทางช่องทางส่วนตัว **ไม่ใช่ในไลน์กลุ่มรุ่น** แล้วบอกให้เก็บใน password manager

เอา JSON ที่ได้ของทุกคนมารวมเป็น array เดียว แล้วตั้งเป็นความลับ

```bash
npx wrangler pages secret put ADMIN_USERS
# วาง:  [{"u":"pin","name":"ปิ่นปินันท์","hash":"pbkdf2-sha256$..."},{"u":"tanet",...}]

npx wrangler pages secret put SESSION_SECRET
# วางค่าที่สุ่มมา 32 ตัวขึ้นไป เช่นจาก:  openssl rand -base64 32
```

`SESSION_SECRET` ใช้เซ็น cookie และใช้ทำ hash ของ IP ด้วย
**เปลี่ยนค่านี้เมื่อไร ทุกคนที่ล็อกอินอยู่จะหลุดพร้อมกัน** ซึ่งมีประโยชน์ถ้าวันหนึ่งเครื่องกรรมการหาย

---

## 3 · ขึ้นเว็บ

```bash
npm run deploy
```

ครั้งแรกจะถามชื่อโปรเจกต์ (ใช้ `ams49-reunion`) แล้วได้ URL กลับมา
เข้า `https://ams49-reunion.pages.dev/admin.html` ลองล็อกอินด้วยบัญชีที่เพิ่งสร้าง

ถ้าล็อกอินแล้วขึ้นว่า "ระบบยังตั้งค่าไม่ครบ" แปลว่า secret ยังไม่ติด — ตรวจที่
dashboard → Workers & Pages → ams49-reunion → Settings → Variables and Secrets

---

## 4 · เปิดตัวกันบอท (Turnstile) — แนะนำให้ทำก่อนแชร์ลิงก์

1. dashboard → Turnstile → Add widget → โดเมน `ams49-reunion.pages.dev` → Widget Mode: Managed
2. เอา **Site Key** ใส่ใน `wrangler.toml`

```toml
TURNSTILE_ENABLED = "1"
TURNSTILE_SITE_KEY = "0x4AAAAAAA..."
```

3. เอา **Secret Key** ตั้งเป็นความลับ

```bash
npx wrangler pages secret put TURNSTILE_SECRET
npm run deploy
```

ถ้าตั้ง `TURNSTILE_ENABLED = "1"` แต่ลืมใส่ secret ระบบจะ **ปฏิเสธทุกการส่ง** ไม่ใช่ปล่อยผ่าน
— ตั้งใจให้พังแบบเห็นชัด ดีกว่าเปิดประตูทิ้งไว้เงียบ ๆ

---

## 5 · Cloudflare Access — ชั้นล็อกอินด้วย Google (ไม่บังคับ แต่ดีกว่า)

ทำเมื่อพร้อม ระบบใช้รหัสผ่านได้อยู่แล้วโดยไม่ต้องมีขั้นนี้

1. dashboard → Zero Trust (สมัครฟรี เลือกแผน Free 50 ผู้ใช้)
2. Settings → Authentication → เพิ่ม Login method **Google**
3. Access → Applications → Add → Self-hosted
   - Application domain: `ams49-reunion.pages.dev`
   - Path: `admin.html` แล้วเพิ่มอีกอันสำหรับ `api/admin`
   - Policy: Allow → Emails → ใส่อีเมล Google ของกรรมการทุกคน
4. เปิด Application → Overview จะเห็น **Application Audience (AUD) Tag** — คัดลอกไว้
5. ใส่ใน `wrangler.toml` แล้ว deploy ใหม่

```toml
ACCESS_TEAM_DOMAIN = "ชื่อทีมของคุณ.cloudflareaccess.com"
ACCESS_AUD = "AUD tag ที่คัดลอกมา"
ACCESS_EMAILS = "a@gmail.com,b@gmail.com"
```

**พอตั้งค่านี้แล้ว การล็อกอินด้วยรหัสผ่านจะถูกปิดทั้งระบบ** — `/api/admin/login` ตอบ 404
และทุกคำขอต้องมี JWT ของ Access ที่ผ่านการตรวจลายเซ็นซ้ำที่ฝั่งเรา
(ต้องตรวจซ้ำ เพราะ Pages ให้ URL แบบ `<hash>.ams49-reunion.pages.dev` มาด้วย
ซึ่งไม่ได้อยู่ใต้ Access policy ที่ผูกกับโดเมนหลัก)

`ACCESS_EMAILS` เป็น allow-list ชั้นสอง เผื่อ policy ใน Zero Trust ถูกแก้พลาดให้กว้างเกินไป

---

## 6 · เช็กลิสต์ก่อนแชร์ลิงก์ในไลน์กลุ่มรุ่น

- [ ] `npm run smoke -- https://ams49-reunion.pages.dev` ผ่านทั้งหมด
      (ตั้ง `SMOKE_USER` / `SMOKE_PASS` เป็นบัญชีจริงก่อนรัน · **จะสร้างรายการทดสอบจริงในฐาน**
      ให้เข้าไปกด "ตีกลับ" หรือลบทิ้งหลังรันเสร็จ)
- [ ] เปิด `https://<โปรเจกต์>.pages.dev/api/admin/orders` ในหน้าต่างส่วนตัว → ต้องได้ 401
- [ ] ลองสั่งของจริงหนึ่งรายการด้วยมือ แล้วเข้าหลังบ้านดูว่าเปิดสลิปได้
- [ ] ยอดบนขั้น "โอนยอดรวม" ตรงกับที่หลังบ้านแสดง
- [ ] ยืนยันเลขบัญชี `666-1-17730-6` และการสะกดชื่อบัญชีกับผู้จัดงานอีกครั้ง
      (ชื่ออยู่ใน `functions/lib/pricing.ts` → `BANK`)
- [ ] ยืนยันราคาเสื้อและส่วนเพิ่มไซส์ใหญ่กับผู้จัดงาน (`SIZES[].extra`)
- [ ] แปะลิงก์ในแชทส่วนตัวก่อน ดูว่าการ์ดพรีวิว (og:image) ขึ้นถูก
- [ ] ตกลงกันในกรรมการว่าใครเป็นคนตรวจสลิป และตรวจวันละกี่รอบ

---

## แก้ราคาหรือไซส์ทีหลัง

แก้ที่ `functions/lib/pricing.ts` **ที่เดียว** แล้ว `npm run deploy`
หน้าเว็บดึงตารางจาก `/api/config` จึงเปลี่ยนตามทันที ไม่ต้องแก้ HTML

**ต้องขึ้น `PRICE_VERSION` ด้วยทุกครั้ง** — รายการเก่าเก็บยอดที่เรียกเก็บจริงไว้ในฐาน
พร้อมเลขเวอร์ชันของตารางที่ใช้ตอนนั้น ถ้าไม่ขึ้นเลข หน้าหลังบ้านจะแยกไม่ออกว่า
ยอดที่ไม่ตรงเป็นเพราะเปลี่ยนราคา หรือเป็นเพราะบั๊ก
รายการเก่าจะขึ้นธง "ยอดไม่ตรงตารางราคาปัจจุบัน" ซึ่งถูกต้องแล้ว — **ห้ามแก้ยอดเก่าตามราคาใหม่**
เพราะยอดเก่าคือเงินที่เข้าบัญชีไปจริง

---

## PDPA — สิ่งที่ต้องทำจริง ไม่ใช่แค่เขียนไว้ในฟอร์ม

ฟอร์มยินยอมสัญญาไว้สองข้อ ระบบมีปุ่มให้ทำทั้งสองข้อแล้ว แต่ต้องมีคนกด

| เมื่อไร | ทำอะไร |
|---|---|
| ส่งเสื้อให้คนหนึ่งเสร็จ | เปิดรายการนั้น → **ส่งของแล้ว · ลบที่อยู่** → ชื่อผู้รับ เบอร์ และที่อยู่ถูกลบทันที |
| ปิดโครงการ (หลัง พ.ย. 2569) | เปิดทีละรายการ → **ปิดโครงการ/ลบข้อมูล** (action `purge`) → ลบ PII ทั้งชุดและไฟล์สลิปออกจาก R2 เหลือแค่ยอดกับรหัสไว้ตรวจสอบย้อนหลัง |

พิมพ์ใบปะหน้าพัสดุให้ครบก่อนกด "ส่งของแล้ว" — กดแล้วเอาที่อยู่กลับมาไม่ได้
ทุกการลบถูกบันทึกใน "บันทึกการใช้งาน" ว่าใครกดเมื่อไร

ถ้าต้องการลบทีเดียวทั้งโครงการ ใช้ SQL ตรง (ระวัง ไม่มีปุ่ม undo)

```bash
npx wrangler d1 execute ams49 --remote --command "
  UPDATE orders SET purged_at = datetime('now','+7 hours'),
    name='', student_id='', phone='', email='', line_id='',
    recipient='', recipient_phone='', addr_line='', province='', zip='', ship_note='',
    slip_key=NULL, slip_type=NULL, slip_size=NULL, slip_name=NULL, ip_hash='', user_agent=''
  WHERE purged_at IS NULL"
```

แล้วลบไฟล์ใน R2 ตามด้วย (`npx wrangler r2 object delete ams49-slips/<key>` ทีละไฟล์
หรือลบทั้ง bucket แล้วสร้างใหม่ถ้าปิดโครงการจริง ๆ)

---

## สำรองข้อมูล

D1 แผนฟรีไม่มี point-in-time restore ให้ดึงไฟล์ออกมาเก็บเองเป็นระยะ

```bash
npx wrangler d1 export ams49 --remote --output "backup-$(date +%F).sql"
```

ทำเดือนละครั้งก็พอ และทำแน่ ๆ ก่อนแก้อะไรที่แตะฐานข้อมูล

---

## ค่าใช้จ่าย

ทุกอย่างในคู่มือนี้อยู่ในโควตาฟรีถาวร ไม่ต้องผูกบัตร

| บริการ | โควตาฟรี | ที่งานนี้ใช้จริง |
|---|---|---|
| Pages (โฮสต์หน้าเว็บ) | ไม่จำกัด | — |
| Pages Functions | 100,000 คำขอ/วัน | หลักร้อยถึงหลักพัน |
| D1 | 5 GB · อ่าน 5 ล้านแถว/วัน | หลักร้อยแถว |
| R2 | 10 GB · เขียน 1 ล้านครั้ง/เดือน | สลิปละ ~200 KB |
| Turnstile | ไม่จำกัด | — |
| Zero Trust Access | 50 ผู้ใช้ | กรรมการไม่กี่คน |

Cloudflare **ไม่ pause โปรเจกต์เมื่อไม่มี traffic** ต่างจาก Supabase free tier ที่หยุดโปรเจกต์
หลังเงียบ 7 วัน ซึ่งเป็นเหตุผลที่เลือก stack นี้ตั้งแต่แรก — งานนี้ traffic มาเป็นช่วง ๆ
ยาวข้ามปีจนถึงพฤศจิกายน 2569
