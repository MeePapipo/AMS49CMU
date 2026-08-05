/* ตัวขับ _diag.html — same origin จึงเข้าถึง DOM ใน iframe ได้ */
(function () {
  'use strict';
  var WIDTHS = [320, 360, 390, 768, 1024];
  var out = document.getElementById('out');
  var frame = document.getElementById('frame');
  var bad = 0, checks = 0;

  /* ข้อมูลที่จะกรอกใส่ฟอร์มจริงในกรอก เพื่อให้เดินไปถึงขั้น 3–4 ได้
     ตั้งใจใช้ข้อความยาวผิดปกติ เพราะสิ่งที่กำลังตามหาคือแทร็กที่โป่งเพราะ min-content ของไทย
     (เดิมยัดผ่าน localStorage แต่ฟอร์มไม่บันทึกร่างแล้ว จึงต้องพิมพ์ใส่ช่องเอง) */
  var FILL = {
    'i-donation': '1000',
    'i-name': 'ทดสอบ เลย์เอาต์ที่ชื่อยาวมากเพื่อดูว่าตารางจะโป่งไหม',
    'i-sid': '491119999',
    'i-phone': '0812345678',
    'i-email': 'layout-test-ที่อีเมลยาวมาก@example.com',
    'i-line': 'line_test',
    'i-rname': 'ทดสอบ เลย์เอาต์',
    'i-rphone': '0812345678',
    'i-addr': '199/24 หมู่ 5 ถ.นิมมานเหมินท์ ต.สุเทพ อ.เมือง จังหวัดที่ชื่อยาวมากเป็นพิเศษ',
    'i-prov': 'เชียงใหม่',
    'i-zip': '50200',
    'i-shipnote': 'โทรก่อนส่งและฝากไว้ที่ป้อมยามหน้าหมู่บ้าน'
  };
  var QTY = { M: 2, '3XL': 1, '5XL': 1 };

  function fire(el, type) { el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true })); }

  function fillForm(doc) {
    Object.keys(QTY).forEach(function (size) {
      var inp = doc.querySelector('#qty input[data-size="' + size + '"]');
      if (inp) { inp.value = String(QTY[size]); fire(inp, 'input'); }
    });
    Object.keys(FILL).forEach(function (id) {
      var el = doc.getElementById(id);
      if (el) { el.value = FILL[id]; fire(el, 'input'); }
    });
    var consent = doc.getElementById('i-consent');
    if (consent && !consent.checked) { consent.checked = true; fire(consent, 'change'); }
  }

  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function load(url, width) {
    return new Promise(function (resolve) {
      frame.style.width = width + 'px';
      frame.onload = function () { resolve(); };
      frame.src = url;
    });
  }

  /* หา element ที่ยื่นเลยขอบขวาไปจริง ๆ — ไล่เฉพาะตัวที่ขวาสุด ไม่ต้องรายงานทั้งต้นไม้ */
  function culprit(doc, width) {
    var worst = null, worstRight = width + 1;
    var all = doc.body.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > worstRight) {
        worstRight = r.right;
        worst = el;
      }
    }
    if (!worst) return '';
    var id = worst.id ? '#' + worst.id : '';
    var cls = worst.className && typeof worst.className === 'string'
      ? '.' + worst.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return worst.tagName.toLowerCase() + id + cls + ' ยื่นถึง ' + Math.round(worstRight) + 'px';
  }

  function measure(label, width) {
    var doc = frame.contentDocument;
    var de = doc.documentElement;
    var over = de.scrollWidth - de.clientWidth;
    checks++;
    var row = document.createElement('div');
    row.className = 'row';
    if (over > 1) {
      bad++;
      row.innerHTML = '<span class="bad">OVERFLOW</span> ' + label + ' @' + width +
        'px — เกิน ' + over + 'px · ' + culprit(doc, width);
    } else {
      row.innerHTML = '<span class="ok">ok</span> ' + label + ' @' + width + 'px';
    }
    out.appendChild(row);
  }

  async function run() {
    out.textContent = '';

    for (var w of WIDTHS) {
      await load('/', w);
      await wait(900);
      measure('index', w);

      await load('/status?ref=AMS49-T5FQXB', w);
      await wait(1400);
      measure('status (พบรายการ)', w);

      await load('/support', w);
      await wait(1400);
      var doc = frame.contentDocument;
      measure('support · ขั้น 1 order', w);

      /* กรอกฟอร์มจริงแล้วกดปุ่ม "ถัดไป" เหมือนคนใช้ ไม่ใช่กระโดดข้ามด้วยการแก้สถานะ
         จะได้ตรวจ layout ของขั้นที่มีข้อมูลจริงอยู่ในนั้น */
      fillForm(doc);
      await wait(500);
      var steps = ['info', 'pay', 'slip'];
      for (var i = 0; i < steps.length; i++) {
        var next = doc.querySelector('#step-' + (i === 0 ? 'order' : steps[i - 1]) + ' [data-next]');
        if (next) { next.click(); await wait(1100); }
        measure('support · ขั้น ' + (i + 2) + ' ' + steps[i], w);
      }
    }

    var sum = document.createElement('div');
    sum.className = 'sum ' + (bad ? 'bad' : 'ok');
    sum.textContent = bad
      ? 'พบการล้น ' + bad + ' จุด จาก ' + checks + ' การตรวจ'
      : 'ไม่มีการเลื่อนแนวนอน — ผ่านทั้ง ' + checks + ' การตรวจ';
    out.appendChild(sum);
  }

  run().catch(function (e) {
    out.textContent = 'ตรวจไม่สำเร็จ: ' + e;
  });
})();
