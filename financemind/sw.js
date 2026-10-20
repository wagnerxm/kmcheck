// Service worker do Finance Mind. Escopo: só /financemind/ (o KM Check tem o dele na raiz).
// Sobe o número a CADA alteração em qualquer arquivo desta pasta, senão os aparelhos seguem com a versão antiga.
const CACHE = 'financemind-v2';
const ARQUIVOS = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'vendor/react.min.js', 'vendor/react-dom.min.js', 'vendor/htm.js', 'vendor/manrope.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('financemind-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Documento: rede primeiro com limite de 4 s (sinal fraco cai no cache), para pegar versão nova assim que publicada.
  if (req.mode === 'navigate') {
    e.respondWith(new Promise(ok => {
      const t = setTimeout(() => caches.match('index.html').then(r => r && ok(r)), 4000);
      fetch(req).then(r => { clearTimeout(t); if (r.ok) { const c = r.clone(); caches.open(CACHE).then(ch => ch.put('index.html', c)); } ok(r); })
        .catch(() => { clearTimeout(t); caches.match('index.html').then(r => ok(r || new Response('Sem conexão.', { status: 503 }))); });
    }));
    return;
  }
  // Demais arquivos: cache primeiro (são versionados pelo nome do cache).
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
