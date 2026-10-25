// =====================================================
//  KustomoImprenta Admin — Shared page layout
//  One sidebar for every page, grouped by what the shop does, plus the menu button on narrow screens.
//  Load before auth.js (which fills in the name and shows the Super Admin links).
// =====================================================

(function layout() {
  // [heading, [[href, icon, label, superAdminOnly, badgeId]], collapsible]
  // Everyday work first; the Super Admin's settings next; technical tools last, folded away under "Advanced".
  const NAV = [
    ['', [
      ['dashboard.html', 'bi-speedometer2', 'Dashboard'],
      ['getting-started.html', 'bi-flag', 'Getting Started'],
      ['training.html', 'bi-mortarboard', 'Training'],
      ['help.html', 'bi-question-circle', 'Help']
    ]],
    ['Shop', [
      ['orders.html', 'bi-bag-check', 'Orders', false, 'nb-orders'],
      ['chats.html', 'bi-chat-dots', 'Messages', false, 'nb-chats'],
      ['customers.html', 'bi-people', 'Customers']
    ]],
    ['Catalog', [
      ['products.html', 'bi-box-seam', 'Products &amp; Stock'],
      ['design.html', 'bi-palette', 'Design Studio'],
      ['design-library.html', 'bi-collection', 'Design Library'],
      ['studio-settings.html', 'bi-sliders2', 'Studio Settings'],
      ['models.html', 'bi-badge-3d', '3D Models']
    ]],
    ['Super Admin', [
      ['settings.html', 'bi-sliders', 'Shop Settings', true],
      ['admins.html', 'bi-person-badge', 'Admin Accounts', true]
    ]],
    ['Advanced', [
      ['keys.html', 'bi-key', 'App Keys', true],
      ['usage.html', 'bi-bar-chart-line', 'Usage', true],
      ['export.html', 'bi-download', 'Export', true],
      ['database.html', 'bi-database', 'Database', true],
      ['cleanup.html', 'bi-trash3', 'Clean Up', true]
    ], true]
  ];
  // Pages that belong under another page's link (order-detail.html is part of Orders; Categories is a pop-up on
  // Products now, and categories.html only forwards there)
  const PARENT = { 'order-detail.html': 'orders.html', 'categories.html': 'products.html' };

  const page = location.pathname.split('/').pop() || 'index.html';
  const here = PARENT[page] || page;
  const nav = document.querySelector('#sidebar .sidebar-nav');
  if (nav) {
    let advOpen = false;
    try { advOpen = localStorage.getItem('nav-advanced') === 'open'; } catch (e) {}
    nav.innerHTML = NAV.map(([heading, links, fold]) => {
      const allSa = links.every(l => l[3]);
      const inHere = links.some(l => l[0] === here);
      const open = !fold || advOpen || inHere;
      const head = !heading ? '' : fold
        ? `<li class="nav-group nav-fold${allSa ? ' sa-only' : ''}"><button type="button" aria-expanded="${open}" data-fold="${heading}">${heading}<i class="bi bi-chevron-down"></i></button></li>`
        : `<li class="nav-group${allSa ? ' sa-only' : ''}">${heading}</li>`;
      return head + links.map(([href, icon, label, sa, badge]) =>
        `<li class="${sa ? 'sa-only' : ''}${fold ? ' nav-folded' : ''}"${fold && !open ? ' data-closed' : ''}><a href="${href}"${sa ? ' class="sa-link"' : ''}${href === here ? ' aria-current="page"' : ''}>` +
        `<i class="bi ${icon}"></i> ${label}${badge ? `<span class="nav-badge" id="${badge}" hidden></span>` : ''}</a></li>`).join('');
    }).join('');
    nav.querySelectorAll('[data-fold]').forEach(b => b.addEventListener('click', () => {
      const open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', open);
      nav.querySelectorAll('.nav-folded').forEach(li => li.toggleAttribute('data-closed', !open));
      try { localStorage.setItem('nav-advanced', open ? 'open' : 'closed'); } catch (e) {}
    }));
    // auth.js marks the active link by exact page name; a sub-page marks its parent here
    nav.querySelectorAll('a').forEach(a => { if (a.getAttribute('href') === here) a.classList.add('active'); });
  }

  // Live counts beside Orders (waiting in Pending) and Messages (conversations with something new since staff last
  // opened them; see chatIsUnread). Only for signed-in staff; a read the rules refuse just leaves the badge off.
  // The same Pending list takes each new order's items out of storage as it arrives (deductNewOrders).
  function setBadge(id, n, title) {
    const b = document.getElementById(id);
    if (!b) return;
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n || '');
    b.title = title;
  }
  if (typeof auth !== 'undefined' && document.getElementById('nb-orders')) {
    let stops = [];
    auth.onAuthStateChanged(u => {
      stops.forEach(f => f()); stops = [];
      if (!u) return;
      stops.push(db.collection('orders').where('status', '==', 'Pending').onSnapshot(s => {
        setBadge('nb-orders', s.size, s.size + ' waiting in Pending');
        if (typeof deductNewOrders === 'function') deductNewOrders(s.docs);
        OrderAlert.check(s.docs);
      }, () => setBadge('nb-orders', 0, '')));
      stops.push(db.collection('chats').onSnapshot(s => {
        const n = s.docs.filter(d => chatIsUnread(d.data())).length;
        setBadge('nb-chats', n, n + ' conversation' + (n === 1 ? '' : 's') + ' with something new');
      }, () => setBadge('nb-chats', 0, '')));
    });
  }

  // Narrow screens: the sidebar slides in from a menu button in the top bar
  const bar = document.querySelector('.topbar');
  const sidebar = document.getElementById('sidebar');
  if (bar && sidebar) {
    const btn = document.createElement('button');
    btn.className = 'menu-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Open menu');
    btn.setAttribute('aria-controls', 'sidebar');
    btn.innerHTML = '<i class="bi bi-list"></i>';
    bar.insertBefore(btn, bar.firstChild);
    const scrim = document.createElement('div');
    scrim.className = 'nav-scrim';
    document.body.appendChild(scrim);
    const setOpen = open => {
      sidebar.classList.toggle('open', open);
      scrim.classList.toggle('show', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    btn.addEventListener('click', () => setOpen(!sidebar.classList.contains('open')));
    scrim.addEventListener('click', () => setOpen(false));
    window.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
  }
})();

