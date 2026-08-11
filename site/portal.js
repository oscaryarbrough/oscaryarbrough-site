/* ==================================================================== */
/* The portal.                                                          */
/*                                                                      */
/* Clicking the masthead head no longer just follows a link: the page   */
/* tears open into a full-screen 8-bit vortex, the head spins into the  */
/* middle of it, and THEN you arrive at the secret page. Rendered on a  */
/* deliberately tiny canvas upscaled with smoothing off, so every ring  */
/* is made of fat pixels. Skips itself for reduced-motion, no-JS, or    */
/* modified clicks (cmd/ctrl/shift/middle) so new-tab behavior and      */
/* accessibility survive.                                               */
/* ==================================================================== */
(function () {
  'use strict';

  var link = document.querySelector('.masthead__head[href$="/secret"]');
  if (!link) return;

  var reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var running = false;

  link.addEventListener('click', function (e) {
    if (running) { e.preventDefault(); return; }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (reduced) return; // plain navigation
    e.preventDefault();
    running = true;
    try {
      openPortal(link.href, link.querySelector('img'));
    } catch (err) {
      window.location.href = link.href;
    }
  });

  function openPortal(dest, headImg) {
    var overlay = document.createElement('div');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:9999;background:#000;opacity:0;' +
      'transition:opacity 0.18s linear;';
    var canvas = document.createElement('canvas');
    canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;' +
      'image-rendering:pixelated;image-rendering:crisp-edges;';
    overlay.appendChild(canvas);
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.style.opacity = '1'; });

    // Tiny logical buffer: everything drawn here comes out chunky.
    var W = 192, H = 120;
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');
    if (!ctx) { window.location.href = dest; return; }
    ctx.imageSmoothingEnabled = false;

    // A quick warp sound — square wave diving down an octave under noise.
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        var ac = new AC();
        var osc = ac.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(440, ac.currentTime);
        osc.frequency.exponentialRampToValueAtTime(55, ac.currentTime + 1.4);
        var g = ac.createGain();
        g.gain.setValueAtTime(0.12, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 1.6);
        osc.connect(g).connect(ac.destination);
        osc.start();
        osc.stop(ac.currentTime + 1.7);
      }
    } catch (err) { /* silence is fine */ }

    var PALETTE = ['#ffffff', '#ff2a2a', '#7b2aff', '#2ad9ff', '#ffd52a'];
    var DURATION = 1900;
    var start = null;

    function frame(now) {
      if (start === null) start = now;
      var t = (now - start) / DURATION; // 0..1
      if (t >= 1) { window.location.href = dest; return; }

      var cx = W / 2, cy = H / 2;

      // screen shake, worst in the middle of the ride
      var shake = Math.sin(t * Math.PI) * 3;
      var ox = (Math.random() - 0.5) * shake;
      var oy = (Math.random() - 0.5) * shake;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(cx + ox, cy + oy);

      // concentric pixel rings, spinning up and swallowing the screen
      var spin = t * t * 14;
      var maxR = 10 + t * 150;
      for (var i = 9; i >= 0; i--) {
        var r = (i + 1) / 10 * maxR;
        var color = PALETTE[i % PALETTE.length];
        var steps = 6 + i * 2;
        ctx.fillStyle = color;
        for (var s = 0; s < steps; s++) {
          var a = spin * (i % 2 ? 1 : -1) + (s / steps) * Math.PI * 2;
          var px = Math.round(Math.cos(a) * r);
          var py = Math.round(Math.sin(a) * r * 0.72);
          var size = i < 3 ? 1 : 2;
          ctx.fillRect(px, py, size, size);
        }
      }

      // star streaks getting pulled in
      ctx.fillStyle = '#fff';
      for (var k = 0; k < 26; k++) {
        var ka = k * 2.399 + t * 4;
        var kr = (1 - ((t * 1.7 + k / 26) % 1)) * 90;
        ctx.fillRect(Math.round(Math.cos(ka) * kr),
                     Math.round(Math.sin(ka) * kr * 0.72), 1, 1);
      }

      // the head, spinning and shrinking into the eye of it
      if (headImg && headImg.complete && headImg.naturalWidth) {
        var hs = Math.max(0.02, 1 - t * 1.15); // gone by ~87%
        var hw = 34 * hs, hh = 41 * hs;
        ctx.save();
        ctx.rotate(t * t * 22);
        ctx.drawImage(headImg, -hw / 2, -hh / 2, hw, hh);
        ctx.restore();
      }

      ctx.restore();

      // white flash right before arrival
      if (t > 0.92) {
        ctx.fillStyle = 'rgba(255,255,255,' + ((t - 0.92) / 0.08) + ')';
        ctx.fillRect(0, 0, W, H);
      }

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
})();
