# Banco de Dados

## Visão geral

O KM Check usa dois mecanismos de armazenamento local e um banco remoto opcional:

- **IndexedDB** — dados estruturados (rodovias e fotos)
- **localStorage** — preferências do usuário
- **Supabase** (opcional) — sincronização remota de dados de rodovias

---

## IndexedDB

### Database: `kmcheck` (versão 2)

#### Object Store: `bases`

Armazena as rodovias instaladas pelo usuário.

| Campo | Tipo | Descrição |
|---|---|---|
| `id` (keyPath) | string | Identificador único (`BR-226/RN`) |
| `br` | string | Código da BR (`BR-226`) |
| `uf` | string | Unidade federativa (`RN`) |
| `fonte` | string | Origem dos dados (`SNV 202607a`, `CSV (arquivo.csv)`) |
| `kmMin` | number | KM mínimo da rodovia |
| `kmMax` | number | KM máximo da rodovia |
| `lat` | number[] | Array de latitudes dos vértices |
| `lon` | number[] | Array de longitudes dos vértices |
| `km` | number[] | Array de quilometragens dos vértices |

**Operações:**
- `dbAll()` — lista todas as bases
- `dbPut(base)` — insere ou atualiza uma base (upsert por ID)
- `dbDel(id)` — remove uma base

#### Object Store: `photos`

Armazena as fotos tiradas pelo app (galeria interna).

| Campo | Tipo | Descrição |
|---|---|---|
| `id` (auto-increment) | number | ID sequencial |
| `name` | string | Nome do arquivo (`BR-226RN - KM 409,120 143521.jpg`) |
| `blob` | Blob | Dados binários da imagem JPEG |
| `ts` | number | Timestamp (`Date.now()`) |

**Operações:**
- `savePhotoToGallery(blob, name)` — adiciona uma foto
- `getAllPhotos()` — lista todas, ordenadas por timestamp (mais recente primeiro)

### Função `idb()`

Wrapper que abre a conexão com o IndexedDB e gerencia upgrades:

```js
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('kmcheck', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('bases'))
        d.createObjectStore('bases', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('photos'))
        d.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
```

---

## localStorage

Todas as preferências usam chaves com prefixo `kc-`:

| Chave | Tipo | Padrão | Descrição |
|---|---|---|---|
| `kc-theme` | `'light'` \| `'dark'` | `'light'` | Tema claro/escuro |
| `kc-res` | `'max'` \| `'1080'` \| `'1440'` \| `'2160'` | `'1080'` | Resolução da câmera |
| `kc-qual` | string (float) | `'0.95'` | Qualidade JPEG (0-1) |
| `kc-format` | `'1:1'` \| `'3:4'` \| `'9:16'` | `'3:4'` | Proporção da foto |
| `kc-oae` | `'1'` \| `'0'` | `'1'` | Exibir nome da OAE |
| `kc-coord` | `'1'` \| `'0'` | `'1'` | Exibir coordenadas na legenda |
| `kc-acc` | `'1'` \| `'0'` | `'0'` | Exibir precisão do GPS |
| `kc-estaca` | `'1'` \| `'0'` | `'1'` | Exibir estaca rodoviária |
| `kc-legpos` | `'bl'` \| `'br'` \| `'tl'` \| `'tr'` | `'bl'` | Posição da legenda |
| `kc-legcolor` | cor hex | `'#ffffff'` | Cor do texto da legenda |
| `kc-legop` | string (int) | `'100'` | Opacidade da legenda (%) |
| `kc-legsz` | string (int) | `'150'` | Tamanho da legenda (%) |
| `kc-legbold` | `'1'` \| `'0'` | `'1'` | Negrito na legenda |
| `kc-coordstyle` | string | `'decimal'` | Estilo das coordenadas |
| `kc-datestyle` | string | `'curta_hora'` | Estilo da data |
| `kc-logopos` | `'tl'` \| `'tr'` \| `'bl'` \| `'br'` | `'tl'` | Posição da logo |
| `kc-logoop` | string (int) | `'100'` | Opacidade da logo (%) |
| `kc-logosz` | string (int) | `'100'` | Tamanho da logo (%) |
| `kc-logo` | data URL (PNG) | — | Imagem da logo (base64) |
| `kc-maxdist` | string (int) | `'300'` | Distância máxima ao eixo (m) |
| `kc-soundalert` | `'1'` \| `'0'` | `'1'` | Som de obturador |
| `kc-side` | `''` \| `'LD'` \| `'LE'` | `''` | Lado da rodovia |
| `kc-svcsel` | string | `''` | Serviço selecionado |
| `kc-services` | JSON array | `'[]'` | Lista de serviços cadastrados |
| `kc-contracts` | JSON array | `'[]'` | Lista de contratos cadastrados |
| `kc-contract` | string | `''` | Contrato ativo |
| `kc-svc-removed` | JSON array | `'[]'` | Serviços padrão removidos |
| `kc-dluf` | string | `'RN'` | Última UF selecionada no download |
| `kc-rotlock-never` | `'1'` | — | Não mostrar dica de bloqueio |
| `kc-defaults-v1` | `'1'` | — | Flag de migração de defaults |

### Defaults (migração)

Na primeira execução, o bloco `kc-defaults-v1` aplica valores padrão otimizados para campo:

```js
{ res: '1080', qual: '0.95', soundalert: '1',
  legsz: '150', legbold: '1', estaca: '1', acc: '0', theme: 'light' }
```

---

## Supabase (remoto)

### Schema

O arquivo `scripts/supabase_schema.sql` define duas tabelas:

#### `pontos_rodovia`

Armazena os pontos das rodovias, populados pelo script `sync-dnit.mjs`.

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | bigint (auto) | PK |
| `rodovia_id` | text | Ex.: `BR-226-RN` |
| `br` | text | `226` |
| `uf` | text | `RN` |
| `km` | numeric | Quilometragem |
| `lat` | double precision | Latitude |
| `lon` | double precision | Longitude |
| `atualizado_em` | timestamptz | Última atualização |

- Índice em `rodovia_id`
- Constraint unique em `(rodovia_id, km)`
- RLS habilitado: leitura pública

#### `historico_fotos`

Registra metadados das fotos (não os bytes).

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | bigint (auto) | PK |
| `url` | text | URL da foto |
| `rodovia` | text | Rodovia |
| `km` | numeric | KM |
| `lat` / `lon` | double precision | Coordenadas |
| `criado_em` | timestamptz | Data de criação |

- RLS habilitado: leitura e inserção públicas
