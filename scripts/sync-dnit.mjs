// ================================================================
// KM CHECK — sincroniza rodovias da API do DNIT (SGPLAN) pro Supabase.
// Roda server-side (GitHub Actions), sem CORS, sem proxy — chama a API direto.
//
// Variáveis de ambiente necessárias:
//   SUPABASE_URL          - URL do projeto (Settings > API)
//   SUPABASE_SERVICE_KEY  - service_role key (NUNCA use a "anon" aqui — precisa
//                            ignorar o RLS pra poder escrever na tabela)
//
// Uso local (teste manual):
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/sync-dnit.mjs
// ================================================================
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Faltam SUPABASE_URL / SUPABASE_SERVICE_KEY nas variáveis de ambiente.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// espaçamento entre pontos, em metros — 30m já é bem mais preciso do que a
// margem de erro típica de um GPS de celular (~5-10m); pode reduzir via env
// se quiser mais densidade, ao custo de mais chamadas à API do DNIT.
const STEP_M = Number(process.env.STEP_M || 30);
const CONC = 10; // requisições em paralelo por lote

function pointUrl(br, uf, km, dataStr, tipo) {
  return `https://servicos.dnit.gov.br/sgplan/apigeo/rotas/espacializarponto?br=${br}&tipo=${tipo}&uf=${uf}&cd_tipo=null&data=${dataStr}&km=${km.toFixed(2)}`;
}

// extrai {lat,lon} de qualquer formato de resposta plausível (schema da API não documentado)
function extractLatLon(body) {
  const tryNums = (a, b) => {
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    if (a >= -35 && a <= 6 && b >= -75 && b <= -32) return { lat: a, lon: b };
    if (b >= -35 && b <= 6 && a >= -75 && a <= -32) return { lat: b, lon: a };
    return null;
  };
  try {
    const j = JSON.parse(body);
    const flat = (o, out) => {
      if (o && typeof o === 'object') {
        for (const k in o) {
          const v = o[k];
          if (typeof v === 'number') out.push([k.toLowerCase(), v]);
          else if (v && typeof v === 'object') flat(v, out);
        }
      }
      return out;
    };
    const nums = flat(j, []);
    const byKey = (re) => { const f = nums.find(([k]) => re.test(k)); return f ? f[1] : null; };
    let lat = byKey(/^(lat|latitude|y)$/), lon = byKey(/^(lon|lng|longitude|x)$/);
    if (lat != null && lon != null) { const r = tryNums(lat, lon); if (r) return r; }
    if (Array.isArray(j) && j.length >= 2) { const r = tryNums(j[0], j[1]); if (r) return r; }
    if (j.coordinates && j.coordinates.length >= 2) { const r = tryNums(j.coordinates[1], j.coordinates[0]); if (r) return r; }
    for (let i = 0; i < nums.length - 1; i++) { const r = tryNums(nums[i][1], nums[i + 1][1]); if (r) return r; }
  } catch (e) { /* não era JSON, tenta regex abaixo */ }
  const m = body.match(/(-?\d{1,3}[.,]\d+)/g);
  if (m && m.length >= 2) {
    const a = parseFloat(m[0].replace(',', '.')), b = parseFloat(m[1].replace(',', '.'));
    return tryNums(a, b);
  }
  return null;
}

import https from 'node:https';
import http from 'node:http';

// requisição de baixo nível, com opção de ignorar validação de certificado —
// usada como diagnóstico/fallback pra sites .gov.br que às vezes usam cadeia
// de certificado (ICP-Brasil) não reconhecida em servidores fora do Brasil.
function rawRequest(url, ms, { insecure } = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const opts = {
      ...(insecure ? { rejectUnauthorized: false } : {}),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
    };
    const req = mod.get(url, opts, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(ms, () => { req.destroy(new Error('timeout')); });
  });
}

// requisição feita de DENTRO de um navegador Chromium real (Playwright) —
// isso passa pela mesma pilha de rede/TLS de um navegador de verdade, o que
// contorna proteções anti-robô que bloqueiam requisições "cruas" de servidor.
async function fetchViaBrowser(page, url, ms) {
  return page.evaluate(async ({ url, ms }) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      const body = await r.text();
      return { status: r.status, body };
    } finally {
      clearTimeout(t);
    }
  }, { url, ms });
}

