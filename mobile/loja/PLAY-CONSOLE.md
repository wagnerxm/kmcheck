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
> • Rodovias federais com o traçado oficial do SNV/DNIT, inclusive versões anteriores do SNV.
> • Rodovias estaduais e municipais: importe KMZ, KML, GPX, Shapefile ou planilha (inclusive UTM).
> • Estaca automática ou com zero próprio por lote.
> • Contratos vinculados ao trecho: entram sozinhos na legenda quando você chega nele.
> • Modo Carro: painel grande para acompanhar o KM dirigindo, que escurece à noite.
> • Consulta: converta uma lista de coordenadas em KM, ou um KM em coordenada.
> • Legenda e logo configuráveis: posição, tamanho, cor, fundo e o que aparece.
> • Nome do arquivo com rodovia, KM, lado, data e hora.
>
> Suas fotos ficam no seu celular. O app não envia fotos para nenhum servidor.

**Gráficos** (pasta `mobile/loja/`):
- Ícone: `icone-512.png`
- Recurso gráfico (destaque): `destaque-1024x500.png`
- Capturas de tela do telefone: `tela-1.png` a `tela-6.png`

**Categoria:** Ferramentas (alternativa: Produtividade)
**E-mail de contato:** wagnerxm.eng@hotmail.com
**Site:** https://kmcheck.com.br

## 3. Conteúdo do app (Política › Conteúdo do app)
- **Política de privacidade:** https://kmcheck.com.br/privacidade/
- **Anúncios:** Não contém anúncios.
- **Acesso ao app:** Todas as funcionalidades estão disponíveis sem acesso especial (não tem login).
- **Classificação do conteúdo:** questionário IARC → categoria "Utilitário, produtividade, comunicação ou outro"; responder **Não** para violência, sexo, linguagem, drogas, jogos de azar, interação entre usuários e compartilhamento de localização com outros usuários. Resultado esperado: Livre.
- **Público-alvo:** 18 anos ou mais (é ferramenta de trabalho). Não é voltado a crianças.
- **App de notícias:** Não. **App de saúde:** Não. **Governo:** Não. **Recursos financeiros:** Nenhum.
- **Segurança dos dados** (formulário):
  - Coleta ou compartilha algum dado? **Sim** (somente se o usuário permitir o envio de dados de uso).
  - Os dados são criptografados em trânsito? **Sim** (HTTPS).
  - O usuário pode pedir a exclusão? **Sim** (por e-mail, ver a política).
  - Tipos coletados:
    - **Localização aproximada** — coletada, não compartilhada, **opcional**, finalidade: Análise.
    - **Identificadores do dispositivo ou outros IDs** (identificador aleatório criado pelo app) — coletado, não compartilhado, opcional, finalidade: Análise.
    - **Informações e desempenho do app › Diagnóstico** (modelo, versão, desempenho) — coletado, não compartilhado, opcional, finalidade: Análise.
  - **Fotos:** NÃO marcar como coletadas (ficam só no celular; o app não envia).
  - **Localização exata:** NÃO marcar como coletada (é usada só no celular; o envio é só a região aproximada, ~1 km).
- **Permissões sensíveis:** o app não usa localização em segundo plano, nem acesso a todos os arquivos, nem SMS/chamadas. Não há formulário extra a preencher.

## 4. Assinatura
- Ativar **Assinatura de apps do Google Play** (padrão para apps novos). O Google guarda a chave que assina para os usuários.
- A chave de **upload** (envio) é a de `D:\KMCheck-chaves\kmcheck-upload.jks`. Faça cópia de segurança dessa pasta.

## 5. Envio
1. Testes › **Teste interno** › Criar versão › enviar o `app-release.aab` › adicionar seu e-mail como testador › Iniciar o lançamento.
2. Abrir o link de teste no celular Android, instalar pela Play e testar (GPS, foto indo para a galeria, Modo Carro, baixar rodovia).
3. Com tudo certo: **Produção** › Criar versão › usar o mesmo pacote › países: Brasil › Enviar para revisão.
   Conta de empresa: não precisa do teste fechado de 12 testadores por 14 dias.
4. A revisão do Google costuma levar de algumas horas a alguns dias.

## 6. Atualizações futuras
A versão do app Android acompanha a do app web (ex.: v298 → versão 298). Para publicar uma atualização:
`cd mobile` › `npm run sync` › `cd android` › `gradlew bundleRelease` › enviar o novo `app-release.aab`.
