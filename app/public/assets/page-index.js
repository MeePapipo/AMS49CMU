/* หน้าแรก — ยอดรวมและบัญชีสาธารณะ
   ข้อมูลมาจาก /api/stats ซึ่งส่งกลับเฉพาะ เวลา · รหัส · สถานะ · ยอด
   ชื่อ เบอร์ ที่อยู่ ไม่เคยออกมาถึงหน้านี้ ไม่ว่าจะเปิด DevTools ดูก็ตาม */
(function () {
  'use strict';
  var A = window.AMS;
  var $ = function (id) { return document.getElementById(id); };
  var filter = 'all';
  var data = null;

  function renderLedger() {
    if (!data) return;
    var rows = data.ledger.filter(function (r) { return filter === 'all' || r.status === filter; });

    $('ledger-body').innerHTML = rows.map(function (r) {
      /* r.note คือข้อความที่แอดมินพิมพ์เอง แล้วมาโผล่บนหน้าสาธารณะ — ต้อง esc() เสมอ
         ไม่งั้นแท็ก HTML ในเหตุผลตีกลับจะถูกรันเป็นโค้ดบนเครื่องคนที่เปิดหน้าแรก */
      var note = r.status === 'rejected' && r.note
        ? '<div class="meta" style="color:var(--reject-fg)">' + A.esc(r.note) + '</div>' : '';
      var shirt = r.shirtQty
        ? ' <span class="badge badge-shirt" title="สั่งเสื้อรุ่น ' + r.shirtQty + ' ตัว">' +
          A.ICON.shirt + 'เสื้อ ' + r.shirtQty + ' ตัว</span>'
        : '';
      /* แยกให้เห็นสองก้อนเสมอเมื่อมีเสื้อ ไม่งั้นยอดรวมจะดูเหมือนเงินบริจาคทั้งก้อน */
      var split = r.shirtQty
        ? '<div class="meta">บริจาค ' + A.baht(r.donation) + ' + เสื้อ ' + A.baht(r.shirtAmount) + '</div>'
        : '';
      return '<tr>' +
        '<td class="c-time">' + A.esc(A.thDate(r.transferAt)) + '</td>' +
        '<td class="c-ref">' + A.esc(r.ref) + '</td>' +
        '<td class="c-status">' + A.badge(r.status) + shirt + note + '</td>' +
        '<td class="c-amount">' + A.baht(r.total) + split + '</td>' +
        '</tr>';
    }).join('');

    $('ledger-box').hidden = rows.length === 0;
    $('ledger-empty').hidden = rows.length !== 0;
  }

  function render(animate) {
    var st = data.stats;

    var totalEl = $('total');
    if (animate) A.countUp(totalEl, st.donation); else totalEl.textContent = A.baht(st.donation);

    /* ไม่ประกาศตัวเลขเป้าหมายบนหน้าเว็บ แถบนี้จึงเป็นตัวบอกความคืบหน้าเฉย ๆ */
    var pct = st.goal ? Math.min(100, Math.round(st.donation / st.goal * 100)) : 0;
    $('meter').style.width = pct + '%';
    $('meter-wrap').setAttribute('aria-label',
      'เงินบริจาคที่ยืนยันแล้ว ' + A.baht(st.donation) + ' บาท');

    $('shirt-rev').textContent = A.baht(st.shirtRevenue);
    $('shirt-n').textContent = st.shirts ? '(' + st.shirts + ' ตัว)' : '';

    $('s-pending').textContent = A.baht(st.pending);
    $('s-pending-c').textContent = st.pendingCount + ' รายการรอกรรมการตรวจสลิป';
    $('s-count').textContent = A.baht(st.verifiedCount);
    $('s-shirt').textContent = A.baht(st.shirts);
    $('shirt-badge').innerHTML = A.ICON.shirt + 'ของที่ระลึก';

    $('ledger-loading').hidden = true;
    renderLedger();
  }

  A.ready(function (cfg) {
    /* นับถอยหลังถึงวันงาน — วันที่มาจาก config ฝั่งเซิร์ฟเวอร์ ไม่ได้ฝังในไฟล์นี้ */
    var target = new Date(cfg.eventDate + 'T00:00:00');
    var days = Math.ceil((target - new Date()) / 86400000);
    $('countdown').textContent = days > 0 ? ' · อีก ' + days + ' วัน' : ' · จัดไปแล้ว';

    /* ผูกตัวกรองเฉพาะกลุ่มของตัวเอง ไม่ใช่ .chip ทุกตัวในหน้า
       (ต้นแบบกวาดทั้งหน้า ซึ่งรอดเพราะบังเอิญมีชุดเดียว) */
    var group = $('ledger-filter');
    group.addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      [].forEach.call(group.querySelectorAll('.chip'), function (x) {
        x.setAttribute('aria-pressed', String(x === c));
      });
      filter = c.dataset.filter;
      renderLedger();
    });

    A.API.stats().then(function (res) {
      data = res;
      render(true);
    }).catch(function (err) {
      $('ledger-loading').hidden = true;
      $('ledger-box').hidden = true;
      $('ledger-empty').hidden = false;
      $('ledger-empty').innerHTML =
        '<h3>โหลดรายการไม่สำเร็จ</h3><p>' + A.esc(err.message) + '</p>';
      A.toast('โหลดยอดจากเซิร์ฟเวอร์ไม่สำเร็จ');
    });
  });
})();
