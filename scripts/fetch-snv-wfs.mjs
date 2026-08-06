import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { fetch, Agent, setGlobalDispatcher } from 'undici';

// Timeouts generosos: o servidor do DNIT (gov) costuma ser lento pra conectar/responder. O
// padrão do undici é só 10s pra conectar, o que derrubava a tarefa numa lentidão passageira.
setGlobalDispatcher(new Agent({
  connect: { timeout: 45000 },   // 45s pra estabelecer a conexão (era 10s)
  headersTimeout: 120000,        // 2 min esperando a resposta começar
  bodyTimeout: 600000,           // 10 min pra baixar o corpo (ZIP de ~68 MB)
}));

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data', 'rodovias');
const TMP = join(__dirname, '..', '.tmp-snv');
const SHARE_TOKEN = 'oTpPRmYs5AAdiNr';
const WEBDAV = 'https://servicos.dnit.gov.br/dnitcloud/public.php/webdav';
const SHP_FOLDER = 'SNV Bases Geométricas (2013-Atual) (SHP)';
const AUTH = 'Basic ' + Buffer.from(SHARE_TOKEN + ':').toString('base64');
const D2R = Math.PI / 180;

// Repete a operação (conectar/baixar) várias vezes com espera crescente entre as tentativas.
// Assim uma queda momentânea do DNIT não faz a tarefa inteira falhar. Erros de HTTP "definitivos"
// (401/403/404) não são repetidos — só falhas de rede e erros de servidor (5xx/429).
async function withRetry(fn, label, attempts = 6) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e && e.noRetry) throw e;
      lastErr = e;
      const cause = (e && (e.cause && e.cause.code || e.code)) || (e && e.message) || e;
      if (i < attempts) {
        const waitMs = Math.min(60000, 5000 * 2 ** (i - 1)) + Math.floor(Math.random() * 2000);
        console.log(`${label}: tentativa ${i}/${attempts} falhou (${cause}). Aguardando ${Math.round(waitMs / 1000)}s e tentando de novo...`);
        await new Promise(res => setTimeout(res, waitMs));
      }
    }
  }
  throw new Error(`${label} falhou após ${attempts} tentativas: ${(lastErr && lastErr.message) || lastErr}`);
}

// Lança um erro que NÃO deve ser repetido (ex.: 404) — o retry desiste na hora.
function httpError(status, what) {
  const e = new Error(`${what}: HTTP ${status}`);
  if (status < 500 && status !== 429) e.noRetry = true;   // 4xx (menos 429) = definitivo
  return e;
}

