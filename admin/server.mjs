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
import { readFileSync, writeFileSync, existsSync, renameSync, readdirSync, mkdirSync, unlinkSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomBytes } from 'node:crypto';

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
/* tudo vem do próprio KM Check: a API das rodovias (kmcheck-server, no mesmo VPS) e o site kmcheck.com.br */
const KMCHECK_API      = process.env.KMCHECK_API || 'http://127.0.0.1:3010/api';
const KMCHECK_SITE     = process.env.KMCHECK_SITE || 'https://kmcheck.com.br';
const DNIT_WFS         = 'https://geoservicos.inde.gov.br/geoserver/DNIT/wfs';

if (!ADMIN_HASH) {
  console.error('⚠  ADMIN_HASH não definido. Gere com: npm run hash -- "SuaSenha"');
  console.error('   Depois copie o hash para ADMIN_HASH no .env');
  process.exit(1);
}

/* ── Armazenamento ──
   SQLite embutido do próprio Node (node:sqlite, Node 22.13+): gravação atômica (o arquivo não corrompe se o
   servidor cair no meio), histórico COMPLETO de acessos (o aparelho guarda só os 50 últimos) e backup diário,
   sem dependência nativa para instalar. Os dados continuam em memória (_db) como antes — todo o resto do
   servidor não muda; o SQLite é onde eles ficam guardados.
   Se o Node do servidor não tiver o node:sqlite, segue no arquivo JSON, agora gravado de forma atômica
   (arquivo temporário + rename). Na 1ª vez com SQLite, o admin-data.json é importado e guardado como cópia. */
const DB_PATH = join(__dirname, 'admin-data.json');
const SQL_PATH = join(__dirname, 'admin.db');
const BACKUP_DIR = join(__dirname, 'backups');
const BACKUPS_GUARDADOS = 14;
let SQL = null;
try {
  const { DatabaseSync } = await import('node:sqlite');
  SQL = new DatabaseSync(SQL_PATH);
  SQL.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS aparelhos (device_id TEXT PRIMARY KEY, dados TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS acessos (id INTEGER PRIMARY KEY, device_id TEXT NOT NULL, ts TEXT NOT NULL,
      ip TEXT, versao TEXT, canal TEXT, lat REAL, lon REAL, bases INTEGER);
    CREATE INDEX IF NOT EXISTS acessos_dev ON acessos(device_id, ts);
    CREATE INDEX IF NOT EXISTS acessos_ts ON acessos(ts);
    CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);`);
} catch (e) {
  SQL = null;
  console.warn(`SQLite indisponível neste Node (${process.version}): os dados seguem em admin-data.json —`, e.message);
}
const META = ['dnit_roads', 'last_dnit_sync', 'erros', 'status', 'auditoria', 'seguranca'];
const _insAcesso = SQL && SQL.prepare('INSERT INTO acessos (device_id, ts, ip, versao, canal, lat, lon, bases) VALUES (?,?,?,?,?,?,?,?)');

function lerJson() {
  if (existsSync(DB_PATH)) {
    try { return JSON.parse(readFileSync(DB_PATH, 'utf8')); }
    catch (e) { console.error('admin-data.json ilegível:', e.message); }
  }
  return null;
}
function loadDb() {
  const vazio = { devices: {}, dnit_roads: [], last_dnit_sync: null, erros: {} };
  if (!SQL) return { ...vazio, ...(lerJson() || {}) };
  const n = SQL.prepare('SELECT COUNT(*) AS n FROM aparelhos').get().n;
  if (!n) {
    const j = lerJson();
    if (j && j.devices && Object.keys(j.devices).length) {
      /* 1ª vez com SQLite: importa o JSON e os acessos que ele tinha (ping_history), e guarda o arquivo antigo */
      const ins = SQL.prepare('INSERT OR REPLACE INTO aparelhos (device_id, dados) VALUES (?, ?)');
      SQL.exec('BEGIN');
      try {
        for (const d of Object.values(j.devices)) {
          ins.run(d.device_id, JSON.stringify(d));
          for (const p of d.ping_history || []) if (p.ts)
            _insAcesso.run(d.device_id, p.ts, p.ip || null, p.app_version || null, d.canal || null,
              p.location?.lat ?? null, p.location?.lon ?? null, p.bases_count ?? null);
        }
        const im = SQL.prepare('INSERT OR REPLACE INTO meta (chave, valor) VALUES (?, ?)');
        for (const k of META) if (j[k] !== undefined) im.run(k, JSON.stringify(j[k]));
        SQL.exec('COMMIT');
      } catch (e) { SQL.exec('ROLLBACK'); throw e; }
      const copia = DB_PATH + '.importado-' + new Date().toISOString().slice(0, 10);
      try { renameSync(DB_PATH, copia); } catch {}
      console.log(`Importado para o SQLite: ${Object.keys(j.devices).length} aparelhos (JSON antigo guardado em ${copia})`);
    }
  }
  const db = { ...vazio };
  for (const r of SQL.prepare('SELECT dados FROM aparelhos').all()) { const d = JSON.parse(r.dados); db.devices[d.device_id] = d; }
  for (const r of SQL.prepare('SELECT chave, valor FROM meta').all()) db[r.chave] = JSON.parse(r.valor);
  return db;
}

let _db = loadDb();
if (!_db.erros) _db.erros = {};
if (!_db.status) _db.status = {};
if (!_db.auditoria) _db.auditoria = [];
if (!_db.seguranca) _db.seguranca = {};
let _saveTimer = null;

/* Grava tudo: no SQLite numa transação só; no JSON por arquivo temporário + rename (nunca fica pela metade) */
function gravaAgora() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  try {
    if (SQL) {
      const ins = SQL.prepare('INSERT OR REPLACE INTO aparelhos (device_id, dados) VALUES (?, ?)');
      const im = SQL.prepare('INSERT OR REPLACE INTO meta (chave, valor) VALUES (?, ?)');
      SQL.exec('BEGIN');
      try {
        for (const d of Object.values(_db.devices)) ins.run(d.device_id, JSON.stringify(d));
        for (const k of META) if (_db[k] !== undefined) im.run(k, JSON.stringify(_db[k]));
        SQL.exec('COMMIT');
      } catch (e) { SQL.exec('ROLLBACK'); throw e; }
    } else {
      const tmp = DB_PATH + '.tmp';
      writeFileSync(tmp, JSON.stringify(_db));
      renameSync(tmp, DB_PATH);
    }
  } catch (e) { console.error('Erro ao salvar os dados:', e.message); }
}
/* histórico completo: uma linha por acesso (só no SQLite; no JSON fica o ping_history de 50) */
function registraAcesso(d, ts, ip) {
  if (!_insAcesso) return;
  try { _insAcesso.run(d.device_id, ts, ip || null, d.app_version || null, d.canal || null,
    d.location?.lat ?? null, d.location?.lon ?? null, d.bases_count ?? null); }
  catch (e) { console.error('Erro ao registrar acesso:', e.message); }
}

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
    gravaAgora();
  }
}

/* ── Resumo de uso por dia (para os gráficos do painel) ──
   O ping_history guarda só os 50 últimos acessos, e quem usa muito perde o começo do mês. Aqui cada
   aparelho ganha `uso`: um registro por dia (horário de Brasília) com quantos acessos teve, em que horas
   e em que regiões (lat/lon com 2 casas, ~1 km, igual ao que o app manda). É pequeno e dura 200 dias. */
const DIAS_USO = 200;
const horaBR = ts => { const t = new Date(Date.parse(ts) - 3 * 3600000); return { dia: t.toISOString().slice(0, 10), h: t.getUTCHours() } };
function registraUso(d, ts, location, app_version) {
  const { dia, h } = horaBR(ts);
  const uso = d.uso || (d.uso = {});
  const u = uso[dia] || (uso[dia] = { n: 0, h: {}, l: [] });
  u.n++; u.h[h] = (u.h[h] || 0) + 1;
  if (app_version) u.v = app_version;
  if (location && isFinite(location.lat) && isFinite(location.lon)) {
    const p = [Math.round(location.lat * 100) / 100, Math.round(location.lon * 100) / 100];
    if (!u.l.some(q => q[0] === p[0] && q[1] === p[1]) && u.l.length < 8) u.l.push(p);
  }
}
function podaUso(d) {
  if (!d.uso) return;
  const corte = new Date(Date.now() - DIAS_USO * 86400000).toISOString().slice(0, 10);
  for (const dia of Object.keys(d.uso)) if (dia < corte) delete d.uso[dia];
}
/* Migração: aparelhos que ainda não têm `uso` ganham o resumo montado do ping_history que existe */
{
  let n = 0;
  for (const d of Object.values(_db.devices)) {
    if (d.uso) continue;
    d.uso = {};
    for (const p of (d.ping_history || [])) if (p.ts) registraUso(d, p.ts, p.location, p.app_version);
    n++;
  }
  if (n) { console.log(`Migração: ${n} dispositivo(s) ganharam o resumo de uso por dia`); gravaAgora(); }
}

/* Salva com debounce (evita escrita a cada ping) */
function saveDb() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(gravaAgora, 30000);   // no máximo a cada 30 s (com muitos aparelhos regravar a cada ping travava o painel)
}
const saveDbNow = gravaAgora;
function encerra() { gravaAgora(); try { SQL && SQL.close(); } catch {} process.exit(0); }
process.on('SIGINT', encerra);
process.on('SIGTERM', encerra);

/* ── Backup diário ──
   Uma cópia por dia em backups/ (guarda as 14 mais recentes). No SQLite usa VACUUM INTO, que gera um
   arquivo consistente mesmo com o servidor gravando. O painel baixa a mais recente (cópia fora do VPS). */
function backupsExistentes() {
  try { return readdirSync(BACKUP_DIR).filter(f => /^kmcheck-admin-\d{4}-\d{2}-\d{2}\.(db|json)$/.test(f)).sort(); }
  catch { return []; }
}
function fazBackup(forcar) {
  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const dia = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);   // dia em Brasília
    const nome = `kmcheck-admin-${dia}.${SQL ? 'db' : 'json'}`, alvo = join(BACKUP_DIR, nome);
    /* histórico de acessos: mesma validade do resumo por dia (DIAS_USO, ~7 meses), como diz a política de privacidade */
    if (SQL) try { SQL.prepare('DELETE FROM acessos WHERE ts < ?').run(new Date(Date.now() - DIAS_USO * 86400000).toISOString()); } catch (e) { console.error('Erro ao podar acessos:', e.message); }
    if (existsSync(alvo) && !forcar) return;
    gravaAgora();
    if (existsSync(alvo)) unlinkSync(alvo);
    if (SQL) SQL.exec(`VACUUM INTO '${alvo.replace(/'/g, "''")}'`);
    else copyFileSync(DB_PATH, alvo);
    const todos = backupsExistentes();
    for (const f of todos.slice(0, Math.max(0, todos.length - BACKUPS_GUARDADOS))) unlinkSync(join(BACKUP_DIR, f));
    console.log('Backup feito:', nome);
  } catch (e) { console.error('Erro no backup:', e.message); }
}
setTimeout(fazBackup, 60000);                       // 1 min depois de subir (não atrasa o início)
setInterval(fazBackup, 3 * 3600000).unref();        // confere a cada 3 h; só grava 1 por dia

