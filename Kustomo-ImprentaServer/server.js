/**
 * Kustomo-Imprenta payment server: the GCash payment steps that need PayMongo's secret key, run on Render (render.com)
 * as a Web Service, so Firebase can stay on the free Spark plan.
 *
 * The shop pastes the key on the admin site's Payments page. It is saved in Firestore `secrets/paymongo`, a document
 * the Firestore rules let nobody read (a Super Admin can only write it). This server signs in to Firebase with a
 * service account, which can read it; the app and the admin site never see the key again after it is saved.
 *
 * The app sends the order along when a payment starts. The order is saved here as soon as the money is taken,
 * whether the app asks (`finish`) or PayMongo tells this server first (`webhook`), so closing the app after paying
 * can't lose an order. Each payment is taken and each order saved once, however many times either one arrives.
 *
 * Requests carry the caller's Firebase sign-in (Authorization: Bearer <ID token>), except the webhook, which carries
 * PayMongo's signature instead:
 *   POST /paymongo/create-source    start a GCash payment (with the order), returns the page GCash opens  (app)
 *   POST /paymongo/finish           take the money if GCash says yes, save the order, return it           (app)
 *   POST /paymongo/source-status    whether the customer finished in GCash          (older app versions)
 *   POST /paymongo/create-payment   take the money; the app saves the order         (older app versions)
 *   POST /paymongo/check-key        is the saved key accepted, live or test? Sets up PayMongo's notices    (owners)
 *   POST /paymongo/payments         the latest payments, with refunds                                     (staff)
 *   POST /paymongo/refund           give back all or part of a payment                                    (owners)
 *   POST /paymongo/webhook          PayMongo: a GCash payment was approved                              (PayMongo)
 *   GET  /health                    "ok"; the app calls it early to wake the server up
 *
 * Errors come back as {"error": "<code>", "message": "..."}, the codes matching the HTTP status:
 *   400 invalid-argument · 401 unauthenticated · 403 permission-denied · 404 not-found
 *   412 failed-precondition (no key saved yet) · 502 aborted (PayMongo said no)
 *
 * Settings (Render → the service → Environment):
 *   FIREBASE_SERVICE_ACCOUNT  the whole JSON file from Firebase console → Project settings → Service accounts →
 *                             Generate new private key. (Or add it as a Secret File named
 *                             firebase-service-account.json instead.)
 *   RENDER_EXTERNAL_URL, PORT set by Render (the first is this server's own address, for PayMongo's notices).
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');
const admin = require('firebase-admin');

const API = 'https://api.paymongo.com/v1';
const SECRET_FILE = '/etc/secrets/firebase-service-account.json';
const FV = admin.firestore.FieldValue;

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || (fs.existsSync(SECRET_FILE) ? fs.readFileSync(SECRET_FILE, 'utf8') : '');
  if (!raw.trim()) {
    console.error('FIREBASE_SERVICE_ACCOUNT is not set. Add the service account JSON in Render → Environment.');
    process.exit(1);
  }
  try { return JSON.parse(raw); } catch (e) {
    console.error('FIREBASE_SERVICE_ACCOUNT is not valid JSON. Paste the whole file, from { to }.');
    process.exit(1);
  }
}

if (!admin.apps.length) {
  try { admin.initializeApp({ credential: admin.credential.cert(serviceAccount()) }); } catch (e) {
    console.error('The service account in FIREBASE_SERVICE_ACCOUNT was not accepted (' + e.message + '). Generate a new private key in Firebase and paste the whole file again.');
    process.exit(1);
  }
}
const db = admin.firestore();

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const bad = (m) => new ApiError(400, 'invalid-argument', m);

// ── The key ─────────────────────────────────────────────────────────────────────────────────────────
/** The saved settings (key and PayMongo notice details); the key is checked. */
async function keyDoc() {
  const snap = await db.doc('secrets/paymongo').get();
  const d = snap.exists ? snap.data() : {};
  const key = String(d.secretKey || '').trim();
  if (!/^sk_(test|live)_/.test(key)) throw new ApiError(412, 'failed-precondition', 'no-paymongo-key');
  return { ...d, secretKey: key };
}
async function secretKey() { return (await keyDoc()).secretKey; }
/** A short, safe way to say which key it is: test or live, and its last 4 characters. */
const keyHint = (key) => ({ mode: key.startsWith('sk_live_') ? 'live' : 'test', last4: key.slice(-4) });
/** Fingerprint of a key, to notice when the shop saved a different one (the key itself is never stored twice). */
const fingerprint = (key) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);

