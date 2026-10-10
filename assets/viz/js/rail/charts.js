/* Live charts for the Valley Metro twin, drawn on canvas.
 * Two panels, [data-chart="loop"] and [data-chart="stiff"], in one of two modes:
 *   'defl'   load against midspan deflection (MTS loops) and loop stiffness against
 *            cycles (the processed table behind manuscript Fig 15)
 *   'crack'  load against the crack width at the soffit (DIC clip gauge, one recorded
 *            cycle per burst) and the crack width at 8 and 16 kips against cycles
 * Exposes window.HRCRailCharts.bind(root, data) -> { update(state), setMode(mode) }.
 */
(function () {
  'use strict';
  var C = { red: '#FFC627', redSoft: 'rgba(255,198,39,', ink: '#e9edf1', muted: '#8f9aa6', grid: 'rgba(255,255,255,.07)', axis: 'rgba(255,255,255,.3)', blue: '#7fb2ff' };

  function Canvas(el) {
    this.el = el;
    this.cv = document.createElement('canvas');
    el.appendChild(this.cv);
    this.g = this.cv.getContext('2d');
    var self = this;
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(function () { self.size(); if (self.redraw) self.redraw(); });
      this.ro.observe(el);
    }
    this.size();
  }
  Canvas.prototype.size = function () {
    var r = Math.min(window.devicePixelRatio || 1, 2), w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.w = w; this.h = h;
    this.cv.width = Math.round(w * r); this.cv.height = Math.round(h * r);
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    this.g.setTransform(r, 0, 0, r, 0, 0);
  };

  function niceStep(span, n) {
    var raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  }
  function axes(c, box, xr, yr, xl, yl, xfmt) {
    var g = c.g;
    g.clearRect(0, 0, c.w, c.h);
    g.font = '10px "IBM Plex Mono", ui-monospace, monospace';
    g.fillStyle = C.muted; g.strokeStyle = C.grid; g.lineWidth = 1;
    var X = function (v) { return box.x + (v - xr[0]) / (xr[1] - xr[0]) * box.w; };
    var Y = function (v) { return box.y + box.h - (v - yr[0]) / (yr[1] - yr[0]) * box.h; };
    var sx = niceStep(xr[1] - xr[0], 4), sy = niceStep(yr[1] - yr[0], 4);
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (var v = Math.ceil(xr[0] / sx - 1e-9) * sx; v <= xr[1] + 1e-9; v += sx) {
      g.beginPath(); g.moveTo(X(v), box.y); g.lineTo(X(v), box.y + box.h); g.stroke();
      g.fillText(xfmt ? xfmt(v) : String(+v.toFixed(3)), X(v), box.y + box.h + 5);
    }
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (var w = Math.ceil(yr[0] / sy - 1e-9) * sy; w <= yr[1] + 1e-9; w += sy) {
      g.beginPath(); g.moveTo(box.x, Y(w)); g.lineTo(box.x + box.w, Y(w)); g.stroke();
      g.fillText(String(+w.toFixed(3)), box.x - 6, Y(w));
    }
    g.strokeStyle = C.axis; g.beginPath(); g.moveTo(box.x, box.y); g.lineTo(box.x, box.y + box.h); g.lineTo(box.x + box.w, box.y + box.h); g.stroke();
    g.font = '600 11px Inter, system-ui, sans-serif'; g.fillStyle = C.ink;
    g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(yl, box.x, 8);
    g.font = '500 10.5px Inter, system-ui, sans-serif'; g.fillStyle = C.muted;
    g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText(xl, box.x + box.w, c.h - 4);
    return { X: X, Y: Y };
  }
  function dot(g, x, y) {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 3.8, 0, Math.PI * 2); g.fill();
    g.strokeStyle = C.red; g.lineWidth = 2; g.stroke();
  }
  function trail(g, t, pts) {
    g.strokeStyle = C.red; g.lineWidth = 2; g.beginPath();
    for (var m = 0; m < pts.length; m++) { var a = pts[m]; m ? g.lineTo(t.X(a[0]), t.Y(a[1])) : g.moveTo(t.X(a[0]), t.Y(a[1])); }
    g.stroke();
  }
  function blockOf(D, N) {
    var b = D.blocks, i = 0;
    while (i < b.N.length - 1 && b.N[i + 1] <= N) i++;
    return { dmin: b.dmin[i], dmax: b.dmax[i], pmin: b.pmin[i], pmax: b.pmax[i] };
  }
  function lerpN(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    var i = 0; while (xs[i + 1] < x) i++;
    return ys[i] + (ys[i + 1] - ys[i]) * (x - xs[i]) / (xs[i + 1] - xs[i]);
  }

  /* ---------------------------------------------------------- panel A */
  function LoopChart(el, D) {
    this.c = new Canvas(el); this.D = D; this.mode = 'defl';
    var b = D.blocks, dmin = Infinity, dmax = 0, pmax = 0;
    for (var i = 0; i < b.N.length; i++) { dmin = Math.min(dmin, b.dmin[i]); dmax = Math.max(dmax, b.dmax[i]); pmax = Math.max(pmax, b.pmax[i]); }
    var wmax = 0;
    D.dic.bursts.forEach(function (u) { u.loopW.forEach(function (v) { wmax = Math.max(wmax, v); }); u.loopP.forEach(function (v) { pmax = Math.max(pmax, v); }); });
    this.xr = [Math.min(0, Math.floor(dmin * 4) / 4) - 0.25, Math.ceil(dmax * 2) / 2 + 0.25];
    this.wr = [-0.05, Math.ceil(wmax * 10) / 10 + 0.05];
    this.yr = [0, Math.ceil(pmax * 1.1 / 10) * 10];
    this.trail = [];
  }
  LoopChart.prototype.draw = function (st) {
    var c = this.c;
    if (!c.w) { c.size(); if (!c.w) return; }
    var box = { x: 42, y: 30, w: c.w - 56, h: c.h - 62 }, g = c.g, D = this.D;
    if (this.mode === 'crack') {
      var t2 = axes(c, box, this.wr, this.yr, 'Crack width at the soffit, mm', 'Load, kN');
      var B = D.dic.bursts;
      for (var k = 0; k < B.length; k++) {
        if (B[k].N > st.N + 1 && k > 0) continue;
        g.strokeStyle = C.redSoft + (0.16 + 0.3 * k / B.length).toFixed(3) + ')'; g.lineWidth = 1;
        g.beginPath();
        for (var q = 0; q <= B[k].loopP.length; q++) {
          var qq = q % B[k].loopP.length, x = t2.X(B[k].loopW[qq]), y = t2.Y(B[k].loopP[qq]);
          q ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      }
      trail(g, t2, this.trail.map(function (a) { return [a[2], a[1]]; }));
      dot(g, t2.X(Math.max(0, st.w)), t2.Y(st.P));
      return;
    }
    var t = axes(c, box, this.xr, this.yr, 'Midspan deflection, mm', 'Load, kN');
    var L = D.loops;
    for (var j = 0; j < L.length; j++) {
      var lp = L[j];
      if (lp.N > st.N + 1) continue;
      var bk = blockOf(D, lp.N);
      g.strokeStyle = C.redSoft + (0.16 + 0.3 * j / L.length).toFixed(3) + ')'; g.lineWidth = 1;
      g.beginPath();
      for (var p = 0; p <= lp.P.length; p++) {
        var pp = p % lp.P.length;
        var xx = t.X(bk.dmin + lp.d[pp] * (bk.dmax - bk.dmin)), yy = t.Y(bk.pmin + lp.P[pp] * (bk.pmax - bk.pmin));
        p ? g.lineTo(xx, yy) : g.moveTo(xx, yy);
      }
      g.stroke();
    }
    trail(g, t, this.trail);
    dot(g, t.X(st.d), t.Y(st.P));
  };

  /* ---------------------------------------------------------- panel B */
  function StiffChart(el, D) {
    this.c = new Canvas(el); this.D = D; this.mode = 'defl';
    var b = D.blocks, lo = Infinity, hi = -Infinity;
    for (var i = 0; i < b.K.length; i++) { lo = Math.min(lo, b.Klo[i]); hi = Math.max(hi, b.Khi[i]); }
    this.yr = [Math.floor(lo) - 1, Math.ceil(hi) + 1];
    this.xr = [0, D.meta.n_total];
    var B = D.dic.bursts;
    this.bN = B.map(function (u) { return u.N; });
    this.w16 = B.map(function (u) { return u.w16; });
    this.w8 = B.map(function (u) { return u.w8; });
    this.w4 = B.map(function (u) { return u.w4; });
    this.wmin = B.map(function (u) { return u.wmin; });
  }
  StiffChart.prototype.draw = function (st) {
    var c = this.c;
    if (!c.w) { c.size(); if (!c.w) return; }
    var box = { x: 42, y: 30, w: c.w - 56, h: c.h - 62 }, g = c.g;
    var mil = function (v) { return String(+(v / 1e6).toFixed(1)); };
    if (this.mode === 'crack') {
      // crack width at the soffit measured from each cycle's minimum load, at three load levels,
      // and the drift of the minimum-load width itself after 250k cycles (the only zero-load measure)
      box = { x: 42, y: 44, w: c.w - 56, h: c.h - 76 };
      var t2 = axes(c, box, [0, 2.05e6], [-0.1, 1.0], 'Load cycles, millions', 'Crack width at the soffit, mm', mil);
      var self = this;
      var SER = [[this.w16, C.red, '71 kN (16 kips)', false], [this.w8, C.blue, '36 kN (8 kips)', false],
                 [this.w4, '#6fd3c0', '18 kN (4 kips)', false], [this.wmin, '#aab4bf', 'min load', true]];
      SER.forEach(function (sr) {
        var vals = sr[0], first = true, lastI = -1;
        g.strokeStyle = sr[1]; g.lineWidth = sr[3] ? 1.4 : 1.8; if (sr[3]) g.setLineDash([4, 3]);
        g.beginPath();
        for (var i = 0; i < self.bN.length; i++) {
          if (vals[i] === null || vals[i] === undefined) continue;
          var x = t2.X(self.bN[i]), y = t2.Y(vals[i]);
          first ? g.moveTo(x, y) : g.lineTo(x, y); first = false; lastI = i;
        }
        g.stroke(); g.setLineDash([]);
        g.fillStyle = sr[1];
        for (var k = 0; k < self.bN.length; k++) {
          if (vals[k] === null || vals[k] === undefined) continue;
          g.beginPath(); g.arc(t2.X(self.bN[k]), t2.Y(vals[k]), sr[3] ? 2 : 2.8, 0, Math.PI * 2); g.fill();
        }
      });
      // legend under the title
      var lx = box.x, ly = 27;
      g.font = '500 10px Inter, system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
      SER.forEach(function (sr) {
        var lab = sr[2].replace(/ \(.*\)/, '');
        g.strokeStyle = sr[1]; g.lineWidth = 2; if (sr[3]) g.setLineDash([4, 3]);
        g.beginPath(); g.moveTo(lx, ly); g.lineTo(lx + 14, ly); g.stroke(); g.setLineDash([]);
        g.fillStyle = '#c9d1da'; g.fillText(lab, lx + 18, ly);
        lx += 18 + g.measureText(lab).width + 12;
      });
      var xN = Math.max(this.bN[0], Math.min(this.bN[this.bN.length - 1], st.N));
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.setLineDash([3, 3]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(t2.X(st.N), box.y); g.lineTo(t2.X(st.N), box.y + box.h); g.stroke(); g.setLineDash([]);
      dot(g, t2.X(xN), t2.Y(lerpN(this.bN, this.w16, xN)));
      return;
    }
    var t = axes(c, box, this.xr, this.yr, 'Load cycles, millions', 'Stiffness, kN/mm', mil);
    var b = this.D.blocks, n = b.N.length;
    g.fillStyle = 'rgba(255,198,39,.14)';
    g.beginPath();
    for (var i2 = 0; i2 < n; i2++) { var X = t.X(b.N[i2]), Y = t.Y(b.Khi[i2]); i2 ? g.lineTo(X, Y) : g.moveTo(X, Y); }
    for (var j = n - 1; j >= 0; j--) g.lineTo(t.X(b.N[j]), t.Y(b.Klo[j]));
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,198,39,.3)'; g.lineWidth = 1.2;
    g.beginPath();
    for (var k2 = 0; k2 < n; k2++) { var x2 = t.X(b.N[k2]), y2 = t.Y(b.K[k2]); k2 ? g.lineTo(x2, y2) : g.moveTo(x2, y2); }
    g.stroke();
    g.strokeStyle = C.red; g.lineWidth = 2;
    g.beginPath();
    var drawn = 0;
    for (var m = 0; m < n && b.N[m] <= st.N; m++) { var x3 = t.X(b.N[m]), y3 = t.Y(b.K[m]); drawn ? g.lineTo(x3, y3) : g.moveTo(x3, y3); drawn++; }
    g.stroke();
    dot(g, t.X(st.N), t.Y(st.K));
  };

  window.HRCRailCharts = {
    bind: function (root, D) {
      var loop = null, charts = [];
      var a = root.querySelector('[data-chart="loop"]'), b = root.querySelector('[data-chart="stiff"]');
      if (a) { loop = new LoopChart(a, D); charts.push(loop); }
      if (b) charts.push(new StiffChart(b, D));
      var last = 0, lastSt = null;
      charts.forEach(function (ch) { ch.c.redraw = function () { if (lastSt) ch.draw(lastSt); }; });
      var LABELS = {
        defl: ['Load against midspan deflection, recorded loops and the cycle running now', 'Loop stiffness against the number of load cycles'],
        crack: ['Load against the crack width at the soffit, one recorded cycle per DIC burst and the cycle running now', 'Crack width at the soffit at 71, 36 and 18 kN, and the drift of the minimum-load width, against the number of load cycles']
      };
      return {
        update: function (st) {
          lastSt = st;
          if (loop) { loop.trail.push([st.d, st.P, Math.max(0, st.w)]); if (loop.trail.length > 16) loop.trail.shift(); }
          var now = performance.now();
          if (now - last < 33) return;
          last = now;
          charts.forEach(function (ch) { ch.draw(st); });
        },
        setMode: function (m) {
          charts.forEach(function (ch, i) { ch.mode = m; ch.c.el.setAttribute('aria-label', LABELS[m][i]); });
          if (loop) loop.trail = [];
          if (lastSt) charts.forEach(function (ch) { ch.draw(lastSt); });
        }
      };
    }
  };
})();