async function listShpFiles() {
  return withRetry(async () => {
    const url = `${WEBDAV}/${encodeURIComponent(SHP_FOLDER)}/`;
    const r = await fetch(url, { method: 'PROPFIND', headers: { 'Authorization': AUTH, 'Depth': '1' }, signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw httpError(r.status, 'PROPFIND');
    const xml = await r.text();
    return [...xml.matchAll(/<d:href>([^<]+)<\/d:href>/g)]
      .map(m => decodeURIComponent(m[1].split('/').pop()))
      .filter(f => /^\d{6}\w+\.zip$/i.test(f))
      .sort();
  }, 'Listar pasta SHP');
}

async function downloadZip(filename, dest) {
  await withRetry(async () => {
    const url = `${WEBDAV}/${encodeURIComponent(SHP_FOLDER)}/${encodeURIComponent(filename)}`;
    console.log(`Downloading ${filename} (~68 MB)...`);
    const r = await fetch(url, { headers: { 'Authorization': AUTH }, signal: AbortSignal.timeout(600000) });
    if (!r.ok) throw httpError(r.status, 'Download');
    const buf = Buffer.from(await r.arrayBuffer());
    writeFileSync(dest, buf);
    console.log(`Downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
  }, 'Baixar ZIP');
}

function readDbf(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numRecs = v.getUint32(4, true);
  const headerLen = v.getUint16(8, true);
  const recLen = v.getUint16(10, true);
  const fields = [];
  for (let off = 32; off < headerLen - 1; off += 32) {
    const name = String.fromCharCode(...buf.slice(off, off + 11)).replace(/\0/g, '').trim().toLowerCase();
    const type = String.fromCharCode(buf[off + 11]);
    const len = buf[off + 16];
    const dec = buf[off + 17];
    fields.push({ name, type, len, dec });
  }
  const recs = [];
  for (let i = 0; i < numRecs; i++) {
    const roff = headerLen + i * recLen + 1;
    const rec = {};
    let foff = 0;
    for (const f of fields) {
      const raw = buf.slice(roff + foff, roff + foff + f.len).toString('utf8').trim();
      if (f.type === 'N' || f.type === 'F') rec[f.name] = raw === '' ? null : parseFloat(raw);
      else rec[f.name] = raw;
      foff += f.len;
    }
    recs.push(rec);
  }
  return recs;
}

function readShp(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const feats = [];
  let off = 100;
  while (off < buf.length) {
    const contentLen = v.getInt32(off + 4, false);
    const recStart = off + 8;
    const type = v.getInt32(recStart, true);
    if (type === 3 || type === 5) {
      const numParts = v.getInt32(recStart + 36, true);
      const numPoints = v.getInt32(recStart + 40, true);
      const ptsOff = recStart + 44 + numParts * 4;
      const points = [];
      for (let i = 0; i < numPoints; i++) {
        points.push([
          Math.round(v.getFloat64(ptsOff + i * 16, true) * 1e7) / 1e7,
          Math.round(v.getFloat64(ptsOff + i * 16 + 8, true) * 1e7) / 1e7
        ]);
      }
      feats.push(points);
    } else {
      feats.push(null);
    }
    off = recStart + contentLen * 2;
  }
  return feats;
}

function buildRoadJson(segs, br, uf, snv) {
  segs.sort((a, b) => a.ki - b.ki);
  const segments = segs.map(s => {
    const cc = s.pts;
    let total = 0;
    const cum = [0];
    for (let i = 1; i < cc.length; i++) {
      const cos = Math.cos((cc[i - 1][1] + cc[i][1]) / 2 * D2R);
      const dx = (cc[i][0] - cc[i - 1][0]) * cos, dy = cc[i][1] - cc[i - 1][1];
      total += Math.sqrt(dx * dx + dy * dy);
      cum.push(total);
    }
    return { ki: s.ki, kf: s.kf, c: cc };
  });
  const km = segments.length ? Math.round(segments[segments.length - 1].kf * 10) / 10 : 0;
  return { br, uf, snv, updated: new Date().toISOString().slice(0, 10), km, segments };
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(TMP, { recursive: true });

  console.log('Listing DNIT Cloud SHP folder...');
  const files = await listShpFiles();
  const latest = files[files.length - 1];
  const snv = latest.replace('.zip', '').toLowerCase();
  console.log(`Latest version: ${snv} (${files.length} versions available)`);

  const indexPath = join(DATA_DIR, 'index.json');
  if (existsSync(indexPath)) {
    const cur = JSON.parse(readFileSync(indexPath, 'utf8'));
    if (cur.snv === snv) {
      console.log('Already up to date. Skipping.');
      rmSync(TMP, { recursive: true, force: true });
      return;
    }
    console.log(`Updating from ${cur.snv} to ${snv}`);
  }

  const zipPath = join(TMP, latest);
  await downloadZip(latest, zipPath);

  console.log('Extracting...');
  execSync(`unzip -o "${zipPath}" -d "${TMP}"`, { stdio: 'pipe' });

  const { readdirSync } = await import('node:fs');
  const extracted = readdirSync(TMP);
  const shpFile = extracted.find(f => f.toLowerCase().endsWith('.shp'));
  const dbfFile = extracted.find(f => f.toLowerCase().endsWith('.dbf'));
  if (!shpFile || !dbfFile) throw new Error('SHP or DBF not found in ZIP');

  console.log('Parsing DBF...');
  const recs = readDbf(readFileSync(join(TMP, dbfFile)));
  console.log(`${recs.length} records`);

  console.log('Parsing SHP...');
  const geoms = readShp(readFileSync(join(TMP, shpFile)));
  console.log(`${geoms.length} geometries`);

  const roadMap = {};
  let skipped = 0;
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.sg_tipo_tr !== 'B') { skipped++; continue; }
    const ki = r.vl_km_inic, kf = r.vl_km_fina;
    if (ki == null || kf == null) continue;
    const pts = geoms[i];
    if (!pts || pts.length < 2) continue;
    const br = String(r.vl_br).padStart(3, '0');
    const uf = r.sg_uf;
    const key = `${br}-${uf}`;
    (roadMap[key] = roadMap[key] || []).push({ ki, kf, pts });
  }
  console.log(`${Object.keys(roadMap).length} roads (skipped ${skipped} non-B segments)`);

  const args = process.argv.slice(2);
  const keys = Object.keys(roadMap).sort();
  const targets = args.length
    ? keys.filter(k => args.some(a => { const [b, u] = a.toUpperCase().split('/'); return k.startsWith(b) && (!u || k.endsWith(u)); }))
    : keys;

  const index = { snv, updated: new Date().toISOString().slice(0, 10), roads: [] };

  for (let i = 0; i < targets.length; i++) {
    const key = targets[i];
    const [br, uf] = key.split('-');
    const segs = roadMap[key];
    const data = buildRoadJson(segs, br, uf, snv);
    const file = `BR-${br}-${uf}.json`;
    writeFileSync(join(DATA_DIR, file), JSON.stringify(data));
    const sizeKB = Math.round(JSON.stringify(data).length / 1024);
    if ((i + 1) % 50 === 0 || i === targets.length - 1) {
      console.log(`[${i + 1}/${targets.length}] BR-${br}/${uf} ${data.km} km ${sizeKB} KB`);
    }
    index.roads.push({ br, uf, km: data.km, segs: data.segments.length, file });
  }

  writeFileSync(join(DATA_DIR, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`\nIndex saved with ${index.roads.length} roads (SNV ${snv})`);

  rmSync(TMP, { recursive: true, force: true });
  console.log('Temp files cleaned up.');
}

main().catch(e => { console.error(e); process.exit(1); });
