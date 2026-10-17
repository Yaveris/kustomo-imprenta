// =====================================================
//  KustomoImprenta Admin — Shop location, maps and distances
//  Everything here uses OpenStreetMap's free services, so there is no key or billing to set up:
//    map pictures   Leaflet with OpenStreetMap tiles
//    address search Nominatim (OpenStreetMap's search)
//    road distance  OSRM's public route server
//  The shop's location is saved in Firestore appConfig/shop.shopLocation by a Super Admin (for everyone). Any other
//  admin can set one for their own account (users/{uid}.shopLocation), which only their screens use.
//  Needs js/firebase.js first; ADMIN_ROLE comes from js/auth.js.
// =====================================================

const LEAFLET = {
  js: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js', jsSri: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
  css: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css', cssSri: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='
};
const MAP_START = { lat: 14.6507, lng: 120.9676 };   // Caloocan, before a location is set

let _leaflet = null;
/** Loads the map library once; resolves to Leaflet's `L`. */
function loadLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (!_leaflet) _leaflet = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = LEAFLET.css; css.integrity = LEAFLET.cssSri; css.crossOrigin = 'anonymous';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = LEAFLET.js; js.integrity = LEAFLET.jsSri; js.crossOrigin = 'anonymous';
    js.onload = () => resolve(window.L);
    js.onerror = () => { _leaflet = null; reject(new Error("The map couldn't load. Check the internet connection.")); };
    document.head.appendChild(js);
  });
  return _leaflet;
}
/** A map in `el` with OpenStreetMap tiles (and their credit, which their terms ask for). */
function makeMap(L, el, opts) {
  const map = L.map(el, Object.assign({ zoomControl: true, attributionControl: true }, opts || {}));
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  }).addTo(map);
  return map;
}
function mapPin(L, kind) {
  return L.divIcon({ className: 'map-pin ' + kind, html: `<span><i class="bi ${kind === 'shop' ? 'bi-shop' : 'bi-house-door-fill'}"></i></span>`, iconSize: [34, 40], iconAnchor: [17, 40] });
}

