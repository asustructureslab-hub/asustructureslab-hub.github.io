/* hrcdesigner.com/valley-metro: the 2-million-cycle fatigue test of track slab
 * SFRC2_#2 (lab name Euclid N2), rebuilt as a digital twin.
 *
 * Classic script, no modules. three.js r160 is vendored (../vendor) and loaded
 * when the view comes near the viewport.
 *
 * What is measured and what is drawn
 *   - Specimen, rail, span and instrument positions follow the manuscript, the
 *     ASU report and the laboratory photographs: 96 x 36 x 12 in slab, 115RE
 *     rail in a rubber boot 5.5 in above the soffit, 84 in span on rollers,
 *     four LVDTs 4 in from midspan, the loading box in its timber cage.
 *   - Load, midspan deflection and cycle count: the MTS records of the test
 *     (js/rail/twin-data.js, build_twin_data.py). Stiffness: the processed
 *     table behind manuscript Fig 15, used as is.
 *   - The strain band, the crack path, the crack width at the soffit and the
 *     height where the crack stops opening: the DIC of this slab (nine bursts,
 *     1k to 2020k cycles, DIC_Fatigue_N2 reduction). The band shown is the burst
 *     nearest the cycle count, scaled with the measured crack width.
 *   - Drawn for illustration: the split of the deflection into crack rotation
 *     and bending, the fibres in the close-up, and the laboratory. Deformation
 *     is magnified.
 *
 * Markup   <div class="twin-view" data-railtwin></div> inside [data-railtwin-root]
 * Hooks    ?twinn=1500000 (freeze at that cycle)  ?twinphase=0.5 (0 valley, 0.5 peak)
 *          ?twinview=rig|dic|crack|under  ?twinmag=20
 */
