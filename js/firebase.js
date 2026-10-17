// =====================================================
//  KustomoImprenta Admin — Firebase Config & Helpers
//  Project: capstone-a1cf3 | K's Print Express, PH
// =====================================================

const firebaseConfig = {
  apiKey: "AIzaSyCkrFAjtiYBYdbtZJdBoFMLpVfSvKe-C_8",
  authDomain: "capstone-a1cf3.firebaseapp.com",
  projectId: "capstone-a1cf3",
  storageBucket: "capstone-a1cf3.firebasestorage.app",
  messagingSenderId: "244077835859",
  // ⚠️  Register a Web App in Firebase Console → Project Settings
  //     and paste the appId here, e.g.:
  //     appId: "1:244077835859:web:XXXXXXXXXXXXXXXX"
  appId: "1:244077835859:web:3a46ebef5e47ff959138a6"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// ── Enable Firestore offline persistence ──
db.enablePersistence({ synchronizeTabs: true }).catch(() => { });

// ─────────────────────────────────────────────
//  HELPER UTILITIES
// ─────────────────────────────────────────────

/** Show a toast notification */
function toast(msg, type = '') {
  const box = document.getElementById('toast-box');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 3400);
}

/** Format a Firestore Timestamp or JS Date */
function fmtDate(ts, withTime = true) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const date = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  if (!withTime) return date;
  const time = d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