/* ── Mapeamento de códigos de modelo Android → nomes amigáveis ──
   Foco no mercado brasileiro (Samsung, Xiaomi/Redmi/POCO, Motorola, Realme). */
const ANDROID_MODELS = {
  /* Samsung Galaxy A */
  'SM-A145M':'Galaxy A14','SM-A146M':'Galaxy A14 5G','SM-A155M':'Galaxy A15',
  'SM-A156M':'Galaxy A15 5G','SM-A245M':'Galaxy A24','SM-A256M':'Galaxy A25 5G',
  'SM-A346M':'Galaxy A34 5G','SM-A356M':'Galaxy A35 5G',
  'SM-A546E':'Galaxy A54 5G','SM-A556E':'Galaxy A55 5G',
  'SM-A057M':'Galaxy A05s','SM-A047M':'Galaxy A04s','SM-A037M':'Galaxy A03s',
  'SM-A127M':'Galaxy A12','SM-A137M':'Galaxy A13','SM-A235M':'Galaxy A23',
  'SM-A325M':'Galaxy A32','SM-A525M':'Galaxy A52','SM-A536E':'Galaxy A53 5G',
  /* Samsung Galaxy S */
  'SM-S901B':'Galaxy S22','SM-S906B':'Galaxy S22+','SM-S908B':'Galaxy S22 Ultra',
  'SM-S911B':'Galaxy S23','SM-S916B':'Galaxy S23+','SM-S918B':'Galaxy S23 Ultra',
  'SM-S921B':'Galaxy S24','SM-S926B':'Galaxy S24+','SM-S928B':'Galaxy S24 Ultra',
  'SM-S711B':'Galaxy S23 FE',
  /* Samsung Galaxy M */
  'SM-M346B':'Galaxy M34 5G','SM-M546B':'Galaxy M54 5G',
  'SM-M236B':'Galaxy M23','SM-M336B':'Galaxy M33',
  /* Samsung Galaxy Z */
  'SM-F731B':'Galaxy Z Flip5','SM-F946B':'Galaxy Z Fold5',
  'SM-F741B':'Galaxy Z Flip6','SM-F956B':'Galaxy Z Fold6',
  /* Samsung Galaxy Note */
  'SM-N986B':'Galaxy Note 20 Ultra','SM-N981B':'Galaxy Note 20',
  /* Xiaomi / Redmi / POCO — códigos internos */
  '24049RN28L':'Redmi Note 13 4G','24053RN02A':'Redmi Note 13 5G',
  '23129RA5FL':'Redmi 13C','23108RN04Y':'Redmi 13',
  '23117RA68G':'Redmi Note 13 Pro','23090RA98G':'Redmi Note 13 Pro+',
  '2303ERA42L':'Redmi 12C','22120RN86G':'Redmi 12',
  '2310FPCA4G':'POCO M6 Pro','23073RPBFG':'POCO M6 Pro 5G',
  '23076RN4BI':'POCO X5 Pro','22101320G':'POCO X5',
  'M2101K6G':'POCO F3','23049PCD8G':'POCO F5',
  '2201116SG':'Xiaomi 12','2203129G':'POCO X4 Pro 5G',
  '22071219CG':'POCO X4 GT','21121210G':'Xiaomi 11 Lite 5G NE',
  '2201117SG':'Xiaomi 12 Pro','23078PKD5I':'Xiaomi 13T',
  '2303FPN6LG':'POCO C55',
  /* Motorola */
  'moto g84 5G':'Moto G84 5G','moto g73 5G':'Moto G73 5G',
  'moto g54 5G':'Moto G54 5G','moto g34 5G':'Moto G34 5G',
  'moto g24':'Moto G24','moto g14':'Moto G14',
  'moto g53 5G':'Moto G53 5G','moto g52':'Moto G52',
  'moto e22':'Moto E22','moto e13':'Moto E13',
  'moto g 5G (2024)':'Moto G 5G 2024',
  'moto g200 5G':'Moto G200 5G','moto g82 5G':'Moto G82 5G',
  'edge 40':'Motorola Edge 40','edge 30':'Motorola Edge 30',
  'edge 40 pro':'Motorola Edge 40 Pro','edge 50 pro':'Motorola Edge 50 Pro',
  /* Realme */
  'RMX3474':'Realme 9i','RMX3630':'Realme 11','RMX3710':'Realme 12 Pro',
  'RMX3085':'Realme 8','RMX3393':'Realme 9 Pro+','RMX3761':'Realme C53',
  'RMX3762':'Realme C55',
  /* Google Pixel */
  'Pixel 7':'Pixel 7','Pixel 7a':'Pixel 7a','Pixel 7 Pro':'Pixel 7 Pro',
  'Pixel 8':'Pixel 8','Pixel 8a':'Pixel 8a','Pixel 8 Pro':'Pixel 8 Pro',
  'Pixel 9':'Pixel 9','Pixel 9 Pro':'Pixel 9 Pro',
};

