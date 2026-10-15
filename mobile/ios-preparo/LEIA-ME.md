# KM Check na App Store (iPhone) — preparo e passo a passo

O app do iPhone é o **mesmo `index.html`** do site e do Android, embalado pelo **Capacitor 8.5.3**
(a mesma versão do Android).

**Situação (14/10/2026):** o projeto do iPhone **já existe** em `mobile/ios` (gerado pelo `npx cap add ios` e
ajustado), e é **compilado num Mac do GitHub** pelo workflow `.github/workflows/ios-testflight.yml` — **não é
preciso ter Mac**. Os arquivos que antes ficavam nesta pasta para copiar foram para o lugar definitivo:

| Arquivo | Onde está | O que é |
|---|---|---|
| `Info.plist` | `mobile/ios/App/App/` | pt-BR, textos das permissões, só retrato, criptografia isenta, pasta no app Arquivos |
| `PrivacyInfo.xcprivacy` | `mobile/ios/App/App/` (já no alvo App) | manifesto de privacidade (dados coletados + APIs com motivo obrigatório) |
| `KMCheckNativoPlugin.swift` | `mobile/ios/App/App/` | plugin nativo, o mesmo do Java (+ infoAparelho, vibrar e o **GPS nativo** gpsVigiar/gpsParar, só iPhone) |
| `MainViewController.swift` | `mobile/ios/App/App/` | registra o plugin, `confirm()`/`alert()` em português, fundo escuro, sem "elástico" |
| ícone e abertura | `mobile/ios/App/App/Assets.xcassets/` | ícone 1024×1024 **sem transparência**, redesenhado nítido (`mobile/gerar-icones-ios.mjs`) |
| assinatura | `mobile/ios-assinatura.mjs` | cria certificado, perfil e os segredos do GitHub pela API da Apple |

**GPS no iPhone:** o `navigator.geolocation` do WKWebView pede a permissão duas vezes (a do iOS e outra
"“localhost” quer usar sua localização" a cada abertura). Por isso, no app do iPhone, o `index.html` troca o
`navigator.geolocation` pelo GPS nativo do plugin (CoreLocation), no mesmo formato — o resto do app não muda.

---

## 1. O que só o dono (Wagner / A1 ENGENHARIA) pode fazer

1. **Conta Apple Developer Program — US$ 99 por ano.** Para publicar como empresa (o nome do vendedor na loja
   sai "A1 ENGENHARIA LTDA", igual à Google Play) a inscrição é de **Organização** e pede o
   **número D-U-N-S** da empresa (gratuito, pedido pela própria Apple/Dun & Bradstreet; pode levar alguns dias).
   Precisa também de um Apple ID com autenticação de dois fatores e de quem tenha poder legal de assinar pela empresa.
2. **Mac: não precisa.** A compilação roda num Mac do GitHub (Xcode 26, exigido pela Apple desde abril de 2026).
   Precisa, sim, de uma **chave de API do App Store Connect** (Usuários e acesso › Integrações › Chave de API da
   equipe, papel **Admin**): o arquivo `AuthKey_XXXX.p8` (baixa uma vez só) + Key ID + Issuer ID. Guardar em
   `D:\KMCheck-chaves\ios\`.
3. **Um iPhone** para testar pelo TestFlight antes de mandar para revisão.
4. **Aceitar os contratos** no App Store Connect (app gratuito: só o "Free Apps Agreement", sem dados bancários).
5. **Atualizar a política de privacidade** (`https://kmcheck.com.br/privacidade/`) — ver seção 3.3.
6. **Capturas de tela de iPhone** — as da Google Play (`mobile/loja/tela-*.png`) têm moldura e barra de status
   de Android e **não podem** ser usadas (ver seção 6).
7. Dar o OK para a versão (`VERSAO_APP` no `sw.js`, hoje `1.0.0`) — é a mesma das duas lojas.

---

## 2. Mudanças no `index.html` (fazer ANTES de gerar o app do iPhone)

O `index.html` já funciona dentro do Capacitor no iPhone: `window.Capacitor.isNativePlatform()` é `true`
e `nativePromise` existe nas duas plataformas, então `NATIVO` liga sozinho. O problema é que tudo o que está
atrás de `NATIVO` foi escrito pensando no Android (textos de "Configurações → Apps", vibração, plataforma no
painel) e há a coleta de "impressão digital" do aparelho, que a Apple proíbe. Correções, trecho atual → novo
(lembrar de subir o `CACHE` do `sw.js`):

