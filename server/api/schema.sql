-- Banco do KM Check: base de rodovias do SNV/DNIT + apps autorizados a consumir a base.
-- Roda só na criação do banco (docker-entrypoint-initdb.d). Os dados de rodovias/versões vêm do
-- pipeline do SNV (POST /api/rodovias/import) ou da migração a partir do banco antigo.

CREATE TABLE IF NOT EXISTS snv_versoes (
  id TEXT PRIMARY KEY,               -- ex.: '202607a'
  label TEXT NOT NULL,
  data_publicacao DATE,
  arquivo_dnit TEXT,
  total_rodovias INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pendente',    -- pendente | processando | concluido | erro | disponivel
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rodovias (
  id TEXT PRIMARY KEY,
  br TEXT NOT NULL,
  uf TEXT NOT NULL,
  fonte TEXT NOT NULL DEFAULT 'SNV/DNIT',
  km_min NUMERIC NOT NULL,
  km_max NUMERIC NOT NULL,
  lat NUMERIC[] NOT NULL,
  lon NUMERIC[] NOT NULL,
  km NUMERIC[] NOT NULL,
  versao_snv TEXT NOT NULL DEFAULT '',
  data_atualizacao TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  tipo_tr CHAR(1) NOT NULL DEFAULT 'B'
);
CREATE INDEX IF NOT EXISTS idx_rodovias_br_uf ON rodovias(br, uf);
CREATE INDEX IF NOT EXISTS idx_rodovias_br ON rodovias(br);
CREATE INDEX IF NOT EXISTS idx_rodovias_versao ON rodovias(versao_snv);
CREATE INDEX IF NOT EXISTS idx_rodovias_tipo ON rodovias(tipo_tr);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rodovias_br_uf_tipo_snv ON rodovias(br, uf, tipo_tr, versao_snv);

-- Apps que consomem a base (ControlCheck e futuros). Só o hash da chave é guardado.
CREATE TABLE IF NOT EXISTS api_clients (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  chave_hash TEXT NOT NULL UNIQUE,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  limite_min INTEGER NOT NULL DEFAULT 300,
  total_req BIGINT NOT NULL DEFAULT 0,
  ultimo_uso TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);
