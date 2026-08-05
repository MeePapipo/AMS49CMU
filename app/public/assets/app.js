/* ==========================================================================
   AMS49 CMU Reunion — runtime ฝั่งเบราว์เซอร์

   ต่างจากต้นแบบตรงที่ไม่มี Store ใน localStorage อีกแล้ว
   ข้อมูลทุกอย่างมาจาก API และ **ยอดเงินทุกบาทคำนวณที่เซิร์ฟเวอร์**
   เลขที่คิดในไฟล์นี้ (previewOrder) มีไว้แสดงระหว่างกรอกเท่านั้น
   ก่อนถึงขั้นโอน หน้าเว็บจะไปขอยอดจริงจาก /api/quote เสมอ

   สิ่งเดียวที่ยังเก็บในเครื่องคือ "ร่างฟอร์มที่กรอกค้างไว้" ซึ่งถูกต้องแล้ว
   เพราะเป็นของส่วนตัวที่ยังไม่ควรขึ้นเซิร์ฟเวอร์
   ========================================================================== */
(function () {
  'use strict';

  var ASSET_VERSION = '1';

  /* --- API ------------------------------------------------------------------
     ทุก endpoint ตอบ JSON หน้าตาเดียวกัน { ok, ... } หรือ { ok:false, code, message }
     ApiError จึงพก code มาให้หน้าเว็บแยกกรณีได้ โดยไม่ต้องเทียบข้อความภาษาไทย */
  function ApiError(status, code, message, data) {
    var e = new Error(message || 'เกิดข้อผิดพลาด');
    e.name = 'ApiError';
    e.status = status; e.code = code || 'error'; e.data = data || {};
    return e;
  }

  function request(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opts.json !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(opts.json);
    } else if (opts.body) {
      init.body = opts.body; // FormData — ปล่อยให้เบราว์เซอร์ตั้ง boundary เอง
    }
    if (opts.signal) init.signal = opts.signal;

    return fetch(path, init).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      if (ct.indexOf('application/json') === -1) {
        if (res.ok) return res;
        throw ApiError(res.status, 'http_' + res.status, 'เซิร์ฟเวอร์ตอบกลับผิดปกติ (' + res.status + ')');
      }
      return res.json().then(function (data) {
        if (!res.ok || data.ok === false) {
          throw ApiError(res.status, data.code, data.message, data);
        }
        return data;
      });
    }, function (err) {
      /* fetch จะ reject เมื่อเน็ตหลุด ไม่ใช่เมื่อเซิร์ฟเวอร์ตอบ error
         ข้อความจึงต้องต่างกัน ไม่งั้นคนเน็ตหลุดจะไปนั่งแก้ฟอร์มเปล่า ๆ */
      if (err && err.name === 'ApiError') throw err;
      if (err && err.name === 'AbortError') throw err;
      throw ApiError(0, 'network', 'ต่ออินเทอร์เน็ตไม่ได้ ตรวจสัญญาณแล้วลองใหม่อีกครั้ง');
    });
  }

  var API = {
    config: function () { return request('/api/config'); },
    stats: function () { return request('/api/stats'); },
    status: function (ref) { return request('/api/status/' + encodeURIComponent(ref)); },
    quote: function (counts, donation) {
      return request('/api/quote', { method: 'POST', json: { counts: counts, donation: donation } });
    },
    submit: function (formData) { return request('/api/orders', { method: 'POST', body: formData }); },
    admin: {
      me: function () { return request('/api/admin/me'); },
      login: function (user, password) {
        return request('/api/admin/login', { method: 'POST', json: { user: user, password: password } });
      },
      logout: function () { return request('/api/admin/logout', { method: 'POST', json: {} }); },
      orders: function (filter, q) {
        return request('/api/admin/orders?filter=' + encodeURIComponent(filter) +
          (q ? '&q=' + encodeURIComponent(q) : ''));
      },
      patch: function (ref, payload) {
        return request('/api/admin/orders/' + encodeURIComponent(ref), { method: 'PATCH', json: payload });
      },
      audit: function (limit) { return request('/api/admin/audit?limit=' + (limit || 120)); },
      slipUrl: function (ref) { return '/api/admin/slip/' + encodeURIComponent(ref); },
      exportUrl: function (filter) { return '/api/admin/export?filter=' + encodeURIComponent(filter || 'all'); }
    }
  };

  /* --- config ---------------------------------------------------------------
     ตารางไซส์ ราคา และเลขบัญชี มาจากเซิร์ฟเวอร์ ไม่ได้ฝังไว้ในไฟล์นี้
     แก้ราคาที่ functions/lib/pricing.ts ที่เดียว ทุกหน้าเปลี่ยนตามทันที
     ไม่มีทางเกิดกรณีที่หน้าเว็บคิดราคาคนละแบบกับเซิร์ฟเวอร์อีก */
  var CFG = null;
  var sizeByCode = {};

  function applyConfig(cfg) {
    CFG = cfg;
    sizeByCode = {};
    (cfg.sizes || []).forEach(function (s) { sizeByCode[s.s] = s; });
    AMS.config = cfg;
    AMS.SIZES = cfg.sizes || [];
    AMS.SIZE_ORDER = (cfg.sizes || []).map(function (s) { return s.s; });
    AMS.BANK = cfg.bank || {};
  }

  function priceForSize(code) {
    var s = sizeByCode[code];
    return (CFG ? CFG.shirtPrice : 500) + (s ? s.extra : 0);
  }
  function extraForSize(code) { var s = sizeByCode[code]; return s ? s.extra : 0; }

  /* --- ready ----------------------------------------------------------------
     ทุกหน้าที่ต้องใช้ราคาหรือไซส์ต้องรอ config ก่อน ไม่ใช่แค่รอ DOM
     ถ้าโหลด config ไม่ได้ ต้องขึ้นแถบแดงแล้วหยุด — หน้าที่คนกำลังจะโอนเงิน
     ต้องไม่แสดงตัวเลขใด ๆ ที่ไม่แน่ใจว่าถูก */
  var readyQueue = [];
  var readyState = 'loading';
  var readyErr = null;

  function ready(fn) {
    if (readyState === 'ok') { fn(CFG); return; }
    if (readyState === 'failed') return;
    readyQueue.push(fn);
  }

  function bootFailed(err) {
    readyState = 'failed';
    readyErr = err;
    var main = document.getElementById('main') || document.body;
    var box = document.createElement('div');
    box.className = 'wrap section';
    box.innerHTML =
      '<div class="callout callout-danger" role="alert">' +
      '<span aria-hidden="true">!</span>' +
      '<span><strong>โหลดข้อมูลจากเซิร์ฟเวอร์ไม่สำเร็จ</strong><br>' +
      esc(err && err.message ? err.message : 'ไม่ทราบสาเหตุ') +
      '<br>กรุณาโหลดหน้าใหม่อีกครั้ง — <strong>อย่าเพิ่งโอนเงินตามยอดที่เห็นบนหน้านี้</strong>' +
      '</span></div>';
    main.prepend(box);
  }

  function boot() {
    API.config().then(function (cfg) {
      applyConfig(cfg);
      readyState = 'ok';
      readyQueue.splice(0).forEach(function (fn) {
        try { fn(cfg); } catch (e) { console.error(e); }
      });
    }).catch(bootFailed);
  }

  /* ฟอร์มไม่บันทึกร่างลงเครื่องแล้ว — ถอด Draft ออกทั้งก้อนตามที่ผู้จัดงานสั่ง
     ตอนนี้เว็บนี้ไม่เขียนอะไรลง localStorage เลยแม้แต่อย่างเดียว */

  /* --- แปลงระหว่าง "จำนวนต่อไซส์" กับ "รายการไซส์แบน" ---------------------- */
  function countsToSizes(counts) {
    var out = [];
    (AMS.SIZE_ORDER || []).forEach(function (code) {
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
  /* 'M×2, L×1' — เรียงไซส์เล็กไปใหญ่เสมอ ไม่ใช่ตามลำดับที่ผู้ใช้กด */
  function sizeSummary(sizes) {
    var c = sizesToCounts(sizes);
    return (AMS.SIZE_ORDER || []).filter(function (k) { return c[k]; })
      .map(function (k) { return k + '×' + c[k]; }).join(', ');
  }

  /* คิดยอด "สำหรับแสดงระหว่างกรอก" เท่านั้น
     ยอดที่ผู้ใช้จะโอนจริงมาจาก /api/quote — ดูหมายเหตุหัวไฟล์ */
  function previewOrder(counts, donation) {
    var qty = 0, shirt = 0, surcharge = 0;
    Object.keys(counts || {}).forEach(function (k) {
      var n = Number(counts[k]) || 0;
      if (n <= 0) return;
      qty += n; shirt += n * priceForSize(k); surcharge += n * extraForSize(k);
    });
    var don = Number(donation) || 0;
    return {
      counts: counts || {}, sizes: countsToSizes(counts), qty: qty,
      shirtAmount: shirt, surcharge: surcharge, donation: don, total: shirt + don
    };
  }

  /* --- ตัวเลือกจำนวนเสื้อรายไซส์ ---------------------------------------------
     ตารางไซส์ที่มีตัวนับต่อแถว ช่องกลางพิมพ์เลขได้ด้วย
     (กด + ยี่สิบครั้งไม่ไหว แต่ก็ต้อง clamp กันพิมพ์พลาด) */
  function clampQty(v) {
    var max = CFG ? CFG.sizeMax : 99;
    var n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
    if (isNaN(n) || n < 0) n = 0;
    return Math.min(n, max);
  }
  function qtyInputs(el) { return [].slice.call(el.querySelectorAll('input[data-size]')); }

  function readQtyPicker(el) {
    var counts = {}, total = 0;
    if (el) qtyInputs(el).forEach(function (inp) {
      var n = clampQty(inp.value);
      if (n > 0) { counts[inp.getAttribute('data-size')] = n; total += n; }
    });
    return { counts: counts, total: total, sizes: countsToSizes(counts) };
  }

  function syncQtyPicker(el) {
    var max = CFG ? CFG.sizeMax : 99;
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
      if (plus) plus.disabled = n >= max;
    });
    var r = readQtyPicker(el);
    el.dispatchEvent(new CustomEvent('qtychange', { detail: r }));
    return r;
  }

  function buildQtyPicker(el, counts) {
    if (!el || !CFG) return;
    counts = counts || {};

    /* ป้าย "+20" ข้างรหัสไซส์ — ราคาต่อตัวไม่เท่ากัน ผู้ใช้ต้องเห็นก่อนกดเลือก
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
      baht(CFG.shirtPrice) + ' บาท</caption>' +
      '<thead><tr><th scope="col">ไซส์</th><th scope="col">รอบอก</th>' +
      '<th scope="col" class="qt-sh">ไหล่</th>' +
      '<th scope="col" class="qt-len">ความยาว</th>' +
      '<th scope="col" class="qt-n">จำนวน</th></tr></thead><tbody>' +
      CFG.sizes.map(row).join('') +
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
  function baht(n) { return Number(n || 0).toLocaleString('en-US'); }
  function thDate(iso) {
    if (!iso) return '—';
    var d = new Date(String(iso).replace(' ', 'T'));
    if (isNaN(d)) return String(iso);
    var pad = function (x) { return String(x).padStart(2, '0'); };
    /* พ.ศ. สองหลักท้าย — 2026 → 2569 → "69" */
    var be = d.getFullYear() + 543;
    return pad(d.getDate()) + ' ' + TH_MONTH[d.getMonth()] + ' ' + String(be).slice(-2) +
      ' · ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  /* เวลาไทยตอนนี้ในรูปแบบที่ <input type="datetime-local"> รับได้ */
  function localNowInput() {
    var n = new Date();
    var pad = function (x) { return String(x).padStart(2, '0'); };
    return n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate()) +
      'T' + pad(n.getHours()) + ':' + pad(n.getMinutes());
  }

  /* ข้อความจากผู้ใช้ถูกเอาไปต่อเป็น innerHTML หลายที่ จึงต้อง escape ก่อนเสมอ
     รวมถึงรหัสอ้างอิงด้วย — ต้นแบบยกเว้นไว้เพราะรหัสถูกสร้างในเครื่อง
     แต่ตอนนี้รหัสมาจาก URL และจากเซิร์ฟเวอร์ จึงต้องปฏิบัติเหมือนข้อความอื่น */
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
    shirt: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M5.6 2L2 3.9l1.2 2.6 1.3-.6V14h7V5.9l1.3.6L14 3.9 10.4 2A2.4 2.4 0 015.6 2z"/></svg>',
    truck: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M1.8 4.6h9.4v8.2H1.8zM11.2 7.4h3.4l2.6 2.8v2.6h-6z"/><circle cx="5.4" cy="15" r="1.6"/><circle cx="14" cy="15" r="1.6"/></svg>'
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
    if (!t) {
      t = document.createElement('div'); t.id = 'toast';
      t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.dataset.show = 'true';
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.dataset.show = 'false'; }, 2800);
  }

  /* --- Copy to clipboard (+ fallback เมื่อไม่ใช่ secure context) ------------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
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

  /* --- Count-up ------------------------------------------------------------- */
  function countUp(el, to) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = baht(to); return;
    }
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

  /* --- Nav active ----------------------------------------------------------- */
  /* Cloudflare Pages เด้ง /support.html → /support เสมอ ลิงก์ในหน้าจึงเขียนแบบไม่มีนามสกุล
     ตัวเทียบต้องรับได้ทั้งสองแบบ เผื่อมีใครเข้ามาด้วย URL เก่าที่มี .html */
  function markNav() {
    var here = location.pathname.toLowerCase().replace(/\.html$/, '').replace(/\/$/, '') || '/';
    document.querySelectorAll('.nav a').forEach(function (a) {
      var href = (a.getAttribute('href') || '').split('#')[0].split('?')[0].toLowerCase()
        .replace(/\.html$/, '').replace(/\/$/, '') || '/';
      if (href === here) a.setAttribute('aria-current', 'page');
    });
  }

  /* --- Field validation ------------------------------------------------------ */
  function setInvalid(field, msg) {
    if (!field) return;
    field.dataset.invalid = 'true';
    var e = field.querySelector('.err');
    if (e) e.innerHTML = ICON.alert + '<span>' + esc(msg) + '</span>';
    var input = field.querySelector('.input,.select,.textarea');
    if (input) input.setAttribute('aria-invalid', 'true');
  }
  function clearInvalid(field) {
    if (!field) return;
    field.dataset.invalid = 'false';
    var input = field.querySelector('.input,.select,.textarea');
    if (input) input.removeAttribute('aria-invalid');
  }

  /* แปลง errors[] ที่เซิร์ฟเวอร์ส่งกลับ (field → ข้อความ) ให้ไปย้อมช่องที่ถูกต้อง
     map บอกว่า field ชื่อนี้ตรงกับ id ของกล่อง .field อันไหนในหน้านั้น */
  function applyServerErrors(errors, map) {
    var first = null;
    (errors || []).forEach(function (e) {
      var id = map[e.field];
      var el = id && document.getElementById(id);
      if (el) { setInvalid(el, e.message); first = first || el; }
    });
    return first;
  }

  var AMS = window.AMS = {
    ASSET_VERSION: ASSET_VERSION,
    API: API, ready: ready, ApiError: ApiError,
    config: null, SIZES: [], SIZE_ORDER: [], BANK: {},
    buildQtyPicker: buildQtyPicker, readQtyPicker: readQtyPicker, syncQtyPicker: syncQtyPicker,
    countsToSizes: countsToSizes, sizesToCounts: sizesToCounts, sizeSummary: sizeSummary,
    previewOrder: previewOrder, priceForSize: priceForSize, extraForSize: extraForSize,
    baht: baht, thDate: thDate, localNowInput: localNowInput, esc: esc,
    badge: badge, ICON: ICON, toast: toast, copyText: copyText,
    bindCopy: bindCopy, countUp: countUp,
    setInvalid: setInvalid, clearInvalid: clearInvalid, applyServerErrors: applyServerErrors
  };

  document.addEventListener('DOMContentLoaded', function () {
    markNav();
    bindCopy();
    boot();
  });
})();