### 2.1 Saber em que sistema está (perto da linha 1935)

Atual:
```js
const NATIVO=(()=>{ try{ const C=window.Capacitor;
  if(C && C.isNativePlatform && C.isNativePlatform() && C.nativePromise) return { chama:(m,o)=>C.nativePromise('KMCheckNativo', m, o||{}) };
}catch(e){} return null })();
```
Novo:
```js
const NATIVO=(()=>{ try{ const C=window.Capacitor;
  if(C && C.isNativePlatform && C.isNativePlatform() && C.nativePromise){
    /* 'android' ou 'ios': os textos de ajuda (onde liberar permissão) e algumas peças mudam de um para o outro */
    const so=(C.getPlatform && C.getPlatform())||'android';
    return { so, ios:so==='ios', android:so!=='ios', chama:(m,o)=>C.nativePromise('KMCheckNativo', m, o||{}) };
  }
}catch(e){} return null })();
```
E no comentário logo acima (linha ~1924), trocar "Dentro do app Android (Capacitor)" por
"Dentro do app da loja (Android ou iPhone, Capacitor)".

### 2.2 Diálogo "GPS negado" (`showGpsDeniedDialog`, linha ~3717)

Hoje, no app do iPhone, cai no ramo `_isIOS` e manda ir em "Serviços de Localização → **Safari**" (errado no app).
Atual:
```js
  if(_isIOS){
    msg.innerHTML='O KM Check precisa do GPS para gravar coordenadas.<br><br>'+
```
Novo (acrescenta um ramo ANTES do `_isIOS`):
```js
  if(NATIVO && NATIVO.ios){
    /* app da loja no iPhone: a permissão fica na página do próprio app nos Ajustes (iOS 18+: Ajustes → Apps → KM Check) */
    msg.innerHTML='O KM Check precisa do GPS para gravar coordenadas.<br><br>'+
      '<b>No iPhone:</b> abra <b>Ajustes → Apps → KM Check → Localização</b>, escolha "Durante o Uso do App" e ligue <b>Localização Exata</b>.';
  } else if(_isIOS){
    msg.innerHTML='O KM Check precisa do GPS para gravar coordenadas.<br><br>'+
```
(Opcional, melhor ainda: no iPhone o botão "Tentar de novo" pode chamar `NATIVO.chama('abrirAjustesLocalizacao')`,
que abre direto a página do KM Check nos Ajustes.)

### 2.3 Toque no aviso vermelho "GPS desligado" (linha ~3756)

No iPhone um app **não pode** abrir a tela geral de "Serviços de Localização" (o atalho `App-Prefs:` é API privada
e dá rejeição); `abrirAjustesLocalizacao` abre a página do KM Check nos Ajustes. Atual:
```js
  if(NATIVO && !S.gpsDenied){ try{ const r=await NATIVO.chama('localizacao'); if(r && r.ligada===false){ toast('A localização do celular está desligada.\nLigue e volte para o app.', 5000); NATIVO.chama('abrirAjustesLocalizacao').catch(()=>{}); return } }catch(e){} }
```
Novo:
```js
  if(NATIVO && !S.gpsDenied){ try{ const r=await NATIVO.chama('localizacao');
    if(r && r.ligada===false){
      /* iPhone: só dá para ensinar o caminho (o iOS não deixa abrir os Serviços de Localização direto) */
      if(NATIVO.ios){ toast('A localização do iPhone está desligada.\nAjustes → Privacidade e Segurança → Serviços de Localização.', 6000); return }
      toast('A localização do celular está desligada.\nLigue e volte para o app.', 5000); NATIVO.chama('abrirAjustesLocalizacao').catch(()=>{}); return }
    if(NATIVO.ios && r && r.permissao==='negada'){ S.gpsDenied=true; showGpsDeniedDialog(); return }
  }catch(e){} }
```

### 2.4 Câmera sem permissão (linha ~5009)

Atual:
```js
    if(NATIVO && e && /NotAllowed|Security|Permission/i.test(e.name||'')) toast('Câmera sem permissão.\nConfigurações → Apps → KM Check → Permissões → Câmera.', 6000);
```
Novo:
```js
    if(NATIVO && e && /NotAllowed|Security|Permission/i.test(e.name||'')) toast(NATIVO.ios
      ? 'Câmera sem permissão.\nAjustes → Apps → KM Check → Câmera.'
      : 'Câmera sem permissão.\nConfigurações → Apps → KM Check → Permissões → Câmera.', 6000);
```

