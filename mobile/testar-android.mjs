/* Teste do app Android num emulador ou celular conectado (adb), pela depuração do WebView.
 * Antes: app de TESTE instalado e aberto, e `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`.
 * Testa: rodovia baixada do servidor, KM pelo GPS, câmera, foto gravada na galeria do Android (peça nativa),
 * manual e erros. Uso: node mobile/testar-android.mjs */
import puppeteer from 'puppeteer';
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
const [p] = (await b.pages()).filter(x => x.url().startsWith('https://localhost'));
const erros = []; p.on('pageerror', e => erros.push(e.message)); p.on('console', m => m.type() === 'error' && erros.push(m.text()));
const w = ms => new Promise(r => setTimeout(r, ms));
const ok = (nome, v) => console.log((v ? '✓ ' : '✗ ') + nome);

ok('ponte nativa ativa (NATIVO)', await p.evaluate(() => !!NATIVO));
ok('sem convite de instalação', await p.evaluate(() => !document.querySelector('.install-overlay.on')));
console.log('  posição GPS:', await p.evaluate(() => S.pos ? `${S.pos.lat.toFixed(5)}, ${S.pos.lon.toFixed(5)}` : 'sem GPS'));

/* rodovia: versões do SNV + download da BR-226/RN pela API própria */
const vers = await p.evaluate(() => [...document.getElementById('dl-snv').options].length);
ok(`versões do SNV carregadas (${vers})`, vers > 5);
const base = await p.evaluate(async () => {
  const b = await downloadRoadFromApi('226', 'RN', '202607a', null, null, null, 'B');
  await dbPut(b); S.bases = S.bases.filter(x => x.id !== b.id); S.bases.push(b); renderBases();
  return { id: b.id, pontos: b.lat.length };
});
ok(`BR-226/RN baixada e salva (${base.pontos} pontos)`, base.pontos > 1000);
await w(3000);
const km = await p.evaluate(() => { S.fix = findKm(S.pos.lat, S.pos.lon); paintGps(); return S.fix ? S.fix.id + ' km ' + S.fix.km.toFixed(3) + ' (a ' + Math.round(S.fix.dist) + ' m do eixo)' : null; });
ok('KM calculado pelo GPS: ' + km, !!km);

/* câmera abre com imagem */
await p.evaluate(() => { openCam() }); await w(6000);   // sem await: na 1ª vez o Android pergunta a permissão
const cam = await p.evaluate(() => ({ aberta: document.getElementById('camwrap').classList.contains('on'), video: document.getElementById('camvideo').videoWidth }));
ok(`câmera abre com vídeo (${cam.video} px)`, cam.aberta && cam.video > 0);

/* foto: grava pela peça nativa na galeria do Android */
const antes = await p.evaluate(async () => (await getPhotoMetas()).length);
await p.evaluate(() => { localStorage.setItem('kc-autosave', '1'); document.getElementById('shutter').click(); });
await w(7000);
const depois = await p.evaluate(async () => { const m = await getPhotoMetas(); return { n: m.length, salva: m[0] && m[0].saved, nome: m[0] && m[0].name }; });
ok(`foto registrada na galeria do app (${antes} → ${depois.n}): ${depois.nome}`, depois.n > antes);
ok('foto marcada como salva no celular (MediaStore)', !!depois.salva);
await p.evaluate(() => closeCam(true)); await w(800);

/* manual abre dentro do app */
await p.evaluate(() => document.getElementById('help-toggle').click()); await w(4000);
const man = await p.evaluate(() => { const f = document.getElementById('manual-if'); try { return f.contentDocument && f.contentDocument.querySelectorAll('.cap').length } catch (e) { return -1 } });
ok(`manual abre (${man} capítulos)`, man >= 10);
await p.evaluate(() => fechaManual());

console.log(erros.length ? '✗ erros de JS: ' + erros.join(' | ') : '✓ sem erros de JS');
await b.disconnect();
