/* หน้าเช็คสถานะ — ค้นด้วยรหัสอ้างอิงเท่านั้น
   เซิร์ฟเวอร์ส่งกลับเฉพาะ จังหวัด+ไปรษณีย์ ไม่ส่งที่อยู่เต็ม ชื่อ หรือเบอร์
   ถ้ารหัสอ้างอิงหลุดไปอยู่ในมือคนอื่น อย่างน้อยข้อมูลพวกนั้นต้องไม่หลุดตามไปด้วย */
(function () {
  'use strict';
  var A = window.AMS;
  var $ = function (id) { return document.getElementById(id); };
  var input = $('i-ref');
  var panes = {
    idle: $('pane-idle'), loading: $('pane-loading'), none: $('pane-none'), found: $('pane-found')
  };
  function show(k) { for (var n in panes) panes[n].hidden = (n !== k); }

  function timeline(r) {
    var steps = [
      { t: 'แจ้งยอดเข้าระบบ', d: A.thDate(r.submittedAt), done: true },
      { t: 'กรรมการเทียบสลิปกับ statement',
        d: r.status === 'pending' ? 'กำลังดำเนินการ — ปกติไม่เกิน 24 ชม.' : A.thDate(r.verifiedAt || r.submittedAt),
        done: r.status !== 'pending', current: r.status === 'pending' },
      r.status === 'rejected'
        ? { t: 'ตรวจไม่ผ่าน', d: 'ดูเหตุผลด้านล่าง', done: false, reject: true }
        : { t: 'ขึ้นบัญชีสาธารณะเป็น “ยืนยันแล้ว”',
            d: r.status === 'verified' ? A.thDate(r.verifiedAt) : 'รอขั้นตอนก่อนหน้า',
            done: r.status === 'verified' }
    ];
    if (r.shipped) {
      steps.push({ t: 'ส่งของแล้ว', d: 'ที่อยู่จัดส่งถูกลบออกจากระบบเรียบร้อย', done: true });
    }
    return steps.map(function (s) {
      var icon = s.done ? A.ICON.check : (s.reject ? A.ICON.x : A.ICON.clock);
      return '<li data-done="' + !!s.done + '"' + (s.current ? ' data-current="true"' : '') + '>' +
        '<span class="dot">' + (s.done || s.current || s.reject ? icon : '') + '</span>' +
        '<div><p style="font-weight:600">' + A.esc(s.t) + '</p><p class="meta">' + A.esc(s.d) + '</p></div></li>';
    }).join('');
  }

  function render(r) {
    $('r-ref').textContent = r.ref;
    $('r-badge').innerHTML = A.badge(r.status);
    $('r-amount').textContent = A.baht(r.total);
    $('r-split').textContent = r.shirtQty
      ? 'เงินบริจาค ' + A.baht(r.donation) + ' + ค่าเสื้อ ' + r.shirtQty + ' ตัว ' + A.baht(r.shirtAmount)
      : 'เป็นเงินบริจาคทั้งก้อน';
    $('r-sizes').textContent = r.shirtQty ? r.sizeText : '—';
    $('r-time').textContent = A.thDate(r.transferAt);
    $('r-timeline').innerHTML = timeline(r);

    var note = $('r-note');
    if (r.status === 'rejected') {
      /* esc() บังคับ — ข้อความนี้แอดมินพิมพ์เอง แต่ไปแสดงบนหน้าที่ผู้บริจาคเปิด */
      note.innerHTML = '<div class="callout callout-danger"><span aria-hidden="true">' + A.ICON.alert + '</span>' +
        '<span><strong>เหตุผลที่ตรวจไม่ผ่าน:</strong> ' + A.esc(r.note || 'ไม่ระบุ') +
        '<br>กรุณาติดต่อกรรมการรุ่นหรือแจ้งยอดใหม่พร้อมสลิปที่ถูกต้อง</span></div>';
    } else if (r.status === 'pending') {
      note.innerHTML = '<div class="callout callout-warn"><span aria-hidden="true">' + A.ICON.alert + '</span>' +
        '<span>ยอดนี้ยังไม่ถูกนับรวมในยอดสาธารณะ จนกว่ากรรมการจะยืนยัน</span></div>';
    } else { note.innerHTML = ''; }

    var sh = $('r-shirt');
    if (r.status === 'rejected') {
      sh.innerHTML = '';
    } else if (r.shirtQty) {
      /* โชว์แค่จังหวัด+ไปรษณีย์ ไม่โชว์ที่อยู่เต็ม — และเมื่อส่งของแล้ว ที่อยู่ถูกลบไปจริง ๆ
         จึงต้องบอกให้ผู้ใช้รู้ว่าไม่ใช่ระบบลืม แต่เป็นการลบตามที่สัญญาไว้ */
      var where = r.shipped
        ? 'ส่งแล้ว — ที่อยู่ถูกลบออกจากระบบตามที่แจ้งไว้ในฟอร์มยินยอม'
        : (r.province ? 'ส่งไปที่ จ.' + A.esc(r.province) + ' ' + A.esc(r.zip) +
            ' · หน้านี้ไม่แสดงที่อยู่เต็มเพื่อกันรหัสอ้างอิงหลุด'
          : 'ยังไม่มีที่อยู่ในระบบ');
      sh.innerHTML = '<div class="callout callout-info">' +
        '<span aria-hidden="true">' + (r.shipped ? A.ICON.truck : A.ICON.shirt) + '</span>' +
        '<span class="grow"><strong>สั่งเสื้อไว้ ' + r.shirtQty + ' ตัว · ไซส์ ' + A.esc(r.sizeText) + '</strong>' +
        (r.surcharge
          ? '<br><span class="meta">รวมส่วนเพิ่มไซส์ใหญ่ ' + A.baht(r.surcharge) + ' บาทแล้ว</span>' : '') +
        '<br><span class="meta">' + where +
        '<br>ต้องแก้ไซส์หรือที่อยู่ ทักกรรมการรุ่นพร้อมรหัสนี้ — ระบบแก้เองไม่ได้เพราะเงินเข้าบัญชีไปแล้ว</span>' +
        '</span></div>';
    } else {
      sh.innerHTML = '<div class="callout" style="align-items:center">' +
        '<span aria-hidden="true">' + A.ICON.shirt + '</span>' +
        '<span class="grow">รายการนี้เป็นเงินบริจาคอย่างเดียว ไม่ได้สั่งเสื้อรุ่น — ' +
        'อยากได้เสื้อสั่งเป็นรายการใหม่ได้เลย</span>' +
        '<a class="btn btn-secondary btn-sm" href="/support">สั่งเสื้อรุ่น</a></div>';
    }

    show('found');
  }

  function notFound(title, body) {
    $('none-title').textContent = title;
    $('none-body').textContent = body;
    show('none');
  }

  var busy = false;
  function lookup(ref) {
    if (busy) return;
    var f = $('f-ref');
    var q = String(ref || '').trim().toUpperCase();
    if (!q) { A.setInvalid(f, 'กรอกรหัสอ้างอิงก่อน'); input.focus(); return; }
    A.clearInvalid(f);

    /* ไม่ตรวจรูปแบบซ้ำที่นี่ — ปล่อยให้เซิร์ฟเวอร์เป็นคนบอกว่าผิดตรงไหน
       จะได้มีกติกาชุดเดียว และข้อความอธิบายตัวอักษรที่พิมพ์ผิดอยู่ที่เดียว */
    busy = true;
    var btn = $('btn-look');
    btn.dataset.loading = 'true';
    btn.disabled = true;
    show('loading');

    A.API.status(q).then(function (res) {
      render(res.order);
    }).catch(function (err) {
      if (err.code === 'bad_ref') {
        A.setInvalid(f, err.message);
        show('idle');
        input.focus();
      } else if (err.code === 'rate_limited') {
        notFound('ค้นถี่เกินไป', err.message);
      } else if (err.status === 404) {
        notFound('ไม่พบรหัสนี้',
          'ตรวจตัวอักษรอีกครั้ง — รหัสไม่มีตัว I O 0 1 เพื่อกันสับสน ' +
          'ถ้าเพิ่งส่งรายการไปเมื่อสักครู่ ลองรอสักครู่แล้วค้นใหม่');
      } else {
        notFound('เกิดข้อผิดพลาด', err.message);
      }
    }).then(function () {
      busy = false;
      btn.dataset.loading = 'false';
      btn.disabled = false;
    });
  }

  $('lookup').addEventListener('submit', function (e) { e.preventDefault(); lookup(input.value); });
  input.addEventListener('input', function () { A.clearInvalid($('f-ref')); });
  $('btn-retry').addEventListener('click', function () { show('idle'); input.focus(); });

  /* ?ref=... มาจากลิงก์ "ดูสถานะรายการนี้" ในหน้าสำเร็จ */
  A.ready(function () {
    var qs = new URLSearchParams(location.search).get('ref');
    if (qs) { input.value = qs.toUpperCase(); lookup(qs); }
  });
})();
