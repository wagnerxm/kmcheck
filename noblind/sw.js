const CACHE = 'noblind-v21';
const ASSETS = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Estratégia: o DOCUMENTO (index.html / navegação) usa REDE PRIMEIRO — sempre pega a versão
// mais nova quando há internet, caindo pro cache só quando offline. Demais assets (fontes,
// ícones) continuam cache-first (rápido e raramente muda). Fontes do Google Fonts são
// cacheadas na primeira carga.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Navegação ou documento: rede primeiro, fallback pro cache
  const isDoc = e.request.mode === 'navigate' ||
                (e.request.destination === 'document') ||
                url.pathname.replace(/\/$/, '/').endsWith('index.html') ||
                url.pathname.endsWith('/');
  // Google Fonts (CSS e woff2): cachear na primeira carga, depois servir do cache
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (isDoc) {
    // Rede primeiro para o documento — garante que atualizações cheguem rápido
    e.respondWith(
      fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return resp;
      }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match('./')))
    );
    return;
  }
  if (isFont) {
    // Fontes: cache primeiro, busca na rede se não tiver, e guarda no cache
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return resp;
      }))
    );
    return;
  }
  // Assets locais: cache primeiro, fallback pra rede (e guarda no cache pra próxima vez)
  e.respondWith(
    caches.match(e.request, {ignoreSearch: true}).then(r => r || fetch(e.request).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return resp;
    }).catch(() => caches.match('./')))
  );
});
