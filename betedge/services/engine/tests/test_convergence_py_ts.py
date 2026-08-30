"""Teste de convergência Python/TypeScript — guardrail quantitativo.

Garante que o frontend TypeScript NÃO contém implementações de cálculos
quantitativos que devem residir exclusivamente no backend Python:
    - Remoção de vig (Shin, power, multiplicative)
    - Fair probability
    - Overround
    - Edge
    - EV (Expected Value)
    - PREDIQ Score
    - Kelly staking
    - CLV (Closing Line Value)
    - Brier Score, Log Loss, ECE, Drawdown (métricas de calibração)

O teste faz uma varredura estática nos arquivos .ts/.tsx do monorepo e
detecta padrões de IMPLEMENTAÇÃO de cálculos quantitativos — definições
de funções e fórmulas, não variáveis que armazenam valores da API.

Resultado: FAIL se qualquer implementação quantitativa for detectada.
Nenhum cálculo quantitativo deve existir no TypeScript.

Python é a ÚNICA fonte oficial de toda matemática quantitativa do PREDIQ.
TypeScript deve apenas consumir, transformar para DTO e formatar para apresentação.

Nota: Este teste é um guardrail — impede reintrodução silenciosa de
fórmulas quantitativas no TypeScript.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

# Diretório raiz do monorepo
MONOREPO_ROOT = Path(__file__).resolve().parents[3]  # betedge/
WEB_APP_DIR = MONOREPO_ROOT / "apps" / "web"
UTILS_DIR = MONOREPO_ROOT / "packages" / "utils"

# ═══════════════════════════════════════════════════════════════════════
# Padrões de detecção — implementações de cálculo quantitativo
#
# Cada padrão detecta DEFINIÇÕES DE FUNÇÕES ou FÓRMULAS INLINE, não
# variáveis que simplesmente armazenam valores vindos da API/banco.
#
# "fairProb" como variável = OK (armazena valor do banco)
# "function removeVigShin(...)" = PROIBIDO (implementação no TS)
# "model_prob * odds - 1" = PROIBIDO (fórmula de EV no TS)
# ═══════════════════════════════════════════════════════════════════════

FORBIDDEN_PATTERNS = {
    "vig_removal_function": {
        # Definições de funções de remoção de vig — Shin, power, multiplicative
        "pattern": r"(?i)function\s+(removeVig|removVig|removeVigShin|removeVigPower|removeVigMultiplicative)\s*\(",
        "description": "Definição de função de remoção de vig no TypeScript",
    },
    "shin_implementation": {
        # Implementação do solver Shin — busca binária com sqrt e denom
        "pattern": r"(?i)(shinMethod|shin_method|shinSolver|computeShin)\s*[\(=]",
        "description": "Implementação do método Shin (solver numérico)",
    },
    "shin_formula_body": {
        # Corpo da fórmula Shin: sqrt(z² + 4(1-z)·pi²/S)
        "pattern": r"Math\.sqrt\(\s*z\s*\*\s*z\s*\+.*\(1.*z\).*p.*\/\s*s\b",
        "description": "Fórmula interna do Shin (z² + 4(1-z)·pi²/S)",
    },
    "power_method_solver": {
        # Busca binária do power method: totalAt(k) > 1.0
        "pattern": r"totalAt\s*\(\s*(hi|lo|mid|k)\s*\)\s*>\s*1\.0",
        "description": "Solver numérico do power method (totalAt(k) > 1)",
    },
    "brier_formula": {
        # Fórmula de Brier Score: (p - outcome) ** 2
        "pattern": r"\(\s*p\s*-\s*outcome\s*\)\s*\*\*\s*2|\(\s*\w+\s*-\s*\w+\)\s*\*\*\s*2\s*.*(?:brier|score)",
        "description": "Cálculo de Brier Score: (probabilidade - outcome)²",
    },
    "log_loss_formula": {
        # Fórmula de Log Loss: -(y * log(p) + (1-y) * log(1-p))
        "pattern": r"Math\.log\(\s*p\s*\).*Math\.log\(\s*1\s*-\s*p\s*\)|Math\.log\(\s*1\s*-\s*p\s*\).*Math\.log\(\s*p\s*\)",
        "description": "Cálculo de Log Loss: -[y·ln(p) + (1-y)·ln(1-p)]",
    },
    "ece_binning": {
        # Cálculo de ECE com bins: Math.floor(p * NUM_BINS)
        "pattern": r"Math\.floor\(\s*\w+\s*\*\s*(10|NUM_BINS|numBins)\s*\).*(?:sumPred|sumOutcome|sp\b|so\b)",
        "description": "Cálculo de ECE com binning (Expected Calibration Error)",
    },
    "drawdown_simulation": {
        # Simulação de drawdown: peak, bankroll, drawdown em loop
        "pattern": r"(?i)(bankroll|peak)\s*[><=]+.*(?:drawdown|dd|worst)\s*=",
        "description": "Simulação de max drawdown com bankroll/peak",
    },
    "ev_formula_inline": {
        # Fórmula de EV inline: probability * odds - 1
        # Só matcha quando há a operação aritmética completa, não variáveis
        "pattern": r"(?i)\w*(?:prob|probability)\w*\s*\*\s*\w*(?:odds|bestOdds|best_odds)\w*\s*-\s*1\b",
        "description": "Fórmula de EV inline: model_probability × odds - 1",
    },
    "edge_formula_inline": {
        # Edge = (model_prob - fair_prob) / fair_prob (relative edge)
        "pattern": r"(?i)\(\s*\w*(?:prob|probability)\w*\s*-\s*\w*(?:fairProb|fair_prob)\w*\s*\)\s*/\s*\w*(?:fairProb|fair_prob)\w*",
        "description": "Fórmula de Edge inline: (model_prob - fair_prob) / fair_prob",
    },
}

# Diretórios para auditar
AUDIT_DIRS = [
    WEB_APP_DIR / "src",
    UTILS_DIR / "src",
]


def _find_ts_files(dirs: list[Path]) -> list[Path]:
    """Encontra todos os arquivos .ts/.tsx nos diretórios especificados."""
    files = []
    for d in dirs:
        if d.exists():
            for ext in ("*.ts", "*.tsx"):
                files.extend(d.rglob(ext))
    # Excluir node_modules, arquivos de teste, e arquivos .d.ts
    return [
        f for f in files
        if "node_modules" not in str(f)
        and ".test." not in f.name
        and not f.name.endswith(".d.ts")
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

    # Ignorar linhas que são comentários (// ou /* */)
    # Para simplificar, verificamos se o match está em uma linha de comentário
    lines = content.split("\n")
    comment_line_nos = set()
    in_block_comment = False
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if in_block_comment:
            comment_line_nos.add(i)
            if "*/" in stripped:
                in_block_comment = False
            continue
        if stripped.startswith("//"):
            comment_line_nos.add(i)
            continue
        if stripped.startswith("/*"):
            comment_line_nos.add(i)
            if "*/" not in stripped:
                in_block_comment = True
            continue

    for pattern_name, config in patterns.items():
        matches = list(re.finditer(config["pattern"], content))
        if matches:
            # Verificar se os matches estão em código, não em comentários
            code_matches = []
            for m in matches:
                line_no = content[:m.start()].count("\n") + 1
                if line_no not in comment_line_nos:
                    code_matches.append(line_no)

            if code_matches:
                findings.append({
                    "file": str(filepath.relative_to(MONOREPO_ROOT)),
                    "pattern": pattern_name,
                    "description": config["description"],
                    "lines": code_matches[:5],  # máximo 5 ocorrências
                    "count": len(code_matches),
                })

    return findings


class TestConvergenciaPyTS:
    """Testes de convergência Python/TypeScript.

    Guardrail que impede reintrodução de cálculos quantitativos no TS.
    Python é a única fonte oficial — 0 findings é o critério de aprovação.
    """

    def test_ts_files_exist(self):
        """Verifica que os diretórios TS existem para serem auditados."""
        has_ts = any(d.exists() for d in AUDIT_DIRS)
        if not has_ts:
            pytest.skip("Diretórios TypeScript não encontrados no monorepo")

    def test_zero_forbidden_quantitative_implementations(self):
        """GUARDRAIL PRINCIPAL: zero implementações quantitativas no TS.

        Este teste FAZ FAIL se qualquer padrão de cálculo quantitativo for
        detectado nos arquivos TypeScript. Python é a única fonte.

        Se este teste falhar, a implementação quantitativa deve ser REMOVIDA
        do TS e o valor deve vir da API/banco Python.
        """
        ts_files = _find_ts_files(AUDIT_DIRS)

        if not ts_files:
            pytest.skip("Nenhum arquivo TS encontrado")

        all_findings = []
        for f in ts_files:
            findings = _scan_file_for_patterns(f, FORBIDDEN_PATTERNS)
            all_findings.extend(findings)

        if all_findings:
            msg = (
                f"\n{'='*60}\n"
                "FALHA: Implementações quantitativas detectadas no TypeScript!\n"
                "Python DEVE ser a única fonte de cálculos quantitativos.\n"
                f"{'='*60}\n\n"
                f"Total de findings: {len(all_findings)}\n\n"
            )
            for f in all_findings:
                msg += (
                    f"  ❌ {f['file']}\n"
                    f"     Padrão: {f['pattern']}\n"
                    f"     {f['description']}\n"
                    f"     Linhas: {f['lines']}\n\n"
                )
            msg += (
                "Ação: remover cálculos do TS e consumir via API Python.\n"
                "Ver: PYTHON_TS_CONVERGENCE_REPORT.md\n"
            )
            pytest.fail(msg)

    def test_no_vig_removal_in_any_ts_file(self):
        """Nenhum arquivo TS deve conter definição de função de vig removal."""
        ts_files = _find_ts_files(AUDIT_DIRS)
        if not ts_files:
            pytest.skip("Nenhum arquivo TS encontrado")

        vig_files = []
        for f in ts_files:
            try:
                content = f.read_text()
                # Detecta definições de funções de vig removal (não simples menções)
                if re.search(
                    r"function\s+(removeVig|removVig|removeVigShin|removeVigPower|removeVigMultiplicative)\s*\(",
                    content,
                ):
                    vig_files.append(str(f.relative_to(MONOREPO_ROOT)))
            except Exception:
                pass

        assert not vig_files, (
            f"Funções de remoção de vig encontradas em: {vig_files}. "
            "Remoção de vig deve ser feita exclusivamente pelo Python."
        )

    def test_no_shin_implementation_in_tsx(self):
        """Componentes de display (.tsx) não devem implementar Shin."""
        tsx_files = []
        for d in AUDIT_DIRS:
            if d.exists():
                tsx_files.extend(d.rglob("*.tsx"))
        tsx_files = [f for f in tsx_files if "node_modules" not in str(f)]

        shin_in_tsx = []
        for f in tsx_files:
            try:
                content = f.read_text()
                if re.search(
                    r"(?i)(shinMethod|shin_method|shinSolver|computeShin)\s*[\(=]",
                    content,
                ):
                    shin_in_tsx.append(str(f.relative_to(MONOREPO_ROOT)))
            except Exception:
                pass

        assert not shin_in_tsx, (
            f"Implementação de Shin encontrada em componentes: {shin_in_tsx}. "
            "Fair probability deve vir exclusivamente da API Python."
        )

    def test_no_metric_calculations_in_api_routes(self):
        """API routes do Next.js não devem calcular métricas quantitativas.

        Métricas como Brier Score, Log Loss, ECE, Drawdown devem vir
        exclusivamente do Python Engine.
        """
        api_dir = WEB_APP_DIR / "src" / "app" / "api"
        if not api_dir.exists():
            pytest.skip("Diretório de API routes não encontrado")

        route_files = list(api_dir.rglob("route.ts"))
        route_files = [f for f in route_files if "node_modules" not in str(f)]

        metric_patterns = {
            "brier_formula": FORBIDDEN_PATTERNS["brier_formula"],
            "log_loss_formula": FORBIDDEN_PATTERNS["log_loss_formula"],
            "ece_binning": FORBIDDEN_PATTERNS["ece_binning"],
            "drawdown_simulation": FORBIDDEN_PATTERNS["drawdown_simulation"],
        }

        all_findings = []
        for f in route_files:
            findings = _scan_file_for_patterns(f, metric_patterns)
            all_findings.extend(findings)

        assert not all_findings, (
            "Cálculos de métricas detectados em API routes:\n"
            + "\n".join(
                f"  - {f['file']} ({f['pattern']}): {f['description']} [linhas {f['lines']}]"
                for f in all_findings
            )
            + "\nMétricas devem vir do Python Engine."
        )

    def test_odds_ts_no_quantitative_exports(self):
        """O módulo odds.ts não deve exportar funções de cálculo quantitativo.

        Funções permitidas: decimalToImplied, impliedToDecimal,
        decimalToAmerican, americanToDecimal, decimalToFractional.

        Tudo mais (vig removal, overround, fair probs) deve ter sido removido.
        """
        odds_file = UTILS_DIR / "src" / "odds.ts"
        if not odds_file.exists():
            pytest.skip("odds.ts não encontrado")

        content = odds_file.read_text()

        forbidden_exports = [
            "calculateOverround",
            "removVig",
            "removeVigMultiplicative",
            "removeVigPower",
            "removeVigShin",
            "removeVig",
            "fairProbabilities",
            "fairOdds",
            "VigRemovalMethod",
        ]

        found = []
        for name in forbidden_exports:
            # Detecta export function/const/type
            if re.search(rf"export\s+(?:function|const|type|interface)\s+{name}\b", content):
                found.append(name)

        assert not found, (
            f"odds.ts ainda exporta funções/tipos quantitativos: {found}. "
            "Apenas conversões de formato devem estar no TS."
        )

    def test_convergence_summary(self):
        """Gera sumário da auditoria de convergência Py/TS."""
        ts_files = _find_ts_files(AUDIT_DIRS)

        if not ts_files:
            pytest.skip("Nenhum arquivo TS encontrado")

        all_findings = []
        for f in ts_files:
            findings = _scan_file_for_patterns(f, FORBIDDEN_PATTERNS)
            all_findings.extend(findings)

        print(f"\n{'='*60}")
        print("CONVERGÊNCIA PY/TS — SUMÁRIO DE AUDITORIA")
        print(f"{'='*60}")
        print(f"Arquivos TS analisados: {len(ts_files)}")
        print(f"Findings proibidos: {len(all_findings)}")
        print()

        if all_findings:
            for f in all_findings:
                print(f"  ❌ {f['file']}")
                print(f"     {f['description']} (linhas {f['lines']})")
            print()
            print("VEREDICTO: ❌ FAIL — Cálculos quantitativos no TS")
        else:
            print("  ✅ Zero implementações quantitativas detectadas no TS")
            print()
            print("VEREDICTO: ✅ PASS — Python é a única fonte quantitativa")

        print()
        print("Fonte canônica: Python Engine (betedge/services/engine)")
        print("TS consome valores via API/banco de dados.")
        print(f"{'='*60}")