/** Calls PayMongo; turns its errors into ones the app and site can show. */
async function paymongo(key, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64'),
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (json.errors && json.errors[0] && json.errors[0].detail) || ('HTTP ' + res.status);
    console.warn('PayMongo ' + method + ' ' + path.split('?')[0] + ' failed: ' + detail);
    if (res.status === 401) throw new ApiError(403, 'permission-denied', 'paymongo-key-rejected');
    throw new ApiError(502, 'aborted', 'PayMongo: ' + detail);
  }
  return json.data;
}

// ── Who is asking ───────────────────────────────────────────────────────────────────────────────────
async function signedIn(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) throw new ApiError(401, 'unauthenticated', 'Sign in first.');
  try { return await admin.auth().verifyIdToken(m[1]); } catch (e) {
    throw new ApiError(401, 'unauthenticated', 'Sign in again.');
  }
}
/** Signed in, and not switched off on the admin site. */
async function requireCustomer(req) {
  const auth = await signedIn(req);
  const user = await db.doc('users/' + auth.uid).get();
  if (user.exists && user.get('status') === 'Disabled') throw new ApiError(403, 'permission-denied', 'account-disabled');
  return auth;
}
/** Staff (admin or super_admin), or with `owner` only a Super Admin. */
async function requireStaff(req, owner) {
  const auth = await signedIn(req);
  const me = await db.doc('users/' + auth.uid).get();
  const role = me.exists ? me.get('role') : '';
  const ok = owner ? role === 'super_admin' : ['admin', 'super_admin'].includes(role);
  if (!ok || me.get('status') === 'Disabled') throw new ApiError(403, 'permission-denied', owner ? 'Owners (Super Admins) only.' : 'Staff only.');
  return { auth, email: auth.email || '' };
}

// ── Checking what the phone sends ───────────────────────────────────────────────────────────────────
/** Whole centavos between ₱20 (PayMongo's minimum) and ₱1,000,000. */
function centavos(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 2000 || n > 100000000) throw bad('Bad amount.');
  return n;
}
/** Where GCash returns to afterwards: the app's own link or an https page. */
function appLink(v) {
  const s = String(v || '');
  if (!/^(kustomoimprenta:\/\/|https:\/\/)\S{1,300}$/i.test(s)) throw bad('Bad return link.');
  return s;
}
function sourceId(v) {
  const id = String(v || '');
  if (!/^src_\w{1,100}$/.test(id)) throw bad('Bad source.');
  return id;
}
const str = (v, n = 300) => String(v == null ? '' : v).slice(0, n);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Shop Settings defaults: the same as the admin site's SHOP_DEFAULTS (js/firebase.js), used until they are saved. */
const SHOP_DEFAULTS = { shippingFee: 99, freeShippingMin: 1500, downpaymentEnabled: true, downpaymentPercent: 50, downpaymentMinItems: 10 };

/** The order the app sent, kept to the fields an order has, then priced again here from the products and the shop
 *  settings in Firestore: a changed app can't lower a price, the shipping or the downpayment. The amount paid must
 *  match the price worked out here. */
async function cleanOrder(o, uid, amountCentavos) {
  if (!o || typeof o !== 'object') return null;
  const items = Array.isArray(o.items) ? o.items.slice(0, 60).filter(it => it && typeof it === 'object') : [];
  if (!items.length) throw bad('The order has no items.');
  const order = {
    userId: uid,
    fullName: str(o.fullName, 120), phone: str(o.phone, 20),
    streetAddress: str(o.streetAddress), city: str(o.city, 120), zipCode: str(o.zipCode, 12),
    barangay: str(o.barangay, 120), landmark: str(o.landmark),
    subtotal: num(o.subtotal), shippingFee: num(o.shippingFee), totalAmount: num(o.totalAmount),
    isDownpayment: o.isDownpayment === true, downpaymentAmount: num(o.downpaymentAmount), remainingAmount: num(o.remainingAmount),
    items
  };
  const lat = Number(o.addressLat), lng = Number(o.addressLng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) { order.addressLat = lat; order.addressLng = lng; }
  await priceOrder(order, o);
  const due = Math.round((order.isDownpayment ? order.downpaymentAmount : order.totalAmount) * 100);
  if (Math.abs(due - amountCentavos) > 1) throw bad('The amount doesn\'t match the order.');
  return order;
}