### 2.5 Localização aproximada na hora da foto (linha ~5155)

Atual:
```js
    toast(NATIVO && S.pos.acc>1000
      ? `⚠ Localização aproximada (±${Math.round(S.pos.acc)} m).\nConfigurações → Apps → KM Check → Permissões → Localização → ligue "Usar local exato".`
```
Novo:
```js
    toast(NATIVO && S.pos.acc>1000
      ? (NATIVO.ios
        ? `⚠ Localização aproximada (±${Math.round(S.pos.acc)} m).\nAjustes → Apps → KM Check → Localização → ligue "Localização Exata".`
        : `⚠ Localização aproximada (±${Math.round(S.pos.acc)} m).\nConfigurações → Apps → KM Check → Permissões → Localização → ligue "Usar local exato".`)
```

### 2.6 Vibração do obturador (linha ~5177)

O iPhone não tem `navigator.vibrate`; no app da loja dá para usar o motor de vibração (Taptic) pelo plugin. Atual:
```js
  if(navigator.vibrate) try{ navigator.vibrate([40,25,40]) }catch(e){}
```
Novo:
```js
  if(navigator.vibrate) try{ navigator.vibrate([40,25,40]) }catch(e){}
  else if(NATIVO && NATIVO.ios) NATIVO.chama('vibrar',{forte:true}).catch(()=>{});   // app do iPhone: batida do Taptic
```

### 2.7 Sem "impressão digital" do aparelho no app do iPhone (linhas ~4975 e ~6536) — IMPORTANTE

A Apple proíbe, **mesmo com autorização e mesmo sem rastreamento**, "usar sinais do aparelho para tentar
identificá-lo" (fingerprinting). O ping hoje mede benchmark de CPU num worker, renderizador e nº de extensões
WebGL, taxa de quadros (ProMotion) e os nomes das câmeras para adivinhar o modelo do iPhone. No app da loja o
modelo vem pronto do sistema (`infoAparelho` → `"iPhone16,1"`), então tudo isso pode ser pulado.

(a) Nomes das câmeras (linha ~4975). Atual:
```js
    /* ── Enumera câmeras para fingerprint de modelo ── */
    try{
```
Novo:
```js
    /* ── Enumera câmeras para fingerprint de modelo ── (não no app do iPhone: lá o modelo vem do sistema e a
       Apple proíbe juntar sinais do aparelho para identificá-lo) */
    if(!(NATIVO && NATIVO.ios)) try{
```

(b) Medições (linha ~6536). Logo DEPOIS desta linha:
```js
      try{ const j=JSON.parse(localStorage.getItem('kc-hw')||'null'); if(j && j.v===m[1]) _hwCache=j }catch(e){}
```
acrescentar:
```js
      /* app do iPhone: nada de benchmark/WebGL/ProMotion — um "cache" vazio faz todos os blocos `if(!_hwCache)` pularem */
      if(NATIVO && NATIVO.ios) _hwCache={v:m[1], proMotion:null, gpu:'', bench:null, glExts:0};
```

(c) Modelo e sistema vindos do iOS. Logo ANTES de:
```js
        /* GPS — usa a posição já fixada pelo watchPosition */
        let loc=null;
```
acrescentar:
```js
        /* app do iPhone: modelo exato do sistema ("iPhone16,1") e versão do iOS — o painel traduz o código para o nome */
        if(NATIVO && NATIVO.ios){ try{ const r=await NATIVO.chama('infoAparelho'); if(r){ if(r.modelo) model=r.modelo; if(r.sistema) osVer=r.sistema } }catch(e){} }
```
(O painel `admin/` precisa de uma tabela "iPhone16,1 → iPhone 15 Pro" para mostrar o nome amigável.)

Recomendação extra: avaliar desligar o benchmark/WebGL também no site e no Android. A Google Play não proíbe
do mesmo jeito, mas a política de privacidade e o princípio de minimização (LGPD) ficam mais simples.

### 2.8 Plataforma no painel (linha ~6559)

