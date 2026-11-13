"use strict";
var SpriteSheetSplit = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../图片拆分图层工具-(planegenerator)/lib/split-assets/split.ts
  var split_exports = {};
  __export(split_exports, {
    resolveBackground: () => resolveBackground,
    splitSpriteSheet: () => splitSpriteSheet
  });
  function lum(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }
  function borderRing(d, w, h, ring) {
    const lums = [];
    let opaque = 0;
    let total = 0;
    const visit = (x, y) => {
      const i = (y * w + x) * 4;
      total++;
      const a = d[i + 3];
      if (a <= 16) return;
      opaque++;
      lums.push(lum(d[i], d[i + 1], d[i + 2]));
    };
    for (let y = 0; y < ring; y++) for (let x = 0; x < w; x++) {
      visit(x, y);
      visit(x, h - 1 - y);
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < ring; x++) {
      visit(x, y);
      visit(w - 1 - x, y);
    }
    return { lums, opaque, total };
  }
  var LIGHT_BG_LUMINANCE = 128;
  var ALPHA_BG_MIN_OPAQUE_RATIO = 0.2;
  function resolveBackground(src, mode = "auto") {
    if (mode === "dark" || mode === "light") return mode;
    const ring = Math.max(1, Math.min(4, Math.floor(Math.min(src.width, src.height) * 0.01)));
    const { lums, opaque, total } = borderRing(src.data, src.width, src.height, ring);
    if (lums.length === 0 || opaque < total * ALPHA_BG_MIN_OPAQUE_RATIO) return "alpha";
    lums.sort((a, b) => a - b);
    return lums[lums.length >> 1] > LIGHT_BG_LUMINANCE ? "light" : "dark";
  }
  function buildForeground(src, threshold, resolved) {
    const { width: w, height: h } = src;
    const d = src.data;
    const fg = new Uint8Array(w * h);
    if (resolved === "dark") {
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        fg[p] = d[i + 3] > 16 && lum(d[i], d[i + 1], d[i + 2]) > threshold ? 1 : 0;
      }
      return fg;
    }
    if (resolved === "alpha") {
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        fg[p] = d[i + 3] > 16 ? 1 : 0;
      }
      return fg;
    }
    const bgLike = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      bgLike[p] = d[i + 3] <= 16 || lum(d[i], d[i + 1], d[i + 2]) >= 255 - threshold ? 1 : 0;
    }
    const stack = new Int32Array(w * h);
    let sp = 0;
    const push = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = y * w + x;
      if (!bgLike[i] || fg[i]) return;
      fg[i] = 1;
      stack[sp++] = i;
    };
    for (let x = 0; x < w; x++) {
      push(x, 0);
      push(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      push(0, y);
      push(w - 1, y);
    }
    while (sp > 0) {
      const cur = stack[--sp];
      const cx = cur % w;
      const cy = (cur - cx) / w;
      push(cx - 1, cy);
      push(cx + 1, cy);
      push(cx, cy - 1);
      push(cx, cy + 1);
    }
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      fg[p] = fg[p] ? 0 : d[i + 3] > 16 ? 1 : 0;
    }
    return fg;
  }
  function borderColor(d, w, h) {
    const ring = Math.max(1, Math.min(4, Math.floor(Math.min(w, h) * 0.01)));
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    const visit = (x, y) => {
      const i = (y * w + x) * 4;
      if (d[i + 3] <= 16) return;
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
      n++;
    };
    for (let k = 0; k < ring; k++) {
      for (let x = 0; x < w; x++) {
        visit(x, k);
        visit(x, h - 1 - k);
      }
      for (let y = 0; y < h; y++) {
        visit(k, y);
        visit(w - 1 - k, y);
      }
    }
    return n ? [r / n, g / n, b / n] : [0, 0, 0];
  }
  function defringe(src, fg, w, h, bg) {
    const out = new Uint8ClampedArray(src);
    const ring = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!fg[p]) continue;
        if (x > 0 && !fg[p - 1] || x < w - 1 && !fg[p + 1] || y > 0 && !fg[p - w] || y < h - 1 && !fg[p + w]) ring[p] = 1;
      }
    }
    const bgLum = lum(bg[0], bg[1], bg[2]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!ring[p]) continue;
        let ir = 0;
        let ig = 0;
        let ib = 0;
        let n = 0;
        const near = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
        for (const q of near) {
          if (q < 0 || !fg[q] || ring[q]) continue;
          const j = q * 4;
          ir += src[j];
          ig += src[j + 1];
          ib += src[j + 2];
          n++;
        }
        if (!n) continue;
        const i = p * 4;
        const inner = lum(ir / n, ig / n, ib / n);
        const denom = bgLum - inner;
        if (Math.abs(denom) < 4) continue;
        const raw = (bgLum - lum(src[i], src[i + 1], src[i + 2])) / denom;
        if (raw >= 1) continue;
        if (raw < 0.4) {
          out[i] = Math.round(ir / n);
          out[i + 1] = Math.round(ig / n);
          out[i + 2] = Math.round(ib / n);
          continue;
        }
        for (let c = 0; c < 3; c++) {
          const v = (src[i + c] - (1 - raw) * bg[c]) / raw;
          out[i + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
        }
      }
    }
    return out;
  }
  function toDataUrl(img) {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/png");
  }
  function rowRunLen(fg, w, y) {
    let run = 0;
    let best = 0;
    for (let x = 0; x < w; x++) {
      if (fg[y * w + x]) {
        run++;
        if (run > best) best = run;
      } else run = 0;
    }
    return best;
  }
  function colRunLen(fg, w, h, x) {
    let run = 0;
    let best = 0;
    for (let y = 0; y < h; y++) {
      if (fg[y * w + x]) {
        run++;
        if (run > best) best = run;
      } else run = 0;
    }
    return best;
  }
  function eraseCrossDividers(fg, w, h, band) {
    const minLen = Math.max(0.5 * w, 0.5 * h);
    let bestRow = -1;
    let bestRowLen = 0;
    for (let y = 0; y < h; y++) {
      const l = rowRunLen(fg, w, y);
      if (l > bestRowLen) {
        bestRowLen = l;
        bestRow = y;
      }
    }
    let bestCol = -1;
    let bestColLen = 0;
    for (let x = 0; x < w; x++) {
      const l = colRunLen(fg, w, h, x);
      if (l > bestColLen) {
        bestColLen = l;
        bestCol = x;
      }
    }
    const rows = [];
    if (bestRow >= 0 && bestRowLen > minLen) {
      let lo = bestRow;
      let hi = bestRow;
      while (lo - 1 >= 0 && rowRunLen(fg, w, lo - 1) > minLen) lo--;
      while (hi + 1 < h && rowRunLen(fg, w, hi + 1) > minLen) hi++;
      for (let y = Math.max(0, lo - band); y <= Math.min(h - 1, hi + band); y++) rows.push(y);
    }
    const cols = [];
    if (bestCol >= 0 && bestColLen > minLen) {
      let lo = bestCol;
      let hi = bestCol;
      while (lo - 1 >= 0 && colRunLen(fg, w, h, lo - 1) > minLen) lo--;
      while (hi + 1 < w && colRunLen(fg, w, h, hi + 1) > minLen) hi++;
      for (let x = Math.max(0, lo - band); x <= Math.min(w - 1, hi + band); x++) cols.push(x);
    }
    for (const y of rows) for (let x = 0; x < w; x++) fg[y * w + x] = 0;
    for (const x of cols) for (let y = 0; y < h; y++) fg[y * w + x] = 0;
  }
  function openMask(fg, w, h, r) {
    if (r <= 0) return fg;
    const eroded = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let ok = 1;
        for (let dy = -r; dy <= r && ok; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          const row = ny * w;
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            if (!fg[row + nx]) {
              ok = 0;
              break;
            }
          }
        }
        eroded[y * w + x] = ok;
      }
    }
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (!eroded[row + x]) continue;
        for (let dy = -r; dy <= r; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          const nrow = ny * w;
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            out[nrow + nx] = 1;
          }
        }
      }
    }
    return out;
  }
  function splitSpriteSheet(src, opts) {
    const { width: w, height: h } = src;
    const d = src.data;
    const resolved = resolveBackground(src, opts.background);
    const fg = buildForeground(src, opts.threshold, resolved);
    if (opts.eraseDividers && resolved === "dark") eraseCrossDividers(fg, w, h, opts.dividerBand);
    const seg = opts.openRadius > 0 ? openMask(fg, w, h, opts.openRadius) : fg;
    const px = opts.defringe !== false && resolved !== "alpha" ? defringe(d, seg, w, h, borderColor(d, w, h)) : d;
    const label = new Int32Array(w * h);
    const stack = new Int32Array(w * h);
    const comps = [];
    const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
    const DY = [-1, -1, -1, 0, 0, 1, 1, 1];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (!seg[idx] || label[idx]) continue;
        const compId = comps.length;
        let size = 0;
        let minX = x;
        let minY = y;
        let maxX = x;
        let maxY = y;
        let sp = 0;
        stack[sp++] = idx;
        label[idx] = compId + 1;
        while (sp > 0) {
          const cur = stack[--sp];
          const cx = cur % w;
          const cy = (cur - cx) / w;
          size++;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;
          for (let k = 0; k < 8; k++) {
            const nx = cx + DX[k];
            const ny = cy + DY[k];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (seg[ni] && !label[ni]) {
              label[ni] = compId + 1;
              stack[sp++] = ni;
            }
          }
        }
        comps.push({ size, minX, minY, maxX, maxY });
      }
    }
    const kept = comps.map((c, i) => ({ ...c, i })).filter((c) => c.size >= opts.minArea).sort((a, b) => a.minY - b.minY || a.minX - b.minX);
    const pieces = kept.map((c, n) => {
      const labelVal = c.i + 1;
      const x0 = Math.max(0, c.minX - opts.margin);
      const y0 = Math.max(0, c.minY - opts.margin);
      const x1 = Math.min(w, c.maxX + 1 + opts.margin);
      const y1 = Math.min(h, c.maxY + 1 + opts.margin);
      const pw = x1 - x0;
      const ph = y1 - y0;
      const out = new ImageData(pw, ph);
      const od = out.data;
      for (let dy = 0; dy < ph; dy++) {
        const sy = y0 + dy;
        const rowBase = sy * w;
        for (let dx = 0; dx < pw; dx++) {
          const sx = x0 + dx;
          const si = (rowBase + sx) * 4;
          const oi = (dy * pw + dx) * 4;
          if (label[rowBase + sx] === labelVal) {
            od[oi] = px[si];
            od[oi + 1] = px[si + 1];
            od[oi + 2] = px[si + 2];
            od[oi + 3] = px[si + 3];
          } else {
            od[oi + 3] = 0;
          }
        }
      }
      return {
        id: `piece-${String(n + 1).padStart(3, "0")}`,
        index: n + 1,
        x: x0,
        y: y0,
        w: pw,
        h: ph,
        pixelCount: c.size,
        image: out,
        dataUrl: toDataUrl(out)
      };
    });
    return pieces;
  }
  return __toCommonJS(split_exports);
})();
