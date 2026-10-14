/* Assinatura do app de iPhone, feita toda pela API do App Store Connect (não precisa de Mac).
 *
 * O que faz, na ordem:
 *   1. registra o identificador br.com.kmcheck.app na conta da Apple (se ainda não existir);
 *   2. cria um certificado "Apple Distribution" (a chave privada é gerada AQUI e nunca sai do computador
 *      a não ser dentro do .p12 que vai para os segredos do GitHub);
 *   3. cria o perfil de distribuição "KM Check App Store" (App Store) ligando o identificador ao certificado;
 *   4. grava tudo em D:\KMCheck-chaves\ios\ (fora do repositório);
 *   5. com --github, grava os segredos no repositório wagnerxm/kmcheck para a compilação na nuvem
 *      (.github/workflows/ios-testflight.yml). Segredos do GitHub não aparecem no código nem nos logs.
 *
 * Pré-requisito: a chave de API do App Store Connect (papel Admin), que só pode ser baixada uma vez:
 *   D:\KMCheck-chaves\ios\AuthKey_<KEYID>.p8  e os códigos Key ID e Issuer ID.
 * Uso (a partir de mobile/):
 *   node ios-assinatura.mjs --key-id XXXXXXXXXX --issuer-id xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx [--github]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null };
const KEY_ID = arg('key-id'), ISSUER = arg('issuer-id'), GITHUB = process.argv.includes('--github');
const PASTA = 'D:/KMCheck-chaves/ios';
const BUNDLE = 'br.com.kmcheck.app', PERFIL = 'KM Check App Store', REPO = 'wagnerxm/kmcheck';
if (!KEY_ID || !ISSUER) { console.error('Faltou --key-id e/ou --issuer-id'); process.exit(1) }
const P8 = path.join(PASTA, `AuthKey_${KEY_ID}.p8`);
if (!fs.existsSync(P8)) { console.error('Não achei ' + P8); process.exit(1) }
fs.mkdirSync(PASTA, { recursive: true });

/* JWT ES256 do App Store Connect (vale 15 min) */
const b64u = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function token() {
  const agora = Math.floor(Date.now() / 1000);
  const cab = b64u(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
  const corpo = b64u(JSON.stringify({ iss: ISSUER, iat: agora, exp: agora + 900, aud: 'appstoreconnect-v1' }));
  const ass = crypto.sign('sha256', Buffer.from(cab + '.' + corpo), { key: fs.readFileSync(P8), dsaEncoding: 'ieee-p1363' });
  return cab + '.' + corpo + '.' + b64u(ass);
}
async function api(metodo, rota, corpo) {
  const r = await fetch('https://api.appstoreconnect.apple.com/v1/' + rota, {
    method: metodo, headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const txt = await r.text(); const j = txt ? JSON.parse(txt) : {};
  if (!r.ok) throw new Error(`${metodo} ${rota} → ${r.status}: ${(j.errors || []).map(e => e.detail || e.title).join(' | ') || txt}`);
  return j;
}
const openssl = (...a) => execFileSync('openssl', a, { stdio: ['ignore', 'pipe', 'pipe'] });

/* 1. identificador do app */
let bundle = (await api('GET', `bundleIds?filter[identifier]=${BUNDLE}&filter[platform]=IOS`)).data.find(d => d.attributes.identifier === BUNDLE);
if (!bundle) {
  bundle = (await api('POST', 'bundleIds', { data: { type: 'bundleIds', attributes: { identifier: BUNDLE, name: 'KM Check', platform: 'IOS' } } })).data;
  console.log('✓ identificador registrado:', BUNDLE);
} else console.log('✓ identificador já existia:', BUNDLE);

/* 2. certificado de distribuição (reaproveita o desta pasta se ele ainda estiver válido na Apple) */
const KEY = path.join(PASTA, 'distribuicao-chave.pem'), CER = path.join(PASTA, 'distribuicao.cer'), INFO = path.join(PASTA, 'info.json');
const info = fs.existsSync(INFO) ? JSON.parse(fs.readFileSync(INFO, 'utf8')) : {};
let cert = null;
if (info.certId && fs.existsSync(KEY)) {
  try { cert = (await api('GET', `certificates/${info.certId}`)).data; console.log('✓ certificado reaproveitado:', cert.attributes.name) } catch (e) { cert = null }
}
if (!cert) {
  openssl('genrsa', '-out', KEY, '2048');
  const csr = openssl('req', '-new', '-key', KEY, '-subj', '/emailAddress=suporte@kmcheck.com.br/CN=KM Check/C=BR').toString();
  cert = (await api('POST', 'certificates', { data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent: csr } } })).data;
  console.log('✓ certificado de distribuição criado:', cert.attributes.name, '— vence em', cert.attributes.expirationDate.slice(0, 10));
}
fs.writeFileSync(CER, Buffer.from(cert.attributes.certificateContent, 'base64'));
const PEM = path.join(PASTA, 'distribuicao-cert.pem');
openssl('x509', '-inform', 'DER', '-in', CER, '-out', PEM);
/* .p12 com algoritmos antigos (3DES/SHA1): o "security import" do macOS não abre o padrão novo do OpenSSL 3 */
const SENHA = info.p12Senha || crypto.randomBytes(18).toString('base64url');
const P12 = path.join(PASTA, 'distribuicao.p12');
openssl('pkcs12', '-export', '-inkey', KEY, '-in', PEM, '-out', P12, '-passout', 'pass:' + SENHA, '-name', 'KM Check Distribution',
  '-certpbe', 'PBE-SHA1-3DES', '-keypbe', 'PBE-SHA1-3DES', '-macalg', 'sha1');

/* 3. perfil App Store (se já existe com o mesmo nome, refaz — ele precisa apontar para ESTE certificado) */
const velhos = (await api('GET', `profiles?filter[name]=${encodeURIComponent(PERFIL)}`)).data;
for (const v of velhos) { await api('DELETE', `profiles/${v.id}`); console.log('• perfil antigo removido') }
const perfil = (await api('POST', 'profiles', { data: { type: 'profiles', attributes: { name: PERFIL, profileType: 'IOS_APP_STORE' },
  relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } }, certificates: { data: [{ type: 'certificates', id: cert.id }] } } } })).data;
