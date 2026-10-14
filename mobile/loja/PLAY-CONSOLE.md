# KM Check na Google Play — o que preencher

Conta: **A1 ENGENHARIA LTDA** (empresa). App: **br.com.kmcheck.app**.
Arquivo para enviar: `mobile/android/app/build/outputs/bundle/release/app-release.aab`
(gerado com `npm run sync` em `mobile/` e depois `gradlew bundleRelease` em `mobile/android/`).

## 1. Criar o app
- Nome do app: **KM Check**
- Idioma padrão: Português (Brasil)
- App ou jogo: **App** · Gratuito ou pago: **Gratuito**

## 2. Página da loja (Presença na loja › Página principal)
**Nome:** KM Check

**Descrição curta** (até 80 caracteres):
> Foto de rodovia com KM, estaca e coordenadas gravados na imagem.

**Descrição completa:**
> O KM Check é a ferramenta de registro fotográfico para quem trabalha em rodovias.
>
> Cada foto sai com a legenda gravada na própria imagem: rodovia e UF, KM com metros, lado da pista, estaca, contrato, serviço, coordenadas, data e hora. Sem anotar nada e sem depender de internet no campo.
>
> COMO FUNCIONA
> • Baixe a rodovia uma vez, com internet. Depois o app funciona offline.
> • O GPS mostra em que rodovia e em que KM você está, com a estaca do ponto.
> • Tire a foto. A legenda vai gravada na imagem e a foto vai para a galeria do celular.
>
> RECURSOS
> • Rodovias federais com o traçado do SNV (Sistema Nacional de Viação), base pública do DNIT, inclusive versões anteriores.
> • Rodovias estaduais e municipais: importe KMZ, KML, GPX, Shapefile ou planilha (inclusive UTM).
> • Estaca automática ou com zero próprio por lote.
> • Contratos vinculados ao trecho: entram sozinhos na legenda quando você chega nele.
> • Modo Carro: painel grande para acompanhar o KM dirigindo, que escurece à noite.
> • Consulta: converta uma lista de coordenadas em KM, ou um KM em coordenada.
> • Legenda e logo configuráveis: posição, tamanho, cor, fundo e o que aparece.
> • Nome do arquivo com rodovia, KM, lado, data e hora.
>
> Suas fotos ficam no seu celular. O app não envia fotos para nenhum servidor.
>
> AVISO: o KM Check não é um aplicativo do governo e não tem vínculo com o DNIT nem com outro órgão público. Os traçados das rodovias federais vêm dos dados abertos do SNV publicados pelo DNIT: https://www.gov.br/dnit/pt-br/assuntos/atlas-e-mapas/pnv-e-snv

<!-- Por que o AVISO: a política de Declarações enganosas da Google Play exige, para apps que usam informação de
     órgão público sem ser do governo, a fonte (com link) e a frase de que não há vínculo, NA DESCRIÇÃO. Sem isso a
     revisão costuma recusar ("Government affiliation"). Antes de enviar, abra o link e confirme que a página existe;
     se o gov.br tiver mudado o endereço, use o da página do SNV/PNV do DNIT. Não use "oficial" no texto da loja.
     Limites conferidos: título 8/30, curta 64/80, completa ~1.500/4.000 caracteres. -->

**Gráficos** (pasta `mobile/loja/`):
- Ícone: `icone-512.png`
- Recurso gráfico (destaque): `destaque-1024x500.png`
- Capturas de tela do telefone: `tela-1.png` a `tela-6.png`

**Categoria:** Ferramentas (alternativa: Produtividade)
**E-mail de contato:** suporte@kmcheck.com.br
**Site:** https://kmcheck.com.br

