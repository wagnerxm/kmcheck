/* Teste de carga da API do KM Check (roda NO VPS, direto na API, sem passar pela internet).
 * Simula N usuários diferentes (cada um com um IP próprio) abrindo o app no mesmo minuto:
 * cada um pede a lista de versões do SNV e baixa uma rodovia. Uso: node carga.mjs 1000 100 */
const N = +(process.argv[2] || 1000), PAR = +(process.argv[3] || 100);
const API = 'http://127.0.0.1:3010/api/rodovias';
/* rodovias mais pedidas no Nordeste (mistura de tamanhos) */
const RODS = ['226/RN', '101/RN', '304/RN', '110/RN', '405/RN', '427/RN', '230/PB', '101/PB', '104/PB', '232/PE', '101/PE', '116/CE', '222/CE', '020/CE', '316/PE', '407/PE', '428/PE', '135/PI', '343/PI', '316/PI'];
const tempos = { versoes: [], rodovia: [] }, status = {}; let bytes = 0;
async function pede(tipo, url, ip) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { headers: { Origin: 'https://kmcheck.com.br', 'X-Forwarded-For': ip } });
    const b = await r.arrayBuffer(); bytes += b.byteLength;
    status[r.status] = (status[r.status] || 0) + 1;
  } catch (e) { status.falha = (status.falha || 0) + 1; }
  tempos[tipo].push(performance.now() - t0);
}
async function usuario(i) {
  const ip = `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
  await pede('versoes', `${API}/versoes`, ip);
  const [br, uf] = RODS[i % RODS.length].split('/');
  await pede('rodovia', `${API}/${br}/${uf}?snv=202607a&tipo=B`, ip);
}
const t0 = Date.now(); let prox = 0;
await Promise.all(Array.from({ length: PAR }, async () => { while (prox < N) await usuario(prox++); }));
const total = (Date.now() - t0) / 1000;
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };
console.log(`${N} usuários (${PAR} ao mesmo tempo) em ${total.toFixed(1)} s · ${(bytes / 1048576).toFixed(0)} MB enviados`);
console.log('respostas:', JSON.stringify(status));
for (const k of Object.keys(tempos)) console.log(`${k.padEnd(8)} metade em até ${q(tempos[k], .5)} ms · 95% em até ${q(tempos[k], .95)} ms · pior ${q(tempos[k], 1)} ms`);