/* Tenta encontrar nome amigável para modelo Android.
   1. Match exato no mapa   2. Match por prefixo Samsung (SM-Axx5 → Galaxy Axx)
   3. Retorna o código original se não encontrar */
function friendlyModel(code) {
  if (!code) return null;
  /* Match exato */
  if (ANDROID_MODELS[code]) return ANDROID_MODELS[code];
  /* Samsung: SM-A145M e SM-A145F são o mesmo modelo (sufixo = região) */
  if (/^SM-/.test(code)) {
    const base = code.replace(/[A-Z]$/, ''); /* remove sufixo de região */
    for (const [k, v] of Object.entries(ANDROID_MODELS)) {
      if (k.replace(/[A-Z]$/, '') === base) return v;
    }
  }
  /* Motorola: model pode vir com espaços extras */
  const motoKey = code.trim().toLowerCase();
  for (const [k, v] of Object.entries(ANDROID_MODELS)) {
    if (k.toLowerCase() === motoKey) return v;
  }
  return null; /* sem match — retorna null, usa o código original */
}

/* ── Estimativa do chip Apple pelo benchmark de CPU ──
   O cliente roda 300K iterações de sin/cos/sqrt (3x, mediana) e envia hw.bench.
   Cada geração de chip Apple (A14→A18) produz tempos consistentemente diferentes.
   Ranges calibráveis — ajustar conforme dados reais. */
function estimateChip(benchMs) {
  if (benchMs == null) return null;
  if (benchMs > 250) return 'A11-';   /* A8-A11: iPhone 6 a X/8 */
  if (benchMs > 180) return 'A12';    /* A12: XR/XS */
  if (benchMs > 140) return 'A13';    /* A13: iPhone 11 */
  if (benchMs > 110) return 'A14';    /* A14: iPhone 12 */
  if (benchMs > 85)  return 'A15';    /* A15: iPhone 13/14/15 */
  if (benchMs > 65)  return 'A16';    /* A16: iPhone 14 Pro/15 */
  if (benchMs > 50)  return 'A17';    /* A17 Pro: iPhone 15 Pro */
  if (benchMs > 38)  return 'A18';    /* A18/Pro: iPhone 16 */
  return 'A19';                       /* A19/Pro: iPhone 17 */
}

/* ── Detecção server-side de modelo/marca/OS via user_agent + tela + hw ──
   Funciona como fallback quando o cliente (v174-) não envia esses campos.
   O campo `hw` (hardware) inclui: cores, gpu, proMotion, cam, bench, chip.
   ProMotion=true → Pro (13 Pro+). Telephoto=true → Pro. Chip (bench) → geração. */
