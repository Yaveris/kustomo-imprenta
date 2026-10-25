// ─────────────────────────────────────────────
//  DESIGN PICTURES
//  Draws a saved design (a preset's or a product's `customization`) on a model's picture, the same way the
//  Design Studio shows it, and returns a canvas. The Products page uses it to make a product photo from a preset.
//  Needs js/firebase.js (the model catalog) to be loaded first, and js/studio-common.js for designs made in the
//  current Design Studio (pages without it still draw older designs).
// ─────────────────────────────────────────────

/** Loads an image for drawing on a canvas; pictures from other sites (Cloudinary) are asked for with CORS so
 *  the canvas can still be saved. */
function loadDrawableImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:/i.test(src) && !src.startsWith(location.origin)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't load " + (src.length > 80 ? src.slice(0, 77) + '…' : src)));
    img.src = src;
  });
}

/** The model a saved design was made on: its `shirtStyle`, else the first model it is offered on. */
function designModelId(preset) {
  const c = (preset && preset.customization) || {};
  return c.shirtStyle || (Array.isArray(preset && preset.models) && preset.models[0]) || '';
}

/**
 * Draws [customization] on [model]'s [side] picture, [height] px tall. Text, the image and shapes are placed with
 * the same rules as the Design Studio (offsets from the picture's centre, scaled from the print area they were
 * saved against) and clipped to the print area.
 */
