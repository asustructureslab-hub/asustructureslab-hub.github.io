// Beam mechanics viewer, UHPC Beam 1 in four-point bending.
// Model quantities come from data/beam1_state.js (export_animation_state.m):
//   before the peak, section strains at every x from computeAnalysisCore;
//   after the peak, the descending-branch state at the localized crack, and
//   everywhere else the unloading section solved in the export (fibres
//   unload from their peak state, N = 0 and M = M(x); its curvature is
//   within 1.7% of the engine's K0 rule).  Unloading stress depends on the
//   fibre history, so it is exported as a grid (sigU), not read off the law.
// Stress is read off the exported law tables at the engine strain, which is
// the same piecewise law as lawStress (checked to 4e-14 MPa in the export).
// Crack positions, paths and widths come from the DIC of the same beam.
(function () {
  'use strict';
  const D = window.HRC_ANIM, T = window.THREE;
  const G = D.geom, F = D.f, MAT = D.mat, DIC = D.dic;
  const nF = F.P.length, nx = D.x.length, nB = DIC.xBand.length, KM = DIC.mainBand;
  const L = G.L, h = G.h, b = G.b, ecr = MAT.epsilon_cr;
  const dxg = L / (nx - 1);
  const PK = D.ref.peakFrame, XH = DIC.xh;
  const Lp2a = Math.max(L / 2 - G.Lp2 / 2, 0), Lp2b = L - Lp2a;
  const s = 0.01, OV = 25.4, Ltot = L + 2 * OV, R = 9.5, Y0 = 0.79;
  const Q = new URLSearchParams(location.search);
  const clamp = (v, a, c) => Math.max(a, Math.min(c, v));
  let seed = 20260923; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // ---------- constitutive law tables (engine) ----------
  const LT = D.lawT, LC = D.lawC;
  function tab(xs, ys, v) {
    if (v >= xs[xs.length - 1]) return ys[ys.length - 1];
    for (let i = 1; i < xs.length; i++) if (v <= xs[i]) return ys[i - 1] + (v - xs[i - 1]) / (xs[i] - xs[i - 1]) * (ys[i] - ys[i - 1]);
    return 0;
  }
  const lawSig = (e) => e >= 0 ? tab(LT.eps, LT.sig, e) : -tab(LC.eps, LC.sig, -e);
  const SIG_T = Math.max.apply(null, LT.sig), SIG_C = Math.max.apply(null, LC.sig);

  // ---------- crack paths from DIC ----------
  const ND = DIC.depth.length, dD = h / (ND - 1), yD = DIC.depth;
  const paths = DIC.paths.map((row, k) => {
    if (k === KM) return row.slice();
    const sm = row.map((_, i) => { let a = 0, n = 0; for (let j = i - 4; j <= i + 4; j++) if (j >= 0 && j < row.length) { a += row[j]; n++; } return a / n; });
    let walk = 0; return sm.map(v => { walk = 0.75 * walk + (rnd() - 0.5) * 0.55; return v + walk; });
  });
  function pathX(k, y) { const f = clamp(y / dD, 0, ND - 1), i = Math.min(ND - 2, Math.floor(f)), a = f - i; return paths[k][i] * (1 - a) + paths[k][i + 1] * a; }
  const xm = (y) => pathX(KM, y);
  const xmMax = Math.max.apply(null, paths[KM]);
  const jitB = paths.map(() => Array.from({ length: 9 }, () => (rnd() - 0.5) * 0.9));
  const byName = {}; DIC.gauges.forEach((g, k) => { byName[g] = k; });
  const sel = new Set(DIC.gauges.map((_, k) => k));   // all cracks shown by default
  let kMaxAll = 0; F.kappa.forEach(r => r.forEach(v => { if (v > kMaxAll) kMaxAll = v; }));
  const shapeH = (x) => x <= XH ? x * (L - XH) / L : XH * (L - x) / L;

  // ---------- state at fractional frame t ----------
  const SU = D.sigU, nxs = SU.x.length, nys = SU.y.length, dxs = SU.x[1] - SU.x[0], dys = h / (nys - 1);
  const S = {
    sigU: new Float32Array(nxs * nys),
    kappa: new Float32Array(nx), wv: new Float32Array(nx), wbg: new Float32Array(nx), thb: new Float32Array(nx),
    etop: new Float32Array(nx), ebot: new Float32Array(nx), c: new Float32Array(nx), moment: new Float32Array(nx),
    zone: new Uint8Array(nx), cw: new Float32Array(nB), tip: new Float32Array(nB)
  };
  function lerpRows(dst, A, B, a) {
    for (let i = 0; i < dst.length; i++) {
      const p = A[i], q = B[i];
      dst[i] = p == null ? (q == null ? NaN : q) : (q == null ? p : p + (q - p) * a);
    }
  }
  function setState(t) {
    const i0 = clamp(Math.floor(t), 0, nF - 1), i1 = Math.min(nF - 1, i0 + 1), a = t - i0;
    const l = (k) => F[k][i0] + (F[k][i1] - F[k][i0]) * a;
    S.t = t; S.P = l('P'); S.M = l('M'); S.K = l('K'); S.delta = l('delta'); S.wloc = l('wloc');
    S.thh = l('thh'); S.cL = l('cL'); S.etL = l('etL'); S.ebL = l('ebL');
    S.phase = a < 0.5 ? F.phase[i0] : F.phase[i1]; S.post = S.phase >= 2;
    ['kappa', 'wv', 'etop', 'ebot', 'c', 'moment', 'cw', 'tip'].forEach(k => lerpRows(S[k], F[k][i0], F[k][i1], a));
    const zr = a < 0.5 ? F.zone[i0] : F.zone[i1]; for (let i = 0; i < nx; i++) S.zone[i] = zr[i];
    if (i1 >= SU.first) { const r1 = i1 - SU.first, r0 = Math.max(i0 - SU.first, 0); lerpRows(S.sigU, SU.v[r0], SU.v[r1], r0 === r1 ? 0 : a); }
    for (let i = 0; i < nx; i++) S.wbg[i] = S.wv[i] - S.thh * shapeH(D.x[i]);
    for (let i = 0; i < nx; i++) { const lo = Math.max(0, i - 1), hi = Math.min(nx - 1, i + 1); S.thb[i] = (S.wbg[hi] - S.wbg[lo]) / ((hi - lo) * dxg); }
  }
  function atX(arr, x) { const f = clamp(x / dxg, 0, nx - 1), i = Math.min(nx - 2, Math.floor(f)), a = f - i; return arr[i] + (arr[i + 1] - arr[i]) * a; }
  function wAt(x) {
    if (x < 0) return S.wv[0] + (S.wv[1] - S.wv[0]) / dxg * x;
    if (x > L) return S.wv[nx - 1] + (S.wv[nx - 1] - S.wv[nx - 2]) / dxg * (x - L);
    return atX(S.wv, x);
  }
  // section strain before the peak, or of the unloading section after it
  function strainU(x, y) {
    if (x < 0 || x > L) return 0;                               // overhang carries no moment
    const et = atX(S.etop, x), eb = atX(S.ebot, x); return -et + (et + eb) * y / h;
  }
  function sigUAt(x, y) {
    const fx = clamp(x / dxs, 0, nxs - 1), ix = Math.min(nxs - 2, Math.floor(fx)), ax = fx - ix;
    const fy = clamp(y / dys, 0, nys - 1), iy = Math.min(nys - 2, Math.floor(fy)), ay = fy - iy, g = (i, j) => S.sigU[i * nys + j];
    return (1 - ax) * ((1 - ay) * g(ix, iy) + ay * g(ix, iy + 1)) + ax * ((1 - ay) * g(ix + 1, iy) + ay * g(ix + 1, iy + 1));
  }
  const stressU = (x, y) => (x < 0 || x > L) ? 0 : (S.post ? sigUAt(x, y) : lawSig(strainU(x, y)));
  const strainL = (y) => -S.etL + (S.etL + S.ebL) * y / h;      // localized crack section
  const xc = (y) => xm(Math.max(y, S.tip[KM]));                 // crack line, vertical above its tip
  const wLoc = (x, y) => { if (!S.post) return 0; const d = x - xc(y); return Math.exp(-d * d / 32); };
  // surface fields: the localized state blends in over a few mm around CW1
  function fieldStrain(x, y) { const w = wLoc(x, y), e = strainU(x, y); return w > 1e-3 ? e * (1 - w) + strainL(y) * w : e; }
  function fieldStress(x, y) { const w = wLoc(x, y), v = stressU(x, y); return w > 1e-3 ? v * (1 - w) + lawSig(strainL(y)) * w : v; }
  // one section, no blending, for the chart and the cut
  const atCrack = (x) => S.post && Math.abs(x - xc(S.cL)) < 3;
  const secStress = (x, y) => atCrack(x) ? lawSig(strainL(y)) : stressU(x, y);
  const secNA = (x) => atCrack(x) ? S.cL : atX(S.c, x);
  const naAt = (x) => { const c = atX(S.c, x); if (!S.post) return c; const d = x - xc(S.cL), w = Math.exp(-d * d / 32); return c * (1 - w) + S.cL * w; };
  const SK = 3.5, GN = 1 / (Math.sqrt(2 * Math.PI) * SK);
  function crackOpen(k, y) { const tp = S.tip[k]; if (S.cw[k] < 0.004 || y <= tp) return 0; return S.cw[k] * (y - tp) / (h - tp); }
  // DIC view: model strain between cracks (tension capped at the cracking
  // strain, the rest is in the cracks) plus each measured crack opening
  // spread over a Gaussian gauge, the way the DIC system smears a crack.
  function dicStrain(x, y) {
    let e = (x >= 0 && x <= L) ? Math.min(fieldStrain(x, y), ecr) : 0;
    sel.forEach(k => { const w = crackOpen(k, y); if (w <= 0) return; const d = x - pathX(k, y); if (Math.abs(d) < 16) e += w * GN * Math.exp(-d * d / (2 * SK * SK)); });
    return e;
  }

  // ---------- deformation map ----------
  let mag = +(Q.get('mag') || 1);
  function deform(x, y, z, side, o) {
    const w = wAt(x);
    let u = atX(S.thb, clamp(x, 0, L)) * (h / 2 - y);
    if (side && S.thh > 0) u += (side < 0 ? S.thh * (L - XH) / L : -S.thh * XH / L) * (S.cL - y);
    return o.set((x - L / 2 + mag * u) * s, Y0 + (h - y - mag * w) * s, z * s);
  }

  // ---------- colour maps ----------
  const JET = [[0.10, 0.14, 0.56], [0.12, 0.33, 0.86], [0.09, 0.70, 0.90], [0.18, 0.78, 0.42], [0.70, 0.85, 0.18], [1.0, 0.83, 0.12], [1.0, 0.48, 0.10], [0.86, 0.10, 0.12]];
  const EMIN = -0.003, EMAX = 0.005;
  const C_COMP = [[0.93, 0.95, 0.97], [0.62, 0.76, 0.90], [0.18, 0.44, 0.70], [0.10, 0.24, 0.45]];
  const C_TENS = [[0.93, 0.95, 0.97], [0.98, 0.80, 0.45], [0.94, 0.63, 0.19], [0.82, 0.14, 0.16]];
  const C_SEQ = [[0.80, 0.83, 0.86], [0.94, 0.63, 0.19], [0.82, 0.14, 0.16], [0.45, 0.05, 0.08]];
  function ramp(stops, a, o) {
    a = clamp(a, 0, 1) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(a)), f = a - i, p = stops[i], q = stops[i + 1];
    o[0] = p[0] + (q[0] - p[0]) * f; o[1] = p[1] + (q[1] - p[1]) * f; o[2] = p[2] + (q[2] - p[2]) * f; return o;
  }
  const tmpc = [0, 0, 0, 0];
  const logT = (e) => Math.log(1 + e / ecr) / Math.log(1 + MAT.beta_2);
  function fieldColor(mode, x, y, o) {
    o[3] = 0;
    if (mode === 'stress') { const v = fieldStress(x, y); v < 0 ? ramp(C_COMP, -v / SIG_C, o) : ramp(C_TENS, v / SIG_T, o); o[3] = 0.84; return o; }
    if (mode === 'strain') { const e = fieldStrain(x, y); e < 0 ? ramp(C_COMP, -e / (ecr * MAT.lambda_cu), o) : ramp(C_TENS, logT(e), o); o[3] = 0.84; return o; }
    if (mode === 'kappa') {
      const k = (x < 0 || x > L) ? 0 : atX(S.kappa, x);
      ramp(C_SEQ, Math.log(1 + k / D.ref.Phicr) / Math.log(1 + kMaxAll / D.ref.Phicr), o); o[3] = 0.8; return o;
    }
    if (mode === 'dic') { ramp(JET, (dicStrain(x, y) - EMIN) / (EMAX - EMIN), o); o[3] = 0.66; return o; }
    return o;
  }

  // ---------- renderer and scene, hrcdesigner.com rig look ----------
  const canvas = document.getElementById('three');
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(32, 1, 0.02, 100);
  (function env() {
    const es = new T.Scene();
    es.add(new T.Mesh(new T.BoxGeometry(30, 16, 30), new T.MeshBasicMaterial({ color: 0xe9edf1, side: T.BackSide })));
    const panel = (w, hh, x, y, z, c) => { const m = new T.Mesh(new T.PlaneGeometry(w, hh), new T.MeshBasicMaterial({ color: c, side: T.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); es.add(m); };
    panel(12, 3, 0, 7.5, 0, 0xffffff); panel(6, 6, -12, 3, 6, 0xffffff); panel(5, 5, 12, 2, -6, 0xdfe6ee);
    scene.environment = new T.PMREMGenerator(renderer).fromScene(es, 0.03).texture;
  })();
  scene.add(new T.HemisphereLight(0xffffff, 0xaab2bb, 1.15));
  const sun = new T.DirectionalLight(0xffffff, 2.0);
  sun.position.set(-3, 6.5, 5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -2, near: 1, far: 20 });
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02; scene.add(sun);
  const fill = new T.DirectionalLight(0xffffff, 0.5); fill.position.set(4, 3, -5); scene.add(fill);
  const ground = new T.Mesh(new T.PlaneGeometry(40, 40), new T.ShadowMaterial({ opacity: 0.13 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  // ---------- surface textures ----------
  function makeCanvas(w, hh) { const c = document.createElement('canvas'); c.width = w; c.height = hh; return c; }
  const FW = 2048, FH = 584, TW = 1024, TH = 292;
  function speckle(w, hh, mmpx) {
    const c = makeCanvas(w, hh), g = c.getContext('2d');
    g.fillStyle = '#f1f1ee'; g.fillRect(0, 0, w, hh);
    for (let k = 0, n = Math.round(w * hh / 34); k < n; k++) {
      const r = (0.22 + 0.5 * rnd() * rnd()) / mmpx;
      g.fillStyle = `rgba(22,22,24,${0.72 + 0.28 * rnd()})`;
      g.beginPath(); g.ellipse(rnd() * w, rnd() * hh, r, r * (0.7 + 0.3 * rnd()), rnd() * 3, 0, 7); g.fill();
    }
    return c;
  }
  function concrete(w, hh, dark) {
    const c = makeCanvas(w, hh), g = c.getContext('2d'), img = g.createImageData(w, hh);
    for (let i = 0; i < w * hh; i++) { const v = (dark ? 96 : 206) + (rnd() - 0.5) * (dark ? 40 : 18); img.data[i * 4] = v; img.data[i * 4 + 1] = v - 2; img.data[i * 4 + 2] = v - 6; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    for (let k = 0; k < w * hh / (dark ? 90 : 420); k++) {
      g.fillStyle = dark ? `rgba(${rnd() > 0.93 ? '196,160,90' : '40,38,36'},${0.5 + 0.4 * rnd()})` : `rgba(70,68,64,${0.3 + 0.4 * rnd()})`;
      g.beginPath(); g.arc(rnd() * w, rnd() * hh, 0.6 + rnd() * rnd() * (dark ? 2.2 : 1.8), 0, 7); g.fill();
    }
    return c;
  }
  const baseFront = speckle(FW, FH, Ltot / FW), baseTB = concrete(TW, TH), baseCap = concrete(256, 256);
  function liveTex(w, hh) { const c = makeCanvas(w, hh), t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; return { c, g: c.getContext('2d'), t }; }
  const texFront = liveTex(FW, FH), texTop = liveTex(TW, TH), texBot = liveTex(TW, TH), texCap = liveTex(256, 256);
  const fracTex = new T.CanvasTexture(concrete(256, 256, true)); fracTex.colorSpace = T.SRGBColorSpace;
  const endTex = new T.CanvasTexture(concrete(256, 256)); endTex.colorSpace = T.SRGBColorSpace;
  function scratch(w, hh) { const c = makeCanvas(w, hh), g = c.getContext('2d'); return { c, g, img: g.createImageData(w, hh) }; }
  const fld = scratch(360, 104), row = scratch(360, 1), col = scratch(1, 104);
  function put(buf, p) { buf.img.data[p] = tmpc[0] * 255; buf.img.data[p + 1] = tmpc[1] * 255; buf.img.data[p + 2] = tmpc[2] * 255; buf.img.data[p + 3] = tmpc[3] * 255; }
  function paintField(mode) {
    for (let j = 0; j < 104; j++) { const y = (j + 0.5) * h / 104; for (let i = 0; i < 360; i++) { fieldColor(mode, -OV + (i + 0.5) * Ltot / 360, y, tmpc); put(fld, (j * 360 + i) * 4); } }
    fld.g.putImageData(fld.img, 0, 0);
  }
  function paintRow(mode, y) { for (let i = 0; i < 360; i++) { fieldColor(mode, -OV + (i + 0.5) * Ltot / 360, y, tmpc); put(row, i * 4); } row.g.putImageData(row.img, 0, 0); }
  const PXMM = FW / Ltot;
  function paintCracks(g, W, H, bottom) {
    g.lineCap = 'round'; g.lineJoin = 'round';
    sel.forEach(k => {
      if (S.cw[k] < 0.004 || S.tip[k] >= h - 0.5) return;
      if (bottom) {
        const wpx = mag * S.cw[k] * W / Ltot;
        g.strokeStyle = `rgba(24,20,18,${Math.min(1, 0.35 + 0.7 * wpx)})`; g.lineWidth = Math.max(0.9, wpx); g.beginPath();
        jitB[k].forEach((jx, r) => { const X = (pathX(k, h) + jx + OV) * W / Ltot, Y = r / (jitB[k].length - 1) * H; r ? g.lineTo(X, Y) : g.moveTo(X, Y); });
        g.stroke(); return;
      }
      const tp = S.tip[k];
      for (let j = ND - 1; j > 0; j--) {
        const y1 = yD[j], y0 = Math.max(yD[j - 1], tp); if (y1 <= tp) break;
        const wpx = crackOpen(k, (y0 + y1) / 2) * mag * PXMM;
        g.strokeStyle = `rgba(24,20,18,${Math.min(1, 0.3 + 0.8 * wpx)})`; g.lineWidth = Math.max(0.8, wpx);
        g.beginPath(); g.moveTo((pathX(k, y1) + OV) * PXMM, y1 / h * H); g.lineTo((pathX(k, y0) + OV) * PXMM, y0 / h * H); g.stroke();
      }
    });
  }
  function paintTextures(mode) {
    const over = mode !== 'specimen';
    if (over) paintField(mode);
    const g = texFront.g; g.drawImage(baseFront, 0, 0);
    if (over) { g.imageSmoothingEnabled = true; g.drawImage(fld.c, 0, 0, FW, FH); }
    paintCracks(g, FW, FH, false); texFront.t.needsUpdate = true;
    [[texTop, 0], [texBot, h]].forEach(([tx, y]) => {
      tx.g.drawImage(baseTB, 0, 0);
      if (over) { paintRow(mode, y); tx.g.drawImage(row.c, 0, 0, TW, TH); }
      if (y === h) paintCracks(tx.g, TW, TH, true);
      tx.t.needsUpdate = true;
    });
    if (cutOn) {
      texCap.g.drawImage(baseCap, 0, 0);
      if (over) { for (let j = 0; j < 104; j++) { fieldColor(mode, xCut, (j + 0.5) * h / 104, tmpc); put(col, j * 4); } col.g.putImageData(col.img, 0, 0); texCap.g.drawImage(col.c, 0, 0, 256, 256); }
      texCap.t.needsUpdate = true;
    }
  }

  // ---------- beam bodies (split along the DIC main crack) ----------
  const mats = {
    front: new T.MeshStandardMaterial({ map: texFront.t, roughness: 0.82, metalness: 0 }),
    top: new T.MeshStandardMaterial({ map: texTop.t, roughness: 0.9, metalness: 0 }),
    bot: new T.MeshStandardMaterial({ map: texBot.t, roughness: 0.9, metalness: 0 }),
    end: new T.MeshStandardMaterial({ map: endTex, roughness: 0.9, metalness: 0 }),
    cap: new T.MeshStandardMaterial({ map: texCap.t, roughness: 0.8, metalness: 0 }),
    frac: new T.MeshStandardMaterial({ map: fracTex, roughness: 1, metalness: 0 })
  };
  let patches = [];
  const tv = new T.Vector3();
  function grid(nu, nv, fn, flip, mat, side) {
    const P = new Float32Array(nu * nv * 3), U = new Float32Array(nu * nv * 2), I = [];
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const r = fn(i, j), q = j * nu + i; P.set(r.slice(0, 3), q * 3); U[q * 2] = r[3]; U[q * 2 + 1] = r[4]; }
    for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) { const a = j * nu + i, c = a + nu; if (flip) I.push(a, c, a + 1, a + 1, c, c + 1); else I.push(a, a + 1, c, a + 1, c + 1, c); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(P.length), 3)); g.setAttribute('uv', new T.BufferAttribute(U, 2)); g.setIndex(I);
    const m = new T.Mesh(g, mat); m.castShadow = m.receiveShadow = true; m.frustumCulled = false; scene.add(m);
    patches.push({ mesh: m, par: P, side });
  }
  let cutOn = Q.get('view') === 'section', xCut = L / 2, split = true;
  function buildBodies() {
    patches.forEach(p => { scene.remove(p.mesh); p.mesh.geometry.dispose(); }); patches = [];
    const xEnd = cutOn ? xCut : L + OV;
    split = !(cutOn && xCut <= xmMax + 1);
    const NU = 110, NZ = 8, zs = (i) => -b / 2 + b * i / (NZ - 1);
    const u = (x) => (x + OV) / Ltot, vY = (y) => 1 - y / h, vZ = (z) => (z + b / 2) / b;
    const bodies = split
      ? [{ side: -1, xa: () => -OV, xb: (y) => xm(y), crackR: true }, { side: 1, xa: (y) => xm(y), xb: () => xEnd, crackL: true }]
      : [{ side: cutOn ? -1 : 0, xa: () => -OV, xb: () => xEnd }];
    bodies.forEach(B => {
      const X = (i, y) => B.xa(y) + (B.xb(y) - B.xa(y)) * i / (NU - 1);
      grid(NU, ND, (i, j) => { const x = X(i, yD[j]); return [x, yD[j], b / 2, u(x), vY(yD[j])]; }, true, mats.front, B.side);
      grid(NU, ND, (i, j) => { const x = X(i, yD[j]); return [x, yD[j], -b / 2, u(x), vY(yD[j])]; }, false, mats.front, B.side);
      grid(NU, NZ, (i, j) => { const x = X(i, 0); return [x, 0, zs(j), u(x), vZ(zs(j))]; }, true, mats.top, B.side);
      grid(NU, NZ, (i, j) => { const x = X(i, h); return [x, h, zs(j), u(x), vZ(zs(j))]; }, false, mats.bot, B.side);
      if (!B.crackL) grid(NZ, ND, (i, j) => [B.xa(yD[j]), yD[j], zs(i), vZ(zs(i)), vY(yD[j])], true, mats.end, B.side);
      if (!B.crackR) grid(NZ, ND, (i, j) => [B.xb(yD[j]), yD[j], zs(i), vZ(zs(i)), vY(yD[j])], false, cutOn ? mats.cap : mats.end, B.side);
      if (B.crackR) grid(NZ, ND, (i, j) => [xm(yD[j]), yD[j], zs(i), vZ(zs(i)), vY(yD[j])], false, mats.frac, B.side);
      if (B.crackL) grid(NZ, ND, (i, j) => [xm(yD[j]), yD[j], zs(i), vZ(zs(i)), vY(yD[j])], true, mats.frac, B.side);
    });
    buildNA();
  }
  function updateBodies() {
    patches.forEach(p => {
      const pos = p.mesh.geometry.attributes.position.array, P = p.par;
      for (let i = 0; i < P.length; i += 3) { deform(P[i], P[i + 1], P[i + 2], p.side, tv); pos[i] = tv.x; pos[i + 1] = tv.y; pos[i + 2] = tv.z; }
      p.mesh.geometry.attributes.position.needsUpdate = true; p.mesh.geometry.computeVertexNormals();
    });
  }

  // ---------- neutral axis, drawn only where the engine defines it ----------
  const naMesh = new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color: 0x14181d, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
  naMesh.frustumCulled = false; scene.add(naMesh);
  let naX = [];
  function buildNA() {
    const xe = cutOn ? xCut : L, xg = xm(h / 2); naX = [];
    for (let i = 0; i <= 240; i++) naX.push(xe * i / 240);
    const n = naX.length, I = [];
    for (let i = 0; i < n - 1; i++) { const a = 2 * i; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 6), 3)); g.setIndex(I);
    naMesh.geometry.dispose(); naMesh.geometry = g;
  }
  function updateNA() {
    const pos = naMesh.geometry.attributes.position.array, xg = xm(clamp(S.cL, 0, h)); let p = 0;
    naX.forEach(x => {                                    // continuous: the crack opens below it
      const c = naAt(x), side = split ? (x < xg ? -1 : 1) : (cutOn ? -1 : 0);
      deform(x, c - 0.35, b / 2 + 0.4, side, tv); pos[p++] = tv.x; pos[p++] = tv.y; pos[p++] = tv.z;
      deform(x, c + 0.35, b / 2 + 0.4, side, tv); pos[p++] = tv.x; pos[p++] = tv.y; pos[p++] = tv.z;
    });
    naMesh.geometry.attributes.position.needsUpdate = true;
  }

  // ---------- smooth stress block on the cut face ----------
  const NS = 120;
  const finGeo = new T.BufferGeometry();
  finGeo.setAttribute('position', new T.BufferAttribute(new Float32Array((NS + 1) * 6 * 3), 3));
  finGeo.setAttribute('color', new T.BufferAttribute(new Float32Array((NS + 1) * 6 * 3), 3));
  (function () {
    const I = [], r = (k, j) => k * (NS + 1) + j;
    for (let j = 0; j < NS; j++) {
      I.push(r(0, j), r(1, j), r(0, j + 1), r(1, j), r(1, j + 1), r(0, j + 1));
      I.push(r(2, j), r(2, j + 1), r(3, j), r(3, j), r(2, j + 1), r(3, j + 1));
      I.push(r(4, j), r(5, j), r(4, j + 1), r(5, j), r(5, j + 1), r(4, j + 1));
    }
    finGeo.setIndex(I);
  })();
  const fin = new T.Mesh(finGeo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0, transparent: true, opacity: 0.9, side: T.DoubleSide }));
  fin.castShadow = true; fin.frustumCulled = false; scene.add(fin);
  const finLine = new T.Line(new T.BufferGeometry(), new T.LineBasicMaterial({ color: 0x14181d }));
  finLine.geometry.setAttribute('position', new T.BufferAttribute(new Float32Array((NS + 1) * 3), 3)); finLine.frustumCulled = false; scene.add(finLine);
  function updateFin() {
    fin.visible = finLine.visible = cutOn;
    if (!fin.visible) return;
    const side = split && xCut > xmMax ? 1 : -1, zb = b / 2 * 0.94, A = new T.Vector3(), B = new T.Vector3();
    const pos = finGeo.attributes.position.array, cl = finGeo.attributes.color.array, lp = finLine.geometry.attributes.position.array;
    for (let j = 0; j <= NS; j++) {
      const y = h * j / NS, sg = secStress(xCut, y), len = Math.abs(sg) / SIG_C * 0.8 * h;
      deform(xCut - 0.5, y, 0, side, A); deform(xCut + 0.5, y, 0, side, B); const dir = B.sub(A).normalize();
      sg < 0 ? ramp(C_COMP, -sg / SIG_C, tmpc) : ramp(C_TENS, sg / SIG_T, tmpc);
      const c0 = [tmpc[0] ** 2.2, tmpc[1] ** 2.2, tmpc[2] ** 2.2];
      [[0, 0, zb], [1, len + 0.4, zb], [2, 0, -zb], [3, len + 0.4, -zb], [4, len + 0.4, zb], [5, len + 0.4, -zb]].forEach(([k, l, z]) => {
        deform(xCut + 0.2, y, z, side, tv); tv.addScaledVector(dir, l * s);
        const q = (k * (NS + 1) + j) * 3, f = (k === 0 || k === 2) ? 0.7 : 1;
        pos[q] = tv.x; pos[q + 1] = tv.y; pos[q + 2] = tv.z; cl[q] = c0[0] * f; cl[q + 1] = c0[1] * f; cl[q + 2] = c0[2] * f;
        if (k === 1) { lp[j * 3] = tv.x; lp[j * 3 + 1] = tv.y; lp[j * 3 + 2] = tv.z; }
      });
    }
    finGeo.attributes.position.needsUpdate = true; finGeo.attributes.color.needsUpdate = true; finGeo.computeVertexNormals();
    finLine.geometry.attributes.position.needsUpdate = true;
  }

  // ---------- steel fibres bridging the main crack (illustrative) ----------
  const NFIB = 260, fibers = [];
  for (let k = 0; k < NFIB; k++) { const r = rnd(); fibers.push({ y: h * (0.98 - 0.9 * r * r), z: b * 0.47 * (2 * rnd() - 1), le: [0.3 + 6.2 * rnd(), 0.3 + 6.2 * rnd()], ty: (rnd() - 0.5) * 0.9, tz: (rnd() - 0.5) * 0.9 }); }
  const fibMesh = new T.InstancedMesh(new T.CylinderGeometry(1, 1, 1, 6), new T.MeshStandardMaterial({ color: 0xe2bd6a, metalness: 0.6, roughness: 0.32, emissive: 0x3a2a08 }), NFIB);
  fibMesh.frustumCulled = false; scene.add(fibMesh);
  const up = new T.Vector3(0, 1, 0), qf = new T.Quaternion(), m4 = new T.Matrix4(), PL = new T.Vector3(), PR = new T.Vector3(), dv = new T.Vector3(), sc = new T.Vector3(), mid = new T.Vector3();
  function updateFibers() {
    let n = 0;
    if (split && S.thh > 0) for (const f of fibers) {
      const o = S.thh * (f.y - S.cL); if (o <= 0.02 || f.y < S.tip[KM]) continue;
      const x = xm(f.y); deform(x, f.y, f.z, -1, PL); deform(x, f.y + o * f.ty, f.z + o * f.tz, 1, PR);
      const short = Math.min(f.le[0], f.le[1]);
      if (o > short) {
        const keepR = f.le[1] >= f.le[0], P0 = keepR ? PR : PL, P1 = keepR ? PL : PR;
        dv.subVectors(P1, P0); const stub = Math.min(short * mag * s, dv.length() * 0.85); dv.normalize();
        PL.copy(P0); PR.copy(P0).addScaledVector(dv, stub);
      }
      dv.subVectors(PR, PL); const len = dv.length(); if (len < 1e-5) continue;
      qf.setFromUnitVectors(up, dv.normalize()); m4.compose(mid.copy(PL).add(PR).multiplyScalar(0.5), qf, sc.set(0.003, len, 0.003)); fibMesh.setMatrixAt(n++, m4);
    }
    fibMesh.count = n; fibMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- test rig, after the Beam 1 fixture ----------
  const std = (c, o) => new T.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.4, metalness: 0.6 }, o || {}));
  const chrome = std(0xc8ced4, { roughness: 0.25, metalness: 0.9 }), steel = std(0x7d858e), dark = std(0x3b4148, { roughness: 0.55, metalness: 0.5 });
  const rig = new T.Group(); scene.add(rig);
  function box(w, hh, d, mat, x, y, z, parent) { const m = new T.Mesh(new T.BoxGeometry(w * s, hh * s, d * s), mat); m.position.set(x * s, y * s, z * s); m.castShadow = m.receiveShadow = true; (parent || rig).add(m); return m; }
  function cyl(r, len, mat, axis, x, y, z, parent) { const g = new T.CylinderGeometry(r * s, r * s, len * s, 36); if (axis === 'z') g.rotateX(Math.PI / 2); const m = new T.Mesh(g, mat); m.position.set(x * s, y * s, z * s); m.castShadow = m.receiveShadow = true; (parent || rig).add(m); return m; }
  const yTopMM = Y0 / s;
  box(Ltot + 150, 20, 230, steel, 0, 10, 0);
  const supports = [0, L].map(xs => {
    const g = new T.Group(), X = xs - L / 2; rig.add(g); g.userData.x = xs;
    box(56, yTopMM - 2 * R - 20, 170, steel, X, 20 + (yTopMM - 2 * R - 20) / 2, 0, g);
    cyl(R, 170, chrome, 'z', X, yTopMM - R, 0, g);
    [1, -1].forEach(sd => { box(26, 58, 6, chrome, X, yTopMM - R - 12, sd * (b / 2 + 9), g); [0, -24].forEach(dy => cyl(4.2, 4, dark, 'z', X, yTopMM - R + dy, sd * (b / 2 + 13), g)); });
    return g;
  });
  const loaders = [G.xLoad1, G.xLoad2].map(xl => {
    const g = new T.Group(); rig.add(g); g.userData.x = xl;
    cyl(R, 170, chrome, 'z', 0, 0, 0, g);
    [1, -1].forEach(sd => { box(26, 92, 6, chrome, 0, 38, sd * (b / 2 + 9), g); [0, 24].forEach(dy => cyl(4.2, 4, dark, 'z', 0, dy, sd * (b / 2 + 13), g)); });
    return g;
  });
  const head = new T.Group(); rig.add(head);
  box(G.S2 + 110, 34, 170, steel, 0, 0, 0, head);
  cyl(34, 44, chrome, 'y', 0, 39, 0, head);
  cyl(36, 6, std(0x8c1d40, { metalness: 0.2, roughness: 0.5 }), 'y', 0, 64, 0, head);
  const rod = cyl(20, 1, chrome, 'y', 0, 0, 0);
  function updateRig() {
    loaders.forEach(g => { deform(g.userData.x, 0, 0, split ? (g.userData.x < XH ? -1 : 1) : 0, tv); g.position.set(tv.x, tv.y + R * s, 0); g.visible = !(cutOn && g.userData.x > xCut); });
    supports.forEach(g => { g.visible = !(cutOn && g.userData.x > xCut); });
    const yt = (loaders[0].position.y + loaders[1].position.y) / 2 / s + 82;
    head.position.set(0, yt * s, 0);
    const r0 = yt + 70, r1 = 750; rod.scale.y = Math.max(1, r1 - r0); rod.position.y = (r0 + r1) / 2 * s;
  }

  // ---------- camera ----------
  const $ = (id) => document.getElementById(id);
  const cam = { az: -0.5, el: 0.2, r: 6.3, tx: 0, ty: Y0 + 0.3, tz: 0 }, goal = Object.assign({}, cam);
  const VIEWS = {
    hero: () => ({ az: -0.5, el: 0.2, r: 6.3, tx: 0, ty: Y0 + 0.3, tz: 0 }),
    side: () => ({ az: 0, el: 0.03, r: 4.3, tx: 0, ty: Y0 + 0.55, tz: 0 }),
    crack: () => ({ az: -0.42, el: -0.05, r: 1.7, tx: (XH - L / 2) * s, ty: Y0 + h * s * 0.55, tz: b * s * 0.3 }),
    section: () => ({ az: 0.95, el: 0.24, r: 2.7, tx: (xCut - L / 2) * s, ty: Y0 + h * s / 2, tz: 0 })
  };
  let dirty = true;
  function setView(name) {
    Object.assign(goal, VIEWS[name]());
    const wantCut = name === 'section';
    if (wantCut !== cutOn) { cutOn = wantCut; buildBodies(); }
    document.querySelectorAll('.views .btn').forEach(bn => bn.classList.toggle('on', bn.dataset.view === name));
    $('cutbox').classList.toggle('show', cutOn); dirty = true;
  }
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) { const k = goal.r * 0.0014; goal.tx -= dx * k * Math.cos(goal.az); goal.tz += dx * k * Math.sin(goal.az); goal.ty += dy * k; }
    else { goal.az -= dx * 0.006; goal.el = clamp(goal.el + dy * 0.005, -0.7, 1.35); }
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => { e.preventDefault(); goal.r = clamp(goal.r * Math.exp(e.deltaY * 0.001), 0.6, 14); }, { passive: false });
  function placeCamera(k) {
    for (const p in cam) cam[p] += (goal[p] - cam[p]) * k;
    const ce = Math.cos(cam.el);
    camera.position.set(cam.tx + cam.r * ce * Math.sin(cam.az), cam.ty + cam.r * Math.sin(cam.el), cam.tz + cam.r * ce * Math.cos(cam.az));
    camera.lookAt(cam.tx, cam.ty, cam.tz);
  }

  // ---------- span diagram on the beam face (no axis, shape and growth only) ----------
  let diagram = Q.get('diagram') || 'none';
  let eMaxAll = ecr; F.ebL.forEach(v => { if (v > eMaxAll) eMaxAll = v; });
  const DG = {
    kappa: { name: 'Curvature κ(x)', color: 0x8c1d40, v: (x) => Math.log(1 + atX(S.kappa, x) / D.ref.Phicr) / Math.log(1 + kMaxAll / D.ref.Phicr) },
    moment: { name: 'Moment M(x)', color: 0x14181d, v: (x) => atX(S.moment, x) / D.ref.Mpk_kNm },
    strain: { name: 'Bottom-face strain', color: 0xe08a12, v: (x) => { const e = fieldStrain(x, h); return e > 0 ? Math.log(1 + e / ecr) / Math.log(1 + eMaxAll / ecr) : 0; } }
  };
  // drawn in material coordinates on the DIC face, rising from the bottom edge, so it
  // bends with the beam and splits at the crack
  const NDG = 241, HF = 0.72 * h, ZF = b / 2 + 0.6;
  const off = (f) => ({ side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: 2 * f });
  const dgFillMat = new T.MeshBasicMaterial(Object.assign({ color: 0x8c1d40, transparent: true, opacity: 0.14, depthWrite: false }, off(-2)));
  const dgHaloMat = new T.MeshBasicMaterial(Object.assign({ color: 0xffffff }, off(-4)));
  const dgLineMat = new T.MeshBasicMaterial(Object.assign({ color: 0x8c1d40 }, off(-6)));
  function stripGeo(n) {
    const g = new T.BufferGeometry(), I = [];
    for (let i = 0; i < n - 1; i++) { const a = 2 * i; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 6), 3)); g.setIndex(I); return g;
  }
  const dgFill = new T.Mesh(stripGeo(NDG), dgFillMat), dgHalo = new T.Mesh(stripGeo(NDG), dgHaloMat), dgLine = new T.Mesh(stripGeo(NDG), dgLineMat);
  [dgFill, dgHalo, dgLine].forEach(m => { m.frustumCulled = false; m.renderOrder = 2; scene.add(m); });
  const dgTag = document.createElement('div'); dgTag.className = 'tag diag'; $('tags').appendChild(dgTag);
  const dgPeak = new T.Vector3();
  function updateDiagram() {
    const d = DG[diagram];
    dgFill.visible = dgHalo.visible = dgLine.visible = !!d; naMesh.visible = diagram === 'na';
    if (!d) return;
    dgFillMat.color.setHex(d.color); dgLineMat.color.setHex(d.color);
    const xe = cutOn ? xCut : L, fp = dgFill.geometry.attributes.position.array;
    const hp = dgHalo.geometry.attributes.position.array, lp = dgLine.geometry.attributes.position.array;
    const pair = (arr, q, x, y0, y1, side) => {
      deform(x, y0, ZF, side, tv); arr[q] = tv.x; arr[q + 1] = tv.y; arr[q + 2] = tv.z;
      deform(x, y1, ZF, side, tv); arr[q + 3] = tv.x; arr[q + 4] = tv.y; arr[q + 5] = tv.z;
    };
    let best = -1;
    for (let i = 0; i < NDG; i++) {
      const x = xe * i / (NDG - 1), v = clamp(d.v(x), 0, 1.05), side = split ? (x < xm(h) ? -1 : 1) : (cutOn ? -1 : 0);
      const yc = h - v * HF, q = i * 6;
      pair(fp, q, x, h, yc, side);
      pair(hp, q, x, yc - 1.1, yc + 1.1, side);
      pair(lp, q, x, yc - 0.45, yc + 0.45, side);
      if (v > best) { best = v; deform(x, yc, ZF, side, dgPeak); }
    }
    [dgFill, dgHalo, dgLine].forEach(m => { m.geometry.attributes.position.needsUpdate = true; });
    dgTag.textContent = d.name;
  }

  // ---------- labels for the selected cracks ----------
  const tags = DIC.gauges.map(g => { const el = document.createElement('div'); el.className = 'tag'; el.textContent = g; $('tags').appendChild(el); return el; });
  function updateTags() {
    const r = canvas.getBoundingClientRect();
    const dgOn = diagram !== 'none';
    if (dgOn) {
      const v = (diagram === 'na' ? deform(L * 0.3, naAt(L * 0.3), b / 2, split ? -1 : 0, new T.Vector3()) : dgPeak.clone()).project(camera);
      if (diagram === 'na') dgTag.textContent = 'Neutral axis';
      const ok = v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
      dgTag.style.display = ok ? 'block' : 'none';
      if (ok) dgTag.style.transform = `translate(${(v.x + 1) / 2 * r.width}px, ${(1 - v.y) / 2 * r.height}px)`;
    } else dgTag.style.display = 'none';
    tags.forEach((el, k) => {
      if (!sel.has(k) || S.cw[k] < 0.004 || S.tip[k] >= h - 1 || (cutOn && pathX(k, h) > xCut)) { el.style.display = 'none'; return; }
      const v = deform(pathX(k, h) + (k === KM ? 3 : 0), h + 2, b / 2, split ? (pathX(k, h) < xm(h) ? -1 : 1) : 0, new T.Vector3()).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) { el.style.display = 'none'; return; }
      el.style.display = 'block'; el.style.transform = `translate(${(v.x + 1) / 2 * r.width}px, ${(1 - v.y) / 2 * r.height}px)`;
    });
  }

  // ---------- charts ----------
  const RED = '#8C1D40', RED_L = '#efb7b9', INK = '#14181d', BLUE = '#2f6fb2', GREY = '#9aa3ad', MUTE = '#77808c';
  const cPD = new MiniChart($('cPD'), { title: 'Load vs midspan deflection', xl: 'deflection (mm)', yl: 'P (kN)' });
  const cKX = new MiniChart($('cKX'), { title: 'Curvature along the span, model', xl: 'x (mm)', yl: 'κ (1e-5 / mm)' });
  const cSEC = new MiniChart($('cSEC'), { title: 'Stress through the depth, model', xl: 'σx (MPa)', yl: 'height (mm)' });
  const cCW = new MiniChart($('cCW'), { title: 'Crack width vs load, DIC', xl: 'crack width (mm)', yl: 'P (kN)' });
  const rng = {}, smooth = (key, v) => { rng[key] = rng[key] ? rng[key] + (v - rng[key]) * 0.15 : v; return rng[key]; };
  function sectionProfile(x) {
    const n = 400, ys = [], sg = [];
    for (let j = 0; j <= n; j++) { const y = h * j / n; ys.push(y); sg.push(secStress(x, y)); }
    let N = 0, M = 0;
    for (let j = 0; j < n; j++) { const f = b * (ys[j + 1] - ys[j]) * (sg[j] + sg[j + 1]) / 2, ym = (ys[j] + ys[j + 1]) / 2; N += f; M += f * (ym - h / 2); }
    return { ys, sg, N: N / 1e3, M: M / 1e6 };
  }
  function drawCharts() {
    const i = Math.round(S.t);
    const dR = smooth('d', Math.max(S.delta * 1.3, F.delta[PK] * 1.9));
    cPD.frame([0, dR], [0, D.ref.Ppk_kN * 1.18]);
    cPD.path(D.exp.d, D.exp.P, INK, 1.3);
    cPD.path(F.delta, F.P, RED_L, 1.4);
    cPD.path(F.delta.slice(0, i + 1), F.P.slice(0, i + 1), RED, 2.2);
    cPD.dot(S.delta, S.P, RED);
    cPD.key([['Experiment', INK, [], 1.3], ['Inverse Analysis', RED]]);

    let kmx = 0; for (let j = 0; j < nx; j++) kmx = Math.max(kmx, S.kappa[j]);
    const kxR = smooth('kx', Math.max(kmx * 1.2e5, D.ref.Phicr * 3e5));
    cKX.frame([0, L], [0, kxR]);
    const zc = ['rgba(154,163,173,.35)', 'rgba(240,160,48,.35)', 'rgba(47,111,178,.25)', 'rgba(209,35,42,.28)'];
    for (let j = 0; j < nx - 1; j++) cKX.fill([D.x[j], D.x[j + 1], D.x[j + 1], D.x[j]], [0, 0, S.kappa[j + 1] * 1e5, S.kappa[j] * 1e5], zc[S.zone[j]]);
    cKX.path(D.x, Array.from(S.kappa, v => v * 1e5), INK, 1.6);
    cKX.vline(G.xLoad1, GREY, [2, 3]); cKX.vline(G.xLoad2, GREY, [2, 3]);
    cKX.key(S.post ? [['localized', RED, [], 6], ['unloading, K0', BLUE, [], 6]] : [['cracked', '#f0a030', [], 6], ['uncracked', GREY, [], 6]], 'tl');

    const xs = cutOn ? xCut : (S.post ? xc(S.cL) : L / 2);
    cSEC.frame([-SIG_C * 1.08, SIG_T * 2.2], [0, h]);
    const pr = sectionProfile(xs), xsg = [], ysg = [];
    for (let j = 0; j < pr.ys.length; j += 4) { xsg.push(pr.sg[j]); ysg.push(h - pr.ys[j]); }
    for (let j = 0; j < xsg.length - 1; j++) { const m = (xsg[j] + xsg[j + 1]) / 2; cSEC.fill([0, xsg[j], xsg[j + 1], 0], [ysg[j], ysg[j], ysg[j + 1], ysg[j + 1]], m < 0 ? 'rgba(47,111,178,.32)' : 'rgba(209,35,42,.45)'); }
    cSEC.path(pr.sg, pr.ys.map(y => h - y), INK, 1.5);
    cSEC.vline(0, GREY, [1, 0]);
    const cc = secNA(xs); cSEC.hline(h - cc, INK, [4, 3]);
    cSEC.label(-SIG_C * 1.02, h - cc - 3, 'neutral axis, ' + cc.toFixed(1) + ' mm deep', INK, 'left', 'top');
    cSEC.label(-SIG_C * 1.02, 17, (atCrack(xs) ? 'at CW1, localized, ' : S.post ? 'unloading, ' : cutOn ? 'cut, ' : 'midspan, ') + 'x = ' + xs.toFixed(0) + ' mm', MUTE, 'left');
    cSEC.label(-SIG_C * 1.02, 6, 'check: N = ' + pr.N.toFixed(2) + ' kN, M = ' + pr.M.toFixed(3) + ' vs ' + atX(S.moment, xs).toFixed(3) + ' kN·m', MUTE, 'left');

    let wmax = 0; sel.forEach(k => { wmax = Math.max(wmax, S.cw[k]); });
    const wR = smooth('w', Math.max(0.3, wmax * 1.35));
    cCW.frame([0, wR], [0, D.ref.Ppk_kN * 1.18]);
    const items = [];
    [...sel].sort((a, c) => DIC.gauges[a].localeCompare(DIC.gauges[c])).forEach(k => {
      const g = DIC.gauges[k], main = k === KM;
      cCW.path(DIC.asc[g].concat(DIC.desc[g]), DIC.asc.P_kN.concat(DIC.desc.P_kN), BLUE, main ? 2 : 1.4, main ? [] : [4, 2]);
      if (S.cw[k] > 0) cCW.dot(S.cw[k], S.P, BLUE, main ? 4.5 : 3.5);
      items.push([g, BLUE, main ? [] : [4, 2], main ? 2 : 1.4]);
    });
    if (items.length) cCW.key(items); else cCW.label(wR * 0.5, D.ref.Ppk_kN * 0.6, 'Select a crack below', MUTE, 'center');
  }

  // ---------- readout, phase, legend ----------
  function hud() {
    const midI = Math.round((nx - 1) / 2);
    let txt;
    if (Math.abs(S.t - PK) < 1.2) txt = 'Peak load, localization starts';
    else if (S.post) txt = 'Softening, localized';
    else if (S.ebot[midI] > ecr) txt = 'Strain hardening, multiple cracking';
    else txt = 'Elastic, uncracked';
    $('phase').querySelector('span').textContent = txt;
    $('rP').textContent = S.P.toFixed(2) + ' kN';
    $('rD').textContent = S.delta.toFixed(3) + ' mm';
    $('rC').textContent = (S.post ? S.cL : S.c[midI]).toFixed(1) + ' mm' + (S.post ? ', at CW1' : ', midspan');
    const k = sel.has(KM) ? KM : [...sel][0];
    if (k === undefined) { $('rWl').textContent = 'Crack width'; $('rW').textContent = 'no crack selected'; $('rWm').textContent = ''; }
    else {
      $('rWl').textContent = DIC.gauges[k] + ' width, DIC';
      $('rW').textContent = S.cw[k].toFixed(3) + ' mm';
      $('rWm').textContent = '';
    }
  }
  let field = Q.get('field') || 'dic';
  const LEG = {
    stress: { t: 'Stress σx, HRC model', g: 'linear-gradient(90deg,#1a3d73,#2f6fb2,#9ec2e6,#eef1f5,#fbcc73,#f0a030,#8C1D40)', k: ['-' + SIG_C.toFixed(0) + ' MPa', '0', '+' + SIG_T.toFixed(1) + ' MPa'], n: 'Separate scales for compression and tension. After the peak the rest of the beam unloads.' },
    strain: { t: 'Strain εx, HRC model', g: 'linear-gradient(90deg,#1a3d73,#2f6fb2,#9ec2e6,#eef1f5,#fbcc73,#f0a030,#8C1D40)', k: ['-' + (ecr * MAT.lambda_cu * 100).toFixed(2) + '%', '0', (ecr * MAT.beta_2 * 100).toFixed(0) + '%, log'], n: 'Smeared strain of the section model.' },
    kappa: { t: 'Curvature κ(x), HRC model', g: 'linear-gradient(90deg,#cbd3db,#f0a030,#8C1D40,#730d14)', k: ['0', 'log scale', (kMaxAll * 1e5).toFixed(0) + 'e-5 /mm'], n: 'Engine curvature, uniform over the localized zone after the peak.' },
    dic: { t: 'Strain field, DIC view', g: 'linear-gradient(90deg,#1a248f,#1f54db,#17b3e6,#2ec76b,#b3d92e,#ffd41f,#ff7a1a,#db1a1f)', k: ['-0.30%', '0', '+0.50%'], n: 'Model strain between cracks plus the measured opening of the selected cracks.' },
    specimen: { t: 'Specimen', g: 'linear-gradient(90deg,#f1f1ee,#9aa3ad,#14181d)', k: ['', '', ''], n: 'Selected cracks drawn at the measured width.' }
  };
  function legend() { const l = LEG[field]; $('legend').innerHTML = `<div class="t">${l.t}</div><div class="bar" style="background:${l.g}"></div><div class="ticks"><span>${l.k[0]}</span><span>${l.k[1]}</span><span>${l.k[2]}</span></div><div class="note">${l.n}</div>`; }
  // a host page may carry its own header and credit text; fill only if empty
  if ($('hdrmeta') && !$('hdrmeta').textContent.trim()) $('hdrmeta').textContent = `${D.meta.title}, ${b.toFixed(1)} × ${h.toFixed(1)} mm, span ${L.toFixed(1)} mm`;
  if (!$('credit').textContent.trim()) $('credit').textContent = `Model: ${D.meta.engine}, exported ${D.meta.generated}. Cracks: Vic-2D DIC of the same beam at equal load. After the peak the model rotation is drawn as a hinge at CW1 giving the model midspan deflection; fibres illustrative.`;

  // ---------- controls ----------
  let t = Q.has('t') ? +Q.get('t') * (nF - 1) : 0, playing = Q.get('play') !== '0' && !Q.has('t'), hold = 0;
  const slider = $('t'), playB = $('play');
  function marks() {
    const tl = $('timeline'); tl.querySelectorAll('.tmark').forEach(e => e.remove());
    const add = (f, txt, cls) => { const el = document.createElement('div'); el.className = 'tmark' + (cls ? ' ' + cls : ''); el.textContent = txt; el.style.left = `calc(${(f / (nF - 1) * 100).toFixed(2)}% + ${(8 - 16 * f / (nF - 1)).toFixed(1)}px)`; tl.appendChild(el); };
    const opens = [...sel].map(k => [F.cw.findIndex(r => r[k] >= 0.01), DIC.gauges[k]]).filter(q => q[0] >= 0).sort((a, c) => a[0] - c[0]);
    if (opens.length === 1) add(opens[0][0], opens[0][1] + ' opens');
    else if (opens.length > 1) add(opens[0][0], 'first crack opens');
    add(PK, 'Peak', 'pk');
  }
  const chips = [];
  ['CW1', 'CW2', 'CW4', 'CW5'].forEach(g => {
    const k = byName[g]; if (k === undefined) return;
    const bn = document.createElement('button'); bn.className = 'chip' + (sel.has(k) ? ' on' : ''); bn.textContent = k === KM ? g + ' main' : g;
    bn.title = 'Show or hide ' + g; $('chips').appendChild(bn); chips.push([bn, k]);
    bn.addEventListener('click', () => { sel.has(k) ? sel.delete(k) : sel.add(k); bn.classList.toggle('on', sel.has(k)); marks(); dirty = true; });
  });
  if (Q.has('cracks')) { sel.clear(); Q.get('cracks').split(',').forEach(g => { if (byName[g] !== undefined) sel.add(byName[g]); }); chips.forEach(([bn, k]) => bn.classList.toggle('on', sel.has(k))); }
  slider.addEventListener('input', () => { t = slider.value / 1000 * (nF - 1); playing = false; playB.textContent = 'Play'; dirty = true; });
  playB.addEventListener('click', () => { playing = !playing; if (playing && t >= nF - 1.01) t = 0; playB.textContent = playing ? 'Pause' : 'Play'; });
  $('field').value = field; $('field').addEventListener('change', e => { field = e.target.value; legend(); dirty = true; });
  $('diagram').value = diagram; $('diagram').addEventListener('change', e => { diagram = e.target.value; dirty = true; });
  $('mag').value = mag; $('magv').textContent = mag;
  $('mag').addEventListener('input', e => { mag = +e.target.value; $('magv').textContent = mag; dirty = true; });
  $('cut').addEventListener('input', e => { xCut = +e.target.value * L; $('cutv').textContent = xCut.toFixed(0) + ' mm'; if (cutOn) { goal.tx = (xCut - L / 2) * s; buildBodies(); dirty = true; } });
  $('cutv').textContent = xCut.toFixed(0) + ' mm';
  document.querySelectorAll('.views .btn').forEach(bn => bn.addEventListener('click', () => setView(bn.dataset.view)));
  playB.textContent = playing ? 'Pause' : 'Play';

  // ---------- loop ----------
  const stage = $('stage');
  function resize() { const r = stage.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); dirty = true; }
  new ResizeObserver(resize).observe(stage);
  function update() { setState(t); updateBodies(); updateRig(); paintTextures(field); updateNA(); updateDiagram(); updateFin(); updateFibers(); drawCharts(); hud(); }
  let last = performance.now(), lastT = -1;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (playing) {
      if (hold > 0) hold -= dt;
      else {
        const before = t; t += dt * 24;
        if (before < PK && t >= PK) { t = PK; hold = 1.3; }
        if (t >= nF - 1) { t = nF - 1; hold = 2.2; setTimeout(() => { if (playing) t = 0; }, 2200); }
      }
      slider.value = Math.round(t / (nF - 1) * 1000);
    }
    if (dirty || t !== lastT) { update(); lastT = t; dirty = false; }
    placeCamera(Q.has('t') ? 1 : 0.12); renderer.render(scene, camera); updateTags();
    requestAnimationFrame(frame);
  }
  buildBodies(); legend(); marks(); resize();
  setView(Q.get('view') || 'hero');
  // test hook: advance to frame tt synchronously, return the update time in ms
  function step(tt) { const a = performance.now(); t = tt; update(); renderer.render(scene, camera); lastT = t; return performance.now() - a; }
  window.__beam = { get t() { return t; }, set t(v) { t = v; dirty = true; }, step, setView, S, sel, lawSig, sectionProfile, secStress, atCrack, xc, get patches() { return patches; } };
  requestAnimationFrame(frame);
})();