## 3. Conteúdo do app (Política › Conteúdo do app)
- **Política de privacidade:** https://kmcheck.com.br/privacidade/
- **Anúncios:** Não contém anúncios.
- **Acesso ao app:** Todas as funcionalidades estão disponíveis sem acesso especial (não tem login).
- **Classificação do conteúdo:** questionário IARC → categoria "Utilitário, produtividade, comunicação ou outro"; responder **Não** para violência, sexo, linguagem, drogas, jogos de azar, interação entre usuários e compartilhamento de localização com outros usuários. Resultado esperado: Livre.
- **Público-alvo:** 18 anos ou mais (é ferramenta de trabalho). Não é voltado a crianças.
- **App de notícias:** Não. **App de saúde:** Não. **Governo:** Não (o app não é de órgão público; ver o AVISO na descrição). **Recursos financeiros:** Nenhum.
- **ID de publicidade:** **Não** usa (o app não tem anúncios nem SDK do Google Play Services; o AAB não declara `AD_ID`).
- **Apps de VPN, acessibilidade, alarmes exatos, serviço em primeiro plano, fotos e vídeos (READ_MEDIA_*):** não se aplicam — o app não declara nenhuma dessas permissões.
- **Segurança dos dados** (formulário):
  - Coleta ou compartilha algum dado? **Sim** (somente se o usuário permitir o envio de dados de uso).
  - Os dados são criptografados em trânsito? **Sim** (HTTPS).
  - O usuário pode pedir a exclusão? **Sim** (por e-mail, ver a política).
  - Tipos coletados:
    - **Localização aproximada** — coletada, não compartilhada, **opcional**, finalidade: Análise.
      Desde a v323 o app manda só a região, arredondada para uma grade de 0,02° (~2,2 km × ~2 km ≈ 4–5 km²
      em todo o Brasil). A Google chama de "aproximada" a localização com área de 3 km² ou mais, então
      **não marcar "Localização exata"**. (Se um dia voltar a mandar 2 casas decimais, passa a ser "exata".)
      O GPS em si é usado no aparelho para calcular o KM; isso não conta como coleta (não sai do celular).
    - **Identificadores do dispositivo ou outros IDs** (código do aparelho = SHA-256 do ANDROID_ID; não muda ao reinstalar; só estatística, sem anúncios) — coletado, não compartilhado, opcional, finalidade: Análise.
    - **Informações e desempenho do app › Diagnóstico** (marca/modelo, versão do Android e do app, tela, user agent, dados de hardware e desempenho) — coletado, não compartilhado, opcional, finalidade: Análise.
    - **Atividade no app › Outras ações no app** (lista de rodovias baixadas) — coletado, não compartilhado, opcional, finalidade: Análise.
  - "Os dados são processados de forma temporária?" **Não** (ficam no servidor).
  - Exclusão de dados: o app não tem conta/login, então a Google **não exige** link de exclusão de conta;
    basta responder que o usuário pode pedir a exclusão (e-mail da política).
  - Fornecedores que só hospedam (Contabo, GitHub Pages) não contam como "compartilhamento" (são prestadores de serviço).
  - **Fotos:** NÃO marcar como coletadas (ficam só no celular; o app não envia).
  - A janela "Ajude a melhorar o app" (1ª abertura) lista esses dados antes do "Permitir", como a Google exige.
    O código do aparelho aparece na janela "Sobre o KM Check" (toque em VERSÃO ⓘ no topo), para pedidos de exclusão.
- **Permissões sensíveis:** o app não usa localização em segundo plano, nem acesso a todos os arquivos, nem SMS/chamadas. Não há formulário extra a preencher.

## 4. Assinatura
- Ativar **Assinatura de apps do Google Play** (padrão para apps novos). O Google guarda a chave que assina para os usuários.
- A chave de **upload** (envio) é a de `D:\KMCheck-chaves\kmcheck-upload.jks`. Faça cópia de segurança dessa pasta.

## 5. Envio
1. Testes › **Teste interno** › Criar versão › enviar o `app-release.aab` › adicionar seu e-mail como testador › Iniciar o lançamento.
2. Abrir o link de teste no celular Android, instalar pela Play e testar (GPS, foto indo para a galeria, Modo Carro, baixar rodovia).
3. Com tudo certo: **Produção** › Criar versão › usar o mesmo pacote › países: Brasil › Enviar para revisão.
   Conta de empresa (organização, verificada com D-U-N-S): não precisa do teste fechado de 12 testadores por 14 dias.
   **Confira em Play Console › Configurações › Detalhes da conta que o tipo é "Organização".** Se a conta tiver sido
   criada como **pessoal**, a Produção só libera depois de um **teste fechado com pelo menos 12 testadores que
   continuem inscritos por 14 dias seguidos**, e depois de responder o questionário de acesso à produção.
   Antes da Produção, leia o **Relatório de pré-lançamento** (aparece sozinho no teste interno/fechado): falhas,
   acessibilidade e avisos de tela grande/orientação.
4. A revisão do Google costuma levar de algumas horas a alguns dias.

## 6. Atualizações futuras
O versionCode do app Android acompanha o cache do app web (ex.: kmcheck-v323 → versionCode 323) e o
versionName é o `VERSAO_APP` do `sw.js` (o que aparece na loja). O versionCode tem que ser sempre maior que o
último enviado; se o `mobile/www` não existir (sem `npm run sync`), o build sai com versionCode 1 e a Play recusa.
Requisito de API: desde 31/08/2026 apps novos e atualizações precisam de targetSdk 36 (o projeto já usa 36).
Para publicar uma atualização:
`cd mobile` › `npm run sync` › `cd android` › `gradlew bundleRelease` › enviar o novo `app-release.aab`.
