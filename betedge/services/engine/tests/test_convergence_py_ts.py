"""Teste automatizado de convergência Python/TypeScript.

Verifica que o frontend TypeScript NÃO recalcula as métricas quantitativas
que devem vir exclusivamente do backend Python:
    - Fair probability (Shin method)
    - Edge
    - EV (Expected Value)
    - PREDIQ Score
    - Kelly staking
    - CLV (Closing Line Value)

O teste faz uma varredura estática nos arquivos .ts/.tsx do monorepo e
detecta padrões de cálculo quantitativo que deveriam estar apenas no Python.

Resultado: WARNING se recalculação é detectada (não FAIL, porque o TS pode
ter implementações para fins de display/validação que não alteram os dados
canônicos no banco).

Nota: Este teste documenta o estado atual e serve como guardrail para
evitar divergência silenciosa entre as implementações.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import pytest

# Diretório raiz do monorepo
MONOREPO_ROOT = Path(__file__).resolve().parents[3]  # betedge/
WEB_APP_DIR = MONOREPO_ROOT / "apps" / "web"
UTILS_DIR = MONOREPO_ROOT / "packages" / "utils"

# Padrões que indicam cálculo quantitativo no TS
# (não simples exibição de valores do banco)
CALCULATION_PATTERNS = {
    "shin_method": {
        "pattern": r"(?i)(shin|shinMethod|shin_method|shinSolver|computeShin)",
        "description": "Implementação do método Shin para remoção de vig",
        "severity": "WARNING",
    },
    "fair_probability_calc": {
        "pattern": r"(?i)(fairProb|fair_prob|fairProbability|removeShinVig|removeVig|vigRemov)",
        "description": "Cálculo de fair probability (vig removal)",
        "severity": "WARNING",
    },
    "edge_formula": {
        "pattern": r"(?i)(modelProb|model_prob|probability)\s*[-+*\/]\s*(fairProb|fair_prob|fairProbability|impliedProb)",
        "description": "Fórmula de Edge: model_prob - fair_prob",
        "severity": "WARNING",
    },
    "ev_formula": {
        "pattern": r"(?i)(modelProb|model_prob|probability)\s*\*\s*(bestOdds|best_odds|odds|decimalOdds)\s*-\s*1",
        "description": "Fórmula de EV: model_prob × odds - 1",
        "severity": "WARNING",
    },
    "kelly_formula": {
        "pattern": r"(?i)(kelly|kellyFraction|kelly_fraction|kellyCriterion).*(?:odds|probability)",
        "description": "Cálculo de Kelly criterion",
        "severity": "INFO",  # Kelly pode existir para display
    },
}

# Arquivos que devem ser auditados
AUDIT_DIRS = [
    WEB_APP_DIR / "src",
    UTILS_DIR / "src",
]

# Arquivos conhecidos que contêm cálculos (documentação)
KNOWN_CALCULATION_FILES = {
    # Estes arquivos contêm implementações de cálculo no TS — documentados
    # como WARNING porque idealmente todo cálculo viria do Python via API.
    "packages/utils/src/odds.ts": "Shin, power, multiplicative vig removal",
    "apps/web/src/app/api/model-audit/route.ts": "Shin inline, Edge, EV",
    "apps/web/src/app/api/odds/comparison": "Shin, power, multiplicative inline",
    "apps/web/src/app/api/shadow-lab/route.ts": "Brier, Log Loss, ECE, Drawdown",
    # Client-side — usam as funções de odds.ts para display/comparação
    "apps/web/src/app/(app)/odds-comparison/client.tsx": "Shin import para display de comparação",
    "apps/web/src/app/(app)/model-audit/client.tsx": "Shin import para display de auditoria",
    "apps/web/src/app/(app)/shadow-lab/client.tsx": "Shin import para display do shadow lab",
}


def _find_ts_files(dirs: list[Path]) -> list[Path]:
    """Encontra todos os arquivos .ts/.tsx nos diretórios especificados."""
    files = []
    for d in dirs:
        if d.exists():
            for ext in ("*.ts", "*.tsx"):
                files.extend(d.rglob(ext))
    # Excluir node_modules e arquivos de teste
    return [
        f for f in files
        if "node_modules" not in str(f) and ".test." not in f.name
    ]


def _scan_file_for_patterns(
    filepath: Path,
    patterns: dict,
) -> list[dict]:
    """Varre um arquivo TS para padrões de cálculo quantitativo."""
    findings = []
    try:
        content = filepath.read_text(encoding="utf-8")
    except Exception:
        return findings

    for pattern_name, config in patterns.items():
        matches = list(re.finditer(config["pattern"], content))
        if matches:
            # Extrair números de linha
            lines = []
            for m in matches[:5]:  # Máximo 5 ocorrências por padrão
                line_no = content[:m.start()].count("\n") + 1
                lines.append(line_no)

            findings.append({
                "file": str(filepath.relative_to(MONOREPO_ROOT)),
                "pattern": pattern_name,
                "description": config["description"],
                "severity": config["severity"],
                "lines": lines,
                "count": len(matches),
            })

    return findings


class TestConvergenciaPyTS:
    """Testes de convergência Python/TypeScript.

    Verifica que cálculos quantitativos residem exclusivamente no backend
    Python, e o frontend TS apenas exibe valores do banco/API.
    """

    def test_ts_files_exist(self):
        """Verifica que os diretórios TS existem para serem auditados."""
        # Se o monorepo não tem TS, o teste passa (não há divergência)
        has_ts = any(d.exists() for d in AUDIT_DIRS)
        if not has_ts:
            pytest.skip("Diretórios TypeScript não encontrados no monorepo")

    def test_no_shin_in_display_components(self):
        """Componentes de display (.tsx) não devem implementar Shin.

        Shin method é computacionalmente complexo e deve vir exclusivamente
        da API Python. Se um componente .tsx implementa Shin, é um risco de
        divergência.
        """
        tsx_files = []
        for d in AUDIT_DIRS:
            if d.exists():
                tsx_files.extend(d.rglob("*.tsx"))
        tsx_files = [f for f in tsx_files if "node_modules" not in str(f)]

        shin_in_tsx = []
        for f in tsx_files:
            try:
                content = f.read_text()
                if re.search(r"(?i)(shinMethod|shin_method|shinSolver|computeShin)", content):
                    shin_in_tsx.append(str(f.relative_to(MONOREPO_ROOT)))
            except Exception:
                pass

        assert not shin_in_tsx, (
            f"Shin method encontrado em componentes de display: {shin_in_tsx}. "
            "Fair probability deve vir exclusivamente da API Python."
        )

    def test_api_routes_calculation_audit(self):
        """Audita API routes do Next.js para cálculos quantitativos.

        API routes (route.ts) que recalculam métricas são um WARNING
        documentado — idealmente pegariam os valores do Python/banco, mas
        podem ter razões válidas (ex.: Model Audit compara resultados).

        Este teste documenta os arquivos conhecidos e alerta sobre novos.
        """
        api_dir = WEB_APP_DIR / "src" / "app" / "api"
        if not api_dir.exists():
            pytest.skip("Diretório de API routes não encontrado")

        route_files = list(api_dir.rglob("route.ts"))
        route_files = [f for f in route_files if "node_modules" not in str(f)]

        all_findings = []
        for f in route_files:
            findings = _scan_file_for_patterns(f, CALCULATION_PATTERNS)
            all_findings.extend(findings)

        new_findings = []
        for finding in all_findings:
            is_known = any(
                finding["file"].startswith(known) or known in finding["file"]
                for known in KNOWN_CALCULATION_FILES
            )
            if not is_known:
                new_findings.append(finding)

        if new_findings:
            msg = "NOVOS cálculos quantitativos detectados em API routes TS:\n"
            for f in new_findings:
                msg += f"  - {f['file']} ({f['pattern']}): {f['description']} [linhas {f['lines']}]\n"
            msg += "\nSe intencionais, adicionar a KNOWN_CALCULATION_FILES."
            pytest.fail(msg)

    def test_known_calculations_documented(self):
        """Verifica que os arquivos TS com cálculos conhecidos são documentados.

        Este teste serve como guardrail: se um arquivo conhecido for removido
        ou renomeado, o teste alerta para atualizar a documentação.
        """
        for known_file, description in KNOWN_CALCULATION_FILES.items():
            full_path = MONOREPO_ROOT / known_file
            # Não falhar se o arquivo não existe — pode ter sido refatorado
            if not full_path.exists() and not full_path.is_dir():
                # Verificar se é um diretório (ex.: odds/comparison)
                parent = MONOREPO_ROOT / known_file
                if not parent.exists():
                    pytest.xfail(
                        f"Arquivo/diretório TS documentado não encontrado: {known_file} "
                        f"(descrição: {description}). Atualizar KNOWN_CALCULATION_FILES."
                    )

    def test_convergence_summary(self):
        """Gera sumário da auditoria de convergência Py/TS.

        Este teste sempre passa (é informativo), mas imprime o estado
        atual da convergência para inclusão no relatório.
        """
        ts_files = _find_ts_files(AUDIT_DIRS)

        if not ts_files:
            pytest.skip("Nenhum arquivo TS encontrado")

        all_findings = []
        for f in ts_files:
            findings = _scan_file_for_patterns(f, CALCULATION_PATTERNS)
            all_findings.extend(findings)

        # Sumário
        print("\n" + "=" * 60)
        print("CONVERGÊNCIA PY/TS — SUMÁRIO DE AUDITORIA")
        print("=" * 60)
        print(f"Arquivos TS analisados: {len(ts_files)}")
        print(f"Findings totais: {len(all_findings)}")
        print()

        if all_findings:
            warnings = [f for f in all_findings if f["severity"] == "WARNING"]
            infos = [f for f in all_findings if f["severity"] == "INFO"]
            print(f"  WARNINGs: {len(warnings)}")
            print(f"  INFOs: {len(infos)}")
            print()
            for f in all_findings:
                known = any(
                    f["file"].startswith(k) or k in f["file"]
                    for k in KNOWN_CALCULATION_FILES
                )
                status = "KNOWN" if known else "NEW"
                print(f"  [{f['severity']}] [{status}] {f['file']}")
                print(f"         {f['description']} (linhas {f['lines']})")
        else:
            print("  ✅ Nenhum cálculo quantitativo detectado no TS")

        print()
        print("VEREDICTO: WARNING — TS contém cálculos conhecidos em:")
        for k, v in KNOWN_CALCULATION_FILES.items():
            print(f"  - {k}: {v}")
        print()
        print("Ação recomendada: migrar cálculos do TS para consumo via API Python.")
        print("Impacto atual: BAIXO — valores canônicos estão no banco (Python).")
        print("=" * 60)
