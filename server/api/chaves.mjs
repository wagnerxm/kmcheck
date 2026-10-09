/* Gerencia as chaves de acesso dos apps que consomem a base do KM Check.
 * Rodar dentro do container:  docker compose exec api node chaves.mjs <comando>
 *   listar
 *   criar "Nome do app" [limite_por_minuto]   → mostra a chave UMA vez (só o hash fica salvo)
 *   desativar <id>  |  ativar <id>
 */
import pg from 'pg';
import crypto from 'node:crypto';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const [cmd, a1, a2] = process.argv.slice(2);
try {
  if (cmd === 'listar') {
    const { rows } = await pool.query('SELECT id, nome, ativo, limite_min, total_req, ultimo_uso, criado_em FROM api_clients ORDER BY id');
    console.table(rows);
  } else if (cmd === 'criar' && a1) {
    const chave = 'kmc_' + crypto.randomBytes(24).toString('base64url');
    const h = crypto.createHash('sha256').update(chave).digest('hex');
    const { rows } = await pool.query('INSERT INTO api_clients (nome, chave_hash, limite_min) VALUES ($1,$2,$3) RETURNING id', [a1, h, +a2 || 300]);
    console.log(`App "${a1}" criado (id ${rows[0].id}).\nChave (guarde agora, não aparece de novo):\n${chave}`);
  } else if ((cmd === 'desativar' || cmd === 'ativar') && a1) {
    await pool.query('UPDATE api_clients SET ativo = $2 WHERE id = $1', [+a1, cmd === 'ativar']);
    console.log(`App ${a1} ${cmd === 'ativar' ? 'ativado' : 'desativado'}.`);
  } else console.log('Uso: listar | criar "Nome" [limite/min] | desativar <id> | ativar <id>');
} finally { await pool.end() }