/** Sets each item's price from its product and the order's subtotal, shipping, total and downpayment from Shop
 *  Settings. Refuses an order whose prices the app showed differently (a price or setting changed meanwhile, or a
 *  changed app), a product that is gone or not for sale, and a downpayment the shop doesn't offer for it. */
async function priceOrder(order, sent) {
  const changed = () => bad('Prices have changed since the cart was opened. Please open your cart again to see the new total.');
  const ids = [...new Set(order.items.map(it => str(it.productId, 100)))];
  if (ids.some(id => !/^[\w-]{1,100}$/.test(id))) throw bad('An item in the cart has no product. Please remove it and add it again.');
  const [snaps, shopSnap] = await Promise.all([Promise.all(ids.map(id => db.doc('products/' + id).get())), db.doc('appConfig/shop').get()]);
  const products = {};
  snaps.forEach((p, i) => { products[ids[i]] = p.exists ? (p.data() || {}) : null; });
  let subtotal = 0, count = 0;
  for (const it of order.items) {
    const p = products[str(it.productId, 100)];
    if (!p || p.isAvailable === false) throw bad(`${str(it.productName || (p && p.name) || 'An item', 80)} is no longer for sale. Please remove it from your cart.`);
    const price = num(p.price), qty = Number(it.quantity);
    if (!(price > 0)) throw bad(`${str(p.name || 'An item', 80)} has no price yet. Please contact the shop.`);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw bad('Bad quantity.');
    if (Math.abs(num(it.price) - price) > 0.005) throw changed();
    it.price = price; it.quantity = qty;
    subtotal += price * qty; count += qty;
  }
  const shop = Object.assign({}, SHOP_DEFAULTS, shopSnap.exists ? shopSnap.data() : {});
  const fee = num(shop.shippingFee), freeFrom = num(shop.freeShippingMin);
  const shipping = fee <= 0 || (freeFrom > 0 && subtotal >= freeFrom) ? 0 : fee;
  const total = subtotal + shipping;
  if (Math.abs(num(sent.subtotal) - subtotal) > 0.5 || Math.abs(num(sent.shippingFee) - shipping) > 0.5 || Math.abs(num(sent.totalAmount) - total) > 0.5) throw changed();
  Object.assign(order, { subtotal, shippingFee: shipping, totalAmount: total });
  if (order.isDownpayment) {
    if (shop.downpaymentEnabled === false || count < num(shop.downpaymentMinItems)) throw bad('A downpayment isn\'t offered for this order. Please pay the full amount.');
    // The app rounds to whole pesos (half to even), so its figure may differ from this one by ₱1: keep the app's then
    const exact = total * num(shop.downpaymentPercent) / 100, given = num(sent.downpaymentAmount);
    if (Math.abs(given - exact) > 1 || given !== Math.round(given)) throw changed();
    const down = given;
    Object.assign(order, { downpaymentAmount: down, remainingAmount: total - down });
  } else Object.assign(order, { downpaymentAmount: 0, remainingAmount: 0 });
}

// ── Saving the order (the same as the app's OrderService.saveOrder) ─────────────────────────────────
/** Whether a side of a design has anything on it. */
function sideHasContent(v) {
  if (!v || typeof v !== 'object') return false;
  const texts = (Array.isArray(v.texts) ? v.texts : []).some(t => t && String(t.text || '').trim());
  return texts || (Array.isArray(v.images) && v.images.length > 0) || (Array.isArray(v.shapes) && v.shapes.length > 0);
}

