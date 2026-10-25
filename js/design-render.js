// ─────────────────────────────────────────────
//  DESIGN PICTURES
//  Draws a saved design (a preset's or a product's `customization`) on a model's picture, the same way the
//  Design Studio shows it, and returns a canvas. The Products page uses it to make a product photo from a preset.
//  Needs js/firebase.js (the model catalog) and js/studio-common.js (the drawing) to be loaded first.
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
 * Draws [customization] on [model]'s [side] picture, [height] px tall. The design is drawn by the shared renderer
 * (js/studio-common.js, the same drawing as the app) onto the side's print area and trimmed to the design area.
 */
async function renderDesignCanvas(model, customization, height = 760, side = 'Front') {
  const c = customization || {};
  const art = modelSide(model, side) || model.front;
  if (!art || !art.img) throw new Error('This model has no picture to draw the design on');
  const h = Math.round(height), w = Math.round(h * art.w / art.h);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');

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

  const raw = c.views && c.views[side];
  if (!raw) return cv;
  const v = Studio.normalizeView(raw);
  if (!Studio.hasContent(v)) return cv;
  const zn = art.zone;
  const zx = zn.left * w, zy = zn.top * h, zw = (zn.right - zn.left) * w, zh = (zn.bottom - zn.top) * h;
  const zone = await Studio.renderZone(v, zw * 2, zh * 2);
  ctx.drawImage(zone, zx, zy, zw, zh);
  cv.failedImages = zone.failedImages || [];
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
