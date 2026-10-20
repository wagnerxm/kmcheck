// VERSAO_APP: a versão que o usuário vê (tela do app, manual, Google Play e App Store).
// Só muda quando sai uma versão nova nas lojas (1.0.0 → 1.0.1 → 1.1.0…).
// CACHE: número interno, sobe a CADA alteração (é o que faz os aparelhos baixarem a versão nova).
const VERSAO_APP = '1.0.0';
const CACHE = 'kmcheck-v351';
const ASSETS = ['./', 'index.html', 'fflate.js', 'manifest.v143.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'logo-header.png', 'logo-kmcheck.png', 'fundo-sobre.webp', 'sw.js', 'data/rodovias/index.json'];
// sw.js: o app lê a versão dele para mostrar no cabeçalho (offline ficava "VERSÃO …"); index.json: a lista de
// rodovias funciona offline já na 1ª sessão (antes só depois de recarregar com o SW no controle)
self.addEventListener('install', e => {
  // cache:'reload' — busca no servidor, não no cache HTTP do navegador (ícones e logo valem 30 dias lá:
  // trocar a imagem com o mesmo nome não chegava aos aparelhos mesmo subindo a versão)
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  // só apaga caches do próprio KM Check: outros apps no mesmo endereço (wagnerxm.github.io) dividem o
  // armazenamento — apagar "todos menos o meu" levava o cache deles, e o deles levava o nosso (app sem abrir offline)
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('kmcheck-') && k !== CACHE && k !== 'kmcheck-dl' && k !== MANUAL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Estratégia: o DOCUMENTO (index.html / navegação) e os dados das rodovias usam REDE PRIMEIRO — sempre
// pegam a versão mais nova quando há internet, caindo pro cache quando offline. Os demais assets
// (ícones, fflate) continuam cache-first, que é rápido e raramente muda.
// Na estrada o sinal fraco ("1 barrinha") não falha o fetch — ele PENDURA por dezenas de segundos e o
// app demorava a abrir. Por isso a rede tem 4 s: se não respondeu e há cópia em cache, usa o cache
// (a resposta da rede, se chegar depois, ainda atualiza o cache para a próxima abertura).
const NET_TIMEOUT = 4000;
// Manual do usuário (pasta manual/): cache PRÓPRIO, que sobrevive às trocas de versão do app — senão,
// a cada atualização o manual sumiria do celular e só voltaria com internet. Ele só é baixado quando a
// pessoa abre o manual (não pesa para quem nunca abrir). O texto é rede-primeiro (pega a versão nova);
// as imagens têm o nome pelo conteúdo, então cache-primeiro é seguro.
const MANUAL = 'kmcheck-manual';
const SEM_MANUAL = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;display:grid;place-items:center;min-height:100vh;font-family:-apple-system,Helvetica,Arial,sans-serif;background:#f1f2f3;color:#1c2333;text-align:center;padding:24px"><div><b style="font-size:18px">Manual ainda não baixado</b><p style="color:#3b4559;line-height:1.5">Abra o manual uma vez com internet.<br>Depois ele funciona sem sinal.</p></div></body>';
function manualRede(req) {
  return new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done && r) { done = true; resolve(r); } };
    const doCache = () => caches.open(MANUAL).then(c => c.match(req, { ignoreSearch: true }))
      .then(r => r || new Response(SEM_MANUAL, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
    const timer = setTimeout(() => doCache().then(finish), NET_TIMEOUT);
    fetch(req).then(resp => {
      clearTimeout(timer);
      if (resp.ok) { const copy = resp.clone(); caches.open(MANUAL).then(c => c.put(req, copy)); finish(resp); }
      else if (resp.type === 'opaqueredirect' || resp.redirected) finish(resp); // o navegador segue o redirecionamento
      else doCache().then(finish);
    }).catch(() => { clearTimeout(timer); doCache().then(finish); });
  });
}
function networkFirst(req, isDoc) {
  return new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done && r) { done = true; resolve(r); } };
    const fromCache = () => caches.match(req, { ignoreSearch: true })
      .then(r => r || (isDoc ? caches.match('index.html') : null));
    const timer = setTimeout(() => { fromCache().then(finish); }, NET_TIMEOUT);
    fetch(req).then(resp => {
      clearTimeout(timer);
      if (resp.ok) { const copy = resp.clone(); caches.open(CACHE).then(c => c.put(req, copy)); finish(resp); }
      // servidor com erro por um instante (502/503 na sincronização, 404): a cópia boa do cache vale mais que a
      // página de erro — antes quem abria o app nessa hora via a tela do servidor no lugar do app
      else fromCache().then(r => finish(r || resp));
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
  // Painel administrativo (kmcheck.com.br/admin e /api/...): fica fora do SW do app. Senão o cache do app
  // guardava os números do painel (mostrava dados velhos) e, com sinal fraco, abria o app no lugar do painel.
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/') || url.pathname.startsWith('/api/')) return;
  // política de privacidade: sem sinal, o fallback do documento entregava o app no lugar dela
  if (url.pathname.includes('/privacidade/')) return;
  // Ficha Check (demonstração) mora no mesmo site e tem SW próprio: sem sinal, o fallback do documento
  // abria o KM Check no lugar dela
  if (url.pathname.includes('/ficha-demo/')) return;
  // Finance Mind (PWA à parte, em /financemind/) tem SW próprio: sem sinal, o fallback do documento abriria o KM Check no lugar dele
  if (url.pathname.includes('/financemind/')) return;
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
  if (url.pathname.includes('/manual/')) {
    if (url.pathname.includes('/manual/img/')) {
      e.respondWith(caches.open(MANUAL).then(c => c.match(e.request).then(r => r || fetch(e.request).then(resp => {
        if (resp.ok) c.put(e.request, resp.clone());
        return resp;
      }))).catch(() => new Response('', { status: 404 })));
    } else e.respondWith(manualRede(e.request));
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