const STRATEGIES = [
  ['navegador real (playwright)', (httpsUrl, httpUrl, ms, ctx) => {
    if (!ctx?.page) throw new Error('página do playwright indisponível');
    return fetchViaBrowser(ctx.page, httpsUrl, ms);
  }],
  ['https', (httpsUrl, httpUrl, ms) => rawRequest(httpsUrl, ms)],
  ['https (sem checar certificado)', (httpsUrl, httpUrl, ms) => rawRequest(httpsUrl, ms, { insecure: true })],
  ['http', (httpsUrl, httpUrl, ms) => rawRequest(httpUrl, ms)],
  // conexão direta do datacenter costuma ser bloqueada por sites .gov.br —
  // esses proxies fazem a requisição por trás com IPs próprios (mesmos usados no app do navegador)
  ['ponte allorigins', (httpsUrl, httpUrl, ms) => rawRequest('https://api.allorigins.win/raw?url=' + encodeURIComponent(httpsUrl), ms)],
  ['ponte codetabs', (httpsUrl, httpUrl, ms) => rawRequest('https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(httpsUrl), ms)],
  ['ponte corsproxy', (httpsUrl, httpUrl, ms) => rawRequest('https://corsproxy.io/?url=' + encodeURIComponent(httpsUrl), ms)],
];

// onlyStrategy: quando informado (índice em STRATEGIES), pula direto pra esse método,
// sem tentar os outros — usado depois que o probeDnit já descobriu qual funciona,
// pra não perder tempo retentando conexões que sabemos que travam.
async function fetchPoint(url, ms, diag, onlyStrategy, ctx) {
  const httpsUrl = url.replace(/^http:/, 'https:');
  const httpUrl = url.replace(/^https:/, 'http:');
  const indices = onlyStrategy != null ? [onlyStrategy] : STRATEGIES.map((_, i) => i);
  for (const i of indices) {
    const [label, run] = STRATEGIES[i];
    try {
      const { status, body } = await run(httpsUrl, httpUrl, ms, ctx);
      if (diag) diag.push(`${label}: HTTP ${status} — corpo: "${body.slice(0, 200)}"`);
      if (status >= 200 && status < 300) {
        const p = extractLatLon(body);
        if (p) return { point: p, strategy: i };
        if (diag) diag.push(`${label}: resposta OK, mas não reconheci coordenadas nela`);
      }
    } catch (e) {
      const cause = e.cause ? ` (causa: ${e.cause.code || e.cause.message || e.cause})` : '';
      if (diag) diag.push(`${label}: erro — ${e.name || 'Error'}: ${e.message}${cause}`);
    }
  }
  return null;
}

async function probeDnit(br, uf, tipo, dataStr, kmi, ctx) {
  const diag = [];
  const r = await fetchPoint(pointUrl(br, uf, kmi, dataStr, tipo), 15000, diag, null, ctx);
  return { ok: !!r, diag, strategy: r ? r.strategy : null, strategyLabel: r ? STRATEGIES[r.strategy][0] : null };
}

// baixa uma BR inteira chamando a API ponto a ponto; se km final não for
// informado, para sozinha após várias falhas seguidas (fim da rodovia).
// "strategy" vem do probeDnit — pula direto pro método que já sabemos que funciona.
async function downloadRoute(br, uf, tipo, kmi, kmf, stepM, strategy, ctx) {
  const dataStr = new Date().toISOString().slice(0, 10);
  const step = stepM / 1000;
  const autoEnd = kmf == null;
  const maxKm = kmf != null ? kmf : kmi + 2000; // teto de segurança
  const pts = [];
  let km = kmi, consecFail = 0, tried = 0;
  while (km <= maxKm + 1e-9) {
    const batch = [];
    for (let i = 0; i < CONC && km <= maxKm + 1e-9; i++, km += step) batch.push(km);
    const results = await Promise.all(
      batch.map((k) => fetchPoint(pointUrl(br, uf, k, dataStr, tipo), 15000, null, strategy, ctx).then((r) => ({ k, r })))
    );
    tried += batch.length;
    let batchOk = 0;
    for (const { k, r } of results) {
      if (r) { pts.push({ km: k, lat: r.point.lat, lon: r.point.lon }); batchOk++; consecFail = 0; }
      else consecFail++;
    }
    if (tried % 200 === 0) console.log(`  ...${pts.length} pontos obtidos (${tried} consultados)`);
    if (autoEnd && batchOk === 0 && consecFail >= CONC * 3) break; // 3 lotes seguidos sem ponto = fim da rodovia
  }
  pts.sort((a, b) => a.km - b.km);
  return pts;
}

async function syncRodovia({ br, uf, tipo, kmi, kmf }, ctx) {
  const brPad = String(br).padStart(3, '0');
  const rodoviaId = `BR-${brPad}/${uf}`;
  console.log(`\n=== ${rodoviaId} ===`);

  const dataStr = new Date().toISOString().slice(0, 10);
  const { ok, diag, strategy, strategyLabel } = await probeDnit(brPad, uf, tipo, dataStr, kmi ?? 0, ctx);
  if (!ok) {
    console.warn(`  falha ao contatar a API do DNIT para ${rodoviaId} — pulando (mantém dados antigos).`);
    console.warn(`  detalhe: ${diag.join(' · ') || 'nenhuma resposta / sem detalhe'}`);
    return { rodoviaId, status: 'falhou_conexao' };
  }
  console.log(`  conectado via: ${strategyLabel}`);

  const pts = await downloadRoute(brPad, uf, tipo, kmi ?? 0, kmf ?? null, STEP_M, strategy, ctx);
  if (pts.length < 2) {
    console.warn(`  poucos pontos retornados (${pts.length}) — pulando, sem sobrescrever dados antigos.`);
    return { rodoviaId, status: 'poucos_pontos' };
  }
  console.log(`  ${pts.length} pontos (km ${pts[0].km} a ${pts[pts.length - 1].km})`);

  // troca os pontos antigos dessa rodovia pelos novos (delete + insert em lotes)
  const { error: delErr } = await supabase.from('pontos_rodovia').delete().eq('rodovia_id', rodoviaId);
  if (delErr) throw new Error(`Falha ao limpar pontos antigos de ${rodoviaId}: ${delErr.message}`);

  const rows = pts.map((p) => ({
    rodovia_id: rodoviaId, br: `BR-${brPad}`, uf, km: p.km, lat: p.lat, lon: p.lon,
  }));
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from('pontos_rodovia').insert(chunk);
    if (error) throw new Error(`Falha ao inserir pontos de ${rodoviaId} (lote ${i}): ${error.message}`);
  }
  console.log(`  ✅ ${rodoviaId} sincronizada.`);
  return { rodoviaId, status: 'ok', pontos: pts.length };
}

async function main() {
  const listPath = path.join(__dirname, 'rodovias.json');
  const lista = JSON.parse(readFileSync(listPath, 'utf8'));
  console.log(`Sincronizando ${lista.length} rodovia(s)...`);

  console.log('Abrindo navegador (playwright)...');
  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'pt-BR',
  });
  const page = await context.newPage();
  try {
    // visita o site principal primeiro — alguns sites de governo exigem uma sessão/cookie
    // válida antes de aceitar chamadas à API, mesmo que a API em si não peça login
    await page.goto('https://servicos.dnit.gov.br/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch (e) {
    console.warn(`  aviso: não consegui abrir a página principal do DNIT antes (${e.message}) — seguindo mesmo assim.`);
  }
  const ctx = { page };

  const resultados = [];
  for (const rodovia of lista) {
    try {
      resultados.push(await syncRodovia(rodovia, ctx));
    } catch (e) {
      console.error(`  ❌ erro em BR-${rodovia.br}/${rodovia.uf}: ${e.message}`);
      resultados.push({ rodoviaId: `BR-${rodovia.br}/${rodovia.uf}`, status: 'erro', erro: e.message });
    }
  }

  await browser.close();

  console.log('\n=== resumo ===');
  console.table(resultados);
  const falhas = resultados.filter((r) => r.status !== 'ok');
  if (falhas.length) {
    console.warn(`${falhas.length} rodovia(s) não sincronizaram nessa rodada — dados antigos foram mantidos para elas.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
