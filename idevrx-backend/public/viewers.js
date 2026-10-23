// Browser viewers for project files: a small syntax highlighter and an STL preview (no libraries).
const Viewers = (() => {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const KW = new Set((
    "void int long short float double char bool boolean byte word unsigned signed const static volatile if else for while do switch case default break continue return " +
    "include define ifdef ifndef endif struct class enum public private protected new delete true false null NULL HIGH LOW INPUT OUTPUT INPUT_PULLUP LED_BUILTIN " +
    "setup loop def import from as in not and or is None True False lambda try except finally with pass print elif async await function let var typeof"
  ).split(" "));
  // groups: 1 comment, 2 string, 3 number, 4 identifier, 5 preprocessor (C only)
  const RE_C = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d[\w.]*\b)|(\b[A-Za-z_]\w*\b)|(^[ \t]*#\w+)/gm;
  const RE_PY = /(#[^\n]*)|("""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d[\w.]*\b)|(\b[A-Za-z_]\w*\b)/g;

  function hl(src, ext) {
    const base = ext === "py" ? RE_PY : RE_C;
    const re = new RegExp(base.source, base.flags);
    let out = "", last = 0, m;
    while ((m = re.exec(src))) {
      out += esc(src.slice(last, m.index));
      const t = m[1] != null ? "c" : m[2] != null ? "s" : m[3] != null ? "n" : m[5] != null ? "k" : KW.has(m[0]) ? "k" : null;
      out += t ? '<span class="t' + t + '">' + esc(m[0]) + "</span>" : esc(m[0]);
      last = re.lastIndex;
    }
    return out + esc(src.slice(last));
  }

  // Returns a Float32Array of triangles (9 numbers each) or null if the file isn't a usable STL.
  function parseStl(buf) {
    const dv = new DataView(buf);
    let tris = null;
    if (buf.byteLength >= 84) {
      const n = dv.getUint32(80, true);
      if (n > 0 && 84 + n * 50 === buf.byteLength) {
        tris = new Float32Array(n * 9);
        for (let i = 0; i < n; i++) {
          const o = 84 + i * 50 + 12; // skip the 12-byte normal
          for (let j = 0; j < 9; j++) tris[i * 9 + j] = dv.getFloat32(o + j * 4, true);
        }
      }
    }
    if (!tris) {
      const text = new TextDecoder().decode(buf);
      const v = [], re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
      let m;
      while ((m = re.exec(text))) v.push(+m[1], +m[2], +m[3]);
      const n = Math.floor(v.length / 9);
      if (!n) return null;
      tris = Float32Array.from(v.slice(0, n * 9));
    }
    for (let i = 0; i < tris.length; i++) if (!Number.isFinite(tris[i])) return null;
    return tris;
  }

  // Flat-shaded software renderer. Drag or arrow keys rotate, wheel zooms. Z is up.
  function mountStl(canvas, tris) {
    const MAX = 60000, total = tris.length / 9, stride = Math.max(1, Math.ceil(total / MAX));
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < tris.length; i++) { const k = i % 3, v = tris[i]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
    const c = lo.map((l, k) => (l + hi[k]) / 2);
    const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
    const shown = Math.ceil(total / stride);
    const P = new Float32Array(shown * 9);
    for (let t = 0, w = 0; t < total; t += stride) for (let j = 0; j < 9; j++) P[w++] = (tris[t * 9 + j] - c[j % 3]) / size;

    const R = new Float32Array(shown * 9), shade = new Float32Array(shown), depth = new Float32Array(shown);
    const START = { az: 0.6, el: 0.5, zoom: 1 };
    let az = START.az, el = START.el, zoom = START.zoom, queued = false;
    const L = [0.3, -0.6, 0.7], ll = Math.hypot(L[0], L[1], L[2]);
    for (let i = 0; i < 3; i++) L[i] /= ll;

    function draw() {
      queued = false;
      const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth || 600, H = canvas.clientHeight || 400;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const sc = Math.min(W, H) * 0.85 * zoom, cx = W / 2, cy = H / 2;
      const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
      const order = [];
      for (let t = 0; t < shown; t++) {
        const o = t * 9;
        for (let v = 0; v < 3; v++) {
          const x = P[o + v * 3], y = P[o + v * 3 + 1], z = P[o + v * 3 + 2];
          const x1 = x * ca - y * sa, y1 = x * sa + y * ca;
          R[o + v * 3] = x1;
          R[o + v * 3 + 1] = y1 * ce - z * se; // depth: larger is farther from the camera
          R[o + v * 3 + 2] = y1 * se + z * ce;
        }
        const ax = R[o + 3] - R[o], ay = R[o + 4] - R[o + 1], az2 = R[o + 5] - R[o + 2];
        const bx = R[o + 6] - R[o], by = R[o + 7] - R[o + 1], bz = R[o + 8] - R[o + 2];
        const nx = ay * bz - az2 * by, ny = az2 * bx - ax * bz, nz = ax * by - ay * bx;
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-12 || ny / len >= 0) continue; // degenerate, or facing away from the camera
        shade[t] = 0.35 + 0.65 * Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / len);
        depth[t] = (R[o + 1] + R[o + 4] + R[o + 7]) / 3;
        order.push(t);
      }
      order.sort((a, b) => depth[b] - depth[a]);
      const stroke = order.length <= 20000;
      ctx.lineWidth = 0.6;
      ctx.lineJoin = "round";
      for (const t of order) {
        const o = t * 9, k = shade[t], col = "rgb(" + ((196 * k) | 0) + "," + ((80 * k) | 0) + "," + ((26 * k) | 0) + ")";
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(cx + R[o] * sc, cy - R[o + 2] * sc);
        ctx.lineTo(cx + R[o + 3] * sc, cy - R[o + 5] * sc);
        ctx.lineTo(cx + R[o + 6] * sc, cy - R[o + 8] * sc);
        ctx.closePath();
        ctx.fill();
        if (stroke) { ctx.strokeStyle = col; ctx.stroke(); }
      }
    }
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(draw); } };
    const tilt = (d) => Math.max(-1.5, Math.min(1.5, el + d));

    let drag = null;
    canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      az += (e.clientX - drag.x) * 0.01;
      el = tilt((e.clientY - drag.y) * 0.01);
      drag = { x: e.clientX, y: e.clientY };
      queue();
    });
    const end = () => { drag = null; };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoom = Math.max(0.3, Math.min(4, zoom * (e.deltaY < 0 ? 1.1 : 0.9))); queue(); }, { passive: false });
    canvas.addEventListener("keydown", (e) => {
      const d = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] }[e.key];
      if (!d) return;
      e.preventDefault();
      az += d[0];
      el = tilt(d[1]);
      queue();
    });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(queue).observe(canvas);
    draw();
    return { total, shown, reset() { az = START.az; el = START.el; zoom = START.zoom; queue(); } };
  }

  return { hl, parseStl, mountStl };
})();
if (typeof module !== "undefined") module.exports = Viewers;