async function saveOrder(order, srcId) {
  const now = admin.firestore.Timestamp.now();
  const orderRef = await db.collection('orders').add({
    ...order, paymentMethod: 'GCash', payMongoSourceId: srcId, status: 'Pending', orderedAt: now
  });
  const chatRef = await db.collection('chats').add({
    orderId: orderRef.id, userId: order.userId, customerName: order.fullName, createdAt: now, lastMessageAt: now
  });
  // Each item goes into the order's chat as a card with its picture, as the app does
  try {
    const start = Date.now();
    const batch = db.batch();
    order.items.forEach((item, i) => {
      const views = (item.customization && typeof item.customization === 'object' && item.customization.views) || {};
      const sides = Object.keys(views).filter(k => sideHasContent(views[k]));
      const qty = Math.round(num(item.quantity)) || 1, price = num(item.price);
      const image = String(item.previewUrl || '').trim() || String(item.imageUrl || '');
      let text = (item.productName || 'Item') + ' · Size ' + (item.size || '—') + ' · ×' + qty + ' · ₱' + Math.trunc(price * qty);
      if (sides.length) text += '\nYour design on the ' + sides.join(', ');
      batch.set(chatRef.collection('messages').doc(), {
        senderId: order.userId, senderRole: 'user', kind: 'item', itemIndex: i, messageText: text, imageUrl: image,
        isDesignSubmission: false, sentAt: admin.firestore.Timestamp.fromMillis(start + i)
      });
    });
    await batch.commit();
  } catch (e) { console.warn('Item cards not added to chat ' + chatRef.id + ': ' + e.message); }
  return { orderId: orderRef.id, chatId: chatRef.id };
}

/**
 * Takes the money for a GCash payment the customer approved and saves its order, exactly once. Called by the app
 * (`finish`) and by PayMongo (`webhook`), in either order or at the same time.
 * Returns { paid, status, orderId, chatId }.
 */
async function finishSource(id, uid) {
  const ref = db.doc('paymongoSources/' + id);
  const claim = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const d = s.exists ? s.data() : {};
    if (uid && d.uid && d.uid !== uid) throw new ApiError(403, 'permission-denied', 'Not your payment.');
    if (d.orderId) return { done: d };
    if (d.state === 'working' && Date.now() - (d.workingSince || 0) < 120000) return { busy: true };
    tx.set(ref, { state: 'working', workingSince: Date.now() }, { merge: true });
    return { go: d };
  });
  if (claim.done) return { paid: true, status: 'paid', orderId: claim.done.orderId, chatId: claim.done.chatId || '' };
  if (claim.busy) return { paid: false, status: 'processing' };
  const d = claim.go;
  try {
    let paymentId = d.paymentId || '';
    if (!paymentId) {
      const key = await secretKey();
      const source = await paymongo(key, 'GET', '/sources/' + id);
      const st = source.attributes.status;
      if (st !== 'chargeable') {
        await ref.set({ state: st }, { merge: true });
        return { paid: false, status: st };
      }
      const payment = await paymongo(key, 'POST', '/payments', {
        data: { attributes: {
          amount: source.attributes.amount, currency: 'PHP',
          description: ('KustomoImprenta order' + (d.order && d.order.fullName ? ' — ' + d.order.fullName : '')).slice(0, 200),
          source: { id, type: 'source' }
        } }
      });
      if (payment.attributes.status !== 'paid') {
        await ref.set({ state: 'payment-' + payment.attributes.status, paymentId: payment.id }, { merge: true });
        return { paid: false, status: payment.attributes.status };
      }
      paymentId = payment.id;
      await ref.set({ paymentId, paidAt: FV.serverTimestamp() }, { merge: true });
    }
    if (!d.order) {
      // An older app version saves the order itself
      await ref.set({ state: 'paid' }, { merge: true });
      return { paid: true, status: 'paid', orderId: '', chatId: '' };
    }
    const saved = await saveOrder(d.order, id);
    await ref.set({ state: 'done', orderId: saved.orderId, chatId: saved.chatId, order: FV.delete() }, { merge: true });
    console.log('Order ' + saved.orderId + ' saved for ' + id);
    return { paid: true, status: 'paid', ...saved };
  } catch (e) {
    await ref.set({ state: 'error', error: String(e.message || e).slice(0, 300) }, { merge: true }).catch(() => {});
    throw e;
  }
}

// ── PayMongo's notices (webhook) ────────────────────────────────────────────────────────────────────
const ownUrl = () => String(process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || '').replace(/\/+$/, '');
let webhookReadyFor = '';

