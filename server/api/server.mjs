/* KM Check API — base de rodovias (SNV/DNIT) do KM Check, servida também para outros apps.
 *
 * Leitura (mesmas rotas e respostas da API antiga do controlcheck, para o app não mudar nada):
 *   GET  /api/health
 *   GET  /api/rodovias/versoes            versões do SNV disponíveis
 *   GET  /api/rodovias                    lista (sem geometria)      ?snv= &tipo=
 *   GET  /api/rodovias/:br                UFs de uma BR              ?snv= &tipo=
 *   GET  /api/rodovias/:br/:uf/versoes    versões de uma BR/UF
 *   GET  /api/rodovias/:br/:uf            geometria completa         ?snv= &tipo= (padrão B)
 * Importação (scripts do pipeline do SNV; cabeçalho x-import-key):
 *   POST /api/rodovias/versoes | /import | /reset
 *
 * Acesso por app: cada app consumidor recebe uma chave (tabela api_clients), enviada no cabeçalho
 * x-api-key (ou ?key=). O próprio KM Check (site e app Android) é reconhecido pela origem.
 * REQUIRE_KEY=1 bloqueia quem não tem chave nem origem conhecida; com 0 só registra (transição).
 */
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import crypto from 'node:crypto';

const PORT = +process.env.PORT || 3000;
const IMPORT_KEY = process.env.IMPORT_KEY || '';
const REQUIRE_KEY = process.env.REQUIRE_KEY === '1';
const ORIGENS_KMCHECK = (process.env.KMCHECK_ORIGINS ||
  'https://kmcheck.com.br,https://www.kmcheck.com.br,https://wagnerxm.github.io,https://controlcheck.duckdns.org,https://localhost,capacitor://localhost,http://localhost')
  .split(',').map(s => s.trim()).filter(Boolean);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
const query = async (t, p) => (await pool.query(t, p)).rows;
const queryOne = async (t, p) => (await pool.query(t, p)).rows[0] ?? null;

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
/* CORS aberto: quem controla o acesso é a chave, não a origem (apps de outros domínios precisam ler) */
app.use(cors({ origin: true, allowedHeaders: ['Content-Type', 'x-api-key', 'x-import-key'] }));
app.use(express.json({ limit: '100mb' }));

/* ── identificação do app consumidor + limite por minuto ── */
const hash = k => crypto.createHash('sha256').update(k).digest('hex');
const cacheChaves = new Map();   // hash → {cliente, até}
const uso = new Map();           // id do cliente → {n, janela, total}
async function clientePorChave(k) {
  const h = hash(k), c = cacheChaves.get(h);
  if (c && c.ate > Date.now()) return c.cliente;
  const cli = await queryOne('SELECT id, nome, ativo, limite_min FROM api_clients WHERE chave_hash = $1', [h]);
  cacheChaves.set(h, { cliente: cli, ate: Date.now() + 60000 });
  return cli;
}
async function acesso(req, res, next) {
  if (req.path === '/api/health') return next();
  const chave = req.get('x-api-key') || req.query.key;
  let cli = null;
  if (chave) {
    cli = await clientePorChave(String(chave)).catch(() => null);
    if (!cli || !cli.ativo) return res.status(401).json({ error: 'Chave de API inválida ou desativada.' });
  } else {
    const origem = req.get('origin') || '';
    if (ORIGENS_KMCHECK.includes(origem)) cli = { id: 'kmcheck-app', nome: 'KM Check', limite_min: 600 };
    else if (REQUIRE_KEY && !req.get('x-import-key')) return res.status(401).json({ error: 'Envie a chave de API no cabeçalho x-api-key.' });
    else cli = { id: 'anonimo', nome: 'Sem chave', limite_min: 120 };
  }
  /* limite simples por minuto, por app (evita um app derrubar a base dos outros) */
  const agora = Math.floor(Date.now() / 60000), u = uso.get(cli.id) || { n: 0, janela: agora, total: 0 };
  if (u.janela !== agora) { u.n = 0; u.janela = agora }
  u.n++; u.total++; uso.set(cli.id, u);
  if (u.n > (cli.limite_min || 120)) return res.status(429).json({ error: 'Muitas requisições. Tente de novo em um minuto.' });
  req.cliente = cli;
  next();
}
app.use(acesso);
/* grava o uso das chaves a cada 30 s (não a cada requisição) */
setInterval(async () => {
  for (const [id, u] of uso) {
    if (typeof id !== 'number' || !u.total) continue;
    const n = u.total; u.total = 0;
    await pool.query('UPDATE api_clients SET total_req = total_req + $2, ultimo_uso = NOW() WHERE id = $1', [id, n]).catch(() => { u.total += n });
  }
}, 30000).unref();