/** Whether a conversation has something staff haven't seen: a message (or a new order's design) after the last time
 *  staff opened it or wrote in it (chats/{id}.adminReadAt, set by the Messages and order pages). */
function chatIsUnread(c) {
  const ms = t => (t && typeof t.toMillis === 'function') ? t.toMillis() : 0;
  const last = ms(c.lastMessageAt);
  return last > 0 && last > ms(c.adminReadAt) + 1000;
}

// ── New-order alert ──────────────────────────────────────────────────────────────────────────────
// On every admin page: when a paid order arrives, a ding plays and a small card pops up in the corner with what was
// ordered, where it goes and the price. "Seen up to" is kept per browser, so an order that came in while you were
// on another page (or had the site closed for under an hour) still pops up once when a page opens.
const OrderAlert = (() => {
  const SEEN = 'ki-orders-seen', MUTE = 'ki-orders-mute';
  const get = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } };
  let ctx = null, box = null, baseTitle = document.title, flash = null;

  // Browsers only allow sound after someone has clicked or typed on the page, so the first click switches it on.
  function audio() {
    if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ctx = new A(); }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  ['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => { audio(); updateSoundNote(); }, { capture: true }));

  function ding() {
    if (get(MUTE) === '1') return;
    const a = audio(); if (!a || a.state !== 'running') return;
    const t = a.currentTime;
    // Two bell-like notes, high then higher
    [[880, 0], [1318.5, 0.16]].forEach(([f, d]) => {
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.35, t + d + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.9);
      o.connect(g).connect(a.destination); o.start(t + d); o.stop(t + d + 0.95);
    });
  }

  function css() {
    if (document.getElementById('oa-css')) return;
    const s = document.createElement('style'); s.id = 'oa-css';
    s.textContent = `
#oa-box{position:fixed;right:20px;bottom:20px;z-index:9998;display:flex;flex-direction:column;gap:10px;width:340px;max-width:calc(100vw - 32px);}
.oa{background:#16161c;border:1px solid rgba(255,92,0,.55);border-radius:14px;box-shadow:0 14px 40px rgba(0,0,0,.55);overflow:hidden;animation:oa-in .28s ease-out;font-size:14px;color:#eee;}
@keyframes oa-in{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}
.oa-hd{display:flex;align-items:center;gap:8px;padding:10px 12px;background:linear-gradient(90deg,rgba(255,92,0,.22),rgba(255,44,120,.12));font-weight:800;}
.oa-hd .bi-bell-fill{color:#FF5C00;animation:oa-ring 1s ease-in-out 2;}
@keyframes oa-ring{0%,100%{transform:rotate(0)}20%{transform:rotate(18deg)}40%{transform:rotate(-14deg)}60%{transform:rotate(8deg)}}
.oa-hd .t{flex:1;} .oa-hd small{font-weight:600;color:#aaa;}
.oa-hd button{background:none;border:0;color:#bbb;cursor:pointer;font-size:16px;padding:2px 4px;border-radius:6px;}
.oa-hd button:hover{color:#fff;background:rgba(255,255,255,.08);}
.oa-body{padding:10px 12px;display:grid;gap:8px;}
.oa-item{display:flex;gap:10px;align-items:center;}
.oa-item img,.oa-item .ph{width:46px;height:46px;border-radius:8px;object-fit:cover;background:rgba(255,255,255,.06);flex-shrink:0;display:grid;place-items:center;color:#777;}
.oa-item .n{font-weight:700;line-height:1.3;} .oa-item .s{color:#aaa;font-size:13px;}
.oa-item .p{margin-left:auto;font-weight:800;color:#FF5C00;white-space:nowrap;}
.oa-row{display:flex;gap:8px;color:#ccc;line-height:1.4;} .oa-row i{color:#888;margin-top:1px;}
.oa-tot{display:flex;justify-content:space-between;border-top:1px solid rgba(255,255,255,.08);padding-top:8px;font-weight:800;font-size:15px;}
.oa-tot span:last-child{color:#FF5C00;}
.oa-ft{display:flex;gap:8px;padding:0 12px 12px;}
.oa-ft a{flex:1;text-align:center;padding:8px;border-radius:9px;background:linear-gradient(90deg,#FF5C00,#FF2C78);color:#fff;font-weight:700;text-decoration:none;}
.oa-note{font-size:12.5px;color:#FFD600;padding:0 12px 10px;cursor:pointer;}`;
    document.head.appendChild(s);
  }

  function updateSoundNote() {
    document.querySelectorAll('.oa-note').forEach(n => { n.hidden = !(ctx && ctx.state !== 'running' && get(MUTE) !== '1'); });
  }

  function card(o) {
    css();
    if (!box) { box = document.createElement('div'); box.id = 'oa-box'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const items = Array.isArray(o.items) ? o.items : [];
    const shown = items.slice(0, 3).map(it => {
      const img = typeof safeUrl === 'function' ? safeUrl(it.imageUrl) : '';
      const qty = Number(it.quantity) || 1;
      return `<div class="oa-item">${img ? `<img src="${img}" alt="">` : '<span class="ph"><i class="bi bi-image"></i></span>'}
        <div style="min-width:0;"><div class="n">${esc(it.productName || 'Product')}</div><div class="s">${[it.size ? 'Size ' + esc(it.size) : '', '× ' + qty].filter(Boolean).join(' · ')}</div></div>
        <span class="p">${peso((Number(it.price) || 0) * qty)}</span></div>`;
    }).join('') + (items.length > 3 ? `<div class="oa-row" style="color:#aaa;">and ${items.length - 3} more item${items.length - 3 === 1 ? '' : 's'}</div>` : '');
    const place = [o.streetAddress, o.barangay, o.city].filter(Boolean).join(', ');
    const el = document.createElement('div'); el.className = 'oa'; el.setAttribute('role', 'alert');
    el.innerHTML = `<div class="oa-hd"><i class="bi bi-bell-fill"></i><span class="t">New order <small>${typeof orderNo === 'function' ? esc(orderNo(o.id)) : ''}</small></span>
        <button type="button" data-mute title="Sound on or off"><i class="bi ${get(MUTE) === '1' ? 'bi-volume-mute' : 'bi-volume-up'}"></i></button>
        <button type="button" data-x title="Close" aria-label="Close">&times;</button></div>
      <div class="oa-body">${shown}
        <div class="oa-row"><i class="bi bi-person"></i><span>${esc(o.fullName || 'Customer')}${o.phone ? ' · ' + esc(o.phone) : ''}</span></div>
        <div class="oa-row"><i class="bi bi-geo-alt"></i><span>${esc(place || 'No address given')}${o.landmark ? `<br><span style="color:#999;">Near ${esc(o.landmark)}</span>` : ''}</span></div>
        <div class="oa-tot"><span>${o.isDownpayment ? `Downpayment paid ${peso(o.downpaymentAmount)}` : 'Paid with GCash'}</span><span>${peso(o.totalAmount)}</span></div>
      </div>
      <div class="oa-note" hidden>Click anywhere on the page to turn on the order sound.</div>
      <div class="oa-ft"><a href="order-detail.html?id=${encodeURIComponent(o.id)}">Open order <i class="bi bi-arrow-right"></i></a></div>`;
    el.querySelector('[data-x]').onclick = () => { el.remove(); stopFlash(); };
    el.querySelector('[data-mute]').onclick = e => {
      const m = get(MUTE) === '1' ? '0' : '1'; set(MUTE, m);
      document.querySelectorAll('.oa [data-mute] i').forEach(i => i.className = 'bi ' + (m === '1' ? 'bi-volume-mute' : 'bi-volume-up'));
      if (m === '0') ding();
      updateSoundNote(); e.stopPropagation();
    };
    box.prepend(el);
    while (box.children.length > 4) box.lastChild.remove();
    updateSoundNote();
  }

  function startFlash(n) {
    if (!document.hidden) return;
    stopFlash();
    let on = false;
    flash = setInterval(() => { document.title = (on = !on) ? `🔔 ${n} new order${n === 1 ? '' : 's'}` : baseTitle; }, 1000);
  }
  function stopFlash() { if (flash) { clearInterval(flash); flash = null; document.title = baseTitle; } }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) stopFlash(); });

  const ms = t => (t && typeof t.toMillis === 'function') ? t.toMillis() : 0;
  /** Called with every Pending snapshot: pops up orders placed since this browser last saw one. */
  function check(docs) {
    const now = Date.now();
    let seen = +get(SEEN) || 0;
    // First visit in this browser, or nothing new for over an hour: start from about now instead of popping up old
    // orders (a minute back, in case this computer's clock is a little ahead of the server's)
    if (!seen || now - seen > 3600000) { seen = now - 60000; set(SEEN, String(seen)); }
    const fresh = docs.map(d => ({ id: d.id, ...d.data() })).filter(o => ms(o.orderedAt) > seen).sort((a, b) => ms(a.orderedAt) - ms(b.orderedAt));
    if (fresh.length) set(SEEN, String(Math.max(seen, ...fresh.map(o => ms(o.orderedAt)))));
    if (!fresh.length) return;
    fresh.forEach(card);
    ding();
    startFlash(fresh.length);
  }
  return { check, ding };
})();
