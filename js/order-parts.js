// ─────────────────────────────────────────────
//  ORDER PARTS
//  An order split into what the shop does with it: the clothes to get ready (style, colour, size, how many) and
//  the designs to print (each side's picture, print size, inks and print files). Used on the Orders page, the
//  order's own page and its printed job sheet. Reads the order as saved; writes nothing.
//  Needs firebase.js (esc, safeUrl, peso, orderNo, shirtStyleLabel, loadModels, productModel, modelSide,
//  guessShirtStyle, DESIGN_SIDES, toast) and studio-common.js (Studio).
// ─────────────────────────────────────────────
const OrderParts = (() => {
  // Common shirt colours, for a name staff can read instead of a colour code
  const COLOURS = [
    ['Black', '#111111'], ['White', '#FFFFFF'], ['Off-white', '#F2EFE6'], ['Cream', '#EFE3C8'], ['Beige', '#D8C3A0'],
    ['Light gray', '#CFCFCF'], ['Gray', '#8C8C8C'], ['Charcoal', '#3C3C3C'], ['Navy', '#1F2A44'], ['Royal blue', '#2350B8'],
    ['Blue', '#2F6FD6'], ['Light blue', '#9CC3F0'], ['Teal', '#127C7C'], ['Green', '#2E7D32'], ['Army green', '#4B5320'],
    ['Mint', '#A8E6C4'], ['Yellow', '#F5D000'], ['Mustard', '#C9A227'], ['Orange', '#F57C00'], ['Red', '#D32F2F'],
    ['Maroon', '#6D1A24'], ['Pink', '#F48FB1'], ['Hot pink', '#E0287A'], ['Lavender', '#C3A9E0'], ['Purple', '#6A1B9A'],
    ['Brown', '#6D4C41']
  ];
  const hexOk = h => (typeof h === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) ? h.slice(0, 7).toUpperCase() : '';
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  /** The nearest common colour name for a colour code ("#121212" → "Black"), or '' for no code. */
  function colourName(hex) {
    const h = hexOk(hex); if (!h) return '';
    const [r, g, b] = rgb(h);
    let best = '', dist = Infinity;
    COLOURS.forEach(([name, c]) => {
      const [R, G, B] = rgb(c), mr = (r + R) / 2;
      // "Redmean" distance: closer to what the eye sees than plain RGB distance
      const d = (2 + mr / 256) * (r - R) ** 2 + 4 * (g - G) ** 2 + (2 + (255 - mr) / 256) * (b - B) ** 2;
      if (d < dist) { dist = d; best = name; }
    });
    return best;
  }

  const sideRank = k => { const i = DESIGN_SIDES.indexOf(k); return i < 0 ? 9 : i; };
  const viewOf = (it, side) => Studio.normalizeView((((it.customization || {}).views) || {})[side]);
  /** The sides of an item that have something on them, front first. */
  function sidesOf(it) {
    const views = ((it.customization || {}).views) || {};
    return Object.keys(views).filter(k => { try { return Studio.hasContent(Studio.normalizeView(views[k])); } catch (e) { return false; } })
      .sort((a, b) => sideRank(a) - sideRank(b));
  }
  /** Whether the customer made a design for this item (older orders kept a plain text instead). */
  function hasDesign(it) {
    if (sidesOf(it).length) return true;
    const views = ((it.customization || {}).views) || {};
    return !!String(it.customText || '').trim() || Object.values(views).some(v => v && (v.customText || v.imageUrl));
  }
  /** The shirt an item needs: its cut (or product name), colour and size. */
  function shirtOf(it) {
    const c = it.customization || {}, custom = hasDesign(it);
    const hex = hexOk(it.colorHex) || hexOk(c.apparelColorHex);
    const style = shirtStyleLabel(c.shirtStyle);
    return { name: custom && style ? style : (it.productName || style || 'Item'), hex, colour: colourName(hex), size: String(it.size || '').trim(), custom };
  }
  /** The customer's notes, with the Fit Scan measurements the app adds taken out. */
  function notesOf(it) {
    const notes = String(it.notes || '');
    const fit = notes.match(/\[(Scanned Measurements|Entered Measurements|Typed Measurements|Manual Entry) - ([^\]]*)\]/);
    return {
      notes: (fit ? notes.replace(fit[0], '') : notes).trim().replace(/^(AR Scanned Fit|Manual Entry Fit)$/, ''),
      fit: fit ? fit[2].trim() : '',
      fitLabel: fit && fit[1].startsWith('Scanned') ? 'Fit Scan (camera)' : 'Fit Scan (typed in)'
    };
  }
  /** One line per kind of shirt: same cut, colour, size and notes are added together. */
  function clothes(items) {
    const lines = [], by = {};
    items.forEach((it, i) => {
      const s = shirtOf(it), n = notesOf(it), qty = +it.quantity || 1;
      const key = [s.name, s.hex, s.size, s.custom, n.notes, n.fit].join('|');
      let L = by[key];
      if (!L) { L = by[key] = Object.assign({}, s, n, { qty: 0, total: 0, photo: safeUrl(it.imageUrl), idx: [] }); lines.push(L); }
      L.qty += qty; L.total += (+it.price || 0) * qty; L.idx.push(i);
    });
    return lines;
  }
  /** One group per design: the same design on several shirts is printed once per shirt. */
  function designs(items) {
    const groups = [], by = {};
    items.forEach((it, i) => {
      if (!hasDesign(it)) return;
      const key = JSON.stringify([((it.customization || {}).views) || {}, it.customText || '']);
      let g = by[key];
      if (!g) { g = by[key] = { idx: i, items: [], qty: 0, sides: sidesOf(it), preview: '', text: String(it.customText || '').trim() }; groups.push(g); }
      g.items.push(i); g.qty += +it.quantity || 1;
      if (!g.preview) g.preview = safeUrl(it.previewUrl);
    });
    return groups;
  }
  /** "Men's Classic · Black (M ×2, L ×1)" for the shirts a design goes on. */
  function goesOn(items, idxs) {
    const by = {}, order = [];
    idxs.forEach(i => {
      const s = shirtOf(items[i]), k = s.name + (s.colour ? ' · ' + s.colour : '');
      if (!by[k]) { by[k] = []; order.push(k); }
      by[k].push(`${s.size || 'no size'} ×${+items[i].quantity || 1}`);
    });
    return order.map(k => `${k} (${by[k].join(', ')})`).join('; ');
  }

  const orders = {};                 // order id → the order last shown, for the buttons
  const pictures = new Map();        // "order|item|side" → { url, size } once drawn
  const swatch = (hex, title) => `<span class="op-dot" style="background:${hex};" title="${esc(title || hex)}"></span>`;

  function clothesHtml(o, lines) {
    const n = lines.reduce((s, L) => s + L.qty, 0);
    return `<section class="op-box op-c" aria-label="Clothes to prepare">
      <h4><i class="bi bi-bag-check"></i> Clothes to prepare <small>${n} piece${n === 1 ? '' : 's'}</small></h4>
      ${lines.map(L => `<div class="op-cl">
        <span class="op-tick" aria-hidden="true"></span>
        ${L.hex ? `<span class="op-sw" style="background:${L.hex};" title="${esc(L.colour + ' · ' + L.hex)}"></span>`
          : L.photo ? `<img class="op-sw" src="${L.photo}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'op-sw',textContent:'👕'}))">`
          : '<span class="op-sw">👕</span>'}
        <div class="op-cl-t">
          <div class="op-n">${esc(L.name)}${L.colour ? ` · ${esc(L.colour)}` : ''}</div>
          <div class="op-s">${L.size ? 'Size <b>' + esc(L.size) + '</b>' : 'No size'}${L.custom ? '' : ' · <span class="op-plain">No custom design</span>'}</div>
          ${L.notes ? `<div class="op-note"><i class="bi bi-chat-left-text"></i> ${esc(L.notes)}</div>` : ''}
          ${L.fit ? `<div class="op-note"><i class="bi bi-rulers"></i> ${L.fitLabel}: ${esc(L.fit)}</div>` : ''}
        </div>
        <div class="op-q">×${L.qty}<small>${peso(L.total)}</small></div>
      </div>`).join('') || '<div class="note">No items recorded.</div>'}
    </section>`;
  }

  function sideHtml(o, g, side, full) {
    const it = o.items[g.idx], v = viewOf(it, side), key = `${o.id}|${g.idx}|${side}`, pic = pictures.get(key);
    const inks = Studio.inksOf(v);
    const texts = v.texts.filter(t => t.text.trim());
    return `<div class="op-side">
      <div class="op-art" data-k="${esc(key)}">${pic ? `<img src="${pic.url}" alt="${esc(side)} design">` : '<span class="spinner" style="width:18px;height:18px;"></span>'}</div>
      <div class="op-side-t">
        <b>${esc(side)}</b>
        <small class="op-sz" data-k="${esc(key)}">${pic ? esc(pic.size) : ''}</small>
        ${inks.length || v.images.length ? `<small>Inks: ${inks.map(i => `${swatch(i.hex, i.hex)} ${esc(colourName(i.hex))}`).join(', ')}${v.images.length ? `${inks.length ? ' + ' : ''}full-colour picture` : ''}</small>` : ''}
        ${v.printWarnings.length ? `<small class="op-warn"><i class="bi bi-exclamation-triangle"></i> ${v.printWarnings.map(esc).join(' · ')}</small>` : ''}
        ${full ? texts.map(t => `<small>Text: "${esc(t.text.replace(/\n/g, ' / '))}" · ${esc(Studio.fontLabel(t.font))}${t.effect && t.effect !== 'none' ? ' · ' + esc(t.effect) : ''}</small>`).join('')
          + v.images.map((im, i) => { const u = safeUrl(im.url); return u ? `<small><a href="${u}" target="_blank" rel="noopener">Picture ${v.images.length > 1 ? i + 1 + ' ' : ''}original file</a></small>` : ''; }).join('') : ''}
      </div>
    </div>`;
  }

  function designsHtml(o, groups, opt) {
    const items = o.items || [];
    const cards = groups.map((g, k) => `<div class="op-dz">
        <div class="op-dz-hd"><span class="op-tick" aria-hidden="true"></span><b>Design ${k + 1}</b>
          <span class="op-on">Print <b>${g.qty} ${g.qty === 1 ? 'time' : 'times'}</b> · goes on ${esc(goesOn(items, g.items))}</span></div>
        ${g.sides.length ? `<div class="op-sides">${g.sides.map(s => sideHtml(o, g, s, opt.full)).join('')}</div>` : ''}
        ${g.text ? `<div class="op-note"><i class="bi bi-fonts"></i> Text: "${esc(g.text)}"</div>` : ''}
        <div class="op-btns no-print">
          ${g.sides.length ? `<button type="button" class="btn-grad" onclick="event.stopPropagation();OrderParts.download('${esc(o.id)}',${g.idx})"><i class="bi bi-download"></i> Download print files</button>` : ''}
          ${g.preview ? `<a class="btn-ghost" href="${g.preview}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><i class="bi bi-image"></i> See it on the shirt</a>` : ''}
        </div>
      </div>`).join('');
    const more = opt.full && groups.some(g => g.sides.length) ? `<details class="op-more no-print">
        <summary>More options</summary>
        <div class="op-more-b">
          <label>Resolution <select id="op-dpi"><option value="300">300 dpi (best)</option><option value="200">200 dpi</option><option value="150">150 dpi</option></select></label>
          <label><input type="checkbox" id="op-mirror"> Mirror the picture (for heat transfer paper)</label>
          <label><input type="checkbox" id="op-label" checked> Put the order number on PDF files</label>
          ${groups.filter(g => g.sides.length).map((g, k) => g.sides.map(s => `<div class="op-one">Design ${groups.indexOf(g) + 1} · ${esc(s)}
            <button type="button" class="btn-ghost" onclick="OrderParts.downloadSide('${esc(o.id)}',${g.idx},'${esc(s)}','png')">PNG</button>
            <button type="button" class="btn-ghost" onclick="OrderParts.downloadSide('${esc(o.id)}',${g.idx},'${esc(s)}','pdf')">PDF</button></div>`).join('')).join('')}
        </div></details>` : '';
    return `<section class="op-box op-d" aria-label="Designs to print">
      <h4><i class="bi bi-printer"></i> Designs to print <small>${groups.length ? groups.length + ' design' + (groups.length === 1 ? '' : 's') : ''}</small></h4>
      ${opt.request || ''}
      ${cards || '<div class="op-none">Nothing to print. This order has no custom designs.</div>'}
      ${more}
    </section>`;
  }

  /** The two boxes for an order. opt.full: the order's own page (more detail and options); opt.request: a note
   *  shown above the designs (the customer asked for a change). */
  function html(o, opt = {}) {
    orders[o.id] = o;
    const items = o.items || [];
    return `<div class="op${opt.full ? ' full' : ''}">${clothesHtml(o, clothes(items))}${designsHtml(o, designs(items), opt)}</div>`;
  }

  // ── Pictures and print files ─────────────────────────────────────────────────────────────────────
  let models = null;
  async function modelFor(it) {
    if (!models) { try { models = await loadModels(); } catch (e) { models = []; } }
    const c = it.customization || {};
    return productModel({ shirtStyle: c.shirtStyle, name: it.productName, category: it.category }, models)
      || models.find(m => m.id === guessShirtStyle(it.productName || '', '')) || null;
  }
  /** Draws every side picture still waiting on the page, with its print size. */
  async function drawPreviews() {
    for (const box of document.querySelectorAll('.op-art')) {
      const key = box.dataset.k;
      if (!pictures.has(key)) {
        const [id, idx, ...rest] = key.split('|'), side = rest.join('|'), o = orders[id], it = o && (o.items || [])[+idx];
        if (!it) continue;
        try {
          const art = modelSide(await modelFor(it), side), v = viewOf(it, side);
          const r = art ? { w: (art.zone.right - art.zone.left) * art.w, h: (art.zone.bottom - art.zone.top) * art.h } : (v.ref ? { w: v.ref.width, h: v.ref.height } : { w: 1, h: 1 });
          const k = 240 / Math.max(r.w, r.h), cv = await Studio.renderZone(v, r.w * k, r.h * k);
          pictures.set(key, { url: cv.toDataURL('image/png'), size: art && art.cm ? `${art.cm.toFixed(1)} × ${(art.cm * r.h / r.w).toFixed(1)} cm` : 'Print size not set' });
        } catch (e) { pictures.set(key, { url: '', size: '' }); }
      }
      const p = pictures.get(key);
      // The page may have been redrawn while this was being made: fill whichever boxes show it now
      document.querySelectorAll(`.op-art[data-k="${CSS.escape(key)}"]`).forEach(b => { b.innerHTML = p.url ? `<img src="${p.url}" alt="">` : '<i class="bi bi-image" title="Preview unavailable"></i>'; });
      document.querySelectorAll(`.op-sz[data-k="${CSS.escape(key)}"]`).forEach(s => { s.textContent = p.size; });
    }
  }

  const opts = () => ({
    dpi: +((document.getElementById('op-dpi') || {}).value || 300),
    mirror: !!(document.getElementById('op-mirror') || {}).checked,
    label: (document.getElementById('op-label') || { checked: true }).checked
  });
  async function printCanvas(o, idx, side, op) {
    const it = o.items[idx], v = viewOf(it, side), art = modelSide(await modelFor(it), side);
    let size;
    if (art) size = Studio.printPixels(art, op.dpi);
    else { const r = v.ref || { width: 1, height: 1 }; size = { w: 3000, h: Math.round(3000 * r.height / r.width), cmW: 0, cmH: 0, known: false }; }
    const cv = await Studio.renderZone(v, size.w, size.h, { mirror: op.mirror });
    return { cv, size, v };
  }
  function loadScript(src) {
    return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load " + src)); document.head.appendChild(s); });
  }
  const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  const toBlob = cv => new Promise((res, rej) => { try { cv.toBlob(b => b ? res(b) : rej(new Error('Empty picture')), 'image/png'); } catch (e) { rej(new Error("A picture in this design can't be copied into a file (its host doesn't allow it). Use “original file” on the order's page instead.")); } });
  function save(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
  const groupNo = (o, idx) => designs(o.items || []).findIndex(g => g.idx === idx) + 1;
  const fileBase = (o, idx, side) => `${orderNo(o.id)}_design${groupNo(o, idx)}_${side.replace(/\s+/g, '')}`;
  const pngName = (o, idx, side, size, op) => `${fileBase(o, idx, side)}_${size.known ? size.cmW.toFixed(1) + 'x' + size.cmH.toFixed(1) + 'cm_' : ''}${op.dpi}dpi${op.mirror ? '_mirrored' : ''}.png`;
  async function pdfOf(o, idx, side, op) {
    await loadScript(JSPDF);
    const { cv, size, v } = await printCanvas(o, idx, side, op);
    const wMm = size.known ? size.cmW * 10 : size.w / op.dpi * 25.4, hMm = size.known ? size.cmH * 10 : size.h / op.dpi * 25.4;
    const extra = op.label ? 14 : 0;
    const pdf = new window.jspdf.jsPDF({ orientation: wMm > hMm + extra ? 'l' : 'p', unit: 'mm', format: [wMm, hMm + extra], compress: true });
    pdf.addImage(cv.toDataURL('image/png'), 'PNG', 0, 0, wMm, hMm, undefined, 'FAST');
    if (op.label) {
      const inks = Studio.inksOf(v).map(i => colourName(i.hex) + ' ' + i.hex).join(', ');
      pdf.setFontSize(9);
      pdf.text(`${orderNo(o.id)} · design ${groupNo(o, idx)} · ${side} · ${(wMm / 10).toFixed(1)} × ${(hMm / 10).toFixed(1)} cm${op.mirror ? ' · MIRRORED' : ''}`, 4, hMm + 6);
      if (inks) pdf.text('Inks: ' + inks, 4, hMm + 11);
    }
    return { blob: pdf.output('blob'), failed: cv.failedImages || [] };
  }
  const doneToast = failed => toast(failed.length ? `Saved, but ${failed.length} picture(s) couldn't be included. Get them with “original file” on the order's page.` : 'Print files saved', failed.length ? 'warn' : 'ok');

  /** One side as PNG or PDF (More options on the order's page). */
  async function downloadSide(id, idx, side, kind) {
    const o = orders[id], op = opts(); if (!o) return;
    toast('Making the ' + side + ' print file…');
    try {
      if (kind === 'pdf') { const r = await pdfOf(o, idx, side, op); save(r.blob, fileBase(o, idx, side) + '.pdf'); doneToast(r.failed); }
      else { const { cv, size } = await printCanvas(o, idx, side, op); save(await toBlob(cv), pngName(o, idx, side, size, op)); doneToast(cv.failedImages || []); }
    } catch (e) { toast('Not made: ' + e.message, 'err'); }
  }
  /** Everything to print one design: a picture for a single side, else a ZIP of every side with a job note. */
  async function download(id, idx) {
    const o = orders[id]; if (!o) return;
    const op = opts(), items = o.items || [], it = items[idx], sides = sidesOf(it);
    if (!sides.length) return;
    if (sides.length === 1) return downloadSide(id, idx, sides[0], 'png');
    const g = designs(items).find(x => x.idx === idx) || { items: [idx], qty: +it.quantity || 1 };
    toast('Making print files for ' + sides.length + ' sides…');
    try {
      await loadScript(JSZIP);
      const zip = new JSZip(), failed = [];
      let note = `${orderNo(o.id)} · design ${groupNo(o, idx)}\nPrint ${g.qty} ${g.qty === 1 ? 'time' : 'times'}, on: ${goesOn(items, g.items)}\n`;
      for (const side of sides) {
        const { cv, size, v } = await printCanvas(o, idx, side, op);
        zip.file(pngName(o, idx, side, size, op), await toBlob(cv));
        note += `\n${side}: ${size.known ? size.cmW.toFixed(1) + ' × ' + size.cmH.toFixed(1) + ' cm' : size.w + ' × ' + size.h + ' px (print size not set)'}`;
        note += `\n  Inks: ${Studio.inksOf(v).map(i => colourName(i.hex) + ' ' + i.hex).join(', ') || '—'}${v.images.length ? ' + full-colour picture' : ''}`;
        if (v.printWarnings.length) note += `\n  Print check: ${v.printWarnings.join(' | ')}`;
        if ((cv.failedImages || []).length) { failed.push(...cv.failedImages); note += `\n  NOT INCLUDED (get it from the order's page): ${cv.failedImages.join(', ')}`; }
      }
      zip.file('job.txt', note + '\n');
      save(await zip.generateAsync({ type: 'blob' }), `${orderNo(o.id)}_design${groupNo(o, idx)}_print_files.zip`);
      doneToast(failed);
    } catch (e) { toast('Not made: ' + e.message, 'err'); }
  }

  return { html, drawPreviews, download, downloadSide, colourName, clothes, designs };
})();
