// ================================================================
// KM CHECK — Servidor do Painel Administrativo
// ================================================================
// Roda no VPS (Contabo) ao lado da API principal.
// Funções: autenticação JWT, receber pings de dispositivos,
// listar dispositivos, analisar cobertura de rodovias SNV.
//
// Armazenamento: arquivo JSON local (admin-data.json) — leve,
// sem dependência nativa, funciona em qualquer OS.
//
// Uso:
//   cp .env.example .env      # editar com suas credenciais
//   npm install
//   npm start
// ================================================================
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ── Carrega .env (sem dependência externa) ── */
const envPath = join(__dirname, '.env');
if (existsSync(envPath)) {
  for (const ln of readFileSync(envPath, 'utf8').split('\n')) {
    const m = ln.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

/* ── Config ── */
const PORT             = +(process.env.ADMIN_PORT || 3457);
const JWT_SECRET       = process.env.JWT_SECRET || 'troque-esta-chave';
const ADMIN_USER       = process.env.ADMIN_USER || 'admin';
const ADMIN_HASH       = process.env.ADMIN_HASH;
const CONTROLCHECK_API = process.env.CONTROLCHECK_API || 'https://controlcheck.duckdns.org/api';
const GITHUB_PAGES     = 'https://wagnerxm.github.io/kmcheck';
const DNIT_WFS         = 'https://geoservicos.inde.gov.br/geoserver/DNIT/wfs';

if (!ADMIN_HASH) {
  console.error('⚠  ADMIN_HASH não definido. Gere com: npm run hash -- "SuaSenha"');
  console.error('   Depois copie o hash para ADMIN_HASH no .env');
  process.exit(1);
}

/* ── Banco JSON (persistido em disco) ──
   Simples, sem dependência nativa, funciona em qualquer OS.
   Estrutura: { devices: { [device_id]: {...} }, dnit_roads: [...] } */
const DB_PATH = join(__dirname, 'admin-data.json');

function loadDb() {
  if (existsSync(DB_PATH)) {
    try { return JSON.parse(readFileSync(DB_PATH, 'utf8')); }
    catch { /* corrupto — recria */ }
  }
  return { devices: {}, dnit_roads: [], last_dnit_sync: null };
}

let _db = loadDb();
let _saveTimer = null;

/* ── Migração: popular ping_history para dispositivos antigos ──
   Dispositivos que pingaram antes da v178 não têm ping_history.
   Cria pelo menos 1 entry com os dados disponíveis para que o
   histórico não fique vazio no modal de detalhes. */
{
  let migrated = 0;
  for (const d of Object.values(_db.devices)) {
    if (d.ping_count > 0 && (!d.ping_history || !d.ping_history.length)) {
      d.ping_history = [{
        ts: d.last_ping || d.first_seen || new Date().toISOString(),
        ip: d.ip_address || null,
        app_version: d.app_version || null,
        location: d.location || null,
        bases_count: d.bases_count || 0
      }];
      migrated++;
    }
  }
  if (migrated) {
    console.log(`Migração: ${migrated} dispositivo(s) ganhou ping_history inicial`);
    try { writeFileSync(DB_PATH, JSON.stringify(_db, null, 2)); } catch {}
  }
}

/* Salva no disco com debounce (evita escrita a cada ping) */
function saveDb() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try { writeFileSync(DB_PATH, JSON.stringify(_db, null, 2)); }
    catch (e) { console.error('Erro ao salvar DB:', e.message); }
  }, 1000);
}

/* Salva imediatamente (para shutdown gracioso) */
function saveDbNow() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  try { writeFileSync(DB_PATH, JSON.stringify(_db, null, 2)); }
  catch (e) { console.error('Erro ao salvar DB:', e.message); }
}
process.on('SIGINT', () => { saveDbNow(); process.exit(0); });
process.on('SIGTERM', () => { saveDbNow(); process.exit(0); });