/** Makes sure PayMongo tells this server when a GCash payment is approved; keeps the notice's signing secret. */
async function ensureWebhook(force) {
  const base = ownUrl();
  if (!base) return { ok: false, reason: 'This server doesn\'t know its own address yet (RENDER_EXTERNAL_URL).' };
  const d = await keyDoc();
  const fp = fingerprint(d.secretKey);
  if (!force && webhookReadyFor === fp) return { ok: true };
  if (!force && d.webhookFor === fp && d.webhookSecret) { webhookReadyFor = fp; return { ok: true }; }
  const url = base + '/paymongo/webhook';
  const list = await paymongo(d.secretKey, 'GET', '/webhooks');
  let hook = (Array.isArray(list) ? list : []).find(w => w.attributes && w.attributes.url === url);
  if (hook && hook.attributes.status !== 'enabled') {
    hook = await paymongo(d.secretKey, 'POST', '/webhooks/' + hook.id + '/enable');
  }
  if (!hook) {
    hook = await paymongo(d.secretKey, 'POST', '/webhooks', { data: { attributes: { url, events: ['source.chargeable'] } } });
  }
  const secret = hook.attributes.secret_key;
  if (!secret) return { ok: false, reason: 'PayMongo didn\'t give the notice\'s secret.' };
  await db.doc('secrets/paymongo').set({ webhookId: hook.id, webhookSecret: secret, webhookFor: fp }, { merge: true });
  webhookReadyFor = fp;
  return { ok: true };
}