app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, servico: 'kmcheck-api' }) }
  catch { res.status(503).json({ ok: false }) }
});

/* ── leitura ── */
const r = express.Router();
const pad = br => String(br).replace(/\D/g, '').padStart(3, '0');
r.get('/versoes', async (_req, res) => {
  try {
    res.json(await query(`SELECT id, label, data_publicacao, arquivo_dnit, total_rodovias, status, created_at
                          FROM snv_versoes ORDER BY id DESC`));
  } catch (e) { if (e.code === '42P01') return res.json([]); res.status(500).json({ error: 'Erro ao listar versões SNV.' }) }
});
r.get('/', async (req, res) => {
  try {
    const snv = String(req.query.snv || '').toLowerCase(), tipo = String(req.query.tipo || '').toUpperCase() || null;
    const cols = 'id, br, uf, tipo_tr, km_min, km_max, fonte, versao_snv, data_atualizacao';
    let rows;
    if (snv && tipo) rows = await query(`SELECT ${cols} FROM rodovias WHERE versao_snv = $1 AND tipo_tr = $2 ORDER BY br, uf`, [snv, tipo]);
    else if (snv) rows = await query(`SELECT ${cols} FROM rodovias WHERE versao_snv = $1 ORDER BY br, uf`, [snv]);
    else rows = await query(`SELECT DISTINCT ON (br, uf, tipo_tr) ${cols} FROM rodovias ORDER BY br, uf, tipo_tr, versao_snv DESC`);
    res.json(rows);
  } catch { res.status(500).json({ error: 'Erro ao listar rodovias.' }) }
});
r.get('/:br', async (req, res) => {
  try {
    const br = pad(req.params.br), snv = String(req.query.snv || '').toLowerCase(), tipo = String(req.query.tipo || '').toUpperCase() || null;
    const cols = 'id, br, uf, tipo_tr, km_min, km_max, fonte, versao_snv';
    let rows;
    if (snv && tipo) rows = await query(`SELECT ${cols} FROM rodovias WHERE br = $1 AND versao_snv = $2 AND tipo_tr = $3 ORDER BY uf`, [br, snv, tipo]);
    else if (snv) rows = await query(`SELECT ${cols} FROM rodovias WHERE br = $1 AND versao_snv = $2 ORDER BY uf`, [br, snv]);
    else rows = await query(`SELECT DISTINCT ON (uf, tipo_tr) ${cols} FROM rodovias WHERE br = $1 ORDER BY uf, tipo_tr, versao_snv DESC`, [br]);
    res.json(rows);
  } catch { res.status(500).json({ error: 'Erro ao buscar rodovia.' }) }
});
r.get('/:br/:uf/versoes', async (req, res) => {
  try {
    res.json(await query(`SELECT r.versao_snv, r.km_min, r.km_max, r.data_atualizacao, v.label, v.data_publicacao
                          FROM rodovias r LEFT JOIN snv_versoes v ON v.id = r.versao_snv
                          WHERE r.br = $1 AND r.uf = $2 ORDER BY r.versao_snv DESC`, [pad(req.params.br), String(req.params.uf).toUpperCase()]));
  } catch { res.status(500).json({ error: 'Erro ao buscar versões.' }) }
});
r.get('/:br/:uf', async (req, res) => {
  try {
    const br = pad(req.params.br), uf = String(req.params.uf).toUpperCase();
    const snv = String(req.query.snv || '').toLowerCase(), tipo = String(req.query.tipo || 'B').toUpperCase();
    const row = snv
      ? await queryOne('SELECT * FROM rodovias WHERE br = $1 AND uf = $2 AND versao_snv = $3 AND tipo_tr = $4 LIMIT 1', [br, uf, snv, tipo])
      : await queryOne('SELECT * FROM rodovias WHERE br = $1 AND uf = $2 AND tipo_tr = $3 ORDER BY versao_snv DESC LIMIT 1', [br, uf, tipo]);
    if (!row) return res.status(404).json({ error: `Rodovia BR-${br}/${uf} (tipo ${tipo})${snv ? ' SNV ' + snv : ''} não encontrada.` });
    res.json(row);
  } catch { res.status(500).json({ error: 'Erro ao buscar geometria.' }) }
});