(function () {
  'use strict';

  var D = window.HRC_RAILTWIN;
  if (!D) return;

  var T = null;
  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function qp(name, re) {
    var m = new RegExp('(?:^|[?&])' + name + '=(' + re + ')(?:&|$)').exec(location.search);
    return m ? m[1] : null;
  }
  var NFIX = qp('twinn', '[0-9.]+'); NFIX = NFIX === null ? null : parseFloat(NFIX);
  var PHFIX = qp('twinphase', '[0-9.]+'); PHFIX = PHFIX === null ? null : parseFloat(PHFIX);
  var VIEW0 = qp('twinview', 'rig|dic|crack|under') || 'rig';
  var MAG0 = qp('twinmag', '[0-9.]+'); MAG0 = MAG0 === null ? 15 : Math.max(1, Math.min(60, parseFloat(MAG0)));
  var STILL = REDUCED || NFIX !== null;

  var BASE = (function () {
    var el = document.currentScript;
    return el && el.src ? el.src.replace(/[^/]*$/, '') + '../' : 'js/';
  })();

  /* ------------------------------------------------------------ utilities */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clamp01(v) { return clamp(v, 0, 1); }
  function smooth(v) { var s = clamp01(v); return s * s * (3 - 2 * s); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mulberry32(seed) {
    var a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function lerpArr(xs, ys, x) {
    var n = xs.length;
    if (!n) return 0;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
    var t = (x - xs[lo]) / ((xs[hi] - xs[lo]) || 1);
    return ys[lo] + t * (ys[hi] - ys[lo]);
  }
  function fmt(v, d) {
    if (v == null || !isFinite(v)) return '—';
    var s = Math.abs(v).toFixed(d);
    var p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (v < 0 ? '−' : '') + p.join('.');
  }
  var KIP = 4.4482216, INCH = 25.4;

  /* ------------------------------------------------------------ geometry, mm */
  var G = D.geom;
  var LEN = G.len, B = G.width, H = G.depth, SPAN = G.span, HALF = SPAN / 2;
  var RAIL_BASE = G.rail_base, RAIL_H = 168.3;
  var SUP_H = 330;                               // floor to soffit on the rollers
  var CRACK_TIP = 197;                           // zero-opening height above the soffit (DIC), updated per burst
  // the current magnified split of the midspan deflection: crack rotation dh, bending de (mm)
  var DEF = { dh: 0, de: 0 };

  /* ------------------------------------------------------------ the record */
  var BK = D.blocks, NMAX = D.meta.n_total, LOOPS = D.loops;
  function blockAt(N) {
    return {
      K: lerpArr(BK.N, BK.K, N), dmin: lerpArr(BK.N, BK.dmin, N), dmax: lerpArr(BK.N, BK.dmax, N),
      pmin: lerpArr(BK.N, BK.pmin, N), pmax: lerpArr(BK.N, BK.pmax, N)
    };
  }
  function loopAt(N) {
    var best = LOOPS[0], bd = Infinity;
    for (var i = 0; i < LOOPS.length; i++) { var d = Math.abs(Math.log((LOOPS[i].N + 1) / (N + 1))); if (d < bd) { bd = d; best = LOOPS[i]; } }
    return best;
  }
  // a point on a recorded cycle: phase 0 = load valley, about 0.5 = peak
  function cyclePoint(N, ph) {
    var b = blockAt(N), L = loopAt(N);
    var n = L.P.length, u = ((ph % 1) + 1) % 1 * n, i = Math.floor(u), f = u - i;
    var pn = lerp(L.P[i % n], L.P[(i + 1) % n], f), dn = lerp(L.d[i % n], L.d[(i + 1) % n], f);
    return { P: lerp(b.pmin, b.pmax, pn), d: lerp(b.dmin, b.dmax, dn), K: b.K, r: clamp01(pn), dmin: b.dmin };
  }

  /* ------------------------------------------------------------ the timeline, cycles only */
  var TL = { fat: 44.0, hold: 4.0 };
  TL.total = TL.fat + TL.hold;
  var VIS_HZ = D.meta.freq_hz;                     // cycles drawn at the real 4 Hz; the count fast-forwards
  var GAMMA = 1.35;
  function nAt(u) { return Math.min(NMAX, Math.round(Math.pow(clamp01(u), GAMMA) * NMAX)); }
  function stateAt(t) {
    var N, ph = t * VIS_HZ;
    if (t < TL.fat) N = nAt(t / TL.fat);
    else N = NMAX;
    var c = cyclePoint(N, ph);
    return { t: t, P: c.P, d: c.d, dmin: c.dmin, N: N, K: c.K, r: c.r, w: crackWidth(N, c.r), end: t >= TL.fat };
  }

  /* ------------------------------------------------------------ crack path from the DIC */
  var DIC = D.dic, DB = DIC.bursts;
  function burstAt(N) {                          // the recorded burst nearest this cycle count
    var best = 0;
    for (var i = 1; i < DB.length; i++) if (Math.abs(DB[i].N - N) < Math.abs(DB[best].N - N)) best = i;
    return best;
  }
  function crackWidth(N, r) {                    // bottom crack width (mm) at load ratio r, measured curve
    var b = DB[burstAt(N)], g = b.g, u = clamp01(r) * (g.length - 1), i = Math.min(g.length - 2, Math.floor(u));
    return b.dw * lerp(g[i], g[i + 1], u - i);
  }
  var CR = (function () {
    var ys = DIC.path.map(function (p) { return p[1]; }), xs = DIC.path.map(function (p) { return p[0]; });
    var xb = xs[0], xt = xs[xs.length - 1], yt = ys[ys.length - 1];
    return {
      at: function (y) {
        if (y <= ys[0]) return xb;
        if (y >= yt) return lerp(xt, 0, smooth((y - yt) / (H - yt)));
        return lerpArr(ys, xs, y);
      }
    };
  })();

  // elastic three-point bending shape, 1 at midspan, 0 on the supports, rigid overhangs rising
  function elastic(x) {
    var ax = Math.abs(x);
    if (ax <= HALF) { var a = HALF - ax; return a * (3 * SPAN * SPAN - 4 * a * a) / (SPAN * SPAN * SPAN); }
    return -1.5 * (ax - HALF) / HALF;
  }

  // Displacement of a rest point (x, y above the soffit) of one half (side -1 left, +1 right)
  // for a midspan deflection dd (mm, magnified). Each half turns about the crack tip, the left
  // half clockwise and the right half anticlockwise, and drops by the tip deflection, so the
  // supports stay on their rollers and only the span bends.
  function displace(x, y, side, dd, out) {
    var dh = DEF.dh, de = DEF.de;
    var th = dh / HALF;
    var xt = CR.at(CRACK_TIP), yt = CRACK_TIP;
    var rx = x - xt, ry = y - yt;
    var c = Math.cos(th), s = -side * Math.sin(th);
    out.x = xt + rx * c + ry * s;
    out.y = yt - rx * s + ry * c - dh - de * elastic(x);
    return out;
  }

  /* ------------------------------------------------------------ textures */
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function noiseLayer(g, w, h, rnd, cell, amp) {
    var cols = Math.ceil(w / cell) + 2, rows = Math.ceil(h / cell) + 2, grid = [];
    for (var i = 0; i < cols * rows; i++) grid.push(rnd());
    var img = g.getImageData(0, 0, w, h), a = img.data;
    for (var y = 0; y < h; y++) {
      var gy = y / cell, iy = Math.floor(gy), fy = gy - iy; fy = fy * fy * (3 - 2 * fy);
      for (var x = 0; x < w; x++) {
        var gx = x / cell, ix = Math.floor(gx), fx = gx - ix; fx = fx * fx * (3 - 2 * fx);
        var v00 = grid[iy * cols + ix], v10 = grid[iy * cols + ix + 1], v01 = grid[(iy + 1) * cols + ix], v11 = grid[(iy + 1) * cols + ix + 1];
        var v = (lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy) - 0.5) * amp;
        var k = 4 * (y * w + x);
        a[k] += v; a[k + 1] += v; a[k + 2] += v;
      }
    }
    g.putImageData(img, 0, 0);
  }
  function concreteMaps(seed, base) {
    var S = 1024, cv = canvas(S, S), g = cv.getContext('2d', { willReadFrequently: true }), rnd = mulberry32(seed);
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    noiseLayer(g, S, S, rnd, 180, 22);
    noiseLayer(g, S, S, rnd, 40, 12);
    noiseLayer(g, S, S, rnd, 6, 14);
    var bump = canvas(S, S), gb = bump.getContext('2d', { willReadFrequently: true });
    gb.fillStyle = '#808080'; gb.fillRect(0, 0, S, S);
    for (var p = 0; p < 420; p++) {                 // bug holes, a darker pit with a lip
      var x = rnd() * S, y = rnd() * S, r = 0.6 + Math.pow(rnd(), 4) * 5;
      g.fillStyle = 'rgba(58,56,52,' + (0.45 + rnd() * 0.4) + ')';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      gb.fillStyle = '#1a1a1a'; gb.beginPath(); gb.arc(x, y, r, 0, Math.PI * 2); gb.fill();
    }
    for (var q = 0; q < 2600; q++) {                // sand grains
      var gx = rnd() * S, gy = rnd() * S, l = 150 + rnd() * 90;
      g.fillStyle = 'rgba(' + l + ',' + (l - 4) + ',' + (l - 12) + ',' + (0.25 + rnd() * 0.3) + ')';
      g.fillRect(gx, gy, 1.5, 1.5);
    }
    noiseLayer(gb, S, S, rnd, 8, 40);
    var map = new T.CanvasTexture(cv), bm = new T.CanvasTexture(bump);
    [map, bm].forEach(function (t) { t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 8; });
    map.colorSpace = T.SRGBColorSpace;
    return { map: map, bump: bm };
  }
  function rustMap(seed) {
    var S = 512, cv = canvas(S, S), g = cv.getContext('2d', { willReadFrequently: true }), rnd = mulberry32(seed);
    g.fillStyle = '#6e3f24'; g.fillRect(0, 0, S, S);
    noiseLayer(g, S, S, rnd, 60, 40); noiseLayer(g, S, S, rnd, 9, 30);
    for (var i = 0; i < 1400; i++) { g.fillStyle = 'rgba(' + (120 + rnd() * 60) + ',' + (60 + rnd() * 30) + ',30,' + rnd() * 0.5 + ')'; g.fillRect(rnd() * S, rnd() * S, 2, 2); }
    var t = new T.CanvasTexture(cv); t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace; return t;
  }
  function holesMap(faceW) {
    // column holes from the frame drawing: 1 in holes at 6 in centres, two rows 4 in apart;
    // tile = face width x 12 in (two pitches)
    var W = 256, Hh = Math.round(256 * 304.8 / faceW), cv = canvas(W, Hh), g = cv.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#c1c4c7'; g.fillRect(0, 0, W, Hh);
    var rnd = mulberry32(4); noiseLayer(g, W, Hh, rnd, 40, 9); noiseLayer(g, W, Hh, rnd, 4, 6);
    var px = W / faceW, r = 12.7 * px;
    for (var j = 0; j < 2; j++) {
      [W / 2 - 50.8 * px, W / 2 + 50.8 * px].forEach(function (x) {
        var y = (76.2 + j * 152.4) * px;
        g.fillStyle = '#1c1f22'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r + 1.5, 0.5, 2.5); g.stroke();
        g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r + 1.5, 3.6, 5.6); g.stroke();
      });
    }
    var t = new T.CanvasTexture(cv); t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; return t;
  }
  function floorMap() {
    var S = 1024, cv = canvas(S, S), g = cv.getContext('2d', { willReadFrequently: true }), rnd = mulberry32(12);
    g.fillStyle = '#4a4e53'; g.fillRect(0, 0, S, S);
    noiseLayer(g, S, S, rnd, 260, 26); noiseLayer(g, S, S, rnd, 50, 12); noiseLayer(g, S, S, rnd, 5, 10);
    for (var s = 0; s < 14; s++) {                    // stains
      var x = rnd() * S, y = rnd() * S, r = 40 + rnd() * 160;
      var gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(20,20,22,' + (0.12 + rnd() * 0.18) + ')'); gr.addColorStop(1, 'rgba(20,20,22,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    // strong-floor anchor holes on a 2 ft grid (texture repeats every 1220 mm)
    [[256, 256], [768, 256], [256, 768], [768, 768]].forEach(function (p) {
      g.fillStyle = '#17191b'; g.beginPath(); g.arc(p[0], p[1], 20, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(160,166,172,.35)'; g.lineWidth = 4; g.beginPath(); g.arc(p[0], p[1], 30, 0, Math.PI * 2); g.stroke();
    });
    var t = new T.CanvasTexture(cv); t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; return t;
  }
  function speckleTexture(wmm, hmm, seed) {
    var ppm = 2.4, w = Math.round(wmm * ppm), h = Math.round(hmm * ppm);
    var cv = canvas(w, h), g = cv.getContext('2d', { willReadFrequently: true }), rnd = mulberry32(seed);
    g.fillStyle = '#f2f1ec'; g.fillRect(0, 0, w, h);
    noiseLayer(g, w, h, rnd, 20, 8);
    g.fillStyle = '#1b1d20';
    var n = Math.round(wmm * hmm / 16);
    for (var i = 0; i < n; i++) {
      var r = (0.9 + rnd() * 0.8) * ppm;
      g.beginPath(); g.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2); g.fill();
    }
    for (var p = 0; p < 60; p++) {                   // a few pores show through the paint
      g.fillStyle = 'rgba(70,68,64,.8)'; g.beginPath(); g.arc(rnd() * w, rnd() * h, 1 + rnd() * 4, 0, Math.PI * 2); g.fill();
    }
    var t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; return t;
  }

  /* ------------------------------------------------------------ mesh helpers */
  function std(color, extra) {
    var o = { color: color, roughness: 0.7, metalness: 0.05 };
    if (extra) for (var k in extra) o[k] = extra[k];
    return new T.MeshStandardMaterial(o);
  }
  function box(w, h, d, m) { return new T.Mesh(new T.BoxGeometry(w, h, d), m); }
  function cyl(rt, rb, h, m, seg) { return new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg || 24), m); }
  function shadowy(o) { o.traverse(function (m) { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; }
  // wide-flange section as a group, length along z
  function wshape(len, d, bf, tf, tw, mat) {
    var g = new T.Group();
    var f1 = box(bf, tf, len, mat); f1.position.y = tf / 2; g.add(f1);
    var f2 = box(bf, tf, len, mat); f2.position.y = d - tf / 2; g.add(f2);
    var w = box(tw, d - 2 * tf, len, mat); w.position.y = d / 2; g.add(w);
    return g;
  }

  // A deformable grid surface; param(u, v) gives the rest point, side fixes its half.
  function Surface(nu, nv, param, side, mat, uvFn) {
    this.side = side;
    var n = (nu + 1) * (nv + 1);
    this.rest = new Float32Array(n * 3);
    var pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
    for (var j = 0; j <= nv; j++) {
      for (var i = 0; i <= nu; i++) {
        var k = j * (nu + 1) + i, p = param(i / nu, j / nv);
        this.rest[3 * k] = p.x; this.rest[3 * k + 1] = p.y; this.rest[3 * k + 2] = p.z;
        pos[3 * k] = p.x; pos[3 * k + 1] = p.y; pos[3 * k + 2] = p.z;
        var q = uvFn ? uvFn(p, i / nu, j / nv) : [i / nu, j / nv];
        uv[2 * k] = q[0]; uv[2 * k + 1] = q[1];
        if (i < nu && j < nv) { var a = k, b = k + 1, c = k + nu + 1, d = k + nu + 2; idx.push(a, b, d, a, d, c); }
      }
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.geo = g;
    this.mesh = new T.Mesh(g, mat);
  }
  Surface.prototype.update = function (dd, lift) {
    var P = this.geo.attributes.position.array, R = this.rest, o = { x: 0, y: 0 };
    for (var k = 0; k < R.length; k += 3) {
      displace(R[k], R[k + 1], this.side, dd, o);
      P[k] = o.x; P[k + 1] = o.y + lift; P[k + 2] = R[k + 2];
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  };
  Surface.prototype.flip = function () {
    var ix = this.geo.index.array;
    for (var i = 0; i < ix.length; i += 3) { var t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    this.geo.index.needsUpdate = true;
    this.geo.computeVertexNormals();
    return this;
  };

  /* ------------------------------------------------------------ the view */
  function Twin(el) {
    this.el = el;
    this.view = VIEW0;
    this.mag = MAG0;
    this.dic = true;
    this.playing = !STILL;
    this.speed = 1;
    this.t = 0; this.last = null;
  }

  Twin.prototype.build = function () {
    var el = this.el;
    try {
      this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: STILL });
    } catch (err) { return false; }
    var r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setClearColor(0x000000, 0);
    r.toneMapping = T.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = T.PCFSoftShadowMap;
    r.domElement.className = 'twin-gl';
    el.insertBefore(r.domElement, el.firstChild);

    var scene = this.scene = new T.Scene();
    scene.fog = new T.Fog(0x12161b, 7000, 16000);
    this.camera = new T.PerspectiveCamera(32, 1, 8, 60000);
    this.buildEnvironment();

    scene.add(new T.HemisphereLight(0xcfd8e2, 0x1b1a19, 0.55));
    var key = new T.SpotLight(0xfff0dc, 4.6e6, 0, 0.6, 0.6, 1.6);   // a high bay light over the rig
    key.position.set(-1500, 5600, 2400);
    key.target.position.set(0, 500, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 2000; key.shadow.camera.far = 9500;
    key.shadow.bias = -0.0002; key.shadow.normalBias = 1.5;
    scene.add(key); scene.add(key.target);
    var fill = new T.DirectionalLight(0xdfe7f2, 0.55); fill.position.set(3500, 1600, 3800); scene.add(fill);
    var rim = new T.DirectionalLight(0x8fb4ff, 0.7); rim.position.set(2500, 2200, -4200); scene.add(rim);
    var dicLamp = new T.SpotLight(0xfff6ea, 9e5, 3600, 0.5, 0.8, 1.6);          // the LED panel on the patch
    dicLamp.position.set(900, 980, B / 2 + 900);
    dicLamp.target.position.set(0, SUP_H + 80, B / 2);
    scene.add(dicLamp); scene.add(dicLamp.target);

    this.buildFloor();
    this.buildFrame();
    this.buildSupports();
    this.buildSlab();
    this.buildRail();
    this.buildActuator();
    this.buildInstruments();
    this.buildFibres();

    el.classList.add('is-3d');
    var self = this;
    this.ro = new ResizeObserver(function () { self.resize(); kick(); });
    this.ro.observe(el);
    this.resize();
    this.bindDrag();
    this.bindControls();
    this.setView(this.view, true);
    if (NFIX !== null) this.t = NFIX >= NMAX ? TL.fat + 0.5 : TL.fat * Math.pow(clamp01(NFIX / NMAX), 1 / GAMMA);
    if (PHFIX !== null) this.phFix = PHFIX;
    return true;
  };

  // soft reflections for the steel, from a dim studio with a few light panels
  Twin.prototype.buildEnvironment = function () {
    var env = new T.Scene();
    env.background = new T.Color(0x16191d);
    var panel = function (w, h, x, y, z, ry, rx, c) {
      var m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: c, side: T.DoubleSide }));
      m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); env.add(m);
    };
    panel(6, 1.2, 0, 5, 0, 0, Math.PI / 2, 0xffffff);
    panel(6, 1.2, 0, 5, 3, 0, Math.PI / 2, 0xdfe6ee);
    panel(3, 4, -6, 2, 0, Math.PI / 2, 0, 0x9aa6b3);
    panel(3, 4, 6, 2, 1, -Math.PI / 2, 0, 0x6d5a48);
    panel(12, 3, 0, -1.5, 0, 0, Math.PI / 2, 0x2a2c2f);
    var pm = new T.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(env, 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pm.dispose();
  };

  function blockWallMap() {
    var W = 1024, Hh = 1024, cv = canvas(W, Hh), g = cv.getContext('2d', { willReadFrequently: true }), rnd = mulberry32(31);
    g.fillStyle = '#2c2f33'; g.fillRect(0, 0, W, Hh);
    var bw = W / 2.5, bh = Hh / 5;                    // 16 x 8 in blocks, running bond
    for (var r = 0; r < 5; r++) {
      for (var c = -1; c < 3; c++) {
        var x = c * bw + (r % 2 ? bw / 2 : 0), y = r * bh;
        var l = 60 + rnd() * 14;
        g.fillStyle = 'rgb(' + l + ',' + (l + 2) + ',' + (l + 5) + ')';
        g.fillRect(x + 6, y + 6, bw - 12, bh - 12);
      }
    }
    noiseLayer(g, W, Hh, rnd, 12, 10);
    var t = new T.CanvasTexture(cv); t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.SRGBColorSpace; return t;
  }

  Twin.prototype.buildFloor = function () {
    var wall = blockWallMap();
    wall.repeat.set(16000 / 1016, 6000 / 1016);
    var wm = std(0xffffff, { map: wall, roughness: 0.95 });
    var back = new T.Mesh(new T.PlaneGeometry(16000, 6000), wm); back.position.set(0, 3000, -4200); back.receiveShadow = true; this.scene.add(back);
    var side = new T.Mesh(new T.PlaneGeometry(12000, 6000), wm.clone()); side.material.map = wall.clone(); side.material.map.repeat.set(12000 / 1016, 6000 / 1016); side.material.map.needsUpdate = true;
    side.position.set(5200, 3000, 0); side.rotation.y = -Math.PI / 2; this.scene.add(side);

    var tex = floorMap(), size = 26000;
    tex.repeat.set(size / 1220, size / 1220);
    var floor = new T.Mesh(new T.PlaneGeometry(size, size), std(0xffffff, { map: tex, roughness: 0.82, metalness: 0.02 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
  };

  // Reaction frame, dimensions from the "55 kips Load Frame" drawing (X. Bai, 2019-03-09):
  // two 8 in perforated columns 121.5 in tall on 15 in base plates, 88.4 in clear between them,
  // a crosshead of two 18 in beams 16.9 in apart, and the actuator mounting beam on top of them.
  // The actuator hangs from that beam through the gap between the two crosshead beams.
  Twin.prototype.buildFrame = function () {
    var scene = this.scene;
    var IN = 25.4;
    var colW = 8 * IN, colH = 121.5 * IN, gz = (88.44 / 2 + 4) * IN;
    var holes = holesMap(colW);
    holes.repeat.set(1, colH / (12 * IN));
    var paint = std(0xffffff, { map: holes, roughness: 0.55, metalness: 0.25 });
    var grey = std(0xbfc2c5, { roughness: 0.5, metalness: 0.3 });
    var dark = std(0x2d3033, { metalness: 0.7, roughness: 0.4 });
    [-1, 1].forEach(function (s) {
      var c = box(colW, colH, colW, paint); c.position.set(0, colH / 2, s * gz); scene.add(shadowy(c));
      var base = box(15 * IN, 38, 15 * IN, grey); base.position.set(0, 19, s * gz); scene.add(shadowy(base));
      for (var k = 0; k < 4; k++) {
        var bolt = cyl(14, 14, 36, dark); bolt.position.set((k % 2 ? 1 : -1) * 150, 50, s * gz + (k < 2 ? 1 : -1) * 150); scene.add(bolt);
      }
    });
    this.crossY = 1970;                               // underside of the actuator mounting beam
    var d = 18 * IN, tf = 1.4375 * IN, bf = 7.5 * IN, len = 2 * gz + colW + 60;
    var beamMat = std(0xbdc0c3, { roughness: 0.5, metalness: 0.3 });
    [-1, 1].forEach(function (s) {
      var g = new T.Group();
      var f1 = box(bf, tf, len, beamMat); f1.position.y = tf / 2; g.add(f1);
      var f2 = box(bf, tf, len, beamMat); f2.position.y = d - tf / 2; g.add(f2);
      var w = box(13, d - 2 * tf, len, beamMat); w.position.y = d / 2; g.add(w);
      for (var k = -3; k <= 3; k++) {                 // stiffeners
        var st = box(bf - 20, d - 2 * tf, 12, beamMat); st.position.set(0, d / 2, k * 330); g.add(st);
      }
      g.position.set(s * 16.9 / 2 * IN, this.crossY - d, 0);
      scene.add(shadowy(g));
      // bolted to the column through spacer plates
      [-1, 1].forEach(function (t) {
        var pl = box(s * (16.9 / 2 * IN) - s * colW / 2 - s * bf / 2 === 0 ? 10 : Math.abs(16.9 / 2 * IN - colW / 2 - bf / 2) + 2, d - 60, colW + 40, grey);
        pl.position.set(s * (colW / 2 + (16.9 / 2 * IN - colW / 2 - bf / 2) / 2), this.crossY - d / 2, t * gz);
        scene.add(shadowy(pl));
      }, this);
    }, this);
    var mb = new T.Group();                            // actuator mounting beam across the crosshead
    var mf1 = box(56.13 * IN, 22, 12.125 * IN, beamMat); mf1.position.y = 11; mb.add(mf1);
    var mf2 = box(56.13 * IN, 22, 12.125 * IN, beamMat); mf2.position.y = 300 - 11; mb.add(mf2);
    var mw = box(56.13 * IN, 256, 16, beamMat); mw.position.y = 150; mb.add(mw);
    mb.position.set(0, this.crossY, 0);
    scene.add(shadowy(mb));
    var bolts = [[-80, -80], [80, -80], [-80, 80], [80, 80]];
    bolts.forEach(function (b) { var bl = cyl(11, 11, 60, dark); bl.position.set(b[0], this.crossY + 12, b[1]); scene.add(bl); }, this);
  };

  Twin.prototype.buildSupports = function () {
    var scene = this.scene;
    var grey = std(0x8c9298, { roughness: 0.55, metalness: 0.35 }), steel = std(0xc9cdd1, { roughness: 0.25, metalness: 0.85 });
    [-1, 1].forEach(function (s) {
      var x = s * HALF;
      var w = wshape(1300, 254, 204, 16, 10, grey);          // W10 across the slab width
      w.position.set(x, 26, 0); scene.add(shadowy(w));
      var bp = box(360, 26, 1400, grey); bp.position.set(x, 13, 0); scene.add(shadowy(bp));
      for (var k = -2; k <= 2; k++) { var st = box(10, 222, 90, grey); st.position.set(x + 50, 26 + 127, k * 250); scene.add(shadowy(st)); var st2 = st.clone(); st2.position.x = x - 50; scene.add(st2); }
      var roll = cyl(25.4, 25.4, 1180, steel, 32); roll.rotation.x = Math.PI / 2; roll.position.set(x, SUP_H - 25.4, 0); scene.add(shadowy(roll));
    });
  };

  Twin.prototype.buildSlab = function () {
    var scene = this.scene, self = this;
    var cm = concreteMaps(3, '#c9c5bd');
    var cmat = std(0xffffff, { map: cm.map, bumpMap: cm.bump, bumpScale: 1.4, roughness: 0.94, metalness: 0 });
    cm.map.repeat.set(1, 1); cm.bump.repeat.set(1, 1);
    var cut = function (y) { return CR.at(y); };
    this.surfaces = [];
    var NX = 48, NY = 10, NZ = 10, TEX = 1100;             // texture tile 1.1 m
    [-1, 1].forEach(function (side) {
      var xo = side * LEN / 2;
      function xs(u, y) { var w = 1 - Math.pow(1 - u, 1.7); return lerp(xo, cut(y), w); }
      function add(s, flip) { if (flip) s.flip(); s.mesh.castShadow = true; s.mesh.receiveShadow = true; scene.add(s.mesh); self.surfaces.push(s); }
      var uvS = function (p) { return [p.x / TEX + 0.37, p.y / TEX]; };
      var uvT = function (p) { return [p.x / TEX + 0.11, p.z / TEX + 0.5]; };
      var uvE = function (p) { return [p.z / TEX + 0.23, p.y / TEX + 0.7]; };
      add(new Surface(NX, NY, function (u, v) { var y = v * H; return { x: xs(u, y), y: y, z: B / 2 }; }, side, cmat, uvS), side > 0);
      add(new Surface(NX, NY, function (u, v) { var y = v * H; return { x: xs(u, y), y: y, z: -B / 2 }; }, side, cmat, uvS), side < 0);
      add(new Surface(NX, NZ, function (u, v) { return { x: xs(u, 0), y: 0, z: lerp(-B / 2, B / 2, v) }; }, side, cmat, uvT), side > 0);
      add(new Surface(NX, NZ, function (u, v) { return { x: xs(u, H), y: H, z: lerp(-B / 2, B / 2, v) }; }, side, cmat, uvT), side < 0);
      add(new Surface(NZ, NY, function (u, v) { return { x: xo, y: v * H, z: lerp(-B / 2, B / 2, u) }; }, side, cmat, uvE), side > 0);
      var crackMat = new T.MeshBasicMaterial({ color: 0x121315 });
      add(new Surface(NZ, NY * 3, function (u, v) { var y = v * H; return { x: cut(y), y: y, z: lerp(-B / 2, B / 2, u) }; }, side, crackMat, uvE), side < 0);
    });

    // a dark sheet inside the slab behind the crack, so the opened gap reads dark, not see-through
    var shMat = new T.MeshBasicMaterial({ color: 0x0b0c0e, side: T.DoubleSide });
    this.crackSheets = [-1, 1].map(function (zs) {
      var m = new T.Mesh(new T.PlaneGeometry(90, 1), shMat);
      m.position.z = zs * (B / 2 - 6);
      scene.add(m);
      return m;
    });

    // speckle patch on the lower front face at midspan, and the DIC band over it
    var PW = 610, PH = 168;
    this.patch = { w: PW, h: PH };
    var spMat = std(0xffffff, { map: speckleTexture(PW, PH, 5), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    var g = DIC.grid;
    this.dicTex = DB.map(function (b) {
      var data = new Uint8Array(g.w * g.h * 4);
      for (var j = 0; j < g.h; j++) for (var i = 0; i < g.w; i++) {
        var v = b.u8[(g.h - 1 - j) * g.w + i], k = 4 * (j * g.w + i);
        data[k] = v; data[k + 1] = v; data[k + 2] = v; data[k + 3] = 255;
      }
      var t = new T.DataTexture(data, g.w, g.h, T.RGBAFormat);
      t.magFilter = T.LinearFilter; t.minFilter = T.LinearFilter; t.needsUpdate = true;
      return t;
    });
    this.dicUniforms = { field: { value: this.dicTex[DB.length - 1] }, amp: { value: 0 }, on: { value: 1 },
      aoi: { value: new T.Vector4(DIC.aoi.x0, DIC.aoi.y0, DIC.aoi.w, DIC.aoi.h) } };
    var dicMat = new T.ShaderMaterial({
      uniforms: this.dicUniforms, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      vertexShader: 'attribute vec2 rest2; varying vec2 vR; void main(){ vR = rest2; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: [
        'uniform sampler2D field; uniform float amp; uniform float on; uniform vec4 aoi; varying vec2 vR;',
        'vec3 ramp(float s){',
        '  vec3 c0=vec3(0.23,0.12,0.70), c1=vec3(0.05,0.55,0.95), c2=vec3(0.15,0.85,0.35), c3=vec3(1.0,0.85,0.1), c4=vec3(0.98,0.16,0.10);',
        '  if(s<0.25) return mix(c0,c1,s/0.25); if(s<0.5) return mix(c1,c2,(s-0.25)/0.25);',
        '  if(s<0.75) return mix(c2,c3,(s-0.5)/0.25); return mix(c3,c4,(s-0.75)/0.25); }',
        'void main(){',
        '  vec2 uv = vec2((vR.x-aoi.x)/aoi.z, (vR.y-aoi.y)/aoi.w);',
        '  if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0||on<0.5) discard;',
        '  float f = texture2D(field, uv).r * amp;',
        '  float edge = smoothstep(0.0,0.05,uv.x)*smoothstep(1.0,0.95,uv.x)*smoothstep(0.0,0.05,uv.y)*smoothstep(1.0,0.95,uv.y);',
        '  float a = mix(0.1, 0.9, smoothstep(0.04,0.32,f)) * edge;',
        '  gl_FragColor = vec4(ramp(clamp(f,0.0,1.0)), a);',
        '}'].join('\n')
    });
    [-1, 1].forEach(function (side) {
      function xs(u, y) { var xc = cut(y), xo = side * PW / 2; return lerp(xo, xc, u); }
      var z = B / 2 + 0.8;
      var s1 = new Surface(28, 10, function (u, v) { var y = v * PH; return { x: xs(u, y), y: y, z: z }; }, side, spMat,
        function (p) { return [(p.x + PW / 2) / PW, p.y / PH]; });
      if (side > 0) s1.flip();
      s1.mesh.receiveShadow = true;
      scene.add(s1.mesh); self.surfaces.push(s1);
      var s2 = new Surface(40, 16, function (u, v) { var y = v * PH; return { x: xs(u, y), y: y, z: z + 0.6 }; }, side, dicMat, null);
      if (side > 0) s2.flip();
      var R = s2.rest, r2 = new Float32Array(R.length / 3 * 2);
      for (var k2 = 0, q = 0; k2 < R.length; k2 += 3, q += 2) { r2[q] = R[k2]; r2[q + 1] = R[k2 + 1]; }
      s2.geo.setAttribute('rest2', new T.BufferAttribute(r2, 2));
      s2.mesh.renderOrder = 3;
      scene.add(s2.mesh); self.surfaces.push(s2);
    });
  };

  // 115RE rail, half profile from the base centre (mm), extruded along x
  function railShape(grow) {
    var e = grow || 0;
    var p = [[0, -e], [69.85 + e, -e], [69.85 + e, 11.1], [17, 26], [7.94 + e, 36], [7.94 + e, 118], [15, 124 + e], [34.5 + e, 129], [34.5 + e, 158], [30, 165.5], [20, 168.3], [0, 168.3]];
    var s = new T.Shape();
    s.moveTo(p[0][0], p[0][1]);
    for (var i = 1; i < p.length; i++) s.lineTo(p[i][0], p[i][1]);
    for (var j = p.length - 2; j > 0; j--) s.lineTo(-p[j][0], p[j][1]);
    s.closePath();
    return s;
  }

  Twin.prototype.buildRail = function () {
    var scene = this.scene;
    var over = 300, L = LEN + 2 * over, NS = 140;
    var geo = new T.ExtrudeGeometry(railShape(0), { depth: L, steps: NS, bevelEnabled: false });
    geo.rotateY(Math.PI / 2);
    geo.translate(-L / 2, 0, 0);
    // UVs along the rail so the rust reads along its length
    var pos = geo.attributes.position, uv = geo.attributes.uv;
    for (var i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 600, (pos.getY(i) + pos.getZ(i)) / 300);
    var rust = rustMap(8); rust.repeat.set(1, 1);
    var sideMat = std(0xffffff, { map: rust, roughness: 0.72, metalness: 0.45 });
    var endMat = std(0x8f8a84, { roughness: 0.45, metalness: 0.7 });
    var m = new T.Mesh(geo, [endMat, sideMat]);
    m.castShadow = true; m.receiveShadow = true;
    this.rail = { mesh: m, geo: geo, rest: Float32Array.from(geo.attributes.position.array) };
    scene.add(m);
    // polished running surface on the head
    var headGeo = new T.BoxGeometry(L, 1.2, 56, NS, 1, 1);
    headGeo.translate(0, RAIL_H + 0.2, 0);
    var head = new T.Mesh(headGeo, std(0xd7dadd, { roughness: 0.22, metalness: 0.95 }));
    this.head = { mesh: head, geo: headGeo, rest: Float32Array.from(headGeo.attributes.position.array) };
    scene.add(head);
    // the rubber boot at each slab end and its lip along the slot at the top
    var bootMat = std(0x121315, { roughness: 0.9 });
    var bootGeo = new T.ExtrudeGeometry(railShape(9), { depth: 6, bevelEnabled: false });
    bootGeo.rotateY(Math.PI / 2);
    this.boots = [];
    [-1, 1].forEach(function (s) {
      var b = new T.Mesh(bootGeo, bootMat);
      b.userData.x = s * (LEN / 2) - (s > 0 ? 0 : 6);
      scene.add(b); this.boots.push(b);
    }, this);
    // the black lip of the boot either side of the rail head, drawn as strips on the slab top
    // so they bend with it (rigid bars floated above the surface as the slab deflected)
    var self = this;
    [-1, 1].forEach(function (side) {
      var xo = side * LEN / 2;
      [-1, 1].forEach(function (zs) {
        var z0 = zs * 36, z1 = zs * 47;
        var srf = new Surface(60, 1, function (u, v) {
          var w = 1 - Math.pow(1 - u, 1.7), x = lerp(xo, CR.at(H), w);
          return { x: x, y: H + 1.2, z: lerp(z0, z1, v) };
        }, side, bootMat, null);
        // face upward whichever way the strip was laid out
        if ((side < 0) === (zs > 0)) srf.flip();
        srf.mesh.receiveShadow = true;
        scene.add(srf.mesh);
        self.surfaces.push(srf);
      });
    });
  };

  Twin.prototype.buildActuator = function () {
    var scene = this.scene;
    var black = std(0x17191c, { roughness: 0.42, metalness: 0.5 }), chrome = std(0xe3e6e8, { roughness: 0.08, metalness: 1 });
    var blue = std(0x1d61b8, { roughness: 0.32, metalness: 0.35 }), boxSteel = std(0x7a5a3c, { roughness: 0.55, metalness: 0.6 });
    var wood = std(0xd0ab74, { roughness: 0.9 }), label = std(0xe9ecef, { roughness: 0.6 });
    // moving part, origin on the rail head: loading box, stud, load cell
    var mv = new T.Group();
    var bx = box(140, 120, 140, boxSteel); bx.position.y = 60; mv.add(bx);
    [-1, 1].forEach(function (s) {
      var h = cyl(16, 16, 142, std(0x111214, { roughness: 0.6 })); h.rotation.x = Math.PI / 2; h.position.set(s * 35, 85, 0); mv.add(h);
    });
    var top = box(170, 22, 170, boxSteel); top.position.y = 131; mv.add(top);
    var stud = cyl(24, 24, 70, black, 6); stud.position.y = 177; mv.add(stud);
    var lc = cyl(82, 82, 72, blue, 40); lc.position.y = 248; mv.add(lc);
    var lab = box(60, 22, 2, label); lab.position.set(0, 250, 82); mv.add(lab);
    var cable = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(70, 250, 40), new T.Vector3(260, 300, 160), new T.Vector3(420, 700, 300)]), 20, 4, 6), black);
    mv.add(cable);
    this.moveTop = 284;
    // wooden cage around the box and the two pipe clamps across the slab
    var cage = new T.Group();
    [[-122, 0, 104, 56, 330], [122, 0, 104, 56, 330], [0, -150, 150, 56, 100], [0, 150, 150, 56, 100]].forEach(function (c) {
      var b = box(c[2], c[3], c[4], wood); b.position.set(c[0], c[3] / 2, c[1]); cage.add(b);
    });
    var pipe = std(0x1e2023, { roughness: 0.45, metalness: 0.7 }), red = std(0xd02a22, { roughness: 0.45, metalness: 0.15 });
    [-150, 150].forEach(function (x) {
      var p = cyl(13.5, 13.5, B + 480, pipe); p.rotation.x = Math.PI / 2; p.position.set(x, 70, 0); cage.add(p);
      [-1, 1].forEach(function (s) {
        var j = box(58, 110, 50, red); j.position.set(x, 30, s * (B / 2 + 36)); cage.add(j);
        var jaw = box(40, 24, 30, red); jaw.position.set(x, -20, s * (B / 2 + 18)); cage.add(jaw);
        if (s > 0) {
          var scr = cyl(9, 9, 130, chrome); scr.rotation.x = Math.PI / 2; scr.position.set(x, 30, B / 2 + 110); cage.add(scr);
          var hnd = cyl(7, 7, 150, pipe); hnd.position.set(x, 30, B / 2 + 175); cage.add(hnd);
          var kb = new T.Mesh(new T.SphereGeometry(16, 12, 10), pipe); kb.position.set(x, 105, B / 2 + 175); cage.add(kb);
        }
      });
    });
    [-1, 1].forEach(function (s) {                         // flat steel straps along the rail
      var st = box(520, 6, 38, pipe); st.position.set(0, 3, s * 95); cage.add(st);
    });
    this.cage = cage;
    // fixed part, hung from the crosshead: mount, body with end caps, manifold, servo valve
    var fx = new T.Group(), y = this.crossY;
    var mount = box(260, 40, 260, black); mount.position.y = y - 20; fx.add(mount); y -= 40;
    var capT = box(230, 150, 230, black); capT.position.y = y - 75; fx.add(capT); y -= 150;
    var body = cyl(100, 100, 560, black, 32); body.position.y = y - 280; fx.add(body); y -= 560;
    var capB = box(230, 150, 230, black); capB.position.y = y - 75; fx.add(capB); y -= 150;
    var gland = cyl(62, 62, 40, std(0x2a2d31, { metalness: 0.6, roughness: 0.35 })); gland.position.y = y - 20; fx.add(gland); y -= 40;
    this.bodyBottom = y;
    var man = box(200, 150, 120, black); man.position.set(0, this.crossY - 330, 175); fx.add(man);
    var sv = box(120, 110, 90, std(0x2b3036, { metalness: 0.5, roughness: 0.4 })); sv.position.set(0, this.crossY - 210, 200); fx.add(sv);
    var mts = box(90, 40, 2, label); mts.position.set(0, this.crossY - 330, 236); fx.add(mts);
    var rod = cyl(38, 38, 1, chrome, 32); fx.add(rod); this.rod = rod;
    // hoses from the manifold out to the hydraulic service
    var hose = std(0x0f1012, { roughness: 0.75 });
    [-1, 1].forEach(function (s) {
      var c = new T.CatmullRomCurve3([new T.Vector3(s * 60, this.crossY - 330, 240), new T.Vector3(s * 240, this.crossY - 560, 520), new T.Vector3(s * 420, this.crossY - 150, 640), new T.Vector3(s * 560, this.crossY + 420, 420), new T.Vector3(s * 760, this.crossY + 760, -200)]);
      fx.add(new T.Mesh(new T.TubeGeometry(c, 48, 15, 10), hose));
    }, this);
    [mv, fx, cage].forEach(function (g) { scene.add(shadowy(g)); });
    this.act = mv; this.actFixed = fx;
  };

  Twin.prototype.buildInstruments = function () {
    var scene = this.scene;
    var zinc = std(0xb7bcc1, { metalness: 0.85, roughness: 0.35 }), red = std(0xd8301f, { roughness: 0.5 }), grey = std(0x8a9096, { metalness: 0.4, roughness: 0.5 });
    var body = std(0xcfd3d6, { metalness: 0.5, roughness: 0.4 });
    // two threaded rods on steel blocks, each holding two LVDTs up to the soffit, 4 in from centre
    this.lvdts = [];
    [[-1, 0], [1, 0]].forEach(function (p, i) {
      var g = new T.Group();
      var blk = box(150, 90, 150, grey); blk.position.y = 45; g.add(blk);
      var rod = cyl(10, 10, SUP_H + 40, zinc, 10); rod.position.y = (SUP_H + 40) / 2 + 90; g.add(rod);
      var knob = cyl(20, 20, 16, red, 16); knob.rotation.z = Math.PI / 2; knob.position.set(28, SUP_H - 70, 0); g.add(knob);
      g.position.set(p[0] * 190, 0, i ? 180 : -180);
      scene.add(shadowy(g));
    });
    var spots = [[4 * INCH, 0], [-4 * INCH, 0], [0, 4 * INCH], [0, -4 * INCH]];
    spots.forEach(function (s) {
      var g = new T.Group();
      var clampArm = box(Math.max(20, Math.abs(s[0]) + 40), 12, 12, zinc); clampArm.position.set(0, SUP_H - 150, 0); g.add(clampArm);
      var c = box(24, 110, 24, body); c.position.y = SUP_H - 110; g.add(c);
      var kn = cyl(13, 13, 10, red, 14); kn.rotation.x = Math.PI / 2; kn.position.set(0, SUP_H - 130, 16); g.add(kn);
      var tip = cyl(3, 3, 80, std(0xf0f0f0, { metalness: 0.9, roughness: 0.2 })); tip.position.y = SUP_H - 40; g.add(tip);
      g.position.set(s[0], 0, s[1]);
      g.userData.tip = tip;
      scene.add(shadowy(g));
      this.lvdts.push(g);
    }, this);
    // DIC: one camera on a tripod square to the speckle patch, and an LED panel
    var black = std(0x141518, { roughness: 0.45, metalness: 0.3 }), alu = std(0xa9aeb3, { metalness: 0.8, roughness: 0.35 });
    var tri = new T.Group(), headY = SUP_H + 84;
    for (var i = 0; i < 3; i++) {
      var a = i * Math.PI * 2 / 3 + 0.4, spread = 330;
      var top = new T.Vector3(0, headY - 60, 0), foot = new T.Vector3(Math.cos(a) * spread, 0, Math.sin(a) * spread);
      var len = top.distanceTo(foot), leg = cyl(9, 12, len, alu, 8);
      leg.position.copy(top).add(foot).multiplyScalar(0.5);
      leg.lookAt(foot); leg.rotateX(Math.PI / 2);
      tri.add(leg);
    }
    var headP = box(70, 30, 70, black); headP.position.y = headY - 45; tri.add(headP);
    var cam = box(62, 62, 80, black); cam.position.set(0, headY, 0); tri.add(cam);
    var lens = cyl(30, 34, 90, black, 24); lens.rotation.x = Math.PI / 2; lens.position.set(0, headY, -80); tri.add(lens);
    var glass = cyl(25, 25, 2, std(0x2b4a6a, { metalness: 0.95, roughness: 0.05 })); glass.rotation.x = Math.PI / 2; glass.position.set(0, headY, -126); tri.add(glass);
    tri.position.set(-330, 0, B / 2 + 470);
    tri.rotation.y = -0.5;
    scene.add(shadowy(tri));
    this.dicRig = tri;
    var lt = new T.Group();
    var pole = cyl(10, 10, 1000, black); pole.position.y = 500; lt.add(pole);
    var pnl = box(280, 200, 36, std(0x24282d, { metalness: 0.4, roughness: 0.5 })); pnl.position.y = 980; lt.add(pnl);
    var face = new T.Mesh(new T.PlaneGeometry(250, 170), new T.MeshBasicMaterial({ color: 0xfff4e6 })); face.position.set(0, 980, 19); lt.add(face);
    lt.position.set(900, 0, B / 2 + 900);
    lt.lookAt(0, 980, 0);
    scene.add(shadowy(lt));
  };

  // hooked steel fibres across the crack, only in the crack close-up
  Twin.prototype.buildFibres = function () {
    var rnd = mulberry32(21), g = new T.Group();
    var steel = std(0xa4aab0, { metalness: 0.9, roughness: 0.3 });
    var list = [];
    for (var i = 0; i < 70; i++) {                 // a layer just behind the front face, seen in the gap
      list.push({ y: 6 + rnd() * (CRACK_TIP - 40), z: B / 2 - 3 - rnd() * 22, tilt: (rnd() - 0.5) * 0.8, yaw: (rnd() - 0.5) * 0.9 });
    }
    var geo = new T.CylinderGeometry(0.45, 0.45, 1, 5); geo.rotateZ(Math.PI / 2);
    this.fibres = { list: list, group: g, meshes: [] };
    for (var k = 0; k < list.length; k++) { var m = new T.Mesh(geo, steel); g.add(m); this.fibres.meshes.push(m); }
    g.visible = false;
    this.scene.add(g);
  };

  /* ------------------------------------------------------------ per frame */
  function deformExtruded(obj, dd, lift, yOff) {
    var R = obj.rest, P = obj.geo.attributes.position.array, o = { x: 0, y: 0 }, o2 = { x: 0, y: 0 };
    var xc = CR.at(H);
    for (var k = 0; k < R.length; k += 3) {
      var x = R[k], y = R[k + 1] + yOff, side = x < xc ? -1 : 1;
      displace(x, y, side, dd, o);
      var w = smooth(Math.abs(x - xc) / 170), ox = o.x, oy = o.y;
      if (w < 1) { displace(x, y, -side, dd, o2); var b = 0.5 * (1 - w); ox = lerp(ox, o2.x, b); oy = lerp(oy, o2.y, b); }
      P[k] = ox; P[k + 1] = oy + lift - yOff + yOff; P[k + 2] = R[k + 2];
      P[k + 1] = oy + lift;
    }
    obj.geo.attributes.position.needsUpdate = true;
    obj.geo.computeVertexNormals();
  }

  Twin.prototype.apply = function (st) {
    var dd = st.d * this.mag, lift = SUP_H;
    // crack rotation from the measured bottom crack width, the rest of the deflection as bending
    var bi = burstAt(st.N), b = DB[bi];
    CRACK_TIP = b.h0;
    var rot = st.w / (CRACK_TIP - DIC.gauge_h);                       // relative rotation of the two halves
    var dhReal = clamp(rot / 2 * HALF, 0, Math.max(0, st.d));
    DEF.dh = dhReal * this.mag; DEF.de = (st.d - dhReal) * this.mag;
    if (this.dicUniforms.field.value !== this.dicTex[bi]) this.dicUniforms.field.value = this.dicTex[bi];
    for (var i = 0; i < this.surfaces.length; i++) this.surfaces[i].update(dd, lift);
    deformExtruded(this.rail, dd, lift, RAIL_BASE);
    deformExtruded(this.head, dd, lift, RAIL_BASE);
    var o = { x: 0, y: 0 };
    this.boots.forEach(function (b) {
      var s = b.userData.x < 0 ? -1 : 1;
      displace(s * LEN / 2, RAIL_BASE, s, dd, o);
      b.position.set(b.userData.x, o.y + lift, 0);
    });
    displace(0, H, -1, dd, o);
    var topY = o.y + lift;
    var o2 = { x: 0, y: 0 };
    displace(CR.at(0), 0, -1, dd, o2);                   // the soffit at the crack
    var sheetH = CRACK_TIP - 14;
    this.crackSheets.forEach(function (m) {
      m.scale.y = sheetH;
      m.position.x = CR.at(CRACK_TIP / 2);
      m.position.y = o2.y + lift + 10 + sheetH / 2;
    });
    var railTop = topY + (RAIL_BASE + RAIL_H - H);
    this.act.position.set(0, railTop, 0);
    this.cage.position.set(0, topY, 0);
    var y0 = railTop + this.moveTop, y1 = this.bodyBottom;
    this.rod.scale.y = Math.max(1, y1 - y0);
    this.rod.position.y = (y0 + y1) / 2;
    for (var l = 0; l < this.lvdts.length; l++) {
      var lv = this.lvdts[l];
      displace(lv.position.x, 0, lv.position.x < 0 ? -1 : 1, dd, o);
      lv.userData.tip.position.y = SUP_H - 40 + o.y;
    }
    this.dicUniforms.amp.value = st.w / b.dw;
    this.dicUniforms.on.value = this.dic ? 1 : 0;
    if (this.fibres.group.visible) {
      var F = this.fibres, a = { x: 0, y: 0 }, b2 = { x: 0, y: 0 };
      for (var f = 0; f < F.list.length; f++) {
        var fb = F.list[f], xc2 = CR.at(fb.y);
        displace(xc2 - 24, fb.y - fb.tilt * 10, -1, dd, a); displace(xc2 + 24, fb.y + fb.tilt * 10, 1, dd, b2);
        var m = F.meshes[f], dx = b2.x - a.x, dy = b2.y - a.y, len = Math.hypot(dx, dy);
        m.position.set((a.x + b2.x) / 2, (a.y + b2.y) / 2 + lift, fb.z);
        m.scale.set(len, 1, 1);
        m.rotation.set(0, fb.yaw * 0.3, Math.atan2(dy, dx));
      }
    }
  };

  /* ------------------------------------------------------------ camera */
  var VIEWS = {
    rig: { az: -1.08, el: 0.17, dist: 4500, tx: 150, ty: 760, tz: -60 },
    dic: { az: 0.0, el: 0.02, dist: 560, tx: 20, ty: SUP_H + 86, tz: B / 2 },
    crack: { az: 0.42, el: -0.2, dist: 700, tx: -10, ty: SUP_H + 60, tz: B / 2 - 60 },
    under: { az: 0.36, el: -0.1, dist: 1350, tx: 0, ty: SUP_H - 40, tz: 0 }
  };
  Twin.prototype.setView = function (name, jump) {
    var v = VIEWS[name] || VIEWS.rig;
    this.view = name;
    this.zoom = 1;
    this.goal = { az: v.az, el: v.el, dist: v.dist, tx: v.tx, ty: v.ty, tz: v.tz };
    if (jump || !this.cam) this.cam = { az: v.az, el: v.el, dist: v.dist, tx: v.tx, ty: v.ty, tz: v.tz };
    this.fibres.group.visible = name === 'crack';
    if (this.charts) this.charts.setMode(name === 'crack' || name === 'dic' ? 'crack' : 'defl');
    if (this.viewBtns) this.viewBtns.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-view') === name ? 'true' : 'false'); });
    this.needsFrame = true; kick();
  };
  Twin.prototype.placeCamera = function (dt) {
    var c = this.cam, g = this.goal, k = 1 - Math.exp(-dt * 3.2);
    ['az', 'el', 'dist', 'tx', 'ty', 'tz'].forEach(function (key) { c[key] += (g[key] - c[key]) * k; });
    var d = c.dist * (this.distScale || 1) * (this.zoom || 1), ce = Math.cos(c.el);
    this.camera.position.set(c.tx + d * ce * Math.sin(c.az), c.ty + d * Math.sin(c.el), c.tz + d * ce * Math.cos(c.az));
    this.camera.lookAt(c.tx, c.ty, c.tz);
    return Math.abs(g.az - c.az) + Math.abs(g.el - c.el) + Math.abs(g.dist - c.dist) / 1000 > 1e-3;
  };

  Twin.prototype.resize = function () {
    var w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.distScale = w / h < 1.0 ? 1.55 : (w / h < 1.45 ? 1.2 : 1);
    this.camera.updateProjectionMatrix();
    this.needsFrame = true;
  };

  Twin.prototype.bindDrag = function () {
    var self = this, cv = this.renderer.domElement, lx = 0, ly = 0, pts = {}, pinch0 = 0, zoom0 = 1;
    this.zoom = 1;
    function npts() { return Object.keys(pts).length; }
    function spread() { var k = Object.keys(pts); return Math.hypot(pts[k[0]].x - pts[k[1]].x, pts[k[0]].y - pts[k[1]].y); }
    cv.addEventListener('pointerdown', function (e) {
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (npts() === 2) { pinch0 = spread(); zoom0 = self.zoom; self.dragging = false; return; }
      self.dragging = true; lx = e.clientX; ly = e.clientY;
      try { cv.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      self.el.classList.add('is-grabbing');
    });
    cv.addEventListener('pointermove', function (e) {
      if (pts[e.pointerId]) pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (npts() === 2 && pinch0 > 0) {
        self.zoom = clamp(zoom0 * pinch0 / Math.max(20, spread()), 0.25, 2.6);
        self.needsFrame = true; kick(); return;
      }
      if (!self.dragging) return;
      var dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
      self.goal.az -= dx * 0.006; self.cam.az -= dx * 0.006;
      self.goal.el = clamp(self.goal.el + dy * 0.004, -0.25, 1.3); self.cam.el = self.goal.el;
      self.needsFrame = true; kick();
    });
    function up(e) {
      delete pts[e.pointerId];
      if (npts() < 2) pinch0 = 0;
      self.dragging = false; self.el.classList.remove('is-grabbing');
    }
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    // wheel zooms toward the view centre; the page does not scroll while the pointer is on the view
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      self.zoom = clamp(self.zoom * Math.exp(step * 0.0012), 0.25, 2.6);
      self.needsFrame = true; kick();
    }, { passive: false });
    cv.addEventListener('dblclick', function () { self.setView(self.view); });
  };

  Twin.prototype.bindControls = function () {
    var self = this, root = this.el.closest('[data-railtwin-root]') || document;
    this.viewBtns = Array.prototype.slice.call(root.querySelectorAll('[data-view]'));
    this.viewBtns.forEach(function (b) { b.addEventListener('click', function () { self.setView(b.getAttribute('data-view')); }); });
    var play = root.querySelector('[data-twin-play]');
    if (play) {
      this.playBtn = play;
      play.addEventListener('click', function () { self.playing = !self.playing; self.last = null; self.syncPlay(); kick(); });
      this.syncPlay();
    }
    this.speedBtns = Array.prototype.slice.call(root.querySelectorAll('[data-speed]'));
    this.speedBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        self.speed = +b.getAttribute('data-speed');
        self.speedBtns.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        kick();
      });
    });
    var dic = root.querySelector('[data-twin-dic]');
    if (dic) dic.addEventListener('change', function () { self.dic = dic.checked; self.needsFrame = true; kick(); });
    var mag = root.querySelector('[data-twin-mag]');
    if (mag) {
      mag.value = this.mag;
      var mv = root.querySelector('[data-twin-magv]'); if (mv) mv.textContent = this.mag;
      mag.addEventListener('input', function () { self.mag = +mag.value; if (mv) mv.textContent = mag.value; self.needsFrame = true; kick(); });
    }
    function q(k) { return root.querySelector('[data-o="' + k + '"]'); }
    this.out = { n: q('n'), bar: q('bar'), day: q('day'), p: q('p'), pu: q('pu'), d: q('d'), du: q('du'), k: q('k'), ku: q('ku'), w: q('w'), wu: q('wu'), stage: q('stage') };
    this.charts = window.HRCRailCharts ? window.HRCRailCharts.bind(root, D) : null;
    if (this.charts) this.charts.setMode(this.view === 'crack' || this.view === 'dic' ? 'crack' : 'defl');
  };
  Twin.prototype.syncPlay = function () {
    if (!this.playBtn) return;
    this.playBtn.textContent = this.playing ? 'Pause' : 'Play';
    this.playBtn.setAttribute('aria-label', this.playing ? 'Pause the test' : 'Play the test');
  };

  Twin.prototype.publish = function (st) {
    var o = this.out;
    if (!o) return;
    if (o.n) o.n.textContent = fmt(st.N, 0);
    if (o.bar) o.bar.style.transform = 'scaleX(' + (st.N / NMAX).toFixed(4) + ')';
    if (o.day) {
      var sec = st.N / D.meta.freq_hz, dd = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600);
      o.day.textContent = dd + ' d ' + hh + ' h of testing at ' + D.meta.freq_hz + ' Hz';
    }
    if (o.p) o.p.textContent = fmt(st.P, 1);
    if (o.pu) o.pu.textContent = fmt(st.P / KIP, 1) + ' kips';
    if (o.d) o.d.textContent = fmt(st.d, 2);
    if (o.du) o.du.textContent = fmt(st.d / INCH, 3) + ' in';
    if (o.w) o.w.textContent = fmt(Math.max(0, st.w), 2);
    if (o.wu) o.wu.textContent = fmt(Math.max(0, st.w) / INCH, 3) + ' in';
    if (o.k) o.k.textContent = fmt(st.K, 1);
    if (o.ku) o.ku.textContent = fmt(st.K / KIP * INCH, 0) + ' kip/in';
    if (o.stage) {
      var sp = this.speed === 1 ? 'real speed' : 'shown at ' + (this.speed === 0.5 ? '1/2' : '1/4') + ' speed';
      o.stage.textContent = st.end ? '2 million cycles reached' : 'Cycling at ' + D.meta.freq_hz + ' Hz, ' + sp;
    }
    if (this.charts) this.charts.update(st);
  };

  Twin.prototype.frame = function (now) {
    if (!this.w) this.resize();
    if (!this.w) return false;
    var dt = this.last === null ? 0.016 : Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.playing && !STILL) this.t = (this.t + dt * this.speed) % TL.total;
    var st = stateAt(this.t);
    if (this.phFix !== undefined) { var c = cyclePoint(st.N, this.phFix); st.P = c.P; st.d = c.d; st.K = c.K; st.r = c.r; st.w = crackWidth(st.N, c.r); }
    this.apply(st);
    var moving = this.placeCamera(dt);
    this.renderer.render(this.scene, this.camera);
    this.publish(st);
    return moving;
  };

  /* ------------------------------------------------------------ boot */
  var views = [], rafId = 0, threePromise = null;
  function loop(now) {
    rafId = 0;
    var live = false;
    for (var i = 0; i < views.length; i++) {
      var v = views[i];
      if (!v.active) continue;
      var anim = v.playing && !STILL;
      if (anim || v.needsFrame || v.dragging) {
        var moving = v.frame(now);
        v.needsFrame = !!moving;
        if (anim || moving) live = true;
      } else { v.last = null; }
    }
    if (live && !document.hidden) rafId = requestAnimationFrame(loop);
  }
  function kick() { if (!rafId) rafId = requestAnimationFrame(loop); }

  function loadThree() {
    if (threePromise) return threePromise;
    if (window.THREE) { threePromise = Promise.resolve(window.THREE); return threePromise; }
    if (location.protocol !== 'file:') {
      threePromise = import(BASE + 'vendor/three.module.min.js');
    } else {
      threePromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = BASE + 'vendor/three.min.js';
        s.onload = function () { window.THREE ? resolve(window.THREE) : reject(new Error('no THREE')); };
        s.onerror = function () { reject(new Error('three.js failed to load')); };
        document.head.appendChild(s);
      });
    }
    return threePromise;
  }

  function init() {
    var els = document.querySelectorAll('[data-railtwin]');
    if (!els.length) return;
    function no3d(el) { el.classList.add('no-3d'); }
    if (typeof ResizeObserver === 'undefined' || typeof IntersectionObserver === 'undefined' || !window.WebGLRenderingContext) {
      Array.prototype.forEach.call(els, no3d); return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var v = en.target.__twin;
        if (!v) return;
        v.active = en.isIntersecting;
        if (!v.active) return;
        v.needsFrame = true;
        if (v.started) { kick(); return; }
        v.started = true;
        loadThree().then(function (lib) {
          T = lib;
          if (v.build()) { views.push(v); kick(); } else no3d(v.el);
        })['catch'](function (e) { no3d(v.el); if (window.console) console.warn('3D twin unavailable', e); });
      });
    }, { rootMargin: '300px' });
    Array.prototype.forEach.call(els, function (el) {
      var v = new Twin(el);
      el.__twin = v;
      io.observe(el);
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(); });
    window.HRC_RAILTWINVIEW = { views: views, kick: kick, stateAt: stateAt, TL: TL };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
