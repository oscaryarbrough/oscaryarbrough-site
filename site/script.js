/* ==========================================================================
   Oscar Yarbrough — variation 11 ("Editorial")
   Progressive-enhancement features, inherited from variation 10 and
   trimmed for round 5:
     1. A live age counter, 9 decimal places, set inline in a sentence.
     2. A portrait whose photo pixelates from a range slider. Starts
        fully pixelated (100); the slider brings it into focus.
     3. The Travel page world map: visited countries open a panel.
   Everything below degrades gracefully: with JS off, the page still reads,
   the portrait is just a picture, and the map panels are plain sections.
   ========================================================================== */
(function () {
  'use strict';

  // September 9, 2003 — confirmed.
  const BIRTH_DATE = new Date('2003-09-09T00:00:00');

  /* ------------------------------------------------------------------ */
  /* 1. Live age counter                                                */
  /* ------------------------------------------------------------------ */

  // Mean tropical-ish year in ms (365.2425 days) — the same convention
  // paulstamatiou.com/about uses, so the integer part matches a birthday.
  const MS_PER_YEAR = 365.2425 * 24 * 60 * 60 * 1000;
  const DECIMALS = 9;

  function initAgeCounter() {
    const el = document.querySelector('[data-age-counter]');
    if (!el) return;
    if (isNaN(BIRTH_DATE.getTime())) return; // bad constant — leave fallback text

    const birthMs = BIRTH_DATE.getTime();

    // Date.now() is only millisecond-resolution, which would leave the last
    // few decimals frozen. Anchor once, then advance with the high-resolution
    // monotonic clock so all nine digits actually move.
    const hasPerf = typeof performance !== 'undefined' &&
                    typeof performance.now === 'function';
    const anchorWall = Date.now();
    const anchorPerf = hasPerf ? performance.now() : 0;

    function currentMs() {
      return hasPerf ? anchorWall + (performance.now() - anchorPerf) : Date.now();
    }

    function render() {
      const years = (currentMs() - birthMs) / MS_PER_YEAR;
      el.textContent = years.toFixed(DECIMALS);
    }

    render();
    el.classList.add('age--live');

    if (typeof requestAnimationFrame !== 'function') return;

    let running = true;

    function frame() {
      if (!running) return;
      render();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // Stop burning frames when the tab is hidden; resume after.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        running = false;
      } else if (!running) {
        running = true;
        requestAnimationFrame(frame);
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* 2. Portrait pixelation slider                                       */
  /* ------------------------------------------------------------------ */
  // Canvas technique: offscreen downscale, then upscale with smoothing off.
  // drawImage only — no getImageData/toDataURL, so file:// stays untainted.
  // clearRect before each draw keeps any alpha channel intact.
  //
  // Round-10: three photos you can flip between; the slider starts at 85
  // and the pixelation level survives switching photos.

  function initPortrait() {
    const root = document.querySelector('[data-portrait]');
    if (!root) return;

    const img = root.querySelector('img');
    const controls = root.querySelector('[data-portrait-controls]');
    const slider = root.querySelector('[data-portrait-slider]');
    const readout = root.querySelector('[data-portrait-readout]');
    const prevBtn = root.querySelector('[data-portrait-prev]');
    const nextBtn = root.querySelector('[data-portrait-next]');
    const status = root.querySelector('[data-portrait-status]');
    if (!img || !controls || !slider) return;

    const SOURCES = [
      '/_shared/img/portraits/home-1.jpg',
      '/_shared/img/portraits/home-2.jpg',
      '/_shared/img/portraits/home-3.jpg'
    ];
    let index = 0;
    let canvasActive = false;

    function show(i) {
      index = ((i % SOURCES.length) + SOURCES.length) % SOURCES.length;
      const done = function () {
        if (canvasActive) sizeAndDraw();
      };
      img.addEventListener('load', done, { once: true });
      img.alt = 'Oscar Yarbrough — photo ' + (index + 1) + ' of ' + SOURCES.length + '.';
      img.src = SOURCES[index];
      if (img.complete && img.naturalWidth) {
        img.removeEventListener('load', done);
        done();
      }
      if (status) {
        status.textContent = 'Photo ' + (index + 1) + ' of ' + SOURCES.length;
      }
    }

    if (prevBtn && nextBtn) {
      prevBtn.hidden = false;
      nextBtn.hidden = false;
      prevBtn.addEventListener('click', function () { show(index - 1); });
      nextBtn.addEventListener('click', function () { show(index + 1); });
    }

    // Bail out quietly (leaving the plain <img>) if canvas is unavailable.
    const canvas = document.createElement('canvas');
    if (!canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Offscreen buffer we downsample into before scaling back up.
    const buffer = document.createElement('canvas');
    const bufferCtx = buffer.getContext('2d');
    if (!bufferCtx) return;

    canvas.className = 'portrait__canvas';

    // Size the canvas from the photo, then draw at the slider's level.
    function sizeAndDraw() {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return; // decoding failed — keep the <img> as-is

      // Cap the working resolution; the portrait is displayed small.
      const maxW = 720;
      const scale = Math.min(1, maxW / w);
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      canvas.setAttribute('aria-label', img.alt || 'Portrait of Oscar Yarbrough');
      draw(Number(slider.value));
    }

    function start() {
      if (!img.naturalWidth || !img.naturalHeight) return;

      canvas.setAttribute('role', 'img');
      const stage = root.querySelector('[data-portrait-stage]') || root;
      img.hidden = true;
      img.setAttribute('aria-hidden', 'true');
      stage.appendChild(canvas);
      controls.hidden = false;
      canvasActive = true;

      sizeAndDraw(); // initial render honours the slider's value="85"

      slider.addEventListener('input', function () {
        draw(Number(slider.value));
      });
    }

    // level: 0 = untouched, 100 = maximally blocky.
    function draw(level) {
      const clamped = Math.max(0, Math.min(100, isNaN(level) ? 0 : level));
      const w = canvas.width;
      const h = canvas.height;

      if (readout) {
        readout.textContent = clamped === 0
          ? 'in focus'
          : Math.round(clamped) + '% pixelated';
      }

      if (clamped === 0) {
        ctx.imageSmoothingEnabled = true;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        return;
      }

      // Map 1..100 onto a shrink factor: gentle at first, chunky at the end.
      const t = clamped / 100;
      const minSide = 3;                       // most extreme: ~3px wide
      const shrink = Math.max(minSide / w, Math.pow(1 - t, 2.2));
      const bw = Math.max(minSide, Math.round(w * shrink));
      const bh = Math.max(minSide, Math.round(h * shrink));

      buffer.width = bw;
      buffer.height = bh;
      bufferCtx.imageSmoothingEnabled = true;
      bufferCtx.clearRect(0, 0, bw, bh);
      bufferCtx.drawImage(img, 0, 0, bw, bh);

      ctx.imageSmoothingEnabled = false;
      ctx.mozImageSmoothingEnabled = false;
      ctx.webkitImageSmoothingEnabled = false;
      ctx.msImageSmoothingEnabled = false;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(buffer, 0, 0, bw, bh, 0, 0, w, h);
    }

    if (img.complete && img.naturalWidth) {
      start();
    } else {
      img.addEventListener('load', start, { once: true });
      // If the picture never loads, do nothing — the <img> alt text stands.
    }
  }

  /* ------------------------------------------------------------------ */
  /* 3. Places so far — the world map                                    */
  /* ------------------------------------------------------------------ */
  // With JS off, the four place panels simply read as stacked sections
  // under a static map. With JS on, we hide them, dress the visited
  // countries as buttons, and open one panel at a time.

  function initWorldMap() {
    const root = document.querySelector('[data-worldmap]');
    if (!root) return;

    const triggers = root.querySelectorAll('[data-map-place]');
    const panels = document.querySelectorAll('[data-map-panel]');
    if (!triggers.length || !panels.length) return;

    const panelFor = {};
    panels.forEach(function (panel) {
      panelFor[panel.getAttribute('data-map-panel')] = panel;
      panel.hidden = true;
    });

    root.classList.add('world-map--interactive');

    function activate(trigger) {
      const key = trigger.getAttribute('data-map-place');
      const panel = panelFor[key];
      if (!panel) return;
      const wasOpen = !panel.hidden;
      panels.forEach(function (p) { p.hidden = true; });
      triggers.forEach(function (t) { t.setAttribute('aria-expanded', 'false'); });
      if (!wasOpen) {
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
      }
    }

    triggers.forEach(function (trigger) {
      const name = trigger.getAttribute('data-map-name') || 'This place';
      trigger.setAttribute('tabindex', '0');
      trigger.setAttribute('role', 'button');
      trigger.setAttribute('aria-label', name + ' — show details');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.addEventListener('click', function () { activate(trigger); });
      trigger.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          activate(trigger);
        }
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* 4. The head — five moods, picked at random on hover                 */
  /* ------------------------------------------------------------------ */
  // With JS off, CSS keeps the old tilt. With JS on, each hover (or
  // keyboard focus) plays one of five animations — never the same one
  // twice in a row. One of them is a blink.

  function initHeadAnims() {
    const link = document.querySelector('.masthead__head');
    if (!link) return;
    const img = link.querySelector('img');
    if (!img) return;

    link.classList.add('head--js');

    const ANIMS = [
      'head-anim--tilt',
      'head-anim--nod',
      'head-anim--shake',
      'head-anim--bounce',
      'head-anim--blink'
    ];
    let last = -1;
    let playing = false;

    function play() {
      if (playing) return;
      let i;
      do {
        i = Math.floor(Math.random() * ANIMS.length);
      } while (i === last);
      last = i;
      playing = true;
      const cls = ANIMS[i];
      img.classList.add(cls);
      img.addEventListener('animationend', function () {
        img.classList.remove(cls);
        playing = false;
      }, { once: true });
    }

    link.addEventListener('mouseenter', play);
    link.addEventListener('focus', play);
  }

  /* ------------------------------------------------------------------ */

  function init() {
    initAgeCounter();
    initPortrait();
    initWorldMap();
    initHeadAnims();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