/* ── importação (pipeline do SNV) ── */
const chaveImport = (req, res) => {
  if (!IMPORT_KEY || req.get('x-import-key') !== IMPORT_KEY) { res.status(403).json({ error: 'Chave de importação inválida.' }); return false }
  return true;
};
r.post('/versoes', async (req, res) => {
  if (!chaveImport(req, res)) return;
  try {
    const { id, label, arquivo_dnit, total_rodovias, status } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id é obrigatório.' });
    await pool.query(`INSERT INTO snv_versoes (id, label, arquivo_dnit, total_rodovias, status) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (id) DO UPDATE SET label = COALESCE(EXCLUDED.label, snv_versoes.label),
        arquivo_dnit = COALESCE(EXCLUDED.arquivo_dnit, snv_versoes.arquivo_dnit),
        total_rodovias = COALESCE(EXCLUDED.total_rodovias, snv_versoes.total_rodovias),
        status = COALESCE(EXCLUDED.status, snv_versoes.status)`,
      [id, label || id, arquivo_dnit || '', total_rodovias || 0, status || 'concluido']);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao registrar versão.' }) }
});
r.post('/import', async (req, res) => {
  if (!chaveImport(req, res)) return;
  const { rodovias, versao_snv } = req.body || {};
  if (!versao_snv) return res.status(400).json({ error: 'versao_snv é obrigatório.' });
  if (!Array.isArray(rodovias) || !rodovias.length) return res.status(400).json({ error: 'Envie { versao_snv, rodovias: [...] }' });
  const c = await pool.connect(); let n = 0;
  try {
    await c.query('BEGIN');
    for (const rod of rodovias) {
      const snv = String(versao_snv).toLowerCase(), tipo = String(rod.tipo_tr || 'B').toUpperCase();
      await c.query(`INSERT INTO rodovias (id, br, uf, tipo_tr, fonte, km_min, km_max, lat, lon, km, versao_snv, data_atualizacao)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
        ON CONFLICT (id) DO UPDATE SET km_min=EXCLUDED.km_min, km_max=EXCLUDED.km_max, lat=EXCLUDED.lat, lon=EXCLUDED.lon,
          km=EXCLUDED.km, data_atualizacao=EXCLUDED.data_atualizacao, fonte=EXCLUDED.fonte, tipo_tr=EXCLUDED.tipo_tr`,
        [`rod-${rod.br}-${tipo}-${rod.uf}-${snv}`, rod.br, rod.uf, tipo, rod.fonte || 'SNV/DNIT', rod.km_min, rod.km_max, rod.lat, rod.lon, rod.km, snv]);
      n++;
    }
    await c.query('COMMIT');
    res.json({ ok: true, inseridas: n, total: rodovias.length });
  } catch (e) { await c.query('ROLLBACK'); console.error(e); res.status(500).json({ error: 'Erro ao importar rodovias.' }) }
  finally { c.release() }
});
r.post('/reset', async (req, res) => {
  if (!chaveImport(req, res)) return;
  try {
    const { versao_snv, all } = req.body || {};
    if (all) { await pool.query('DELETE FROM rodovias'); await pool.query(`UPDATE snv_versoes SET status='disponivel', total_rodovias=0`); return res.json({ ok: true }) }
    if (!versao_snv) return res.status(400).json({ error: 'Informe versao_snv ou all:true.' });
    const snv = String(versao_snv).toLowerCase();
    await pool.query('DELETE FROM rodovias WHERE versao_snv = $1', [snv]);
    await pool.query(`UPDATE snv_versoes SET status='disponivel', total_rodovias=0 WHERE id = $1`, [snv]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro ao resetar.' }) }
});
app.use('/api/rodovias', r);

app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.listen(PORT, '0.0.0.0', () => console.log(`kmcheck-api na porta ${PORT} (REQUIRE_KEY=${REQUIRE_KEY ? 1 : 0})`));