/* ── Detecção server-side de modelo/marca/OS via user_agent + tela + hw ──
   Funciona como fallback quando o cliente (v174-) não envia esses campos.
   O campo `hw` (hardware) inclui: cores, gpu, proMotion (120Hz), mem.
   ProMotion=true → modelo Pro (iPhone 13 Pro+). Crucial para precisão. */
function detectDevice(ua, screenStr, hw) {
  if (!ua) return { brand: null, model: null, os_version: null };
  let brand = null, model = null, os_version = null;
  const pro = hw?.proMotion === true; /* 120Hz = modelo Pro */
  /* Marca */
  if (/iPhone|iPad|Macintosh/.test(ua)) brand = 'Apple';
  else {
    const bm = ua.match(/;\s*(Samsung|Xiaomi|Redmi|POCO|Motorola|moto|Huawei|HONOR|LG|OnePlus|OPPO|vivo|Realme|Google|Pixel|Nokia|Sony|ASUS|ZTE|Alcatel|HTC|Nothing)/i);
    if (bm) brand = bm[1];
  }
  /* Versão do SO */
  if (/iPhone|iPad/.test(ua)) {
    const ov = ua.match(/OS (\d+[_.]\d+[_.]?\d*)/);
    os_version = ov ? 'iOS ' + ov[1].replace(/_/g, '.') : null;
  } else if (/Android/.test(ua)) {
    const ov = ua.match(/Android ([\d.]+)/);
    os_version = ov ? 'Android ' + ov[1] : null;
  }
  /* Modelo — iPhones pela resolução CSS + versão iOS + ProMotion.
     ProMotion (120Hz) só existe nos Pro a partir do iPhone 13 Pro (2021).
     Isso corta pela metade a ambiguidade dos grupos de mesma resolução. */
  const iosM = ua.match(/OS (\d+)/);
  const iosV = iosM ? +iosM[1] : 0;
  if (/iPhone/.test(ua) && screenStr) {
    const [sw, sh] = screenStr.split('x').map(Number);
    const w = Math.min(sw, sh), h = Math.max(sw, sh);
    const k = w + 'x' + h;
    const iphones = {
      '320x568': 'iPhone SE 1ª', '375x667': 'iPhone 6/7/8/SE2/SE3',
      '414x736': 'iPhone 6+/7+/8+',
      '414x896': iosV >= 17 ? 'iPhone 11' : 'iPhone XR/11',
      '375x812': iosV >= 17 ? 'iPhone 12 mini/13 mini' : 'iPhone X/XS/11 Pro/12 mini/13 mini',
      '390x844': pro ? 'iPhone 13 Pro' : (iosV >= 17 ? 'iPhone 12/13/14' : 'iPhone 12/12 Pro/13/14'),
      '428x926': pro ? 'iPhone 14 Pro Max (?)' : 'iPhone 13 Pro Max/14 Plus',
      '393x852': pro ? 'iPhone 14 Pro/15 Pro' : 'iPhone 15/16',
      '430x932': pro ? 'iPhone 14 Pro Max/15 Pro Max' : 'iPhone 15 Plus/16 Plus',
      '402x874': 'iPhone 16 Pro', '440x956': 'iPhone 16 Pro Max'
    };
    model = iphones[k] || ('iPhone (' + k + ')');
  } else if (/iPad/.test(ua)) {
    model = 'iPad';
  } else if (/Android/.test(ua)) {
    const am = ua.match(/;\s*([^;)]+?)\s*Build\//);
    model = am ? am[1].trim() : null;
    /* Chrome moderno esconde o modelo (mostra "K"), limpa nesse caso */
    if (model === 'K') model = null;
    /* Infere marca pelo código do modelo Android */
    if (model && !brand) {
      if (/^SM-/.test(model)) brand = 'Samsung';
      else if (/^RMX/.test(model)) brand = 'Realme';
      else if (/^M\d{4}/.test(model) || /^22\d{3}/.test(model)) brand = 'Xiaomi';
      else if (/^CPH/.test(model)) brand = 'OPPO';
      else if (/^V\d{4}/.test(model)) brand = 'vivo';
      else if (/^moto/.test(model)) brand = 'Motorola';
      else if (/^Pixel/.test(model)) brand = 'Google';
    }
  }
  return { brand, model, os_version };
}