Atual:
```js
        const plat=NATIVO?'Android (app)':(/iPhone|iPad/.test(ua)?'iOS':(/Android/.test(ua)?'Android':(/Win/.test(ua)?'Windows':(/Mac/.test(ua)?'Mac':'Outro'))));
```
Novo:
```js
        const plat=NATIVO?(NATIVO.ios?'iOS (app)':'Android (app)'):(/iPhone|iPad/.test(ua)?'iOS':(/Android/.test(ua)?'Android':(/Win/.test(ua)?'Windows':(/Mac/.test(ua)?'Mac':'Outro'))));
```
E o comentário da linha ~6553 ("app da loja (Android): identificação que sobrevive a desinstalar…") vale
só para o Android: no iPhone o código vem do `identifierForVendor`, que muda se a pessoa apagar o app (e todos os
outros do mesmo desenvolvedor) e instalar de novo.

### 2.9 "Compartilhar" cancelado na galeria (linha ~5719, opcional)

No iPhone o `compartilhar` só responde quando a folha fecha, com `{concluido:true|false}`. Hoje a foto é marcada
como "compartilhada" mesmo se a pessoa cancelar. Atual:
```js
        catch(e){ await NATIVO.chama('compartilhar',{nome:m.name, mime:'image/jpeg', base64:b64, titulo:'Salvar ou enviar a foto'}); ok='share' }
```
Novo:
```js
        catch(e){ const r=await NATIVO.chama('compartilhar',{nome:m.name, mime:'image/jpeg', base64:b64, titulo:'Salvar ou enviar a foto'});
          ok = r && r.concluido===false ? false : 'share' }   // iPhone: cancelou = a foto continua "só no app"
```
(No Android `r` vem vazio e o comportamento não muda.)

### 2.10 O que NÃO precisa mudar (conferido)
- `DADOS = 'https://kmcheck.com.br/'`, service worker desligado (`!NATIVO`), prompt de instalação (`|| NATIVO`):
  valem igual no iPhone. O app não baixa código: só JSON de rodovias (Diretriz 2.5.2 ok).
- `SystemBars.setStyle('LIGHT'|'DARK')`: existe no Capacitor 8.5.3 do iOS e funciona igual.
- Câmera (`getUserMedia`) e sensor de inclinação: o Capacitor 8.5.3 do iOS já concede as permissões do WebView
  (`requestMediaCapturePermissionFor` e `requestDeviceOrientationAndMotionPermissionFor` → `.grant`); o pedido que
  aparece é o do sistema, com o texto do `NSCameraUsageDescription`.
- Tirar o `accept` do `#filein`: também é bom no iPhone (o seletor de Arquivos apaga tipos que não conhece, como .shp/.dbf).
- Origem das chamadas no iPhone: `capacitor://localhost`. O `server/api/server.mjs` já aceita essa origem
  (`ORIGENS_KMCHECK`). **Conferir** se `https://kmcheck.com.br/data/rodovias/*.json` responde com
  `Access-Control-Allow-Origin` que cubra `capacitor://localhost` (ex.: `*`) — sem isso o download de rodovias falha
  no iPhone e a revisão vê erro.

---

## 3. Antes de gerar o app — feito
`capacitor.config.json` com o bloco `ios`, `@capacitor/ios@8.5.3` instalado, script `npm run sync:ios`, e a
política de privacidade atualizada.

---

## 4. Passo a passo (sem Mac)

### 4.1 Uma vez: assinatura
1. No App Store Connect (com o seu Apple ID convidado como **Administrador** pela conta da A1/André, com acesso a
   *Certificados, Identificadores e Perfis*), crie a **chave de API** (seção 1, item 2).