const PROV = path.join(PASTA, 'KM_Check_App_Store.mobileprovision');
const provBuf = Buffer.from(perfil.attributes.profileContent, 'base64');
fs.writeFileSync(PROV, provBuf);
const TEAM = (provBuf.toString('latin1').match(/<key>TeamIdentifier<\/key>\s*<array>\s*<string>([A-Z0-9]+)<\/string>/) || [])[1];
console.log('✓ perfil criado:', PERFIL, '— time', TEAM);

fs.writeFileSync(INFO, JSON.stringify({ keyId: KEY_ID, issuerId: ISSUER, teamId: TEAM, certId: cert.id, perfilId: perfil.id, p12Senha: SENHA, atualizado: new Date().toISOString() }, null, 2));
console.log('✓ arquivos em', PASTA, '(faça cópia de segurança desta pasta)');

/* 4. segredos do GitHub para a compilação na nuvem */
if (GITHUB) {
  const seg = (nome, valor) => { execFileSync('gh', ['secret', 'set', nome, '--repo', REPO], { input: valor }); console.log('✓ segredo', nome) };
  seg('IOS_P12_BASE64', fs.readFileSync(P12).toString('base64'));
  seg('IOS_P12_SENHA', SENHA);
  seg('IOS_PERFIL_BASE64', provBuf.toString('base64'));
  seg('IOS_TEAM_ID', TEAM);
  seg('ASC_KEY_ID', KEY_ID);
  seg('ASC_ISSUER_ID', ISSUER);
  seg('ASC_KEY_P8', fs.readFileSync(P8, 'utf8'));
}
