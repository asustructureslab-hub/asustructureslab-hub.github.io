/* hrcdesigner.com/valley-metro: the Northwest Extension Phase II in 3D.
 *
 * Classic script, no modules, so the page also works opened from disk.
 * three.js r160 is vendored (../vendor) and fetched only when the map comes
 * near the viewport, as on the other pages.
 *
 * Everything drawn comes from js/rail/map-data.js, built by
 * analysis_outputs/website_rail/build_map_data.py: terrain from USGS 3DEP
 * (AWS Terrain Tiles), streets, canals, buildings, stations and the line from
 * OpenStreetMap. Building heights and the viaduct deck height are display
 * values. The train is an icon.
 *
 * Markup   <div class="map-view" data-railmap></div>
 * Hooks    ?mapaz=-30 (azimuth, deg)  ?mapt=0.4 (train position 0..1, frozen)
 */
(function () {
  'use strict';

  var D = window.HRC_RAILMAP;
  if (!D) return;
  var OD = window.HRC_RAILOPEN || null;                // aerial photos, traffic, trains (build_opendata.py)
  var PHOTO = !!(OD && OD.imagery && location.protocol !== 'file:');   // WebGL cannot read images from disk

  var T = null;
  var REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function qp(name, re) {
    var m = new RegExp('(?:^|[?&])' + name + '=(' + re + ')(?:&|$)').exec(location.search);
    return m ? m[1] : null;
  }
  var AZ0 = qp('mapaz', '-?[0-9.]+'); AZ0 = AZ0 === null ? null : parseFloat(AZ0) * Math.PI / 180;
  var TFIX = qp('mapt', '[0-9.]+'); TFIX = TFIX === null ? null : Math.max(0, Math.min(1, parseFloat(TFIX)));
  var STILL = REDUCED || TFIX !== null;

  var BASE = (function () {
    var el = document.currentScript;
    return el && el.src ? el.src.replace(/[^/]*$/, '') + '../' : 'js/';
  })();

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smooth(v) { var s = clamp(v, 0, 1); return s * s * (3 - 2 * s); }

  /* ------------------------------------------------------------- terrain */
  var dem = D.dem, NX = dem.nx, NY = dem.ny, STEP = dem.step;
  var H = (function () {
    var bin = atob(dem.b64), n = NX * NY, a = new Float32Array(n);
    for (var i = 0; i < n; i++) a[i] = dem.hmin + (bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)) / 10;
    return a;
  })();
  function ground(e, n) {
    var fx = clamp((e - dem.e0) / STEP, 0, NX - 1.0001), fy = clamp((n - dem.n0) / STEP, 0, NY - 1.0001);
    var i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    var a = H[j * NX + i], b = H[j * NX + i + 1], c = H[(j + 1) * NX + i], d = H[(j + 1) * NX + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
  var H0 = ground(0, 0);                 // scene y = 0 at the map origin
  function Y(h) { return h - H0; }

  /* ------------------------------------------------------------- route */
  var RP = D.route.pts, RN = RP.length / 4;
  var route = [];                        // {e, n, g, lift, s}
  (function () {
    var s = 0;
    for (var i = 0; i < RN; i++) {
      var e = RP[4 * i], n = RP[4 * i + 1];
      if (i) s += Math.hypot(e - route[i - 1].e, n - route[i - 1].n);
      route.push({ e: e, n: n, g: RP[4 * i + 2], lift: RP[4 * i + 3], s: s });
    }
  })();
  var RLEN = route[RN - 1].s;
  function routeAt(s) {
    s = clamp(s, 0, RLEN);
    var lo = 0, hi = RN - 1;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (route[m].s <= s) lo = m; else hi = m; }
    var a = route[lo], b = route[hi], t = (s - a.s) / ((b.s - a.s) || 1);
    return { e: a.e + (b.e - a.e) * t, n: a.n + (b.n - a.n) * t, y: Y(a.g + (b.g - a.g) * t) + a.lift + (b.lift - a.lift) * t,
      de: b.e - a.e, dn: b.n - a.n };
  }

  /* ------------------------------------------------------------- geometry helpers */
  // flat ribbon along a polyline, draped on the terrain (yFn gives the height)
  function ribbon(pts, width, yFn) {
    var n = pts.length / 2;
    if (n < 2) return null;
    var pos = [], idx = [], hw = width / 2;
    for (var i = 0; i < n; i++) {
      var e = pts[2 * i], no = pts[2 * i + 1];
      var ia = Math.max(0, i - 1), ib = Math.min(n - 1, i + 1);
      var te = pts[2 * ib] - pts[2 * ia], tn = pts[2 * ib + 1] - pts[2 * ia + 1];
      var L = Math.hypot(te, tn) || 1; te /= L; tn /= L;
      var pe = -tn * hw, pn = te * hw;
      pos.push(e + pe, yFn(e + pe, no + pn, i), -(no + pn));
      pos.push(e - pe, yFn(e - pe, no - pn, i), -(no - pn));
      if (i) { var k = 2 * i; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    }
    return { pos: pos, idx: idx };
  }
  function merge(parts) {
    var P = [], I = [], off = 0;
    parts.forEach(function (p) {
      if (!p) return;
      for (var i = 0; i < p.pos.length; i++) P.push(p.pos[i]);
      for (var j = 0; j < p.idx.length; j++) I.push(p.idx[j] + off);
      off += p.pos.length / 3;
    });
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(P, 3));
    g.setIndex(I);
    g.computeVertexNormals();
    return g;
  }
  function mat(color, extra) {
    var o = { color: color, roughness: 0.92, metalness: 0 };
    if (extra) for (var k in extra) o[k] = extra[k];
    return new T.MeshStandardMaterial(o);
  }

  /* ------------------------------------------------------------- the view */
  function MapView(el) {
    this.el = el;
    this.az = AZ0 !== null ? AZ0 : -0.62;          // looking north-east from the south-west
    this.el0 = 0.38;
    this.dist = 2250;
    this.target = { x: 190, y: 30, z: -250 };
    this.dragging = false; this.vAz = 0; this.lastUser = -1e9;
    this.t0 = null;
  }

  MapView.prototype.build = function () {
    var el = this.el;
    try {
      this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: TFIX !== null });
    } catch (err) { return false; }
    var r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setClearColor(0x000000, 0);
    r.domElement.className = 'map-gl';
    el.appendChild(r.domElement);

    var scene = this.scene = new T.Scene();
    scene.fog = new T.Fog(0x161b21, 4200, 11500);
    this.camera = new T.PerspectiveCamera(30, 1, 20, 30000);

    scene.add(new T.HemisphereLight(0xffffff, 0xcdbfa9, 1.35));
    var sun = new T.DirectionalLight(0xfff2de, 2.3);   // late afternoon, from the west-south-west
    sun.position.set(-5200, 2600, 2400);
    scene.add(sun);
    var fill = new T.DirectionalLight(0xdfe8f5, 0.35);
    fill.position.set(4000, 3000, -3000);
    scene.add(fill);

    this.buildTerrain();
    if (PHOTO) this.buildPhoto();
    this.buildRoads();
    if (!PHOTO) this.buildBuildings();
    if (OD && OD.traffic) this.buildTraffic();
    this.buildLine();
    this.buildTrain();
    this.buildLabels();
    if (PHOTO) this.buildYears();

    el.classList.add('is-3d');
    var self = this;
    this.ro = new ResizeObserver(function () { self.resize(); kick(); });
    this.ro.observe(el);
    this.resize();
    this.bindDrag();
    return true;
  };

  MapView.prototype.buildTerrain = function () {
    var pos = new Float32Array(NX * NY * 3), col = new Float32Array(NX * NY * 3), idx = [];
    var sand = new T.Color(0xb3a78f), dune = new T.Color(0xa8916f), rock = new T.Color(0x8a6a4c), dark = new T.Color(0x5e4a3a), c = new T.Color();
    for (var j = 0; j < NY; j++) {
      for (var i = 0; i < NX; i++) {
        var k = j * NX + i, h = H[k];
        var e = dem.e0 + i * STEP, n = dem.n0 + j * STEP;
        pos[3 * k] = e; pos[3 * k + 1] = Y(h); pos[3 * k + 2] = -n;
        var hx = H[j * NX + Math.min(NX - 1, i + 1)] - H[j * NX + Math.max(0, i - 1)];
        var hy = H[Math.min(NY - 1, j + 1) * NX + i] - H[Math.max(0, j - 1) * NX + i];
        var slope = Math.hypot(hx, hy) / (2 * STEP);
        var up = smooth((h - 372) / 60), hi = smooth((h - 460) / 170);
        c.copy(sand).lerp(dune, up * 0.8).lerp(rock, clamp(slope * 2.4, 0, 1) * up).lerp(dark, hi * 0.45);
        col[3 * k] = c.r; col[3 * k + 1] = c.g; col[3 * k + 2] = c.b;
        if (i < NX - 1 && j < NY - 1) idx.push(k, k + 1, k + NX, k + 1, k + NX + 1, k + NX);
      }
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    var m = new T.Mesh(g, new T.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
    this.scene.add(m);
    var apron = new T.Mesh(new T.PlaneGeometry(60000, 60000), new T.MeshStandardMaterial({ color: 0xb3a78f, roughness: 1 }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(0, Y(dem.hmin) - 0.5, 0);
    this.scene.add(apron);
  };

  // the aerial photograph, draped on the terrain
  MapView.prototype.buildPhoto = function () {
    var B = OD.imagery.bounds, STEPP = 16;
    var nx = Math.ceil((B.e1 - B.e0) / STEPP) + 1, ny = Math.ceil((B.n1 - B.n0) / STEPP) + 1;
    var pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2), idx = [];
    for (var j = 0; j < ny; j++) {
      for (var i = 0; i < nx; i++) {
        var k = j * nx + i, u = i / (nx - 1), v = j / (ny - 1);
        var e = B.e0 + (B.e1 - B.e0) * u, n = B.n0 + (B.n1 - B.n0) * v;
        pos[3 * k] = e; pos[3 * k + 1] = Y(ground(e, n)) + 0.4; pos[3 * k + 2] = -n;
        uv[2 * k] = u; uv[2 * k + 1] = v;
        if (i < nx - 1 && j < ny - 1) idx.push(k, k + 1, k + nx, k + 1, k + nx + 1, k + nx);
      }
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.photoMat = new T.MeshStandardMaterial({ roughness: 1, metalness: 0, visible: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.scene.add(new T.Mesh(g, this.photoMat));
    this.textures = {};
    var years = OD.imagery.years;
    this.setYear(years[years.length - 1].year);
  };

  MapView.prototype.setYear = function (year) {
    var self = this, rec = null;
    OD.imagery.years.forEach(function (y) { if (y.year === year) rec = y; });
    if (!rec) return;
    this.year = year;
    function apply(tex) {
      if (self.year !== year) return;
      self.photoMat.map = tex; self.photoMat.visible = true; self.photoMat.needsUpdate = true;
      self.needsFrame = true; kick();
    }
    if (this.textures[year]) { apply(this.textures[year]); }
    else {
      new T.TextureLoader().load(rec.file, function (tex) {
        tex.colorSpace = T.SRGBColorSpace;
        tex.anisotropy = Math.min(8, self.renderer.capabilities.getMaxAnisotropy());
        self.textures[year] = tex;
        apply(tex);
      });
    }
    if (this.yearBtns) this.yearBtns.forEach(function (b) { b.setAttribute('aria-pressed', +b.getAttribute('data-year') === year ? 'true' : 'false'); });
    if (this.yearNote) this.yearNote.textContent = 'Aerial ' + rec.dates[rec.dates.length - 1];
  };

  MapView.prototype.buildYears = function () {
    var self = this, box = document.createElement('div');
    box.className = 'map-years';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Year of the aerial photograph');
    var WHAT = { 2019: 'Before', 2021: 'Building', 2023: 'Built' };
    this.yearBtns = OD.imagery.years.map(function (y) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'map-year'; b.setAttribute('data-year', y.year);
      b.innerHTML = '<b>' + y.year + '</b><span>' + (WHAT[y.year] || '') + '</span>';
      b.addEventListener('click', function () { self.setYear(y.year); });
      box.appendChild(b);
      return b;
    });
    this.yearNote = document.createElement('div');
    this.yearNote.className = 'map-year-note';
    box.appendChild(this.yearNote);
    var hl = document.createElement('button');
    hl.type = 'button'; hl.className = 'map-hl'; hl.setAttribute('aria-pressed', 'true');
    hl.textContent = 'Highlight the line';
    hl.addEventListener('click', function () {
      var on = hl.getAttribute('aria-pressed') !== 'true';
      hl.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (self.overlay) self.overlay.visible = on;
      self.needsFrame = true; kick();
    });
    box.appendChild(hl);
    this.el.appendChild(box);
    this.setYear(this.year);
  };

  // cars at the average daily density of the ADOT counts, both directions
  MapView.prototype.buildTraffic = function () {
    var cars = [];
    var rnd = (function (a) { return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })(7);
    OD.traffic.segments.forEach(function (sg) {
      var p = sg.p, n = p.length / 2, cum = [0];
      for (var i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]));
      var L = cum[n - 1];
      if (L < 30) return;
      var fwy = sg.n.replace(/\s+/g, '').indexOf('I017') === 0;
      var vkmh = fwy ? 100 : 60;
      var perKm = sg.a / 2 / 24 / vkmh;                            // vehicles per km in each direction, average hour
      var S = { p: p, cum: cum, L: L, off: fwy ? 11 : 5.5 };
      [1, -1].forEach(function (dir) {
        var m = Math.round(perKm * L / 1000);
        for (var c = 0; c < m; c++) cars.push({ s: S, dir: dir, s0: rnd() * L, v: vkmh / 3.6 * (0.9 + 0.2 * rnd()) });
      });
    });
    if (!cars.length) return;
    var geo = new T.BoxGeometry(5.2, 1.7, 2.1);
    var matc = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.2 });
    var im = new T.InstancedMesh(geo, matc, cars.length);
    var col = new T.Color(), PAL = [0xf4f5f6, 0xe6e8eb, 0x2b3036, 0x8d949c, 0xb9312f, 0x3d5d8a, 0xd8d2c4];
    for (var i = 0; i < cars.length; i++) im.setColorAt(i, col.set(PAL[Math.floor(rnd() * PAL.length)]));
    im.instanceColor.needsUpdate = true;
    im.frustumCulled = false;
    this.scene.add(im);
    this.traffic = { im: im, cars: cars, m4: new T.Matrix4(), q: new T.Quaternion(), pos: new T.Vector3(), sc: new T.Vector3(1.5, 1.5, 1.5), up: new T.Vector3(0, 1, 0) };
  };

  MapView.prototype.stepTraffic = function (t) {
    var tr = this.traffic;
    if (!tr) return;
    for (var i = 0; i < tr.cars.length; i++) {
      var c = tr.cars[i], S = c.s, L = S.L;
      var s = (c.s0 + c.dir * c.v * t) % L; if (s < 0) s += L;
      var cum = S.cum, lo = 0, hi = cum.length - 1;
      while (hi - lo > 1) { var m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
      var p = S.p, u = (s - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
      var ax = p[2 * lo], ay = p[2 * lo + 1], bx = p[2 * hi], by = p[2 * hi + 1];
      var dx = bx - ax, dy = by - ay, dl = Math.hypot(dx, dy) || 1;
      var e = ax + dx * u + dy / dl * S.off * c.dir, n = ay + dy * u - dx / dl * S.off * c.dir;
      tr.pos.set(e, Y(ground(e, n)) + 1.6, -n);
      tr.q.setFromAxisAngle(tr.up, Math.atan2(dy, dx) + (c.dir < 0 ? Math.PI : 0));
      tr.m4.compose(tr.pos, tr.q, tr.sc);
      tr.im.setMatrixAt(i, tr.m4);
    }
    tr.im.instanceMatrix.needsUpdate = true;
  };

  MapView.prototype.buildRoads = function () {
    var W = [34, 17, 13, 8], COL = [0xcfc8bd, 0xffffff, 0xfbfaf7, 0xf6f3ee], LIFT = [1.0, 0.9, 0.8, 0.7];
    var self = this;
    var B = PHOTO ? OD.imagery.bounds : null, IN = 110;          // metres inside the feathered edge
    function onPhoto(e, n) { return B && e > B.e0 + IN && e < B.e1 - IN && n > B.n0 + IN && n < B.n1 - IN; }
    function clip(p) {                                             // runs of the polyline that stay off the photo
      var runs = [], cur = [];
      for (var i = 0; i < p.length; i += 2) {
        if (onPhoto(p[i], p[i + 1])) { if (cur.length >= 4) runs.push(cur); cur = []; }
        else cur.push(p[i], p[i + 1]);
      }
      if (cur.length >= 4) runs.push(cur);
      return runs;
    }
    D.roads.forEach(function (list, k) {
      var parts = [];
      list.forEach(function (p) {
        clip(p).forEach(function (q) { parts.push(ribbon(q, W[k], function (e, n) { return Y(ground(e, n)) + LIFT[k]; })); });
      });
      if (!parts.length) return;
      var m = new T.Mesh(merge(parts), mat(COL[k], { polygonOffset: true, polygonOffsetFactor: -2 - k, polygonOffsetUnits: -2 }));
      self.scene.add(m);
    });
    var water = [];
    D.water.forEach(function (w) { clip(w.p).forEach(function (q) { water.push(ribbon(q, 14, function (e, n) { return Y(ground(e, n)) + 0.6; })); }); });
    if (water.length) this.scene.add(new T.Mesh(merge(water), mat(0xa9c6d2, { roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
  };

  MapView.prototype.buildBuildings = function () {
    var P = [], I = [], off = 0;
    D.buildings.forEach(function (b) {
      var p = b.p, n = p.length / 2, y0 = Y(b.g) - 1, y1 = Y(b.g) + b.h;
      var contour = [];
      for (var i = 0; i < n; i++) contour.push(new T.Vector2(p[2 * i], p[2 * i + 1]));
      if (T.ShapeUtils.isClockWise(contour)) contour.reverse();
      // walls
      for (var a = 0; a < n; a++) {
        var q = contour[a], w = contour[(a + 1) % n];
        P.push(q.x, y0, -q.y, w.x, y0, -w.y, w.x, y1, -w.y, q.x, y1, -q.y);
        I.push(off, off + 1, off + 2, off, off + 2, off + 3);
        off += 4;
      }
      // roof
      var tris = T.ShapeUtils.triangulateShape(contour, []);
      for (var r = 0; r < n; r++) P.push(contour[r].x, y1, -contour[r].y);
      tris.forEach(function (t) { I.push(off + t[0], off + t[1], off + t[2]); });
      off += n;
    });
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(P, 3));
    g.setIndex(I);
    g = g.toNonIndexed();
    g.computeVertexNormals();
    this.scene.add(new T.Mesh(g, mat(0xf7f4ee, { side: T.DoubleSide })));
  };

  // the polyline moved sideways by off metres (left of the direction of travel positive)
  function offsetLine(pts, off) {
    var n = pts.length / 2, out = [];
    for (var i = 0; i < n; i++) {
      var ia = Math.max(0, i - 1), ib = Math.min(n - 1, i + 1);
      var te = pts[2 * ib] - pts[2 * ia], tn = pts[2 * ib + 1] - pts[2 * ia + 1], L = Math.hypot(te, tn) || 1;
      out.push(pts[2 * i] - tn / L * off, pts[2 * i + 1] + te / L * off);
    }
    return out;
  }

  MapView.prototype.buildLine = function () {
    var scene = new T.Group();
    this.overlay = scene;
    this.scene.add(scene);
    // existing line to the south, context only
    if (D.existing && D.existing.length > 3) {
      var ex = ribbon(D.existing, 9, function (e, n) { return Y(ground(e, n)) + 1.6; });
      scene.add(new T.Mesh(merge([ex]), mat(0x8a939d, { polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 })));
    }
    // the extension, drawn on its deck height
    var flatPts = [];
    route.forEach(function (p) { flatPts.push(p.e, p.n); });
    // two thin red edges 9 m either side of the centre line, so the real track shows between them
    var red = mat(0xffc627, { roughness: 0.5, emissive: 0x7a5a00, emissiveIntensity: 0.9, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
    var edges = [-9, 9].map(function (off) {
      return ribbon(offsetLine(flatPts, off), 2.4, function (e, n, i) { return Y(route[i].g) + route[i].lift + 1.9; });
    });
    scene.add(new T.Mesh(merge(edges), red));

    // viaduct deck and piers where the line rises over I-17
    var deck = [], piers = [];
    var concrete = mat(0xd8d6d2, { roughness: 0.85 });
    var i0 = -1;
    for (var i = 0; i < RN; i++) if (route[i].lift > 0.4) { i0 = i; break; }
    if (i0 >= 0) {
      var sStart = route[i0].s;
      for (var s = sStart; s <= RLEN; s += 4) {
        var a = routeAt(s), b = routeAt(Math.min(RLEN, s + 4));
        var len = Math.hypot(b.e - a.e, b.n - a.n);
        if (len < 0.5) continue;
        var gnd = Y(ground(a.e, a.n));
        var top = a.y + 1.6, depth = Math.min(2.4, top - gnd);
        if (depth <= 0.2) continue;
        var bx = new T.Mesh(new T.BoxGeometry(len + 0.4, depth, 12), concrete);
        bx.position.set((a.e + b.e) / 2, top - depth / 2, -(a.n + b.n) / 2);
        bx.rotation.y = Math.atan2(b.n - a.n, b.e - a.e);
        deck.push(bx);
      }
      for (var sp = sStart + 60; sp < RLEN - 8; sp += 38) {
        var p = routeAt(sp);
        var g0 = Y(ground(p.e, p.n)), hgt = p.y - 0.8 - g0;
        if (hgt < 3) continue;
        var col = new T.Mesh(new T.CylinderGeometry(1.4, 1.6, hgt, 12), concrete);
        col.position.set(p.e, g0 + hgt / 2, -p.n);
        piers.push(col);
        var cap = new T.Mesh(new T.BoxGeometry(3.2, 1.2, 10), concrete);
        cap.position.set(p.e, p.y - 1.2, -p.n);
        cap.rotation.y = Math.atan2(p.dn, p.de);
        piers.push(cap);
      }
    }
    deck.concat(piers).forEach(function (m) { scene.add(m); });

    // station platforms
    var plat = mat(0xffffff, { roughness: 0.6 });
    var canopy = mat(0x3a414a, { roughness: 0.5, metalness: 0.3 });
    D.stations.forEach(function (st) {
      var p = routeAt(st.s), ang = Math.atan2(p.dn, p.de);
      var m = new T.Mesh(new T.BoxGeometry(90, 1.2, 16), plat);
      m.position.set(p.e, p.y + 1.2, -p.n); m.rotation.y = ang;
      scene.add(m);
      var c = new T.Mesh(new T.BoxGeometry(70, 0.8, 12), canopy);
      c.position.set(p.e, p.y + 6.5, -p.n); c.rotation.y = ang;
      scene.add(c);
    });
  };

  MapView.prototype.buildTrain = function () {
    var g = new T.Group();
    var body = mat(0xf4f5f6, { roughness: 0.4, metalness: 0.15 });
    var glass = mat(0x1f262e, { roughness: 0.25, metalness: 0.4 });
    var stripe = mat(0xd1232a, { roughness: 0.5 });
    for (var c = 0; c < 2; c++) {                         // two cars, about 27 m each
      var x = (c - 0.5) * 28.2;
      var car = new T.Mesh(new T.BoxGeometry(27.4, 3.4, 2.65), body); car.position.set(x, 2.4, 0); g.add(car);
      var win = new T.Mesh(new T.BoxGeometry(26.2, 1.1, 2.7), glass); win.position.set(x, 2.9, 0); g.add(win);
      var st = new T.Mesh(new T.BoxGeometry(27.2, 0.35, 2.7), stripe); st.position.set(x, 1.3, 0); g.add(st);
    }
    g.scale.setScalar(1.6);                                 // enlarged so it reads at map scale
    this.train = g;
    this.scene.add(g);
    // stops: platforms along the line, the train dwells at each
    var stops = D.stations.map(function (s) { return s.s; }).sort(function (a, b) { return a - b; });
    var legs = [], tt = 0, V = 60, DWELL = 3.0, ACC = 2.2;   // display speed, m/s of scene time
    for (var i = 0; i < stops.length - 1; i++) {
      var L = stops[i + 1] - stops[i], dur = L / V + ACC;
      legs.push({ s0: stops[i], s1: stops[i + 1], t0: tt + DWELL, t1: tt + DWELL + dur });
      tt += DWELL + dur;
    }
    this.legs = legs; this.cycle = tt;
  };

  // train position along the line at scene time t (there and back)
  MapView.prototype.trainS = function (t) {
    var legs = this.legs, C = this.cycle;
    var u = t % (2 * C), back = u >= C;
    if (back) u -= C;
    var s = legs[0].s0;
    for (var i = 0; i < legs.length; i++) {
      var L = legs[i];
      if (u < L.t0) { s = L.s0; break; }
      if (u <= L.t1) { var f = (u - L.t0) / (L.t1 - L.t0); f = f * f * (3 - 2 * f); s = L.s0 + (L.s1 - L.s0) * f; break; }
      s = L.s1;
    }
    if (back) s = legs[0].s0 + legs[legs.length - 1].s1 - s;
    return s;
  };

  MapView.prototype.buildLabels = function () {
    var box = document.createElement('div');
    box.className = 'map-labels';
    this.el.appendChild(box);
    var L = this.labels = [];
    function add(text, e, n, y, cls) {
      var d = document.createElement('div');
      d.className = 'map-label ' + (cls || '');
      d.textContent = text;
      box.appendChild(d);
      L.push({ el: d, v: new T.Vector3(e, y, -n) });
    }
    D.stations.forEach(function (st) {
      var p = routeAt(st.s);
      add(st.n, p.e, p.n, p.y + 9, 'stn');
    });
    D.peaks.forEach(function (p) {
      if (p.n === 'Sunnyslope Mountain') return;
      add(p.n, p.e, p.no, Y(p.z) + 12, 'peak');
    });
    D.road_labels.forEach(function (r) {
      if (r.n === 'Peoria Ave') return;
      var text = r.n;
      if (r.n === 'I-17' && OD && OD.traffic && OD.traffic.max.i17_at_bridge) text = 'I-17 \u00b7 ' + OD.traffic.max.i17_at_bridge.toLocaleString('en-US') + ' vehicles a day';
      add(text, r.e, r.no, Y(ground(r.e, r.no)) + 4, 'road');
    });
    var tv = new T.Vector3();
    this.tv = tv;
  };

  MapView.prototype.placeLabels = function () {
    var w = this.w, h = this.h, cam = this.camera, tv = this.tv;
    this.labels.forEach(function (l) {
      tv.copy(l.v).project(cam);
      var vis = tv.z < 1 && tv.x > -1.05 && tv.x < 1.05 && tv.y > -1.05 && tv.y < 1.05;
      l.el.style.display = vis ? '' : 'none';
      if (vis) l.el.style.transform = 'translate(' + ((tv.x + 1) / 2 * w).toFixed(1) + 'px,' + ((1 - tv.y) / 2 * h).toFixed(1) + 'px)';
    });
  };

  MapView.prototype.resize = function () {
    var w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // fit the 1.6 km line across the width, whatever the aspect
    var hf = Math.atan(Math.tan(this.camera.fov * Math.PI / 360) * this.camera.aspect);
    this.dist = clamp(1150 / Math.tan(hf), 1900, 5200);
    this.distScale = 1;
    this.camera.updateProjectionMatrix();
    this.needsFrame = true;
  };

  MapView.prototype.bindDrag = function () {
    var self = this, cv = this.renderer.domElement, lastX = 0, lastY = 0, lastT = 0;
    cv.addEventListener('pointerdown', function (e) {
      self.dragging = true; lastX = e.clientX; lastY = e.clientY; lastT = performance.now();
      self.vAz = 0;
      try { cv.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      self.el.classList.add('is-grabbing');
    });
    cv.addEventListener('pointermove', function (e) {
      if (!self.dragging) return;
      var dx = e.clientX - lastX, dy = e.clientY - lastY, now = performance.now();
      self.az -= dx * 0.006;
      self.el0 = clamp(self.el0 + dy * 0.004, 0.2, 1.2);
      self.vAz = -dx * 0.006 / Math.max(8, now - lastT) * 16;
      lastX = e.clientX; lastY = e.clientY; lastT = now;
      self.lastUser = now;
      kick();
    });
    function up() { self.dragging = false; self.lastUser = performance.now(); self.el.classList.remove('is-grabbing'); }
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    self.zoom = 1;
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      self.zoom = clamp(self.zoom * Math.exp(step * 0.0012), 0.3, 2.2);
      self.lastUser = performance.now();
      kick();
    }, { passive: false });
    var touches = {}, pinch0 = 0, zoom0 = 1;
    cv.addEventListener('pointerdown', function (e) { touches[e.pointerId] = [e.clientX, e.clientY]; var k = Object.keys(touches); if (k.length === 2) { pinch0 = Math.hypot(touches[k[0]][0] - touches[k[1]][0], touches[k[0]][1] - touches[k[1]][1]); zoom0 = self.zoom; self.dragging = false; } });
    cv.addEventListener('pointermove', function (e) {
      if (!touches[e.pointerId]) return;
      touches[e.pointerId] = [e.clientX, e.clientY];
      var k = Object.keys(touches);
      if (k.length === 2 && pinch0 > 0) {
        var sp = Math.hypot(touches[k[0]][0] - touches[k[1]][0], touches[k[0]][1] - touches[k[1]][1]);
        self.zoom = clamp(zoom0 * pinch0 / Math.max(20, sp), 0.3, 2.2); self.dragging = false; kick();
      }
    });
    function lift(e) { delete touches[e.pointerId]; if (Object.keys(touches).length < 2) pinch0 = 0; }
    cv.addEventListener('pointerup', lift); cv.addEventListener('pointercancel', lift);
  };

  MapView.prototype.frame = function (now) {
    if (!this.w) this.resize();
    if (!this.w) return;
    if (this.t0 === null) this.t0 = now;
    var t = (now - this.t0) / 1000;
    // idle: a slow sway around the start view, never a full spin
    if (!this.dragging) {
      if (Math.abs(this.vAz) > 1e-4) { this.az += this.vAz; this.vAz *= 0.92; }
      else if (!STILL && now - this.lastUser > 4000) this.az += Math.sin(t * 0.12) * 0.0006;
    }
    var d = this.dist * (this.distScale || 1) * (this.zoom || 1), ce = Math.cos(this.el0);
    var tg = this.target;
    this.camera.position.set(tg.x + d * ce * Math.sin(this.az), tg.y + d * Math.sin(this.el0), tg.z + d * ce * Math.cos(this.az));
    this.camera.lookAt(tg.x, tg.y, tg.z);

    var s = TFIX !== null ? TFIX * RLEN : (REDUCED ? RLEN * 0.55 : this.trainS(t));
    var a = routeAt(s), b = routeAt(Math.min(RLEN, s + 3)), c0 = routeAt(Math.max(0, s - 3));
    this.train.position.set(a.e, a.y + 1.2, -a.n);
    this.train.rotation.y = Math.atan2(b.n - c0.n, b.e - c0.e);
    this.train.rotation.z = Math.atan2(b.y - c0.y, Math.hypot(b.e - c0.e, b.n - c0.n));

    this.stepTraffic(STILL ? 0 : t);
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
  };

  /* ------------------------------------------------------------- boot */
  var views = [], rafId = 0, threePromise = null;
  function loop(now) {
    rafId = 0;
    var live = false;
    for (var i = 0; i < views.length; i++) {
      var v = views[i];
      if (!v.active) continue;
      if (!STILL || v.needsFrame || v.dragging || Math.abs(v.vAz) > 1e-4 || v.zoomed !== v.zoom) { v.frame(now); v.needsFrame = false; v.zoomed = v.zoom; }
      if (!STILL || v.dragging || Math.abs(v.vAz) > 1e-4) live = true;
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
    var els = document.querySelectorAll('[data-railmap]');
    if (!els.length) return;
    function no3d(el) { el.classList.add('no-3d'); }
    if (typeof ResizeObserver === 'undefined' || typeof IntersectionObserver === 'undefined' || !window.WebGLRenderingContext) {
      Array.prototype.forEach.call(els, no3d); return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var v = en.target.__map;
        if (!v) return;
        v.active = en.isIntersecting;
        if (!v.active) return;
        v.needsFrame = true;
        if (v.started) { kick(); return; }
        v.started = true;
        loadThree().then(function (lib) {
          T = lib;
          if (v.build()) { views.push(v); kick(); } else no3d(v.el);
        })['catch'](function (e) { no3d(v.el); if (window.console) console.warn('3D map unavailable', e); });
      });
    }, { rootMargin: '400px' });
    Array.prototype.forEach.call(els, function (el) {
      var v = new MapView(el);
      el.__map = v;
      io.observe(el);
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(); });
    window.HRC_RAILMAPVIEW = { views: views, kick: kick };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