function detectDevice(ua, screenStr, hw) {
  if (!ua) return { brand: null, model: null, os_version: null };
  let brand = null, model = null, os_version = null;
  const pro120 = hw?.proMotion === true;
  const tele = hw?.cam?.telephoto === true;
  /* Chip: usa o pré-calculado pelo cliente, senão estima pelo bench */
  const chip = hw?.chip || estimateChip(hw?.bench);
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
  /* Modelo — iPhones por resolução + chip + ProMotion + câmeras.
     O chip (estimado pelo benchmark de CPU) é o sinal principal que
     diferencia modelos com a mesma resolução de tela. */
  const iosM = ua.match(/OS (\d+)/);
  const iosV = iosM ? +iosM[1] : 0;
  if (/iPhone/.test(ua) && screenStr) {
    const [sw, sh] = screenStr.split('x').map(Number);
    const w = Math.min(sw, sh), h = Math.max(sw, sh);
    const k = w + 'x' + h;
    /* Resolução única — sem ambiguidade */
    if (k === '320x568') model = 'iPhone SE 1ª';
    /* 375x667 — iPhone 6/7/8/SE2/SE3 → chip diferencia */
    else if (k === '375x667') {
      if (chip === 'A15') model = 'iPhone SE 3ª';
      else if (chip === 'A13') model = 'iPhone SE 2ª';
      else if (chip === 'A11-') model = 'iPhone 8';
      else model = 'iPhone 6/7/8/SE';
    }
    /* 414x736 */
    else if (k === '414x736') {
      if (chip === 'A11-') model = 'iPhone 8 Plus';
      else model = 'iPhone 6+/7+/8+';
    }
    /* 414x896 @2x — XR(A12) / 11(A13) */
    else if (k === '414x896') {
      if (chip === 'A13' || iosV >= 17) model = 'iPhone 11';
      else if (chip === 'A12') model = 'iPhone XR';
      else model = 'iPhone XR/11';
    }
    /* 375x812 — X(A11)/XS(A12)/11Pro(A13)/12mini(A14)/13mini(A15) */
    else if (k === '375x812') {
      if (chip === 'A11-') model = 'iPhone X';
      else if (chip === 'A12') model = 'iPhone XS';
      else if (chip === 'A13') model = 'iPhone 11 Pro';
      else if (chip === 'A14') model = 'iPhone 12 mini';
      else if (chip === 'A15') model = 'iPhone 13 mini';
      else model = iosV >= 17 ? (tele ? 'iPhone 12 mini' : 'iPhone 13 mini') : 'iPhone X/XS/11 Pro/12 mini/13 mini';
    }
    /* 390x844 — 12(A14)/12Pro(A14,tele)/13Pro(A15,120Hz)/13(A15)/14(A15) */
    else if (k === '390x844') {
      if (pro120) model = 'iPhone 13 Pro';
      else if (chip === 'A14' && tele) model = 'iPhone 12 Pro';
      else if (chip === 'A14') model = 'iPhone 12';
      else if (tele) model = 'iPhone 12 Pro';
      else if (chip === 'A15') model = 'iPhone 13/14';
      else model = 'iPhone 12/13/14';
    }
    /* 428x926 — 13ProMax(A15,120Hz) / 14Plus(A15,60Hz) */
    else if (k === '428x926') {
      if (pro120) model = 'iPhone 13 Pro Max';
      else model = 'iPhone 14 Plus';
    }
    /* 393x852 — 14Pro(A16,120Hz)/15Pro(A17,120Hz)/15(A16)/16(A18)/17(A19) */
    else if (k === '393x852') {
      if (pro120 && chip === 'A16') model = 'iPhone 14 Pro';
      else if (pro120 && chip === 'A17') model = 'iPhone 15 Pro';
      else if (pro120) model = 'iPhone 14 Pro/15 Pro';
      else if (chip === 'A16') model = 'iPhone 15';
      else if (chip === 'A18') model = 'iPhone 16';
      else if (chip === 'A19') model = 'iPhone 17';
      else model = 'iPhone 15/16/17';
    }
    /* 402x874 — 16Pro(A18)/17Pro(A19) → chip diferencia */
    else if (k === '402x874') {
      if (chip === 'A19') model = 'iPhone 17 Pro';
      else model = 'iPhone 16 Pro';
    }
    /* 430x932 — 14ProMax(A16,120Hz)/15ProMax(A17,120Hz)/15Plus(A16)/16Plus(A18)/17Air(A19) */
    else if (k === '430x932') {
      if (pro120 && chip === 'A16') model = 'iPhone 14 Pro Max';
      else if (pro120 && chip === 'A17') model = 'iPhone 15 Pro Max';
      else if (pro120) model = 'iPhone 14 Pro Max/15 Pro Max';
      else if (chip === 'A16') model = 'iPhone 15 Plus';
      else if (chip === 'A18') model = 'iPhone 16 Plus';
      else if (chip === 'A19') model = 'iPhone 17 Air';
      else model = 'iPhone 15 Plus/16 Plus';
    }
    /* 440x956 — 16ProMax(A18)/17ProMax(A19) → chip diferencia */
    else if (k === '440x956') {
      if (chip === 'A19') model = 'iPhone 17 Pro Max';
      else model = 'iPhone 16 Pro Max';
    }
    else model = 'iPhone (' + k + ')';
  } else if (/iPad/.test(ua)) {
    model = 'iPad';
  } else if (/Android/.test(ua)) {
    const am = ua.match(/;\s*([^;)]+?)\s*Build\//);
    let rawModel = am ? am[1].trim() : null;
    if (rawModel === 'K') rawModel = null;
    model = rawModel;
    if (rawModel && !brand) {
      if (/^SM-/.test(rawModel)) brand = 'Samsung';
      else if (/^RMX/.test(rawModel)) brand = 'Realme';
      else if (/^M\d{4}/.test(rawModel) || /^22\d{3}/.test(rawModel) || /^2[34]\d{3}/.test(rawModel)) brand = 'Xiaomi';
      else if (/^CPH/.test(rawModel)) brand = 'OPPO';
      else if (/^V\d{4}/.test(rawModel)) brand = 'vivo';
      else if (/^moto|^edge/i.test(rawModel)) brand = 'Motorola';
      else if (/^Pixel/.test(rawModel)) brand = 'Google';
    }
    if (rawModel) {
      const friendly = friendlyModel(rawModel);
      if (friendly) model = friendly;
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
  /* 10 tentativas a cada 15 min por IP: senha não sai por tentativa e erro */
  if (!dentroDoLimite('login:' + (req.ip || ''), 10, 900000)) return res.status(429).json({ error: 'Muitas tentativas. Tente de novo em 15 minutos.' });
  const { user, password, codigo } = req.body || {};
  if (!user || !password)
    return res.status(400).json({ error: 'Informe user e password' });
  if (user !== ADMIN_USER) { audita(req, false, 'usuário errado'); return res.status(401).json({ error: 'Credenciais inválidas' }); }
  const ok = await bcrypt.compare(password, ADMIN_HASH);
  if (!ok) { audita(req, false, 'senha errada'); return res.status(401).json({ error: 'Credenciais inválidas' }); }
  /* 2FA: com o código do app autenticador ligado, a senha sozinha não entra */
  if (totpLigado()) {
    if (!codigo) return res.status(401).json({ error: 'Informe o código do app autenticador', precisa_codigo: true });
    if (!totpConfere(_db.seguranca.totp, codigo)) { audita(req, false, 'código 2FA errado'); return res.status(401).json({ error: 'Código inválido', precisa_codigo: true }); }
  }
  audita(req, true, totpLigado() ? 'senha + 2FA' : 'senha');
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
/* "iOS (app)" → "iOS": o resto do painel compara a plataforma com "iOS"/"Android" (sem isso o iPhone da
   App Store caía em "computador" e sumia da lista de celulares); a loja fica guardada no campo canal. */
const normPlat = p => { const m = String(p || '').match(/^(iOS|Android) \(app\)$/); return m ? m[1] : p };

/* Por onde o app foi instalado. Versões novas mandam o campo "canal"; nas antigas deduz pela origem do pedido:
   o app da App Store roda em capacitor://localhost e o da Play Store em https://localhost (WebView com "; wv)").
   Site, PWA e navegador vêm do domínio do KM Check e só se separam pelo campo que o app novo envia. */
const CANAIS = ['app-store', 'play-store', 'pwa', 'navegador'];
function canalDe(canal, origin, ua, platform) {
  if (CANAIS.includes(canal)) return canal;
  /* o app da loja manda a plataforma como "iOS (app)" / "Android (app)" (ver o ping no index.html) */
  const pa = String(platform || '').match(/^(iOS|Android) \(app\)$/);
  if (pa) return pa[1] === 'iOS' ? 'app-store' : 'play-store';
  const o = String(origin || '');
  if (/^capacitor:\/\/localhost/i.test(o)) return 'app-store';
  if (/^https?:\/\/localhost(:\d+)?$/i.test(o) && /;\s*wv\)/.test(ua || '')) return 'play-store';
  if (/Android/.test(ua || '') && /;\s*wv\)/.test(ua || '')) return 'play-store';
  return null;
}

app.post('/api/admin/devices/ping', (req, res) => {
  try {
    const { device_id, app_version, platform, user_agent, screen,
            brand, os_version, model, hw, location, bases_count, bases, canal } = req.body || {};
    if (!device_id) return res.status(400).json({ error: 'device_id obrigatório' });
    /* um app abre poucas vezes por hora; 120 em 10 min por IP só acontece com robô (várias pessoas na mesma rede cabem) */
    if (!dentroDoLimite('ping:' + (req.ip || ''), 120, 600000)) return res.status(429).json({ error: 'muitos envios' });
    const ip = req.ip || req.socket.remoteAddress || '';
    const now = new Date().toISOString();
    const existing = _db.devices[device_id];
    /* Detecção server-side como fallback (clientes v174- não enviam esses campos) */
    const det = detectDevice(user_agent || existing?.user_agent, screen || existing?.screen, hw || existing?.hw);
    /* Registro do ping no histórico (guarda últimos 500 por dispositivo) */
    const hist = existing?.ping_history || [];
    hist.push({ ts: now, ip, app_version, location: location || null,
                bases_count: bases_count ?? 0 });
    if (hist.length > 50) hist.splice(0, hist.length - 50);   // 50 por aparelho: com 500 o arquivo passava de 20 MB
    _db.devices[device_id] = {
      device_id,
      app_version: app_version || existing?.app_version || null,
      platform: normPlat(platform) || existing?.platform || null,
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
      canal: canalDe(canal, req.get('origin'), user_agent, platform) || existing?.canal || 'web',
      first_seen: existing?.first_seen || now,
      last_ping: now,
      ping_count: (existing?.ping_count || 0) + 1,
      ping_history: hist,
      uso: existing?.uso || {},
      ...(existing?.nickname ? { nickname: existing.nickname } : {}),
      ...(existing?.interno ? { interno: existing.interno } : {})
    };
    registraUso(_db.devices[device_id], now, location, app_version);
    podaUso(_db.devices[device_id]);
    registraAcesso(_db.devices[device_id], now, ip);
    saveDb();
    res.json({ ok: true });
  } catch (e) {
    console.error('Erro no ping:', e.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

/* Atualizar apelido/nome do usuário de um dispositivo — configuração manual do admin */
/* Marca (ou desmarca) um aparelho como interno — equipe, TestFlight, revisão da loja. Vale para todos os
   códigos do mesmo aparelho (reinstalações), para ele não voltar a contar por outro código. */
app.patch('/api/admin/devices/:id/interno', auth, (req, res) => {
  const d = _db.devices[req.params.id];
  if (!d) return res.status(404).json({ error: 'Dispositivo não encontrado' });
  const interno = !!(req.body || {}).interno;
  let alvos;
  if (interno) {
    const lista = montaLista(), grupo = (lista.find(x => x.device_id === d.device_id) || {}).grupo;
    alvos = grupo ? lista.filter(x => x.grupo === grupo).map(x => x.device_id) : [d.device_id];
    /* guarda QUEM foi marcado junto (a chave), para desmarcar o grupo inteiro depois */
    for (const id of alvos) if (_db.devices[id]) _db.devices[id].interno = d.device_id;
  } else {
    /* desmarcar: todos os códigos marcados juntos voltam a ser classificados normalmente */
    const chave = d.interno;
    alvos = Object.values(_db.devices).filter(x => x.interno && x.interno === chave).map(x => x.device_id);
    if (!alvos.includes(d.device_id)) alvos.push(d.device_id);
    for (const id of alvos) delete _db.devices[id].interno;
  }
  saveDb();
  res.json({ ok: true, interno, codigos: alvos.length });
});

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
    const day = horaBR(p.ts).dia; // 'YYYY-MM-DD' no horário de Brasília (antes era o dia em UTC: 21h já caía no dia seguinte)
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
    vias: viasDosDias(d.uso),
    fix: d.location ? rodoviaDe(d.location.lat, d.location.lon) : null,
    days,
    total_days: days.length,
    all_ips: allIps,
    all_locations: allLocs,
    ping_history: d.ping_history || []
  });
});

/* ── Contagem real de aparelhos ──
   Cada instalação do app cria um código aleatório (device_id). O código se perde quando a pessoa
   apaga o ícone no iPhone, limpa os dados, troca de navegador ou abre por outro endereço, e aí o
   mesmo celular aparecia 2, 3 vezes. Aqui:
   1) cada código ganha uma categoria: celular, computador ou teste (robôs/emuladores não contam);
   2) reinstalações viram um aparelho só: código novo no MESMO modelo + tela + plataforma, que surge
      até 21 dias depois de o antigo parar de aparecer, na mesma rede (IP ou /24) ou na mesma região (~30 km);
   3) "usuários" = aparelhos (já juntados) que usaram nos últimos 30 dias. */
function categoria(d) {
  if (d.interno) return 'interno';   // equipe, TestFlight, revisão da Apple: fora dos números
  const ua = d.user_agent || '';
  if (/Headless|Puppeteer|Lighthouse|bot\b|crawler|sdk_gphone|Android SDK built for|Emulator/i.test(ua)) return 'teste';
  if (d.platform === 'iOS' || /^Android/.test(d.platform || '')) return 'celular';
  return 'computador';
}
const rede = ip => { const m = String(ip || '').replace(/^::ffff:/, '').match(/^(\d+\.\d+\.\d+)\./); return m ? m[1] : String(ip || '') };
const distKm = (a, b) => { if (!a || !b || !isFinite(a.lat) || !isFinite(b.lat)) return Infinity;
  const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) / 2 * r), y = (b.lat - a.lat) * r; return Math.sqrt(x * x + y * y) * 6371 };