2. Em `mobile/`: `node ios-assinatura.mjs --key-id XXXXXXXXXX --issuer-id xxxxxxxx-... --github`
   Registra `br.com.kmcheck.app`, cria o certificado **Apple Distribution** e o perfil **KM Check App Store**,
   guarda tudo em `D:\KMCheck-chaves\ios\` e grava os segredos no GitHub (IOS_P12_BASE64, IOS_P12_SENHA,
   IOS_PERFIL_BASE64, IOS_TEAM_ID, ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8). Faça cópia de segurança da pasta.
3. **App Store Connect** › Apps › **+** › Novo app: iOS; Nome `KM Check` (se estiver em uso: `KM Check Rodovias`);
   Idioma principal Português (Brasil); Bundle ID `br.com.kmcheck.app`; SKU `kmcheck-ios`; Acesso total.

### 4.2 Gerar e enviar ao TestFlight
GitHub › Actions › **iOS → TestFlight** › *Run workflow* (ou `gh workflow run ios-testflight.yml`).
Leva ~10–20 min: compila com o Xcode 26, assina e envia. Em 5–30 min o build aparece no **TestFlight**.
Versão = `VERSAO_APP` do `sw.js`; Build = número do cache (`kmcheck-v330` → 330), igual ao Android.
Sem os segredos (ou desmarcando "enviar") ele só **compila sem assinar** — serve para conferir o projeto.

### 4.3 Atualizações futuras
Mudou o app (e subiu o cache do `sw.js`)? Rode o workflow de novo. Os arquivos de `mobile/ios` não precisam
ser mexidos (o `cap sync ios` do workflow copia o `index.html` novo para dentro).

---

## 5. Ficha da App Store (Português do Brasil)

| Campo | Limite | Texto |
|---|---|---|
| **Nome** | 30 | `KM Check` (alternativa com busca melhor: `KM Check: Foto de Rodovia` — 25) |
| **Subtítulo** | 30 | `Foto com KM, estaca e GPS` (25) |
| **Palavras-chave** | 100 | `rodovia,estrada,quilometro,dnit,snv,coordenadas,legenda,fiscalização,obra,engenharia,oae,laudo,br` (97) |
| **Texto promocional** | 170 | `Legenda gravada na foto com rodovia, KM, estaca, coordenadas, data e hora. Funciona offline depois de baixar a rodovia.` (119) |
| **URL de suporte** | — | `https://kmcheck.com.br` (precisa mostrar um contato: suporte@kmcheck.com.br) |
| **URL de marketing** | — | `https://kmcheck.com.br` |
| **URL da política de privacidade** | — | `https://kmcheck.com.br/privacidade/` |
| **Categoria** | — | Principal: **Utilitários** · Secundária: **Produtividade** |
| **Copyright** | — | `2026 A1 ENGENHARIA LTDA` |
| **Preço / disponibilidade** | — | Grátis · **Brasil** · desmarcar "disponível em Mac com Apple Silicon" e "Apple Vision Pro" |
| **Classificação etária** | — | Responder **Não/Nenhum** a tudo (sem conteúdo gerado por usuários, sem chat, sem navegador da web livre, sem compras) → **4+** |

Palavras do nome e do subtítulo já contam para a busca; por isso "km", "foto", "estaca" e "gps" não se repetem nas palavras-chave.

**Descrição** (até 4.000 caracteres; igual à da Google Play, sem citar outra plataforma):
> O KM Check é a ferramenta de registro fotográfico para quem trabalha em rodovias.
>
> Cada foto sai com a legenda gravada na própria imagem: rodovia e UF, KM com metros, lado da pista, estaca, contrato, serviço, coordenadas, data e hora. Sem anotar nada e sem depender de internet no campo.
>
> COMO FUNCIONA
> • Baixe a rodovia uma vez, com internet. Depois o app funciona offline.
> • O GPS mostra em que rodovia e em que KM você está, com a estaca do ponto.
> • Tire a foto. A legenda vai gravada na imagem e a foto vai para o app Fotos do iPhone.
>
> RECURSOS
> • Rodovias federais com o traçado oficial do SNV/DNIT, inclusive versões anteriores do SNV.
> • Rodovias estaduais e municipais: importe KMZ, KML, GPX, Shapefile ou planilha (inclusive UTM).
> • Estaca automática ou com zero próprio por lote.
> • Contratos vinculados ao trecho: entram sozinhos na legenda quando você chega nele.
> • Modo Carro: painel grande com o KM, para acompanhar a viagem com o celular no suporte, que escurece à noite.
> • Consulta: converta uma lista de coordenadas em KM, ou um KM em coordenada.
> • Legenda e logo configuráveis: posição, tamanho, cor, fundo e o que aparece.
> • Nome do arquivo com rodovia, KM, lado, data e hora.
>
> Suas fotos ficam no seu iPhone. O app não envia fotos para nenhum servidor.

(O "Modo Carro" foi reescrito de propósito: "acompanhar o KM dirigindo" pode ser lido pela revisão como
incentivo a mexer no celular ao volante — Diretriz 1.4.)

**Novidades desta versão** (1.0.0): `Primeira versão para iPhone.`

---

## 6. Capturas de tela e prévia

- Obrigatório: **iPhone 6,9"** — 1320×2868 ou 1290×2796 (retrato), de 1 a 10 imagens. Com elas a Apple reaproveita
  para os tamanhos menores. iPad não é necessário (app só para iPhone).
