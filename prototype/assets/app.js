/* ==========================================================================
   AMS49 CMU Reunion — prototype runtime
   ข้อมูลทั้งหมดเป็น "ข้อมูลตัวอย่าง" เก็บใน localStorage ไม่มี backend จริง
   ========================================================================== */
(function () {
  'use strict';

  /* v5 = "โอนยอดรวมก้อนเดียว" + สั่งเสื้อไม่จำกัดจำนวน + ราคาขั้นบันไดตามไซส์
     ผู้บริจาคเลือกเสื้อ (ระบุจำนวนต่อไซส์) + ระบุยอดบริจาค → ระบบคิดยอดรวม → โอนครั้งเดียว → แนบสลิป
     - donation = ตัวเลขที่ผู้บริจาคระบุเอง (ไม่ใช่ค่าที่หักออกจากยอดสลิปเหมือน v2)
     - ยอดที่แจ้ง = ยอดที่ระบบคำนวณ ผู้ใช้พิมพ์ยอดเองไม่ได้ ถ้าโอนผิดยอดแอดมินตีกลับ
     - sizes ครบตั้งแต่ตอนสั่ง ไม่มีสถานะ "สั่งแล้วยังไม่เลือกไซส์" อีก
     - เก็บที่อยู่แยกส่วน (addrLine/province/zip) เพราะแอดมินต้องพิมพ์ใบปะหน้าพัสดุและ export CSV

     ทำไมขึ้นจาก v4 เป็น v5 (โครงฟิลด์ไม่เปลี่ยน แต่ "ความหมายของข้อมูลเดิม" เปลี่ยน):
     - ไซส์ XXL ถูกเปลี่ยนรหัสเป็น 2XL — แถวเก่าที่เก็บ 'XXL' จะหาราคาไม่เจอ แล้วตกไปคิด 500 เท่าไซส์เล็ก
     - ไซส์พิเศษ (SPECIAL) ถูกยกเลิก — แถวเก่าที่เก็บ 'SPECIAL' จะโชว์คำว่า SPECIAL ดิบ ๆ บนหน้าเว็บ
     ไม่ขึ้นเวอร์ชัน = เครื่องที่เคยเปิดต้นแบบเดิมจะเห็นยอดผิดโดยไม่มีอะไรเตือน */
  /* เวอร์ชันของไฟล์ assets — ต้องตรงกับ ?v= ที่ทุกหน้าใช้เรียก system.css / app.js
     มีไว้กันเคสที่เกิดขึ้นจริงมาแล้ว: เบราว์เซอร์แคช app.js ตัวเก่าไว้ แล้วโหลด HTML ตัวใหม่
     ผลคือ HTML เรียกฟังก์ชันที่ JS เก่าไม่มี ยอดรวมค้างไม่ขยับ แต่ช่องจำนวนยังเดินได้ตามปกติ
     ผู้ใช้จึงไม่รู้ตัวและอาจโอนตามยอดที่ผิด — อันตรายที่สุดของเว็บนี้
     แก้ assets เมื่อไรต้องขึ้นเลขนี้ และขึ้น ?v= ในทุกหน้าให้ตรงกัน */
  var ASSET_VERSION = '6';

  var KEY = 'ams49.proto.v5';
  var DRAFT_KEY = 'ams49.draft.v3'; // ร่างฟอร์มที่ยังกรอกไม่เสร็จ (คนละก้อนกับรายการที่ส่งแล้ว)
                                    // ขึ้นเวอร์ชันตาม KEY เพราะร่างเก่าเก็บ counts ที่มีคีย์ XXL/SPECIAL
  var GOAL = 500000;     // เป้าหมายตัวอย่าง — ยังไม่ได้รับตัวเลขจริง
  var SHIRT_PRICE = 500; // ราคาฐานต่อตัว (SS–XL) รวมค่าจัดส่งแล้ว — ไซส์ใหญ่บวกเพิ่มที่ SIZES[].extra
  /* ไม่จำกัดจำนวนเสื้อต่อรายการ — สองตัวเลขนี้ไม่ใช่โควตา
     SIZE_MAX = เพดานต่อหนึ่งไซส์ กันพิมพ์ 500 แทน 5 แล้วยอดพุ่งเป็นแสน
     BULK_HINT = เกินนี้แค่ขึ้นข้อความให้กรรมการติดต่อยืนยันก่อนสั่งผลิต ยังกดต่อได้ตามปกติ */
  var SIZE_MAX = 99;
  var BULK_HINT = 10;

  /* --- Bank account (ถอดเป็นข้อความจากภาพสมุดบัญชี ไม่เผยแพร่ไฟล์ภาพ) ---
     การสะกดชื่อยืนยันโดยผู้จัดงานเมื่อ 5 ส.ค. 2569:
     - "ปิ่นปินันท์" แก้จาก "ปินัทธ์" ที่ถอดผิดตอนแรก — ตรงกับภาพสมุดบัญชี
     - "ชัชวาลชัยทรัพย์" ใช้ ช ตามที่ผู้จัดงานยืนยัน แม้ตัวอักษรในภาพสมุดบัญชี
       จะดูเหมือน ซ (ซัชวาล) ก็ตาม — อย่าเปลี่ยนกลับโดยอ้างภาพสมุดบัญชีอย่างเดียว
       ถ้าจะแก้ต้องถามผู้จัดงานก่อน */
  var BANK = {
    bank: 'ธนาคารกรุงไทย (Krungthai)',
    branch: 'สาขาเซ็นทรัล เชียงใหม่ (รหัสสาขา 1326)',
    number: '666-1-17730-6',
    numberPlain: '6661177306',
    name: 'น.ส.ปิ่นปินันท์ ร่มโพธิ์ และ นายธเนศ ชัชวาลชัยทรัพย์',
    note: 'บัญชีร่วม 2 ชื่อ — ต้องขึ้นชื่อครบทั้งสองท่านจึงจะถูกบัญชี'
  };

  /* --- ไซส์และราคา ---------------------------------------------------------
     extra = ค่าส่วนเพิ่มต่อตัวจากราคาฐาน 500
     SS–XL = 0 (ตัวละ 500) · 2XL +20 · 3XL +30 · 4XL +40 · 5XL +50
     ตัวเลขวัดเป็นนิ้วจากเสื้อวางราบ · ±1 นิ้วจากมาตรฐานถือว่าปกติ (งานตัดเย็บ)
     ถ้าราคาหรือขนาดเปลี่ยน ให้แก้ที่ตารางนี้ที่เดียว —
     ทุกหน้าคิดเงินผ่าน priceForSize() และวาดตารางจาก SIZES จึงเปลี่ยนตามกันทั้งระบบ

     หมายเหตุ: ภาพ size-chart.jpg เป็นตารางต้นฉบับจากผู้ผลิตซึ่งมีถึง 3XL เท่านั้น
     4XL/5XL เป็นไซส์ที่เพิ่มทีหลัง จึงไม่มีในภาพ — ตารางบนหน้าเว็บคือฉบับที่ครบกว่า */
  var SIZES = [
    { s: 'SS',  chest: 34, shoulder: 15,   len: 23.5, extra: 0 },
    { s: 'S',   chest: 37, shoulder: 16.5, len: 25.5, extra: 0 },
    { s: 'M',   chest: 40, shoulder: 17.5, len: 28,   extra: 0 },
    { s: 'L',   chest: 44, shoulder: 18.5, len: 29,   extra: 0 },
    { s: 'XL',  chest: 46, shoulder: 20,   len: 30,   extra: 0 },
    { s: '2XL', chest: 48, shoulder: 21,   len: 31,   extra: 20 },
    { s: '3XL', chest: 50, shoulder: 21.5, len: 32,   extra: 30 },
    { s: '4XL', chest: 52, shoulder: 22,   len: 33,   extra: 40 },
    { s: '5XL', chest: 54, shoulder: 22.5, len: 34,   extra: 50 }
  ];

  /* ความคลาดเคลื่อนที่ยอมรับได้ของงานตัดเย็บ — ประกาศไว้ที่เดียวให้ทุกหน้าอ้างอิงตรงกัน */
  var SIZE_TOLERANCE_IN = 1;

  function sizeInfo(code) {
    return SIZES.filter(function (x) { return x.s === code; })[0] || null;
  }
  function sizeLabel(code) { return code; }
  function priceForSize(code) {
    var i = sizeInfo(code);
    return SHIRT_PRICE + ((i && i.extra) || 0);
  }
  function extraForSize(code) {
    var i = sizeInfo(code);
    return (i && i.extra) || 0;
  }

  /* --- Seed: ข้อมูลตัวอย่าง ------------------------------------------------
     [ รหัส, เงินบริจาคที่ระบุ, ไซส์ที่สั่ง, เวลาโอน, สถานะ ]
     ยอดที่โอน = เงินบริจาค + ผลรวมราคาเสื้อรายตัว — คำนวณให้ ไม่เก็บซ้ำในตาราง
     ตั้งใจให้มีเคสครบ: บริจาคอย่างเดียว / ซื้อเสื้ออย่างเดียว / ทั้งคู่ /
     หลายตัวคนละไซส์ / ไซส์ใหญ่ที่มีส่วนเพิ่ม / ตรวจไม่ผ่าน */
  var SEED = [
    ['AMS49-7K2M', 1000,  ['M'],           '2026-08-04T09:12', 'verified'],
    ['AMS49-Q4XD', 0,     ['L'],           '2026-08-04T08:41', 'verified'],
    ['AMS49-P9RT', 2000,  [],              '2026-08-03T21:05', 'verified'],
    ['AMS49-B3NW', 500,   ['XL'],          '2026-08-03T19:30', 'pending'],
    ['AMS49-M8VC', 5000,  ['XL', 'L'],     '2026-08-03T16:22', 'verified'],
    ['AMS49-Z1HK', 300,   [],              '2026-08-03T14:58', 'verified'],
    ['AMS49-J6LD', 1500,  ['S'],           '2026-08-02T20:11', 'verified'],
    /* 2XL +20 → เสื้อตัวนี้ 520 ไม่ใช่ 500 เอาไว้กันการคิดเงินแบบ qty × 500 กลับมาเงียบ ๆ */
    ['AMS49-T5FQ', 10000, ['2XL'],         '2026-08-02T17:45', 'verified'],
    ['AMS49-C2WN', 800,   [],              '2026-08-02T13:03', 'pending'],
    ['AMS49-R7GB', 0,     ['M', 'M'],      '2026-08-01T22:19', 'verified'],
    ['AMS49-Y4SP', 2500,  [],              '2026-08-01T18:34', 'verified'],
    ['AMS49-D9KM', 1000,  [],              '2026-08-01T11:27', 'rejected'],
    /* 5XL +50 → 550 · เคสไซส์ใหญ่สุดที่ยังรอตรวจสลิป */
    ['AMS49-H3TV', 600,   ['5XL'],         '2026-07-31T20:52', 'pending'],
    ['AMS49-N8QJ', 3000,  [],              '2026-07-31T15:16', 'verified'],
    ['AMS49-W6CX', 0,     ['M', 'L', 'XL'],'2026-07-30T19:08', 'verified']
  ];

  var NAMES = ['ปิยะพงษ์ ใจดี','สุนิสา วงศ์คำ','ธนกฤต แสงทอง','อารีรัตน์ พรมมา','วิชญ์ ศรีวรรณ',
    'กมลชนก อินต๊ะ','ณัฐพล ธารทิพย์','พิมพ์ชนก มูลศรี','ชยพล เรืองฤทธิ์','ศิรินทิพย์ คำปัน',
    'ธีรเดช บุญมา','นภัสสร ปัญญา','อัครเดช สุขใจ','เมธาวี จันทร์เพ็ญ','ภาณุพงศ์ ตันติ'];

  /* ที่อยู่ตัวอย่าง — เก็บแยกส่วนเหมือนของจริง เพราะแอดมินต้องเรียงเป็นใบปะหน้าพัสดุ */
  var ADDRS = [
    { line: '199/24 หมู่ 5 ถ.นิมมานเหมินท์ ต.สุเทพ อ.เมือง', province: 'เชียงใหม่', zip: '50200' },
    { line: '88/12 ซ.ลาดพร้าว 71 แขวงลาดพร้าว เขตลาดพร้าว', province: 'กรุงเทพมหานคร', zip: '10230' },
    { line: '45 หมู่ 3 ต.ช้างเผือก อ.เมือง', province: 'เชียงใหม่', zip: '50300' },
    { line: '301/7 ถ.มิตรภาพ ต.ในเมือง อ.เมือง', province: 'ขอนแก่น', zip: '40000' }
  ];

  /* ประกอบที่อยู่เป็นบรรทัดเดียวสำหรับแสดงผล — ที่เดียวทั้งระบบ ฟอร์มกับ seed จะได้หน้าตาตรงกัน
     ตั้งใจไม่รวม shipNote ("โทรก่อนส่ง") ไว้ในสตริงนี้ เพราะมันเป็นคำสั่งถึงคนส่ง
     ไม่ใช่ส่วนหนึ่งของที่อยู่ — ถ้าปนเข้าไปจะไปโผล่บนใบปะหน้าพัสดุด้วย */
  function composeAddress(p) {
    if (!p || !p.line) return '';
    return [p.line, 'จ.' + p.province, p.zip].join(' ');
  }

  function seed() {
    return SEED.map(function (r, i) {
      var sizes = r[2].slice(), suffix = r[0].slice(6).toLowerCase();
      var name = NAMES[i % NAMES.length];
      var phone = '08' + String(10000000 + i * 730451).slice(0, 8);
      var a = sizes.length ? ADDRS[i % ADDRS.length] : null;
      return {
        ref: r[0],
        donation: r[1],
        shirtQty: sizes.length,
        sizes: sizes,
        transferAt: r[3],
        status: r[4],
        /* ผู้บริจาค */
        name: name,
        studentId: '49' + String(1110001 + i * 137),
        phone: phone,
        email: 'ams49.' + suffix + '@example.com',
        lineId: i % 4 === 3 ? '' : 'line_' + suffix,  // เว้นบางรายการไว้ เพราะ LINE ID ไม่บังคับ
        /* จัดส่ง — ว่างทั้งชุดถ้าไม่ได้สั่งเสื้อ */
        recipient: a ? name : '',
        recipientPhone: a ? phone : '',
        addrLine: a ? a.line : '',
        province: a ? a.province : '',
        zip: a ? a.zip : '',
        shipNote: a && i % 5 === 2 ? 'โทรก่อนส่ง' : '',
        address: composeAddress(a),
        slip: 'slip_' + suffix + '.jpg',
        submittedAt: r[3],
        verifiedAt: r[4] === 'verified' ? r[3] : null,
        note: r[4] === 'rejected' ? 'ยอดในสลิปไม่ตรงกับที่แจ้ง (สลิป 100 บาท)' : ''
      };
    });
  }

  /* --- ตัวช่วยอ่านเงินของหนึ่งรายการ ---------------------------------------
     ทุกหน้าต้องแยกสองก้อนนี้ให้ตรงกัน จึงรวมไว้ที่เดียว
     ค่าเสื้อคิดเป็นรายตัวจากไซส์ ไม่ใช่ qty × 500 เพราะ 2XL–5XL มีส่วนเพิ่มรายไซส์
     surcharge = ส่วนเพิ่มรวมของรายการนี้ (ไว้อธิบายให้ผู้ใช้เห็นว่าทำไมยอดไม่ลงท้ายด้วย 00) */
  function money(r) {
    var sizes = (r.sizes || []).filter(Boolean);
    var qty = Number(r.shirtQty);
    if (isNaN(qty)) qty = sizes.length;
    var shirtAmount = sizes.reduce(function (sum, s) { return sum + priceForSize(s); }, 0);
    if (qty > sizes.length) shirtAmount += (qty - sizes.length) * SHIRT_PRICE; // เผื่อข้อมูลเก่าที่ไซส์ไม่ครบ
    var surcharge = sizes.reduce(function (sum, s) { return sum + extraForSize(s); }, 0);
    var donation = Number(r.donation) || 0;
    return {
      donation: donation,
      shirtQty: qty,
      shirtAmount: shirtAmount,
      surcharge: surcharge,
      total: donation + shirtAmount,
      sizes: sizes,
      sizeText: sizes.map(sizeLabel).join(', ')
    };
  }

  /* --- Store --------------------------------------------------------------- */
  var Store = {
    all: function () {
      try {
        var raw = localStorage.getItem(KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) { /* private mode */ }
      var s = seed();
      Store.save(s);
      return s;
    },
    save: function (rows) {
      try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch (e) {}
    },
    add: function (row) { var a = Store.all(); a.unshift(row); Store.save(a); return row; },
    find: function (ref) {
      var q = String(ref || '').trim().toUpperCase();
      return Store.all().filter(function (r) { return r.ref.toUpperCase() === q; })[0] || null;
    },
    update: function (ref, patch) {
      var a = Store.all();
      for (var i = 0; i < a.length; i++) {
        if (a[i].ref === ref) { for (var k in patch) a[i][k] = patch[k]; break; }
      }
      Store.save(a);
    },
    reset: function () {
      try { localStorage.removeItem(KEY); localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    },
    stats: function () {
      var a = Store.all();
      var donation = 0, shirtRevenue = 0, shirts = 0, pending = 0, vc = 0, pc = 0;
      var noAddress = 0, shirtsAll = 0, bySize = {};
      a.forEach(function (r) {
        var m = money(r);
        if (r.status === 'verified') {
          donation += m.donation; shirtRevenue += m.shirtAmount; shirts += m.shirtQty; vc++;
          if (m.shirtQty > 0 && !r.address) noAddress++;
        } else if (r.status === 'pending') {
          pending += m.total; pc++;
          if (m.shirtQty > 0 && !r.address) noAddress++;
        }
        /* นับไซส์เพื่อสั่งผลิต — รวมรายการที่ยังรอตรวจด้วย แต่ไม่รวมที่ตีกลับ */
        if (r.status !== 'rejected') {
          shirtsAll += m.shirtQty;
          m.sizes.forEach(function (s) { bySize[s] = (bySize[s] || 0) + 1; });
        }
      });
      return {
        donation: donation,          // เงินบริจาคที่ยืนยันแล้ว = ยอดที่ประกาศหน้าแรก
        shirtRevenue: shirtRevenue,  // ยอดขายเสื้อที่ยืนยันแล้ว (ยังไม่หักต้นทุน)
        verified: donation + shirtRevenue, // เงินเข้าบัญชีที่ยืนยันแล้วทั้งหมด
        shirts: shirts,              // เสื้อของรายการที่ยืนยันแล้ว
        shirtsAll: shirtsAll,        // เสื้อทั้งหมดที่ยังไม่ถูกตีกลับ (ใช้ตอนสั่งผลิต)
        bySize: bySize, noAddress: noAddress,
        pending: pending, verifiedCount: vc, pendingCount: pc, goal: GOAL
      };
    }
  };

  /* --- Draft ---------------------------------------------------------------
     ร่างของคนที่กรอกฟอร์มสั่งแล้วแต่ยังไม่โอน/ยังไม่แนบสลิป
     ตั้งใจให้อยู่ในเครื่องอย่างเดียว ไม่เข้า Store — รายการที่ไม่มีสลิปจะได้ไม่ไป
     ปนในบัญชีสาธารณะ และคนที่กรอกเล่นแล้วปิดหน้าไปก็ไม่ทิ้งขยะไว้
     Store.reset() ล้าง DRAFT_KEY ให้อยู่แล้ว จึงไม่ต้องล้างซ้ำที่นี่ */
  var Draft = {
    load: function () {
      try {
        var raw = localStorage.getItem(DRAFT_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    save: function (obj) {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(obj)); } catch (e) {}
    },
    clear: function () {
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    }
  };

  /* --- แปลงระหว่าง "จำนวนต่อไซส์" กับ "รายการไซส์แบน" ----------------------
     ฟอร์มคิดเป็น {M:2, L:1} เพราะสั่งได้ไม่จำกัดจำนวน
     แต่ store เก็บเป็น ['M','M','L'] เหมือนเดิม เพื่อให้ money() / stats() ที่เขียนไว้แล้วใช้ต่อได้
     และเผื่อวันหนึ่งเสื้อแต่ละตัวมีข้อมูลรายตัว (เช่นชื่อสกรีนหลัง) ที่ counts เก็บไม่ได้ */
  var SIZE_ORDER = SIZES.map(function (s) { return s.s; });

  function countsToSizes(counts) {
    var out = [];
    SIZE_ORDER.forEach(function (code) {
      var n = Number(counts && counts[code]) || 0;
      for (var i = 0; i < n; i++) out.push(code);
    });
    return out;
  }
  function sizesToCounts(sizes) {
    var c = {};
    (sizes || []).filter(Boolean).forEach(function (s) { c[s] = (c[s] || 0) + 1; });
    return c;
  }
  /* 'M×2, L×1' — เรียงตามไซส์เล็กไปใหญ่เสมอ ไม่ใช่ตามลำดับที่ผู้ใช้กด */
  function sizeSummary(sizes) {
    var c = sizesToCounts(sizes);
    return SIZE_ORDER.filter(function (k) { return c[k]; })
      .map(function (k) { return sizeLabel(k) + '×' + c[k]; }).join(', ');
  }

  /* --- ตัวเลือกจำนวนเสื้อรายไซส์ --------------------------------------------
     เลิกใช้ "radio หนึ่งชุดต่อเสื้อหนึ่งตัว" เพราะสั่งได้ไม่จำกัด — 20 ตัวคือ 20 ชุด
     เปลี่ยนเป็นตารางไซส์ที่มีตัวนับต่อแถว ช่องกลางพิมพ์เลขได้ด้วย
     (กด + ยี่สิบครั้งไม่ไหว แต่ก็ต้อง clamp ที่ SIZE_MAX กันพิมพ์พลาด) */
  function clampQty(v) {
    var n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
    if (isNaN(n) || n < 0) n = 0;
    return Math.min(n, SIZE_MAX);
  }
  function qtyInputs(el) {
    return [].slice.call(el.querySelectorAll('input[data-size]'));
  }

  function readQtyPicker(el) {
    var counts = {}, total = 0;
    if (el) qtyInputs(el).forEach(function (inp) {
      var n = clampQty(inp.value);
      if (n > 0) { counts[inp.getAttribute('data-size')] = n; total += n; }
    });
    return {
      counts: counts,
      total: total,
      sizes: countsToSizes(counts)
    };
  }

  /* วาดค่าที่คำนวณได้กลับลงตาราง แล้วส่งสัญญาณให้หน้าที่ใช้อยู่คิดยอดรวมใหม่ */
  function syncQtyPicker(el) {
    qtyInputs(el).forEach(function (inp) {
      var n = clampQty(inp.value);
      /* ปล่อยช่องว่างไว้ระหว่างพิมพ์ ไม่งั้นลบเลขทิ้งแล้วเด้งเป็น 0 ทันทีจนพิมพ์ต่อไม่ได้
         (blur จะเติม 0 ให้เอง) */
      if (inp.value !== '' && String(n) !== inp.value) inp.value = n;
      var tr = inp.closest('tr');
      tr.setAttribute('data-on', n > 0 ? 'true' : 'false');
      var sub = tr.querySelector('.qt-sub');
      if (sub) sub.textContent = n ? baht(n * priceForSize(inp.getAttribute('data-size'))) + ' บาท' : '';
      var minus = tr.querySelector('[data-d="-1"]');
      var plus = tr.querySelector('[data-d="1"]');
      if (minus) minus.disabled = n === 0;
      if (plus) plus.disabled = n >= SIZE_MAX;
    });
    var r = readQtyPicker(el);
    el.dispatchEvent(new CustomEvent('qtychange', { detail: r }));
    return r;
  }

  function buildQtyPicker(el, counts) {
    if (!el) return;
    counts = counts || {};

    /* ป้าย "+20" ข้างรหัสไซส์ — ราคาต่อตัวไม่เท่ากันแล้ว ผู้ใช้ต้องเห็นก่อนกดเลือก
       ไม่ทำเป็นคอลัมน์ใหม่เพราะตารางนี้ต้องรอดที่จอ 320px */
    function row(s) {
      var n = Number(counts[s.s]) || 0;
      var plus = s.extra ? '<span class="qt-plus">+' + s.extra + '</span>' : '';
      return '<tr data-size="' + s.s + '">' +
        '<th scope="row"><b>' + s.s + '</b>' + plus + '<span class="qt-sub num"></span></th>' +
        '<td class="qt-dim">' + s.chest + '"</td>' +
        '<td class="qt-dim qt-sh">' + s.shoulder + '"</td>' +
        '<td class="qt-dim qt-len">' + s.len + '"</td>' +
        '<td class="qt-n"><div class="qty-stepper">' +
          '<button type="button" data-d="-1" aria-label="ลดจำนวนเสื้อไซส์ ' + s.s + '">−</button>' +
          '<input type="text" inputmode="numeric" autocomplete="off" maxlength="2" ' +
            'data-size="' + s.s + '" value="' + n + '" aria-label="จำนวนเสื้อไซส์ ' + s.s +
            ' ตัวละ ' + baht(priceForSize(s.s)) + ' บาท">' +
          '<button type="button" data-d="1" aria-label="เพิ่มจำนวนเสื้อไซส์ ' + s.s + '">+</button>' +
        '</div></td></tr>';
    }

    el.innerHTML =
      '<table class="qty-table"><caption class="sr">' +
      'เลือกจำนวนเสื้อแยกตามไซส์ ตัวเลขขนาดเป็นนิ้ว ไซส์ 2XL ขึ้นไปมีส่วนเพิ่มจากราคาฐาน ' +
      baht(SHIRT_PRICE) + ' บาท</caption>' +
      '<thead><tr><th scope="col">ไซส์</th><th scope="col">รอบอก</th>' +
      '<th scope="col" class="qt-sh">ไหล่</th>' +
      '<th scope="col" class="qt-len">ความยาว</th>' +
      '<th scope="col" class="qt-n">จำนวน</th></tr></thead><tbody>' +
      SIZES.map(row).join('') +
      '</tbody></table>';

    /* ผูกครั้งเดียวต่อ container — buildQtyPicker ถูกเรียกซ้ำได้ตอนกู้ร่าง
       ถ้าผูกทุกรอบ handler จะซ้อนกันจนกด + หนึ่งครั้งเพิ่มหลายตัว */
    if (!el._qtyBound) {
      el._qtyBound = true;
      el.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('button[data-d]') : null;
        if (!b) return;
        var inp = b.parentNode.querySelector('input[data-size]');
        inp.value = clampQty(clampQty(inp.value) + Number(b.getAttribute('data-d')));
        syncQtyPicker(el);
      });
      el.addEventListener('input', function (e) {
        if (e.target.getAttribute('data-size')) syncQtyPicker(el);
      });
      /* blur ไม่ bubble ต้องดักที่ capture phase */
      el.addEventListener('blur', function (e) {
        if (e.target.getAttribute('data-size') && e.target.value === '') {
          e.target.value = '0'; syncQtyPicker(el);
        }
      }, true);
    }
    syncQtyPicker(el);
  }

  /* --- Format -------------------------------------------------------------- */
  var TH_MONTH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  function baht(n) { return Number(n).toLocaleString('en-US'); }
  function thDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    var pad = function (x) { return String(x).padStart(2, '0'); };
    return pad(d.getDate()) + ' ' + TH_MONTH[d.getMonth()] + ' ' + (d.getFullYear() + 543 - 2500) +
      ' · ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function newRef() {
    var c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
    for (var i = 0; i < 4; i++) s += c[Math.floor(Math.random() * c.length)];
    return 'AMS49-' + s;
  }
  /* ข้อความจากผู้ใช้ (ชื่อ อีเมล LINE ที่อยู่ หมายเหตุ) ถูกเอาไปต่อเป็น innerHTML หลายที่
     จึงต้อง escape ก่อนเสมอ ไม่งั้นเครื่องหมาย < > ในที่อยู่พังหน้า */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* --- Icons --------------------------------------------------------------- */
  var ICON = {
    check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg>',
    clock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.4 1.5" stroke-linecap="round"/></svg>',
    x:     '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
    alert: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10" cy="10" r="7.6"/><path d="M10 6.2v4.6" stroke-linecap="round"/><circle cx="10" cy="13.6" r=".9" fill="currentColor" stroke="none"/></svg>',
    info:  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10" cy="10" r="7.6"/><path d="M10 9.4v4.4" stroke-linecap="round"/><circle cx="10" cy="6.6" r=".9" fill="currentColor" stroke="none"/></svg>',
    shirt: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M5.6 2L2 3.9l1.2 2.6 1.3-.6V14h7V5.9l1.3.6L14 3.9 10.4 2A2.4 2.4 0 015.6 2z"/></svg>'
  };

  var STATUS = {
    pending:  { cls: 'badge-pending',  icon: ICON.clock, label: 'รอตรวจสอบ' },
    verified: { cls: 'badge-verified', icon: ICON.check, label: 'ยืนยันแล้ว' },
    rejected: { cls: 'badge-rejected', icon: ICON.x,     label: 'ตรวจไม่ผ่าน' }
  };
  function badge(status) {
    var s = STATUS[status] || STATUS.pending;
    return '<span class="badge ' + s.cls + '">' + s.icon + s.label + '</span>';
  }

  /* --- Toast --------------------------------------------------------------- */
  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role','status'); document.body.appendChild(t); }
    t.textContent = msg;
    t.dataset.show = 'true';
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.dataset.show = 'false'; }, 2400);
  }

  /* --- Copy to clipboard (+ fallback เมื่อไม่มี Clipboard API / ไม่ใช่ https) */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }

  function bindCopy(root) {
    (root || document).querySelectorAll('[data-copy]').forEach(function (btn) {
      if (btn._bound) return;
      btn._bound = true;
      var label = btn.querySelector('.cf-btn-label') || btn;
      var original = label.textContent;
      btn.addEventListener('click', function () {
        var val = btn.getAttribute('data-copy');
        copyText(val).then(function () {
          btn.dataset.state = 'copied';
          label.textContent = 'คัดลอกแล้ว';
          toast('คัดลอกแล้ว: ' + val);
        }).catch(function () {
          btn.dataset.state = 'failed';
          label.textContent = 'คัดลอกไม่ได้';
          // fallback ให้ผู้ใช้เลือกเองด้วยมือ
          var v = btn.closest('.cf-row') && btn.closest('.cf-row').querySelector('.cf-val');
          if (v) {
            var r = document.createRange(); r.selectNodeContents(v);
            var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
          }
          toast('เบราว์เซอร์ไม่อนุญาต — เลือกข้อความไว้ให้แล้ว กด Ctrl/Cmd+C');
        }).then(function () {
          setTimeout(function () { btn.dataset.state = ''; label.textContent = original; }, 1800);
        });
      });
    });
  }

  /* --- Count-up (มี causality: เงินเข้าใหม่) ------------------------------- */
  function countUp(el, to) {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { el.textContent = baht(to); return; }
    var from = 0, t0 = null, dur = 900;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = baht(Math.round(from + (to - from) * e));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* --- Nav active ---------------------------------------------------------- */
  function markNav() {
    var file = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    document.querySelectorAll('.nav a').forEach(function (a) {
      var href = (a.getAttribute('href') || '').split('#')[0].toLowerCase();
      if (href === file) a.setAttribute('aria-current', 'page');
    });
  }

  /* --- Field validation ---------------------------------------------------- */
  function setInvalid(field, msg) {
    field.dataset.invalid = 'true';
    var e = field.querySelector('.err');
    if (e) e.innerHTML = ICON.alert + '<span>' + esc(msg) + '</span>';
    var input = field.querySelector('.input,.select,.textarea');
    if (input) input.setAttribute('aria-invalid', 'true');
  }
  function clearInvalid(field) {
    field.dataset.invalid = 'false';
    var input = field.querySelector('.input,.select,.textarea');
    if (input) input.removeAttribute('aria-invalid');
  }

  document.addEventListener('DOMContentLoaded', function () {
    markNav();
    bindCopy();
    var y = document.getElementById('reset-proto');
    if (y) y.addEventListener('click', function () {
      Store.reset(); toast('รีเซ็ตข้อมูลตัวอย่างแล้ว'); setTimeout(function(){ location.reload(); }, 500);
    });
  });

  window.AMS = {
    ASSET_VERSION: ASSET_VERSION,
    Store: Store, Draft: Draft, BANK: BANK, SIZES: SIZES, GOAL: GOAL,
    SHIRT_PRICE: SHIRT_PRICE, SIZE_MAX: SIZE_MAX, BULK_HINT: BULK_HINT, DRAFT_KEY: DRAFT_KEY,
    SIZE_TOLERANCE_IN: SIZE_TOLERANCE_IN,
    buildQtyPicker: buildQtyPicker, readQtyPicker: readQtyPicker, syncQtyPicker: syncQtyPicker,
    countsToSizes: countsToSizes, sizesToCounts: sizesToCounts, sizeSummary: sizeSummary,
    composeAddress: composeAddress,
    money: money, priceForSize: priceForSize, extraForSize: extraForSize,
    sizeInfo: sizeInfo, sizeLabel: sizeLabel,
    baht: baht, thDate: thDate, newRef: newRef, esc: esc,
    badge: badge, ICON: ICON, toast: toast, copyText: copyText,
    bindCopy: bindCopy, countUp: countUp,
    setInvalid: setInvalid, clearInvalid: clearInvalid
  };
})();
