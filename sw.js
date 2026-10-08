const CACHE = 'kmcheck-v284';
const ASSETS = ['./', 'index.html', 'fflate.js', 'manifest.v143.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'logo-header.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'kmcheck-dl').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Estratégia: o DOCUMENTO (index.html / navegação) e os dados das rodovias usam REDE PRIMEIRO — sempre
// pegam a versão mais nova quando há internet, caindo pro cache quando offline. Os demais assets
// (ícones, fflate) continuam cache-first, que é rápido e raramente muda.
// Na estrada o sinal fraco ("1 barrinha") não falha o fetch — ele PENDURA por dezenas de segundos e o
// app demorava a abrir. Por isso a rede tem 4 s: se não respondeu e há cópia em cache, usa o cache
// (a resposta da rede, se chegar depois, ainda atualiza o cache para a próxima abertura).
const NET_TIMEOUT = 4000;
function networkFirst(req, isDoc) {
  return new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done && r) { done = true; resolve(r); } };
    const fromCache = () => caches.match(req, { ignoreSearch: true })
      .then(r => r || (isDoc ? caches.match('index.html') : null));
    const timer = setTimeout(() => { fromCache().then(finish); }, NET_TIMEOUT);
    fetch(req).then(resp => {
      clearTimeout(timer);
      if (resp.ok) { const copy = resp.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      finish(resp);
    }).catch(() => {
      clearTimeout(timer);
      fromCache().then(r => finish(r || Response.error()));
    });
  });
}
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // APIs externas (servidor SNV, GeoServer do DNIT): o SW não intercepta. Antes elas eram cacheadas
  // com ignoreSearch — offline, pedir outra versão/tipo do SNV devolvia a resposta guardada de OUTRA
  // consulta, e cada rodovia baixada ficava duplicada no cache. O app já trata a falta de rede.
  if (url.origin !== self.location.origin) return;
  /* ── Download forçado via SW ──
     O app coloca o blob no cache 'kmcheck-dl' e navega um iframe para /__dl/nome.jpg.
     Servimos com Content-Disposition: attachment → Chrome baixa automaticamente,
     mesmo em PWA standalone (onde <a download> com blob: é ignorado). */
  if (url.pathname.includes('/__dl/')) {
    e.respondWith(
      caches.match(e.request).then(r => {
        if (r) {
          /* avisa a página que o arquivo foi entregue: ela só tenta o 2º método de download se o 1º
             não chegar aqui (antes os dois disparavam juntos e a foto baixava em dobro) */
          self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(cs => cs.forEach(c => c.postMessage({ type: 'kc-dl-served', path: url.pathname }))).catch(() => {});
          /* Apaga do cache após 30s — dá tempo para ambos os métodos de download
             (<a download> + iframe) lerem o blob do mesmo cache sem race condition.
             Na v216 era deleção imediata, o que impedia o 2º método de funcionar. */
          setTimeout(() => caches.open('kmcheck-dl').then(c => c.delete(e.request)).catch(() => {}), 30000);
          return r;
        }
        return new Response('', { status: 404 });
      })
    );
    return;
  }
  const isDoc = e.request.mode === 'navigate' ||
                (e.request.destination === 'document') ||
                url.pathname.endsWith('index.html') ||
                url.pathname.endsWith('/');
  const isData = url.pathname.includes('/data/rodovias/');
  if (isDoc || isData) {
    e.respondWith(networkFirst(e.request, isDoc));
    return;
  }
  e.respondWith(
    caches.match(e.request, {ignoreSearch: true}).then(r => r || fetch(e.request).then(resp => {
      if(resp.ok){ const copy = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return resp;
    }).catch(() => new Response('', {status:404})))
  );
});
