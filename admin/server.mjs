// ================================================================
// KM CHECK — Servidor do Painel Administrativo
// ================================================================
// Roda no VPS (Contabo) ao lado da API principal.
// Funções: autenticação JWT, receber pings de dispositivos,
// listar dispositivos, analisar cobertura de rodovias SNV.
//
// Uso:
//   cp .env.example .env      # editar com suas credenciais
//   npm install
//   npm start
// ================================================================
import express from 'express';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ── Carrega .env (sem dependência externa) ── */
const envPath = join(__dirname, '.env');
if (existsSync(envPath)) {
  for (const ln of readFileSync(envPath, 'utf8').split('\n')) {
    const m = ln.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
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

/* ── SQLite ── */
const db = new Database(join(__dirname, 'admin.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    device_id   TEXT PRIMARY KEY,
    app_version TEXT,
    platform    TEXT,
    user_agent  TEXT,
    screen      TEXT,
    ip_address  TEXT,
    first_seen  TEXT NOT NULL DEFAULT (datetime('now')),
    last_ping   TEXT NOT NULL DEFAULT (datetime('now')),
    ping_count  INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS dnit_roads (
    br        TEXT NOT NULL,
    uf        TEXT NOT NULL,
    codigo    TEXT NOT NULL DEFAULT 'B',
    km_total  REAL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (br, uf, codigo)
  );
`);

/* Prepared statements — desempenho */
const stmt = {
  upsertDevice: db.prepare(`
    INSERT INTO devices (device_id, app_version, platform, user_agent, screen, ip_address)
    VALUES (@device_id, @app_version, @platform, @user_agent, @screen, @ip_address)
    ON CONFLICT(device_id) DO UPDATE SET
      app_version = COALESCE(@app_version, app_version),
      platform    = COALESCE(@platform, platform),
      user_agent  = COALESCE(@user_agent, user_agent),
      screen      = COALESCE(@screen, screen),
      ip_address  = COALESCE(@ip_address, ip_address),
      last_ping   = datetime('now'),
      ping_count  = ping_count + 1
  `),
  listDevices:  db.prepare(`SELECT * FROM devices ORDER BY last_ping DESC`),
  deviceStats:  db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN platform='iOS' THEN 1 ELSE 0 END) as ios,
      SUM(CASE WHEN platform='Android' THEN 1 ELSE 0 END) as android,
      SUM(CASE WHEN platform NOT IN ('iOS','Android') THEN 1 ELSE 0 END) as other
    FROM devices
  `),
  activeToday: db.prepare(`SELECT COUNT(*) as n FROM devices WHERE last_ping >= datetime('now','-1 day')`),
  activeWeek:  db.prepare(`SELECT COUNT(*) as n FROM devices WHERE last_ping >= datetime('now','-7 day')`),
  topVersion:  db.prepare(`SELECT app_version, COUNT(*) as n FROM devices GROUP BY app_version ORDER BY n DESC LIMIT 1`),
  listDnit:    db.prepare(`SELECT * FROM dnit_roads ORDER BY uf, br, codigo`),
  upsertDnit:  db.prepare(`
    INSERT INTO dnit_roads (br, uf, codigo, km_total)
    VALUES (@br, @uf, @codigo, @km_total)
    ON CONFLICT(br, uf, codigo) DO UPDATE SET
      km_total = @km_total, updated_at = datetime('now')
  `),
  countDnit:   db.prepare(`SELECT COUNT(*) as n FROM dnit_roads`),
};

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

/* Ping público — chamado pelo app mobile no boot */
app.post('/api/admin/devices/ping', (req, res) => {
  try {
    const { device_id, app_version, platform, user_agent, screen } = req.body || {};
    if (!device_id) return res.status(400).json({ error: 'device_id obrigatório' });
    const ip = req.ip || req.socket.remoteAddress || '';
    stmt.upsertDevice.run({
      device_id, app_version: app_version || null,
      platform: platform || null, user_agent: user_agent || null,
      screen: screen || null, ip_address: ip
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('Erro no ping:', e.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

/* Listar dispositivos — admin */
app.get('/api/admin/devices', auth, (req, res) => {
  const devices = stmt.listDevices.all();
  const stats = stmt.deviceStats.get();
  const today = stmt.activeToday.get();
  const week = stmt.activeWeek.get();
  const top = stmt.topVersion.get();
  res.json({
    devices,
    stats: {
      ...stats,
      active_today: today.n,
      active_week: week.n,
      top_version: top ? top.app_version : null
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
    if (_availableCache) return _availableCache; // retorna cache velho se houver
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
  const roads = stmt.listDnit.all();
  const count = stmt.countDnit.get();
  res.json({ roads, total: count.n });
});

/* Cobertura: cruzamento disponíveis × DNIT */
app.get('/api/admin/roads/coverage', auth, async (req, res) => {
  try {
    const index = await fetchAvailableRoads();
    const available = (index.roads || []).map(r => `${r.br}-${r.uf}`);
    const availSet = new Set(available);
    const dnit = stmt.listDnit.all();
    const dnitByKey = {};
    for (const r of dnit) {
      const k = `${r.br}-${r.uf}`;
      if (!dnitByKey[k]) dnitByKey[k] = [];
      dnitByKey[k].push(r);
    }
    /* Montar lista unificada */
    const all = [];
    const seen = new Set();
    /* 1. Rodovias disponíveis */
    for (const r of (index.roads || [])) {
      const k = `${r.br}-${r.uf}`;
      seen.add(k);
      all.push({
        br: r.br, uf: r.uf, km: r.km, segs: r.segs,
        snv_version: index.snv,
        codigos_dnit: dnitByKey[k] ? dnitByKey[k].map(d=>d.codigo).join(',') : '',
        status: 'disponivel'
      });
    }
    /* 2. Rodovias que o DNIT tem mas não estão disponíveis */
    for (const r of dnit) {
      const k = `${r.br}-${r.uf}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const codigos = dnitByKey[k] ? dnitByKey[k].map(d=>d.codigo).join(',') : r.codigo;
      all.push({
        br: r.br, uf: r.uf, km: r.km_total || 0, segs: 0,
        snv_version: '', codigos_dnit: codigos,
        status: 'faltando'
      });
    }
    all.sort((a, b) => a.uf.localeCompare(b.uf) || a.br.localeCompare(b.br));
    const totalAvail = available.length;
    const totalDnit = new Set(dnit.map(r => `${r.br}-${r.uf}`)).size;
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
    res.json({ started: true }); // responde rápido, sync roda em background
    await syncDnitCatalog();
  } catch (e) {
    console.error('Erro no sync DNIT:', e.message);
  }
});

/* GET para checar status do último sync */
app.get('/api/admin/roads/sync-status', auth, (req, res) => {
  const count = stmt.countDnit.get();
  const latest = db.prepare(`SELECT MAX(updated_at) as dt FROM dnit_roads`).get();
  res.json({
    total_roads: count.n,
    last_sync: latest.dt || null,
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
    const layer = layers[layers.length - 1]; // mais recente
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
    const rows = Object.values(groups);
    console.log(`   ${rows.length} combinações BR/UF/código únicas`);

    /* 4. Gravar no banco */
    const upsert = db.transaction((items) => {
      for (const r of items) {
        stmt.upsertDnit.run({
          br: r.br, uf: r.uf, codigo: r.codigo,
          km_total: Math.round(r.km_total * 10) / 10
        });
      }
    });
    upsert(rows);
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

/* Arquivos estáticos (se houver no futuro) */
app.use('/static', express.static(join(__dirname, 'static')));

/* ── Start ── */
app.listen(PORT, () => {
  console.log(`\n🔒 KM Check Admin rodando em http://localhost:${PORT}`);
  console.log(`   Usuário: ${ADMIN_USER}`);
  console.log(`   API: ${CONTROLCHECK_API}\n`);
});