- **Prontas:** `mobile/loja/ios/tela-1..6.png` (1290×2796, moldura de iPhone com Dynamic Island), geradas por
  `node mobile/loja/gerar-loja-ios.mjs` a partir de `manual-kmcheck/prints-ios` (`KC_IOS=1 node manual-kmcheck/estudio/capturar.mjs
  camera galeria inicio carro consulta importar`). **Não usar** `mobile/loja/tela-*.png` (são de Android).
- As mesmas 6 telas da Play funcionam bem: início com KM, câmera com legenda, Modo Carro, importar, galeria, consulta.
- Ícone da loja: vem do próprio build (`AppIcon-1024.png`); não se envia à parte.

---

## 7. Privacidade do app (App Store Connect › Privacidade do app)

Tem que bater com o `PrivacyInfo.xcprivacy` e com a política. Os dados só saem depois do "Permitir" da janela
"Ajude a melhorar o app"; mesmo opcional, a Apple exige declarar.

- **Você ou seus parceiros coletam dados deste app?** Sim.
- Tipos (para **cada um**: Finalidade = **Análise**; Vinculado à identidade = **Sim**; Usado para rastreamento = **Não**):

| Categoria › Tipo | O que é no KM Check |
|---|---|
| **Localização › Localização aproximada** | grade de 0,02° (~2 km). Para a Apple, "precisa" é 3 casas decimais ou mais, então aqui é **aproximada** (na Google ficou "exata" por outra regra) |
| **Identificadores › ID do dispositivo** | código do aparelho: SHA-256 do identifierForVendor (`ios-…`) |
| **Dados de uso › Interação com o produto** | lista de rodovias baixadas |
| **Diagnóstico › Dados de desempenho** | desempenho do aparelho (no app do iPhone, depois da correção 2.7, sobra só o tamanho da tela/nº de núcleos) |
| **Diagnóstico › Outros dados de diagnóstico** | modelo, versão do iOS e do app |

- **Não marcar:** Fotos ou vídeos (ficam no aparelho), Localização precisa, Contato, Identificadores de anúncio.
- "Vinculado = Sim" porque tudo vai junto com o código do aparelho, e é por ele que a pessoa pede a exclusão.
- **App Tracking Transparency: não é necessário.** O app não usa o IDFA (sem AdSupport), não cruza dados com
  outras empresas, não tem anúncios nem SDK de terceiros. Não colocar `NSUserTrackingUsageDescription` (texto
  de rastreamento sem rastreamento também é motivo de recusa).

---

## 8. Informações para a revisão (App Store Connect › Informações para revisão do app)

- **Login:** não precisa (desmarcar "É necessário fazer login").
- **Contato:** nome, telefone e e-mail de quem responde à Apple.
- **Anexo:** um vídeo curto (1–2 min) gravado na rodovia mostrando o KM mudando e a foto com a legenda ajuda MUITO,
  porque o revisor está fora do Brasil e não vai ver o KM do GPS funcionando.
- **Notas** (em inglês; preencher a coordenada de teste conferindo no próprio app antes):

```
KM Check is a field tool for highway engineers and inspectors in Brazil. Each photo gets a caption burned into
the image: highway, kilometer marker (interpolated from the official DNIT/SNV road network), stake, GPS
coordinates, date and time. It works offline after a highway is downloaded.

No login is required. The "Help improve the app" dialog on first launch is optional (opt-in analytics);
choose either option.

Because the reviewer is outside Brazil, the live kilometer on the home screen will show that you are away
from any highway. To see the core features without being on a Brazilian highway:
1. Home > download a highway (e.g. "BR-040-DF") - requires internet once.
2. "Consulta" (search button at the top of the home screen): paste the coordinate <-15.XXXXX, -47.XXXXX> to get its highway and KM,
   or type a KM to get its coordinate.
3. Camera button (bottom center): take a photo. The caption is drawn on the image and the photo is saved to the
   Photos app (only "Add Photos" permission is requested). The attached video shows the app on a real highway.

Native features (not a website wrapper): all app files are bundled and the app runs fully offline; photos are
saved through PhotoKit; native GPS through Core Location; native share sheet; keeps the screen awake while in use (car mode); native haptics on
the shutter; location-services status check and deep link to the app's Settings page; exports saved to the
Files app. Highway geometry is stored locally (IndexedDB) and interpolated on device.
```

