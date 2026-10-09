/* Manual web do KM Check: comportamento. Um único laço de rolagem (requestAnimationFrame) atualiza
   tudo o que depende da posição; o resto usa IntersectionObserver. Só transform/opacity/clip-path. */
(() => {
  const reduz = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fino = matchMedia('(pointer: fine)').matches;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const telaEscura = img => img && img.dataset.esc === '1';

  /* ---------- palavras que sobem: divide os títulos em palavras ---------- */
  $$('[data-rev]').forEach(el => {
    let i = 0;
    const parte = no => {
      [...no.childNodes].forEach(c => {
        if (c.nodeType === 3) {
          const frag = document.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach(t => {
            if (!t) return;
            if (/^\s+$/.test(t)) { frag.append(t); return; }
            const w = document.createElement('span'); w.className = 'w';
            const wi = document.createElement('span'); wi.className = 'wi'; wi.style.setProperty('--i', i++); wi.textContent = t;
            w.append(wi); frag.append(w);
          });
          c.replaceWith(frag);
        } else if (c.nodeType === 1 && c.tagName !== 'BR') parte(c);
      });
    };
    parte(el);
  });
  const ioVis = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('vis'); ioVis.unobserve(e.target); } }), { rootMargin: '0px 0px -12% 0px' });
  $$('[data-rev],[data-sobe]').forEach(el => ioVis.observe(el));

  /* ---------- luz que segue o ponteiro nos cartões ---------- */
  if (fino && !reduz) document.addEventListener('pointermove', e => {
    const c = e.target.closest && e.target.closest('.cdk'); if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  /* ---------- manifesto: o texto se preenche com a rolagem ---------- */
  const manif = $('.manifesto'), mWords = manif ? $$('.w', manif) : [];

  /* ---------- rolagem guiada (celular parado + holofote) ---------- */
  $$('.story').forEach(st => {
    const fig = $('.story-fig', st), fone = $('.fone', fig), foco = $('.foco', fig), passos = $$('.passo', st);
    const ativa = p => {
      passos.forEach(x => x.classList.toggle('ativo', x === p));
      const t = p.dataset.tela, deit = p.dataset.or === 'deitado';
      fig.classList.toggle('deitado', deit);
      if (deit) { const d = $('.fone-d', fig); $$('.tl', d).forEach(i => i.classList.toggle('on', i.dataset.t === t)); }
      else if (fone) {
        let atual = null;
        $$('.tl', fone).forEach(i => { const on = i.dataset.t === t; i.classList.toggle('on', on); if (on) atual = i; });
        fone.classList.toggle('esc', telaEscura(atual));
      }
      if (fig.classList.contains('foto')) fig.classList.toggle('zoom', !!p.dataset.box);
      if (foco) {
        if (p.dataset.box) {
          const [l, t2, w, h] = p.dataset.box.split(',').map(Number);
          Object.assign(foco.style, { left: l + '%', top: t2 + '%', width: w + '%', height: h + '%' });
          foco.classList.remove('livre');
        } else foco.classList.add('livre');
      }
    };
    const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && ativa(e.target)), { rootMargin: '-46% 0px -46% 0px' });
    passos.forEach(p => io.observe(p));
    if (passos[0]) ativa(passos[0]);
  });

  /* ---------- painel fixo: KM do capítulo (odômetro) + progresso + sumário ---------- */
  const hud = $('.hud'), hudTit = $('.hud-txt b', hud), hudOlho = $('.hud-txt .cl', hud), reels = $$('.reel', hud), hudMenu = $('.hud-menu', hud), hudBar = $('.hud-bar', hud);
  const caps = $$('.cap'), hero = $('.hero');
  let capAtual = null;
  const odo = num => { String(num).padStart(2, '0').split('').forEach((d, i) => { reels[i].style.transform = 'translateY(' + (-(+d)) + 'em)'; }); };
  /* embaralhar letras: o nome do capítulo troca como placa de aeroporto */
  let embT = 0;
  const embaralha = alvo => {
    if (reduz) { hudTit.textContent = alvo; return; }
    const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', ini = performance.now(), id = ++embT;
    const passo = agora => {
      if (id !== embT) return;
      const k = Math.min(1, (agora - ini) / 520), fix = Math.floor(alvo.length * k);
      hudTit.textContent = alvo.split('').map((c, i) => i < fix || c === ' ' ? c : letras[Math.floor(Math.random() * letras.length)]).join('');
      if (k < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  };
  const ioCap = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    const c = e.target; if (c === capAtual) return; capAtual = c;
    odo(c.dataset.km); embaralha(c.dataset.titulo); hudOlho.textContent = 'KM ' + c.dataset.km;
    $$('a', hudMenu).forEach(a => a.classList.toggle('atual', a.getAttribute('href') === '#' + c.id));
  }), { rootMargin: '-40% 0px -55% 0px' });
  caps.forEach(c => ioCap.observe(c));
  const ioPassou = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting || e.boundingClientRect.top < 0) e.target.classList.add('passou'); }), { rootMargin: '0px 0px -45% 0px' });
  caps.forEach(c => ioPassou.observe(c));
  const abreMenu = abrir => { hudMenu.hidden = !abrir; hud.toggleAttribute('data-aberto', abrir); hudBar.setAttribute('aria-expanded', abrir); };
  hudBar.addEventListener('click', () => abreMenu(hudMenu.hidden));
  $$('a', hudMenu).forEach(a => a.addEventListener('click', () => abreMenu(false)));
  document.addEventListener('click', e => { if (!hud.contains(e.target)) abreMenu(false); });

  /* ---------- guia rápido: cartões que empilham ---------- */
  const cartoes = $$('.cartao-passo');

  /* ---------- galeria das configurações: anda de lado com a rolagem ---------- */
  const gal = $('.galeria'), trilha = gal && $('.trilha', gal);
  let galDist = 0;
  const medeGal = () => {
    if (!gal) return;
    const nativo = reduz || innerWidth < 760;
    gal.classList.toggle('nativo', nativo);
    if (nativo) { gal.style.height = ''; trilha.style.transform = ''; galDist = 0; return; }
    galDist = Math.max(0, trilha.scrollWidth - innerWidth + 40);
    gal.style.height = (innerHeight + galDist) + 'px';
  };

  /* ---------- laço de rolagem ---------- */
  const viagem = $('.viagem'), eixo = $('.eixo i'), trilhoHud = $('.trilho i', hud), palcoFoto = $('.palco-foto');
  let pedido = false;
  const quadro = () => {
    pedido = false;
    const vh = innerHeight, y = scrollY;
    /* painel fixo aparece depois do topo */
    const hb = hero.getBoundingClientRect().bottom;
    hud.classList.toggle('on', hb < 40 && viagem.getBoundingClientRect().top < vh * .35);
    if (hb >= 40 && !hudMenu.hidden) abreMenu(false);
    /* leve paralaxe na foto do palco enquanto o topo sai */
    if (palcoFoto && !reduz) palcoFoto.style.setProperty('--paralaxe', Math.min(1, Math.max(0, -hero.getBoundingClientRect().top / vh)).toFixed(3));
    /* progresso da viagem (eixo lateral e barra do painel) */
    const r = viagem.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (vh * .5 - r.top) / r.height));
    eixo.style.setProperty('--p', p.toFixed(4)); trilhoHud.style.setProperty('--p', p.toFixed(4));
    /* manifesto */
    if (manif && !reduz) {
      const m = manif.getBoundingClientRect(), k = Math.min(1, Math.max(0, -m.top / (m.height - vh)));
      const ate = Math.round(k * 1.15 * mWords.length);
      mWords.forEach((w, i) => w.classList.toggle('on', i < ate));
    }
    /* cartões empilhados: os de trás recuam um pouco quando o próximo encosta */
    if (!reduz && cartoes.length) {
      const tops = cartoes.map(c => c.getBoundingClientRect().top);
      cartoes.forEach((c, i) => {
        let atras = 0;
        for (let j = i + 1; j < cartoes.length; j++) {
          const alvo = parseFloat(getComputedStyle(cartoes[j]).top);
          const prog = Math.min(1, Math.max(0, 1 - (tops[j] - alvo) / (vh * .6)));
          atras += prog;
        }
        c.style.transform = atras ? 'scale(' + (1 - atras * .045).toFixed(4) + ')' : '';
        c.style.filter = atras ? 'brightness(' + (1 - atras * .12).toFixed(3) + ')' : '';
      });
    }
    /* galeria lateral */
    if (gal && galDist) {
      const g = gal.getBoundingClientRect(), k = Math.min(1, Math.max(0, -g.top / galDist));
      trilha.style.transform = 'translate3d(' + (-k * galDist).toFixed(1) + 'px,0,0)';
    }
  };
  const pede = () => { if (!pedido) { pedido = true; requestAnimationFrame(quadro); } };
  addEventListener('scroll', pede, { passive: true });
  addEventListener('resize', () => { medeGal(); pede(); });
  medeGal(); quadro();

  /* ---------- dicas: janela que nasce do cartão ---------- */
  let janela = null, origem = null;
  const fechaJanela = () => {
    if (!janela) return;
    const j = janela, v = $('.veu'), r = origem.getBoundingClientRect(), f = j.getBoundingClientRect();
    j.classList.remove('on'); v.classList.remove('on');
    if (!reduz) {
      j.style.transition = 'transform .45s var(--ease)';
      j.style.transform = 'translate(' + (r.left - f.left) + 'px,' + (r.top - f.top) + 'px) scale(' + (r.width / f.width) + ',' + (r.height / f.height) + ')';
    }
    setTimeout(() => { j.remove(); v.remove(); }, reduz ? 0 : 450);
    origem.focus({ preventScroll: true }); janela = null;
  };
  $$('.faq-c').forEach(c => c.addEventListener('click', () => {
    if (janela) return;
    origem = c;
    const v = document.createElement('div'); v.className = 'veu'; document.body.append(v);
    const j = document.createElement('div'); j.className = 'janela cdk'; j.setAttribute('role', 'dialog'); j.setAttribute('aria-modal', 'true'); j.setAttribute('aria-label', c.dataset.t);
    j.innerHTML = '<div class="conteudo"><span class="cl">Dicas e soluções</span><h3></h3><p></p></div><button class="fechar" aria-label="Fechar"><svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3 3 9"/></svg></button>';
    $('h3', j).textContent = c.dataset.t; $('p', j).textContent = c.dataset.r;
    if (c.dataset.img) { const im = document.createElement('img'); im.src = c.dataset.img; im.alt = ''; $('.conteudo', j).append(im); }
    document.body.append(j);
    /* nasce do cartão: começa no tamanho e posição dele e cresce até o centro */
    const f = j.getBoundingClientRect(), r = c.getBoundingClientRect();
    j.style.left = f.left + 'px'; j.style.top = f.top + 'px'; j.style.transform = 'none';
    const f2 = j.getBoundingClientRect();
    if (!reduz) {
      j.style.transform = 'translate(' + (r.left - f2.left) + 'px,' + (r.top - f2.top) + 'px) scale(' + (r.width / f2.width) + ',' + (r.height / f2.height) + ')';
      j.getBoundingClientRect();
      j.style.transition = 'transform .55s var(--ease)'; j.style.transform = 'none';
    }
    requestAnimationFrame(() => { v.classList.add('on'); j.classList.add('on'); });
    $('.fechar', j).addEventListener('click', fechaJanela); v.addEventListener('click', fechaJanela);
    $('.fechar', j).focus({ preventScroll: true }); janela = j;
  }));

  /* ---------- topo interativo ---------- */
  const cena = $('.cena'), status = $('.h-status'), area = $('.dock-area');
  const pontos = $$('.ponto', cena);
  const T = reduz ? 0 : 620;
  const HOVER = { camera: '10-camera', carro: '20-carro-dia' };
  const FRASES = { geral: 'Toque num ponto para começar.', camera: 'Câmera aberta. Toque nos números.', carro: 'Modo Carro aberto. Toque nos números.', noite: 'Escolha dia ou noite.', girar: 'Escolha em pé ou deitado.' };
  let modo = 'geral', menu = null, quer = null;
  const tela = n => { let a = null; $$('.h-cel .tl', cena).forEach(i => { const on = i.dataset.t === n; i.classList.toggle('on', on); if (on) a = i; }); $('.h-cel', cena).classList.toggle('esc', telaEscura(a)); };
  const diz = t => { status.textContent = t; };
  const mira = id => { if (modo !== 'geral' || menu) return; quer = id; tela(HOVER[id] || '01-inicio'); };
  const solta = id => { if (quer !== id || modo !== 'geral' || menu) return; quer = null; tela('01-inicio'); };
  function entra(id) {
    if (modo !== 'geral' || menu) return;
    const det = $('[data-det="' + id + '"]', cena);
    modo = 'entrando'; cena.dataset.modo = 'entrando'; tela(HOVER[id]);
    det.hidden = false; requestAnimationFrame(() => requestAnimationFrame(() => det.classList.add('on')));
    pontos.forEach(p => p.disabled = true);
    setTimeout(() => { modo = 'detalhe'; cena.dataset.modo = 'detalhe'; $('.voltar', det).focus({ preventScroll: true }); diz(FRASES[id]); }, T);
  }
  function volta(depois) {
    if (modo !== 'detalhe') return;
    const det = $('.det:not([hidden])', cena), id = det.dataset.det;
    modo = 'voltando'; det.classList.remove('on'); cena.dataset.modo = 'geral'; tela('01-inicio');
    setTimeout(() => {
      det.hidden = true; $$('[aria-expanded="true"]', det).forEach(b => b.setAttribute('aria-expanded', 'false')); $$('.dp.on', det).forEach(b => b.classList.remove('on'));
      modo = 'geral'; pontos.forEach(p => p.disabled = false); diz(FRASES.geral);
      if (depois) depois(); else $('[data-p="' + id + '"]', cena).focus({ preventScroll: true });
    }, T);
  }
  function abreMenuCena(id) {
    if (modo !== 'geral') return;
    if (menu === id) return fechaMenuCena();
    if (menu) fechaMenuCena(true);
    menu = id; quer = null; cena.dataset.menu = id;
    const d = $('[data-menu="' + id + '"]', area);
    d.hidden = false; area.classList.add('menu');
    pontos.forEach(p => { p.disabled = p.dataset.p !== id; });
    aplica(id, $('.op.sel', d).dataset.v); $('.op.sel', d).focus({ preventScroll: true }); diz(FRASES[id]);
  }
  function aplica(id, v) {
    if (id === 'noite') tela(v === 'noite' ? '21-carro-noite' : '20-carro-dia');
    if (id === 'girar') { if (v === 'deitado') cena.dataset.girado = ''; else delete cena.dataset.girado; }
  }
  function fechaMenuCena(silencio) {
    if (!menu) return;
    const id = menu, d = $('[data-menu="' + id + '"]', area);
    d.hidden = true; area.classList.remove('menu'); menu = null; delete cena.dataset.menu;
    delete cena.dataset.girado; tela('01-inicio');
    pontos.forEach(p => { p.disabled = false; });
    if (!silencio) { $('[data-p="' + id + '"]', cena).focus({ preventScroll: true }); diz(FRASES.geral); }
  }
  pontos.forEach(p => {
    const id = p.dataset.p, det = id in HOVER;
    p.addEventListener('pointerenter', () => det && mira(id));
    p.addEventListener('pointerleave', () => det && solta(id));
    p.addEventListener('focus', () => det && mira(id));
    p.addEventListener('blur', () => det && solta(id));
    p.addEventListener('click', () => det ? entra(id) : abreMenuCena(id));
  });
  $$('.dock', area).forEach(d => {
    $$('.op', d).forEach(o => o.addEventListener('click', () => {
      $$('.op', d).forEach(x => { x.classList.toggle('sel', x === o); x.setAttribute('aria-pressed', x === o); });
      aplica(d.dataset.menu, o.dataset.v);
    }));
    $('.fechar', d).addEventListener('click', () => fechaMenuCena());
  });
  $$('.det', cena).forEach(det => {
    $('.voltar', det).addEventListener('click', () => volta());
    /* "Ler o capítulo": fecha o detalhe e segue rolando até o capítulo */
    $('.ir', det).addEventListener('click', e => { e.preventDefault(); const alvo = $(e.currentTarget.getAttribute('href')); volta(() => alvo.scrollIntoView({ behavior: reduz ? 'auto' : 'smooth' })); });
    const liga = i => {
      const b = $$('.dl', det)[i], abre = b.getAttribute('aria-expanded') !== 'true';
      $$('.dl', det).forEach((x, j) => x.setAttribute('aria-expanded', abre && j === i));
      $$('.dp', det).forEach((x, j) => x.classList.toggle('on', abre && j === i));
    };
    $$('.dl', det).forEach((b, i) => b.addEventListener('click', () => liga(i)));
    $$('.dp', det).forEach((b, i) => b.addEventListener('click', () => liga(i)));
  });
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (janela) fechaJanela();
    else if (!hudMenu.hidden) abreMenu(false);
    else if (modo === 'detalhe') volta();
    else if (menu) fechaMenuCena();
  });
  window.__manual = { entra, volta, abreMenuCena, fechaMenuCena };
})();
