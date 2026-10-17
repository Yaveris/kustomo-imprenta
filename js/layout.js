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