async function renderDesignCanvas(model, customization, height = 760, side = 'Front') {
  const c = customization || {};
  const art = (side === 'Back' && model.back) ? model.back : model.front;
  if (!art || !art.img) throw new Error('This model has no picture to draw the design on');
  const h = Math.round(height), w = Math.round(h * art.w / art.h);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;

  // The garment: its colour where the picture is, with the picture's shading multiplied over it
  const artImg = await loadDrawableImage(art.img);
  const color = /^#[0-9a-f]{6}$/i.test(c.apparelColorHex || '') ? c.apparelColorHex : '#FFFFFF';
  ctx.drawImage(artImg, 0, 0, w, h);
  if (model.tintable !== false) {
    ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(artImg, 0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(artImg, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  const v = c.views && c.views[side];
  if (!v) return cv;

  // Designs in the current form (texts[], images[], shapes[]) are drawn with the Design Studio's own code
  // (js/studio-common.js), the same way the order page makes print files, so every font, curve and outline shows
  if (typeof Studio !== 'undefined' && (Array.isArray(v.texts) || Array.isArray(v.images))) {
    const zl = art.zone.left * w, zt = art.zone.top * h;
    const zw = (art.zone.right - art.zone.left) * w, zh = (art.zone.bottom - art.zone.top) * h;
    const zone = await Studio.renderZone(Studio.normalizeView(v), zw, zh);
    ctx.drawImage(zone, zl, zt, zw, zh);
    return cv;
  }

  // Print area, in px from the picture's centre (as in the Design Studio)
  const zn = art.zone;
  const z = { left: zn.left * w - w / 2, top: zn.top * h - h / 2, width: (zn.right - zn.left) * w, height: (zn.bottom - zn.top) * h };
  const cx = w / 2, cy = h / 2;
  // Positions were saved against the print area in `ref`; move them onto this one
  const r = v.ref;
  let X, Y, fontSize;
  if (r && r.width > 0 && r.height > 0) {
    const kx = z.width / r.width, ky = z.height / r.height;
    X = n => z.left + (num(n, 0) - r.left) * kx;
    Y = n => z.top + (num(n, 0) - r.top) * ky;
    fontSize = num(v.fontSize, 18) * kx * (r.sp > 0 ? r.sp : 1);
  } else {
    X = () => z.left + z.width / 2; Y = () => z.top + z.height / 2;
    fontSize = Math.min(48, Math.max(12, z.width / 8)) * (h / 520);
  }

  // Layers bottom to top: the saved order, else image, shapes, text (same rule as the app)
  const shapes = Array.isArray(v.shapes) ? v.shapes : [];
  const existing = [];
  if (v.imageUrl) existing.push('image');
  shapes.forEach(s => existing.push('shape:' + s.id));
  if (v.customText) existing.push('text');
  const ordered = (v.layerOrder || []).filter(k => existing.includes(k));
  const missing = existing.filter(k => !ordered.includes(k));
  const keys = missing.includes('image') && ordered.length ? ['image', ...ordered, ...missing.filter(k => k !== 'image')] : [...ordered, ...missing];

  const logo = v.imageUrl ? await loadDrawableImage(v.imageUrl) : null;
  if (document.fonts && document.fonts.ready) await document.fonts.ready;

  ctx.save();
  ctx.beginPath(); ctx.rect(cx + z.left, cy + z.top, z.width, z.height); ctx.clip();
  keys.forEach(k => {
    if (k === 'image' && logo) {
      // Fitted inside a square box, like object-fit: contain
      const box = z.width * 0.7 * num(v.imgScale, 1);
      const s = Math.min(box / logo.naturalWidth, box / logo.naturalHeight);
      const iw = logo.naturalWidth * s, ih = logo.naturalHeight * s;
      ctx.drawImage(logo, cx + X(v.imgOffX) - iw / 2, cy + Y(v.imgOffY) - ih / 2, iw, ih);
    } else if (k === 'text') {
      const fs = v.fontStyle || 'Normal';
      ctx.font = `${fs.includes('Italic') ? 'italic ' : ''}${fs.includes('Bold') ? 700 : 400} ${fontSize}px Roboto, "Segoe UI", system-ui, sans-serif`;
      ctx.fillStyle = v.fontColorHex || '#FFFFFF';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lines = String(v.customText).split('\n'), lh = fontSize * 1.15;
      const top = cy + Y(v.txtOffY) - lines.length * lh / 2;
      lines.forEach((line, i) => ctx.fillText(line, cx + X(v.txtOffX), top + (i + 0.5) * lh));
    } else if (k.startsWith('shape:')) {
      const sh = shapes.find(s => 'shape:' + s.id === k); if (!sh) return;
      const size = z.width * 0.4 * num(sh.scale, 1);
      ctx.save();
      ctx.translate(cx + X(sh.offX), cy + Y(sh.offY));
      ctx.rotate(num(sh.rotation, 0) * Math.PI / 180);
      ctx.translate(-size / 2, -size / 2);
      ctx.scale(size, size);
      drawShapePath(ctx, sh.path, sh.colorHex || '#FFFFFF', !!sh.outline, sh.repeat);
      ctx.restore();
    }
  });
  ctx.restore();
  return cv;
}

/** A shape's outline ("F0.050:x,y x,y …;…" in a 0..1 square) drawn into the unit square, [repeat]×[repeat] times. */
function drawShapePath(ctx, path, color, outline, repeat) {
  const n = Math.min(4, Math.max(1, repeat || 1));
  const parts = String(path || '').split(';').map(part => {
    const c = part.indexOf(':'); if (c < 2) return null;
    const pts = part.slice(c + 1).trim().split(/\s+/).map(p => p.split(',').map(Number)).filter(p => p.length === 2 && p.every(isFinite));
    return pts.length ? { filled: part[0] === 'F', width: parseFloat(part.slice(1, c)) || 0.05, pts } : null;
  }).filter(Boolean);
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
    ctx.save();
    ctx.translate(col / n, row / n); ctx.scale(1 / n, 1 / n);
    parts.forEach(p => {
      ctx.beginPath();
      p.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      if (p.filled) ctx.closePath();
      if (p.filled && !outline) { ctx.fillStyle = color; ctx.fill(); }
      else {
        ctx.strokeStyle = color; ctx.lineWidth = p.filled ? 0.05 : p.width;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
      }
    });
    ctx.restore();
  }
}

/** The canvas as a PNG file, ready for uploadToCloudinary. */
function canvasToPngFile(canvas, name) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(b => b ? resolve(new File([b], name || 'design.png', { type: 'image/png' })) : reject(new Error("Couldn't make the picture")), 'image/png');
    } catch (e) {
      // A picture from a site that doesn't allow it (no CORS) makes the canvas unsaveable
      reject(new Error("This design uses an image that can't be copied into a photo. Re-upload the image in the Design Studio."));
    }
  });
}
