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
  const label = { pending: 'Pending', processing: 'Processing', printing: 'Printing', ready: 'Ready', delivering: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' };
  return `<span class="badge b-${key}">${label[key] || s}</span>`;
}

/** Escape HTML for safe rendering. Anything can come in (an order's size or zip code may be saved as a number), so it
 *  is turned into text first; nothing (null / undefined) is shown as nothing. */
function esc(str) {
  return (str == null ? '' : String(str)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Order status progression (Cancelled is set apart, see setOrderStatus) */
// "Delivering" (shown as "Out for delivery") is set by choosing who drives the order (assignDriver)
const STATUSES = ['Pending', 'Processing', 'Printing', 'Ready', 'Delivering', 'Delivered'];
const ALL_STATUSES = STATUSES.concat(['Cancelled']);
/** How a status reads on screen. */
function statusLabel(s) { return s === 'Ready' ? 'Ready for pickup' : s === 'Delivering' ? 'Out for delivery' : (s || 'Pending'); }
/** Icon of a status, for the status buttons. */
const STATUS_ICONS = { Pending: 'bi-hourglass-split', Processing: 'bi-gear', Printing: 'bi-printer', Ready: 'bi-box-seam', Delivering: 'bi-truck', Delivered: 'bi-check-circle', Cancelled: 'bi-x-circle' };

/** What to ask before a status change that's easy to get wrong, or '' when no question is needed. */
function statusChangeQuestion(no, from, to) {
  from = from || 'Pending';
  if (from === to) return '';
  const label = statusLabel;
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
//  EMPLOYEES AND DRIVERS
//  employees/{id}: { name, phone } — the shop's people who deliver, kept on the Employees page. They have no account
//  or role on this site; they are only picked as an order's driver.
// ─────────────────────────────────────────────
/** Calls cb(list) now and whenever the employees change (sorted by name); cb(null, error) when they can't be read. */
function watchEmployees(cb) {
  return db.collection('employees').onSnapshot(
    s => cb(s.docs.map(d => ({ id: d.id, name: '', phone: '', ...d.data() })).filter(e => e.name).sort((a, b) => a.name.localeCompare(b.name))),
    e => cb(null, e));
}
/**
 * Sends the order out with [emp] as its driver: saves the driver, sets "Out for delivery", and (unless tell is false)
 * tells the customer in the order chat who is coming. emp: an employee, or {name, phone} typed in for someone else.
 */
async function assignDriver(orderId, emp, opts = {}) {
  const who = (auth.currentUser && auth.currentUser.email) || '';
  const driver = { name: String(emp.name || '').trim(), phone: String(emp.phone || '').trim(), vehicle: String(emp.vehicle || '').trim(),
    assignedAt: firebase.firestore.FieldValue.serverTimestamp(), assignedBy: who };
  if (emp.id) driver.employeeId = emp.id;
  if (!driver.name) throw new Error('Pick who is driving');
  await db.collection('orders').doc(orderId).update({ driver });
  if (opts.setStatus !== false) await setOrderStatus(orderId, 'Delivering');
  if (opts.tell === false) return;
  try {
    const snap = await db.collection('chats').where('orderId', '==', orderId).limit(1).get();
    if (snap.empty) return;
    const chat = snap.docs[0].ref, ts = firebase.firestore.FieldValue.serverTimestamp();
    await chat.collection('messages').add({ senderId: (auth.currentUser && auth.currentUser.uid) || '', senderRole: 'admin', sentAt: ts,
      messageText: `🚚 Your order ${orderNo(orderId)} is on its way! Your driver is ${driver.name}${driver.phone ? ' (' + prettyPhone(driver.phone) + ')' : ''}${driver.vehicle ? ', ' + driver.vehicle : ''}.` });
    await chat.update({ lastMessageAt: ts, adminReadAt: ts });
  } catch (e) { toast("The driver is saved, but the chat message wasn't sent: " + e.message, 'warn'); }
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
// The 2D pictures of each built-in cut, where the print goes on each (zone: left, top, right, bottom as shares of
// the picture) and how wide that print zone really is (cm). Same numbers as the app (CustomizerScreen.kt styleArt).
const BUILTIN_ART = {
  MaleClassicShirt:   { Front: { img: 'img/shirt_art_male_classic_front.png', zone: [0.2314, 0.078, 0.7684, 0.9054], w: 782, h: 760, cm: 43.75 },
                        Back:  { img: 'img/shirt_art_male_classic_back.png',  zone: [0.2381, 0.0545, 0.7621, 0.9328], w: 782, h: 760, cm: 42.69 },
                        'Left Sleeve':  { img: 'img/shirt_art_male_sleeve_left.png',  zone: [0.1091, 0.1227, 0.893, 0.836], w: 760, h: 547, cm: 27.1 },
                        'Right Sleeve': { img: 'img/shirt_art_male_sleeve_right.png', zone: [0.107, 0.1227, 0.8909, 0.836], w: 760, h: 547, cm: 27.1 } },
  MaleVNeckShirt:     { Front: { img: 'img/shirt_art_male_vneck_front.png',   zone: [0.2314, 0.0776, 0.7684, 0.9054], w: 782, h: 760, cm: 43.75 },
                        Back:  { img: 'img/shirt_art_male_vneck_back.png',    zone: [0.2381, 0.0545, 0.7621, 0.9328], w: 782, h: 760, cm: 42.69 },
                        'Left Sleeve':  { img: 'img/shirt_art_male_sleeve_left.png',  zone: [0.1091, 0.1227, 0.893, 0.836], w: 760, h: 547, cm: 27.1 },
                        'Right Sleeve': { img: 'img/shirt_art_male_sleeve_right.png', zone: [0.107, 0.1227, 0.8909, 0.836], w: 760, h: 547, cm: 27.1 } },
  FemaleClassicShirt: { Front: { img: 'img/shirt_art_female_classic_front.png', zone: [0.207, 0.0754, 0.7952, 0.9046], w: 712, h: 760, cm: 41.98 },
                        Back:  { img: 'img/shirt_art_female_classic_back.png',  zone: [0.2007, 0.0558, 0.7971, 0.9332], w: 712, h: 760, cm: 42.56 },
                        'Left Sleeve':  { img: 'img/shirt_art_female_sleeve_left.png',  zone: [0.0863, 0.1742, 0.9025, 0.7857], w: 760, h: 460, cm: 25.03 },
                        'Right Sleeve': { img: 'img/shirt_art_female_sleeve_right.png', zone: [0.0975, 0.1742, 0.9137, 0.7857], w: 760, h: 460, cm: 25.03 } },
  FemaleVNeckShirt:   { Front: { img: 'img/shirt_art_female_vneck_front.png', zone: [0.2069, 0.0754, 0.7953, 0.9045], w: 712, h: 760, cm: 41.98 },
                        Back:  { img: 'img/shirt_art_female_vneck_back.png',  zone: [0.2007, 0.0558, 0.7971, 0.9332], w: 712, h: 760, cm: 42.56 },
                        'Left Sleeve':  { img: 'img/shirt_art_female_sleeve_left.png',  zone: [0.0863, 0.1742, 0.9025, 0.7857], w: 760, h: 460, cm: 25.03 },
                        'Right Sleeve': { img: 'img/shirt_art_female_sleeve_right.png', zone: [0.0975, 0.1742, 0.9137, 0.7857], w: 760, h: 460, cm: 25.03 } },
  LongSleeveShirt:    { Front: { img: 'img/shirt_art_long_sleeve_front.png', zone: [0.309, 0.0751, 0.6918, 0.906], w: 1097, h: 760, cm: 43.71 },
                        Back:  { img: 'img/shirt_art_long_sleeve_back.png',  zone: [0.3122, 0.0537, 0.687, 0.9299], w: 1097, h: 760, cm: 42.8 },
                        'Left Sleeve':  { img: 'img/shirt_art_long_sleeve_sleeve_left.png',  zone: [0.1284, 0.0798, 0.872, 0.8994], w: 460, h: 760, cm: 24.2 },
                        'Right Sleeve': { img: 'img/shirt_art_long_sleeve_sleeve_right.png', zone: [0.128, 0.0798, 0.8716, 0.8994], w: 460, h: 760, cm: 24.2 } }
};

/** Every side a design can have, in the order the app shows them. */
const DESIGN_SIDES = ['Front', 'Back', 'Left Sleeve', 'Right Sleeve'];

/** A model's picture for a side ('Front', 'Back', 'Left Sleeve', 'Right Sleeve'), or null when it has none. */
function modelSide(model, side) {
  if (!model) return null;
  if (model.sides && model.sides[side]) return model.sides[side];
  if (side === 'Front') return model.front || null;
  if (side === 'Back') return model.back || null;
  return null;
}

const MODEL_KINDS = [
  { id: 'top',       label: 'Top (shirt, jacket)', category: 'Tees' },
  { id: 'headwear',  label: 'Headwear (cap, hat)', category: 'Headwear' },
  { id: 'eyewear',   label: 'Eyewear (glasses)',   category: 'Accessories' },
  { id: 'neckwear',  label: 'Neckwear (necklace, scarf)', category: 'Accessories' },
  { id: 'accessory', label: 'Other accessory (bag, watch)', category: 'Accessories' }
];

/** Where the try-on Lens can attach a model, and the fit it starts with (cm / degrees, before the admin adjusts). */
// `follow`: how it moves by default (FOLLOW_MODES). "Left" and "right" are the wearer's own.
const WORN_ON = [
  { id: 'head',          group: 'Head and body', label: 'Head (caps, hats, glasses)',              start: { y: 4.5 }, follow: 'body' },
  { id: 'neck',          group: 'Head and body', label: 'Neck (necklaces, scarves, lanyards)',     start: {},         follow: 'body' },
  { id: 'chest',         group: 'Head and body', label: 'Chest (badges, vests)',                   start: { z: 6 },   follow: 'body' },
  { id: 'back',          group: 'Head and body', label: 'Back (backpacks, capes)',                 start: { z: -12 }, follow: 'body' },
  { id: 'hips',          group: 'Head and body', label: 'Hips (belts, waist bags)',                start: {},         follow: 'body' },
  { id: 'leftShoulder',  group: 'Arms',          label: 'Left shoulder (shoulder bags, pads)',     start: {},         follow: 'body' },
  { id: 'rightShoulder', group: 'Arms',          label: 'Right shoulder (shoulder bags, pads)',    start: {},         follow: 'body' },
  { id: 'leftUpperArm',  group: 'Arms',          label: 'Left upper arm (armbands)',               start: {},         follow: 'limb' },
  { id: 'rightUpperArm', group: 'Arms',          label: 'Right upper arm (armbands)',              start: {},         follow: 'limb' },
  { id: 'leftForearm',   group: 'Arms',          label: 'Left forearm (arm sleeves, guards)',      start: {},         follow: 'limb' },
  { id: 'rightForearm',  group: 'Arms',          label: 'Right forearm (arm sleeves, guards)',     start: {},         follow: 'limb' },
  { id: 'leftWrist',     group: 'Arms',          label: 'Left wrist (watches, bracelets)',         start: {},         follow: 'limb' },
  { id: 'rightWrist',    group: 'Arms',          label: 'Right wrist (watches, bracelets)',        start: {},         follow: 'limb' },
  { id: 'leftHand',      group: 'Hands',         label: 'Left hand (held bags, flags, fans)',      start: {},         follow: 'hang' },
  { id: 'rightHand',     group: 'Hands',         label: 'Right hand (held bags, flags, fans)',     start: {},         follow: 'hang' },
  { id: 'leftKnee',      group: 'Legs',          label: 'Left knee (knee pads)',                   start: {},         follow: 'limb' },
  { id: 'rightKnee',     group: 'Legs',          label: 'Right knee (knee pads)',                  start: {},         follow: 'limb' },
  { id: 'leftFoot',      group: 'Legs',          label: 'Left foot (shoes, anklets)',              start: {},         follow: 'foot' },
  { id: 'rightFoot',     group: 'Legs',          label: 'Right foot (shoes, anklets)',             start: {},         follow: 'foot' }
];
/** How a model moves with the body part it's worn on. */
const FOLLOW_MODES = [
  { id: 'body', label: 'Turns with the body', hint: 'Stays on the point and faces the way the body faces. For caps, necklaces, belts, badges.' },
  { id: 'limb', label: 'Moves with the arm or leg', hint: "Turns and tilts with the arm or leg it's on. For watches, bracelets, armbands, knee pads." },
  { id: 'hang', label: 'Hangs straight down', hint: 'Follows the point but always hangs downward, like something held. For tote bags, flags, fans.' },
  { id: 'foot', label: 'Points where the foot points', hint: 'Follows the foot and turns with it. For shoes and anklets.' }
];
/** The model's movement: its own choice, else the default for where it's worn. */
function followOf(model) {
  const own = model && model.follow;
  if (FOLLOW_MODES.some(f => f.id === own)) return own;
  return (WORN_ON.find(w => w.id === (model && model.wornOn)) || WORN_ON[0]).follow;
}
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
  const side = a => ({ img: a.img, w: a.w, h: a.h, cm: a.cm || 0, zone: { left: a.zone[0], top: a.zone[1], right: a.zone[2], bottom: a.zone[3] } });
  const sides = {};
  DESIGN_SIDES.forEach(k => { if (art[k]) sides[k] = side(art[k]); });
  return {
    sides,
    id: style.id, builtIn: true, label: style.label, blurb: style.description, kind: 'top', wornOn: 'body',
    enabled: true, order: i, modelUrl: '', modelFile: null, thumbUrl: art.Front.img,
    front: side(art.Front), back: side(art.Back), tintable: true, preview: { scale: 1 },
    ar: Object.assign({}, AR_DEFAULT), lensObjectName: style.id, hasSleeves: true
  };
}

/** A models/{id} document as a catalog entry, filling in anything missing. */
function normalizeModel(id, d) {
  const zone = z => ({ left: +(z && z.left) || 0.3, top: +(z && z.top) || 0.3, right: +(z && z.right) || 0.7, bottom: +(z && z.bottom) || 0.7 });
  const side = s => (s && s.img) ? { img: s.img, w: +s.w || 1000, h: +s.h || 1000, cm: +s.cm || 0, zone: zone(s.zone), fromModel: s.fromModel !== false } : null;
  return {
    id, builtIn: false, label: d.label || id, blurb: d.blurb || '', kind: d.kind || 'accessory',
    wornOn: d.wornOn || 'head', follow: d.follow || '', enabled: d.enabled !== false, order: typeof d.order === 'number' ? d.order : 100,
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

/**
 * One chat message as HTML (order page and Messages). Customers' pictures show in the chat; there is nothing to
 * approve. kind "item": a card of an ordered item with its picture (sent by the app when the order is placed; older
 * orders sent "design submissions", shown the same way). kind "cancel" / "change": the customer asks to cancel the
 * order or change a design, answered with the buttons on the card (answerRequest).
 */
function chatMessageHtml(m, chatId) {
  const isA = m.senderRole === 'admin', t = m.sentAt ? fmtDate(m.sentAt) : '';
  const kind = m.kind || (m.isDesignSubmission ? 'item' : '');
  const img = safeUrl(m.imageUrl);
  const pic = img ? `<a class="cpic" href="${img}" target="_blank" rel="noopener" title="Open the full picture"><img src="${img}" alt="Picture sent in the chat" loading="lazy"></a>` : '';
  const text = m.messageText ? esc(m.messageText).replace(/\n/g, '<br>') : '';
  let body;
  if (kind === 'item' || kind === 'cancel' || kind === 'change') {
    const head = {
      item: ['bi-receipt', 'Ordered item', 'var(--orange)'],
      cancel: ['bi-x-octagon', 'Wants to cancel the order', '#FF6B6B'],
      change: ['bi-palette', 'Wants a design change', 'var(--yellow)']
    }[kind];
    let foot = '';
    if (kind !== 'item') {
      const st = m.requestStatus || 'Open', a = (d) => `answerRequest('${esc(chatId)}','${esc(m.id)}','${kind}','${d}')`;
      if (st === 'Open') foot = kind === 'cancel'
        ? `<div class="req-btns"><button class="btn-no" onclick="${a('Accepted')}"><i class="bi bi-x-circle"></i> Cancel the order</button><button class="btn-ghost" onclick="${a('Declined')}">Keep it</button></div>`
        : `<div class="req-btns"><button class="btn-ok" onclick="${a('Done')}"><i class="bi bi-check-lg"></i> Mark as changed</button><button class="btn-ghost" onclick="${a('Declined')}">Can't change it</button></div>`;
      else foot = `<div class="req-state">${st === 'Accepted' ? '<i class="bi bi-check-circle"></i> Order cancelled' : st === 'Done' ? '<i class="bi bi-check-circle"></i> Changed' : '<i class="bi bi-chat-left-text"></i> Answered in the chat'}${m.answeredBy ? ' · ' + esc(m.answeredBy) : ''}</div>`;
    }
    body = `<div class="req-box ${kind}"><div class="req-head" style="color:${head[2]};"><i class="bi ${head[0]}"></i> ${head[1]}</div>${pic}${text ? `<div class="req-text">${text}</div>` : ''}${foot}</div>`;
  } else {
    body = pic + (text ? `<div class="cbubble">${text}</div>` : '');
  }
  return `<div class="cmsg ${isA ? 'admin-msg' : 'user-msg'}"><div class="cavatar">${isA ? 'A' : 'C'}</div><div>${body}<div class="ctime">${t}</div></div></div>`;
}

/**
 * Answers a customer's request from the chat. Cancel: "Accepted" cancels the order (its stock goes back) and tells
 * the customer about the refund; "Declined" asks staff why and sends that. Change: "Done" after the design was
 * changed, "Declined" with a reason. The request's card shows the answer in the app too.
 */
async function answerRequest(chatId, msgId, kind, decision) {
  const chat = db.collection('chats').doc(chatId);
  const orderId = ((await chat.get()).data() || {}).orderId;
  let reply = '';
  if (kind === 'cancel' && decision === 'Accepted') {
    const o = orderId ? await db.collection('orders').doc(orderId).get() : null;
    const status = o && o.exists ? (o.data().status || 'Pending') : 'Pending';
    if (!confirm(statusChangeQuestion(orderNo(orderId || ''), status, 'Cancelled') || 'Cancel this order?')) return;
    if (orderId && status !== 'Cancelled') await setOrderStatus(orderId, 'Cancelled');
    reply = '✅ Your order has been cancelled. We will refund what you paid to your GCash; we will message you here once it is sent.';
  } else if (decision === 'Declined') {
    const r = prompt(kind === 'cancel' ? 'Why can\'t it be cancelled? (sent to the customer)' : 'Why can\'t the design be changed? (sent to the customer)', '');
    if (r === null) return;
    reply = (kind === 'cancel' ? 'We can\'t cancel this order' : 'We can\'t make that change') + (r.trim() ? ': ' + r.trim() : '.') + ' Message us here if you have questions.';
  } else if (decision === 'Done') {
    const r = prompt('Anything to tell the customer about the change? (optional)', '');
    if (r === null) return;
    reply = '✅ We have changed your design' + (r.trim() ? ': ' + r.trim() : '.');
  }
  const ts = firebase.firestore.FieldValue.serverTimestamp(), who = (auth.currentUser && auth.currentUser.email) || '';
  await chat.collection('messages').doc(msgId).update({ requestStatus: decision, answeredAt: ts, answeredBy: who });
  if (reply) await chat.collection('messages').add({ senderId: (auth.currentUser && auth.currentUser.uid) || '', senderRole: 'admin', messageText: reply, sentAt: ts });
  await chat.update({ lastMessageAt: ts, adminReadAt: ts, openRequest: firebase.firestore.FieldValue.delete() }).catch(() => {});
  toast(decision === 'Accepted' ? 'Order cancelled and the customer told' : 'Answer sent', 'ok');
  // The order page shows the new status straight away
  if (typeof refreshStatus === 'function') refreshStatus().catch(() => {});
}

/** A Philippine mobile number as people read it: +63 917 123 4567 (the app saves +639171234567; older orders 0917…). */
function prettyPhone(p) {
  const d = String(p || '').replace(/\D/g, ''), n = d.startsWith('63') && d.length === 12 ? d.slice(2) : d.startsWith('0') && d.length === 11 ? d.slice(1) : d;
  return /^9\d{9}$/.test(n) ? `+63 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}` : String(p || '').trim();
}

/** Replies staff send often; tapping one puts it in the message box to edit before sending. */
const QUICK_REPLIES = [
  'Thank you for your order! We are getting it ready.',
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

// ─────────────────────────────────────────────
//  NEW ORDER HANDLING: Accept, Can't take it, order slip
//  Like a food-delivery merchant app. Nothing new is stored: accepting moves the order to Processing and tells the
//  customer the ready date in the order's chat; "Can't take it" sends the reason and cancels it the usual way.
// ─────────────────────────────────────────────

/** The order's chat id, making the chat if the order has none yet (same fields the order page uses). */
async function orderChatId(o) {
  const snap = await db.collection('chats').where('orderId', '==', o.id).limit(1).get();
  if (!snap.empty) return snap.docs[0].id;
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const ref = await db.collection('chats').add({ orderId: o.id, userId: o.userId || '', customerName: o.fullName || '',
    createdAt: ts, lastMessageAt: ts, adminReadAt: ts });
  return ref.id;
}

/** Sends a message from the shop in the order's chat. */
async function sendOrderMessage(o, text) {
  const chatId = await orderChatId(o), chat = db.collection('chats').doc(chatId);
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  await chat.collection('messages').add({ senderId: (auth.currentUser && auth.currentUser.uid) || '', senderRole: 'admin', messageText: text, sentAt: ts });
  await chat.update({ lastMessageAt: ts, adminReadAt: ts }).catch(() => {});
}

const READY_CHOICES = [['Today', 0], ['Tomorrow', 1], ['In 2 days', 2], ['In 3 days', 3]];
const DECLINE_REASONS = ['Out of stock', 'Too many orders right now', "We can't print this design"];
const _fmtDay = d => d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
const _isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A small box over the page, closed by Back, the ×, Escape or a click outside; returns its element. */
function _orderBox(title, bodyHtml, footHtml) {
  document.querySelectorAll('.ob-overlay').forEach(x => x.remove());
  const ov = document.createElement('div');
  ov.className = 'overlay show ob-overlay';
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-hd"><h3>${esc(title)}</h3><button type="button" class="modal-x" data-close aria-label="Close">&times;</button></div>
      <div class="modal-bd">${bodyHtml}</div>
      <div class="modal-ft">${footHtml}</div></div>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  ov.close = close;
  return ov;
}

/** Accept a Pending order: pick when it will be ready, then it moves to Processing and the customer is told. */
function openAcceptOrder(o, onDone) {
  if (!o) return;
  const no = orderNo(o.id);
  const chips = READY_CHOICES.map(([label, add], i) =>
    `<button type="button" class="ob-chip${i === 1 ? ' on' : ''}" data-add="${add}">${label}</button>`).join('') +
    `<label class="ob-chip ob-pick"><span>Pick a date</span><input type="date" data-pick min="${_isoDay(new Date())}"></label>`;
  const ov = _orderBox('Accept ' + no, `
      <p class="ob-q">When will it be ready?</p>
      <div class="ob-chips" role="group" aria-label="Ready date">${chips}</div>
      <label class="ob-q" for="ob-note">Note for the customer <span class="note">(optional)</span></label>
      <input id="ob-note" class="inp" maxlength="200" placeholder="e.g. Ready for pickup after 2 PM">
      <p class="ob-q" style="margin-top:14px;">The customer gets this in the chat:</p>
      <div class="ob-preview" id="ob-preview"></div>`,
    `<button type="button" class="btn-ghost" data-close>Back</button>
     <button type="button" class="btn-grad ob-ok" id="ob-go"><i class="bi bi-check-lg"></i> Accept and send</button>`);
  let day = new Date(); day.setDate(day.getDate() + 1);
  const text = () => {
    const note = ov.querySelector('#ob-note').value.trim();
    return `✅ We accepted your order ${no}. It should be ready by ${_fmtDay(day)}.` + (note ? ' ' + note : '');
  };
  const show = () => { ov.querySelector('#ob-preview').textContent = text(); };
  ov.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
    day = new Date(); day.setDate(day.getDate() + Number(b.dataset.add));
    ov.querySelectorAll('.ob-chip').forEach(c => c.classList.toggle('on', c === b));
    ov.querySelector('[data-pick]').value = ''; show();
  });
  const pick = ov.querySelector('[data-pick]');
  pick.onchange = () => {
    if (!pick.value) return;
    const [y, m, d] = pick.value.split('-').map(Number); day = new Date(y, m - 1, d);
    ov.querySelectorAll('.ob-chip').forEach(c => c.classList.toggle('on', c.classList.contains('ob-pick'))); show();
  };
  ov.querySelector('#ob-note').oninput = show;
  show();
  ov.querySelector('#ob-go').onclick = async () => {
    const btn = ov.querySelector('#ob-go'); btn.disabled = true;
    try {
      await setOrderStatus(o.id, 'Processing');
      if (typeof OrderAlert !== 'undefined') OrderAlert.handled(o.id);
      try { await sendOrderMessage(o, text()); toast(`${no} accepted and the customer was told`, 'ok'); }
      catch (e) { toast(`${no} accepted, but the chat message wasn't sent: ${e.message}`, 'warn'); }
      ov.close(); if (onDone) onDone();
    } catch (e) { toast('Not accepted: ' + e.message, 'err'); btn.disabled = false; }
  };
}

/** Turn down a Pending order: say why in the chat, then cancel it (stock goes back, as with the Cancelled button). */
function openDeclineOrder(o, onDone) {
  if (!o) return;
  const no = orderNo(o.id);
  const reasons = DECLINE_REASONS.map((r, i) => `<button type="button" class="ob-chip${i === 0 ? ' on' : ''}" data-r="${esc(r)}">${esc(r)}</button>`).join('') +
    `<button type="button" class="ob-chip" data-r="">Something else</button>`;
  // Owners can send the money back in the same step, through the payment server
  const paid = orderPaidAmount(o), canRefund = window.ADMIN_ROLE === 'super_admin' && !!o.payMongoSourceId && paid >= 20;
  const ov = _orderBox("Can't take " + no, `
      <p class="ob-q">Why can't the shop take it?</p>
      <div class="ob-chips" role="group" aria-label="Reason">${reasons}</div>
      <label class="ob-q" for="ob-why">In your own words <span class="note">(optional)</span></label>
      <input id="ob-why" class="inp" maxlength="200" placeholder="e.g. The white shirts in size XL are sold out">
      <p class="ob-q" style="margin-top:14px;">The customer gets this in the chat:</p>
      <div class="ob-preview" id="ob-preview"></div>
      ${canRefund ? `<label class="ob-refund"><input type="checkbox" id="ob-refund" checked> Refund ${esc(peso(paid))} to their GCash now</label>` : ''}
      <p class="note" style="margin-top:12px;">The order is cancelled and any stock taken for it is put back.${canRefund ? '' : ' Refund what the customer paid on the Payments page.'}</p>`,
    `<button type="button" class="btn-ghost" data-close>Back</button>
     <button type="button" class="btn-ghost ob-no" id="ob-go"><i class="bi bi-x-lg"></i> Cancel the order and send</button>`);
  let reason = DECLINE_REASONS[0];
  const refunding = () => { const c = ov.querySelector('#ob-refund'); return !!(c && c.checked); };
  const text = (refunded) => {
    const own = ov.querySelector('#ob-why').value.trim();
    const why = [reason, own].filter(Boolean).join('. ');
    const money = (refunded === undefined ? refunding() : refunded)
      ? ` We have sent ${peso(paid)} back to your GCash; it can take a few days to show.`
      : ' What you paid will be refunded to your GCash.';
    return `Sorry, we can't take your order ${no}` + (why ? ': ' + why : '') + '. It has been cancelled.' + money;
  };
  const show = () => { ov.querySelector('#ob-preview').textContent = text(); };
  ov.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
    reason = b.dataset.r; ov.querySelectorAll('.ob-chip').forEach(c => c.classList.toggle('on', c === b));
    if (!reason) ov.querySelector('#ob-why').focus(); show();
  });
  ov.querySelector('#ob-why').oninput = show;
  const rc = ov.querySelector('#ob-refund'); if (rc) rc.onchange = show;
  show();
  ov.querySelector('#ob-go').onclick = async () => {
    if (!reason && !ov.querySelector('#ob-why').value.trim()) { toast('Write the reason for the customer', 'warn'); ov.querySelector('#ob-why').focus(); return; }
    const btn = ov.querySelector('#ob-go'); btn.disabled = true;
    try {
      await setOrderStatus(o.id, 'Cancelled');
      if (typeof OrderAlert !== 'undefined') OrderAlert.handled(o.id);
      let refunded = false;
      if (refunding()) {
        try { await callPaymentServer('refund', { sourceId: o.payMongoSourceId, amountCentavos: Math.round(paid * 100), reason: 'others', notes: 'Order ' + no + ' cancelled by the shop' }); refunded = true; }
        catch (e) { toast(`${no} cancelled, but the refund didn't go through: ${e.message} Try again on the Payments page.`, 'warn'); }
      }
      try { await sendOrderMessage(o, text(refunded)); toast(`${no} cancelled${refunded ? ', refunded' : ''} and the customer was told`, 'ok'); }
      catch (e) { toast(`${no} cancelled, but the chat message wasn't sent: ${e.message}`, 'warn'); }
      ov.close(); if (onDone) onDone();
    } catch (e) { toast('Not cancelled: ' + e.message, 'err'); btn.disabled = false; }
  };
}

/** Opens a half-page slip for the order in a new tab and starts printing, to tape onto the finished package. */
function printOrderSlip(o) {
  if (!o) return;
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups for this site to print the slip', 'warn'); return; }
  const items = Array.isArray(o.items) ? o.items : [];
  const place = [o.streetAddress, o.barangay ? (/^brgy\.?|^barangay/i.test(o.barangay) ? o.barangay : 'Brgy. ' + o.barangay) : '', o.city, o.zipCode].filter(Boolean).join(', ');
  const toCollect = o.isDownpayment && !o.balancePaidAt ? Number(o.remainingAmount) || 0 : 0;
  const rows = items.map(it => {
    const img = safeUrl(it.previewUrl) || safeUrl(it.imageUrl);
    const qty = Number(it.quantity) || 1;
    return `<div class="it">${img ? `<img src="${img}" alt="">` : '<span class="ph"></span>'}
      <div><b>${esc(it.productName || 'Item')}</b><br>${[it.size ? 'Size ' + esc(it.size) : '', '× ' + qty, it.colorHex ? esc(it.colorHex) : ''].filter(Boolean).join(' · ')}
      ${it.notes ? `<br><i>${esc(it.notes)}</i>` : ''}</div></div>`;
  }).join('');
  const phone = typeof prettyPhone === 'function' ? prettyPhone(o.phone || '') : (o.phone || '');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Slip ${esc(orderNo(o.id))}</title>
<style>
  @page { size: A5; margin: 10mm; }
  body { font: 13px/1.45 'Segoe UI', Arial, sans-serif; color: #111; margin: 0; }
  .slip { max-width: 128mm; margin: 0 auto; display: grid; gap: 10px; }
  .top { display: flex; justify-content: space-between; align-items: flex-end; }
  .no { font: 800 34px/1 'Segoe UI', Arial, sans-serif; letter-spacing: .5px; }
  .shop { font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #555; }
  hr { border: 0; border-top: 1.5px dashed #999; margin: 0; }
  .it { display: flex; gap: 10px; align-items: center; break-inside: avoid; }
  .it img, .it .ph { width: 48px; height: 48px; object-fit: contain; border: 1px solid #ccc; border-radius: 6px; flex-shrink: 0; }
  .due { display: flex; justify-content: space-between; font-weight: 800; font-size: 16px; border: 2px solid #111; border-radius: 6px; padding: 6px 10px; }
  .muted { color: #555; }
</style></head><body><div class="slip">
  <div class="shop">KustomoImprenta · Order slip</div>
  <div class="top"><span class="no">${esc(orderNo(o.id))}</span><span>${esc(fmtDate(o.orderedAt, false))}</span></div>
  <div><b>${esc(o.fullName || 'Customer')}</b>${phone ? ' · ' + esc(phone) : ''}<br>${esc(place || 'No address given')}
    ${o.landmark ? `<br><span class="muted">Near: ${esc(o.landmark)}</span>` : ''}</div>
  <hr>${rows || '<div class="muted">No items</div>'}<hr>
  <div class="due"><span>${toCollect ? 'Collect on delivery' : 'Payment'}</span><span>${toCollect ? esc(peso(toCollect)) : 'Paid'}</span></div>
  ${o.driver && o.driver.name ? `<div class="muted">Driver: ${esc(o.driver.name)}${o.driver.phone ? ' · ' + esc(o.driver.phone) : ''}</div>` : ''}
</div>
<script>
  // Print once the pictures have loaded (or after 3 seconds), then close the tab
  const imgs = [...document.images].filter(i => !i.complete);
  let left = imgs.length, done = false;
  const go = () => { if (done) return; done = true; window.print(); };
  imgs.forEach(i => { i.onload = i.onerror = () => { if (--left <= 0) go(); }; });
  if (!left) setTimeout(go, 50); else setTimeout(go, 3000);
  window.onafterprint = () => window.close();
<\/script></body></html>`);
  w.document.close();
}

// ─────────────────────────────────────────────
//  PAYMENT SERVER (Kustomo-ImprentaServer on Render): holds the PayMongo key, lists payments, gives refunds.
//  Its address is appConfig/payments.serverUrl, set on the Payments page.
// ─────────────────────────────────────────────
let _payUrl = null;
async function paymentServerUrl(force) {
  if (_payUrl !== null && !force) return _payUrl;
  try { const d = await db.collection('appConfig').doc('payments').get(); _payUrl = String((d.exists && d.data().serverUrl) || '').trim().replace(/\/+$/, ''); }
  catch (e) { _payUrl = ''; }
  return _payUrl;
}
/** One step on the payment server, signed in as this staff member. Throws an Error with a message to show. */
async function callPaymentServer(step, data) {
  const url = await paymentServerUrl();
  if (!url) throw new Error('The payment server isn\'t set up yet (Payments page → Setup).');
  const token = await auth.currentUser.getIdToken();
  let res;
  try {
    res = await fetch(url + '/paymongo/' + step, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) });
  } catch (e) { throw new Error('Couldn\'t reach the payment server. It may be waking up; try again in a minute.'); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = json.message || ('HTTP ' + res.status);
    const err = new Error(m === 'no-paymongo-key' ? 'No PayMongo key is saved yet.'
      : m === 'paymongo-key-rejected' ? 'PayMongo didn\'t accept the saved key. Paste the secret key again.'
      : res.status === 404 && !json.error ? 'Nothing is running at the payment server address.' : m);
    err.code = json.error || ''; throw err;
  }
  return json;
}
/** What the customer paid in GCash for an order (the downpayment, or the whole total). */
function orderPaidAmount(o) { return o.isDownpayment ? (+o.downpaymentAmount || 0) : (+o.totalAmount || 0); }
