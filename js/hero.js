/*
 * Landing hero: the looping "live preview" card and the sticker trail that follows the mouse.
 * Purely decorative (the stage is aria-hidden); all numbers here are made up.
 */
(function (root) {
  'use strict';
  var stickers = root.VAP.stickers;

  var STEP_MS = 1300;
  var HOLD_STEPS = 3;
  var TRAIL_GAP_PX = 80;
  var TRAIL_LIFE_MS = 1100;
  var TRAIL_MAX = 14;
  var AUTOPLAY_DELAY_MS = 1600;
  var AUTOPLAY_MS = 2400;
  var SAFE_PCT = 77;
  var VTOP_PCT = 75;

  // Six upcoming days; perDay[i] = classes of each course held that day (labs count 2).
  var DAYS = [{ dow: 'MO', n: 12 }, { dow: 'TU', n: 13 }, { dow: 'WE', n: 14 }, { dow: 'TH', n: 15 }, { dow: 'FR', n: 16 }, { dow: 'SA', n: 17 }];
  var COURSES = [
    { name: 'DATABASE SYS', attended: 40, total: 46, future: 24, perDay: [1, 2, 1, 1, 2, 1] },
    { name: 'PROB & STATS', attended: 31, total: 40, future: 20, perDay: [1, 1, 2, 1, 1, 1] },
    { name: 'JAPANESE LAB', attended: 26, total: 28, future: 12, perDay: [2, 0, 0, 2, 0, 0] }
  ];

  function reducedMotion() {
    return root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function status(pct) {
    if (pct >= SAFE_PCT) return 'safe';
    return pct >= VTOP_PCT ? 'warn' : 'danger';
  }

  function projected(course, skippedDays) {
    var missed = course.perDay.reduce(function (sum, n, i) { return sum + (i < skippedDays ? n : 0); }, 0);
    return (100 * (course.attended + course.future - missed)) / (course.total + course.future);
  }

  // ---------- preview card ----------

  function buildPreview() {
    var week = document.getElementById('pv-week');
    var list = document.getElementById('pv-courses');
    if (!week || !list) return null;
    week.innerHTML = DAYS.map(function (d) {
      return '<span class="pv-day"><small>' + d.dow + '</small>' + d.n + '</span>';
    }).join('');
    list.innerHTML = COURSES.map(function () {
      return '<li><span class="pv-name"></span><span class="pv-pct"></span><span class="meter"><span class="meter-fill"></span><span class="meter-mark"></span></span></li>';
    }).join('');
    var rows = list.querySelectorAll('li');
    COURSES.forEach(function (c, i) { rows[i].querySelector('.pv-name').textContent = c.name; });
    return { days: week.querySelectorAll('.pv-day'), rows: rows };
  }

  function paintPreview(ui, skipped) {
    var lowest = null;
    ui.days.forEach(function (el, i) { el.classList.toggle('is-skip', i < skipped); });
    COURSES.forEach(function (c, i) {
      var pct = projected(c, skipped);
      var st = status(pct);
      var row = ui.rows[i];
      var pctEl = row.querySelector('.pv-pct');
      pctEl.textContent = pct.toFixed(1) + '%';
      pctEl.className = 'pv-pct st-' + st;
      var fill = row.querySelector('.meter-fill');
      fill.className = 'meter-fill st-' + st;
      // meter shows 60-100% so the drops are visible
      fill.style.width = Math.max(0, Math.min(100, (pct - 60) * 2.5)) + '%';
      row.querySelector('.meter-mark').style.left = (VTOP_PCT - 60) * 2.5 + '%';
      if (!lowest || pct < lowest.pct) lowest = { pct: pct, st: st };
    });
    document.getElementById('pv-skipped').textContent = String(skipped);
    var low = document.getElementById('pv-lowest');
    low.textContent = lowest.pct.toFixed(1) + '%';
    low.className = 'st-' + lowest.st;
  }

  function startPreview() {
    var ui = buildPreview();
    if (!ui) return;
    var tick = 0;
    var cycle = DAYS.length + 1 + HOLD_STEPS;
    paintPreview(ui, 0);
    if (reducedMotion()) {
      paintPreview(ui, 3);
      return;
    }
    setInterval(function () {
      if (document.hidden) return;
      tick = (tick + 1) % cycle;
      paintPreview(ui, Math.min(tick, DAYS.length));
    }, STEP_MS);
  }

  // ---------- sticker trail ----------

  function startTrail(hero) {
    var layer = document.getElementById('trail-layer');
    if (!layer || reducedMotion()) return;
    var next = 0;
    var last = null;
    var touched = false;

    function spawn(x, y) {
      var key = stickers.trail[next++ % stickers.trail.length];
      var el = document.createElement('span');
      el.className = 'trail-item trail-' + key;
      el.innerHTML = stickers.svg[key];
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.setProperty('--rot', (Math.random() * 36 - 18).toFixed(1) + 'deg');
      layer.appendChild(el);
      while (layer.childElementCount > TRAIL_MAX) layer.firstElementChild.remove();
      setTimeout(function () { el.remove(); }, TRAIL_LIFE_MS);
    }

    function local(e) {
      var r = hero.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    hero.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      touched = true;
      var p = local(e);
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= TRAIL_GAP_PX) {
        spawn(p.x, p.y);
        last = p;
      }
    });
    hero.addEventListener('pointerleave', function () { last = null; });
    hero.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch' || e.target.closest('a, button')) return;
      touched = true;
      var p = local(e);
      spawn(p.x, p.y);
    });

    // Shows the effect once on its own, so a visitor who hasn't moved the mouse yet sees what it does.
    setTimeout(function () {
      if (touched || hero.offsetParent === null) return;
      var t0 = performance.now();
      var lastAuto = 0;
      (function frame(now) {
        var t = now - t0;
        if (touched || t > AUTOPLAY_MS) return;
        if (t - lastAuto > AUTOPLAY_MS / 9) {
          lastAuto = t;
          var k = t / AUTOPLAY_MS;
          var w = hero.clientWidth;
          var h = hero.clientHeight;
          spawn(w * (0.55 + 0.32 * Math.sin(k * Math.PI * 2)), h * (0.42 + 0.22 * Math.sin(k * Math.PI * 4)));
        }
        root.requestAnimationFrame(frame);
      })(t0);
    }, AUTOPLAY_DELAY_MS);
  }

  function init() {
    document.querySelectorAll('[data-sticker]').forEach(function (el) {
      var art = stickers.svg[el.getAttribute('data-sticker')];
      if (art) el.innerHTML = art;
    });
    startPreview();
    var hero = document.querySelector('.hero');
    if (hero) startTrail(hero);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof self !== 'undefined' ? self : this);
