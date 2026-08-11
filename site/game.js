/* ==========================================================================
   Oscar Yarbrough — variation 7, Other Stuff
   "The Rhythm Section": a drum rhythm game in vanilla JS + WebAudio.
   Every sound is synthesized at the moment it is played — oscillators and
   filtered noise only. No audio files, no external requests, happy on file://.

   Structure:
     1. Boot & feature detection      5. Pattern generator (escalating)
     2. Theme palette (CSS props)     6. Game state & grading
     3. Audio engine (synth drums)    7. Canvas renderer (DPR-aware)
     4. Timing & scheduling           8. Input, overlays, storage
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- 1. Boot & feature detection -------------------------------- */
  var rootEl = document.querySelector('[data-drumgame]');
  if (!rootEl) return;

  var unsupportedEl = document.querySelector('[data-unsupported]');
  function bail() { if (unsupportedEl) unsupportedEl.hidden = false; }

  var AC = window.AudioContext || window.webkitAudioContext;
  var canvas = rootEl.querySelector('[data-drum-canvas]');
  if (!AC || !canvas || !canvas.getContext) { bail(); return; }
  var g = canvas.getContext('2d');
  if (!g) { bail(); return; }

  var stage   = rootEl.querySelector('[data-stage]');
  var overlay = rootEl.querySelector('[data-overlay]');
  var bar     = rootEl.querySelector('[data-bar]');
  var elScore = rootEl.querySelector('[data-score]');
  var elCombo = rootEl.querySelector('[data-combo]');
  var elLevel = rootEl.querySelector('[data-level]');
  var elBest  = rootEl.querySelector('[data-best]');
  var meter   = rootEl.querySelector('[data-meter]');
  var liveEl  = rootEl.querySelector('[data-live]');
  if (!stage || !overlay || !bar) { bail(); return; }

  rootEl.hidden = false;

  /* ---------- Constants --------------------------------------------------- */
  var LANES = 4;
  var LANE_KEYS  = ['D', 'F', 'J', 'K'];
  var LANE_NAMES = ['kick', 'snare', 'hi-hat', 'crash'];
  var KEYCODES = { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3 };
  var PERFECT = 0.048;          /* seconds either side of the note */
  var GOOD    = 0.112;
  var APPROACH = 1.35;          /* seconds a note is visible before the line */
  var MEASURES_PER_LEVEL = 4;
  var STORE_KEY = 'oy-drum-best';

  var SANS  = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif";
  var SERIF = "Georgia, 'Times New Roman', serif";
  var MONO  = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

  /* ---------- 2. Theme palette, read from the CSS custom properties ------- */
  var pal = {};
  function cssVar(cs, name, fallback) {
    var v = cs.getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }
  function readPalette() {
    var cs = getComputedStyle(document.documentElement);
    pal = {
      paper:      cssVar(cs, '--bg-inset',    '#f3efe7'),
      ink:        cssVar(cs, '--ink',         '#1b1917'),
      inkSoft:    cssVar(cs, '--ink-soft',    '#5a544c'),
      inkFaint:   cssVar(cs, '--ink-faint',   '#8a8279'),
      rule:       cssVar(cs, '--rule',        '#ded7ca'),
      ruleStrong: cssVar(cs, '--rule-strong', '#c6bdac'),
      accent:     cssVar(cs, '--accent',      '#8c3b1e'),
      accentSoft: cssVar(cs, '--accent-soft', 'rgba(140,59,30,0.14)')
    };
  }

  var rmQuery   = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function reducedMotion() { return !!(rmQuery && rmQuery.matches); }
  function watch(mq, fn) {
    if (!mq) return;
    if (mq.addEventListener) mq.addEventListener('change', fn);
    else if (mq.addListener) mq.addListener(fn);
  }

  /* ---------- 3. Audio engine: every drum synthesized --------------------- */
  var actx = null, master = null, noiseBuf = null;

  function ensureAudio() {
    if (!actx) {
      actx = new AC();
      master = actx.createGain();
      master.gain.value = 0.9;
      var comp = actx.createDynamicsCompressor();
      try {
        comp.threshold.value = -18;
        comp.knee.value = 24;
        comp.ratio.value = 5;
        comp.attack.value = 0.003;
        comp.release.value = 0.16;
      } catch (e) { /* older param shapes — defaults are fine */ }
      master.connect(comp);
      comp.connect(actx.destination);

      /* One second of white noise, reused by snare / hat click / crash. */
      var len = Math.max(1, Math.floor(actx.sampleRate));
      noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    /* Resume on any user gesture — but never behind the pause screen,
       where the frozen clock is exactly what keeps the chart in time. */
    if (actx.state === 'suspended' && state !== 'paused') actx.resume();
    return actx;
  }

  /* Filtered noise burst. The workhorse behind snare rattle and cymbals. */
  function noiseHit(t, peak, freq, type, decay, q) {
    if (!(peak > 0)) return;
    var src = actx.createBufferSource();
    var f = actx.createBiquadFilter();
    var gn = actx.createGain();
    src.buffer = noiseBuf;
    src.loop = true;
    f.type = type;
    f.frequency.value = freq;
    if (q) f.Q.value = q;
    gn.gain.setValueAtTime(peak, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f); f.connect(gn); gn.connect(master);
    src.start(t);
    src.stop(t + decay + 0.05);
  }

  /* Kick: a sine wave falling out of pitch, plus a beater click. */
  function kick(t, vel) {
    var o = actx.createOscillator(), gn = actx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    gn.gain.setValueAtTime(1.05 * vel, t);
    gn.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o.connect(gn); gn.connect(master);
    o.start(t); o.stop(t + 0.45);
    noiseHit(t, 0.3 * vel, 3400, 'bandpass', 0.02, 6);
  }

  /* Snare: tuned drum body (triangle, pitch drop) + high-passed noise wires. */
  function snare(t, vel) {
    var o = actx.createOscillator(), gn = actx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(196, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.09);
    gn.gain.setValueAtTime(0.5 * vel, t);
    gn.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(gn); gn.connect(master);
    o.start(t); o.stop(t + 0.14);
    noiseHit(t, 0.72 * vel, 1750, 'highpass', 0.19, 0.9);
  }

  /* Hi-hat, 808-style: six detuned square waves arguing through a band-pass
     filter, then a high-pass so only the metal comes out. */
  var HAT_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];
  function hat(t, vel, open) {
    var bp = actx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 10000; bp.Q.value = 1.1;
    var hp = actx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 7200;
    var gn = actx.createGain();
    var dur = open ? 0.32 : 0.05;
    gn.gain.setValueAtTime(0.42 * vel, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    bp.connect(hp); hp.connect(gn); gn.connect(master);
    for (var i = 0; i < HAT_RATIOS.length; i++) {
      var o = actx.createOscillator();
      o.type = 'square';
      o.frequency.value = 40 * HAT_RATIOS[i];
      o.connect(bp);
      o.start(t); o.stop(t + dur + 0.02);
    }
  }

  /* Crash: two layers of noise allowed to ring. */
  function crash(t, vel) {
    noiseHit(t, 0.55 * vel, 4400, 'highpass', 1.5, 0.4);
    noiseHit(t, 0.32 * vel, 8200, 'bandpass', 0.5, 0.7);
  }

  /* The click. Quiet, square, non-negotiable. */
  function tickSound(t, accented) {
    var o = actx.createOscillator(), gn = actx.createGain();
    o.type = 'square';
    o.frequency.value = accented ? 2200 : 1700;
    gn.gain.setValueAtTime(accented ? 0.09 : 0.055, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(gn); gn.connect(master);
    o.start(t); o.stop(t + 0.05);
  }

  function playDrum(lane, t, vel) {
    if (!actx) return;
    if (lane === 0) kick(t, vel);
    else if (lane === 1) snare(t, vel);
    else if (lane === 2) hat(t, vel, false);
    else crash(t, vel);
  }

  /* ---------- 5. Pattern generator ---------------------------------------- */
  function bpmForLevel(level) {
    return Math.min(152, 84 + (level - 1) * 8);
  }

  /* One 16-step bar. Groove first, chaos gradually. */
  function buildMeasure(level, firstOfLevel) {
    var steps = [], s;
    for (s = 0; s < 16; s++) steps.push([]);

    /* Hi-hats: steady eighths; sixteenth chatter creeps in from level 3. */
    for (s = 0; s < 16; s++) {
      if (s % 2 === 0) steps[s].push(2);
      else if (level >= 3 && Math.random() < 0.06 * (level - 2)) steps[s].push(2);
    }

    /* Snare: backbeat on 2 and 4, ghost notes from level 2. */
    steps[4].push(1);
    steps[12].push(1);
    if (level >= 2) {
      [7, 10, 15].forEach(function (i) {
        if (Math.random() < 0.045 * level) steps[i].push(1);
      });
    }

    /* Kick: downbeats, then increasingly syncopated extras. */
    steps[0].push(0);
    steps[8].push(0);
    [3, 6, 10, 11, 14].forEach(function (i) {
      if (Math.random() < 0.05 * level) steps[i].push(0);
    });

    /* A crash marks the top of every level. */
    if (firstOfLevel) {
      steps[0] = steps[0].filter(function (l) { return l !== 2; });
      steps[0].push(3);
    }

    /* Two hands only: never more than two lanes at once (drop the hat first). */
    for (s = 0; s < 16; s++) {
      if (steps[s].length > 2) {
        steps[s] = steps[s].filter(function (l) { return l !== 2; }).slice(0, 2);
      }
    }
    return steps;
  }

  /* ---------- 6. Game state ------------------------------------------------ */
  /* states: menu | countin | play | paused | over | jam */
  var state = 'menu';
  var prePause = 'play';

  var notes = [], ticks = [], levelChanges = [];
  var judgements = [], flashes = [];
  var scanFrom = 0, tickScan = 0;
  var generatedUntil = 0, measureCount = 0, startTime = 0;

  var score = 0, combo = 0, bestCombo = 0, groove = 0;
  var counts = { perfect: 0, good: 0, miss: 0, over: 0 };
  var hudLevel = 1, hudBpm = bpmForLevel(1);

  var lanePressed = [false, false, false, false];
  var pointerLanes = {};

  var jamClick = false, nextJamTick = 0, jamBeat = 0;

  var best = loadBest();

  function levelAt(t) {
    if (!levelChanges.length) return null;
    var cur = levelChanges[0];
    for (var i = 0; i < levelChanges.length; i++) {
      if (levelChanges[i].time <= t) cur = levelChanges[i];
      else break;
    }
    return cur;
  }

  function genMeasure() {
    var level = 1 + Math.floor(measureCount / MEASURES_PER_LEVEL);
    var bpm = bpmForLevel(level);
    var beat = 60 / bpm;
    var stepLen = beat / 4;
    var start = generatedUntil;
    var first = measureCount % MEASURES_PER_LEVEL === 0;
    if (first) levelChanges.push({ time: start, level: level, bpm: bpm });
    var m = buildMeasure(level, first);
    for (var s = 0; s < 16; s++) {
      for (var k = 0; k < m[s].length; k++) {
        notes.push({ lane: m[s][k], time: start + s * stepLen, judged: null });
      }
    }
    for (var b = 0; b < 4; b++) ticks.push({ time: start + b * beat, accent: b === 0 });
    generatedUntil = start + 4 * beat;
    measureCount++;
  }

  function startGame() {
    ensureAudio();
    notes = []; ticks = []; levelChanges = [];
    judgements = []; flashes = [];
    scanFrom = 0; tickScan = 0; measureCount = 0;
    score = 0; combo = 0; bestCombo = 0; groove = 65;
    counts = { perfect: 0, good: 0, miss: 0, over: 0 };
    hudLevel = 1; hudBpm = bpmForLevel(1);

    var beat = 60 / bpmForLevel(1);
    var base = actx.currentTime + 0.25;
    for (var b = 0; b < 4; b++) ticks.push({ time: base + b * beat, accent: b === 0 });
    startTime = base + 4 * beat;
    generatedUntil = startTime;
    genMeasure();
    genMeasure();

    state = 'countin';
    hideOverlay();
    updateBar();
    updateHud();
    live('Count-in. Four clicks, then play.');
    startLoop();
  }

  function startJam() {
    ensureAudio();
    state = 'jam';
    judgements = []; flashes = [];
    jamClick = false; nextJamTick = 0; jamBeat = 0;
    hideOverlay();
    updateBar();
    updateHud();
    live('Jam mode. D F J K to play; Escape to leave.');
    startLoop();
  }

  function leaveJam() {
    showMenu();
  }

  function toggleJamClick() {
    jamClick = !jamClick;
    if (jamClick && actx) { nextJamTick = actx.currentTime + 0.1; jamBeat = 0; }
    updateBar();
  }

  function pause() {
    if (state !== 'play' && state !== 'countin') return;
    prePause = state;
    state = 'paused';
    if (actx) actx.suspend();
    showPauseOverlay();
    updateBar();
    live('Paused.');
  }

  function resume() {
    if (state !== 'paused') return;
    state = prePause || 'play';
    hideOverlay();
    updateBar();
    if (actx) actx.resume();
    live('Playing.');
    startLoop();
  }

  function checkFail() {
    if (groove <= 0 && state === 'play') endSet(true);
  }

  function endSet(failed) {
    state = 'over';
    if (actx && actx.state === 'suspended') actx.resume();
    var isNew = maybeSaveBest();
    updateBar();
    updateHud();
    showOverOverlay(failed, isNew);
    live((failed ? 'The set fell apart. ' : 'Set finished. ') +
         'Score ' + fmt(score) + ', best combo ' + bestCombo + '.');
    drawFrame();
  }

  function noteMissed(n) {
    n.judged = 'miss';
    counts.miss++;
    combo = 0;
    groove = Math.max(0, groove - 11);
    judgements.push({ lane: n.lane, text: 'miss', t: actx.currentTime });
    updateHud();
    checkFail();
  }

  function laneHit(lane) {
    if (!actx) return;
    var now = actx.currentTime;

    if (state === 'jam') {
      playDrum(lane, now, 1);
      flashes.push({ lane: lane, t: now, q: 'perfect' });
      judgements.push({ lane: lane, text: LANE_NAMES[lane], t: now });
      return;
    }
    if (state === 'menu' || state === 'over') {
      playDrum(lane, now, 0.9);   /* the kit is live even on the menu */
      return;
    }
    if (state === 'paused') return;
    if (state !== 'play' && state !== 'countin') return;

    /* Find the nearest unjudged note in this lane inside the window. */
    var bestNote = null, bestDt = Infinity;
    for (var i = scanFrom; i < notes.length; i++) {
      var n = notes[i];
      if (n.time > now + GOOD) break;
      if (n.lane !== lane || n.judged) continue;
      var dt = Math.abs(n.time - now);
      if (dt < bestDt) { bestDt = dt; bestNote = n; }
    }

    if (bestNote && bestDt <= GOOD) {
      var q = bestDt <= PERFECT ? 'perfect' : 'good';
      bestNote.judged = q;
      counts[q]++;
      combo++;
      if (combo > bestCombo) bestCombo = combo;
      var mult = 1 + Math.min(3, Math.floor(combo / 12));
      score += (q === 'perfect' ? 100 : 60) * mult;
      groove = Math.min(100, groove + (q === 'perfect' ? 2.5 : 1.5));
      playDrum(lane, now, q === 'perfect' ? 1 : 0.85);
      judgements.push({ lane: lane, text: q, t: now });
      flashes.push({ lane: lane, t: now, q: q });
      updateHud();
    } else if (state === 'countin') {
      playDrum(lane, now, 0.9);   /* warming up is free */
    } else {
      counts.over++;
      combo = 0;
      groove = Math.max(0, groove - 5);
      playDrum(lane, now, 0.4);
      judgements.push({ lane: lane, text: 'off', t: now });
      updateHud();
      checkFail();
    }
  }

  /* ---------- 4./7. Timing loop + renderer -------------------------------- */
  var viewW = 0, viewH = 0, dpr = 1;
  var loopOn = false;

  function startLoop() {
    if (loopOn) return;
    loopOn = true;
    requestAnimationFrame(frame);
  }

  function frame() {
    if (state === 'countin' || state === 'play' || state === 'jam') {
      update();
      drawFrame();
      requestAnimationFrame(frame);
    } else {
      loopOn = false;
      drawFrame();
    }
  }

  function update() {
    var now = actx.currentTime;

    if (state === 'countin' && now >= startTime) {
      state = 'play';
      updateBar();
      live('Playing.');
    }

    if (state === 'play' || state === 'countin') {
      while (generatedUntil < now + 3) genMeasure();
      while (tickScan < ticks.length && ticks[tickScan].time < now + 0.22) {
        tickSound(ticks[tickScan].time, ticks[tickScan].accent);
        tickScan++;
      }
    }

    if (state === 'play') {
      while (scanFrom < notes.length && notes[scanFrom].time < now - GOOD) {
        var n = notes[scanFrom];
        if (!n.judged) noteMissed(n);
        scanFrom++;
        if (state !== 'play') return;   /* the set may have just fallen apart */
      }
      var lc = levelAt(now);
      if (lc && lc.level !== hudLevel) {
        hudLevel = lc.level;
        hudBpm = lc.bpm;
        updateHud();
      }
    }

    if (state === 'jam' && jamClick) {
      while (nextJamTick < now + 0.22) {
        tickSound(nextJamTick, jamBeat % 4 === 0);
        nextJamTick += 60 / 92;
        jamBeat++;
      }
    }

    if (judgements.length > 40) judgements.splice(0, judgements.length - 40);
    if (flashes.length > 40) flashes.splice(0, flashes.length - 40);
  }

  function line(x1, y1, x2, y2) {
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  }

  function drawFrame() {
    var W = viewW, H = viewH;
    if (!W || !H) return;
    var now = actx ? actx.currentTime : 0;
    var laneW = W / LANES;
    var hitY = H - 72;
    var topPad = 6;
    var rmOn = reducedMotion();
    var active = (state === 'play' || state === 'countin');
    var i, n, x, y;

    g.fillStyle = pal.paper;
    g.fillRect(0, 0, W, H);

    /* Pressed-lane wash */
    for (i = 0; i < LANES; i++) {
      if (lanePressed[i]) {
        g.fillStyle = pal.accentSoft;
        g.fillRect(i * laneW, 0, laneW, H);
      }
    }

    /* Lane hairlines */
    g.strokeStyle = pal.rule;
    g.lineWidth = 1;
    for (i = 1; i < LANES; i++) {
      line(Math.round(i * laneW) + 0.5, 0, Math.round(i * laneW) + 0.5, H);
    }

    /* Scrolling beat gridlines */
    if (active && !rmOn) {
      g.strokeStyle = pal.rule;
      g.globalAlpha = 0.55;
      for (i = 0; i < ticks.length; i++) {
        var tt = ticks[i].time;
        if (tt <= now || tt > now + APPROACH) continue;
        y = hitY - (tt - now) / APPROACH * (hitY - topPad);
        line(0, Math.round(y) + 0.5, W, Math.round(y) + 0.5);
      }
      g.globalAlpha = 1;
    }

    /* Hit line */
    g.strokeStyle = pal.ruleStrong;
    g.lineWidth = 2;
    line(0, hitY, W, hitY);
    g.lineWidth = 1;

    /* Targets + key letters + drum names */
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (i = 0; i < LANES; i++) {
      x = i * laneW + laneW / 2;
      var sz = 20;
      if (lanePressed[i]) {
        g.fillStyle = pal.accent;
        g.fillRect(x - sz / 2, hitY - sz / 2, sz, sz);
      } else {
        g.strokeStyle = pal.ruleStrong;
        g.strokeRect(Math.round(x - sz / 2) + 0.5, Math.round(hitY - sz / 2) + 0.5, sz - 1, sz - 1);
      }
      g.fillStyle = pal.inkFaint;
      g.font = '600 11px ' + SANS;
      g.fillText(LANE_KEYS[i], x, hitY + 30);
      g.font = '9px ' + SANS;
      g.fillText(LANE_NAMES[i].toUpperCase(), x, hitY + 48);
    }

    /* Notes */
    if (active && !rmOn) {
      var kw = Math.min(52, laneW * 0.55);
      var sw = Math.min(40, laneW * 0.42);
      for (i = 0; i < notes.length; i++) {
        n = notes[i];
        if (n.time < now - 0.4) continue;
        if (n.time > now + APPROACH) break;
        if (n.judged === 'perfect' || n.judged === 'good') continue;
        y = hitY - (n.time - now) / APPROACH * (hitY - topPad);
        x = n.lane * laneW + laneW / 2;
        var alpha = 1;
        if (n.judged === 'miss') alpha = Math.max(0, 0.4 - (now - n.time));
        if (alpha <= 0) continue;
        g.globalAlpha = alpha;
        if (n.lane === 0) {
          g.fillStyle = pal.accent;
          g.fillRect(x - kw / 2, y - 7, kw, 14);
        } else if (n.lane === 1) {
          g.fillStyle = pal.accent;
          g.fillRect(x - sw / 2, y - 7, sw, 14);
        } else if (n.lane === 2) {
          g.fillStyle = pal.inkSoft;
          g.fillRect(x - 6, y - 6, 12, 12);
        } else {
          g.strokeStyle = pal.accent;
          g.lineWidth = 2;
          g.strokeRect(x - 11, y - 11, 22, 22);
          g.lineWidth = 1;
        }
        g.globalAlpha = 1;
      }
    }

    /* Reduced motion: nothing scrolls. A lane's square arms (outline) one
       beat out, fills when it is time to hit, on the click. */
    if (active && rmOn) {
      var lc = levelAt(now);
      var beatLen = lc ? 60 / lc.bpm : 60 / bpmForLevel(1);
      for (i = 0; i < LANES; i++) {
        var upNext = null;
        for (var k = scanFrom; k < notes.length; k++) {
          var nn = notes[k];
          if (nn.time > now + beatLen * 1.05) break;
          if (nn.lane !== i || nn.judged) continue;
          upNext = nn;
          break;
        }
        if (!upNext) continue;
        x = i * laneW + laneW / 2;
        var dtn = upNext.time - now;
        if (dtn <= 0.14) {
          g.fillStyle = pal.accent;
          g.fillRect(x - 14, hitY - 14, 28, 28);
        } else {
          g.strokeStyle = pal.accent;
          g.lineWidth = 2;
          g.strokeRect(x - 14, hitY - 14, 28, 28);
          g.lineWidth = 1;
        }
      }
      /* Discrete beat dots, top centre */
      if (state === 'play' && lc) {
        var bIdx = Math.max(0, Math.floor((now - lc.time) / beatLen)) % 4;
        for (i = 0; i < 4; i++) {
          var bx = W / 2 - 33 + i * 22;
          if (i === bIdx) {
            g.fillStyle = pal.accent;
            g.fillRect(bx - 4, 16, 8, 8);
          } else {
            g.strokeStyle = pal.ruleStrong;
            g.strokeRect(bx - 3.5, 16.5, 7, 7);
          }
        }
      }
    }

    /* Hit flashes */
    for (i = 0; i < flashes.length; i++) {
      var f = flashes[i];
      var el = now - f.t;
      x = f.lane * laneW + laneW / 2;
      if (rmOn) {
        if (el < 0.15) {
          g.fillStyle = pal.accentSoft;
          g.fillRect(f.lane * laneW, hitY - 26, laneW, 52);
        }
      } else if (el < 0.25) {
        var p = el / 0.25;
        var s2 = 20 + p * 26;
        g.globalAlpha = 1 - p;
        g.strokeStyle = f.q === 'perfect' ? pal.accent : pal.ruleStrong;
        g.lineWidth = 2;
        g.strokeRect(x - s2 / 2, hitY - s2 / 2, s2, s2);
        g.lineWidth = 1;
        g.globalAlpha = 1;
      }
    }

    /* Judgement text */
    for (i = 0; i < judgements.length; i++) {
      var j = judgements[i];
      var elj = now - j.t;
      if (elj > 0.55) continue;
      x = j.lane * laneW + laneW / 2;
      var a2 = rmOn ? (elj < 0.45 ? 1 : 0) : Math.max(0, 1 - elj / 0.55);
      if (a2 <= 0) continue;
      var rise = rmOn ? 0 : elj * 34;
      g.globalAlpha = a2;
      g.fillStyle = j.text === 'perfect' ? pal.accent :
                    (j.text === 'good' ? pal.inkSoft : pal.inkFaint);
      g.font = '600 10px ' + SANS;
      g.fillText(j.text.toUpperCase(), x, hitY - 40 - rise);
      g.globalAlpha = 1;
    }

    /* Combo, once it deserves attention */
    if (state === 'play' && combo >= 10) {
      g.fillStyle = pal.accent;
      g.font = '12px ' + MONO;
      g.fillText(combo + ' in a row', W / 2, rmOn ? 40 : 24);
    }

    /* Count-in number */
    if (state === 'countin') {
      var beat1 = 60 / bpmForLevel(1);
      var num = Math.max(1, Math.ceil((startTime - now) / beat1));
      g.fillStyle = pal.ink;
      g.font = '44px ' + SERIF;
      g.fillText(String(num), W / 2, H / 2 - 30);
      g.fillStyle = pal.inkFaint;
      g.font = '600 10px ' + SANS;
      g.fillText('COUNT-IN', W / 2, H / 2 + 4);
    }

    /* Level banner */
    if (state === 'play') {
      var lcb = levelAt(now);
      if (lcb && lcb.level > 1 && now - lcb.time < 1.3) {
        var elb = now - lcb.time;
        g.globalAlpha = rmOn ? 1 : Math.min(1, Math.max(0, (1.3 - elb) / 0.4));
        g.fillStyle = pal.ink;
        g.font = '20px ' + SERIF;
        g.fillText('Level ' + lcb.level + ' · ' + lcb.bpm + ' bpm', W / 2, 64);
        g.globalAlpha = 1;
      }
    }

    /* Jam hint */
    if (state === 'jam') {
      g.fillStyle = pal.inkFaint;
      g.font = '600 10px ' + SANS;
      g.fillText('JAM MODE — PLAY ANYTHING', W / 2, 24);
      g.font = '10px ' + SANS;
      g.fillText('Esc leaves · M toggles the click', W / 2, 40);
    }
  }

  /* ---------- Canvas sizing (devicePixelRatio-aware) ----------------------- */
  function resize() {
    var rect = stage.getBoundingClientRect();
    var w = Math.round(rect.width);
    if (!w) return;
    var h = Math.round(Math.min(430, Math.max(300, w * 0.62)));
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
    viewW = w;
    viewH = h;
    if (g.setTransform) g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFrame();
  }

  /* ---------- 8. Overlays, HUD, bar ---------------------------------------- */
  function hideOverlay() {
    overlay.hidden = true;
    overlay.innerHTML = '';
  }

  function showMenu() {
    state = 'menu';
    updateBar();
    updateHud();
    var bestLine = best
      ? '<p class="drumgame__ov-best">Personal best: ' + fmt(best.score) +
        ' · combo ' + best.combo + '</p>'
      : '';
    var rmLine = reducedMotion()
      ? '<p class="drumgame__ov-copy">Reduced motion is on, so nothing will scroll: ' +
        'a lane’s square fills when it is time to hit it, on the click.</p>'
      : '';
    overlay.innerHTML =
      '<p class="drumgame__ov-eyebrow">Take a solo</p>' +
      '<p class="drumgame__ov-title">Four lanes. No samples.</p>' +
      '<p class="drumgame__ov-copy">D F J K — kick, snare, hi-hat, crash. ' +
      'Hit the squares as they cross the line; the bars get faster and busier ' +
      'the longer you hold on. The click is non-negotiable.</p>' +
      rmLine + bestLine +
      '<div class="drumgame__ov-actions">' +
      '<button type="button" class="drumbtn drumbtn--primary" data-action="start">Play the set</button>' +
      '<button type="button" class="drumbtn" data-action="jam">Free jam</button>' +
      '</div>';
    overlay.hidden = false;
    live('Menu. The kit is already live if you want to test the keys.');
    drawFrame();
  }

  function showPauseOverlay() {
    overlay.innerHTML =
      '<p class="drumgame__ov-eyebrow">Paused</p>' +
      '<p class="drumgame__ov-title">The clock is frozen.</p>' +
      '<p class="drumgame__ov-copy">Exactly where you left it, down to the sample.</p>' +
      '<div class="drumgame__ov-actions">' +
      '<button type="button" class="drumbtn drumbtn--primary" data-action="resume">Resume</button>' +
      '<button type="button" class="drumbtn" data-action="restart">Start over</button>' +
      '<button type="button" class="drumbtn" data-action="end">End the set</button>' +
      '</div>';
    overlay.hidden = false;
  }

  function showOverOverlay(failed, isNew) {
    var judged = counts.perfect + counts.good + counts.miss;
    var pct = judged ? Math.round(100 * (counts.perfect + counts.good) / judged) : 0;
    overlay.innerHTML =
      '<p class="drumgame__ov-eyebrow">' + (failed ? 'The groove ran out' : 'Set finished') + '</p>' +
      '<p class="drumgame__ov-title">' + (failed ? 'The set fell apart.' : 'You called it a night.') + '</p>' +
      '<p class="drumgame__ov-best">' + fmt(score) + ' points · best combo ' +
      bestCombo + ' · ' + pct + '% on time</p>' +
      '<p class="drumgame__ov-copy">' + counts.perfect + ' perfect · ' +
      counts.good + ' good · ' + counts.miss + ' missed' +
      (isNew ? ' — a new personal best.' : '.') + '</p>' +
      '<div class="drumgame__ov-actions">' +
      '<button type="button" class="drumbtn drumbtn--primary" data-action="again">Again</button>' +
      '<button type="button" class="drumbtn" data-action="jam">Free jam</button>' +
      '<button type="button" class="drumbtn" data-action="menu">Menu</button>' +
      '</div>';
    overlay.hidden = false;
  }

  overlay.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== overlay && !(t.getAttribute && t.getAttribute('data-action'))) {
      t = t.parentNode;
    }
    if (!t || t === overlay || !t.getAttribute) return;
    var a = t.getAttribute('data-action');
    if (a === 'start' || a === 'again') startGame();
    else if (a === 'jam') startJam();
    else if (a === 'resume') resume();
    else if (a === 'restart') {
      if (actx && actx.state === 'suspended') actx.resume();
      startGame();
    } else if (a === 'end') endSet(false);
    else if (a === 'menu') showMenu();
  });

  function updateBar() {
    if (state === 'play' || state === 'countin') {
      bar.hidden = false;
      bar.innerHTML =
        '<button type="button" class="drumbtn" data-action="pause">Pause</button>';
    } else if (state === 'jam') {
      bar.hidden = false;
      bar.innerHTML =
        '<button type="button" class="drumbtn" data-action="jamclick">' +
        (jamClick ? 'Click: on' : 'Click: off') + '</button>' +
        '<button type="button" class="drumbtn" data-action="leave">Leave the jam</button>';
    } else {
      bar.hidden = true;
      bar.innerHTML = '';
    }
  }

  bar.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== bar && !(t.getAttribute && t.getAttribute('data-action'))) {
      t = t.parentNode;
    }
    if (!t || t === bar || !t.getAttribute) return;
    var a = t.getAttribute('data-action');
    if (a === 'pause') pause();
    else if (a === 'jamclick') toggleJamClick();
    else if (a === 'leave') leaveJam();
  });

  function updateHud() {
    var mult = 1 + Math.min(3, Math.floor(combo / 12));
    if (elScore) elScore.textContent = fmt(score);
    if (elCombo) elCombo.textContent = combo + (mult > 1 ? ' ×' + mult : '');
    if (elLevel) {
      elLevel.textContent =
        (state === 'play' || state === 'countin' || state === 'paused')
          ? hudLevel + ' · ' + hudBpm + ' bpm'
          : '—';
    }
    if (elBest) elBest.textContent = best ? fmt(best.score) : '—';
    if (meter) {
      var w = (state === 'play' || state === 'countin' || state === 'paused')
        ? Math.max(0, Math.min(100, groove)) : 0;
      meter.style.width = w + '%';
    }
  }

  function live(msg) {
    if (liveEl) liveEl.textContent = msg;
  }

  function fmt(v) {
    try { return v.toLocaleString('en-US'); } catch (e) { return String(v); }
  }

  /* ---------- localStorage high score (feature-detected) ------------------- */
  function loadBest() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (p && typeof p.score === 'number' && isFinite(p.score)) {
        return {
          score: Math.max(0, Math.floor(p.score)),
          combo: (typeof p.combo === 'number' && isFinite(p.combo))
            ? Math.max(0, Math.floor(p.combo)) : 0
        };
      }
    } catch (e) { /* storage unavailable — the game shrugs */ }
    return null;
  }

  function maybeSaveBest() {
    if (!score) return false;
    if (best && score <= best.score) return false;
    best = { score: score, combo: bestCombo };
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(best));
    } catch (e) { /* private mode etc. — keep it in memory for the session */ }
    return true;
  }

  /* ---------- Input: keyboard ---------------------------------------------- */
  window.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var lane = KEYCODES[e.code];
    if (lane !== undefined) {
      ensureAudio();
      lanePressed[lane] = true;
      laneHit(lane);
      if (state === 'play' || state === 'countin' || state === 'jam') e.preventDefault();
      if (!loopOn) drawFrame();
      return;
    }
    if (e.code === 'KeyP' && (state === 'play' || state === 'countin')) { pause(); return; }
    if (e.code === 'Escape') {
      if (state === 'play' || state === 'countin') pause();
      else if (state === 'paused') resume();
      else if (state === 'jam') leaveJam();
      return;
    }
    if (e.code === 'KeyM' && state === 'jam') toggleJamClick();
  });

  window.addEventListener('keyup', function (e) {
    var lane = KEYCODES[e.code];
    if (lane !== undefined) {
      lanePressed[lane] = false;
      if (!loopOn) drawFrame();
    }
  });

  /* ---------- Input: touch / pointer lanes --------------------------------- */
  canvas.addEventListener('pointerdown', function (e) {
    if (state === 'menu' || state === 'over' || state === 'paused') return;
    e.preventDefault();
    ensureAudio();
    var r = canvas.getBoundingClientRect();
    var lane = Math.max(0, Math.min(LANES - 1,
      Math.floor((e.clientX - r.left) / r.width * LANES)));
    pointerLanes[e.pointerId] = lane;
    lanePressed[lane] = true;
    laneHit(lane);
    if (!loopOn) drawFrame();
  });

  function pointerRelease(e) {
    var lane = pointerLanes[e.pointerId];
    if (lane !== undefined) {
      lanePressed[lane] = false;
      delete pointerLanes[e.pointerId];
      if (!loopOn) drawFrame();
    }
  }
  window.addEventListener('pointerup', pointerRelease);
  window.addEventListener('pointercancel', pointerRelease);

  /* ---------- Housekeeping -------------------------------------------------- */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && (state === 'play' || state === 'countin')) pause();
  });

  watch(darkQuery, function () { readPalette(); drawFrame(); });
  watch(rmQuery, function () {
    if (state === 'menu') showMenu();
    else drawFrame();
  });

  window.addEventListener('resize', resize);

  /* ---------- Go ------------------------------------------------------------ */
  readPalette();
  resize();
  showMenu();
})();