/* ── Express ── */
const app = express();
app.set('trust proxy', true);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '1mb' }));

/* ── Middleware de autenticação ── */
function auth(req, res, next) {
  const hdr = req.headers.authorization;
  if (!hdr || !hdr.startsWith('Bearer '))
    return res.status(401).json({ error: 'Token não fornecido' });
  try {
    req.admin = jwt.verify(hdr.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

/* ================================================================
   ROTAS — AUTH
   ================================================================ */

app.post('/api/admin/auth/login', async (req, res) => {
  const { user, password } = req.body || {};
  if (!user || !password)
    return res.status(400).json({ error: 'Informe user e password' });
  if (user !== ADMIN_USER)
    return res.status(401).json({ error: 'Credenciais inválidas' });
  const ok = await bcrypt.compare(password, ADMIN_HASH);
  if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });
  const token = jwt.sign({ user, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user });
});

app.get('/api/admin/auth/check', auth, (req, res) => {
  res.json({ valid: true, user: req.admin.user });
});

/* ================================================================
   ROTAS — DISPOSITIVOS
   ================================================================ */

/* Ping público — chamado pelo app mobile no boot.
   Recebe dados aprimorados: marca, modelo, OS, GPS, bases baixadas. */
app.post('/api/admin/devices/ping', (req, res) => {
  try {
    const { device_id, app_version, platform, user_agent, screen,
            brand, os_version, model, hw, location, bases_count, bases } = req.body || {};
    if (!device_id) return res.status(400).json({ error: 'device_id obrigatório' });
    const ip = req.ip || req.socket.remoteAddress || '';
    const now = new Date().toISOString();
    const existing = _db.devices[device_id];
    /* Detecção server-side como fallback (clientes v174- não enviam esses campos) */
    const det = detectDevice(user_agent || existing?.user_agent, screen || existing?.screen, hw || existing?.hw);
    /* Registro do ping no histórico (guarda últimos 500 por dispositivo) */
    const hist = existing?.ping_history || [];
    hist.push({ ts: now, ip, app_version, location: location || null,
                bases_count: bases_count ?? 0 });
    if (hist.length > 500) hist.splice(0, hist.length - 500);
    _db.devices[device_id] = {
      device_id,
      app_version: app_version || existing?.app_version || null,
      platform: platform || existing?.platform || null,
      user_agent: user_agent || existing?.user_agent || null,
      screen: screen || existing?.screen || null,
      ip_address: ip || existing?.ip_address || null,
      brand: brand || existing?.brand || det.brand || null,
      os_version: os_version || existing?.os_version || det.os_version || null,
      model: model || existing?.model || det.model || null,
      location: location || existing?.location || null,
      bases_count: bases_count ?? existing?.bases_count ?? 0,
      bases: bases || existing?.bases || [],
      hw: hw || existing?.hw || null,
      first_seen: existing?.first_seen || now,
      last_ping: now,
      ping_count: (existing?.ping_count || 0) + 1,
      ping_history: hist
    };
    saveDb();
    res.json({ ok: true });
  } catch (e) {
    console.error('Erro no ping:', e.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

/* Atualizar apelido/nome do usuário de um dispositivo — configuração manual do admin */
app.patch('/api/admin/devices/:id/nickname', auth, (req, res) => {
  const d = _db.devices[req.params.id];
  if (!d) return res.status(404).json({ error: 'Dispositivo não encontrado' });
  const { nickname } = req.body || {};
  d.nickname = (nickname || '').trim() || null;
  saveDb();
  res.json({ ok: true, nickname: d.nickname });
});

/* Detalhes de um dispositivo — histórico completo de pings, agrupado por dia */
app.get('/api/admin/devices/:id', auth, (req, res) => {
  const d = _db.devices[req.params.id];
  if (!d) return res.status(404).json({ error: 'Dispositivo não encontrado' });
  /* Agrupa pings por dia */
  const byDay = {};
  for (const p of (d.ping_history || [])) {
    const day = p.ts.slice(0, 10); // 'YYYY-MM-DD'
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(p);
  }
  const days = Object.entries(byDay)
    .map(([date, pings]) => ({
      date, count: pings.length,
      first: pings[0].ts, last: pings[pings.length - 1].ts,
      ips: [...new Set(pings.map(p => p.ip).filter(Boolean))],
      locations: pings.filter(p => p.location).map(p => p.location),
      versions: [...new Set(pings.map(p => p.app_version).filter(Boolean))]
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
  /* IPs únicos do histórico */
  const allIps = [...new Set((d.ping_history || []).map(p => p.ip).filter(Boolean))];
  /* Localizações únicas */
  const allLocs = (d.ping_history || []).filter(p => p.location).map(p => ({
    ts: p.ts, ...p.location
  }));
  res.json({
    device: d,
    days,
    total_days: days.length,
    all_ips: allIps,
    all_locations: allLocs,
    ping_history: d.ping_history || []
  });
});

/* Listar dispositivos — admin.
   Preenche campos detectáveis retroativamente (dispositivos que pingaram antes da v175). */
app.get('/api/admin/devices', auth, (req, res) => {
  let dirty = false;
  const devices = Object.values(_db.devices)
    .map(d => {
      /* Sempre recalcula modelo/marca/OS server-side — a lógica pode ter melhorado */
      const det = detectDevice(d.user_agent, d.screen, d.hw);
      if (det.brand && det.brand !== d.brand) { d.brand = det.brand; dirty = true; }
      if (det.model && det.model !== d.model) { d.model = det.model; dirty = true; }
      if (det.os_version && det.os_version !== d.os_version) { d.os_version = det.os_version; dirty = true; }
      return d;
    })
    .sort((a, b) => (b.last_ping || '').localeCompare(a.last_ping || ''));
  if (dirty) saveDb(); /* persiste os campos preenchidos */
  const now = Date.now();
  const dayAgo = new Date(now - 86400000).toISOString();
  const weekAgo = new Date(now - 7 * 86400000).toISOString();
  let ios = 0, android = 0, other = 0, activeToday = 0, activeWeek = 0;
  let totalBases = 0;
  const versionCount = {}, brandCount = {}, modelCount = {};
  for (const d of devices) {
    if (d.platform === 'iOS') ios++;
    else if (d.platform === 'Android') android++;
    else other++;
    if (d.last_ping >= dayAgo) activeToday++;
    if (d.last_ping >= weekAgo) activeWeek++;
    const v = d.app_version || '?';
    versionCount[v] = (versionCount[v] || 0) + 1;
    if (d.brand) brandCount[d.brand] = (brandCount[d.brand] || 0) + 1;
    if (d.model) modelCount[d.model] = (modelCount[d.model] || 0) + 1;
    totalBases += d.bases_count || 0;
  }
  const topVersion = Object.entries(versionCount).sort((a, b) => b[1] - a[1])[0];
  const topBrand = Object.entries(brandCount).sort((a, b) => b[1] - a[1])[0];
  const topModel = Object.entries(modelCount).sort((a, b) => b[1] - a[1])[0];
  res.json({
    devices,
    stats: {
      total: devices.length, ios, android, other,
      active_today: activeToday,
      active_week: activeWeek,
      top_version: topVersion ? topVersion[0] : null,
      top_brand: topBrand ? { name: topBrand[0], count: topBrand[1] } : null,
      top_model: topModel ? { name: topModel[0], count: topModel[1] } : null,
      total_bases: totalBases,
      brands: brandCount,
      models: modelCount
    }
  });
});

/* ================================================================
   ROTAS — COBERTURA DE RODOVIAS
   ================================================================ */

/* Cache em memória das rodovias disponíveis no GitHub Pages */
let _availableCache = null;
let _availableCacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 min

async function fetchAvailableRoads() {
  const now = Date.now();
  if (_availableCache && now - _availableCacheTime < CACHE_TTL) return _availableCache;
  try {
    const r = await fetch(`${GITHUB_PAGES}/data/rodovias/index.json`, {
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    _availableCache = data;
    _availableCacheTime = now;
    return data;
  } catch (e) {
    console.error('Erro ao buscar index.json:', e.message);
    if (_availableCache) return _availableCache;
    return { snv: '?', roads: [] };
  }
}

/* Cache das versões do servidor */
let _versionsCache = null;
let _versionsCacheTime = 0;

async function fetchServerVersions() {
  const now = Date.now();
  if (_versionsCache && now - _versionsCacheTime < CACHE_TTL) return _versionsCache;
  try {
    const r = await fetch(`${CONTROLCHECK_API}/rodovias/versoes`, {
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    _versionsCache = data;
    _versionsCacheTime = now;
    return data;
  } catch (e) {
    console.error('Erro ao buscar versões:', e.message);
    return _versionsCache || [];
  }
}

/* Rodovias disponíveis no KM Check */
app.get('/api/admin/roads/available', auth, async (req, res) => {
  try {
    const [index, versions] = await Promise.all([
      fetchAvailableRoads(),
      fetchServerVersions()
    ]);
    res.json({
      snv_version: index.snv,
      updated: index.updated,
      roads: index.roads || [],
      total: (index.roads || []).length,
      server_versions: versions
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Catálogo DNIT (do banco local) */
app.get('/api/admin/roads/dnit', auth, (req, res) => {
  res.json({ roads: _db.dnit_roads, total: _db.dnit_roads.length });
});

/* Cobertura: cruzamento disponíveis × DNIT */
app.get('/api/admin/roads/coverage', auth, async (req, res) => {
  try {
    const index = await fetchAvailableRoads();
    const available = (index.roads || []).map(r => `${r.br}-${r.uf}`);
    const availSet = new Set(available);
    const dnitByKey = {};
    for (const r of _db.dnit_roads) {
      const k = `${r.br}-${r.uf}`;
      if (!dnitByKey[k]) dnitByKey[k] = [];
      dnitByKey[k].push(r);
    }
    const all = [];
    const seen = new Set();
    /* 1. Rodovias disponíveis */
    for (const r of (index.roads || [])) {
      const k = `${r.br}-${r.uf}`;
      seen.add(k);
      all.push({
        br: r.br, uf: r.uf, km: r.km, segs: r.segs,
        snv_version: index.snv,
        codigos_dnit: dnitByKey[k] ? dnitByKey[k].map(d => d.codigo).join(',') : '',
        status: 'disponivel'
      });
    }
    /* 2. Rodovias que o DNIT tem mas não estão disponíveis */
    for (const r of _db.dnit_roads) {
      const k = `${r.br}-${r.uf}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const codigos = dnitByKey[k] ? dnitByKey[k].map(d => d.codigo).join(',') : r.codigo;
      all.push({
        br: r.br, uf: r.uf, km: r.km_total || 0, segs: 0,
        snv_version: '', codigos_dnit: codigos,
        status: 'faltando'
      });
    }
    all.sort((a, b) => a.uf.localeCompare(b.uf) || a.br.localeCompare(b.br));
    const totalAvail = available.length;
    const totalDnit = new Set(_db.dnit_roads.map(r => `${r.br}-${r.uf}`)).size;
    const missing = all.filter(r => r.status === 'faltando').length;
    const pct = totalDnit > 0 ? Math.round(totalAvail / totalDnit * 100) : 0;
    res.json({
      roads: all,
      summary: { total_available: totalAvail, total_dnit: totalDnit, missing, coverage_pct: pct }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Sincronizar catálogo do DNIT via WFS GeoServer */
app.post('/api/admin/roads/sync-dnit', auth, async (req, res) => {
  try {
    res.json({ started: true });
    await syncDnitCatalog();
  } catch (e) {
    console.error('Erro no sync DNIT:', e.message);
  }
});

app.get('/api/admin/roads/sync-status', auth, (req, res) => {
  res.json({
    total_roads: _db.dnit_roads.length,
    last_sync: _db.last_dnit_sync || null,
    syncing: _syncing
  });
});

let _syncing = false;

async function syncDnitCatalog() {
  if (_syncing) return;
  _syncing = true;
  console.log('🔄 Sincronizando catálogo do DNIT…');
  try {
    /* 1. Descobrir a layer mais recente do SNV */
    const capUrl = `${DNIT_WFS}?service=WFS&request=GetCapabilities`;
    const capResp = await fetch(capUrl, { signal: AbortSignal.timeout(30000) });
    const capXml = await capResp.text();
    const layers = [...capXml.matchAll(/<Name>(DNIT:snv_\w+)<\/Name>/g)]
      .map(m => m[1]).sort();
    if (!layers.length) throw new Error('Nenhuma layer SNV encontrada no WFS');
    const layer = layers[layers.length - 1];
    console.log(`   Layer: ${layer}`);

    /* 2. Buscar features (sem geometria, só atributos) */
    const wfsUrl = `${DNIT_WFS}?service=WFS&version=2.0.0&request=GetFeature` +
      `&typeNames=${layer}&propertyName=vl_br,sg_uf,ds_codigo,vl_km_inic,vl_km_fina` +
      `&outputFormat=application/json&count=50000`;
    const wfsResp = await fetch(wfsUrl, { signal: AbortSignal.timeout(120000) });
    if (!wfsResp.ok) throw new Error('WFS HTTP ' + wfsResp.status);
    const geo = await wfsResp.json();
    const features = geo.features || [];
    console.log(`   ${features.length} segmentos recebidos`);

    /* 3. Agregar por BR/UF/codigo — somar extensão total */
    const groups = {};
    for (const f of features) {
      const p = f.properties || {};
      const br = String(p.vl_br || '').padStart(3, '0');
      const uf = (p.sg_uf || '').toUpperCase();
      const cod = (p.ds_codigo || 'B').charAt(0).toUpperCase();
      if (!br || br === '000' || !uf) continue;
      const ki = parseFloat(p.vl_km_inic) || 0;
      const kf = parseFloat(p.vl_km_fina) || 0;
      const ext = Math.abs(kf - ki);
      const k = `${br}-${uf}-${cod}`;
      if (!groups[k]) groups[k] = { br, uf, codigo: cod, km_total: 0 };
      groups[k].km_total += ext;
    }
    const rows = Object.values(groups).map(r => ({
      ...r, km_total: Math.round(r.km_total * 10) / 10
    }));
    rows.sort((a, b) => a.uf.localeCompare(b.uf) || a.br.localeCompare(b.br) || a.codigo.localeCompare(b.codigo));
    console.log(`   ${rows.length} combinações BR/UF/código únicas`);

    /* 4. Gravar */
    _db.dnit_roads = rows;
    _db.last_dnit_sync = new Date().toISOString();
    saveDbNow();
    console.log(`✅ Catálogo DNIT atualizado: ${rows.length} registros`);
  } catch (e) {
    console.error('❌ Erro no sync DNIT:', e.message);
  } finally {
    _syncing = false;
  }
}

/* ================================================================
   PAINEL — servir o HTML
   ================================================================ */
app.get('/', (req, res) => {
  const html = readFileSync(join(__dirname, 'panel.html'), 'utf8');
  res.type('html').send(html);
});

/* ── Start ── */
app.listen(PORT, () => {
  const devCount = Object.keys(_db.devices).length;
  console.log(`\n🔒 KM Check Admin rodando em http://localhost:${PORT}`);
  console.log(`   Usuário: ${ADMIN_USER}`);
  console.log(`   Dispositivos no banco: ${devCount}`);
  console.log(`   Rodovias DNIT no banco: ${_db.dnit_roads.length}`);
  console.log(`   API: ${CONTROLCHECK_API}\n`);
});
