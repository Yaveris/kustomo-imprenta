// =====================================================
//  KustomoImprenta Admin — Auth Guard & Sidebar Population
// =====================================================

// Global role — pages read this after auth resolves
window.ADMIN_ROLE = null;
window.ADMIN_UID  = null;

// Pages only a Super Admin may open. They stay hidden until the role is confirmed.
const OWNER_PAGES = ['settings.html', 'admins.html', 'keys.html', 'usage.html', 'export.html', 'database.html', 'cleanup.html'];

(function guard() {
  // The site's home page (index.html) is the public app download page; the admin login is login.html
  const page    = location.pathname.split('/').pop() || 'index.html';
  const isLogin = /^login(\.html)?$/.test(page);
  const ownerOnly = OWNER_PAGES.includes(page.endsWith('.html') ? page : page + '.html');
  if (ownerOnly) document.documentElement.classList.add('owner-check');

  auth.onAuthStateChanged(async user => {
    if (!user) {
      if (!isLogin) location.href = 'login.html';
      return;
    }

    try {
      const snap = await db.collection('users').doc(user.uid).get();
      const data = snap.data() || {};
      const role = data.role;

      if (role !== 'admin' && role !== 'super_admin') {
        await auth.signOut();
        location.href = 'login.html?err=access';
        return;
      }

      // Switched off on the Manage Admins page: no access until a super admin enables it again
      if (data.status === 'Disabled') {
        await auth.signOut();
        location.href = 'login.html?err=disabled';
        return;
      }

      if (isLogin) { location.href = 'dashboard.html'; return; }
      if (ownerOnly && role !== 'super_admin') { location.replace('dashboard.html?err=owner'); return; }
      document.documentElement.classList.remove('owner-check');
      startIdleTimer();

      // Expose globally
      window.ADMIN_ROLE = role;
      window.ADMIN_UID  = user.uid;

      // ── Fill sidebar ──
      const name      = `${data.firstName||''} ${data.lastName||''}`.trim() || user.email;
      const initial   = name.charAt(0).toUpperCase();
      const isSA      = role === 'super_admin';
      const roleLabel = isSA ? 'Super Admin' : 'Admin';

      el('admin-name')   && (el('admin-name').textContent   = name);
      el('admin-role')   && (el('admin-role').textContent   = roleLabel);
      el('admin-avatar') && (el('admin-avatar').textContent = initial);

      // Super Admin — golden avatar + yellow role label
      if (isSA) {
        const av = el('admin-avatar');
        if (av) av.style.background = 'linear-gradient(135deg, #FFD600, #FF5C00)';
        const rl = el('admin-role');
        if (rl) rl.style.color = '#FFD600';

        // Show "Manage Admins" nav link (hidden by default in HTML)
        document.querySelectorAll('.sa-only').forEach(el => el.style.display = 'block');
      }

      // Mark active nav link
      document.querySelectorAll('.sidebar-nav a').forEach(a => {
        if (a.getAttribute('href') === page) a.classList.add('active');
      });

      // Fire page-level callback if defined
      if (typeof window.onAuthReady === 'function') window.onAuthReady(user, role, data);

    } catch (e) {
      console.error('Auth guard:', e);
      if (!isLogin) location.href = 'login.html';
    }
  });
})();

function el(id) { return document.getElementById(id); }

function logout() {
  if (confirm('Logout of the admin panel?')) {
    auth.signOut().then(() => location.href = 'login.html');
  }
}

// Signs out after 30 minutes with no mouse, keyboard or touch activity, so a shared shop computer isn't left
// signed in. Activity in any open tab of the admin site keeps every tab signed in.
function startIdleTimer() {
  if (window._idleStarted) return;
  window._idleStarted = true;
  const LIMIT = 30 * 60 * 1000, KEY = 'admin-last-active';
  const mark = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} window._lastActive = Date.now(); };
  const last = () => { let t = window._lastActive || 0; try { t = Math.max(t, Number(localStorage.getItem(KEY)) || 0); } catch (e) {} return t; };
  let pending = false;
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(ev => window.addEventListener(ev, () => {
    if (pending) return; pending = true; setTimeout(() => { pending = false; mark(); }, 5000);
  }, { passive: true }));
  mark();
  setInterval(() => {
    if (Date.now() - last() > LIMIT) auth.signOut().then(() => location.href = 'login.html?err=idle');
  }, 60 * 1000);
}

// The dashboard says why it was opened instead of a Super Admin page
if (new URLSearchParams(location.search).get('err') === 'owner') {
  window.addEventListener('load', () => typeof toast === 'function' && toast('That page is for Super Admin accounts only.', 'warn'));
}
