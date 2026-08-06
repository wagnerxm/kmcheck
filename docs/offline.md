# Funcionamento Offline

## Visão geral

O KM Check foi projetado para funcionar **100% offline** depois da instalação na tela inicial. Isso é essencial porque rodovias federais frequentemente cruzam áreas sem cobertura de dados móveis.

---

## Service Worker (`sw.js`)

### Versionamento do cache

```js
const CACHE = 'kmcheck-v158';
```

A cada alteração no app, esse número é incrementado. O nome do cache identifica unicamente a versão — caches antigos são deletados na ativação.

### Estratégia de cache

O SW usa **duas estratégias** dependendo do tipo de recurso:

#### Rede primeiro (document + dados de rodovias)

```
Requisição → Tenta a rede → Sucesso? → Atualiza cache + responde
                              │
                              └→ Falha? → Responde do cache (offline)
```

Aplica-se a:
- O documento principal (`index.html`, navegação)
- Arquivos de rodovias (`/data/rodovias/*.json`)

**Por quê:** garante que o app pegue a versão mais nova quando há internet, sem ficar "preso" numa versão antiga.

#### Cache primeiro (assets estáticos)

```
Requisição → Tem no cache? → Sim → Responde do cache
                              │
                              └→ Não → Busca na rede → Cacheia + responde
```

Aplica-se a:
- Fontes (`carlito-*.woff2`)
- Ícones (`icon-*.png`, `apple-touch-icon.png`)
- Biblioteca (`fflate.js`)
- Manifesto

**Por quê:** esses assets mudam raramente; servir do cache é instantâneo.

### Instalação

No evento `install`, o SW pré-cacheia os assets essenciais:

```js
const ASSETS = ['./', 'index.html', 'fflate.js', 'manifest.v143.webmanifest',
                'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'logo-header.png'];
```

### Ativação

No evento `activate`, caches com nomes diferentes do atual são deletados:

```js
caches.keys().then(ks => Promise.all(
  ks.filter(k => k !== CACHE).map(k => caches.delete(k))
));
```

---

## O que funciona offline

| Funcionalidade | Offline | Observação |
|---|---|---|
| GPS + KM ao vivo | ✅ | GPS é do dispositivo, dados da rodovia estão no IndexedDB |
| Câmera + legenda | ✅ | Tudo local |
| Tirar e salvar fotos | ✅ | Salva no dispositivo e no IndexedDB |
| Galeria interna | ✅ | Fotos no IndexedDB |
| Consulta Coord → KM | ✅ | Cálculo local sobre rodovias instaladas |
| Configurações | ✅ | Tudo em localStorage |
| Baixar nova rodovia (SNV) | ❌ | Precisa de internet para acessar o GeoServer |
| Importar shapefile/KMZ | ✅ | Arquivo local, processado no navegador |

---

## Atualização do app

### Mecanismo

1. O SW busca o `index.html` pela rede (rede-primeiro)
2. Se o conteúdo é diferente, cacheia a nova versão
3. Na próxima abertura, o novo SW é instalado e ativado
4. O app usa a versão nova

### Importância do versionamento

**Cada alteração no app DEVE incrementar o número em `sw.js`** (`kmcheck-v158` → `kmcheck-v159`). Sem isso, os aparelhos continuam servindo a versão antiga do cache.

### Verificação do deploy

Após o push, o GitHub Pages leva 1-3 minutos. Para confirmar:

```
https://wagnerxm.github.io/kmcheck/sw.js
```

A primeira linha deve mostrar a versão nova.

### iPhone: troca de versão

No iPhone, o app instalado na tela inicial às vezes só atualiza **fechando completamente** (app switcher → deslizar para cima) e reabrindo. **Nunca** sugerir remover e reinstalar — perde dados do `localStorage`.

---

## Manifesto PWA

O arquivo `manifest.v143.webmanifest` configura:

```json
{
  "name": "KM Check",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#f1f2f3",
  "theme_color": "#f1f2f3"
}
```

- **`standalone`:** remove a barra do navegador — parece app nativo
- **`portrait`:** tenta travar em retrato (nem todos os dispositivos respeitam)

---

## Persistência de dados

| Tipo | Mecanismo | Sobrevive a... |
|---|---|---|
| Rodovias instaladas | IndexedDB (`bases`) | Fechamento, reinício, limpeza de cache |
| Fotos registradas | IndexedDB (`photos`) | Fechamento, reinício, limpeza de cache |
| Preferências | localStorage (`kc-*`) | Fechamento, reinício |
| Cache do app | Cache API (via SW) | Reinício; deletado na atualização de versão |

⚠ **Remover o app da tela inicial (desinstalar a PWA) apaga TUDO** — IndexedDB, localStorage e cache.
