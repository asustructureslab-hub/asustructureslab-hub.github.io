// Minimal hi-DPI canvas charts for the linked views, in the hrcdesigner.com
// chart style.  Drawing only, no mechanics.
(function () {
  const INK = '#14181d', BODY = '#4a525d', MUTE = '#77808c', TICK = '#5b646e', GRID = '#e9edf1', AXIS = '#9aa3ad';
  const MONO = '"IBM Plex Mono", ui-monospace, Consolas, monospace', SANS = 'Inter, sans-serif';

  function Chart(canvas, opt) {
    this.c = canvas; this.o = opt; this.ctx = canvas.getContext('2d');
    this.pad = { l: 44, r: 12, t: 30, b: 30 };
  }
  Chart.prototype.size = function () {
    const r = this.c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (this.c.width !== w || this.c.height !== h) { this.c.width = w; this.c.height = h; }
    this.W = r.width; this.H = r.height; this.ctx.setTransform(d, 0, 0, d, 0, 0);
  };
  Chart.prototype.frame = function (xr, yr, opt) {
    this.size();
    const g = this.ctx, p = this.pad;
    this.xr = xr; this.yr = yr;
    g.clearRect(0, 0, this.W, this.H);
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.font = '600 11.5px ' + SANS; g.fillStyle = INK; g.fillText(this.o.title, 11, 9);
    g.strokeStyle = GRID; g.lineWidth = 1;
    const xt = ticks(xr[0], xr[1], 4), yt = ticks(yr[0], yr[1], 4);
    g.font = '10px ' + MONO; g.fillStyle = TICK;
    g.textAlign = 'center'; g.textBaseline = 'top';
    xt.forEach(v => { const X = this.X(v); line(g, X, p.t, X, this.H - p.b); g.fillText(fmt(v), X, this.H - p.b + 4); });
    g.textAlign = 'right'; g.textBaseline = 'middle';
    yt.forEach(v => { const Y = this.Y(v); line(g, p.l, Y, this.W - p.r, Y); g.fillText(fmt(v), p.l - 5, Y); });
    g.strokeStyle = AXIS; line(g, p.l, this.H - p.b, this.W - p.r, this.H - p.b); line(g, p.l, p.t, p.l, this.H - p.b);
    g.font = '500 10.5px ' + SANS; g.fillStyle = BODY;
    g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText(this.o.xl, this.W - p.r, this.H - 3);
    g.save(); g.translate(10, p.t); g.rotate(-Math.PI / 2); g.textAlign = 'right'; g.textBaseline = 'top';
    g.fillText(this.o.yl, 0, 0); g.restore();
  };
  Chart.prototype.X = function (v) { const p = this.pad; return p.l + (v - this.xr[0]) / (this.xr[1] - this.xr[0]) * (this.W - p.l - p.r); };
  Chart.prototype.Y = function (v) { const p = this.pad; return this.H - p.b - (v - this.yr[0]) / (this.yr[1] - this.yr[0]) * (this.H - p.t - p.b); };
  Chart.prototype.clip = function (fn) {
    const g = this.ctx, p = this.pad; g.save(); g.beginPath();
    g.rect(p.l, p.t - 2, this.W - p.l - p.r, this.H - p.t - p.b + 2); g.clip(); fn(); g.restore();
  };
  Chart.prototype.path = function (xs, ys, color, width, dash) {
    this.clip(() => {
      const g = this.ctx; g.beginPath(); let on = false;
      for (let i = 0; i < xs.length; i++) {
        const a = xs[i], b = ys[i]; if (!isFinite(a) || !isFinite(b)) { on = false; continue; }
        const X = this.X(a), Y = this.Y(b); on ? g.lineTo(X, Y) : g.moveTo(X, Y); on = true;
      }
      g.strokeStyle = color; g.lineWidth = width || 1.5; g.setLineDash(dash || []); g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke();
    });
  };
  Chart.prototype.fill = function (xs, ys, color) {
    this.clip(() => {
      const g = this.ctx; g.beginPath();
      xs.forEach((a, i) => { const X = this.X(a), Y = this.Y(ys[i]); i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
      g.closePath(); g.fillStyle = color; g.fill();
    });
  };
  Chart.prototype.dot = function (x, y, color, r) {
    if (!isFinite(x) || !isFinite(y)) return;
    const g = this.ctx, X = this.X(x), Y = this.Y(y);
    g.save(); g.fillStyle = '#fff'; g.beginPath(); g.arc(X, Y, (r || 4.5) + 2, 0, 7); g.fill();
    g.fillStyle = color; g.beginPath(); g.arc(X, Y, r || 4.5, 0, 7); g.fill(); g.restore();
  };
  Chart.prototype.vline = function (x, color, dash) { this.path([x, x], this.yr, color, 1, dash || [3, 3]); };
  Chart.prototype.hline = function (y, color, dash) { this.path(this.xr, [y, y], color, 1, dash || [3, 3]); };
  Chart.prototype.label = function (x, y, txt, color, align, base) {
    const g = this.ctx; g.save(); g.font = '600 10px ' + SANS; g.fillStyle = color;
    g.textAlign = align || 'left'; g.textBaseline = base || 'middle'; g.fillText(txt, this.X(x), this.Y(y)); g.restore();
  };
  // legend box, bottom-right or top-left inside the plot area
  Chart.prototype.key = function (items, where) {
    const g = this.ctx, p = this.pad; g.save(); g.font = '500 10px ' + SANS;
    const w = Math.max.apply(null, items.map(it => g.measureText(it[0]).width)) + 30, hh = items.length * 14 + 8;
    const x0 = where === 'tl' ? p.l + 6 : this.W - p.r - w - 6, y0 = where === 'tl' ? p.t + 4 : this.H - p.b - hh - 6;
    g.fillStyle = 'rgba(255,255,255,.92)'; g.strokeStyle = '#dde2e8'; g.lineWidth = 1;
    roundRect(g, x0, y0, w, hh, 4); g.fill(); g.stroke();
    items.forEach((it, i) => {
      const y = y0 + 11 + i * 14;
      g.strokeStyle = it[1]; g.lineWidth = it[3] || 2; g.setLineDash(it[2] || []);
      g.beginPath(); g.moveTo(x0 + 7, y); g.lineTo(x0 + 21, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = BODY; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(it[0], x0 + 26, y);
    });
    g.restore();
  };

  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function line(g, a, b, c, d) { g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); }
  function ticks(a, b, n) {
    const span = b - a; if (!(span > 0)) return [a];
    const step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || step0;
    const out = []; for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + 1e-9 * span; v += step) out.push(+v.toPrecision(10));
    return out;
  }
  function fmt(v) {
    const a = Math.abs(v); if (a === 0) return '0';
    if (a >= 1000 || a < 0.01) return v.toExponential(0).replace('e+', 'e');
    return (+v.toPrecision(3)).toString();
  }
  window.MiniChart = Chart;
})();