function agrupaAparelhos(lista) {
  const grupos = new Map();   // device_id → id do grupo (o código mais antigo do aparelho)
  const cabecas = [];         // por grupo: o último código visto (para encadear reinstalações)
  const cel = lista.filter(d => d._cat === 'celular').sort((a, b) => (a.first_seen || '').localeCompare(b.first_seen || ''));
  for (const b of cel) {
    const ini = Date.parse(b.first_seen || b.last_ping || 0);
    let melhor = null, folga = Infinity;
    for (const g of cabecas) {
      const a = g.ultimo;
      if (a.platform !== b.platform || (a.model || '') !== (b.model || '') || (a.screen || '') !== (b.screen || '')) continue;
      const fim = Date.parse(a.last_ping || a.first_seen || 0), dt = ini - fim;
      if (dt < -86400000 || dt > 21 * 86400000) continue;   // o antigo tem que ter parado antes (1 dia de tolerância)
      const mesmaRede = rede(a.ip_address) && rede(a.ip_address) === rede(b.ip_address);
      if (!mesmaRede && !(distKm(a.location, b.location) <= 30)) continue;
      if (dt < folga) { folga = dt; melhor = g }
    }
    if (melhor) { grupos.set(b.device_id, melhor.id); melhor.ultimo = b; melhor.n++ }
    else { cabecas.push({ id: b.device_id, ultimo: b, n: 1 }); grupos.set(b.device_id, b.device_id) }
  }
  const tamanho = new Map(cabecas.map(g => [g.id, g.n]));
  return { grupos, tamanho };
}

/* ── Rodovia e KM de cada região (feito aqui no servidor) ──
   O painel no celular demorava porque baixava as rodovias e fazia a conta no próprio aparelho.
   Agora o servidor carrega a geometria enxuta (snv-leve.json) uma vez, guarda os trechos numa grade
   de 0,1° (só olha os quadrados em volta do ponto) e manda a rodovia e o KM já prontos. */
let SNV = null; const GRADE = new Map(), _viaMemo = new Map();
function carregaSnv() {
  try {
    const f = join(__dirname, 'snv-leve.json'); if (!existsSync(f)) return;
    SNV = JSON.parse(readFileSync(f, 'utf8')).rodovias; GRADE.clear(); _viaMemo.clear();
    SNV.forEach((r, bi) => {
      for (let i = 0; i < r.la.length - 1; i++) {
        const x0 = Math.floor(Math.min(r.lo[i], r.lo[i + 1]) * 10), x1 = Math.floor(Math.max(r.lo[i], r.lo[i + 1]) * 10);
        const y0 = Math.floor(Math.min(r.la[i], r.la[i + 1]) * 10), y1 = Math.floor(Math.max(r.la[i], r.la[i + 1]) * 10);
        if (x1 - x0 > 3 || y1 - y0 > 3) continue;   // salto entre segmentos distantes da mesma BR (não é estrada)
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          const k = x + ',' + y; let c = GRADE.get(k); if (!c) GRADE.set(k, c = []); c.push(bi * 1e6 + i);
        }
      }
    });
    console.log(`Rodovias para o painel: ${SNV.length} BRs, ${GRADE.size} quadrados na grade`);
  } catch (e) { console.error('Erro ao carregar snv-leve.json:', e.message); SNV = null }
}
carregaSnv();
/* rodovia mais próxima de uma região (até 5 km); null se longe de rodovia federal */
function rodoviaDe(lat, lon) {
  if (!SNV || !isFinite(lat) || !isFinite(lon)) return null;
  const chave = lat + ',' + lon; if (_viaMemo.has(chave)) return _viaMemo.get(chave);
  const cos = Math.cos(lat * Math.PI / 180), gx = Math.floor(lon * 10), gy = Math.floor(lat * 10);
  let best = null;
  for (let x = gx - 1; x <= gx + 1; x++) for (let y = gy - 1; y <= gy + 1; y++) for (const cod of GRADE.get(x + ',' + y) || []) {
    const bi = Math.floor(cod / 1e6), i = cod % 1e6, r = SNV[bi];
    const ax = r.lo[i], ay = r.la[i], dx = (r.lo[i + 1] - ax) * cos, dy = r.la[i + 1] - ay, ex = (lon - ax) * cos, ey = lat - ay, L2 = dx * dx + dy * dy;
    if (!L2) continue;
    let u = (ex * dx + ey * dy) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
    const d2 = (ex - u * dx) ** 2 + (ey - u * dy) ** 2;
    if (!best || d2 < best.d2) best = { d2, u, i, r };
  }
  let v = null;
  if (best) {
    const dist = Math.sqrt(best.d2) * Math.PI / 180 * 6371000;
    if (dist <= 5000) { const { u, i, r } = best; v = { id: r.br + '/' + r.uf, br: r.br, uf: r.uf, km: +(r.km[i] + u * (r.km[i + 1] - r.km[i])).toFixed(3), dist: Math.round(dist) } }
  }
  if (_viaMemo.size > 50000) _viaMemo.clear();
  _viaMemo.set(chave, v); return v;
}
/* chave de uma base baixada no app, no formato do mapa ("BR-101/RN"); bases importadas (KMZ etc.) ficam de fora */
function chaveBase(b) {
  const n = String(b?.br || '').toUpperCase().match(/(\d{2,3})/), uf = String(b?.uf || '').toUpperCase();
  return n && /^[A-Z]{2}$/.test(uf) ? 'BR-' + n[1].padStart(3, '0') + '/' + uf : null;
}
/* mapa "lat,lon" → [rodovia, km] de todas as regiões de uma lista de dias de uso */
function viasDosDias(dias, alvo = {}) {
  for (const u of Object.values(dias || {})) for (const [la, lo] of u.l || []) {
    const k = la + ',' + lo; if (k in alvo) continue;
    const v = rodoviaDe(la, lo); alvo[k] = v ? [v.id, v.km] : 0;
  }
  return alvo;
}

/* Lista de dispositivos com modelo/marca corrigidos, categoria e grupo (reinstalações juntas).
   Usada pela tabela de aparelhos e pelos gráficos. */