---

## 9. Roteiro de teste no iPhone (TestFlight) antes de enviar

1. 1ª abertura: pedido de localização com o texto em português → "Ajude a melhorar o app" → boas-vindas.
2. Baixar uma rodovia (confere o CORS do `kmcheck.com.br` para `capacitor://localhost`).
3. Abrir a câmera: pedido de câmera em português; **deve aparecer UM só pedido de localização** (o do iOS). O GPS
   do app do iPhone já vem do plugin nativo (gpsVigiar), justamente para não aparecer o segundo aviso
   "“localhost” deseja usar a sua localização" do WKWebView.
4. Tirar foto com "Envio automático" ligado: 1º pedido "Adicionar Fotos" → a foto aparece no Fotos, com o nome
   original no "Informações". Negar a permissão e tirar outra: deve aparecer o aviso "A foto não foi salva…".
5. Galeria do app › Compartilhar: folha do iOS abre; cancelar não dá erro.
6. Excluir foto: o `confirm()` mostra **Cancelar / Confirmar** (não "Cancel / Ok").
7. Modo Carro parado por 2+ minutos: a tela não apaga. Mandar o app para o fundo e voltar: continua sem apagar.
8. Desligar Serviços de Localização e tocar no aviso vermelho da câmera: aparece a instrução do iPhone (correção 2.3).
9. Girar o iPhone com a câmera aberta: a página fica em retrato e a legenda gira pela inclinação.
10. Ajustes do próprio app › "Código do aparelho": começa com `ios-` (depois de "Permitir").
11. iPhone com Dynamic Island e iPhone SE: nada escondido atrás do entalhe ou da barra de início.

---

## 10. Riscos de rejeição (do mais para o menos grave)

**Alta**
- **2.1 (app não funciona para o revisor)** — fora do Brasil o KM ao vivo não aparece. Mitigar com as notas da seção 8,
  coordenada de teste conferida e vídeo anexado.
- **5.1.2 / política de "fingerprinting"** — benchmark de CPU + WebGL + ProMotion + nomes das câmeras para identificar o
  aparelho. Proibido pela Apple mesmo com consentimento. Aplicar a correção 2.7 (e declarar o resto no manifesto).
- **2.3.3 capturas de Android** — certeza de recusa se reaproveitar as da Play. Fazer capturas de iPhone.

**Média**
- **4.2 (funcionalidade mínima / site embrulhado)** — a interface é toda web. A favor: tudo vem dentro do app e funciona
  offline (sem service worker, sem carregar o site), GPS + câmera + legenda gravada, Fototeca nativa, Compartilhar
  nativo, tela acesa, vibração, Ajustes, Arquivos, manual embutido, importação de KMZ/Shapefile e processamento local
  das rodovias. Falta (se a revisão insistir): câmera e GPS nativos (hoje são do WebView), álbum próprio, atalhos
  de tela inicial/widget com o KM, Live Activity do Modo Carro. Deixar explícito nas notas (seção 8).
- **CORS de `kmcheck.com.br` para `capacitor://localhost`** — se o download de rodovias falhar, vira recusa por 2.1.
- **Política de privacidade sem o iPhone** — atualizar (seção 3.3) antes do envio.
- **1.4 (segurança ao volante)** — texto do Modo Carro reescrito (seção 5); evitar prints com o carro em movimento.
- **Duplo pedido de localização do WKWebView** — não costuma recusar, mas é feio; testar (seção 9, item 3).

**Baixa**
- **5.1.1(ii) textos de permissão** — já específicos e em pt-BR no `Info.plist`.
- **ATT** — não se aplica; não incluir AdSupport nem o texto de rastreamento.
- **Conformidade de exportação** — `ITSAppUsesNonExemptEncryption = false` (só HTTPS do sistema).
- **Ícone** — sem transparência (ok); provisório ampliado de 512 px — trocar pela arte em 1024 px.
- **2.5.2 (código baixado)** — nunca usar `server.url` no `capacitor.config.json` apontando para o site; o app tem de
  carregar o `index.html` de dentro do pacote.
- **5.1.1(v) exclusão de conta** — não se aplica (não há conta).
- **iPad** — app só para iPhone; com `UIRequiresFullScreen` e a âncora do Compartilhar, roda sem fechar no modo de
  compatibilidade se o revisor usar um iPad.
