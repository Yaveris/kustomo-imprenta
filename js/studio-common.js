// ─────────────────────────────────────────────
//  DESIGNER STUDIO — shared with the app
//  The design data model, its reading/writing, and the drawing of texts, pictures and drawings, ported line by
//  line from the app (DesignItems.kt, Repositories.kt, TextRender.kt, DesignShapes.kt, DesignRender.kt), so a
//  design looks the same in the app, on this site and in the print files. Change both together.
//  Needs js/firebase.js (db) loaded first.
// ─────────────────────────────────────────────

const Studio = (() => {
  // ── Numbers shared with the app ──
  const IMAGE_BASE_FRACTION = 0.7;     // DesignRender.kt
  const SHAPE_BASE_FRACTION = 0.4;     // DesignShapes.kt
  const OUTLINE_WIDTH = 0.05;          // DesignShapes.kt (outline of a filled stroke, share of the shape box)
  const DEFAULT_FONT_ID = 'roboto';
  const LEGACY_TEXT_ID = 'text';
  const LEGACY_IMAGE_ID = 'image';
  const MIN_SPAN = 0.15;               // DesignArea.MIN_SPAN
  const BRUSH = { PEN: 'pen', PENCIL: 'pencil', MARKER: 'marker', AIR: 'air', ERASE: 'erase' };
  const EFFECTS = ['none', '3d', 'neon', 'hollow', 'distressed'];
  /** Tools a settings set can switch off (StudioSettings.kt StudioTools). */
  const TOOLS = [
    { id: 'brush', label: 'Brush' }, { id: 'airbrush', label: 'Airbrush' }, { id: 'pencil', label: 'Pencil' },
    { id: 'marker', label: 'Marker' }, { id: 'calligraphy', label: 'Calligraphy pen' }, { id: 'eraser', label: 'Eraser' },
    { id: 'fill', label: 'Fill bucket' }, { id: 'picker', label: 'Colour picker' }, { id: 'shapes', label: 'Shapes (outline & filled)' },
    { id: 'pressure', label: 'Pressure / taper' }, { id: 'bgRemove', label: 'Remove background (photos)' },
    { id: 'photoFilters', label: 'Photo filters' }
  ];
  /** The app's built-in ink list (StudioSettings.kt DEFAULT_INKS). */
  const DEFAULT_INKS = ['#FFFFFF', '#0A0A0A', '#FF5C00', '#FF2D78', '#FFD600', '#378ADD', '#00C853', '#8B5CF6', '#00BCD4', '#8D1B1B', '#9E9E9E'];
  const DEFAULT_LIMITS = { minLineMm: 1.0, minOpacity: 0.2, minDpi: 150, minTextMm: 4 };

  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const newItemId = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2) + Date.now().toString(16)).replace(/-/g, '').slice(0, 8);

  // ── Colours: "#RRGGBB" (or "#AARRGGBB", as Android reads them) ──
  function parseColor(hex, fallback) {
    const h = String(hex || '').trim();
    let m = /^#([0-9a-f]{6})$/i.exec(h);
    if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
    m = /^#([0-9a-f]{8})$/i.exec(h);
    if (m) return { a: parseInt(m[1].slice(0, 2), 16) / 255, r: parseInt(m[1].slice(2, 4), 16), g: parseInt(m[1].slice(4, 6), 16), b: parseInt(m[1].slice(6, 8), 16) };
    return fallback ? parseColor(fallback) : { r: 255, g: 255, b: 255, a: 1 };
  }
  const css = (c, alpha = c.a) => `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${clamp(alpha, 0, 1)})`;
  const hex6 = c => '#' + [c.r, c.g, c.b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase();
  const normHex = (hex, fallback) => hex6(parseColor(hex, fallback));
  /** Relative luminance, like Compose's Color.luminance(). */
  function luminance(c) {
    const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  const contrastInk = shirtHex => luminance(parseColor(shirtHex, '#FFFFFF')) > 0.5 ? '#0A0A0A' : '#FFFFFF';
  const lerpColor = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: a.a + (b.a - a.a) * t });

  // ── Strokes: "<F|L><width>[|c=RRGGBB][|o=..][|b=..][|s=..][|l=..]:x,y x,y;…" (DesignShapes.kt) ──
  function decodeStrokes(text) {
    return String(text || '').split(';').map(part => {
      const colon = part.indexOf(':');
      if (colon < 2) return null;
      const filled = part[0] === 'F';
      const head = part.slice(1, colon).split('|');
      const width = parseFloat(head[0]);
      if (!isFinite(width)) return null;
      const s = { filled, width, color: null, opacity: 1, brush: BRUSH.PEN, softness: 0, layer: 0, points: [] };
      head.slice(1).forEach(kv => {
        const eq = kv.indexOf('='); if (eq < 1) return;
        const k = kv.slice(0, eq), v = kv.slice(eq + 1);
        if (k === 'c') s.color = '#' + v.toUpperCase();
        else if (k === 'o') s.opacity = clamp(num(parseFloat(v), 1), 0, 1);
        else if (k === 'b') s.brush = v;
        else if (k === 's') s.softness = clamp(num(parseFloat(v), 0), 0, 1);
        else if (k === 'l') s.layer = clamp(num(parseInt(v, 10), 0), 0, 2);
      });
      s.points = part.slice(colon + 1).split(' ').map(xy => {
        const p = xy.split(','); if (p.length !== 2) return null;
        const x = parseFloat(p[0]), y = parseFloat(p[1]);
        return (isFinite(x) && isFinite(y)) ? [x, y] : null;
      }).filter(Boolean);
      return s.points.length ? s : null;
    }).filter(Boolean);
  }
  const f4 = v => (Math.round(v * 10000) / 10000).toFixed(4);
  const f3 = v => (Math.round(v * 1000) / 1000).toFixed(3);
  function encodeStrokes(strokes) {
    return strokes.map(s => {
      let out = (s.filled ? 'F' : 'L') + f4(s.width);
      if (s.color) out += '|c=' + normHex(s.color).slice(1);
      if (s.opacity < 0.999) out += '|o=' + f3(s.opacity);
      if (s.brush && s.brush !== BRUSH.PEN) out += '|b=' + s.brush;
      if (s.softness > 0.001) out += '|s=' + f3(s.softness);
      if (s.layer) out += '|l=' + s.layer;
      return out + ':' + s.points.map(p => f4(p[0]) + ',' + f4(p[1])).join(' ');
    }).join(';');
  }

  // ── Reading a saved side (Repositories.kt viewDesignFromMap), older one-text/one-picture sides included ──
  const str = (v, d = '') => typeof v === 'string' ? v : d;
  const bool = v => v === true;
  function textFromMap(m) {
    if (typeof m.text !== 'string') return null;
    return {
      id: str(m.id) || newItemId(), text: m.text, font: str(m.font) || DEFAULT_FONT_ID,
      size: num(m.size, 22), colorHex: normHex(m.colorHex, '#FFFFFF'),
      offX: num(m.offX, 0), offY: num(m.offY, 0), rotation: num(m.rotation, 0),
      bold: bool(m.bold), italic: bool(m.italic), caps: bool(m.caps),
      align: ['left', 'center', 'right'].includes(m.align) ? m.align : 'center',
      letterSpacing: num(m.letterSpacing, 0), lineHeight: num(m.lineHeight, 1.15), curve: clamp(num(m.curve, 0), -100, 100),
      outlineWidth: num(m.outlineWidth, 0), outlineColorHex: normHex(m.outlineColorHex, '#000000'),
      shadow: num(m.shadow, 0), shadowColorHex: normHex(m.shadowColorHex, '#000000'),
      opacity: clamp(num(m.opacity, 1), 0, 1), gradientHex: str(m.gradientHex) ? normHex(m.gradientHex) : '',
      effect: str(m.effect) || 'none', groupId: str(m.groupId), layoutId: str(m.layoutId), presetId: str(m.presetId),
      fixedText: bool(m.fixedText), fixedColor: bool(m.fixedColor)
    };
  }
  function imageFromMap(m) {
    const url = str(m.url);
    if (!url.trim()) return null;
    return {
      id: str(m.id) || newItemId(), url, offX: num(m.offX, 0), offY: num(m.offY, 0), scale: num(m.scale, 1),
      rotation: num(m.rotation, 0), opacity: clamp(num(m.opacity, 1), 0, 1), groupId: str(m.groupId), presetId: str(m.presetId),
      originalUrl: str(m.originalUrl)
    };
  }
  function shapeFromMap(m) {
    const strokes = decodeStrokes(m.path);
    if (!strokes.length) return null;
    return {
      id: str(m.id) || newItemId(), name: str(m.name) || 'Shape', path: String(m.path), strokes,
      colorHex: normHex(m.colorHex, '#FFFFFF'), outline: bool(m.outline), repeat: clamp(Math.round(num(m.repeat, 1)), 1, 4),
      offX: num(m.offX, 0), offY: num(m.offY, 0), scale: num(m.scale, 1), rotation: num(m.rotation, 0),
      kind: str(m.kind) || 'shape', drawingId: str(m.drawingId), groupId: str(m.groupId), presetId: str(m.presetId),
      opacity: clamp(num(m.opacity, 1), 0, 1),
      hiddenLayers: Array.isArray(m.hiddenLayers) ? m.hiddenLayers.filter(n => typeof n === 'number') : [],
      fixedColor: bool(m.fixedColor)
    };
  }
  /** A saved side as { texts, images, shapes, layerOrder, locked, area, ref, printWarnings }. */
  function normalizeView(m) {
    m = m || {};
    const texts = (Array.isArray(m.texts) ? m.texts : []).map(x => x && textFromMap(x)).filter(Boolean);
    const images = (Array.isArray(m.images) ? m.images : []).map(x => x && imageFromMap(x)).filter(Boolean);
    const legacyText = str(m.customText);
    if (legacyText && !texts.some(t => t.id === LEGACY_TEXT_ID)) {
      const style = str(m.fontStyle) || 'Normal';
      texts.unshift(Object.assign(textFromMap({ text: legacyText }), {
        id: LEGACY_TEXT_ID, size: num(m.fontSize, 18), colorHex: normHex(m.fontColorHex, '#FFFFFF'),
        offX: num(m.txtOffX, 0), offY: num(m.txtOffY, 0), bold: style.includes('Bold'), italic: style.includes('Italic')
      }));
    }
    const legacyImage = str(m.imageUrl);
    if (legacyImage.trim() && !images.some(i => i.id === LEGACY_IMAGE_ID)) {
      images.unshift(Object.assign(imageFromMap({ url: legacyImage }), {
        id: LEGACY_IMAGE_ID, offX: num(m.imgOffX, 0), offY: num(m.imgOffY, 0), scale: num(m.imgScale, 1)
      }));
    }
    const upgrade = k => k === 'text' ? 'text:' + LEGACY_TEXT_ID : k === 'image' ? 'image:' + LEGACY_IMAGE_ID : k;
    const a = m.area || {};
    let area = { left: num(a.left, 0), top: num(a.top, 0), right: num(a.right, 1), bottom: num(a.bottom, 1) };
    if (area.right - area.left < MIN_SPAN || area.bottom - area.top < MIN_SPAN) area = { left: 0, top: 0, right: 1, bottom: 1 };
    const r = m.ref;
    const ref = (r && num(r.width, 0) > 0 && num(r.height, 0) > 0)
      ? { left: num(r.left, 0), top: num(r.top, 0), width: num(r.width, 0), height: num(r.height, 0), sp: num(r.sp, 1) } : null;
    return {
      texts, images,
      shapes: (Array.isArray(m.shapes) ? m.shapes : []).map(x => x && shapeFromMap(x)).filter(Boolean),
      layerOrder: (Array.isArray(m.layerOrder) ? m.layerOrder : []).filter(k => typeof k === 'string').map(upgrade),
      locked: (Array.isArray(m.locked) ? m.locked : []).filter(k => typeof k === 'string').map(upgrade),
      area, ref,
      printWarnings: (Array.isArray(m.printWarnings) ? m.printWarnings : []).filter(k => typeof k === 'string')
    };
  }
  /** A saved customization with every side read. */
  function normalizeCustomization(c) {
    c = c || {};
    const views = {};
    Object.entries(c.views || {}).forEach(([k, v]) => { views[k] = normalizeView(v); });
    return { apparelColorHex: str(c.apparelColorHex) || '#FFFFFF', shirtStyle: str(c.shirtStyle), views };
  }

  const hasContent = v => v.texts.some(t => t.text.trim()) || v.images.length > 0 || v.shapes.length > 0;
  /** Bottom to top (DesignItems.kt layerKeys): the saved order, pictures it doesn't list at the bottom, the rest on top. */
  function layerKeys(v) {
    const existing = [];
    v.images.forEach(i => existing.push('image:' + i.id));
    v.shapes.forEach(s => existing.push('shape:' + s.id));
    v.texts.forEach(t => { if (t.text.length) existing.push('text:' + t.id); });
    const ordered = [...new Set(v.layerOrder.filter(k => existing.includes(k)))];
    const missing = existing.filter(k => !ordered.includes(k));
    const missingImages = missing.filter(k => k.startsWith('image:'));
    return [...missingImages, ...ordered, ...missing.filter(k => !missingImages.includes(k))];
  }
  const itemOf = (v, key) => {
    const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    const list = kind === 'text' ? v.texts : kind === 'image' ? v.images : kind === 'shape' ? v.shapes : [];
    return list.find(x => x.id === id) || null;
  };

  // ── Writing a side (Repositories.kt ViewDesign.toMap); the admin's Design Studio saves with ref.sp = 1 ──
  function textToMap(t) {
    const m = {
      id: t.id, text: t.text, font: t.font || DEFAULT_FONT_ID, size: t.size, colorHex: normHex(t.colorHex), offX: t.offX, offY: t.offY,
      rotation: t.rotation, bold: !!t.bold, italic: !!t.italic, caps: !!t.caps, align: t.align || 'center',
      letterSpacing: t.letterSpacing, lineHeight: t.lineHeight, curve: t.curve, outlineWidth: t.outlineWidth,
      outlineColorHex: normHex(t.outlineColorHex, '#000000'), shadow: t.shadow, shadowColorHex: normHex(t.shadowColorHex, '#000000'),
      opacity: t.opacity, gradientHex: t.gradientHex ? normHex(t.gradientHex) : '', effect: t.effect || 'none'
    };
    ['groupId', 'layoutId', 'presetId'].forEach(k => { if (t[k]) m[k] = t[k]; });
    if (t.fixedText) m.fixedText = true;
    if (t.fixedColor) m.fixedColor = true;
    return m;
  }
  function imageToMap(i) {
    const m = { id: i.id, url: i.url, offX: i.offX, offY: i.offY, scale: i.scale, rotation: i.rotation, opacity: i.opacity };
    if (i.groupId) m.groupId = i.groupId;
    if (i.presetId) m.presetId = i.presetId;
    if (/^https?:/i.test(i.originalUrl || '')) m.originalUrl = i.originalUrl;
    return m;
  }
  function shapeToMap(s) {
    const m = {
      id: s.id, name: s.name, path: s.strokes ? encodeStrokes(s.strokes) : s.path, colorHex: normHex(s.colorHex), outline: !!s.outline,
      repeat: s.repeat || 1, offX: s.offX, offY: s.offY, scale: s.scale, rotation: s.rotation, kind: s.kind || 'shape'
    };
    ['drawingId', 'groupId', 'presetId'].forEach(k => { if (s[k]) m[k] = s[k]; });
    if (s.opacity < 0.999) m.opacity = s.opacity;
    if (s.hiddenLayers && s.hiddenLayers.length) m.hiddenLayers = [...s.hiddenLayers].sort((a, b) => a - b);
    if (s.fixedColor) m.fixedColor = true;
    return m;
  }
  function viewToMap(v) {
    const m = {
      texts: v.texts.filter(t => t.text.length).map(textToMap), images: v.images.map(imageToMap), shapes: v.shapes.map(shapeToMap),
      customText: '', imageUrl: '', layerOrder: layerKeys(v), locked: v.locked.slice(),
      area: { left: v.area.left, top: v.area.top, right: v.area.right, bottom: v.area.bottom }
    };
    if (v.ref) m.ref = { left: v.ref.left, top: v.ref.top, width: v.ref.width, height: v.ref.height, sp: v.ref.sp };
    if (v.printWarnings && v.printWarnings.length) m.printWarnings = v.printWarnings.slice();
    return m;
  }
  function customizationToMap(c) {
    const views = {};
    Object.entries(c.views).forEach(([k, v]) => { if (hasContent(v)) views[k] = viewToMap(v); });
    return { apparelColorHex: c.apparelColorHex, shirtStyle: c.shirtStyle || '', views };
  }

  /** [v] moved onto a print zone {left, top, width, height} where 1 size unit is [sp] px (DesignItems.kt fitTo). */
  function fitTo(v, zone, sp) {
    const from = v.ref;
    const now = { left: zone.left, top: zone.top, width: zone.width, height: zone.height, sp };
    if (!from || !(from.width > 0) || !(from.height > 0) || !(from.sp > 0)) return Object.assign({}, v, { ref: now });
    const kx = now.width / from.width, ky = now.height / from.height;
    const X = x => now.left + (x - from.left) * kx, Y = y => now.top + (y - from.top) * ky;
    return Object.assign({}, v, {
      texts: v.texts.map(t => Object.assign({}, t, { offX: X(t.offX), offY: Y(t.offY), size: t.size * kx * from.sp / now.sp })),
      images: v.images.map(i => Object.assign({}, i, { offX: X(i.offX), offY: Y(i.offY) })),
      shapes: v.shapes.map(s => Object.assign({}, s, { offX: X(s.offX), offY: Y(s.offY) })),
      ref: now
    });
  }

  // ── Fonts: the bundled ones (fonts/*.ttf, same files as the app) and the shop's uploads (designFonts) ──
  let fontList = null, fontCats = [], customFonts = [];
  const faces = {};
  async function loadFontList() {
    if (fontList) return fontList;
    try {
      const j = await (await fetch('js/studio-fonts.json', { cache: 'no-cache' })).json();
      fontList = j.fonts.map(f => Object.assign({ builtIn: true, styles: f.styles || {} }, f));
      fontCats = j.categories || [];
    } catch (e) {
      console.warn("Couldn't read js/studio-fonts.json", e);
      fontList = [];
    }
    try {
      const snap = await db.collection('designFonts').get();
      customFonts = snap.docs.map(d => Object.assign({ docId: d.id }, d.data()))
        .filter(f => f.url && !f.deleted)
        .map(f => ({ id: 'custom:' + f.docId, label: f.label || 'Shop font', category: f.category || 'Shop fonts', url: f.url, asc: num(f.asc, 0), desc: num(f.desc, 0), builtIn: false, styles: {} }));
    } catch (e) {
      console.warn("Couldn't read designFonts", e);
      customFonts = [];
    }
    return fontList;
  }
  /** Reads the font lists again next time (after a font is uploaded or removed). */
  function reloadFonts() { fontList = null; }
  function allFonts() { return (fontList || []).concat(customFonts); }
  function fontCategories() { return fontCats.concat(customFonts.some(f => f.category === 'Shop fonts') ? ['Shop fonts'] : []); }
  function fontById(id) { return allFonts().find(f => f.id === (id || DEFAULT_FONT_ID)) || null; }
  function fontLabel(id) { const f = fontById(id); return f ? f.label : (String(id).startsWith('custom:') ? 'Shop font' : 'Default'); }
  /** The file a text uses (StudioFonts.kt typeface): bold / italic only change fonts that have those files. */
  function fontFile(id, bold, italic) {
    const f = fontById(id) || fontById(DEFAULT_FONT_ID);
    if (!f) return null;
    if (!f.builtIn) return { family: 'ks_' + f.id.replace(/[^a-z0-9]/gi, '_'), url: f.url };
    const style = bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
    const file = (style !== 'regular' && f.styles[style]) || f.file;
    return { family: 'ks_' + file, url: 'fonts/' + file + '.ttf' };
  }
  async function ensureFace(ff) {
    if (!ff) return;
    if (!faces[ff.family]) {
      const face = new FontFace(ff.family, `url("${ff.url}")`);
      faces[ff.family] = face.load().then(f => { document.fonts.add(f); return f; }).catch(e => { console.warn("Couldn't load font", ff.url, e); });
    }
    await faces[ff.family];
  }
  /** Loads every font [texts] use, so measuring and drawing them is right the first time. */
  async function ensureFonts(texts) {
    await loadFontList();
    const want = new Map();
    texts.forEach(t => { const ff = fontFile(t.font, t.bold, t.italic); if (ff) want.set(ff.family, ff); });
    await Promise.all([...want.values()].map(ensureFace));
  }
  const fontCss = (t, s) => { const ff = fontFile(t.font, t.bold, t.italic); return `${s}px "${ff ? ff.family : 'sans-serif'}", sans-serif`; };

  // ── Offscreen layers (Android's saveLayer): drawn at the canvas's current scale, then put back with an alpha ──
  function scaleOf(ctx) { const m = ctx.getTransform(); return Math.max(0.01, Math.hypot(m.a, m.b)); }
  function withLayer(ctx, left, top, w, h, alpha, draw) {
    const k = scaleOf(ctx);
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w * k)); cv.height = Math.max(1, Math.ceil(h * k));
    const lc = cv.getContext('2d');
    lc.scale(k, k); lc.translate(-left, -top);
    draw(lc);
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * clamp(alpha, 0, 1);
    ctx.drawImage(cv, left, top, w, h);
    ctx.restore();
  }
  /** CSS blur for an Android BlurMaskFilter of [radius] (Skia: sigma = 0.57735·r + 0.5). */
  const blurCss = radius => `blur(${(0.57735 * radius + 0.5).toFixed(3)}px)`;

  // ── Text (TextRender.kt) ──
  function fnv1a(s) {
    let h = 0x811C9DC5 | 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h | 0;
  }
  function mulberry32(seed) {
    let a = seed | 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const shown = t => t.caps ? t.text.toUpperCase() : t.text;
  const measureCtx = document.createElement('canvas').getContext('2d');
  function layout(t, spPx) {
    const s = t.size * spPx;
    const ctx = measureCtx;
    ctx.font = fontCss(t, s);
    const spacing = t.letterSpacing * s;
    const lines = shown(t).split('\n').map(line => {
      const chars = Array.from(line);
      const adv = chars.map(c => ctx.measureText(c).width);
      const w = !chars.length ? 0 : spacing === 0 ? ctx.measureText(line).width : adv.reduce((a, b) => a + b, 0) + spacing * chars.length;
      return { text: line, width: w, chars, adv };
    });
    const lineH = s * t.lineHeight;
    const blockW = lines.reduce((m, l) => Math.max(m, l.width), 0);
    const blockH = lineH * lines.length;
    const f = fontById(t.font || DEFAULT_FONT_ID);
    let baseline;
    if (f && f.asc > 0) baseline = (f.asc - f.desc) / 2 * s;
    else { const mt = ctx.measureText('Hg'); baseline = ((mt.fontBoundingBoxAscent || s * 0.8) - (mt.fontBoundingBoxDescent || s * 0.2)) / 2; }
    const theta = Math.min(Math.abs(t.curve) / 100 * Math.PI, Math.PI * 1.9);
    const sag = (theta > 0.001 && blockW > 0) ? (blockW / theta) * (1 - Math.cos(theta / 2)) : 0;
    return { s, spacing, lineH, blockW, blockH, baseline, lines, sag };
  }
  function textHalfSize(t, spPx) {
    const l = layout(t, spPx);
    const pad = t.outlineWidth * l.s;
    return [l.blockW / 2 + pad, l.blockH / 2 + l.sag / 2 + pad];
  }
  /** Paint state for one pass: { fill, stroke, lineWidth, blur, gradient } */
  function drawLines(ctx, l, t, p, dx, dy) {
    ctx.save();
    ctx.font = fontCss(t, l.s);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    if (p.blur > 0) ctx.filter = blurCss(p.blur);
    ctx.lineJoin = 'round';
    const paint = (txt, x, y) => {
      if (p.gradient) { const g = ctx.createLinearGradient(0, -l.blockH / 2, 0, l.blockH / 2); g.addColorStop(0, p.gradient[0]); g.addColorStop(1, p.gradient[1]); ctx.fillStyle = g; }
      else if (p.fill) ctx.fillStyle = p.fill;
      if (p.fill || p.gradient) ctx.fillText(txt, x, y);
      if (p.stroke) { ctx.strokeStyle = p.stroke; ctx.lineWidth = p.lineWidth; ctx.strokeText(txt, x, y); }
    };
    l.lines.forEach((line, i) => {
      if (!line.chars.length) return;
      const mid = -l.blockH / 2 + (i + 0.5) * l.lineH + dy;
      if (Math.abs(t.curve) < 1) {
        const x0 = (t.align === 'left' ? -l.blockW / 2 : t.align === 'right' ? l.blockW / 2 - line.width : -line.width / 2) + dx;
        if (l.spacing === 0) paint(line.text, x0, mid + l.baseline);
        else {
          let x = x0 + l.spacing / 2;
          line.chars.forEach((ch, j) => { paint(ch, x, mid + l.baseline); x += line.adv[j] + l.spacing; });
        }
      } else {
        const k = Math.sign(t.curve);
        const theta = Math.min(Math.abs(t.curve) / 100 * Math.PI, Math.PI * 1.9);
        const w = line.adv.reduce((a, b) => a + b, 0) + l.spacing * line.chars.length;
        if (w <= 0) return;
        const r = w / theta, sag = r * (1 - Math.cos(theta / 2));
        let pos = -w / 2;
        line.chars.forEach((ch, j) => {
          const adv = line.adv[j];
          const centre = pos + l.spacing / 2 + adv / 2;
          pos += adv + l.spacing;
          const phi = centre / r;
          ctx.save();
          ctx.translate(r * Math.sin(phi) + dx, mid + k * r * (1 - Math.cos(phi)) - k * sag / 2);
          ctx.rotate(k * phi);
          paint(ch, -adv / 2, l.baseline);
          ctx.restore();
        });
      }
    });
    ctx.restore();
  }
  function drawPasses(ctx, t, l) {
    const s = l.s;
    const color = parseColor(t.colorHex);
    const outlined = t.outlineWidth > 0 && t.effect !== 'hollow';
    const outlinePx = t.outlineWidth * s * 2;
    if (t.shadow > 0) {
      const d = t.shadow * s * 0.12;
      const c = css(parseColor(t.shadowColorHex, '#000000'), 0.55);
      drawLines(ctx, l, t, { fill: c, stroke: outlined ? c : null, lineWidth: outlinePx, blur: Math.max(0.5, t.shadow * s * 0.18) }, d, d);
    }
    if (t.effect === '3d') {
      const step = s * 0.012;
      const c = css({ r: color.r * 0.55, g: color.g * 0.55, b: color.b * 0.55, a: color.a });
      for (let i = 6; i >= 1; i--) drawLines(ctx, l, t, { fill: c, stroke: outlined ? c : null, lineWidth: outlinePx }, step * i, step * i);
    }
    if (t.effect === 'neon') {
      const p = { fill: css(color), blur: s * 0.22 };
      drawLines(ctx, l, t, p, 0, 0);
      drawLines(ctx, l, t, p, 0, 0);
    }
    if (outlined) drawLines(ctx, l, t, { stroke: css(parseColor(t.outlineColorHex, '#000000')), lineWidth: outlinePx }, 0, 0);
    if (t.effect === 'hollow') {
      const c = t.outlineWidth > 0 ? parseColor(t.outlineColorHex, '#000000') : color;
      drawLines(ctx, l, t, { stroke: css(c), lineWidth: Math.max(t.outlineWidth, 0.035) * s * 2 }, 0, 0);
    } else {
      const main = t.effect === 'neon' ? lerpColor(color, { r: 255, g: 255, b: 255, a: 1 }, 0.55) : color;
      if (t.gradientHex) drawLines(ctx, l, t, { gradient: [css(main), css(parseColor(t.gradientHex))] }, 0, 0);
      else drawLines(ctx, l, t, { fill: css(main) }, 0, 0);
    }
  }
  function distress(ctx, t, l) {
    const rnd = mulberry32(fnv1a(t.id));
    const w = l.blockW + l.s * 0.4, h = l.blockH + l.sag;
    const count = clamp(Math.trunc(w * h / (l.s * l.s) * 18), 20, 600);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    for (let i = 0; i < count; i++) {
      const x = rnd() * w - w / 2, y = rnd() * h - h / 2, radius = l.s * (0.015 + rnd() * 0.035);
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  /** Draws text [t] at its position (fonts must be loaded: ensureFonts). */
  function drawTextItem(ctx, t, spPx) {
    if (!t.text.trim()) return;
    const l = layout(t, spPx);
    const margin = l.s * 1.2 + l.sag;
    ctx.save();
    ctx.translate(t.offX, t.offY);
    ctx.rotate(t.rotation * Math.PI / 180);
    const left = -l.blockW / 2 - margin, top = -l.blockH / 2 - margin;
    withLayer(ctx, left, top, l.blockW + margin * 2, l.blockH + margin * 2, t.opacity, lc => {
      drawPasses(lc, t, l);
      if (t.effect === 'distressed') distress(lc, t, l);
    });
    ctx.restore();
  }

  // ── Drawings and shapes (DesignShapes.kt) ──
  function strokeBlurRadius(s, w, sizePx) {
    if (s.brush === BRUSH.AIR && !s.filled) return w * (0.25 + s.softness);
    if (s.softness > 0) return s.softness * 0.05 * sizePx;
    return 0;
  }
  function drawStroke(ctx, s, sizePx, baseHex, outline) {
    const pts = s.points;
    const ink = parseColor(s.color || baseHex);
    ctx.save();
    if (s.brush === BRUSH.ERASE) { ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = ctx.strokeStyle = '#000'; }
    else ctx.fillStyle = ctx.strokeStyle = css(ink, ink.a * s.opacity);
    ctx.lineCap = s.brush === BRUSH.MARKER ? 'square' : 'round';
    ctx.lineJoin = 'round';
    const fill = s.filled && !outline;
    const width = (s.filled ? OUTLINE_WIDTH : s.width) * sizePx;
    const blur = strokeBlurRadius(s, width, sizePx);
    if (blur > 0.01) ctx.filter = blurCss(blur);
    ctx.beginPath();
    if (pts.length === 1) {
      ctx.arc(pts[0][0] * sizePx, pts[0][1] * sizePx, width / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      pts.forEach(([x, y], i) => i ? ctx.lineTo(x * sizePx, y * sizePx) : ctx.moveTo(x * sizePx, y * sizePx));
      if (s.filled) ctx.closePath();
      if (fill) ctx.fill(); else { ctx.lineWidth = width; ctx.stroke(); }
    }
    ctx.restore();
  }
  function drawStrokes(ctx, strokes, sizePx, colorHex, outline, hiddenLayers) {
    const hidden = new Set(hiddenLayers || []);
    const byLayer = new Map();
    strokes.filter(s => !hidden.has(s.layer) && s.points.length).forEach(s => {
      if (!byLayer.has(s.layer)) byLayer.set(s.layer, []);
      byLayer.get(s.layer).push(s);
    });
    [...byLayer.keys()].sort((a, b) => a - b).forEach(layer => {
      const list = byLayer.get(layer);
      if (list.some(s => s.brush === BRUSH.ERASE)) {
        // An eraser only clears its own layer
        withLayer(ctx, -sizePx, -sizePx, sizePx * 3, sizePx * 3, 1, lc => list.forEach(s => drawStroke(lc, s, sizePx, colorHex, outline)));
      } else list.forEach(s => drawStroke(ctx, s, sizePx, colorHex, outline));
    });
  }
  /** Draws [shape] into a [sizePx] square whose top-left is the current origin. */
  function drawDesignShape(ctx, shape, sizePx) {
    const n = clamp(shape.repeat || 1, 1, 4), cell = sizePx / n;
    const strokes = shape.strokes || decodeStrokes(shape.path);
    const tiles = c => {
      for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
        c.save(); c.translate(col * cell, row * cell);
        drawStrokes(c, strokes, cell, shape.colorHex, shape.outline, shape.hiddenLayers);
        c.restore();
      }
    };
    if (shape.opacity < 1) withLayer(ctx, 0, 0, sizePx, sizePx, shape.opacity, tiles);
    else tiles(ctx);
  }

  // ── A side's items (DesignRender.kt) ──
  function imageHalfSize(item, zoneWidth, w, h) {
    const box = zoneWidth * IMAGE_BASE_FRACTION * item.scale;
    if (!(w > 0) || !(h > 0)) return [box / 2, box / 2];
    const k = Math.min(box / w, box / h);
    return [w * k / 2, h * k / 2];
  }
  const shapeHalfSize = (shape, zoneWidth) => zoneWidth * SHAPE_BASE_FRACTION * shape.scale / 2;
  function drawImageItem(ctx, item, img, zoneWidth) {
    const [hw, hh] = imageHalfSize(item, zoneWidth, img.naturalWidth || img.width, img.naturalHeight || img.height);
    ctx.save();
    ctx.translate(item.offX, item.offY);
    ctx.rotate(item.rotation * Math.PI / 180);
    ctx.globalAlpha = ctx.globalAlpha * clamp(item.opacity, 0, 1);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, -hw, -hh, hw * 2, hh * 2);
    ctx.restore();
  }
  function drawShapeItem(ctx, shape, zoneWidth) {
    const size = zoneWidth * SHAPE_BASE_FRACTION * shape.scale;
    ctx.save();
    ctx.translate(shape.offX, shape.offY);
    ctx.rotate(shape.rotation * Math.PI / 180);
    ctx.translate(-size / 2, -size / 2);
    drawDesignShape(ctx, shape, size);
    ctx.restore();
  }
  /** Draws every item of side [v] bottom to top; [images]: loaded pictures by item id. */
  function drawSideItems(ctx, v, zoneWidth, spPx, images) {
    layerKeys(v).forEach(key => {
      const it = itemOf(v, key); if (!it) return;
      if (key.startsWith('text:')) drawTextItem(ctx, it, spPx);
      else if (key.startsWith('image:')) { const img = images[it.id]; if (img) drawImageItem(ctx, it, img, zoneWidth); }
      else drawShapeItem(ctx, it, zoneWidth);
    });
  }
  /** Loads an image for drawing on a canvas (pictures from Cloudinary are asked for with CORS so it stays saveable). */
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (/^https?:/i.test(src) && !src.startsWith(location.origin)) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Couldn't load " + (src.length > 80 ? src.slice(0, 77) + '…' : src)));
      img.src = src;
    });
  }
  const _imgCache = {};
  /** Every picture of [v] by item id; ones that can't be loaded are left out (and listed in .failed). */
  async function loadSideImages(v) {
    const out = {}; out.failed = [];
    await Promise.all(v.images.map(async i => {
      try { out[i.id] = await (_imgCache[i.url] = _imgCache[i.url] || loadImage(i.url)); }
      catch (e) { delete _imgCache[i.url]; out.failed.push(i.url); }
    }));
    return out;
  }

  /**
   * Side [v] drawn alone on a transparent [w]×[h] canvas that is its whole print zone, trimmed to the design area,
   * the way the app prints it. [mirror] flips it for transfer printing.
   */
  async function renderZone(v, w, h, { mirror = false } = {}) {
    const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    let d;
    if (v.ref) d = fitTo(v, { left: 0, top: 0, width: W, height: H }, 1);
    else {
      // No record of where it was placed: centre everything
      d = Object.assign({}, v, {
        texts: v.texts.map(t => Object.assign({}, t, { offX: W / 2, offY: H / 2, size: t.size * W / 300 })),
        images: v.images.map(i => Object.assign({}, i, { offX: W / 2, offY: H / 2 })),
        shapes: v.shapes.map(s => Object.assign({}, s, { offX: W / 2, offY: H / 2 }))
      });
    }
    await ensureFonts(d.texts);
    const images = await loadSideImages(d);
    if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.save();
    const a = d.area;
    ctx.beginPath(); ctx.rect(a.left * W, a.top * H, (a.right - a.left) * W, (a.bottom - a.top) * H); ctx.clip();
    drawSideItems(ctx, d, W, 1, images);
    ctx.restore();
    cv.failedImages = images.failed;
    return cv;
  }

  /** Print size of a side [cm] wide whose zone is [art.w·zone]×[art.h·zone] in the picture, at [dpi]. */
  function printPixels(art, dpi = 300) {
    const zw = (art.zone.right - art.zone.left) * art.w, zh = (art.zone.bottom - art.zone.top) * art.h;
    const cm = art.cm || 0;
    if (!(cm > 0)) return { w: Math.round(zw * 4), h: Math.round(zh * 4), cmW: 0, cmH: 0, known: false };
    const w = Math.round(cm / 2.54 * dpi);
    return { w, h: Math.round(w * zh / zw), cmW: cm, cmH: cm * zh / zw, known: true };
  }

  /** The inks a side needs: every colour its texts and drawings use (pictures are listed apart). */
  function inksOf(v) {
    const set = new Map();
    const add = (hex, what) => { if (!hex) return; const h = normHex(hex); if (!set.has(h)) set.set(h, new Set()); set.get(h).add(what); };
    v.texts.filter(t => t.text.trim()).forEach(t => {
      if (t.effect === 'hollow') add(t.outlineWidth > 0 ? t.outlineColorHex : t.colorHex, 'text');
      else add(t.colorHex, 'text');
      if (t.gradientHex) add(t.gradientHex, 'text');
      if (t.outlineWidth > 0 && t.effect !== 'hollow') add(t.outlineColorHex, 'outline');
      if (t.shadow > 0) add(t.shadowColorHex, 'shadow');
    });
    v.shapes.forEach(s => {
      const hidden = new Set(s.hiddenLayers || []);
      (s.strokes || decodeStrokes(s.path)).filter(x => !hidden.has(x.layer) && x.brush !== BRUSH.ERASE).forEach(x => add(x.color || s.colorHex, s.kind === 'drawing' ? 'drawing' : 'shape'));
    });
    return [...set.entries()].map(([hex, uses]) => ({ hex, uses: [...uses] }));
  }

  // ── Settings sets (StudioSettings.kt): one per product; product set → category set → the default ──
  function normalizeSettings(id, m) {
    m = m || {};
    const lim = m.limits || {};
    return {
      id, name: str(m.name) || 'Standard', isDefault: m.isDefault === true,
      scope: ['all', 'products', 'category'].includes(m.scope) ? m.scope : (m.isDefault ? 'all' : 'products'),
      products: Array.isArray(m.products) ? m.products.filter(x => typeof x === 'string') : [],
      category: str(m.category),
      fontsOff: Array.isArray(m.fontsOff) ? m.fontsOff : [], recommendedFonts: Array.isArray(m.recommendedFonts) ? m.recommendedFonts : [],
      layoutsOff: Array.isArray(m.layoutsOff) ? m.layoutsOff : [],
      tools: (m.tools && typeof m.tools === 'object') ? m.tools : {},
      inks: Array.isArray(m.inks) && m.inks.length ? m.inks.map(h => normHex(h)) : DEFAULT_INKS.slice(),
      anyColor: m.anyColor !== false,
      limits: { minLineMm: num(lim.minLineMm, DEFAULT_LIMITS.minLineMm), minOpacity: num(lim.minOpacity, DEFAULT_LIMITS.minOpacity), minDpi: num(lim.minDpi, DEFAULT_LIMITS.minDpi), minTextMm: num(lim.minTextMm, DEFAULT_LIMITS.minTextMm) },
      updatedAt: m.updatedAt || null
    };
  }
  const seconds = ts => (ts && typeof ts.seconds === 'number') ? ts.seconds : 0;
  /** The set [product] uses, the same way the app picks it; [categoryName] turns a category id into its name. */
  function settingsFor(product, sets, categoryName) {
    const newest = (a, b) => seconds(b.updatedAt) - seconds(a.updatedAt);
    if (product) {
      const own = sets.filter(s => !s.isDefault && s.scope === 'products' && s.products.includes(product.id)).sort(newest)[0];
      if (own) return own;
      const cat = categoryName ? categoryName(product.category || '') : (product.category || '');
      if (cat) {
        const c = sets.filter(s => !s.isDefault && s.scope === 'category' && s.category.toLowerCase() === cat.toLowerCase()).sort(newest)[0];
        if (c) return c;
      }
    }
    return sets.filter(s => s.isDefault).sort(newest)[0] || normalizeSettings('', { name: 'Standard (built in)', isDefault: true, scope: 'all' });
  }

  // ── Text layouts (StudioSettings.kt TextLayout) ──
  let _starters = null;
  async function starterLayouts() {
    if (!_starters) _starters = fetch('js/starter-layouts.json', { cache: 'no-cache' }).then(r => r.json()).then(j => j.layouts || []).catch(() => []);
    return _starters;
  }
  /** A layout's lines as texts on a zone {left, top, width, height} where 1 size unit is [sp] px. */
  function layoutToTexts(layout, zone, sp, shirtHex, words = {}) {
    const ink = contrastInk(shirtHex);
    const colour = c => (!c || c === 'auto') ? ink : normHex(c, ink);
    const group = (layout.lines || []).length > 1 ? newItemId() : '';
    return (layout.lines || []).map(line => {
      let text = words[line.key] != null ? words[line.key] : line.text;
      if (line.caps) text = text.toUpperCase();
      if (!text.trim() && line.optional) return null;
      return textFromMap({
        text: text.trim() ? text : line.text, font: line.font || DEFAULT_FONT_ID,
        size: clamp(num(line.size, 0.1) * zone.width / sp, 2, 400), colorHex: colour(line.color),
        offX: zone.left + zone.width / 2 + num(line.x, 0) * zone.width, offY: zone.top + zone.height / 2 + num(line.y, 0) * zone.height,
        curve: num(line.curve, 0), letterSpacing: num(line.spacing, 0), outlineWidth: num(line.outline, 0),
        outlineColorHex: colour(line.outlineColor), shadow: num(line.shadow, 0), effect: line.effect || 'none',
        caps: !!line.caps, groupId: group, layoutId: layout.id || ''
      });
    }).filter(Boolean);
  }

  // ── Usage stats: what paid orders used ──
  /** Counts shop designs, text layouts and fonts used in [orders] ({id, ...data}). Orders are only written once paid
   *  (OrderService.saveOrder), so every order counts except cancelled ones. */
  function usageOf(orders) {
    const presets = {}, layouts = {}, fonts = {};
    const bump = (map, k, orderId) => { if (!k) return; (map[k] = map[k] || new Set()).add(orderId); };
    orders.forEach(o => {
      if (o.status === 'Cancelled') return;
      (o.items || []).forEach(it => {
        const c = it && it.customization; if (!c || !c.views) return;
        Object.values(c.views).forEach(raw => {
          const v = normalizeView(raw);
          v.texts.forEach(t => { bump(presets, t.presetId, o.id); bump(layouts, t.layoutId, o.id); bump(fonts, t.font, o.id); });
          v.images.forEach(i => bump(presets, i.presetId, o.id));
          v.shapes.forEach(s => bump(presets, s.presetId, o.id));
        });
      });
    });
    const count = m => Object.fromEntries(Object.entries(m).map(([k, s]) => [k, s.size]));
    return { presets: count(presets), layouts: count(layouts), fonts: count(fonts) };
  }

  return {
    IMAGE_BASE_FRACTION, SHAPE_BASE_FRACTION, DEFAULT_FONT_ID, BRUSH, EFFECTS, TOOLS, DEFAULT_INKS, DEFAULT_LIMITS,
    newItemId, parseColor, css, normHex, luminance, contrastInk,
    decodeStrokes, encodeStrokes,
    textFromMap, imageFromMap, shapeFromMap, normalizeView, normalizeCustomization, hasContent, layerKeys, itemOf,
    textToMap, imageToMap, shapeToMap, viewToMap, customizationToMap, fitTo,
    loadFontList, reloadFonts, allFonts, fontCategories, fontById, fontLabel, fontFile, ensureFonts, fontCss,
    fnv1a, mulberry32, textHalfSize, drawTextItem, drawStrokes, drawDesignShape,
    imageHalfSize, shapeHalfSize, drawImageItem, drawShapeItem, drawSideItems, loadImage, loadSideImages,
    renderZone, printPixels, inksOf,
    normalizeSettings, settingsFor, starterLayouts, layoutToTexts, usageOf
  };
})();