function montaLista() {
  let dirty = false;
  const devices = Object.values(_db.devices)
    .map(d => {
      /* registros gravados antes desta correção: "iOS (app)"/"Android (app)" viram plataforma + canal da loja */
      const pa = String(d.platform || '').match(/^(iOS|Android) \(app\)$/);
      if (pa) {
        d.platform = pa[1];
        if (!d.canal || d.canal === 'web') d.canal = pa[1] === 'iOS' ? 'app-store' : 'play-store';
        dirty = true;
      }
      /* Sempre recalcula modelo/marca/OS server-side — a lógica pode ter melhorado */
      const det = detectDevice(d.user_agent, d.screen, d.hw);
      if (det.brand && det.brand !== d.brand) { d.brand = det.brand; dirty = true; }
      if (det.model && det.model !== d.model) { d.model = det.model; dirty = true; }
      if (det.os_version && det.os_version !== d.os_version) { d.os_version = det.os_version; dirty = true; }
      /* Traduz código cru do modelo Android → nome amigável.
         O Chrome moderno esconde o modelo no UA (mostra "K"), então detectDevice()
         não consegue extrair. Mas o client envia o código via userAgentData.
         Aqui aplicamos o friendlyModel() diretamente no campo armazenado. */
      if (d.model && d.platform !== 'iOS') {
        const friendly = friendlyModel(d.model);
        if (friendly && friendly !== d.model) { d.model = friendly; dirty = true; }
      }
      /* Infere marca se faltando (dispositivos antigos podem ter brand vazio) */
      if (d.model && !d.brand) {
        if (/Galaxy|^SM-/.test(d.model)) d.brand = 'Samsung';
        else if (/Redmi|POCO|Xiaomi/.test(d.model)) d.brand = 'Xiaomi';
        else if (/Moto|Edge/.test(d.model)) d.brand = 'Motorola';
        else if (/Realme/.test(d.model)) d.brand = 'Realme';
        else if (/Pixel/.test(d.model)) d.brand = 'Google';
        if (d.brand) dirty = true;
      }
      return d;
    })
    .sort((a, b) => (b.last_ping || '').localeCompare(a.last_ping || ''));
  if (dirty) saveDb(); /* persiste os campos preenchidos */
  /* categoria e grupo (reinstalações juntas) — calculados na hora, não alteram o arquivo */
  for (const d of devices) d._cat = categoria(d);
  const { grupos, tamanho } = agrupaAparelhos(devices);
  for (const d of devices) {
    d.categoria = d._cat; delete d._cat;
    d.grupo = grupos.get(d.device_id) || d.device_id;
    d.grupo_tamanho = tamanho.get(d.grupo) || 1;
    d.reinstalacao = d.grupo !== d.device_id;
  }
  return devices;
}

/* Listar dispositivos — admin.
   Preenche campos detectáveis retroativamente (dispositivos que pingaram antes da v175). */
