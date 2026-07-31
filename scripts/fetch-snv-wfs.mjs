import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data', 'rodovias');
const WFS = 'https://geoservicos.inde.gov.br/geoserver/DNIT/wfs';
const PAGE = 1000;

async function fetchRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) {
      if (i === retries - 1) throw e;
      console.log(`    retry ${i + 1}/${retries}...`);
      await new Promise(ok => setTimeout(ok, 2000 * (i + 1)));
    }
  }
}

async function findSnvLayer() {
  const r = await fetchRetry(`${WFS}?service=WFS&request=GetCapabilities`);
  const xml = await r.text();
  const m = [...xml.matchAll(/<Name>(DNIT:snv_\w+)<\/Name>/g)];
  if (!m.length) throw new Error('SNV layer not found');
  return m.map(x => x[1]).sort().pop();
}

async function listAllRoads(layer) {
  const url = `${WFS}?service=WFS&request=GetFeature&typeName=${layer}` +
    `&outputFormat=application/json&propertyName=vl_br,sg_uf,vl_km_inic,vl_km_fina` +
    `&maxFeatures=50000`;
  const r = await fetchRetry(url);
  const data = await r.json();
  const map = new Map();
  for (const f of data.features) {
    const { vl_br, sg_uf, vl_km_inic, vl_km_fina } = f.properties;
    if (!vl_br || !sg_uf) continue;
    const key = `${vl_br}-${sg_uf}`;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { br: vl_br, uf: sg_uf, kmin: vl_km_inic, kmax: vl_km_fina, segs: 1 });
    } else {
      cur.kmin = Math.min(cur.kmin, vl_km_inic);
      cur.kmax = Math.max(cur.kmax, vl_km_fina);
      cur.segs++;
    }
  }
  return [...map.values()].sort((a, b) => a.br.localeCompare(b.br) || a.uf.localeCompare(b.uf));
}

async function fetchRoad(layer, br, uf) {
  const fields = 'vl_br,sg_uf,vl_km_inic,vl_km_fina,vl_extensa,sg_tipo_tr,the_geom';
  const cql = encodeURIComponent(`vl_br='${br}' AND sg_uf='${uf}' AND sg_tipo_tr='B'`);
  let all = [], start = 0;
  while (true) {
    const url = `${WFS}?service=WFS&request=GetFeature&typeName=${layer}` +
      `&outputFormat=application/json&propertyName=${fields}` +
      `&CQL_FILTER=${cql}&maxFeatures=${PAGE}&startIndex=${start}`;
    const r = await fetchRetry(url);
    const data = await r.json();
    if (!data.features || !data.features.length) break;
    all = all.concat(data.features);
    if (data.features.length < PAGE) break;
    start += PAGE;
  }
  return all;
}

function extractCoords(geom) {
  if (!geom) return [];
  const round = v => Math.round(v * 1e7) / 1e7;
  if (geom.type === 'MultiLineString') {
    return geom.coordinates.flat().map(c => [round(c[0]), round(c[1])]);
  }
  if (geom.type === 'LineString') {
    return geom.coordinates.map(c => [round(c[0]), round(c[1])]);
  }
  return [];
}

function processRoad(features, br, uf, snv) {
  const segs = features
    .map(f => ({
      ki: f.properties.vl_km_inic,
      kf: f.properties.vl_km_fina,
      c: extractCoords(f.geometry)
    }))
    .filter(s => s.c.length > 0)
    .sort((a, b) => a.ki - b.ki);
  const km = segs.length ? Math.round(segs[segs.length - 1].kf * 10) / 10 : 0;
  return { br, uf, snv, updated: new Date().toISOString().slice(0, 10), km, segments: segs };
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  console.log('Buscando layer SNV mais recente...');
  const layer = await findSnvLayer();
  const snv = layer.split('snv_')[1];
  console.log(`Layer: ${layer}`);

  console.log('Listando rodovias...');
  const roads = await listAllRoads(layer);
  console.log(`${roads.length} combinacoes BR/UF encontradas`);

  const args = process.argv.slice(2);
  const targets = args.length
    ? roads.filter(r => args.some(a => {
        const [b, u] = a.toUpperCase().split('/');
        return r.br === b && (!u || r.uf === u);
      }))
    : roads;

  console.log(`Processando ${targets.length} rodovia(s)...\n`);

  const index = { snv, updated: new Date().toISOString().slice(0, 10), roads: [] };

  for (let i = 0; i < targets.length; i++) {
    const { br, uf } = targets[i];
    const label = `BR-${br}/${uf}`;
    process.stdout.write(`[${i + 1}/${targets.length}] ${label}...`);

    try {
      const feats = await fetchRoad(layer, br, uf);
      const data = processRoad(feats, br, uf, snv);
      const file = `BR-${br}-${uf}.json`;
      writeFileSync(join(DATA_DIR, file), JSON.stringify(data));
      const sizeKB = Math.round(JSON.stringify(data).length / 1024);
      console.log(` ${feats.length} segs, ${data.km} km, ${sizeKB} KB`);
      index.roads.push({ br, uf, km: data.km, segs: data.segments.length, file });
    } catch (e) {
      console.log(` ERRO: ${e.message}`);
    }

    if (i < targets.length - 1) await new Promise(ok => setTimeout(ok, 300));
  }

  writeFileSync(join(DATA_DIR, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`\nIndex salvo com ${index.roads.length} rodovias`);
}

main().catch(e => { console.error(e); process.exit(1); });