/** Format Philippine Peso */
function peso(n) {
  return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Order number as the customer sees it in the app: "KI-" + the last 5 characters of the order id
 *  (same as displayOrderId in the app's Repositories.kt). */
function orderNo(id) {
  return 'KI-' + String(id || '').slice(-5).toUpperCase();
}

/** The category a product sits in: one from the Categories page when its `category` matches one (any case), else an
 *  older spelling read as the usual one ("T-Shirt" -> Tees, "Hoodie" -> Hoodies) when that one exists, else as typed. */
function productCategory(p) {
  const raw = String((p && p.category) || '').trim();
  if (!raw) return '';
  const list = _categoryList || [];
  const own = list.find(c => c.name.toLowerCase() === raw.toLowerCase());
  if (own) return own.name;
  const usual = /hood/i.test(raw) ? 'Hoodies' : /tee|shirt/i.test(raw) ? 'Tees' : '';
  if (usual && (!list.length || list.some(c => c.name === usual))) return usual;
  return raw;
}

/** Only http(s) links are shown as images or links (an address typed into a record can't run script). */
function safeUrl(u) { return (typeof u === 'string' && /^https?:\/\//i.test(u)) ? esc(u) : ''; }

/** Saves `rows` (arrays of cells) as a .csv file that Excel and Google Sheets open. */
function downloadCsv(filename, rows) {
  const cell = v => { const t = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const text = '\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Status badge HTML */
function statusBadge(s) {
  const key = (s || 'pending').toLowerCase().replace(/\s/g, '');
  const label = { pending: 'Pending', processing: 'Processing', printing: 'Printing', ready: 'Ready', delivered: 'Delivered', cancelled: 'Cancelled' };
  return `<span class="badge b-${key}">${label[key] || s}</span>`;
}

/** Escape HTML for safe rendering */
function esc(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Order status progression (Cancelled is set apart, see setOrderStatus) */
const STATUSES = ['Pending', 'Processing', 'Printing', 'Ready', 'Delivered'];
const ALL_STATUSES = STATUSES.concat(['Cancelled']);

/** What to ask before a status change that's easy to get wrong, or '' when no question is needed. */
function statusChangeQuestion(no, from, to) {
  from = from || 'Pending';
  if (from === to) return '';
  const label = s => s === 'Ready' ? 'Ready for pickup' : s;
  if (to === 'Cancelled') return `Cancel order ${no}? Any stock taken for it is put back. If the customer paid, refund them from the PayMongo dashboard.`;
  if (from === 'Cancelled') return `Order ${no} was cancelled. Open it again as "${label(to)}"? Its stock is taken off again.`;
  if (from === 'Delivered') return `Order ${no} was already delivered. Move it back to "${label(to)}"?`;
  if (STATUSES.indexOf(to) < STATUSES.indexOf(from)) return `Move order ${no} back from "${label(from)}" to "${label(to)}"?`;
  return '';
}

/** Records (or undoes) that the rest of a downpayment order was collected on delivery or pickup. */
async function setBalanceCollected(orderId, collected) {
  const who = (auth.currentUser && auth.currentUser.email) || '';
  await db.collection('orders').doc(orderId).update(collected
    ? { balancePaidAt: firebase.firestore.FieldValue.serverTimestamp(), balancePaidBy: who }
    : { balancePaidAt: firebase.firestore.FieldValue.delete(), balancePaidBy: firebase.firestore.FieldValue.delete() });
}

/** Moves an order to `status`: records who changed it and when (statusHistory, shown on the order page), then takes
 *  its stock off if it is still on, or puts it back when it is cancelled. Throws when the status can't be saved. */
async function setOrderStatus(orderId, status) {
  const who = (auth.currentUser && auth.currentUser.email) || '';
  await db.collection('orders').doc(orderId).update({
    status,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    statusHistory: firebase.firestore.FieldValue.arrayUnion({ status, at: firebase.firestore.Timestamp.now(), by: who })
  });
  if (status === 'Cancelled') await restockIfCancelled(orderId);
  else await deductStockIfAccepted(orderId, status);
}

// ─────────────────────────────────────────────
//  SHIRT STYLES
//  The cuts the app can show in its AR try-on Lens and 3D preview. `id` is what a product's `shirtStyle`
//  field holds; it must match ShirtStyle.lensName in the Android app (ShirtStyles.kt) and the shirt's
//  name in the FitFusionShirts Lens.
// ─────────────────────────────────────────────
const SHIRT_STYLES = [
  { id: 'MaleClassicShirt',   label: "Men's Classic",   suggestedName: "Men's Classic Tee",
    description: 'Crew-neck tee in a regular fit. Add your own design to the front and back.' },
  { id: 'MaleVNeckShirt',     label: "Men's V-Neck",    suggestedName: "Men's V-Neck Tee",
    description: 'V-neck tee in a regular fit. Add your own design to the front and back.' },
  { id: 'FemaleClassicShirt', label: "Women's Classic", suggestedName: "Women's Classic Tee",
    description: 'Scoop-neck tee in a shaped fit. Add your own design to the front and back.' },
  { id: 'FemaleVNeckShirt',   label: "Women's V-Neck",  suggestedName: "Women's V-Neck Tee",
    description: 'V-neck tee in a shaped fit. Add your own design to the front and back.' },
  { id: 'LongSleeveShirt',    label: 'Long Sleeve',     suggestedName: 'Long Sleeve Tee',
    description: 'Unisex crew-neck tee with long sleeves. Add your own design to the front and back.' }
];

/** Label of a shirt style id, or '' when the id is blank or unknown. */
function shirtStyleLabel(id) {
  const s = SHIRT_STYLES.find(x => x.id === id);
  return s ? s.label : '';
}

/** The style the app assumes for a product with no shirtStyle set: read off its name and category
 *  (same rules as ShirtStyle.guess in the app). */
function guessShirtStyle(name, category) {
  const text = `${name || ''} ${category || ''}`;
  const vNeck = /\bv[\s-]?neck/i.test(text);
  if (/\blong[\s-]?sleeves?/i.test(text)) return 'LongSleeveShirt';
  if (/\b(women|woman|ladies|lady|female|girls?)\b/i.test(text)) return vNeck ? 'FemaleVNeckShirt' : 'FemaleClassicShirt';
  return vNeck ? 'MaleVNeckShirt' : 'MaleClassicShirt';
}

/** The style a product shows as in the app: its own shirtStyle, else the guess. */
function productShirtStyle(p) {
  return shirtStyleLabel(p.shirtStyle) ? p.shirtStyle : guessShirtStyle(p.name, p.category);
}

// ─────────────────────────────────────────────
//  MODEL CATALOG
//  Everything a customer can try on and design: the five built-in shirts plus any model added on the Models page
//  (a cap, glasses, a tote…). A product points at one with its `shirtStyle` field (the model's id). The app reads
//  the same list (ModelCatalog.kt) and the try-on Lens gets the model through launch params.
//
//  Firestore models/{id}:
//    label, blurb, kind ('top' | 'headwear' | 'eyewear' | 'neckwear' | 'accessory'), enabled, order
//    wornOn       where the try-on Lens attaches it: 'body' (built-in shirts only), 'head', 'neck', 'chest',
//                 'hips', 'leftWrist', 'rightWrist'
//    modelUrl     the .glb (metres, Y up, front facing +Z); modelFile {name, bytes, triangles, printFront, printBack}
//    thumbUrl     picture for the shop's style tiles
//    front / back {img, w, h, zone:{left, top, right, bottom}}: the 2D designer's picture of that side and where the
//                 print goes on it (fractions of the picture). No `back` = the design is front only.
//    tintable     whether the customer's colour is applied to the model
//    preview      {scale}: size in the app's 3D view (1 = fills the view like the shirts)
//    ar           {scale, x, y, z (cm), rotX, rotY, rotZ (degrees), roughness}: fit in the try-on Lens
//    lensObjectName  optional: the model is also built into the Lens under this object name (fitted garments)
//  For a built-in shirt the document id is its style id, and only label, blurb, enabled, order and ar.roughness
//  are read; its model and pictures are built into the app.
//  models/_tryOn {lensSupportsModels}: set on the Models page once the try-on Lens that downloads models is
//  published; until then the app keeps AR try-on off for added models (ids never start with "_").
// ─────────────────────────────────────────────

/** Each built-in cut's front/back picture and where its print area is in it (fractions: left, top, right, bottom):
 *  nearly the whole front and back. The same pictures and numbers as the app's 2D editor (styleArt in CustomizerScreen.kt). */
const BUILTIN_ART = {
  MaleClassicShirt:   { Front: { img: 'img/shirt_art_male_classic_front.png', zone: [0.3158, 0.1973, 0.684, 0.8671], w: 782, h: 760 },
                        Back:  { img: 'img/shirt_art_male_classic_back.png',  zone: [0.316, 0.1467, 0.6842, 0.905], w: 782, h: 760 } },
  MaleVNeckShirt:     { Front: { img: 'img/shirt_art_male_vneck_front.png',   zone: [0.3158, 0.2794, 0.684, 0.8671], w: 782, h: 760 },
                        Back:  { img: 'img/shirt_art_male_vneck_back.png',    zone: [0.316, 0.1467, 0.6842, 0.905], w: 782, h: 760 } },
  FemaleClassicShirt: { Front: { img: 'img/shirt_art_female_classic_front.png', zone: [0.3049, 0.2344, 0.6973, 0.8583], w: 712, h: 760 },
                        Back:  { img: 'img/shirt_art_female_classic_back.png',  zone: [0.3027, 0.149, 0.6951, 0.9042], w: 712, h: 760 } },
  FemaleVNeckShirt:   { Front: { img: 'img/shirt_art_female_vneck_front.png', zone: [0.3049, 0.3067, 0.6973, 0.8583], w: 712, h: 760 },
                        Back:  { img: 'img/shirt_art_female_vneck_back.png',  zone: [0.3027, 0.149, 0.6951, 0.9042], w: 712, h: 760 } },
  LongSleeveShirt:    { Front: { img: 'img/shirt_art_long_sleeve_front.png', zone: [0.369, 0.197, 0.6318, 0.8673], w: 1097, h: 760 },
                        Back:  { img: 'img/shirt_art_long_sleeve_back.png',  zone: [0.3682, 0.1464, 0.631, 0.9051], w: 1097, h: 760 } }
};

const MODEL_KINDS = [
  { id: 'top',       label: 'Top (shirt, jacket)', category: 'Tees' },
  { id: 'headwear',  label: 'Headwear (cap, hat)', category: 'Headwear' },
  { id: 'eyewear',   label: 'Eyewear (glasses)',   category: 'Accessories' },
  { id: 'neckwear',  label: 'Neckwear (necklace, scarf)', category: 'Accessories' },
  { id: 'accessory', label: 'Other accessory (bag, watch)', category: 'Accessories' }
];

/** Where the try-on Lens can attach a model, and the fit it starts with (cm / degrees, before the admin adjusts). */
const WORN_ON = [
  { id: 'head',       label: 'Head (caps, hats, glasses)', start: { y: 4.5 } },
  { id: 'neck',       label: 'Neck (necklaces, scarves)',  start: {} },
  { id: 'chest',      label: 'Chest (bags, badges, vests)', start: { z: 6 } },
  { id: 'hips',       label: 'Hips (belts, waist bags)',   start: {} },
  { id: 'leftWrist',  label: 'Left wrist (watches)',       start: {} },
  { id: 'rightWrist', label: 'Right wrist (watches)',      start: {} }
];
const AR_DEFAULT = { scale: 1, x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0, roughness: 0.9 };

/** Default AR fit for a new model worn on `wornOn` (glasses sit in front of the eyes, not on top of the head). */
function startFit(wornOn, kind) {
  const w = WORN_ON.find(x => x.id === wornOn) || WORN_ON[0];
  const start = kind === 'eyewear' ? { y: 3, z: 9 } : w.start;
  return Object.assign({}, AR_DEFAULT, start);
}

/** A built-in shirt as a catalog entry (before any saved override). */
function builtInModel(style, i) {
  const art = BUILTIN_ART[style.id];
  const side = a => ({ img: a.img, w: a.w, h: a.h, zone: { left: a.zone[0], top: a.zone[1], right: a.zone[2], bottom: a.zone[3] } });
  return {
    id: style.id, builtIn: true, label: style.label, blurb: style.description, kind: 'top', wornOn: 'body',
    enabled: true, order: i, modelUrl: '', modelFile: null, thumbUrl: art.Front.img,
    front: side(art.Front), back: side(art.Back), tintable: true, preview: { scale: 1 },
    ar: Object.assign({}, AR_DEFAULT), lensObjectName: style.id, hasSleeves: true
  };
}

/** A models/{id} document as a catalog entry, filling in anything missing. */
function normalizeModel(id, d) {
  const zone = z => ({ left: +(z && z.left) || 0.3, top: +(z && z.top) || 0.3, right: +(z && z.right) || 0.7, bottom: +(z && z.bottom) || 0.7 });
  const side = s => (s && s.img) ? { img: s.img, w: +s.w || 1000, h: +s.h || 1000, zone: zone(s.zone), fromModel: s.fromModel !== false } : null;
  return {
    id, builtIn: false, label: d.label || id, blurb: d.blurb || '', kind: d.kind || 'accessory',
    wornOn: d.wornOn || 'head', enabled: d.enabled !== false, order: typeof d.order === 'number' ? d.order : 100,
    modelUrl: d.modelUrl || '', modelFile: d.modelFile || null, thumbUrl: d.thumbUrl || (d.front && d.front.img) || '',
    front: side(d.front), back: side(d.back), tintable: d.tintable !== false,
    preview: { scale: +(d.preview && d.preview.scale) || 1 },
    ar: Object.assign({}, AR_DEFAULT, d.ar || {}), lensObjectName: d.lensObjectName || '', hasSleeves: false,
    updatedAt: d.updatedAt || null, updatedBy: d.updatedBy || ''
  };
}

let _models = null, _modelsError = '';
/** The whole catalog, built-ins first then by `order`. Built-ins work even when models/ can't be read
 *  (modelsError() then says why). Pass force=true to read Firestore again. */
function loadModels(force) {
  if (!_models || force) {
    _models = db.collection('models').get().then(snap => {
      _modelsError = '';
      return mergeModels(snap.docs.map(d => ({ id: d.id, data: d.data() })));
    }).catch(e => {
      _modelsError = (e && e.code === 'permission-denied') ? 'permission-denied' : ((e && e.message) || String(e));
      return mergeModels([]);
    });
  }
  return _models;
}
function modelsError() { return _modelsError; }
/** The try-on settings read with the catalog (models/_tryOn). */
function tryOnSettings() { return _tryOn; }

let _tryOn = { lensSupportsModels: false };
function mergeModels(docs) {
  const byId = {};
  docs.forEach(x => { byId[x.id] = x.data; });
  _tryOn = Object.assign({ lensSupportsModels: false }, byId._tryOn || {});
  docs = docs.filter(x => !x.id.startsWith('_'));
  const builtIns = SHIRT_STYLES.map((s, i) => {
    const m = builtInModel(s, i), o = byId[s.id];
    if (o) {
      if (o.label) m.label = o.label;
      if (o.blurb) m.blurb = o.blurb;
      if (o.enabled === false) m.enabled = false;
      if (typeof o.order === 'number') m.order = o.order;
      if (o.ar && typeof o.ar.roughness === 'number') m.ar.roughness = o.ar.roughness;
      m.overridden = true; m.updatedAt = o.updatedAt || null; m.updatedBy = o.updatedBy || '';
    }
    return m;
  });
  const custom = docs.filter(x => !BUILTIN_ART[x.id]).map(x => normalizeModel(x.id, x.data));
  return builtIns.concat(custom).sort((a, b) => (a.order - b.order) || a.label.localeCompare(b.label));
}

/** The catalog entry a product shows as: its own `shirtStyle` when that is a known model, else a guessed shirt cut
 *  for shirts, else null (a product with no model, like a mug). */
function productModel(p, models) {
  const own = models.find(m => m.id === p.shirtStyle);
  if (own) return own;
  // Same test as ShirtStyle.looksLikeShirt in the app: a shirt word in the name or the category
  const shirtWords = /shirt|\btees?\b|sleeve|\bv[\s-]?neck/i;
  if (shirtWords.test(p.name || '') || shirtWords.test(p.category || '')) {
    return models.find(m => m.id === guessShirtStyle(p.name, p.category)) || null;
  }
  return null;
}

// ─────────────────────────────────────────────
//  STOCK
//  A product's `inventory` holds how many of each size are in storage ({S: 4, M: 12}); a product without it is
//  made to order and never counted. The app can't change products (customers have no write access to them), so
//  stock comes off here: every admin page watches for new orders (js/layout.js → deductNewOrders) and takes their
//  items off as soon as they arrive. An order that still has its stock on when its status is changed is counted
//  then. The order is marked `stockDeducted` so it never happens twice; cancelling puts the stock back.
// ─────────────────────────────────────────────

/** Adds `delta` pieces (negative to remove) to one size in storage. An increment, so it can't undo an order that
 *  comes in at the same moment. */
async function changeStock(productId, size, delta) {
  await db.collection('products').doc(productId).update({ ['inventory.' + size]: firebase.firestore.FieldValue.increment(delta) });
}
/** Sets one size's count outright, after counting what is on the shelf. */
async function setStockCount(productId, size, n) {
  await db.collection('products').doc(productId).update({ ['inventory.' + size]: Math.max(0, Math.round(n)) });
}
/** Whether the product's stock is counted (it has an `inventory`); the others are made to order. */
function tracksStock(p) { return !!(p && p.inventory && typeof p.inventory === 'object'); }
/** How many of `size` are in storage (never below 0), or null for a made-to-order product. */
function stockOf(p, size) {
  if (!tracksStock(p)) return null;
  const n = Number(p.inventory[size]);
  return isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Takes stock off for new orders the moment they arrive: called with the "Pending" orders by every admin page
 *  that is open (js/layout.js). Each order is counted once, even with several pages open, because
 *  deductStockForOrder checks the order's `stockDeducted` mark inside a transaction. An order whose stock was put
 *  back (cancelled, or cleared by Clean Up) is left to the status change that reopens it. */
const _stockTried = new Set();
async function deductNewOrders(docs) {
  for (const d of docs) {
    const o = d.data() || {};
    if (o.stockDeducted || o.stockRestoredAt || (o.status || 'Pending') !== 'Pending' || _stockTried.has(d.id)) continue;
    _stockTried.add(d.id);
    try {
      const r = await deductStockForOrder(d.id);
      if (!r.done) continue;
      if (r.short.length) toast(`New order ${orderNo(d.id)}: not enough in storage for ${r.short.join('; ')}`, 'warn');
      else if (r.lines.length) toast(`New order ${orderNo(d.id)}: taken from storage (${r.lines.join('; ')})`, 'ok');
    } catch (e) {
      console.warn('Stock for order', d.id, e);
      _stockTried.delete(d.id);           // tried again the next time the orders change
    }
  }
}

/** Takes an order's items off their products' stock. Returns what happened, for a toast:
 *  {done:false} when it was already taken off, else {done:true, lines:[…], short:[…]} */
async function deductStockForOrder(orderId) {
  const orderRef = db.collection('orders').doc(orderId);
  return db.runTransaction(async tx => {
    const snap = await tx.get(orderRef);
    const order = snap.data();
    if (!order || order.stockDeducted) return { done: false };

    // Add up what the order takes, per product and size
    const wanted = {};
    (order.items || []).forEach(it => {
      if (!it.productId || !it.size) return;
      const q = Number(it.quantity) || 0;
      wanted[it.productId] = wanted[it.productId] || { name: it.productName || 'Product', sizes: {} };
      wanted[it.productId].sizes[it.size] = (wanted[it.productId].sizes[it.size] || 0) + q;
    });

    // All reads before any write, as transactions require
    const ids = Object.keys(wanted);
    const prods = await Promise.all(ids.map(id => tx.get(db.collection('products').doc(id))));
    const lines = [], short = [];
    prods.forEach((p, i) => {
      const inv = p.exists ? p.data().inventory : null;
      if (!inv || typeof inv !== 'object') return;            // made to order, or product since deleted
      const change = {};
      Object.keys(wanted[ids[i]].sizes).forEach(size => {
        if (typeof inv[size] !== 'number') return;
        const take = wanted[ids[i]].sizes[size];
        const left = Math.max(0, inv[size] - take);
        if (take > inv[size]) short.push(`${wanted[ids[i]].name} ${size}: needed ${take}, had ${inv[size]}`);
        change['inventory.' + size] = left;
        lines.push(`${wanted[ids[i]].name} ${size}: ${inv[size]} → ${left}`);
      });
      if (Object.keys(change).length) tx.update(p.ref, change);
    });
    tx.update(orderRef, { stockDeducted: true, stockDeductedAt: firebase.firestore.FieldValue.serverTimestamp() });
    return { done: true, lines, short };
  });
}

/** Puts a cancelled order's items back into stock, once, if they were taken off. Never throws. */
async function restockIfCancelled(orderId) {
  try {
    const orderRef = db.collection('orders').doc(orderId);
    const r = await db.runTransaction(async tx => {
      const snap = await tx.get(orderRef);
      const order = snap.data();
      if (!order || !order.stockDeducted) return { done: false };
      const back = {};
      (order.items || []).forEach(it => {
        if (!it.productId || !it.size) return;
        back[it.productId] = back[it.productId] || { name: it.productName || 'Product', sizes: {} };
        back[it.productId].sizes[it.size] = (back[it.productId].sizes[it.size] || 0) + (Number(it.quantity) || 0);
      });
      const ids = Object.keys(back);
      const prods = await Promise.all(ids.map(id => tx.get(db.collection('products').doc(id))));
      const lines = [];
      prods.forEach((p, i) => {
        const inv = p.exists ? p.data().inventory : null;
        if (!inv || typeof inv !== 'object') return;
        const change = {};
        Object.keys(back[ids[i]].sizes).forEach(size => {
          if (typeof inv[size] !== 'number') return;
          change['inventory.' + size] = inv[size] + back[ids[i]].sizes[size];
          lines.push(`${back[ids[i]].name} ${size}: ${inv[size]} → ${inv[size] + back[ids[i]].sizes[size]}`);
        });
        if (Object.keys(change).length) tx.update(p.ref, change);
      });
      tx.update(orderRef, { stockDeducted: false, stockRestoredAt: firebase.firestore.FieldValue.serverTimestamp() });
      return { done: true, lines };
    });
    if (r.done && r.lines.length) toast('Stock put back: ' + r.lines.join('; '), 'ok');
  } catch (e) {
    toast('Cancelled, but stock was not put back: ' + e.message, 'err');
  }
}

/** Call after an order's status is saved: takes its stock off if that hasn't happened yet (an order reopened after
 *  being cancelled, or one that arrived while no admin page was open). Never throws. */
async function deductStockIfAccepted(orderId, newStatus) {
  if (newStatus === 'Cancelled') return;
  try {
    const r = await deductStockForOrder(orderId);
    if (!r.done) return;
    if (r.short.length) toast('Not enough stock for: ' + r.short.join('; '), 'warn');
    else if (r.lines.length) toast('Stock updated: ' + r.lines.join('; '), 'ok');
  } catch (e) {
    toast('Status saved, but stock was not updated: ' + e.message, 'err');
  }
}

// ─────────────────────────────────────────────
//  IMAGE UPLOADS (Design Studio)
//  The same Cloudinary cloud and unsigned upload preset the app uses. An unsigned preset is made to be used from
//  a page like this one; it can only add images, never read or delete them. CLOUDINARY below is the built-in
//  account (the app's local.properties); the shop's own one, saved on the App Keys page, is used instead when set.
// ─────────────────────────────────────────────
const CLOUDINARY = { cloudName: "owzl10lx", uploadPreset: "Kustomo", folder: 'kustomoimprenta/designs' };

/** The keys saved on the App Keys page (Firestore appConfig/keys), read once per page; {} when none or unreadable.
 *  Pass force=true after saving to read them again. */
let _appKeys = null;
function loadAppKeys(force) {
  if (!_appKeys || force) {
    _appKeys = db.collection('appConfig').doc('keys').get().then(s => (s.exists ? s.data() : {})).catch(() => ({}));
  }
  return _appKeys;
}

/** The Cloudinary account to upload to: the shop's own from the App Keys page, else the built-in one. */
async function cloudinaryConfig() {
  const k = await loadAppKeys();
  return k.cloudinaryCloudName && k.cloudinaryUploadPreset
    ? { cloudName: k.cloudinaryCloudName, uploadPreset: k.cloudinaryUploadPreset, folder: CLOUDINARY.folder }
    : CLOUDINARY;
}

/** Uploads an image file and resolves to its public https URL. Also adds it to this month's usage counts. */
async function uploadDesignImage(file) {
  return uploadToCloudinary(file, {});
}

/** Uploads any file (image, or a .glb model with resourceType 'auto') to `folder` and resolves to its https URL. */
async function uploadToCloudinary(file, { folder, resourceType = 'image', name } = {}) {
  const cfg = await cloudinaryConfig();
  const body = new FormData();
  body.append('file', file, name || file.name || 'upload');
  body.append('upload_preset', cfg.uploadPreset);
  body.append('folder', folder || cfg.folder);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/${resourceType}/upload`, { method: 'POST', body });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || !json.secure_url) throw new Error((json && json.error && json.error.message) || 'HTTP ' + res.status);
  // Counted on the admin's own account record, where the Usage page adds it up with the customers'
  try {
    const d = new Date(), month = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const inc = firebase.firestore.FieldValue.increment;
    await db.collection('users').doc(auth.currentUser.uid).set(
      { usage: { [month]: { cloudinaryUploads: inc(1), cloudinaryBytes: inc(json.bytes || file.size || 0) } } }, { merge: true });
  } catch (e) { /* an estimate only */ }
  return json.secure_url;
}

// ─────────────────────────────────────────────
//  CATEGORIES
//  The shop's shelves, managed on the Categories page. Firestore categories/{id}:
//    name       what products store in their `category` field and the app shows as a filter
//    order      position (lowest first)
//    showInApp  false keeps it off the app's filters (its products still show under "All")
//    description optional note for staff
//  The app reads the same list (CategoryRepository in Repositories.kt). Without the Firestore rule the app keeps
//  its old filters (taken from the products).
// ─────────────────────────────────────────────
const STARTER_CATEGORIES = ['Tees', 'Hoodies', 'Headwear', 'Accessories'];
const CATEGORY_RULE = `    // Categories page: app users read, shop staff change
    match /categories/{id} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && get(
        /databases/$(database)/documents/users/$(request.auth.uid)
      ).data.role in ['admin', 'super_admin'];
    }`;

let _categoryList = null, _categories = null, _categoriesError = '';
/** The managed categories in order: [{id, name, order, showInApp, description}]; [] when none or unreadable
 *  (categoriesError() then says why). Pass force=true to read Firestore again. */
function loadCategories(force) {
  if (!_categories || force) {
    _categories = db.collection('categories').get().then(snap => {
      _categoriesError = '';
      _categoryList = snap.docs.map(d => normalizeCategory(d.id, d.data())).filter(c => c.name)
        .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));
      return _categoryList;
    }).catch(e => {
      _categoriesError = (e && e.code === 'permission-denied') ? 'permission-denied' : ((e && e.message) || String(e));
      _categoryList = [];
      return _categoryList;
    });
  }
  return _categories;
}
function categoriesError() { return _categoriesError; }
function normalizeCategory(id, d) {
  return { id, name: String(d.name || '').trim(), order: typeof d.order === 'number' ? d.order : 100,
    showInApp: d.showInApp !== false, description: d.description || '', updatedAt: d.updatedAt || null, updatedBy: d.updatedBy || '' };
}
/** Document id for a new category name. */
function categoryId(name) {
  return String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'category';
}
/** Every category to offer in a picker: the managed ones in order, then any other one products still use. */
function categoryChoices(products) {
  const names = (_categoryList || []).map(c => c.name);
  const extra = [...new Set((products || []).map(productCategory).filter(n => n && !names.includes(n)))].sort();
  const base = names.length ? names : STARTER_CATEGORIES.concat(['Other']);
  return base.concat(extra.filter(n => !base.includes(n)));
}

// ─────────────────────────────────────────────
//  SHOP SETTINGS
//  Prices and rules the app's checkout uses, set on the Shop Settings page (Firestore appConfig/shop, which a
//  Super Admin changes and app users read; ShopSettings in the app's AppKeys.kt). A missing value = the default.
// ─────────────────────────────────────────────
const SHOP_DEFAULTS = {
  shippingFee: 99,            // ₱ per order
  freeShippingMin: 1500,      // ₱ subtotal for free shipping; 0 = never free
  downpaymentEnabled: true,   // offer paying part now, the rest on delivery
  downpaymentPercent: 50,     // % paid now
  downpaymentMinItems: 10,    // items in the cart before it is offered
  lowStockAt: 5               // admin site: a size at or below this is "low"
};
let _shop = null;
function loadShopSettings(force) {
  if (!_shop || force) {
    _shop = db.collection('appConfig').doc('shop').get()
      .then(s => Object.assign({}, SHOP_DEFAULTS, s.exists ? s.data() : {}))
      .catch(() => Object.assign({}, SHOP_DEFAULTS));
  }
  return _shop;
}

// ─────────────────────────────────────────────
//  CHATS (Messages page and the order page)
// ─────────────────────────────────────────────
const _marking = {};
/** Records that staff have seen a conversation (chats/{id}.adminReadAt), which clears its unread mark. */
function markChatRead(chatId) {
  if (!chatId || document.hidden || _marking[chatId]) return;
  _marking[chatId] = true;
  db.collection('chats').doc(chatId).update({ adminReadAt: firebase.firestore.FieldValue.serverTimestamp() })
    .catch(() => {}).finally(() => { delete _marking[chatId]; });
}

/** Replies staff send often; tapping one puts it in the message box to edit before sending. */
const QUICK_REPLIES = [
  'Thank you for your order! We are checking your design now.',
  'Your order is now being printed.',
  'Your order is ready for pickup.',
  'Your order is on its way.',
  'Could you send a clearer copy of your image or logo?'
];
function renderQuickReplies(boxId, inputId) {
  const box = document.getElementById(boxId);
  if (!box) return;
  box.innerHTML = QUICK_REPLIES.map((t, i) => `<button type="button" data-i="${i}" title="${esc(t)}">${esc(t.length > 34 ? t.slice(0, 32) + '…' : t)}</button>`).join('');
  box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    inp.value = QUICK_REPLIES[+b.dataset.i];
    inp.focus();
  }));
}

/** Approves or rejects a design the customer submitted, and tells them in the chat (with the reason, if given). */
async function reviewDesign(chatId, msgId, approved, staffUid) {
  let reason = '';
  if (!approved) {
    const r = prompt('What should the customer change? (optional, sent in the chat)', '');
    if (r === null) return;             // cancelled
    reason = r.trim();
  }
  const ts = firebase.firestore.FieldValue.serverTimestamp(), chat = db.collection('chats').doc(chatId);
  await chat.collection('messages').doc(msgId).update({
    approvalStatus: approved ? 'Approved' : 'Rejected', reviewedAt: ts,
    reviewedBy: (auth.currentUser && auth.currentUser.email) || '', rejectReason: reason
  });
  await chat.collection('messages').add({
    senderId: staffUid, senderRole: 'admin', sentAt: ts,
    messageText: approved
      ? '✅ Your design has been approved! We will begin printing shortly.'
      : '❌ Your design needs changes' + (reason ? ': ' + reason : '. Please resubmit with the required changes.')
  });
  await chat.update({ lastMessageAt: ts, adminReadAt: ts }).catch(() => {});
  toast(`Design ${approved ? 'approved' : 'rejected'}`, approved ? 'ok' : 'warn');
}
