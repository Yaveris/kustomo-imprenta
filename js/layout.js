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
      ['customers.html', 'bi-people', 'Customers'],
      ['employees.html', 'bi-person-vcard', 'Employees']
    ]],
    ['Catalog', [
      ['products.html', 'bi-box-seam', 'Products &amp; Stock'],
      ['home-page.html', 'bi-house-heart', 'Home Page'],
      ['design.html', 'bi-palette', 'Design Studio'],
      ['design-library.html', 'bi-collection', 'Design Library'],
      ['studio-settings.html', 'bi-sliders2', 'Studio Settings'],
      ['models.html', 'bi-badge-3d', '3D Models']
    ]],
    ['Super Admin', [
      ['settings.html', 'bi-sliders', 'Shop Settings', true],
      ['payments.html', 'bi-credit-card', 'Payments', true],
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
      OrderAlert.start();
      stops.push(db.collection('orders').where('status', '==', 'Pending').onSnapshot(s => {
        setBadge('nb-orders', s.size, s.size + ' waiting in Pending');
        if (typeof deductNewOrders === 'function') deductNewOrders(s.docs);
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

// ── Order cards (bottom-right of every admin page) ──────────────────────────────────────────────────
// Every order that isn't finished keeps a card here until it is Delivered or turned down (Cancelled); a card can't be
// closed. At most 4 show, most urgent first (Pending, then Ready, Processing, Printing, Out for delivery; oldest
// first within each), and the rest are counted underneath.
// A Pending order is paid and waiting for the shop: its card is the full one, and it rings every 10 seconds until
// someone accepts it or turns it down, on any computer. The cards follow the orders' status in the database, so
// refreshing, changing pages or opening an order changes nothing.
const OrderAlert = (() => {
  const RING_EVERY = 10000, MAX_CARDS = 4;
  const ACTIVE = ['Pending', 'Ready', 'Processing', 'Printing', 'Delivering'];   // also the priority order
  // The next step a one-line card offers: [new status, button label]
  const NEXT = { Processing: ['Printing', 'Printing ▸'], Printing: ['Ready', 'Ready ▸'], Delivering: ['Delivered', 'Delivered ✓'] };
  let ctx = null, box = null, bar = null, baseTitle = document.title, flash = null, ringTimer = null;
  let orders = [], known = null, started = false, busy = {};
  const ms = t => (t && typeof t.toMillis === 'function') ? t.toMillis() : 0;

  // Browsers only allow sound after someone has clicked or typed on the page, so the first click switches it on.
  function audio() {
    if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ctx = new A(); }
    if (ctx.state === 'suspended') ctx.resume().then(soundBar).catch(() => {});
    return ctx;
  }
  ['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => { audio(); setTimeout(soundBar, 50); }, { capture: true }));
  const soundOn = () => !!(ctx && ctx.state === 'running');

  function ding() {
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
#oa-box{position:fixed;right:20px;bottom:20px;z-index:9998;display:flex;flex-direction:column;gap:8px;width:350px;max-width:calc(100vw - 32px);max-height:calc(100vh - 40px);overflow-y:auto;}
.oa{background:#16161c;border:1px solid rgba(255,92,0,.6);border-radius:14px;box-shadow:0 0 0 3px rgba(255,92,0,.3),0 14px 40px rgba(0,0,0,.55);overflow:hidden;font-size:14px;color:#eee;flex-shrink:0;animation:oa-in .28s ease-out;}
.oa.pulse{animation:oa-pulse 1.4s ease-in-out infinite;}
@keyframes oa-in{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}
@keyframes oa-pulse{0%,100%{box-shadow:0 0 0 3px rgba(255,92,0,.3),0 14px 40px rgba(0,0,0,.55)}50%{box-shadow:0 0 0 7px rgba(255,92,0,.5),0 14px 40px rgba(0,0,0,.55)}}
@media (prefers-reduced-motion: reduce){.oa,.oa.pulse{animation:none;}}
.oa-hd{display:flex;align-items:center;gap:8px;padding:10px 12px;background:linear-gradient(90deg,rgba(255,92,0,.22),rgba(255,44,120,.12));font-weight:800;}
.oa-hd .bi-bell-fill{color:#FF5C00;animation:oa-ring 1s ease-in-out infinite;}
@keyframes oa-ring{0%,60%,100%{transform:rotate(0)}10%{transform:rotate(18deg)}25%{transform:rotate(-14deg)}40%{transform:rotate(8deg)}}
.oa-hd .t{flex:1;} .oa-hd small{font-weight:600;color:#aaa;}
.oa-paid{justify-self:start;padding:2px 9px;border-radius:9px;background:rgba(0,230,118,.14);color:#00E676;font-size:12px;font-weight:700;}
.oa-body{padding:10px 12px;display:grid;gap:8px;}
.oa-item{display:flex;gap:10px;align-items:center;}
.oa-item img,.oa-item .ph{width:46px;height:46px;border-radius:8px;object-fit:cover;background:rgba(255,255,255,.06);flex-shrink:0;display:grid;place-items:center;color:#777;}
.oa-item .n{font-weight:700;line-height:1.3;} .oa-item .s{color:#aaa;font-size:13px;}
.oa-item .p{margin-left:auto;font-weight:800;color:#FF5C00;white-space:nowrap;}
.oa-row{display:flex;gap:8px;color:#ccc;line-height:1.4;} .oa-row i{color:#888;margin-top:1px;}
.oa-ft{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 12px 12px;}
.oa-ft a,.oa-ft button{text-align:center;padding:8px;border-radius:9px;font-weight:700;text-decoration:none;border:0;font-size:13.5px;cursor:pointer;white-space:nowrap;color:#fff;font-family:inherit;}
.oa-ft .oa-ok{background:#1E9E57;} .oa-ft .oa-no{background:transparent;border:1px solid rgba(255,107,107,.5);color:#FF8A8A;}
.oa-ft .oa-open{background:linear-gradient(90deg,#FF5C00,#FF2C78);} .oa-ft .oa-slip{background:transparent;border:1px solid rgba(255,255,255,.18);color:#ddd;}
.oa-mini{display:flex;align-items:center;gap:9px;padding:9px 10px 9px 12px;border-radius:12px;background:#1c1c22;border:1px solid #2e2e36;box-shadow:0 8px 24px rgba(0,0,0,.4);font-size:13px;color:#eee;flex-shrink:0;}
.oa-mini .dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;}
.oa-mini .tx{flex:1;min-width:0;line-height:1.3;} .oa-mini .tx b{font-weight:700;} .oa-mini .tx span{display:block;color:#aaa;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.oa-mini a,.oa-mini button{flex-shrink:0;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#eee;font-weight:700;font-size:12.5px;cursor:pointer;text-decoration:none;font-family:inherit;white-space:nowrap;}
.oa-mini a:hover,.oa-mini button:hover{border-color:#FF5C00;color:#FF7A33;}
.oa-mini button:disabled{opacity:.5;cursor:default;}
.oa-more{flex-shrink:0;text-align:center;padding:7px;border-radius:10px;background:#1c1c22;border:1px dashed #3a3a44;color:#FF7A33;font-weight:700;font-size:13px;text-decoration:none;}
#oa-sound{position:fixed;top:0;left:0;right:0;z-index:9999;display:flex;align-items:center;justify-content:center;gap:10px;padding:10px 16px;background:#FFD600;color:#1a1400;font-weight:800;font-size:14.5px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.35);}
#oa-sound small{font-weight:600;}`;
    document.head.appendChild(s);
  }

  /** The yellow bar: an order is waiting, but the browser hasn't allowed sound yet (no click on this page). */
  function soundBar() {
    const need = orders.some(o => o.status === 'Pending') && !soundOn();
    if (need && !bar) {
      css();
      bar = document.createElement('div'); bar.id = 'oa-sound'; bar.setAttribute('role', 'button'); bar.tabIndex = 0;
      bar.innerHTML = '🔊 Click anywhere to turn on the order ring <small>· a paid order is waiting</small>';
      document.body.appendChild(bar);
    }
    if (!need && bar) { bar.remove(); bar = null; }
  }

  const rank = o => ACTIVE.indexOf(o.status);
  const place = o => [o.streetAddress, o.barangay, o.city].filter(Boolean).join(', ');
  const paidText = o => o.isDownpayment ? `Downpayment paid ${peso(o.downpaymentAmount)}` : `Paid ${peso(o.totalAmount)}`;

  function fullCard(o) {
    const items = Array.isArray(o.items) ? o.items : [];
    const shown = items.slice(0, 3).map(it => {
      const img = typeof safeUrl === 'function' ? (safeUrl(it.previewUrl) || safeUrl(it.imageUrl)) : '';
      const qty = Number(it.quantity) || 1;
      return `<div class="oa-item">${img ? `<img src="${img}" alt="">` : '<span class="ph"><i class="bi bi-image"></i></span>'}
        <div style="min-width:0;"><div class="n">${esc(it.productName || 'Product')}</div><div class="s">${[it.size ? 'Size ' + esc(it.size) : '', '× ' + qty].filter(Boolean).join(' · ')}</div></div>
        <span class="p">${peso((Number(it.price) || 0) * qty)}</span></div>`;
    }).join('') + (items.length > 3 ? `<div class="oa-row" style="color:#aaa;">and ${items.length - 3} more item${items.length - 3 === 1 ? '' : 's'}</div>` : '');
    const phone = o.phone ? ' · ' + esc(typeof prettyPhone === 'function' ? prettyPhone(o.phone) : o.phone) : '';
    return `<div class="oa pulse" role="alert" data-id="${esc(o.id)}">
      <div class="oa-hd"><i class="bi bi-bell-fill"></i><span class="t">New order <small>${esc(orderNo(o.id))}</small></span><span class="oa-paid">${esc(paidText(o))} · GCash</span></div>
      <div class="oa-body">${shown}
        <div class="oa-row"><i class="bi bi-person"></i><span>${esc(o.fullName || 'Customer')}${phone}</span></div>
        <div class="oa-row"><i class="bi bi-geo-alt"></i><span>${esc(place(o) || 'No address given')}${o.landmark ? `<br><span style="color:#999;">Near ${esc(o.landmark)}</span>` : ''}</span></div>
      </div>
      <div class="oa-ft">
        ${typeof openAcceptOrder === 'function' ? `<button type="button" class="oa-ok" data-act="accept"><i class="bi bi-check-lg"></i> Accept</button>` : ''}
        ${typeof openDeclineOrder === 'function' ? `<button type="button" class="oa-no" data-act="decline">Can't take it</button>` : ''}
        <a class="oa-open" href="order-detail.html?id=${encodeURIComponent(o.id)}">Open order</a>
        ${typeof printOrderSlip === 'function' ? `<button type="button" class="oa-slip" data-act="slip"><i class="bi bi-printer"></i> Slip</button>` : ''}
      </div></div>`;
  }

  function miniCard(o) {
    const key = String(o.status).toLowerCase(), next = NEXT[o.status];
    const btn = next && typeof setOrderStatus === 'function'
      ? `<button type="button" data-act="next" ${busy[o.id] ? 'disabled' : ''} title="Set to ${esc(statusLabel(next[0]))}">${next[1]}</button>`
      : `<a href="order-detail.html?id=${encodeURIComponent(o.id)}">Open</a>`;
    return `<div class="oa-mini" data-id="${esc(o.id)}"><span class="dot" style="background:var(--s-${key},#888);"></span>
      <a class="tx" href="order-detail.html?id=${encodeURIComponent(o.id)}" style="border:0;padding:0;font-weight:400;color:inherit;"><b>${esc(orderNo(o.id))}</b> · ${esc(o.fullName || 'Customer')}<span>${esc(statusLabel(o.status))}${o.driver && o.driver.name && o.status === 'Delivering' ? ' · ' + esc(o.driver.name) : ''}</span></a>
      ${btn}</div>`;
  }

  function render() {
    if (!box) { css(); box = document.createElement('div'); box.id = 'oa-box'; box.setAttribute('aria-live', 'polite'); box.setAttribute('aria-label', 'Orders to handle'); document.body.appendChild(box); }
    const list = orders.slice().sort((a, b) => rank(a) - rank(b) || ms(a.orderedAt) - ms(b.orderedAt));
    const shown = list.slice(0, MAX_CARDS), more = list.length - shown.length;
    box.innerHTML = shown.map(o => o.status === 'Pending' ? fullCard(o) : miniCard(o)).join('') +
      (more > 0 ? `<a class="oa-more" href="orders.html">+ ${more} more active order${more === 1 ? '' : 's'} · Orders <i class="bi bi-arrow-right"></i></a>` : '');
    box.hidden = !list.length;
  }

  // One handler for every card button (the cards are redrawn whenever an order changes)
  document.addEventListener('click', async e => {
    const btn = e.target.closest('#oa-box [data-act]'); if (!btn) return;
    const id = btn.closest('[data-id]').dataset.id, o = orders.find(x => x.id === id); if (!o) return;
    const act = btn.dataset.act;
    if (act === 'accept') openAcceptOrder(o);
    else if (act === 'decline') openDeclineOrder(o);
    else if (act === 'slip') printOrderSlip(o);
    else if (act === 'next') {
      const [to] = NEXT[o.status];
      if (to === 'Delivered' && !confirm(`Mark ${orderNo(o.id)} as delivered?`)) return;
      busy[id] = true; render();
      try {
        await setOrderStatus(id, to);
        toast(`${orderNo(id)}: ${statusLabel(to)}`, 'ok');
        if (to === 'Delivered' && o.isDownpayment && !o.balancePaidAt && typeof setBalanceCollected === 'function' &&
            confirm(`Was the balance of ${peso(o.remainingAmount)} collected? Press OK to mark it as collected.`)) await setBalanceCollected(id, true);
      } catch (err) { toast('Not changed: ' + err.message, 'err'); }
      finally { delete busy[id]; render(); }
    }
  });

  function startFlash() {
    if (flash) return;
    let on = false;
    flash = setInterval(() => {
      const n = orders.filter(o => o.status === 'Pending').length;
      if (!n) { stopFlash(); return; }
      if (!document.hidden && soundOn()) { document.title = baseTitle; return; }
      document.title = (on = !on) ? `🔔 ${n} paid order${n === 1 ? '' : 's'} waiting` : baseTitle;
    }, 1000);
  }
  function stopFlash() { if (flash) { clearInterval(flash); flash = null; document.title = baseTitle; } }

  /** Rings while any order is Pending. */
  function syncRing() {
    const any = orders.some(o => o.status === 'Pending');
    if (any && !ringTimer) ringTimer = setInterval(() => { if (orders.some(o => o.status === 'Pending')) ding(); }, RING_EVERY);
    if (!any && ringTimer) { clearInterval(ringTimer); ringTimer = null; }
    if (any) startFlash(); else stopFlash();
    soundBar();
  }

  /** Watches the orders that aren't finished (called once signed in, on every admin page with the sidebar). */
  function start() {
    if (started || typeof db === 'undefined') return;
    started = true;
    db.collection('orders').where('status', 'in', ACTIVE).onSnapshot(snap => {
      // The browser's saved copy can come first and be incomplete; the cards follow whatever is current, so a
      // short gap fixes itself on the next snapshot
      orders = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(o => ACTIVE.includes(o.status));
      const pending = orders.filter(o => o.status === 'Pending').map(o => o.id);
      const fresh = known ? pending.filter(id => !known.has(id)) : pending;
      known = new Set(pending);
      render(); syncRing();
      if (fresh.length) ding();   // straight away for a new order (the 10-second repeat follows)
    }, err => console.warn('Order cards: ' + err.message));
  }

  /** Kept for the pages that still call it: the cards follow the orders' status by themselves. */
  function handled() { render(); }
  return { start, ding, handled };
})();
