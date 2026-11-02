/* Contas da Família — service worker
   • Pré-cache da app (funciona offline), cache-first com versões
   • Notificações do sistema (registration.showNotification)
   • Periodic Background Sync 'contas-check': lê os dados do IndexedDB e avisa de contas a vencer/em atraso
   Para publicar uma nova versão: alterar VERSION (os clientes recebem "Nova versão disponível"). */
const VERSION = '1.0.0';
const CACHE = 'contas-familia-' + VERSION;
const SHELL = [
  './', './index.html', './manifest.json', './icon.svg',
  './icon-192.png', './icon-512.png', './icon-maskable-192.png', './icon-maskable-512.png',
  './apple-touch-icon.png', './favicon.ico', './favicon-32.png', './badge-96.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
  // primeira instalação ativa logo; atualizações esperam pelo "Atualizar" na app
  if (!self.registration.active) self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k.startsWith('contas-familia-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./index.html').then(hit => hit || fetch(req)).catch(() => caches.match('./')));
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }))
  );
});

/* ---------- Notificações ---------- */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus(); }
    return self.clients.openWindow(target);
  }));
});

/* ---------- IndexedDB (espelho escrito pela app em cada gravação) ---------- */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('contas-familia', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function kvGet(k) { const db = await idb(); return new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => { db.close(); res(q.result); }; q.onerror = () => { db.close(); res(undefined); }; }); }
async function kvSet(k, v) { const db = await idb(); return new Promise(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => { db.close(); res(); }; t.onerror = () => { db.close(); res(); }; }); }

/* ---------- Lógica das contas (igual à da app) ---------- */
const mk = (y, m) => y + '-' + String(m).padStart(2, '0');
const mkOf = d => mk(d.getFullYear(), d.getMonth() + 1);
const addM = (k, n) => { let y = +k.slice(0, 4), m = +k.slice(5) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return mk(y, m + 1); };
const daysIn = k => new Date(+k.slice(0, 4), +k.slice(5), 0).getDate();
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const eur = v => (Math.round(v * 100) / 100).toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
function amountFor(e, k) { let v = null; (e.amounts || []).forEach(a => { if (a.from <= k) v = a.amount; }); return v; }
function activeIn(e, k) {
  if (e.skip && e.skip.includes(k)) return false;
  if (!e.recurring) return e.from === k;
  if (e.from && k < e.from) return false;
  if (e.to && k > e.to) return false;
  return amountFor(e, k) !== null;
}
function dueAlerts(DB, today) {
  const cur = mkOf(today), prev = addM(cur, -1), tom = new Date(today); tom.setDate(tom.getDate() + 1);
  const months = [prev, cur]; if (mkOf(tom) !== cur) months.push(mkOf(tom));
  const out = [];
  months.forEach(k => {
    if (k === prev && !(DB.paid && DB.paid[k])) return;
    (DB.expenses || []).forEach(e => {
      if (!activeIn(e, k) || (DB.paid && DB.paid[k] && DB.paid[k][e.id])) return;
      const due = new Date(+k.slice(0, 4), +k.slice(5) - 1, Math.min(e.day, daysIn(k)));
      const diff = Math.round((due - today) / 864e5);
      const st = diff < 0 ? 'over' : diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : null;
      if (st) out.push({ e, k, st, amount: amountFor(e, k) });
    });
  });
  return out;
}
async function checkAndNotify() {
  if (self.Notification && Notification.permission !== 'granted') return;
  const DB = await kvGet('db');
  if (!DB || !Array.isArray(DB.expenses)) return;
  const d = new Date(), today = new Date(d.getFullYear(), d.getMonth(), d.getDate()), t = iso(today);
  let sent = (await kvGet('swSent')) || {};
  Object.keys(sent).forEach(k => { if (k.slice(0, 10) !== t) delete sent[k]; });
  const seen = Object.assign({}, DB.notified || {}, sent);
  const fresh = dueAlerts(DB, today).filter(x => !seen[t + '|' + x.k + '|' + x.e.id + '|' + x.st]);
  if (!fresh.length) { await kvSet('swSent', sent); return; }
  fresh.forEach(x => { sent[t + '|' + x.k + '|' + x.e.id + '|' + x.st] = 1; });
  await kvSet('swSent', sent);
  const base = { icon: './icon-192.png', badge: './badge-96.png', lang: 'pt-PT', data: { url: './' } };
  if (fresh.length <= 3) {
    await Promise.all(fresh.map(x => self.registration.showNotification(
      x.st === 'over' ? '⚠️ Conta em atraso' : x.st === 'today' ? '⏰ Vence hoje' : '📅 Vence amanhã',
      Object.assign({ body: x.e.name + ' · ' + eur(x.amount) + ' (dia ' + x.e.day + ')', tag: 'c-' + x.e.id }, base))));
  } else {
    const over = fresh.filter(x => x.st === 'over').length, total = fresh.reduce((a, x) => a + x.amount, 0);
    await self.registration.showNotification('Contas da Família: ' + fresh.length + ' contas a pagar', Object.assign({
      body: (over ? over + ' em atraso · ' : '') + 'Total ' + eur(total) + '\n' + fresh.slice(0, 5).map(x => x.e.name).join(', ') + (fresh.length > 5 ? '…' : ''),
      tag: 'resumo'
    }, base));
  }
}
self.addEventListener('periodicsync', e => { if (e.tag === 'contas-check') e.waitUntil(checkAndNotify()); });
/* permite testar/forçar a verificação a partir da app: postMessage({type:'CHECK'}) */
self.addEventListener('message', e => { if (e.data && e.data.type === 'CHECK') e.waitUntil(checkAndNotify()); });
