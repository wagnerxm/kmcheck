const CACHE = 'kmcheck-v190';
const ASSETS = ['./', 'index.html', 'fflate.js', 'manifest.v143.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'logo-header.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Estratégia: o DOCUMENTO (index.html / navegação) usa REDE PRIMEIRO — sempre pega a versão
// mais nova quando há internet, caindo pro cache só quando offline. Isso impede o app de ficar
// "preso" numa versão antiga (era o que acontecia com o cache-first no HTML). Os demais assets
// (fontes, ícones, fflate) continuam cache-first, que é rápido e raramente muda.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isDoc = e.request.mode === 'navigate' ||
                (e.request.destination === 'document') ||
                url.pathname.replace(/\/$/, '/').endsWith('index.html') ||
                url.pathname.endsWith('/');
  const isData = url.pathname.includes('/data/rodovias/');
  const isApi = url.hostname !== self.location.hostname; // APIs externas (controlcheck, etc.)
  if (isDoc || isData || isApi) {
    e.respondWith(
      fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return resp;
      }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match('index.html')))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request, {ignoreSearch: true}).then(r => r || fetch(e.request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return resp;
    }).catch(() => caches.match('index.html')))
  );
});
