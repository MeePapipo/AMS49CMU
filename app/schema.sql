-- ============================================================================
-- AMS49 CMU Reunion — โครงฐานข้อมูล D1
-- ไฟล์นี้ "ปลอดภัยที่จะรันซ้ำ" ทุกคำสั่งเป็น IF NOT EXISTS จึงใช้กับฐานจริงได้
-- ถ้าจะล้างฐาน dev ให้ทิ้ง ใช้ scripts/reset-dev.sql แทน
-- ============================================================================

-- ---------------------------------------------------------------------------
-- orders — หนึ่งแถวคือหนึ่งครั้งที่มีคนโอนเงินเข้ามา
--
-- ทำไมถึงเก็บ shirt_amount / surcharge / total ลงตาราง ทั้งที่คำนวณใหม่ได้:
-- ยอดที่เรียกเก็บไปแล้วคือ "ข้อเท็จจริงทางประวัติศาสตร์" ที่ต้องตรงกับ statement
-- ธนาคาร ถ้าวันหนึ่งแก้ตารางราคา (เช่นส่วนเพิ่มไซส์ใหญ่) แล้วระบบคำนวณสดทุกครั้ง
-- แถวเก่าทุกแถวจะเปลี่ยนค่าเงียบ ๆ แล้วยอดตรวจสอบย้อนหลังจะไม่ตรงกับเงินที่เข้าจริง
-- price_version บอกว่าแถวนี้คิดด้วยตารางราคาชุดไหน หน้าแอดมินจะขึ้นธงเตือน
-- ถ้า total ที่เก็บไว้ไม่ตรงกับที่คำนวณใหม่ได้
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  ref             TEXT PRIMARY KEY,                 -- AMS49-XXXXXX
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | verified | rejected

  -- เงิน (หน่วยบาทเต็มจำนวน ไม่มีสตางค์) — ทั้งหมดคำนวณโดยเซิร์ฟเวอร์เท่านั้น
  donation        INTEGER NOT NULL DEFAULT 0,
  shirt_amount    INTEGER NOT NULL DEFAULT 0,
  surcharge       INTEGER NOT NULL DEFAULT 0,       -- ส่วนเพิ่มไซส์ใหญ่รวมของแถวนี้
  total           INTEGER NOT NULL,                 -- donation + shirt_amount
  price_version   INTEGER NOT NULL DEFAULT 1,

  -- ของที่สั่ง
  shirt_qty       INTEGER NOT NULL DEFAULT 0,
  sizes           TEXT    NOT NULL DEFAULT '[]',    -- JSON array แบน เช่น ["M","M","L"]

  -- เวลาและสถานะ (ISO string ตามเวลาไทย ไม่มี timezone suffix เหมือน prototype)
  transfer_at     TEXT,                             -- เวลาที่ผู้บริจาคระบุว่าโอน
  submitted_at    TEXT NOT NULL,
  verified_at     TEXT,
  note            TEXT NOT NULL DEFAULT '',         -- เหตุผลตีกลับ (ผู้บริจาคเห็น)

  -- ผู้บริจาค (PII)
  name            TEXT NOT NULL DEFAULT '',
  student_id      TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  line_id         TEXT NOT NULL DEFAULT '',

  -- จัดส่ง (PII — ลบได้เมื่อส่งของครบ ดู shipped_at)
  recipient       TEXT NOT NULL DEFAULT '',
  recipient_phone TEXT NOT NULL DEFAULT '',
  addr_line       TEXT NOT NULL DEFAULT '',
  province        TEXT NOT NULL DEFAULT '',
  zip             TEXT NOT NULL DEFAULT '',
  ship_note       TEXT NOT NULL DEFAULT '',

  -- สลิป — ไฟล์จริงอยู่ใน R2 ตาราง D1 เก็บแค่กุญแจ
  slip_key        TEXT,
  slip_type       TEXT,
  slip_size       INTEGER,
  slip_name       TEXT,

  -- PDPA
  shipped_at      TEXT,        -- ตั้งเมื่อกด "ส่งของแล้ว" พร้อมล้างที่อยู่ทิ้ง
  purged_at       TEXT,        -- ตั้งเมื่อลบ PII ทั้งชุดตอนปิดโครงการ

  -- ตรวจสอบย้อนหลัง — เก็บ hash ของ IP ไม่ใช่ IP ตรง ๆ
  ip_hash         TEXT NOT NULL DEFAULT '',
  user_agent      TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

-- ---------------------------------------------------------------------------
-- audit — ใครทำอะไรกับรายการไหนเมื่อไร
-- จำเป็นเพราะหน้าแอดมินเห็นชื่อ เบอร์ ที่อยู่ และสลิปของทุกคน
-- และเพราะกรรมการหลายคนใช้ระบบเดียวกัน
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  at     TEXT NOT NULL,
  actor  TEXT NOT NULL,          -- ชื่อผู้ใช้แอดมิน หรืออีเมลจาก Cloudflare Access
  action TEXT NOT NULL,          -- login | verify | reject | ship | purge | export | view-slip
  ref    TEXT,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at DESC);

-- ---------------------------------------------------------------------------
-- rate — ตัวนับสำหรับจำกัดอัตราการเรียก
-- bucket = ชนิดการเรียก + hash ของ IP · reset_at เป็น epoch ms
-- D1 ทำงานนี้ได้พอ เพราะปริมาณของงานนี้เล็กมาก (ไม่ต้องเสียเงินซื้อ KV)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate (
  bucket   TEXT PRIMARY KEY,
  count    INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);
