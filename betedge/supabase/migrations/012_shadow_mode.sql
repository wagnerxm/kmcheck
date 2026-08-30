-- ============================================================================
-- Migration 012: Shadow Mode tables + RLS + indexes
--
-- Cria as tabelas shadow_predictions e shadow_pipeline_runs com:
-- - RLS habilitado e policies de segurança
-- - Índices otimizados para queries de aggregação
-- - Proteção append-only em campos de grading (write-once)
-- ============================================================================

-- Nota: As tabelas são criadas pelo engine via ensure_shadow_tables()
-- no primeiro ciclo. Esta migration garante que RLS e policies existam
-- independentemente da ordem de execução.

-- ============================================================================
-- RLS: shadow_predictions
-- ============================================================================

-- Habilitar RLS (idempotente)
ALTER TABLE IF EXISTS shadow_predictions ENABLE ROW LEVEL SECURITY;

-- Leitura: apenas usuários autenticados com tier pro+ ou admins
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'shadow_predictions' AND policyname = 'shadow_predictions_select_pro'
    ) THEN
        CREATE POLICY shadow_predictions_select_pro ON shadow_predictions
            FOR SELECT
            TO authenticated
            USING (fn_has_min_tier('pro') OR fn_is_admin());
    END IF;
END $$;

-- Service role tem acesso total (o engine usa service role)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'shadow_predictions' AND policyname = 'shadow_predictions_service_all'
    ) THEN
        CREATE POLICY shadow_predictions_service_all ON shadow_predictions
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

-- ============================================================================
-- RLS: shadow_pipeline_runs
-- ============================================================================

ALTER TABLE IF EXISTS shadow_pipeline_runs ENABLE ROW LEVEL SECURITY;

-- Pipeline runs são visíveis apenas para admins (dados operacionais)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'shadow_pipeline_runs' AND policyname = 'shadow_pipeline_runs_select_admin'
    ) THEN
        CREATE POLICY shadow_pipeline_runs_select_admin ON shadow_pipeline_runs
            FOR SELECT
            TO authenticated
            USING (fn_is_admin());
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'shadow_pipeline_runs' AND policyname = 'shadow_pipeline_runs_service_all'
    ) THEN
        CREATE POLICY shadow_pipeline_runs_service_all ON shadow_pipeline_runs
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

-- ============================================================================
-- Proteção write-once: impedir alteração de campos de grading após preenchimento
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_protect_shadow_grading()
RETURNS TRIGGER AS $$
BEGIN
    -- Se result já foi preenchido, não permite alteração dos campos de grading.
    -- Isso garante integridade dos resultados — uma vez graded, o registro é imutável.
    IF OLD.result IS NOT NULL AND OLD.status IN ('graded', 'void') THEN
        IF NEW.result IS DISTINCT FROM OLD.result
           OR NEW.theoretical_return IS DISTINCT FROM OLD.theoretical_return
           OR NEW.clv IS DISTINCT FROM OLD.clv
           OR NEW.clv_price IS DISTINCT FROM OLD.clv_price
           OR NEW.clv_probability IS DISTINCT FROM OLD.clv_probability
           OR NEW.graded_at IS DISTINCT FROM OLD.graded_at THEN
            RAISE EXCEPTION 'shadow_predictions: campos de grading são write-once (imutáveis após preenchimento)';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_shadow_grading ON shadow_predictions;
CREATE TRIGGER trg_protect_shadow_grading
    BEFORE UPDATE ON shadow_predictions
    FOR EACH ROW
    EXECUTE FUNCTION fn_protect_shadow_grading();

-- ============================================================================
-- Rate limiting: tabela de controle (para uso pelo middleware da API)
-- ============================================================================

CREATE TABLE IF NOT EXISTS shadow_rate_limits (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_key    TEXT NOT NULL,          -- IP ou API key hash
    endpoint      TEXT NOT NULL,          -- ex: '/api/shadow/run'
    window_start  TIMESTAMPTZ NOT NULL DEFAULT now(),
    request_count INT NOT NULL DEFAULT 1,
    UNIQUE (client_key, endpoint, window_start)
);

CREATE INDEX IF NOT EXISTS idx_shadow_rate_limits_lookup
    ON shadow_rate_limits (client_key, endpoint, window_start DESC);

-- Limpar entries velhas periodicamente (> 1 hora).
-- Em produção isso seria um pg_cron job; aqui é uma função disponível para chamada manual.
CREATE OR REPLACE FUNCTION fn_cleanup_shadow_rate_limits()
RETURNS void AS $$
BEGIN
    DELETE FROM shadow_rate_limits
    WHERE window_start < now() - interval '1 hour';
END;
$$ LANGUAGE plpgsql;
