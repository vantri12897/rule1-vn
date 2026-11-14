/* Service worker của Rule #1 Screener VN (app cài trên điện thoại / máy tính).
   Nguyên tắc: khi có mạng, mọi thứ vẫn lấy bản MỚI NHẤT từ website như trước, không đổi cách lưu đệm của trình duyệt.
   Chỉ khi mất mạng (hoặc mạng treo quá lâu) mới dùng bản đã lưu gần nhất trên máy, và báo cho trang biết để hiện nhãn "ngoại tuyến".
   Đổi VER khi sửa file này hoặc biểu tượng. */
const VER = 'v1';
const SHELL = 'r1vn-shell-' + VER;
const DATA = 'r1vn-data';
const CHART = 'r1vn-chart';
const MAX_CHARTS = 60;            // số mã biểu đồ giữ lại để xem ngoại tuyến
const NAV_WAIT = 4000;            // ms chờ trang trước khi dùng bản đã lưu
const DATA_WAIT = 7000;           // ms chờ máy chủ phản hồi dữ liệu trước khi dùng bản đã lưu
const SCOPE = new URL('./', self.registration.scope).href;
const SCOPE_PATH = new URL(SCOPE).pathname;
const SHELL_FILES = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];

const keyOf = u => u.origin + u.pathname;   // bỏ ?v=… để mỗi file chỉ giữ 1 bản
// giữ service worker sống tới khi lưu xong (nếu sự kiện đã kết thúc thì vẫn chạy tiếp, chỉ không được gia hạn)
const keep = (e, p) => { try { e.waitUntil(p); } catch (_) {} return p; };

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(SHELL_FILES.map(f => new Request(new URL(f, SCOPE), { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('r1vn-shell-') && k !== SHELL) await caches.delete(k);
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (_) {} }
    await self.clients.claim();
  })());
});

// Trang gửi 'warm' ngay sau lần cài đầu: lưu sẵn dữ liệu đang có để mở được khi mất mạng
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'warm') e.waitUntil(warm());
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (r.mode === 'navigate') {
    if (u.origin === location.origin && (u.pathname === SCOPE_PATH || u.pathname === SCOPE_PATH + 'index.html')) e.respondWith(nav(e));
    return;
  }
  if (u.origin === location.origin) {
    if (!u.href.startsWith(SCOPE)) return;
    if (u.pathname.startsWith(SCOPE_PATH + 'charts/')) return e.respondWith(netFirst(e, CHART, keyOf(u), DATA_WAIT, true));
    if (/\.(csv|json)$/i.test(u.pathname)) return e.respondWith(netFirst(e, DATA, keyOf(u), DATA_WAIT, false));
    if (u.pathname.startsWith(SCOPE_PATH + 'icons/') || u.pathname.endsWith('.webmanifest'))
      return e.respondWith(caches.match(keyOf(u)).then(c => c || fetch(r)));
    return;
  }
  if (u.hostname === 'raw.githubusercontent.com' && u.pathname.includes('/charts-data/'))
    return e.respondWith(netFirst(e, CHART, keyOf(u), DATA_WAIT, true));
  // các nguồn khác (phông chữ, thư viện biểu đồ): để trình duyệt tự xử lý như cũ
});

async function nav(e) {
  const cache = await caches.open(SHELL);
  const net = (async () => (await e.preloadResponse) || fetch(e.request))().then(res => {
    if (res.ok && res.type === 'basic' && !res.redirected) { const cp = res.clone(); keep(e, cache.put(SCOPE, cp).catch(() => {})); }
    return res;
  });
  return race(e, net, cache.match(SCOPE), NAV_WAIT, false);
}

// File có phiên bản trong địa chỉ (?v=… và cache:'no-cache': BCTC, giao dịch nội bộ, nến) chỉ ghi vào máy khi đổi phiên bản,
// không ghi lại 4 MB mỗi lần mở; file nhỏ đổi hằng ngày (giá…) ghi mỗi lần. Mỗi file chỉ giữ 1 bản.
async function netFirst(e, name, key, wait, trim) {
  const cache = await caches.open(name);
  const href = e.request.url;
  const versioned = e.request.cache === 'no-cache' && /[?&]v=/.test(new URL(href).search);
  const exact = versioned ? cache.match(href) : Promise.resolve(null);
  const cachedP = exact.then(h => h || cache.match(key, { ignoreSearch: true }));
  const net = fetch(e.request).then(async res => {
    if (res.ok && (res.type === 'basic' || res.type === 'cors') && !(await exact)) {
      const cp = res.clone();
      keep(e, (async () => {
        await cache.delete(key, { ignoreSearch: true });
        await cache.put(versioned ? href : key, cp);
        if (trim) await trimCache(cache);
      })().catch(() => {}));
    }
    return res;
  });
  return race(e, net, cachedP, wait, true);
}

// Mạng trả lời trước → dùng mạng. Mạng lỗi → dùng bản đã lưu. Mạng treo quá `wait` ms mà có bản đã lưu → dùng bản đã lưu.
async function race(e, net, cachedP, wait, tell) {
  net.catch(() => {});
  let timer;
  const slow = new Promise(ok => { timer = setTimeout(ok, wait); }).then(async () => {
    const c = await cachedP;
    if (!c) return net;
    if (tell) notify(e, 'slow');
    return c;
  });
  try {
    return await Promise.race([net, slow]);
  } catch (err) {
    const c = await cachedP;
    if (c) { if (tell) notify(e, 'offline'); return c; }
    throw err;
  } finally { clearTimeout(timer); }
}

async function notify(e, kind) {
  try {
    const c = e.clientId && await self.clients.get(e.clientId);
    if (c) c.postMessage({ type: 'r1vn-cache', kind, url: e.request.url });
  } catch (_) {}
}

async function trimCache(cache) {
  const ks = await cache.keys();
  for (let i = 0; i < ks.length - MAX_CHARTS; i++) await cache.delete(ks[i]);
}

async function warm() {
  const c = await caches.open(DATA);
  const get = async (path, cacheMode) => {
    try {
      const u = new URL(path, SCOPE);
      const res = await fetch(u, { cache: cacheMode });
      if (res.ok) { await c.delete(keyOf(u), { ignoreSearch: true }); await c.put(cacheMode === 'no-cache' ? u.href : keyOf(u), res.clone()); return res; }
    } catch (_) {}
    return null;
  };
  const now = '?v=' + Date.now();
  const m = await get('fundamentals_meta.json' + now, 'no-store');
  const meta = m ? await m.json().catch(() => null) : null;
  const ver = meta && (meta.checked || meta.updated);
  const vq = ver ? '?v=' + encodeURIComponent(ver) : now, mode = ver ? 'no-cache' : 'no-store';
  await Promise.all([
    get('rule1_data.csv' + vq, mode), get('insider.json' + vq, mode),
    get('prices.json' + now, 'no-store'), get('trends.json' + now, 'no-store'),
    get('commodities.json' + now, 'no-store'), get('newq.json' + now, 'no-store'),
  ]);
}