app.get('/api/admin/devices', auth, (req, res) => {
  /* sem o resumo por dia (vai pela rota /uso), para a lista não ficar pesada */
  const devices = montaLista().map(({ uso, ...d }) => ({ ...d, fix: d.location ? rodoviaDe(d.location.lat, d.location.lon) : null }));
  /* aparelhos reais: um por grupo, com o último uso do grupo */
  const ap = new Map();
  for (const d of devices) {
    if (d.categoria !== 'celular') continue;
    const g = ap.get(d.grupo);
    if (!g || (d.last_ping || '') > (g.last_ping || '')) ap.set(d.grupo, d);
  }
  const aparelhos = [...ap.values()];
  const mes = new Date(Date.now() - 30 * 86400000).toISOString();
  const now = Date.now();
  const dayAgo = new Date(now - 86400000).toISOString();
  const weekAgo = new Date(now - 7 * 86400000).toISOString();
  let ios = 0, android = 0, other = 0, activeToday = 0, activeWeek = 0;
  let totalBases = 0;
  const canais = { 'app-store': 0, 'play-store': 0, pwa: 0, navegador: 0, web: 0 };
  const versionCount = {}, brandCount = {}, modelCount = {};
  /* iOS/Android/ativos contam APARELHOS reais (reinstalações juntas, sem computadores nem testes) */
  for (const d of aparelhos) {
    if (d.platform === 'iOS') ios++;
    else android++;
    if (d.last_ping >= dayAgo) activeToday++;
    if (d.last_ping >= weekAgo) activeWeek++;
    if (d.last_ping >= mes) canais[d.canal || 'web'] = (canais[d.canal || 'web'] || 0) + 1;
  }
  for (const d of devices) {
    if (d.categoria !== 'celular') other++;
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
      total: devices.length, ios, android, other, canais,
      usuarios_30d: aparelhos.filter(d => d.last_ping >= mes).length,
      aparelhos: aparelhos.length,
      codigos_celular: devices.filter(d => d.categoria === 'celular').length,
      reinstalacoes: devices.filter(d => d.categoria === 'celular').length - aparelhos.length,
      computadores: devices.filter(d => d.categoria === 'computador').length,
      testes: devices.filter(d => d.categoria === 'teste').length,
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
   ERROS DO APP — o app manda os erros de JavaScript (só com a autorização de dados de uso)
   ================================================================ */
/* Limite simples por IP (memória): rota pública não pode virar porta para lotar o servidor */
const _limite = new Map();
function dentroDoLimite(chave, max, janelaMs) {
  const agora = Date.now(), l = _limite.get(chave);
  if (!l || agora - l.ini > janelaMs) { _limite.set(chave, { ini: agora, n: 1 }); return true; }
  return ++l.n <= max;
}
setInterval(() => { const corte = Date.now() - 3600000; for (const [k, l] of _limite) if (l.ini < corte) _limite.delete(k); }, 600000).unref();

const corta = (v, n) => String(v ?? '').slice(0, n);
/* mesma falha = mesma assinatura: tira números, endereços e trechos entre aspas, que mudam a cada vez */
function assinaturaErro(msg, fonte, linha) {
  const base = corta(msg, 300).replace(/https?:\/\/\S+/g, 'URL').replace(/(["'`]).*?\1/g, '"…"').replace(/\d+/g, 'N');
  let h = 0; for (const c of base + '|' + fonte + '|' + linha) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}
const MAX_ERROS = 300;
app.post('/api/admin/erros', (req, res) => {
  if (!dentroDoLimite('erro:' + (req.ip || ''), 30, 600000)) return res.status(429).json({ error: 'muitos envios' });
  const b = req.body || {}, msg = corta(b.msg, 300).trim();
  if (!msg) return res.status(400).json({ error: 'msg obrigatória' });
  const fonte = corta(b.fonte, 80), linha = Math.max(0, parseInt(b.linha, 10) || 0), id = assinaturaErro(msg, fonte, linha);
  const agora = new Date().toISOString(), versao = corta(b.versao, 40) || '?', plat = normPlat(corta(b.plat, 30)) || '?';
  const e = _db.erros[id] || (_db.erros[id] = { id, msg, fonte, linha, col: 0, pilha: '', n: 0, primeira: agora, versoes: {}, plats: {}, canais: {}, telas: {}, aparelhos: [] });
  e.n++; e.ultima = agora; e.msg = msg; e.col = Math.max(0, parseInt(b.col, 10) || 0);
  if (b.pilha) e.pilha = corta(b.pilha, 1200);
  e.versoes[versao] = (e.versoes[versao] || 0) + 1;
  e.plats[plat] = (e.plats[plat] || 0) + 1;
  const canal = CANAIS.includes(b.canal) ? b.canal : 'web'; e.canais[canal] = (e.canais[canal] || 0) + 1;
  const tela = corta(b.tela, 30); if (tela) e.telas[tela] = (e.telas[tela] || 0) + 1;
  const did = corta(b.device_id, 80); if (did && !e.aparelhos.includes(did) && e.aparelhos.length < 100) e.aparelhos.push(did);
  if (e.n === 1) alerta(`🐞 Erro novo no app (${versao}, ${plat}): ${msg.slice(0, 160)}`, 'erro-novo', 600000);
  if (e.resolvido) { e.reaberto = agora; delete e.resolvido; alerta(`🐞 Voltou um erro marcado como resolvido: ${msg.slice(0, 160)}`); }   // voltou a acontecer depois de marcado como resolvido
  /* guarda só as 300 falhas mais recentes */
  const ids = Object.keys(_db.erros);
  if (ids.length > MAX_ERROS) for (const k of ids.sort((a, b) => (_db.erros[a].ultima || '').localeCompare(_db.erros[b].ultima || '')).slice(0, ids.length - MAX_ERROS)) delete _db.erros[k];
  saveDb();
  res.json({ ok: true });
});
app.get('/api/admin/erros', auth, (req, res) => {
  const lista = Object.values(_db.erros).map(e => ({ ...e, n_aparelhos: e.aparelhos.length, aparelhos: undefined }))
    .sort((a, b) => (b.ultima || '').localeCompare(a.ultima || ''));
  res.json({ erros: lista });
});
app.patch('/api/admin/erros/:id', auth, (req, res) => {
  const e = _db.erros[req.params.id];
  if (!e) return res.status(404).json({ error: 'Erro não encontrado' });
  if ((req.body || {}).resolvido) { e.resolvido = new Date().toISOString(); delete e.reaberto; } else delete e.resolvido;
  saveDb();
  res.json({ ok: true });
});

/* ================================================================
   SEGURANÇA — 2FA (TOTP, RFC 6238) e registro de acessos ao painel
   ================================================================ */
/* Código de 6 dígitos que muda a cada 30 s (Google Authenticator, Microsoft Authenticator, 1Password…).
   O segredo fica no banco do painel; para desligar sem o celular: ADMIN_2FA_OFF=1 no .env e reiniciar. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(s) {
  let bits = '', out = [];
  for (const c of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) bits += B32.indexOf(c).toString(2).padStart(5, '0');
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totpCodigo(segredo, passo) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(passo));
  const h = createHmac('sha1', b32decode(segredo)).update(buf).digest(), o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
/* aceita o código do passo atual e do vizinho (relógio do celular adiantado/atrasado até 30 s) */
function totpConfere(segredo, codigo) {
  const c = String(codigo || '').replace(/\D/g, ''), p = Math.floor(Date.now() / 30000);
  return !!segredo && c.length === 6 && [p - 1, p, p + 1].some(x => totpCodigo(segredo, x) === c);
}
const totpLigado = () => !!_db.seguranca.totp && process.env.ADMIN_2FA_OFF !== '1';
function audita(req, ok, como) {
  _db.auditoria.push({ ts: new Date().toISOString(), ip: String(req.ip || '').replace(/^::ffff:/, ''), ua: corta(req.get('user-agent'), 160), ok, como });
  if (_db.auditoria.length > 300) _db.auditoria.splice(0, _db.auditoria.length - 300);
  if (!ok) alerta(`⚠️ Tentativa de entrar no painel falhou (${como}) — IP ${String(req.ip || '').replace(/^::ffff:/, '')}`, 'login-falho', 3600000);
  saveDb();
}
app.get('/api/admin/seguranca', auth, (req, res) => {
  res.json({ totp: totpLigado(), totp_desligado_pelo_env: !!_db.seguranca.totp && process.env.ADMIN_2FA_OFF === '1',
    auditoria: _db.auditoria.slice(-60).reverse() });
});
/* passo 1: gera um segredo novo (ainda não vale) e devolve para cadastrar no app autenticador */
app.post('/api/admin/seguranca/2fa', auth, (req, res) => {
  const seg = Array.from(randomBytes(20), b => B32[b & 31]).join('');
  _db.seguranca.totp_novo = seg; saveDb();
  res.json({ segredo: seg, url: `otpauth://totp/KM%20Check%20Painel:${encodeURIComponent(ADMIN_USER)}?secret=${seg}&issuer=KM%20Check&digits=6&period=30` });
});
/* passo 2: só liga depois de conferir um código gerado pelo celular (evita ficar trancado do lado de fora) */
app.post('/api/admin/seguranca/2fa/confirmar', auth, (req, res) => {
  const seg = _db.seguranca.totp_novo;
  if (!seg) return res.status(400).json({ error: 'Gere o código primeiro' });
  if (!totpConfere(seg, (req.body || {}).codigo)) return res.status(400).json({ error: 'Código não confere. Confira a hora do celular e tente de novo.' });
  _db.seguranca.totp = seg; delete _db.seguranca.totp_novo; saveDb();
  audita(req, true, '2FA ligado');
  res.json({ ok: true });
});
app.delete('/api/admin/seguranca/2fa', auth, (req, res) => {
  if (totpLigado() && !totpConfere(_db.seguranca.totp, (req.body || {}).codigo)) return res.status(400).json({ error: 'Informe um código válido para desligar' });
  delete _db.seguranca.totp; delete _db.seguranca.totp_novo; saveDb();
  audita(req, true, '2FA desligado');
  res.json({ ok: true });
});

/* ================================================================
   ALERTAS — Telegram (TELEGRAM_TOKEN e TELEGRAM_CHAT no .env; sem eles, nada é enviado)
   ================================================================ */
const _ultAlerta = new Map();
async function alerta(texto, chave, intervaloMs = 0) {
  const tk = process.env.TELEGRAM_TOKEN, chat = process.env.TELEGRAM_CHAT;
  if (!tk || !chat) return false;
  if (chave && intervaloMs) { const u = _ultAlerta.get(chave) || 0; if (Date.now() - u < intervaloMs) return false; _ultAlerta.set(chave, Date.now()) }
  try {
    const r = await fetch(`https://api.telegram.org/bot${tk}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: '🛣️ KM Check — ' + texto, disable_web_page_preview: true }), signal: AbortSignal.timeout(10000) });
    return r.ok;
  } catch (e) { console.error('Telegram:', e.message); return false; }
}
app.post('/api/admin/alertas/teste', auth, async (req, res) => {
  if (!process.env.TELEGRAM_TOKEN || !process.env.TELEGRAM_CHAT) return res.status(400).json({ error: 'Configure TELEGRAM_TOKEN e TELEGRAM_CHAT no .env do painel' });
  res.json({ ok: await alerta('teste de alerta do painel ✅') });
});

/* ================================================================
   STATUS DOS SERVIÇOS — confere a cada 5 min; guarda 7 dias e avisa quando cai ou volta
   ================================================================ */
const SERVICOS = {
  api: { nome: 'API das rodovias', url: () => `${KMCHECK_API}/rodovias/versoes` },
  site: { nome: 'Site e app (web)', url: () => `${KMCHECK_SITE}/sw.js` },
};
async function confereServicos() {
  for (const [id, sv] of Object.entries(SERVICOS)) {
    const t0 = Date.now(); let ok = false, extra = null;
    try {
      const r = await fetch(sv.url(), { signal: AbortSignal.timeout(10000), headers: { 'Cache-Control': 'no-cache' } });
      ok = r.ok;
      if (ok && id === 'site') { const m = (await r.text()).match(/kmcheck-v(\d+)/); if (m) extra = m[1]; }   // versão publicada do app
    } catch {}
    const ms = Date.now() - t0, st = _db.status[id] || (_db.status[id] = { hist: [] });
    st.hist.push([Date.now(), ok ? 1 : 0, ms]);
    const corte = Date.now() - 7 * 864e5; while (st.hist.length && st.hist[0][0] < corte) st.hist.shift();
    if (extra) st.versao = extra;
    /* duas falhas seguidas = fora do ar (uma só pode ser rede); avisa uma vez na queda e uma na volta */
    const ult2 = st.hist.slice(-2), fora = ult2.length === 2 && ult2.every(h => !h[1]);
    if (fora && !st.fora) { st.fora = new Date().toISOString(); alerta(`🔴 ${sv.nome} fora do ar`); }
    if (ok && st.fora) { const min = Math.round((Date.now() - Date.parse(st.fora)) / 60000); delete st.fora; alerta(`🟢 ${sv.nome} voltou (ficou ~${min} min fora)`); }
  }
  saveDb();
}
setTimeout(confereServicos, 15000);
setInterval(confereServicos, 5 * 60000).unref();
app.get('/api/admin/status', auth, (req, res) => {
  const out = {};
  for (const [id, sv] of Object.entries(SERVICOS)) {
    const h = (_db.status[id] || {}).hist || [], dia = Date.now() - 864e5, ult = h[h.length - 1];
    const pct = l => l.length ? Math.round(l.filter(x => x[1]).length / l.length * 1000) / 10 : null;
    const ok24 = h.filter(x => x[0] >= dia);
    out[id] = { nome: sv.nome, ok: ult ? !!ult[1] : null, ms: ult ? ult[2] : null, verificado: ult ? new Date(ult[0]).toISOString() : null,
      uptime24h: pct(ok24), uptime7d: pct(h), fora_desde: (_db.status[id] || {}).fora || null, versao: (_db.status[id] || {}).versao || null,
      serie: ok24.map(x => [x[0], x[1], x[2]]) };
  }
  res.json({ servicos: out, painel_no_ar_desde: INICIO, alertas: !!(process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT) });
});
const INICIO = new Date().toISOString();

/* ================================================================
   SISTEMA — armazenamento e backup
   ================================================================ */
app.get('/api/admin/sistema', auth, (req, res) => {
  const bk = backupsExistentes(), ult = bk[bk.length - 1];
  let acessos = null, tamanho = null;
  try { if (SQL) acessos = SQL.prepare('SELECT COUNT(*) AS n FROM acessos').get().n; } catch {}
  try { tamanho = statSync(SQL ? SQL_PATH : DB_PATH).size; } catch {}
  res.json({ armazenamento: SQL ? 'sqlite' : 'json', node: process.version, acessos, tamanho,
    backups: bk.length, ultimo_backup: ult || null, ultimo_backup_tamanho: ult ? statSync(join(BACKUP_DIR, ult)).size : null });
});
/* baixa o backup mais recente (faz um agora se ainda não houver o de hoje) — a cópia fora do VPS */
app.get('/api/admin/backup', auth, (req, res) => {
  fazBackup();
  const bk = backupsExistentes(), ult = bk[bk.length - 1];
  if (!ult) return res.status(404).json({ error: 'Nenhum backup ainda' });
  res.download(join(BACKUP_DIR, ult), ult);
});

/* Uso por aparelho real (só celulares, reinstalações juntas) — alimenta os gráficos do painel.
   Cada aparelho: código mais recente (para abrir a ficha), nome, modelo, quando apareceu e o uso por dia. */
app.get('/api/admin/uso', auth, (req, res) => {
  const grupos = new Map(), lista = montaLista();
  for (const d of lista) {
    if (d.categoria !== 'celular') continue;
    let g = grupos.get(d.grupo);
    if (!g) grupos.set(d.grupo, g = { id: d.grupo, ids: [], inst: d.first_seen, ult: null, dias: {} });
    g.ids.push(d.device_id);
    if (d.first_seen && (!g.inst || d.first_seen < g.inst)) g.inst = d.first_seen;
    if (!g.ult || (d.last_ping || '') > g.ult) {
      Object.assign(g, { ult: d.last_ping, did: d.device_id, plat: d.platform, modelo: d.model || d.platform, v: d.app_version, canal: d.canal || 'web' });
    }
    /* rodovias baixadas no aparelho (chave igual à do mapa: "BR-101/RN"), para o cruzamento demanda × cobertura */
    for (const b of d.bases || []) { const k = chaveBase(b); if (k && !(g.bases || (g.bases = [])).includes(k)) g.bases.push(k) }
    g.nb = Math.max(g.nb || 0, d.bases_count || 0);   // quantas bases (inclusive importadas) o aparelho tem
    if (d.nickname && !g.nick) g.nick = d.nickname;
    /* junta os dias dos códigos do mesmo aparelho */
    for (const [dia, u] of Object.entries(d.uso || {})) {
      const a = g.dias[dia];
      if (!a) { g.dias[dia] = { n: u.n, h: { ...u.h }, l: [...u.l], v: u.v }; continue }
      a.n += u.n; for (const [h, n] of Object.entries(u.h)) a.h[h] = (a.h[h] || 0) + n;
      for (const p of u.l) if (!a.l.some(q => q[0] === p[0] && q[1] === p[1])) a.l.push(p);
      if (u.v) a.v = u.v;
    }
  }
  const s = lista, vias = {};
  for (const g of grupos.values()) viasDosDias(g.dias, vias);
  res.json({
    agora: new Date().toISOString(),
    aparelhos: [...grupos.values()],
    vias,
    fora: { computadores: s.filter(d => d.categoria === 'computador').length, testes: s.filter(d => d.categoria === 'teste').length,
            internos: s.filter(d => d.categoria === 'interno').length,
            reinstalacoes: s.filter(d => d.categoria === 'celular').length - grupos.size }
  });
});

/* Ao vivo: quem abriu o app nos últimos 30 min e os últimos acessos de celulares (atualiza a cada 20 s) */
app.get('/api/admin/agora', auth, (req, res) => {
  const lista = montaLista().filter(d => d.categoria === 'celular');
  const meiaHora = new Date(Date.now() - 30 * 60000).toISOString();
  const eventos = [];
  for (const d of lista) for (const p of (d.ping_history || []).slice(-10))
    eventos.push({ ts: p.ts, did: d.device_id, grupo: d.grupo, modelo: d.model || d.platform, plat: d.platform, nick: d.nickname || null, loc: p.location || null, via: p.location ? rodoviaDe(p.location.lat, p.location.lon) : null });
  eventos.sort((a, b) => b.ts.localeCompare(a.ts));
  res.json({
    agora: new Date().toISOString(),
    usando: new Set(lista.filter(d => (d.last_ping || '') >= meiaHora).map(d => d.grupo)).size,
    eventos: eventos.slice(0, 12)
  });
});

/* Geometria enxuta das rodovias com KM (rodovia e KM de cada aparelho no painel). Gerada por gerar-malha.mjs.
   ~8 MB (menos de 3 MB comprimida) no lugar dos 363 arquivos completos, que travavam o Safari do iPhone. */
app.get('/api/admin/snv-leve.json', (req, res) => {
  const f = join(__dirname, 'snv-leve.json');
  if (!existsSync(f)) return res.status(404).json({ error: 'snv-leve.json ausente' });
  res.set('Cache-Control', 'public, max-age=86400').type('json').send(readFileSync(f));
});

/* Logo do painel (pasta img/, gerada por gerar-logo.mjs): só as imagens painel-*.png */
app.get('/api/admin/img/:f', (req, res) => {
  const f = req.params.f;
  if (!/^painel-[a-z0-9-]+\.png$/.test(f) || !existsSync(join(__dirname, 'img', f))) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=604800').type('png').send(readFileSync(join(__dirname, 'img', f)));
});

/* Manifesto: permite pôr o painel na tela de início do celular e abrir em tela cheia, sem as barras do navegador */
app.get('/api/admin/manifest.webmanifest', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400').type('application/manifest+json').send(JSON.stringify({
    name: 'KM Check Painel', short_name: 'KM Painel', id: '/admin', start_url: '/admin', scope: '/admin',   // escopo só do painel: não se mistura com o app instalado no mesmo domínio
    display: 'standalone', orientation: 'any', background_color: '#060708', theme_color: '#060708', lang: 'pt-BR',
    icons: [{ src: '/api/admin/img/painel-icone-192.png', sizes: '192x192', type: 'image/png' }, { src: '/api/admin/img/painel-icone-512.png', sizes: '512x512', type: 'image/png' }]
  }));
});

/* Malha das rodovias federais (desenho simplificado para o mapa do painel). Gerada por gerar-malha.mjs. */
app.get('/api/admin/malha.js', (req, res) => {
  const f = join(__dirname, 'malha.js');
  if (!existsSync(f)) return res.status(404).type('js').send('window.MALHA=null;');
  res.set('Cache-Control', 'public, max-age=86400').type('js').send(readFileSync(f));
});

/* ================================================================
   ROTAS — COBERTURA DE RODOVIAS
   ================================================================ */

/* Cache em memória das rodovias disponíveis no site do KM Check (kmcheck.com.br) */
let _availableCache = null;
let _availableCacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 min

async function fetchAvailableRoads() {
  const now = Date.now();
  if (_availableCache && now - _availableCacheTime < CACHE_TTL) return _availableCache;
  try {
    const r = await fetch(`${KMCHECK_SITE}/data/rodovias/index.json`, {
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
    const r = await fetch(`${KMCHECK_API}/rodovias/versoes`, {
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
  console.log(`   API: ${KMCHECK_API}\n`);
});