/** Checks PayMongo's signature: "t=<time>,te=<test>,li=<live>", an HMAC-SHA256 of "<time>.<body>". */
function signatureOk(header, raw, secret, live) {
  const parts = Object.fromEntries(String(header || '').split(',').map(p => p.split('=').map(s => s.trim())).filter(p => p.length === 2));
  const sent = live ? parts.li : parts.te;
  if (!parts.t || !sent) return false;
  const want = crypto.createHmac('sha256', secret).update(parts.t + '.' + raw).digest('hex');
  const a = Buffer.from(want), b = Buffer.from(sent);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function webhook(req, res) {
  const raw = await readRaw(req, 200000);
  let event; try { event = JSON.parse(raw.toString('utf8')); } catch (e) { return send(res, 400, { error: 'invalid-argument' }); }
  const attrs = event && event.data && event.data.attributes;
  const d = await db.doc('secrets/paymongo').get();
  const secret = d.exists ? d.get('webhookSecret') : '';
  if (!secret || !signatureOk(req.headers['paymongo-signature'], raw.toString('utf8'), secret, !!(attrs && attrs.livemode))) {
    console.warn('Webhook with a bad signature ignored');
    return send(res, 401, { error: 'unauthenticated' });
  }
  if (attrs && attrs.type === 'source.chargeable' && attrs.data && /^src_/.test(attrs.data.id || '')) {
    try { await finishSource(attrs.data.id); } catch (e) { console.error('Webhook for ' + attrs.data.id + ' failed: ' + e.message); return send(res, 500, { error: 'internal' }); }
  }
  send(res, 200, { ok: true });
}

// ── Steps ───────────────────────────────────────────────────────────────────────────────────────────
const routes = {
  async 'create-source'(req, d) {
    const auth = await requireCustomer(req);
    const key = await secretKey();
    const amount = centavos(d.amountCentavos);
    // Older app versions sent no order and saved it themselves, which the database no longer allows
    if (!d.order) throw bad('Please update the app to the latest version to pay.');
    const order = await cleanOrder(d.order, auth.uid, amount);
    ensureWebhook().catch(e => console.warn('PayMongo notices not set up: ' + e.message));
    const data = await paymongo(key, 'POST', '/sources', {
      data: { attributes: {
        amount, currency: 'PHP', type: 'gcash',
        redirect: { success: appLink(d.successUrl), failed: appLink(d.failedUrl) }
      } }
    });
    // Who started it and what they ordered (no Firestore rule lets the app or site read this)
    await db.doc('paymongoSources/' + data.id).set({
      uid: auth.uid, amount: data.attributes.amount, createdAt: FV.serverTimestamp(), state: 'pending', ...(order ? { order } : {})
    });
    return { id: data.id, checkoutUrl: data.attributes.redirect.checkout_url, status: data.attributes.status };
  },

  async 'finish'(req, d) {
    const auth = await requireCustomer(req);
    return finishSource(sourceId(d.sourceId), auth.uid);
  },

  async 'source-status'(req, d) {
    await requireCustomer(req);
    const data = await paymongo(await secretKey(), 'GET', '/sources/' + sourceId(d.sourceId));
    return { status: data.attributes.status };
  },

  async 'create-payment'(req, d) {
    const auth = await requireCustomer(req);
    const r = await finishSource(sourceId(d.sourceId), auth.uid);
    return { paid: r.paid, status: r.status };
  },

  async 'check-key'(req) {
    await requireStaff(req, true);
    const key = await secretKey();
    await paymongo(key, 'GET', '/payments?limit=1');
    let notices;
    try { notices = await ensureWebhook(true); } catch (e) { notices = { ok: false, reason: e.message }; }
    return { ok: true, ...keyHint(key), notices };
  },

  async 'payments'(req, d) {
    await requireStaff(req, false);
    const key = await secretKey();
    const limit = Math.min(100, Math.max(1, Math.round(num(d.limit)) || 50));
    const list = await paymongo(key, 'GET', '/payments?limit=' + limit);
    return {
      ...keyHint(key),
      payments: (Array.isArray(list) ? list : []).map(p => {
        const a = p.attributes || {};
        const refunds = Array.isArray(a.refunds) ? a.refunds : [];
        const refunded = refunds.reduce((s, r) => s + num((r.attributes || r).amount), 0);
        return {
          id: p.id, amount: a.amount, fee: a.fee, net: a.net_amount, status: a.status, description: a.description || '',
          sourceId: a.source && a.source.id || '', type: a.source && a.source.type || '', paidAt: a.paid_at || a.created_at || 0,
          refunded, livemode: !!a.livemode
        };
      })
    };
  },

  async 'refund'(req, d) {
    const { email } = await requireStaff(req, true);
    const key = await secretKey();
    let paymentId = String(d.paymentId || '');
    if (!paymentId && d.sourceId) {
      // A refund from an order: find its payment
      const id = sourceId(d.sourceId);
      const s = await db.doc('paymongoSources/' + id).get();
      paymentId = s.exists ? String(s.get('paymentId') || '') : '';
      if (!paymentId) {
        const list = await paymongo(key, 'GET', '/payments?limit=100');
        const p = (Array.isArray(list) ? list : []).find(x => x.attributes && x.attributes.source && x.attributes.source.id === id);
        paymentId = p ? p.id : '';
      }
      if (!paymentId) throw new ApiError(404, 'not-found', 'No payment found for this order.');
    }
    if (!/^pay_\w{1,100}$/.test(paymentId)) throw bad('Bad payment.');
    const amount = centavos(d.amountCentavos);
    const reasons = ['duplicate', 'fraudulent', 'requested_by_customer', 'others'];
    const refund = await paymongo(key, 'POST', '/refunds', {
      data: { attributes: {
        amount, payment_id: paymentId, reason: reasons.includes(d.reason) ? d.reason : 'requested_by_customer',
        notes: str(d.notes || ('Refunded from the admin site by ' + email), 250)
      } }
    });
    return { ok: true, id: refund.id, status: refund.attributes.status, amount: refund.attributes.amount };
  }
};

// ── HTTP ────────────────────────────────────────────────────────────────────────────────────────────
function send(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    // The admin site (on its own address) calls the staff steps from the browser; every call needs a Firebase sign-in
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store'
  });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(bad('Too large.')); req.destroy(); } else parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  // Room for an order with its designs (Firestore keeps up to 1 MB per document)
  const raw = await readRaw(req, 900000);
  if (!raw.length) return {};
  try { const v = JSON.parse(raw.toString('utf8')); return v && typeof v === 'object' ? v : {}; }
  catch (e) { throw bad('Not JSON.'); }
}

const server = http.createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
  try {
    if (req.method === 'OPTIONS') return send(res, 204);
    if (req.method === 'GET' && (path === '/health' || path === '/')) return send(res, 200, { ok: true, service: 'kustomoimprenta-payments' });
    if (req.method === 'POST' && path === '/paymongo/webhook') return await webhook(req, res);
    const m = /^\/paymongo\/([a-z-]+)$/.exec(path);
    const route = m && Object.prototype.hasOwnProperty.call(routes, m[1]) ? routes[m[1]] : null;
    if (!route) throw new ApiError(404, 'not-found', 'No such step.');
    if (req.method !== 'POST') throw new ApiError(405, 'invalid-argument', 'Use POST.');
    const result = await route(req, await readJson(req));
    send(res, 200, result);
  } catch (e) {
    if (e instanceof ApiError) return send(res, e.status, { error: e.code, message: e.message });
    console.error(e);
    send(res, 500, { error: 'internal', message: 'Payment server error.' });
  }
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 10000;
  server.listen(port, () => console.log('Kustomo-Imprenta payment server on port ' + port));
}
module.exports = { server, routes, ApiError, finishSource, signatureOk, cleanOrder };
