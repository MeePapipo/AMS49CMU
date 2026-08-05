/* ============================================================================
   หลังบ้านกรรมการรุ่น

   สิทธิ์ทั้งหมดตัดสินที่เซิร์ฟเวอร์ ไฟล์นี้แค่ถาม /api/admin/me ว่าเราเป็นใคร
   ซ่อน/แสดงส่วนต่าง ๆ ในหน้านี้ไม่ใช่การป้องกัน — ต่อให้แก้ DOM ให้คอนโซลโผล่มา
   ทุก endpoint ก็ยังตอบ 401 อยู่ดี ต่างจากต้นแบบที่เทียบรหัสด้วย JS ในหน้าเว็บ
   ========================================================================= */
(function () {
  'use strict';
  var A = window.AMS;
  var $ = function (id) { return document.getElementById(id); };

  var dlg = $('dlg');
  var filter = 'pending';
  var q = '';
  var searchTimer = null;
  var current = null;   // รายการที่เปิดอยู่ในกล่องตรวจสลิป
  var byRef = {};
  var me = null;        // ตัวเราเป็นใคร — ใช้ตัดสินว่าตอนหมดเวลาต้องทำแบบไหน

  /* ---------- เข้าระบบ ---------- */
  function showOnly(id) {
    ['checking', 'login', 'need-access', 'console'].forEach(function (k) {
      $(k).hidden = k !== id;
    });
  }

  function enterConsole(who) {
    me = who;
    $('who').textContent = who.name + (who.via === 'access' ? ' · Cloudflare Access' : '');
    $('logout').hidden = who.via === 'access';   // Access ต้องออกจากระบบที่ฝั่ง Cloudflare
    $('idle-note').hidden = true;
    showOnly('console');
    armIdle();
    load();
    loadAudit();
  }

  /* ---------- ออกจากระบบอัตโนมัติเมื่อไม่มีการใช้งาน ----------
     ปัญหาที่แก้: กรรมการลืมกดออกจากระบบแล้วลุกไปทำอย่างอื่น หรือปิดเบราว์เซอร์ไป
     แล้วเปิดมาใหม่ยังอยู่ในคอนโซล ซึ่งหน้านี้เห็นชื่อ เบอร์ ที่อยู่ และสลิปของทุกคน

     cookie ถูกเปลี่ยนเป็น session cookie แล้ว (ปิดเบราว์เซอร์แล้วหาย) แต่ชั้นนั้นไม่พอ
     เพราะ Chrome/Edge ที่ตั้ง "เปิดต่อจากที่ค้างไว้" จะกู้กลับมาให้ และเครื่องที่เปิดทิ้งไว้
     เฉย ๆ ก็ไม่ได้ปิดอยู่แล้ว — ตัวจับเวลาตรงนี้คือชั้นที่กันเคสนั้นได้จริง

     20 นาทีเลือกจากงานจริง: ตรวจสลิปหนึ่งรายการใช้เวลาไม่กี่นาที ส่วนการเปิด statement
     ธนาคารเทียบยอดนับเป็น "ไม่ใช้งาน" ก็จริง แต่ 20 นาทีเผื่อไว้พอสมควรแล้ว
     ถ้าสั้นไปหรือยาวไปแก้ค่าเดียวตรงนี้ */
  var IDLE_MS = 20 * 60 * 1000;
  var idleTimer = null;

  function armIdle() {
    clearTimeout(idleTimer);
    if (!me) return;
    idleTimer = setTimeout(idleLogout, IDLE_MS);
  }
  function disarmIdle() { clearTimeout(idleTimer); idleTimer = null; }

  function idleLogout() {
    disarmIdle();
    var viaPassword = me && me.via === 'password';
    me = null;

    /* ล้างข้อมูลส่วนบุคคลออกจากหน้าจอก่อนอย่างอื่น — ตารางในหน้ามีชื่อ เบอร์
       และที่อยู่ของทุกคนค้างอยู่ใน DOM ต่อให้ cookie ถูกลบไปแล้วก็ยังอ่านจากจอได้ */
    try { dlg.close(); } catch (e) {}
    $('a-body').innerHTML = '';
    $('audit-list').innerHTML = '';
    $('d-slip-img').removeAttribute('src');
    byRef = {};
    current = null;

    if (!viaPassword) {
      /* โหมด Cloudflare Access — session คุมที่ Zero Trust ไม่ใช่ที่เรา
         โหลดหน้าใหม่เพื่อล้างจอ แล้วให้ Access เป็นคนตัดสินว่าต้องล็อกอินซ้ำไหม */
      location.reload();
      return;
    }

    A.API.admin.logout().catch(function () {}).then(function () {
      $('idle-note').hidden = false;
      showOnly('login');
      $('i-pin').value = '';
    });
  }

  /* รีเซ็ตตัวจับเวลาเมื่อมีการใช้งานจริง — ผูกครั้งเดียวตอนโหลดหน้า
     ใช้ passive:true เพื่อไม่ให้ scroll สะดุด */
  ['mousedown', 'keydown', 'scroll', 'touchstart', 'pointermove'].forEach(function (ev) {
    document.addEventListener(ev, function () { if (me) armIdle(); }, { passive: true });
  });

  function checkSession() {
    A.API.admin.me().then(enterConsole).catch(function (err) {
      if (err.status === 401 || err.status === 404) {
        showOnly(A.config.adminVia === 'access' ? 'need-access' : 'login');
      } else {
        showOnly('login');
        A.setInvalid($('f-pin'), err.message);
      }
    });
  }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('btn-login');
    if (btn.disabled) return;
    var user = $('i-user').value.trim();
    var pass = $('i-pin').value;
    A.clearInvalid($('f-user'));
    A.clearInvalid($('f-pin'));
    if (!user || !pass) { A.setInvalid($('f-pin'), 'กรอกชื่อผู้ใช้และรหัสผ่าน'); return; }

    btn.disabled = true; btn.dataset.loading = 'true';
    A.API.admin.login(user, pass).then(function (me) {
      $('i-pin').value = '';
      enterConsole(me);
    }).catch(function (err) {
      /* ไม่บอกว่าผิดช่องไหน — บอกไปก็เท่ากับใบ้ว่าชื่อผู้ใช้นี้มีอยู่จริง */
      A.setInvalid($('f-pin'), err.message);
    }).then(function () {
      btn.disabled = false; btn.dataset.loading = 'false';
    });
  });

  ['i-user', 'i-pin'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      A.clearInvalid($('f-user')); A.clearInvalid($('f-pin'));
      /* เก็บข้อความ "ออกจากระบบอัตโนมัติ" ทันทีที่เริ่มพิมพ์ ไม่งั้นมันจะค้างอยู่
         คู่กับข้อความ error ตอนล็อกอินผิด แล้วอ่านสับสน */
      $('idle-note').hidden = true;
    });
  });

  $('logout').addEventListener('click', function () {
    A.API.admin.logout().then(function () { location.reload(); })
      .catch(function () { location.reload(); });
  });

  /* ---------- ตาราง ---------- */
  function renderSizes(st) {
    $('a-size-grid').innerHTML = (st.sizeOrder || []).map(function (code) {
      var n = st.bySize[code] || 0;
      return '<div style="border:1px solid ' + (n ? 'var(--purple-500)' : 'var(--line)') +
        ';border-radius:var(--r-md);padding:var(--s3) var(--s2);text-align:center;background:' +
        (n ? 'var(--purple-100)' : 'var(--surface-2)') + '">' +
        '<p class="meta" style="font-weight:600">' + A.esc(code) + '</p>' +
        '<p class="num" style="font-size:1.375rem;font-weight:600;line-height:1.2">' + n + '</p></div>';
    }).join('');
    $('a-size-total').textContent = 'รวม ' + st.shirtsAll + ' ตัว';

    var flags = [];
    if (st.noAddress) flags.push('มี ' + st.noAddress + ' รายการที่สั่งเสื้อแต่ยังไม่มีที่อยู่จัดส่ง');
    if (st.toShip) flags.push('มี ' + st.toShip + ' รายการรอส่งเสื้อ');
    $('a-size-flags').hidden = flags.length === 0;
    $('a-size-flags-text').textContent = flags.join(' · ');
  }

  function rowHtml(r) {
    var shirt = '<span class="meta">—</span>';
    if (r.shirtQty) {
      shirt = '<span class="badge badge-shirt">' + A.ICON.shirt + A.esc(r.sizeText) + '</span>';
      if (r.surcharge) shirt += '<div class="meta">รวมส่วนเพิ่มไซส์ใหญ่ ' + A.baht(r.surcharge) + '</div>';
      if (r.shippedAt) shirt += '<div class="meta">ส่งแล้ว ' + A.esc(A.thDate(r.shippedAt)) + '</div>';
      else if (!r.addrLine) shirt += '<div class="meta" style="color:var(--reject-fg)">ยังไม่มีที่อยู่</div>';
    }
    var extra = '';
    if (r.note) extra += '<div class="meta" style="color:var(--reject-fg);max-width:26ch">' + A.esc(r.note) + '</div>';
    if (r.priceDrift) {
      extra += '<div class="meta" style="color:var(--reject-fg)">ยอดไม่ตรงตารางราคาปัจจุบัน (' +
        A.baht(r.priceDrift.recomputedTotal) + ')</div>';
    }
    if (r.purgedAt) extra += '<div class="meta">ลบข้อมูลส่วนบุคคลแล้ว</div>';

    /* data-l = หัวคอลัมน์ — จอแคบซ่อน thead แล้วเอาค่านี้มาเป็น label ของแต่ละช่อง
       ถ้าเพิ่มคอลัมน์ใหม่ ต้องใส่ data-l และวาง grid-row ใน system.css ด้วย */
    return '<tr>' +
      '<td class="c-ref" data-l="รหัส">' + A.esc(r.ref) + '</td>' +
      '<td class="c-name" data-l="ชื่อ–นามสกุล">' + (A.esc(r.name) || '<span class="meta">—</span>') +
        (r.studentId ? ' <span class="meta mono">' + A.esc(r.studentId) + '</span>' : '') +
        (r.address ? '<div class="meta" style="max-width:34ch">' + A.esc(r.recipient || r.name) + ' · ' + A.esc(r.address) + '</div>' : '') +
      '</td>' +
      '<td class="c-phone" data-l="เบอร์">' + A.esc(r.phone) + '</td>' +
      '<td class="c-time" data-l="เวลาโอน">' + A.esc(A.thDate(r.transferAt)) + '</td>' +
      '<td class="c-shirt" data-l="เสื้อ">' + shirt + '</td>' +
      '<td class="c-status" data-l="สถานะ">' + A.badge(r.status) + extra + '</td>' +
      '<td class="c-don" data-l="บริจาค">' + A.baht(r.donation) + '</td>' +
      '<td class="c-shirtamt" data-l="ค่าเสื้อ">' + (r.shirtQty ? A.baht(r.shirtAmount) : '<span class="meta">—</span>') + '</td>' +
      '<td class="c-amount" data-l="รวมที่โอน">' + A.baht(r.total) + '</td>' +
      '<td class="c-act no-print"><button class="btn btn-secondary btn-sm" data-open="' + A.esc(r.ref) + '">ตรวจสลิป</button></td>' +
      '</tr>';
  }

  var loading = false;
  function load() {
    if (loading) return;
    loading = true;
    $('a-loading').hidden = false;

    A.API.admin.orders(filter, q).then(function (res) {
      var st = res.stats;
      $('a-pending').textContent = st.pendingCount;
      $('a-pending-amt').textContent = st.pendingCount
        ? 'รวม ' + A.baht(st.pending) + ' บาท รอเทียบ statement'
        : 'ไม่มีรายการค้าง';
      $('a-donation').textContent = A.baht(st.donation);
      $('a-verified-c').textContent = st.verifiedCount + ' รายการที่ยืนยันแล้ว';
      $('a-shirtrev').textContent = A.baht(st.shirtRevenue);
      $('a-shirt-n').textContent = st.shirts + ' ตัวจากรายการที่ยืนยันแล้ว';
      $('a-verified').textContent = A.baht(st.verified);
      renderSizes(st);

      byRef = {};
      res.orders.forEach(function (r) { byRef[r.ref] = r; });
      $('a-body').innerHTML = res.orders.map(rowHtml).join('');
      $('a-table').hidden = res.orders.length === 0;
      $('a-empty').hidden = res.orders.length !== 0;
    }).catch(function (err) {
      if (err.status === 401) { location.reload(); return; }
      A.toast('โหลดรายการไม่สำเร็จ: ' + err.message);
    }).then(function () {
      loading = false;
      $('a-loading').hidden = true;
    });
  }

  function loadAudit() {
    A.API.admin.audit(80).then(function (res) {
      $('audit-list').innerHTML = (res.entries || []).map(function (e) {
        return '<p class="meta" style="border-bottom:1px solid var(--line);padding-bottom:6px">' +
          '<span class="mono">' + A.esc(e.at) + '</span> · <strong>' + A.esc(e.actor) + '</strong> · ' +
          A.esc(e.action) + (e.ref ? ' · <span class="mono">' + A.esc(e.ref) + '</span>' : '') +
          (e.detail ? ' — ' + A.esc(e.detail) : '') + '</p>';
      }).join('') || '<p class="meta">ยังไม่มีบันทึก</p>';
    }).catch(function () { /* บันทึกโหลดไม่ได้ไม่ควรทำให้หน้าหลักพัง */ });
  }

  /* ผูกครั้งเดียวด้วย event delegation — ต้นแบบผูก listener ใหม่ทุกครั้งที่ render
     ซึ่งรอดเพราะ innerHTML สร้าง element ใหม่หมด แต่จะพังทันทีถ้าเปลี่ยนไป update DOM */
  $('a-body').addEventListener('click', function (e) {
    var b = e.target.closest('[data-open]');
    if (b) openDialog(b.getAttribute('data-open'));
  });

  /* ---------- กล่องตรวจสลิป ---------- */
  function dash(v) { return v ? String(v) : '—'; }

  function openDialog(ref) {
    var r = byRef[ref];
    if (!r) return;
    current = r;

    $('d-ref').textContent = r.ref;
    $('d-error').style.display = 'none';
    $('f-reason').hidden = true;
    $('i-reason').value = r.note || '';
    A.clearInvalid($('f-reason'));

    /* สลิปจริงจาก R2 — เสิร์ฟผ่าน endpoint ที่ตรวจสิทธิ์แล้วเท่านั้น bucket ไม่ public */
    var img = $('d-slip-img'), none = $('d-slip-none'), open = $('d-slip-open');
    if (r.hasSlip) {
      var url = A.API.admin.slipUrl(r.ref);
      open.href = url; open.hidden = false;
      if (r.slipType === 'application/pdf') {
        img.hidden = true; img.removeAttribute('src');
        none.hidden = false;
        $('d-slip-why').textContent = 'ไฟล์ PDF — กดปุ่มด้านล่างเพื่อเปิด';
        /* textContent ปลอดภัยอยู่แล้ว ห้ามใส่ esc() ซ้ำ ไม่งั้นชื่อไฟล์ที่มี & จะกลายเป็น &amp; ให้คนอ่าน */
        none.querySelector('.meta').textContent = r.slipName || 'สลิป.pdf';
      } else {
        none.hidden = true;
        img.hidden = false; img.src = url;
      }
    } else {
      img.hidden = true; img.removeAttribute('src');
      open.hidden = true;
      none.hidden = false;
      none.querySelector('.meta').textContent = 'ไม่มีไฟล์สลิป';
      $('d-slip-why').textContent = r.purgedAt ? 'ถูกลบไปแล้วตอนปิดโครงการ' : 'เป็นข้อมูลตัวอย่างที่ seed ไว้';
    }

    /* เงิน */
    $('d-don').textContent = A.baht(r.donation) + ' บาท';
    $('d-shirt-k').textContent = r.shirtQty ? 'ค่าเสื้อ ' + r.shirtQty + ' ตัว' : 'ค่าเสื้อ';
    $('d-shirtamt').textContent = r.shirtQty ? A.baht(r.shirtAmount) + ' บาท' : '—';
    $('d-amt').textContent = A.baht(r.total);
    /* ยอดที่ไม่ลงท้ายด้วย 00 มักถูกอ่านผิดว่าโอนมาผิด — บอกที่มาไว้ก่อนกดตีกลับ */
    $('d-pricenote').hidden = !r.surcharge;
    $('d-pricenote').textContent = 'ยอดนี้รวมส่วนเพิ่มไซส์ใหญ่ ' + A.baht(r.surcharge) +
      ' บาทแล้ว (2XL +20 · 3XL +30 · 4XL +40 · 5XL +50)';
    /* ตารางราคาถูกแก้หลังรายการนี้เข้ามา — ยอดที่เก็บไว้คือยอดที่เรียกเก็บจริง ห้ามแก้ตาม */
    $('d-drift').hidden = !r.priceDrift;
    if (r.priceDrift) {
      $('d-drift-text').textContent =
        'ยอดนี้คิดด้วยตารางราคาชุดที่ ' + r.priceVersion + ' ถ้าคิดด้วยตารางปัจจุบันจะได้ ' +
        A.baht(r.priceDrift.recomputedTotal) + ' บาท — ให้ยึดยอดที่แสดงด้านบน เพราะเป็นยอดที่ผู้บริจาคโอนมาจริง';
    }
    $('d-acc').textContent = (A.config.bank || {}).number || '';
    $('d-time').textContent = A.thDate(r.transferAt);

    /* ผู้บริจาค */
    $('d-name').textContent = dash(r.name);
    $('d-sid').textContent = dash(r.studentId);
    $('d-phone').textContent = dash(r.phone);
    $('d-email').textContent = dash(r.email);
    $('d-line').textContent = dash(r.lineId);

    /* เสื้อและการจัดส่ง */
    $('d-sizes').textContent = r.shirtQty ? r.sizeText + ' (' + r.shirtQty + ' ตัว)' : 'ไม่ได้สั่ง';
    $('d-recipient').textContent = r.shirtQty
      ? (r.recipient || r.name || '—') + (r.recipientPhone ? ' · ' + r.recipientPhone : '') : '—';
    $('d-addr').textContent = r.address ||
      (r.shippedAt ? 'ลบแล้วหลังส่งของ' : (r.shirtQty ? 'ยังไม่มีที่อยู่' : '—'));
    $('d-shipnote').textContent = dash(r.shipNote);

    /* ปุ่มที่ใช้ได้ขึ้นกับสถานะจริง ไม่ใช่โชว์ทุกปุ่มเสมอ */
    var locked = !!r.purgedAt;
    $('d-approve').hidden = locked || r.status === 'verified';
    $('d-reject').hidden = locked || r.status === 'rejected';
    $('d-reopen').hidden = locked || r.status === 'pending';
    $('d-ship').hidden = locked || !(r.status === 'verified' && r.shirtQty > 0 && !r.shippedAt);
    $('d-danger').hidden = locked;
    $('d-danger').open = false;

    dlg.showModal();
  }

  function act(payload, confirmMsg) {
    if (!current) return;
    if (confirmMsg && !confirm(confirmMsg)) return;
    var ref = current.ref;
    A.API.admin.patch(ref, payload).then(function () {
      dlg.close();
      A.toast('บันทึกแล้ว · ' + ref);
      load();
      loadAudit();
    }).catch(function (err) {
      if (err.status === 401) { location.reload(); return; }
      var e = $('d-error');
      e.style.display = 'flex';
      e.innerHTML = A.ICON.alert + '<span>' + A.esc(err.message) + '</span>';
    });
  }

  $('d-close').addEventListener('click', function () { dlg.close(); });
  $('d-cancel').addEventListener('click', function () { dlg.close(); });

  $('d-approve').addEventListener('click', function () { act({ action: 'verify' }); });
  $('d-reopen').addEventListener('click', function () { act({ action: 'reopen' }); });

  $('d-ship').addEventListener('click', function () {
    act({ action: 'ship' },
      'ยืนยันว่าส่งของให้ ' + current.ref + ' แล้ว?\n\n' +
      'ระบบจะลบชื่อผู้รับ เบอร์ และที่อยู่ทิ้งทันทีตามที่สัญญาไว้ในฟอร์มยินยอม\n' +
      'พิมพ์ใบปะหน้าพัสดุให้เรียบร้อยก่อนกด — กดแล้วเอาที่อยู่กลับมาไม่ได้');
  });

  $('d-purge').addEventListener('click', function () {
    act({ action: 'purge' },
      'ลบข้อมูลส่วนบุคคลของ ' + current.ref + ' ถาวร?\n\n' +
      'ชื่อ เบอร์ อีเมล LINE ที่อยู่ และไฟล์สลิปจะถูกลบออกจากระบบจริง ๆ\n' +
      'เหลือไว้แค่รหัสอ้างอิง ยอด และสถานะ · กดแล้วเอากลับมาไม่ได้');
  });

  /* ตีกลับต้องกดสองครั้ง — ครั้งแรกเปิดช่องเหตุผล ครั้งที่สองส่งจริง
     ผู้บริจาคจะเห็นข้อความนี้ในหน้าเช็คสถานะ จึงต้องบังคับให้เขียนอะไรที่อ่านรู้เรื่อง */
  $('d-reject').addEventListener('click', function () {
    var f = $('f-reason');
    if (f.hidden) {
      f.hidden = false;
      $('i-reason').focus();
      A.toast('ระบุเหตุผลก่อน แล้วกด “ตีกลับ” อีกครั้ง');
      return;
    }
    var reason = $('i-reason').value.trim();
    if (reason.length < 5) {
      A.setInvalid(f, 'ระบุเหตุผลอย่างน้อย 5 ตัวอักษร ผู้บริจาคจะเห็นข้อความนี้');
      return;
    }
    A.clearInvalid(f);
    act({ action: 'reject', reason: reason },
      'ตีกลับรายการ ' + current.ref + ' ?\nผู้บริจาคจะเห็นสถานะ “ตรวจไม่ผ่าน” พร้อมเหตุผลที่ระบุ');
  });

  /* ---------- toolbar ---------- */
  $('a-filter').addEventListener('click', function (e) {
    var c = e.target.closest('.chip');
    if (!c) return;
    [].forEach.call($('a-filter').querySelectorAll('.chip'), function (x) {
      x.setAttribute('aria-pressed', String(x === c));
    });
    filter = c.dataset.f;
    load();
  });

  /* หน่วงการค้นไว้ — ทุกตัวอักษรที่พิมพ์คือหนึ่งคำขอไปที่ D1 ถ้าไม่หน่วงจะเปลืองโควตาฟรีเปล่า ๆ */
  $('i-search').addEventListener('input', function (e) {
    q = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 300);
  });

  $('btn-print').addEventListener('click', function () {
    filter = 'shipping';
    [].forEach.call($('a-filter').querySelectorAll('.chip'), function (x) {
      x.setAttribute('aria-pressed', String(x.dataset.f === 'shipping'));
    });
    A.API.admin.orders(filter, q).then(function (res) {
      byRef = {};
      res.orders.forEach(function (r) { byRef[r.ref] = r; });
      $('a-body').innerHTML = res.orders.map(rowHtml).join('');
      $('a-table').hidden = res.orders.length === 0;
      $('a-empty').hidden = res.orders.length !== 0;
      setTimeout(function () { window.print(); }, 120);
    }).catch(function (err) { A.toast('โหลดรายการไม่สำเร็จ: ' + err.message); });
  });

  /* CSV สร้างที่เซิร์ฟเวอร์ — ที่นั่นมีข้อมูลครบและกัน formula injection ไว้แล้ว
     ต่างจากต้นแบบที่ประกอบ CSV ในเบราว์เซอร์จากข้อมูลเท่าที่หน้านั้นมี */
  $('btn-csv').addEventListener('click', function () {
    location.href = A.API.admin.exportUrl(filter);
    A.toast('กำลังดาวน์โหลด CSV ของมุมมอง “' + filter + '”');
  });

  A.ready(function () { checkSession(); });
})();
