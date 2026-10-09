/* Textos do manual do KM Check. Regras de escrita do projeto: pt-BR direto, sem travessão,
 * uma ideia por frase. Cada "tela" aponta um print de manual-kmcheck/prints e, quando tem
 * marcadores, a lista "itens" segue a mesma numeração gravada em prints/marcas.json. */

export const VERSAO = '293';
export const DATA = 'outubro de 2026';

export const passosRapidos = [
  { t: 'Baixe a rodovia', d: 'Em Gestão de Eixo, escolha UF e BR e toque em Baixar rodovia. Precisa de internet só nesse momento.' },
  { t: 'Confira o KM', d: 'A tela inicial mostra a rodovia, o KM e a estaca do ponto onde você está, pelo GPS.' },
  { t: 'Prepare a foto', d: 'Toque em Registrar evidência. Marque o lado (LD ou LE) e, no botão i, o serviço e o contrato.' },
  { t: 'Tire a foto', d: 'Toque no obturador. A legenda com rodovia, KM, estaca, coordenadas e data é gravada na imagem.' },
  { t: 'Pronto', d: 'A foto vai para a galeria do celular e fica guardada também na galeria do app.' },
];

export const capitulos = [
  {
    id: 'instalacao', km: '01', titulo: 'Instalação',
    intro: 'O KM Check funciona direto do navegador, mas o ideal é instalá-lo na tela inicial. Instalado, ele abre em tela cheia, funciona sem internet e mantém suas configurações.',
    instalacao: true,
  },
  {
    id: 'inicio', km: '02', titulo: 'Tela inicial',
    intro: 'É o painel de campo. Assim que o GPS encontra sua posição, o app procura a rodovia mais próxima entre as que você baixou e mostra o KM exato.',
    telas: [{
      img: '01-inicio', itens: [
        ['Placa do KM', 'BR e quilômetro inteiro, no mesmo estilo das placas da rodovia.'],
        ['Rodovia e UF', 'A rodovia onde você está agora.'],
        ['KM exato', 'Quilômetro com metros, em três casas decimais. Fica vermelho quando você está longe do eixo.'],
        ['Estaca', 'Estaca do ponto, a cada 20 m. A rodovia pode ter um zero próprio por lote.'],
        ['Latitude e longitude', 'Coordenadas lidas do GPS do celular.'],
        ['Modo Carro', 'Abre a tela de painel para acompanhar o KM dirigindo.'],
        ['Consulta', 'Converte coordenadas em KM e KM em coordenadas.'],
        ['Configurações', 'Câmera, logo, legenda, aparência, serviços e contratos.'],
        ['Gestão de Eixo', 'Baixar, importar e gerenciar as rodovias do celular.'],
        ['Registrar evidência', 'Abre a câmera para tirar a foto com legenda.'],
      ],
    }],
    dica: 'O KM só aparece se a rodovia estiver baixada no celular. Sem rodovia por perto, a placa fica com tracinhos.',
  },
  {
    id: 'camera', km: '03', titulo: 'Registrar evidência',
    intro: 'A câmera mostra a legenda ao vivo, exatamente como ela será gravada na foto. Tudo o que você ajustar aqui aparece na legenda antes de tirar a foto.',
    telas: [{
      img: '10-camera', itens: [
        ['Voltar', 'Fecha a câmera e volta para a tela inicial.'],
        ['Sinal do GPS', 'Verde é sinal forte, amarelo é fraco e vermelho é sem sinal.'],
        ['Trocar câmera', 'Alterna entre a câmera traseira e a frontal.'],
        ['Legenda ao vivo', 'Rodovia, KM, lado, estaca, contrato, serviço, coordenadas e data.'],
        ['Proporção', 'Formato da foto: 1:1, 4:3 ou 16:9.'],
        ['Logo', 'Liga ou desliga a logo da empresa na foto.'],
        ['Lado da pista', 'LD (direito) ou LE (esquerdo). Toque de novo para tirar o lado.'],
        ['Serviço e contrato', 'Escolha o serviço executado e o contrato da foto.'],
        ['Obturador', 'Tira a foto.'],
        ['Configurações', 'Atalho direto para os ajustes.'],
        ['Flash', 'Liga o flash da câmera traseira, quando o aparelho permite.'],
        ['Galeria', 'Abre as fotos registradas no app.'],
      ],
    }, {
      img: '11-camera-servico-contrato', titulo: 'Serviço e contrato',
      texto: 'No botão i você escolhe o serviço e o contrato que vão na segunda linha da legenda. Dá para cadastrar novos aqui mesmo, sem sair da câmera. Contratos vinculados a uma rodovia entram sozinhos quando você chega no trecho.',
    }, {
      img: '12-camera-deitada', titulo: 'Celular deitado', deitado: true,
      texto: 'Gire o celular e a câmera acompanha. A legenda e os botões se reorganizam para a foto na horizontal.',
    }],
    dica: 'Sem GPS ou com o sinal muito impreciso, o app bloqueia a foto e avisa. Assim nenhuma evidência sai com localização errada.',
  },
  {
    id: 'legenda', km: '04', titulo: 'A legenda da foto',
    intro: 'Cada foto sai com a legenda gravada na própria imagem e com a localização também nos dados do arquivo. Veja o que cada linha significa.',
    legenda: true,
  },
  {
    id: 'galeria', km: '05', titulo: 'Galeria',
    intro: 'Todas as fotos ficam guardadas também dentro do app, mesmo depois de salvas no celular. Use a galeria para conferir, salvar de novo ou compartilhar.',
    telas: [{
      img: '13-galeria', itens: [
        ['Voltar', 'Fecha a galeria.'],
        ['Limpar galeria', 'Apaga do app só as fotos que já estão salvas no celular.'],
        ['Salvar', 'Salva ou compartilha a foto aberta.'],
        ['Posição', 'Número da foto e total de fotos no app.'],
        ['Excluir', 'Apaga a foto do app. A cópia do celular continua lá.'],
        ['Nome e situação', 'Nome do arquivo e se a foto já está salva no celular.'],
      ],
    }],
    dica: 'Arraste para os lados para trocar de foto. Dois toques ou o movimento de pinça dão zoom.',
  },
  {
    id: 'carro', km: '06', titulo: 'Modo Carro',
    intro: 'Uma tela de painel para acompanhar a rodovia dirigindo, com o celular no suporte. O KM fica grande, a tela não apaga e a estrada ao fundo anda na velocidade do carro.',
    telas: [{
      img: '20-carro-dia', itens: [
        ['Sair', 'Fecha o Modo Carro.'],
        ['Placa', 'BR e KM inteiro.'],
        ['KM ao vivo', 'Quilômetro exato, atualizado pelo GPS.'],
        ['Próximo km', 'Barra e metros que faltam para o próximo quilômetro.'],
        ['Estaca', 'Estaca do ponto atual.'],
        ['GPS', 'Precisão do sinal em metros.'],
        ['Contrato', 'Contrato ativo no trecho.'],
        ['Lado', 'Crescente ou Decrescente, pelo sentido em que o KM está mudando.'],
        ['Coordenadas', 'Latitude e longitude no formato da legenda.'],
      ],
    }, {
      img: '21-carro-noite', titulo: 'À noite',
      texto: 'No automático, a tela escurece 1 hora depois do pôr do sol e clareia no nascer do sol. O horário é calculado pela sua posição, sem internet. Em Configurações você pode deixar sempre claro ou sempre escuro.',
    }, {
      img: '22-carro-deitado', titulo: 'No suporte deitado', deitado: true,
      texto: 'Com o celular na horizontal, o KM fica à esquerda e os outros dados à direita.',
    }],
  },
  {
    id: 'eixo', km: '07', titulo: 'Gestão de Eixo',
    intro: 'Aqui ficam as rodovias que o app usa para calcular o KM. Você pode baixar do SNV/DNIT ou importar um arquivo de qualquer rodovia: federal, estadual ou municipal.',
    telas: [{
      img: '30-gestao-eixo', itens: [
        ['Rodovia baixada', 'Nome, trecho de KM e origem dos dados, com a versão do SNV.'],
        ['Detalhes', 'Estaca e trechos coincidentes. O ponto verde avisa que há ajuste.'],
        ['Remover', 'Tira a rodovia do celular.'],
      ],
      texto: 'Para baixar, escolha UF, BR, versão do SNV e o código do trecho. Deixe os km em branco para baixar a rodovia inteira.',
    }, {
      img: '31-importar', itens: [
        ['Importar arquivo', 'Abre o seletor de arquivos do celular.'],
        ['Shapefile', 'Arquivo .shp com .dbf, ou o .zip. De qualquer órgão.'],
        ['Google Earth e GPS', 'KMZ, KML ou GPX. A linha da estrada ou marcos de km.'],
        ['Planilha', 'Excel ou CSV com KM, latitude e longitude. Aceita UTM.'],
      ],
    }, {
      img: '33-importar-configurar', titulo: 'Configurar trecho', itens: [
        ['Rodovia e UF', 'Nome livre: BR-110, RN-118 ou o nome da estrada.'],
        ['Aviso do arquivo', 'O app explica o que encontrou e o que falta.'],
        ['KM no início', 'Quilômetro da ponta onde a linha começa.'],
        ['Ponta do km 0', 'Escolha a ponta A ou B, marcadas no desenho.'],
        ['Desenho e resumo', 'Traçado, extensão medida e trecho final.'],
        ['Mais opções', 'Nome do trecho, zero da estaca e contrato.'],
      ],
      texto: 'Arquivos exportados do AutoCAD trazem o desenho inteiro do projeto. O app mede as linhas e já marca o Eixo provável.',
    }, {
      img: '62-detalhes-rodovia', titulo: 'Detalhes da rodovia',
      texto: 'Mostra o trecho baixado, a estaca em uso e os trechos onde duas rodovias usam o mesmo traçado. Nesses trechos você escolhe qual vale para o KM e a legenda.',
    }, {
      img: '63-estaca', titulo: 'Estaca',
      texto: 'A estaca automática é contada desde o km 0, a cada 20 m. Para lotes com estaqueamento próprio, defina o zero: o KM onde começa e a estaca dele.',
    }],
  },
  {
    id: 'consulta', km: '08', titulo: 'Consulta',
    intro: 'Para quem trabalha com planilhas. Converta uma lista de coordenadas em KM, ou um KM em coordenada, usando as rodovias baixadas.',
    telas: [{
      img: '40-consulta', itens: [
        ['Coordenadas', 'Cole uma por linha. Pode copiar direto do Excel.'],
        ['Calcular KM', 'Encontra a rodovia e o KM de cada ponto.'],
        ['Usar GPS', 'Acrescenta a sua posição atual na lista.'],
        ['Resultado', 'Rodovia, KM e distância até o eixo.'],
        ['Copiar resultado', 'Copia a tabela pronta para colar no Excel.'],
      ],
      texto: 'Em KM → Coordenada, escolha a rodovia e digite o KM para ver a latitude e a longitude.',
    }],
  },
  {
    id: 'config', km: '09', titulo: 'Configurações',
    intro: 'Os ajustes ficam em três abas: Câmera, Logo e Legenda. Eles valem para todas as próximas fotos.',
    ajustes: [
      { img: '50-config-qualidade', titulo: 'Câmera', linhas: [
        ['Resolução', 'Tamanho da foto. "Máxima disponível" usa o melhor do aparelho.'],
        ['Qualidade', 'Compressão da imagem. Alta é o equilíbrio entre nitidez e tamanho.'],
        ['Formato', 'Proporção padrão da foto.'],
        ['Alerta sonoro', 'Som ao tirar a foto.'],
      ] },
      { img: '51-config-aparencia', titulo: 'Depois da foto e aparência', linhas: [
        ['Envio automático para a galeria', 'Salva cada foto no celular assim que ela é tirada.'],
        ['Tema claro', 'Fundo claro com cartões escuros.'],
        ['Modo carro à noite', 'Automático (escurece 1 h após o pôr do sol), sempre claro ou sempre escuro.'],
      ] },
      { img: '52-config-logo', titulo: 'Logo', linhas: [
        ['Escolher logo', 'Imagem da empresa. O fundo é recortado sozinho.'],
        ['Posição', 'Canto da foto onde a logo aparece.'],
        ['Opacidade e tamanho', 'Transparência e tamanho da logo.'],
      ] },
      { img: '53-config-legenda', titulo: 'Legenda', linhas: [
        ['Posição', 'Canto da foto onde a legenda aparece.'],
        ['Tamanho e cor', 'Tamanho e cor do texto gravado.'],
        ['Negrito e opacidade', 'Peso e transparência do texto.'],
      ] },
      { img: '54-config-fundo', titulo: 'Fundo da legenda', linhas: [
        ['Fundo da legenda', 'Tarja atrás do texto, para ler sobre qualquer imagem.'],
        ['Tom do fundo', 'Claro ou escuro.'],
        ['Transparência', 'Quanto da foto aparece por trás da tarja.'],
      ] },
      { img: '55-config-conteudo', titulo: 'Conteúdo da legenda', linhas: [
        ['Exibir estaca', 'Estaca ao lado do KM.'],
        ['Exibir SNV', 'Versão do SNV na linha da data.'],
        ['Nome da OAE', 'Ponte ou viaduto quando a foto é tirada sobre um.'],
        ['Formato das coordenadas', 'Decimal, graus/minutos/segundos e outras opções.'],
        ['Precisão do GPS', 'Margem de erro em metros na legenda.'],
        ['Formato da data', 'Data com ou sem hora, curta ou por extenso.'],
      ] },
      { img: '56-config-servicos', titulo: 'Descrição de serviços', linhas: [
        ['Serviços', 'Lista para escolha rápida na câmera.'],
      ] },
    ],
  },
  {
    id: 'contratos', km: '10', titulo: 'Contratos',
    intro: 'Cadastre os contratos e vincule cada um ao trecho de rodovia em que ele vale. Dentro do trecho, o contrato entra sozinho na legenda.',
    telas: [{
      img: '57-config-contratos', titulo: 'Lista de contratos',
      texto: 'Toque num contrato para usá-lo. A corrente abre os vínculos, AUTO liga ou desliga o automático daquele contrato e o X remove. A chave Automático, embaixo, liga todos os vinculados de uma vez.',
    }, {
      img: '60-vincular-contrato', titulo: 'Vincular a uma rodovia',
      texto: 'Escolha a rodovia em que o contrato vale. Um contrato pode ter vários trechos, em rodovias diferentes.',
    }, {
      img: '61-vincular-trecho', titulo: 'Trecho do contrato',
      texto: 'Informe o km inicial e o final, ou use o segmento todo. Escolher um contrato à mão pausa o automático, para o app não trocar o que você escolheu.',
    }],
  },
  {
    id: 'problemas', km: '11', titulo: 'Dicas e soluções',
    intro: 'As situações mais comuns no campo e o que fazer em cada uma.',
    faq: [
      ['O KM aparece com tracinhos', 'A rodovia não está baixada no celular, ou você está longe de todas as rodovias baixadas. Baixe a rodovia em Gestão de Eixo.'],
      ['O KM ficou vermelho e a legenda tem ⚠', 'Você está mais longe do eixo do que a distância de alerta (padrão de 300 m). Confira se está na rodovia certa.'],
      ['GPS impreciso ou desatualizado', 'Espere alguns segundos em céu aberto. Dentro de carro ou perto de prédios o sinal piora.'],
      ['Localização obrigatória', 'O app precisa da localização para gravar as coordenadas. No iPhone: Ajustes, Privacidade, Serviços de Localização, Safari, "Ao Usar o App". No Android: cadeado da barra de endereço, Permissões, Localização.'],
      ['A foto não foi para o celular', 'Ela continua guardada na galeria do app. Abra a galeria e toque em Salvar.'],
      ['Duas rodovias no mesmo trecho', 'Em Detalhes da rodovia, escolha qual vale ali. Manter as duas faz o app usar a mais próxima do GPS.'],
      ['Atualizar o app', 'O app se atualiza sozinho com internet. No iPhone, se não atualizar, feche o app de vez e abra de novo.'],
    ],
    telas: [{ img: '64-gps-desligado', titulo: 'Aviso de localização', texto: 'Aparece quando a localização está bloqueada. O botão Tentar novamente pede a permissão outra vez.' }],
  },
];
