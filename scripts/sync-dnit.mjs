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
