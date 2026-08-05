/* ============================================================================
   Wizard 4 ขั้น — เลือกของ → ข้อมูล → โอน → แนบสลิป

   ความต่างสำคัญจากต้นแบบ:
   ยอดที่แสดงบนขั้น "โอน" และขั้น "แนบสลิป" มาจาก POST /api/quote เสมอ
   ไม่ใช่เลขคณิตในไฟล์นี้ ฟังก์ชัน preview() มีไว้ให้เห็นยอดขยับตอนกดเลือกไซส์เท่านั้น
   ถ้าขอยอดจากเซิร์ฟเวอร์ไม่ได้ หน้าจะขึ้นกล่องแดงและไม่แสดงตัวเลขใด ๆ
   เพราะหน้าที่คนกำลังจะโอนเงินต้องไม่มีวันเห็นเลขที่เราไม่แน่ใจว่าถูก
   ========================================================================= */
(function () {
  'use strict';
  var A = window.AMS;
  var $ = function (id) { return document.getElementById(id); };

  var ORDER = ['order', 'info', 'pay', 'slip'];
  var step = 'order';
  var maxIdx = 0;          // ขั้นไกลสุดที่ผ่านการตรวจมาแล้ว — ใช้ปลดล็อกปุ่มบนแถบขั้นตอน
  var slipFile = null;
  var submitting = false;
  var submitted = false;
  var qtyEl, MAXBYTES;

  /* ยอดจากเซิร์ฟเวอร์ + กุญแจของสิ่งที่ใช้ขอ — ถ้าผู้ใช้แก้ของ กุญแจเปลี่ยน ยอดเดิมใช้ไม่ได้ */
  var quote = null;
  var quoteKey = '';
  var quoteBusy = false;

  var ERROR_FIELD_MAP = {
    name: 'f-name', phone: 'f-phone', studentId: 'f-sid', email: 'f-email',
    recipient: 'f-rname', recipientPhone: 'f-rphone',
    addrLine: 'f-addr', province: 'f-prov', zip: 'f-zip',
    transferAt: 'f-time', slip: 'f-slip'
  };
  /* ฟิลด์ไหนอยู่ขั้นไหน — ใช้พาผู้ใช้ไปยังขั้นที่มีช่องผิดจริง ๆ */
  var FIELD_STEP = {
    name: 'info', phone: 'info', studentId: 'info', email: 'info',
    recipient: 'info', recipientPhone: 'info', addrLine: 'info', province: 'info',
    zip: 'info', consent: 'info', transferAt: 'slip', slip: 'slip'
  };

  /* ---------- อ่านค่าจากฟอร์ม ---------- */
  function val(id) { return ($(id).value || '').trim(); }
  function digits(id) { return ($(id).value || '').replace(/[^0-9]/g, ''); }

  function inputs() {
    var q = A.readQtyPicker(qtyEl);
    return { counts: q.counts, donation: parseInt(digits('i-donation'), 10) || 0 };
  }
  function keyOf(i) { return JSON.stringify([i.counts, i.donation]); }

  /* ยอดสำหรับแสดงระหว่างกรอกเท่านั้น (rail + แถบล่างจอ) */
  function preview() {
    var i = inputs();
    return A.previewOrder(i.counts, i.donation);
  }

  /* ---------- สรุปยอด ---------- */
  function lines(o) {
    var s = '';
    if (o.qty) {
      /* เลิกเขียน "× 500" — ราคาต่อตัวไม่เท่ากันแล้ว บอกส่วนเพิ่มรวมแทนจะตรงกว่า */
      s += '<dt>เสื้อรุ่น ' + o.qty + ' ตัว' +
           (o.surcharge ? '<br><span class="meta">รวมส่วนเพิ่มไซส์ใหญ่ ' + A.baht(o.surcharge) + ' บาท</span>' : '') +
           '</dt><dd>' + A.baht(o.shirtAmount) + '</dd>';
    }
    s += '<dt>เงินบริจาคให้คณะฯ</dt><dd>' + A.baht(o.donation) + '</dd>';
    return s;
  }

  function renderSummary() {
    var o = preview();

    $('rail-list').innerHTML = lines(o);
    $('rail-total').textContent = A.baht(o.total);
    $('rail-sizes').textContent = o.qty ? 'ไซส์ ' + A.sizeSummary(o.sizes) : 'ยังไม่ได้เลือกเสื้อ';
    $('bar-amount').textContent = A.baht(o.total);

    /* สั่งเยอะไม่ผิด แต่ต้องให้กรรมการรู้ตัวก่อนสั่งผลิต */
    $('bulk-note').hidden = o.qty <= A.config.bulkHint;
    $('bulk-n').textContent = o.qty;

    /* ไม่มีเสื้อ = ไม่มีของต้องส่ง = ไม่ถามที่อยู่ */
    $('ship-panel').hidden = o.qty === 0;
    $('no-ship-note').hidden = o.qty > 0;
    $('ship-qty').textContent = o.qty + ' ตัว · ' + A.sizeSummary(o.sizes);

    /* ปุ่มยอดด่วนติดไฟเมื่อค่าตรงกับที่พิมพ์อยู่ */
    [].forEach.call($('amount-quick').querySelectorAll('.chip'), function (c) {
      c.setAttribute('aria-pressed', String(Number(c.getAttribute('data-amt')) === o.donation));
    });

    /* ของเปลี่ยน = ยอดที่เซิร์ฟเวอร์เคยให้ไว้ใช้ไม่ได้อีก */
    if (quoteKey && quoteKey !== keyOf(inputs())) {
      quote = null;
      renderQuote();
    }
  }

  /* ---------- ยอดจากเซิร์ฟเวอร์ ---------- */
  function renderQuote() {
    var has = !!quote;
    $('pay-total').textContent = has ? A.baht(quote.total) : (quoteBusy ? 'กำลังคิด…' : '—');
    $('pay-total-2').textContent = has ? A.baht(quote.total) : '—';
    $('slip-total').textContent = has ? A.baht(quote.total) : '—';
    $('copy-total').setAttribute('data-copy', has ? String(quote.total) : '');
    $('copy-total').disabled = !has;
    $('pay-break').textContent = !has ? ''
      : (quote.qty ? 'เสื้อ ' + quote.qty + ' ตัว ' + A.baht(quote.shirtAmount) +
                     ' + บริจาค ' + A.baht(quote.donation)
                   : 'เงินบริจาคทั้งก้อน');
    $('pay-recap').innerHTML = !has ? '' :
      lines(quote) + (quote.qty ? '<dt>ไซส์</dt><dd>' + A.esc(quote.sizeText) + '</dd>' : '');
  }

  function refreshQuote() {
    var i = inputs();
    var key = keyOf(i);
    if (quote && quoteKey === key) return Promise.resolve(quote);

    quoteBusy = true;
    $('quote-error').hidden = true;
    renderQuote();

    return A.API.quote(i.counts, i.donation).then(function (res) {
      quoteBusy = false;
      quote = res;
      quoteKey = key;
      renderQuote();
      return res;
    }).catch(function (err) {
      quoteBusy = false;
      quote = null;
      renderQuote();
      $('quote-error-msg').textContent = err.message;
      $('quote-error').hidden = false;
      throw err;
    });
  }

  /* ---------- ไม่มีการบันทึกร่างลงเครื่อง ----------
     ถอดออกตามที่ผู้จัดงานสั่ง (5 ส.ค. 2569) — เดิมฟอร์มเก็บสิ่งที่กรอกไว้ใน localStorage
     แล้วกู้กลับให้พร้อมแบนเนอร์ตอนเปิดหน้าใหม่

     ผลที่ตามมาที่ต้องรับรู้: ปิดแท็บหรือรีเฟรชระหว่างกรอก = ข้อมูลหายหมด ต้องกรอกใหม่
     ชดเชยด้วยสองอย่าง — เตือนก่อนออกจากหน้าเมื่อกรอกไปแล้ว (ดู beforeunload ท้ายไฟล์)
     และแก้ข้อความในขั้น "โอนยอดรวม" ไม่ให้สัญญาว่าข้อมูลไม่หายอีกต่อไป */

  /* ---------- ตรวจความครบถ้วนฝั่งหน้าเว็บ ----------
     กติกาชุดเดียวกับ functions/lib/validate.ts — ที่นี่มีไว้ให้ผู้ใช้เห็นทันที
     ส่วนคนที่ยิง API ตรง ๆ จะเจอด่านของเซิร์ฟเวอร์อยู่ดี */
  function focusBad(el) {
    if (!el) return;
    var f = el.querySelector('.input,.textarea,input,select') || el;
    try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function validOrder(report) {
    var o = preview(), ok = true, bad = null;
    var e = $('err-qty');
    if (!o.qty && !o.donation) {
      ok = false;
      if (report) {
        e.style.display = 'flex';
        e.innerHTML = A.ICON.alert +
          '<span>ยังไม่ได้เลือกอะไรเลย — ใส่จำนวนเสื้ออย่างน้อย 1 ตัว หรือระบุยอดบริจาค</span>';
        bad = $('qty');
      }
    } else if (report) { e.style.display = 'none'; }
    if (report && bad) { A.toast('ยังกรอกไม่ครบ'); focusBad(bad); }
    return ok;
  }

  function validInfo(report) {
    var o = preview(), ok = true, bad = null;
    function ck(fid, cond, msg) {
      var f = $(fid);
      if (cond) { A.clearInvalid(f); }
      else { ok = false; if (report) A.setInvalid(f, msg); bad = bad || f; }
    }
    ck('f-name', val('i-name').length >= 3, 'กรอกชื่อ–นามสกุลให้ครบ');
    ck('f-phone', /^0\d{8,9}$/.test(digits('i-phone')), 'เบอร์โทร 9–10 หลัก ขึ้นต้นด้วย 0');
    ck('f-sid', !val('i-sid') || /^\d{8,10}$/.test(digits('i-sid')), 'รหัสนักศึกษาเป็นตัวเลข 8–10 หลัก หรือเว้นว่างไว้');
    ck('f-email', !val('i-email') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val('i-email')), 'รูปแบบอีเมลไม่ถูกต้อง หรือเว้นว่างไว้');

    if (o.qty > 0) {
      ck('f-rname', val('i-rname').length >= 3, 'กรอกชื่อผู้รับ');
      ck('f-rphone', /^0\d{8,9}$/.test(digits('i-rphone')), 'เบอร์ผู้รับ 9–10 หลัก ขึ้นต้นด้วย 0');
      ck('f-addr', val('i-addr').length >= 10, 'ที่อยู่สั้นเกินไป ใส่ให้ครบถึงตำบล/แขวง');
      ck('f-prov', val('i-prov').length >= 2, 'กรอกจังหวัด');
      ck('f-zip', /^\d{5}$/.test(digits('i-zip')), 'รหัสไปรษณีย์ต้องเป็นเลข 5 หลัก');
    }

    var ce = $('err-consent');
    if ($('i-consent').checked) { ce.style.display = 'none'; }
    else {
      ok = false;
      if (report) {
        ce.style.display = 'flex';
        ce.innerHTML = A.ICON.alert + '<span>ต้องยินยอมก่อนจึงจะไปต่อได้</span>';
      }
      bad = bad || $('i-consent').closest('.panel');
    }

    if (report && bad) { A.toast('ยังกรอกไม่ครบ — ดูช่องที่ขึ้นสีแดง'); focusBad(bad); }
    return ok;
  }

  /* ---------- เดินขั้น ---------- */
  function go(name, opts) {
    opts = opts || {};
    step = name;
    ORDER.concat(['done']).forEach(function (k) { $('step-' + k).hidden = k !== name; });

    var cur = ORDER.indexOf(name);
    var done = name === 'done';
    [].forEach.call($('stepper').children, function (li, i) {
      var btn = li.querySelector('button');
      li.setAttribute('data-done', String(done || i < cur));
      if (!done && i === cur) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
      btn.disabled = done || i > maxIdx;
    });

    $('summary-rail').hidden = done;
    $('bar').hidden = done;
    $('bar-btn').textContent =
      name === 'pay' ? 'ไปแนบสลิป' : (name === 'slip' ? 'ส่งตรวจสอบ' : 'ถัดไป');

    if (opts.hash !== false && location.hash.replace('#', '') !== name) {
      location.hash = '#' + name;
    }
    if (!opts.quiet) {
      var h = $('h-' + name);
      if (h) { try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); } }
      window.scrollTo({
        top: Math.max(0, $('stepper').getBoundingClientRect().top + window.pageYOffset - 76),
        behavior: 'smooth'
      });
    }
    if (name === 'pay' || name === 'slip') refreshQuote().catch(function () {});
    if (name === 'slip') mountTurnstile();
  }

  /* ไปข้างหน้าได้ก็ต่อเมื่อขั้นก่อนหน้าครบจริง — ตรวจย้อนทุกขั้น ไม่ใช่แค่ขั้นติดกัน
     เพราะผู้ใช้กดแถบขั้นตอนย้อนไปลบของออกแล้วกดหน้าต่อได้ */
  function tryGo(next) {
    if (next !== 'order' && !validOrder(false)) { go('order'); validOrder(true); return; }
    if ((next === 'pay' || next === 'slip') && !validInfo(false)) { go('info'); validInfo(true); return; }
    if (next === 'info' && !validOrder(true)) return;
    if (next === 'pay' && !validInfo(true)) return;

    /* จะไปขั้นแนบสลิปได้ต้องมียอดจากเซิร์ฟเวอร์อยู่ในมือแล้ว
       ไม่งั้นผู้ใช้จะเห็น "—" ตรงยอดที่ต้องมีในสลิป ซึ่งอ่านไม่รู้เรื่อง */
    if (next === 'slip' && !quote) {
      refreshQuote().then(function () {
        maxIdx = Math.max(maxIdx, ORDER.indexOf('slip'));
        go('slip');
      }).catch(function () {
        A.toast('ยังขอยอดจากเซิร์ฟเวอร์ไม่ได้ — ลองใหม่อีกครั้ง');
      });
      return;
    }

    maxIdx = Math.max(maxIdx, ORDER.indexOf(next));
    go(next);
  }

  /* ---------- Turnstile ---------- */
  var turnstileWidget = null;
  function mountTurnstile() {
    var cfg = A.config.turnstile;
    if (!cfg || !cfg.siteKey || turnstileWidget !== null) return;
    var slot = $('turnstile-slot');
    slot.hidden = false;
    turnstileWidget = 'pending';
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = function () {
      turnstileWidget = window.turnstile.render(slot, { sitekey: cfg.siteKey, theme: 'light' });
    };
    s.onerror = function () {
      turnstileWidget = null;
      slot.innerHTML = '<p class="err" style="display:flex">' + A.ICON.alert +
        '<span>โหลดตัวยืนยันว่าไม่ใช่บอทไม่ได้ ลองปิดตัวบล็อกโฆษณาแล้วโหลดหน้าใหม่</span></p>';
    };
    document.head.appendChild(s);
  }
  function turnstileToken() {
    if (!A.config.turnstile || !window.turnstile || turnstileWidget === 'pending') return '';
    try { return window.turnstile.getResponse(turnstileWidget) || ''; } catch (e) { return ''; }
  }
  function turnstileReset() {
    try { if (window.turnstile && turnstileWidget) window.turnstile.reset(turnstileWidget); } catch (e) {}
  }

  /* ---------- สลิป ---------- */
  function setSlip(file) {
    var f = $('f-slip');
    if (!file) {
      slipFile = null;
      $('drop').dataset.state = 'empty';
      $('drop-empty').hidden = false;
      $('drop-filled').hidden = true;
      return;
    }
    var okType = /^image\/(png|jpeg|webp)$/.test(file.type) || file.type === 'application/pdf';
    if (!okType) {
      $('drop').dataset.state = 'error';
      A.setInvalid(f, 'ไฟล์ต้องเป็น JPG, PNG, WEBP หรือ PDF เท่านั้น'); return;
    }
    if (file.size > MAXBYTES) {
      $('drop').dataset.state = 'error';
      A.setInvalid(f, 'ไฟล์ใหญ่เกิน 5 MB (ไฟล์นี้ ' + (file.size / 1048576).toFixed(1) + ' MB) ลองถ่ายภาพหน้าจอแทน');
      return;
    }
    A.clearInvalid(f);
    slipFile = file;
    $('drop').dataset.state = 'filled';
    $('drop-empty').hidden = true;
    $('drop-filled').hidden = false;
    $('drop-name').textContent = file.name;
    $('drop-size').textContent = (file.size / 1024).toFixed(0) + ' KB · แนบแล้ว';
    var img = $('drop-img');
    if (file.type === 'application/pdf') { img.style.display = 'none'; img.removeAttribute('src'); }
    else {
      /* คืน object URL ของไฟล์ก่อนหน้า ไม่งั้นเปลี่ยนไฟล์หลายรอบแล้วหน่วยความจำค้าง */
      if (img._url) URL.revokeObjectURL(img._url);
      img._url = URL.createObjectURL(file);
      img.style.display = ''; img.src = img._url;
    }
  }

  /* ---------- ส่ง ---------- */
  function showSubmitError(msg) {
    var e = $('err-submit');
    e.style.display = 'flex';
    e.innerHTML = A.ICON.alert + '<span>' + A.esc(msg) + '</span>';
  }

  function submit() {
    if (submitting || submitted) return;

    if (!validOrder(false)) { go('order'); validOrder(true); return; }
    if (!validInfo(false)) { go('info'); validInfo(true); return; }

    var bad = null;
    if ($('i-time').value) A.clearInvalid($('f-time'));
    else { A.setInvalid($('f-time'), 'เลือกวันและเวลาที่โอนตามสลิป'); bad = $('f-time'); }
    if (slipFile) A.clearInvalid($('f-slip'));
    else { A.setInvalid($('f-slip'), 'ต้องแนบสลิปการโอน'); bad = bad || $('f-slip'); }
    if (bad) { A.toast('ยังกรอกไม่ครบ — ดูช่องที่ขึ้นสีแดง'); focusBad(bad); return; }

    if (!quote) {
      showSubmitError('ยังไม่มียอดจากเซิร์ฟเวอร์ กรุณากลับไปขั้น “โอนยอดรวม” แล้วลองใหม่');
      return;
    }
    if (A.config.turnstile && !turnstileToken()) {
      showSubmitError('กรุณารอให้ตัวยืนยันว่าไม่ใช่บอททำงานเสร็จก่อน แล้วกดส่งอีกครั้ง');
      return;
    }

    /* กันกดซ้ำ — ต้นแบบตั้งแค่ data-loading แต่ไม่ disabled ปุ่ม
       กดรัวระหว่างรอเซิร์ฟเวอร์จึงได้สองรายการ ซึ่งบนของจริงคือสองแถวในฐานข้อมูล */
    submitting = true;
    var btn = $('btn-submit');
    btn.disabled = true;
    btn.dataset.loading = 'true';
    var label = btn.querySelector('span:last-child');
    var labelWas = label.textContent;
    label.textContent = 'กำลังส่ง…';
    $('err-submit').style.display = 'none';

    var i = inputs();
    var fd = new FormData();
    fd.append('counts', JSON.stringify(i.counts));
    fd.append('donation', String(i.donation));
    fd.append('clientTotal', String(quote.total));   // ให้เซิร์ฟเวอร์เทียบว่าเห็นเลขเดียวกันไหม
    fd.append('name', val('i-name'));
    fd.append('studentId', digits('i-sid'));
    fd.append('phone', digits('i-phone'));
    fd.append('email', val('i-email'));
    fd.append('lineId', val('i-line'));
    fd.append('recipient', val('i-rname'));
    fd.append('recipientPhone', digits('i-rphone'));
    fd.append('addrLine', val('i-addr'));
    fd.append('province', val('i-prov'));
    fd.append('zip', digits('i-zip'));
    fd.append('shipNote', val('i-shipnote'));
    fd.append('transferAt', $('i-time').value);
    fd.append('consent', String($('i-consent').checked));
    fd.append('turnstileToken', turnstileToken());
    fd.append('slip', slipFile, slipFile.name);

    A.API.submit(fd).then(function (res) {
      submitted = true;
      showDone(res);
    }).catch(function (err) {
      turnstileReset();

      if (err.code === 'total_mismatch') {
        quote = null; quoteKey = '';
        showSubmitError(err.message);
        go('pay');
        return;
      }
      if (err.code === 'invalid' && err.data && err.data.errors) {
        var first = A.applyServerErrors(err.data.errors, ERROR_FIELD_MAP);
        var target = FIELD_STEP[err.data.errors[0].field] || 'info';
        if (err.data.errors[0].field === 'consent') {
          $('err-consent').style.display = 'flex';
          $('err-consent').innerHTML = A.ICON.alert + '<span>' + A.esc(err.data.errors[0].message) + '</span>';
        }
        go(target);
        focusBad(first);
        A.toast('ข้อมูลยังไม่ครบ — ดูช่องที่ขึ้นสีแดง');
        return;
      }
      showSubmitError(err.message);
      A.toast('ส่งไม่สำเร็จ');
    }).then(function () {
      submitting = false;
      if (!submitted) {
        btn.disabled = false;
        btn.dataset.loading = 'false';
        label.textContent = labelWas;
      }
    });
  }

  function showDone(res) {
    $('done-ref').textContent = res.ref;
    $('done-copy').setAttribute('data-copy', res.ref);
    A.bindCopy($('step-done'));
    $('done-recap').innerHTML =
      (res.shirtQty
        ? '<dt>เสื้อรุ่น ' + res.shirtQty + ' ตัว</dt><dd>' + A.baht(res.shirtAmount) + ' บาท</dd>' +
          '<dt>ไซส์</dt><dd>' + A.esc(A.sizeSummary(res.sizes)) + '</dd>'
        : '') +
      '<dt>เงินบริจาค</dt><dd>' + A.baht(res.donation) + ' บาท</dd>' +
      '<dt>ยอดที่โอน</dt><dd><strong>' + A.baht(res.total) + ' บาท</strong></dd>' +
      '<dt>เวลาโอน</dt><dd>' + A.esc(A.thDate(res.transferAt)) + '</dd>' +
      '<dt>สถานะ</dt><dd>' + A.badge('pending') + '</dd>';
    $('done-status-link').href = '/status?ref=' + encodeURIComponent(res.ref);

    go('done', { hash: false });
    history.replaceState(null, '', location.pathname);
    A.toast('บันทึกแล้ว · รหัสอ้างอิง ' + res.ref);
  }

  /* ---------- ผู้รับ = ผู้บริจาค ----------
     เป็นตัวเลือกค้างสถานะ ไม่ใช่ปุ่มคัดลอกครั้งเดียว — ติ๊กไว้แล้วช่องผู้รับจะล็อกและ
     ตามค่าผู้บริจาคตลอด ถ้าเป็นปุ่มคัดลอก ผู้ใช้ที่ย้อนกลับไปแก้ชื่อตัวเองจะเหลือชื่อเก่าค้าง
     ในช่องผู้รับโดยไม่มีอะไรเตือน แล้วพัสดุจะจ่าหน้าผิด */
  function applySame() {
    var on = $('same-as-donor').checked;
    $('i-rname').readOnly = on;
    $('i-rphone').readOnly = on;
    $('h-rname').textContent = on
      ? 'ล็อกตามข้อมูลผู้บริจาค — เอาเครื่องหมายถูกออกถ้าต้องการส่งให้คนอื่น'
      : 'ชื่อที่จะให้ขนส่งเรียกตอนเข้าส่ง';
    if (on) {
      $('i-rname').value = val('i-name');
      $('i-rphone').value = digits('i-phone');
      A.clearInvalid($('f-rname'));
      A.clearInvalid($('f-rphone'));
    }
  }

  /* ---------- เริ่ม ---------- */
  function init(cfg) {
    MAXBYTES = cfg.maxSlipBytes;
    qtyEl = $('qty');
    A.buildQtyPicker(qtyEl, {});

    /* เลขบัญชีมาจากเซิร์ฟเวอร์ ไม่ได้ฝังใน HTML — แก้ที่ pricing.ts ที่เดียว */
    var bank = cfg.bank || {};
    $('bank-branch').textContent = bank.bank + ' ' + bank.branch;
    $('acc-val').textContent = bank.number;
    $('acc-plain').textContent = bank.numberPlain;
    $('copy-acc').setAttribute('data-copy', bank.numberPlain);
    $('copy-acc').setAttribute('aria-label', 'คัดลอกเลขที่บัญชี ' + bank.number);
    $('acc-name').textContent = bank.name;
    $('copy-accname').setAttribute('data-copy', bank.name);
    A.bindCopy($('step-pay'));

    /* ---- ผูก input ทั้งหน้าเข้ากับการคำนวณและร่าง ---- */
    function sync() { renderSummary(); }
    qtyEl.addEventListener('qtychange', sync);
    $('wiz-col').addEventListener('input', sync);
    $('wiz-col').addEventListener('change', sync);

    $('i-donation').addEventListener('focus', function () { if (this.value === '0') this.value = ''; });
    $('i-donation').addEventListener('blur', function () {
      this.value = String(parseInt(digits('i-donation'), 10) || 0);
      sync();
    });
    $('i-consent').addEventListener('change', function () {
      if (this.checked) $('err-consent').style.display = 'none';
    });

    $('amount-quick').addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      $('i-donation').value = c.getAttribute('data-amt');
      sync();
    });

    $('same-as-donor').addEventListener('change', function () {
      applySame();
      if (!this.checked) $('i-rname').focus();
      sync();
    });
    /* ผู้บริจาคกลับมาแก้ชื่อ/เบอร์ทีหลัง ช่องผู้รับต้องตามไปด้วยทันที
       ผูกที่ช่องโดยตรงเพื่อให้ทำงานก่อน listener รวมบน #wiz-col ที่เป็นตัวบันทึกร่าง */
    ['i-name', 'i-phone'].forEach(function (id) {
      $(id).addEventListener('input', function () { if ($('same-as-donor').checked) applySame(); });
    });

    /* ---- เดินขั้น ---- */
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-next],[data-back]') : null;
      if (!el) return;
      var n = el.getAttribute('data-next');
      if (n) tryGo(n); else go(el.getAttribute('data-back'));
    });

    [].forEach.call($('stepper').querySelectorAll('button'), function (btn, i) {
      btn.addEventListener('click', function () {
        if (i <= ORDER.indexOf(step)) go(ORDER[i]); else tryGo(ORDER[i]);
      });
    });

    $('bar-btn').addEventListener('click', function () {
      if (step === 'slip') { submit(); return; }
      tryGo(ORDER[ORDER.indexOf(step) + 1]);
    });

    window.addEventListener('hashchange', function () {
      var h = location.hash.replace('#', '');
      if (!h || h === step || submitted || ORDER.indexOf(h) === -1) return;
      if (ORDER.indexOf(h) > maxIdx) { location.hash = '#' + step; return; }
      go(h, { hash: false });
    });

    $('quote-retry').addEventListener('click', function () { refreshQuote().catch(function () {}); });

    /* ---- สลิป ---- */
    $('drop').addEventListener('click', function (e) { if (e.target.id !== 'drop-clear') $('i-slip').click(); });
    $('drop').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('i-slip').click(); }
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      $('drop').addEventListener(ev, function (e) {
        e.preventDefault(); if ($('drop').dataset.state !== 'filled') $('drop').dataset.state = 'over';
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      $('drop').addEventListener(ev, function (e) {
        e.preventDefault(); if ($('drop').dataset.state === 'over') $('drop').dataset.state = 'empty';
      });
    });
    $('drop').addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) setSlip(e.dataTransfer.files[0]); });
    $('i-slip').addEventListener('change', function () { setSlip($('i-slip').files[0]); });
    $('drop-clear').addEventListener('click', function (e) {
      e.stopPropagation(); $('i-slip').value = ''; setSlip(null);
    });

    $('btn-submit').addEventListener('click', submit);

    /* ค่าเริ่มต้นของเวลาโอน = ตอนนี้ คนส่วนใหญ่แนบสลิปทันทีหลังโอน */
    $('i-time').value = A.localNowInput();

    /* เริ่มที่ขั้นแรกเสมอ — ไม่มีข้อมูลเก่าให้กู้ จึง deep-link เข้าขั้นหลังไม่ได้ */
    renderSummary();
    go('order', { hash: false, quiet: true });
    if (location.hash) history.replaceState(null, '', location.pathname);

    /* ไม่มีการบันทึกร่างแล้ว ปิดแท็บหรือรีเฟรช = กรอกใหม่ทั้งหมด
       จึงต้องเตือนก่อนออก เฉพาะตอนที่กรอกอะไรไปแล้วจริง ๆ และยังไม่ได้ส่ง
       (เบราว์เซอร์แสดงข้อความมาตรฐานของตัวเอง ไม่ใช่ข้อความนี้ แต่ต้องคืนค่าอะไรสักอย่าง) */
    window.addEventListener('beforeunload', function (e) {
      if (submitted) return;
      var i = inputs();
      var touched = i.donation > 0 || Object.keys(i.counts).length > 0 ||
        val('i-name') !== '' || digits('i-phone') !== '';
      if (!touched) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  A.ready(init);
})();
