// Trechos de PISTA DUPLA de todas as BRs (SNV: ds_sup_fed = 'DUP'), para o app avisar na câmera
// ("Trecho de pista dupla — marque PC ou PD" / "Fim da pista dupla — PC tirado da legenda").
//
// Fica num arquivo PEQUENO à parte (data/rodovias/duplicadas.json) em vez de dentro de cada rodovia: o app
// baixa as rodovias de três lugares (arquivo do site, API, GeoServer do DNIT) e quem já tem a rodovia no
// celular não a baixaria de novo — com o arquivo à parte, o aviso vale para qualquer rodovia instalada.
//
// Lê do GeoServer público do DNIT (WFS, sem token), só os atributos (sem a geometria): é rápido e leve.
// Uso: node scripts/duplicadas-wfs.mjs   (Node 20+; grava só se o conteúdo mudou)
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'data', 'rodovias', 'duplicadas.json');
const WFS = 'https://geoservicos.inde.gov.br/geoserver/DNIT/wfs';

async function pega(url, tentativas = 5) {
  let ult;
  for (let i = 1; i <= tentativas; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    } catch (e) {
      ult = e;
      console.log(`tentativa ${i}/${tentativas} falhou (${e.message}); tentando de novo...`);
      await new Promise(res => setTimeout(res, 5000 * i));
    }
  }
  throw ult;
}

async function main() {
  // camada mais nova do SNV no GeoServer (DNIT:snv_AAAAMMx)
  const cap = await (await pega(`${WFS}?service=WFS&request=GetCapabilities`)).text();
  const camadas = [...cap.matchAll(/<Name>(DNIT:snv_\d{6}\w*)<\/Name>/g)].map(m => m[1]).sort();
  if (!camadas.length) throw new Error('camada do SNV não encontrada no GeoServer');
  const camada = camadas[camadas.length - 1];
  const snv = camada.split('snv_')[1].toLowerCase();
  console.log('Camada:', camada);

  const props = 'vl_br,sg_uf,vl_km_inic,vl_km_fina';
  const cql = encodeURIComponent(`sg_tipo_tr='B' AND ds_sup_fed='DUP'`);
  const feats = [];
  for (let ini = 0; ; ini += 1000) {
    const url = `${WFS}?service=WFS&request=GetFeature&typeName=${camada}&outputFormat=application/json&propertyName=${props}&CQL_FILTER=${cql}&maxFeatures=1000&startIndex=${ini}`;
    const j = await (await pega(url)).json();
    feats.push(...j.features);
    if (j.features.length < 1000) break;
  }
  console.log(feats.length, 'trechos duplicados');

  // junta os trechos encostados (fim de um = início do outro, até 0,05 km de folga) por BR/UF
  const por = {};
  for (const f of feats) {
    const p = f.properties, a = +p.vl_km_inic, b = +p.vl_km_fina;
    if (!isFinite(a) || !isFinite(b)) continue;
    const k = String(p.vl_br).padStart(3, '0') + '-' + p.sg_uf;
    (por[k] = por[k] || []).push([Math.min(a, b), Math.max(a, b)]);
  }
  const roads = {};
  for (const k of Object.keys(por).sort()) {
    const iv = por[k].sort((x, y) => x[0] - y[0]), out = [];
    for (const [a, b] of iv) {
      const u = out[out.length - 1];
      if (u && a <= u[1] + 0.05) u[1] = Math.max(u[1], b); else out.push([a, b]);
    }
    roads[k] = out.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]);
  }

  const novo = { snv, roads };
  if (existsSync(OUT)) {
    const atual = JSON.parse(readFileSync(OUT, 'utf8'));
    if (JSON.stringify({ snv: atual.snv, roads: atual.roads }) === JSON.stringify(novo)) { console.log('Sem mudança.'); return }
  }
  writeFileSync(OUT, JSON.stringify({ ...novo, updated: new Date().toISOString().slice(0, 10) }));
  const n = Object.values(roads).reduce((s, v) => s + v.length, 0);
  console.log(`Gravado: ${Object.keys(roads).length} rodovias, ${n} trechos de pista dupla.`);
}

main().catch(e => { console.error(e); process.exit(1); });
