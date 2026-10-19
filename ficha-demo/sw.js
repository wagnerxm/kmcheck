/* Service worker do Ficha Check: o app abre sem sinal.
   Documento: rede primeiro com limite de 4 s (sinal fraco na beira da pista não pode travar a abertura).
   Ícones e manifesto: cache primeiro. /api nunca passa por aqui (a fila do app cuida do envio).
   Toda mudança no app exige subir o número do cache, senão o aparelho segue com a versão velha. */
const CACHE = 'fichacheck-demo-v3';
const ARQUIVOS = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('fichacheck-demo-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api') || u.pathname.startsWith('/painel')) return;
  const doc = e.request.mode === 'navigate' || u.pathname.endsWith('.html') || u.pathname === '/';
  if (doc) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const rede = fetch(e.request).then(r => { if (r.ok) c.put('index.html', r.clone()); return r });
      const limite = new Promise(ok => setTimeout(ok, 4000));
      const r = await Promise.race([rede.catch(() => null), limite]);
      return r || (await c.match('index.html')) || rede;
    })());
    return;
  }
  /* o que vier da rede fica guardado (modelos de ficha da demonstração, lista de rodovias): abre sem sinal depois */
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
    if (resp.ok) { const c = resp.clone(); caches.open(CACHE).then(k => k.put(e.request, c)) }
    return resp;
  })));
});