// ── Distances ───────────────────────────────────────────────────────────────────────────────────────
/** Straight-line distance in km between two {lat, lng}. */
function distanceKm(a, b) {
  const R = 6371, rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function fmtKm(km) {
  if (!(km >= 0)) return '—';
  if (km < 1) return Math.max(10, Math.round(km * 100) * 10) + ' m';
  return (km < 10 ? km.toFixed(1) : String(Math.round(km))) + ' km';
}
function fmtMinutes(m) {
  if (!(m >= 0)) return '';
  if (m < 60) return Math.max(1, Math.round(m)) + ' min';
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return h + ' hr' + (r ? ' ' + r + ' min' : '');
}
const _memo = (key, make) => {
  try { const c = sessionStorage.getItem(key); if (c) return Promise.resolve(JSON.parse(c)); } catch (e) {}
  return make().then(v => { try { if (v) sessionStorage.setItem(key, JSON.stringify(v)); } catch (e) {} return v; });
};
/** The driving route between two points: {km, minutes, line: [[lat, lng], …]}, or null when none is found. */
function roadRoute(a, b) {
  const key = 'route:' + [a.lat, a.lng, b.lat, b.lng].map(n => Number(n).toFixed(5)).join(',');
  return _memo(key, async () => {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Route server: HTTP ' + res.status);
    const j = await res.json();
    const r = j && j.code === 'Ok' && j.routes && j.routes[0];
    if (!r) return null;
    return { km: r.distance / 1000, minutes: r.duration / 60, line: ((r.geometry && r.geometry.coordinates) || []).map(([x, y]) => [y, x]) };
  });
}

// ── Address search ──────────────────────────────────────────────────────────────────────────────────
/** Places matching `q` in the Philippines: [{lat, lng, label}]. */
async function findPlaces(q, limit) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ph&accept-language=en&limit=' + (limit || 5) + '&q=' + encodeURIComponent(q);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Address search: HTTP ' + res.status);
  const list = await res.json();
  return (Array.isArray(list) ? list : []).map(r => ({ lat: +r.lat, lng: +r.lon, label: String(r.display_name || '') })).filter(r => isFinite(r.lat) && isFinite(r.lng));
}
/** The address at a point, or ''. */
async function placeName(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=en&lat=${lat}&lon=${lng}`);
    if (!res.ok) return '';
    const j = await res.json();
    return String((j && j.display_name) || '');
  } catch (e) { return ''; }
}

// ── Orders ──────────────────────────────────────────────────────────────────────────────────────────
/** The pin the customer dropped in the app, or null. */
function orderPin(o) {
  const ok = n => typeof n === 'number' && isFinite(n) && n !== 0;
  return ok(o.addressLat) && ok(o.addressLng) ? { lat: o.addressLat, lng: o.addressLng } : null;
}
/** The delivery address as lines: street, then barangay, city and zip. */
function orderAddressLines(o) {
  const brgy = String(o.barangay || '').trim();
  const area = [brgy ? (/^(brgy|barangay)\b/i.test(brgy) ? brgy : 'Brgy. ' + brgy) : '', [o.city, o.zipCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [String(o.streetAddress || '').trim(), area].filter(Boolean);
}
/** Where the order goes: the customer's pin, else a point found from the written address ({…, approx: true}), or null. */
function orderPoint(o) {
  const pin = orderPin(o);
  if (pin) return Promise.resolve(pin);
  const full = orderAddressLines(o).join(', '), area = [o.barangay, o.city].filter(Boolean).join(', ');
  if (!full) return Promise.resolve(null);
  return _memo('geo:' + full, async () => {
    for (const q of [full, area].filter(Boolean)) {
      const hit = (await findPlaces(q, 1))[0];
      if (hit) return { lat: hit.lat, lng: hit.lng, approx: true, from: q === full ? 'address' : 'area' };
    }
    return null;
  }).catch(() => null);
}
/** Google Maps directions from the shop (or "my location" when none is set) to the order. */
function directionsUrl(shop, o) {
  const pin = orderPin(o);
  const dest = pin ? `${pin.lat},${pin.lng}` : orderAddressLines(o).join(', ');
  return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(dest) + (shop ? '&origin=' + encodeURIComponent(`${shop.lat},${shop.lng}`) : '');
}

// ── The shop's location ─────────────────────────────────────────────────────────────────────────────
let _shopLoc = null;
/** {lat, lng, address, mine} — mine: true when it's this admin's own (set on their account) — or null when not set. */
function loadShopLocation(force) {
  if (!_shopLoc || force) {
    _shopLoc = (async () => {
      const valid = v => v && typeof v.lat === 'number' && typeof v.lng === 'number' ? v : null;
      const u = auth.currentUser;
      if (u) {
        try { const me = await db.collection('users').doc(u.uid).get(); const mine = valid((me.data() || {}).shopLocation); if (mine) return Object.assign({}, mine, { mine: true }); } catch (e) {}
      }
      const shop = await loadShopSettings(force);
      const s = valid(shop.shopLocation);
      return s ? Object.assign({}, s, { mine: false }) : null;
    })();
  }
  return _shopLoc;
}
/** Saves the location: for everyone when signed in as a Super Admin, else on this admin's own account. */
async function saveShopLocation(loc) {
  const v = { lat: Math.round(loc.lat * 1e6) / 1e6, lng: Math.round(loc.lng * 1e6) / 1e6, address: String(loc.address || '').slice(0, 300),
    updatedBy: (auth.currentUser && auth.currentUser.email) || '', updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
  const uid = auth.currentUser.uid, before = await loadShopLocation().catch(() => null);
  if (window.ADMIN_ROLE === 'super_admin') {
    await db.collection('appConfig').doc('shop').set({ shopLocation: v }, { merge: true });
    if (before && before.mine) await db.collection('users').doc(uid).update({ shopLocation: firebase.firestore.FieldValue.delete() }).catch(() => {});
  } else {
    await db.collection('users').doc(uid).update({ shopLocation: v });
  }
  _shop = null; _shopLoc = null;
  return window.ADMIN_ROLE === 'super_admin' ? 'shop' : 'mine';
}

/** Opens the location picker; resolves to the saved location, or null when closed without saving. */
function pickShopLocation() {
  let box = document.getElementById('loc-overlay');
  if (!box) {
    box = document.createElement('div');
    box.className = 'overlay'; box.id = 'loc-overlay';
    box.innerHTML = `<div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="loc-title">
      <div class="modal-hd"><h3 id="loc-title"><i class="bi bi-shop" style="color:var(--orange);margin-right:6px;"></i>Your shop's location</h3><button class="modal-x" data-x aria-label="Close">&times;</button></div>
      <div class="modal-bd">
        <p class="note" style="margin-bottom:12px;">Search the shop's address, or press <strong>Use where I am</strong> while you're at the shop. Then drag the pin onto the exact spot.</p>
        <form class="loc-search" id="loc-form"><input class="inp" id="loc-q" placeholder="e.g. 123 Rizal Ave, Caloocan" aria-label="Search an address">
          <button class="btn-ghost" type="submit"><i class="bi bi-search"></i> Search</button>
          <button class="btn-ghost" type="button" id="loc-gps"><i class="bi bi-crosshair"></i> Use where I am</button></form>
        <div class="loc-results" id="loc-results"></div>
        <div class="loc-map" id="loc-map"></div>
        <div class="loc-addr" id="loc-addr">Click the map to drop the pin.</div>
        <p class="note" id="loc-who" style="margin-top:8px;"></p>
      </div>
      <div class="modal-ft"><button class="btn-ghost" data-x>Cancel</button><button class="btn-grad" id="loc-save" disabled><i class="bi bi-check-lg"></i> Save location</button></div>
    </div>`;
    document.body.appendChild(box);
  }
  const $l = id => document.getElementById(id);
  return new Promise(async resolve => {
    let map = null, pin = null, picked = null, nameTimer = null, done = false;
    const finish = v => {
      if (done) return; done = true;
      box.classList.remove('show');
      setTimeout(() => { if (map) map.remove(); }, 250);
      box.querySelectorAll('[data-x]').forEach(b => b.onclick = null);
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = e => { if (e.key === 'Escape') finish(null); };
    box.querySelectorAll('[data-x]').forEach(b => b.onclick = () => finish(null));
    box.onclick = e => { if (e.target === box) finish(null); };
    document.addEventListener('keydown', onKey);
    $l('loc-who').textContent = window.ADMIN_ROLE === 'super_admin'
      ? 'Saved for every admin. Distances to customers are measured from here.'
      : 'Saved for your account only. A Super Admin can set it for everyone in Shop Settings.';
    $l('loc-q').value = ''; $l('loc-results').innerHTML = ''; $l('loc-save').disabled = true;
    box.classList.add('show');

    const current = await loadShopLocation().catch(() => null);
    let L;
    try { L = await loadLeaflet(); } catch (e) { $l('loc-addr').textContent = e.message; return; }
    if (done) return;
    map = makeMap(L, $l('loc-map'));
    const start = current || MAP_START;
    map.setView([start.lat, start.lng], current ? 17 : 13);
    setTimeout(() => map.invalidateSize(), 220);
    const place = (lat, lng, label) => {
      picked = { lat, lng, address: label || '' };
      if (!pin) {
        pin = L.marker([lat, lng], { draggable: true, icon: mapPin(L, 'shop') }).addTo(map);
        pin.on('dragend', () => { const p = pin.getLatLng(); place(p.lat, p.lng); });
      } else pin.setLatLng([lat, lng]);
      $l('loc-save').disabled = false;
      $l('loc-addr').innerHTML = label ? `<i class="bi bi-geo-alt-fill"></i> ${esc(label)}` : '<i class="bi bi-hourglass-split"></i> Finding the address…';
      if (!label) {
        clearTimeout(nameTimer);
        nameTimer = setTimeout(async () => {
          const name = await placeName(lat, lng);
          if (done || !picked || picked.lat !== lat || picked.lng !== lng) return;
          picked.address = name;
          $l('loc-addr').innerHTML = `<i class="bi bi-geo-alt-fill"></i> ${name ? esc(name) : `${lat.toFixed(5)}, ${lng.toFixed(5)}`}`;
        }, 500);
      }
    };
    if (current) place(current.lat, current.lng, current.address || `${current.lat.toFixed(5)}, ${current.lng.toFixed(5)}`);
    map.on('click', e => place(e.latlng.lat, e.latlng.lng));

    $l('loc-form').onsubmit = async e => {
      e.preventDefault();
      const q = $l('loc-q').value.trim(); if (!q) return;
      $l('loc-results').innerHTML = '<div class="note">Searching…</div>';
      try {
        const hits = await findPlaces(q, 5);
        $l('loc-results').innerHTML = hits.length ? hits.map((h, i) => `<button type="button" data-i="${i}"><i class="bi bi-geo-alt"></i> ${esc(h.label)}</button>`).join('')
          : '<div class="note">Nothing found. Try the street and city only, or click the map.</div>';
        $l('loc-results').querySelectorAll('button').forEach(b => b.onclick = () => {
          const h = hits[+b.dataset.i]; map.setView([h.lat, h.lng], 18); place(h.lat, h.lng, h.label); $l('loc-results').innerHTML = '';
        });
      } catch (err) { $l('loc-results').innerHTML = `<div class="note" style="color:#FF6B6B;">Search failed: ${esc(err.message)}</div>`; }
    };
    $l('loc-gps').onclick = () => {
      if (!navigator.geolocation) { toast("This browser can't share its location", 'warn'); return; }
      $l('loc-addr').innerHTML = '<i class="bi bi-hourglass-split"></i> Asking the browser where you are…';
      navigator.geolocation.getCurrentPosition(p => { map.setView([p.coords.latitude, p.coords.longitude], 18); place(p.coords.latitude, p.coords.longitude); },
        err => { $l('loc-addr').textContent = err.code === 1 ? 'Location access was blocked. Allow it in the browser, or search the address instead.' : "Couldn't get your location. Search the address instead."; },
        { enableHighAccuracy: true, timeout: 15000 });
    };
    $l('loc-save').onclick = async () => {
      if (!picked) return;
      $l('loc-save').disabled = true;
      try {
        if (!picked.address) picked.address = await placeName(picked.lat, picked.lng);
        const where = await saveShopLocation(picked);
        toast(where === 'shop' ? 'Shop location saved' : 'Location saved for your account', 'ok');
        finish(await loadShopLocation(true));
      } catch (err) {
        toast(err.code === 'permission-denied' ? 'Not saved: the database rules need updating (App Keys → For your developer).' : 'Not saved: ' + err.message, 'err');
        $l('loc-save').disabled = false;
      }
    };
  });
}

/** Draws the shop, the customer and the road between them in `el` (route: from roadRoute, or null for a straight line). */
async function drawDeliveryMap(el, shop, dest, route) {
  const L = await loadLeaflet();
  if (el._map) { el._map.remove(); el._map = null; }
  const map = makeMap(L, el, { scrollWheelZoom: false });
  el._map = map;
  const pts = [];
  if (dest) { L.marker([dest.lat, dest.lng], { icon: mapPin(L, 'home') }).addTo(map).bindTooltip(dest.approx ? 'Customer (approximate)' : 'Customer'); pts.push([dest.lat, dest.lng]); }
  if (shop) { L.marker([shop.lat, shop.lng], { icon: mapPin(L, 'shop') }).addTo(map).bindTooltip('Your shop'); pts.push([shop.lat, shop.lng]); }
  if (shop && dest) {
    if (route && route.line && route.line.length > 1) L.polyline(route.line, { color: '#FF5C00', weight: 5, opacity: .85 }).addTo(map);
    else L.polyline(pts, { color: '#FF5C00', weight: 3, dashArray: '6 8' }).addTo(map);
  }
  if (pts.length > 1) map.fitBounds(L.latLngBounds(route && route.line && route.line.length > 1 ? route.line.concat(pts) : pts), { padding: [28, 28] });
  else if (pts.length) map.setView(pts[0], 16);
  else map.setView([MAP_START.lat, MAP_START.lng], 12);
  setTimeout(() => map.invalidateSize(), 200);
  return map;
}
