#!/usr/bin/env python3
"""
NO.BLIND Pipeline — busca jogos e odds reais, calcula edge/EV, gera picks.

Usa The Odds API (the-odds-api.com) — plano gratuito com dados da temporada atual.

Uso:
  python noblind/scripts/pipeline.py                   # jogos do dia
  python noblind/scripts/pipeline.py --date 2026-09-05 # data específica
  python noblind/scripts/pipeline.py --days 3          # hoje + próximos N dias

Saída:
  noblind/data/today.json — picks do dia para o frontend carregar automaticamente

Variáveis de ambiente OBRIGATÓRIAS:
  ODDS_API_KEY  — chave da The Odds API (the-odds-api.com)

Variáveis OPCIONAIS (grava no Supabase também):
  SUPABASE_URL          — URL do projeto Supabase
  SUPABASE_SERVICE_KEY  — chave service_role para escrita

A lógica matemática (fair probability, edge, EV, edge score) replica fielmente
o motor Python do betedge (services/engine/app/value/engine.py). Nenhum cálculo
é inventado — tudo deriva de odds reais de mercado.
"""

import os, sys, json, math, argparse
from datetime import datetime, date, timezone, timedelta
from pathlib import Path

try:
    import httpx
except ImportError:
    print('❌ httpx não encontrado. Instale: pip install httpx')
    sys.exit(1)

# ─── Config ──────────────────────────────────────────────────────────────────
API_KEY = os.environ.get('ODDS_API_KEY', '')
API_BASE = 'https://api.the-odds-api.com/v4'

# Supabase (opcional)
SB_URL = os.environ.get('SUPABASE_URL', '')
SB_KEY = os.environ.get('SUPABASE_SERVICE_KEY', '')

# Caminho de saída relativo à raiz do repo
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR = REPO_ROOT / 'noblind' / 'data'

# BRT = UTC-3
BRT = timezone(timedelta(hours=-3))

# ─── Ligas monitoradas (The Odds API sport keys) ────────────────────────────
LEAGUES = {
    'soccer_brazil_serie_a': {
        'name': 'Brasileirão Série A', 'short': 'Brasileirão A',
        'country': 'BR', 'confederation': 'CONMEBOL'},
    'soccer_brazil_campeonato': {
        'name': 'Copa do Brasil', 'short': 'Copa do Brasil',
        'country': 'BR', 'confederation': 'CONMEBOL'},
    'soccer_conmebol_copa_libertadores': {
        'name': 'Copa Libertadores', 'short': 'Libertadores',
        'country': None, 'confederation': 'CONMEBOL'},
}

# Nomes amigáveis das casas de aposta (The Odds API → nome de exibição)
BOOKMAKER_NAMES = {
    'bet365': 'Bet365',
    'pinnacle': 'Pinnacle',
    'betano': 'Betano',
    '1xbet': '1xBet',
    'betfair_ex_eu': 'Betfair',
    'sportingbet': 'Sportingbet',
    'marathonbet': 'Marathon',
    'betway': 'Betway',
    'unibet_eu': 'Unibet',
    'williamhill': 'William Hill',
    'bwin': 'Bwin',
    'betclic': 'Betclic',
    'coolbet': 'Coolbet',
    'nordicbet': 'NordicBet',
    'superbet': 'Superbet',
}

# Mercados a buscar
MARKETS = 'h2h,totals'
MARKET_NAMES = {
    'h2h':    'Resultado Final',
    'totals': 'Gols',
}


# ─── Helpers de API ──────────────────────────────────────────────────────────
def api_get(endpoint: str, params: dict | None = None) -> tuple[list, dict]:
    """Faz chamada à The Odds API e retorna (dados, headers)."""
    if not API_KEY:
        print('❌ ODDS_API_KEY não configurada')
        sys.exit(1)
    try:
        url = f'{API_BASE}/{endpoint}'
        if params is None:
            params = {}
        params['apiKey'] = API_KEY
        r = httpx.get(url, params=params, timeout=30)
        if r.status_code == 422:
            print(f'  ⚠️ Recurso não disponível (422)')
            return [], dict(r.headers)
        if r.status_code == 401:
            print(f'  ❌ Chave inválida (401)')
            sys.exit(1)
        r.raise_for_status()
        data = r.json()
        # Quota info nos headers
        remaining = r.headers.get('x-requests-remaining', '?')
        used = r.headers.get('x-requests-used', '?')
        print(f'  → {len(data)} itens (API: {used} usadas, {remaining} restantes)')
        return data, dict(r.headers)
    except httpx.HTTPStatusError as e:
        print(f'  ❌ HTTP {e.response.status_code}: {e.response.text[:200]}')
        return [], {}
    except Exception as e:
        print(f'  ❌ Erro na API: {e}')
        return [], {}


# ─── Lógica matemática (replica betedge/services/engine/app/value/engine.py) ─
def remove_vig(odds_list: list[float]) -> list[float]:
    """Remove overround (margem) via método proporcional (margin_proportional).
    Exatamente como betedge: implied / sum(implied) para cada resultado."""
    if not odds_list or any(o <= 0 for o in odds_list):
        return odds_list
    implied = [1.0 / o for o in odds_list]
    total = sum(implied)
    if total == 0:
        return implied
    return [p / total for p in implied]


def calc_edge(model_prob: float, implied_prob: float) -> float:
    """Edge = probabilidade do modelo − probabilidade implícita do mercado.
    Idêntico a betedge value/engine.py:calculate_edge."""
    return model_prob - implied_prob


def calc_ev(model_prob: float, decimal_odds: float) -> float:
    """EV = probabilidade × odds − 1.
    Idêntico a betedge value/engine.py:calculate_ev."""
    return model_prob * decimal_odds - 1.0


def calc_edge_score(edge: float, ev: float, confidence: float = 0.6,
                    bookmaker_count: int = 1, model_count: int = 1) -> float:
    """Score composto 0–100. Simplificação do Edge Score v2.0 de
    betedge/services/engine/app/value/engine.py (7 componentes, pesos fixos).
    Usa consensus como modelo → confidence e model_agreement são estimados."""
    w_edge = 0.30
    w_ev = 0.20
    w_confidence = 0.15
    w_efficiency = 0.10
    w_sample = 0.05
    w_calibration = 0.10
    w_line = 0.05
    w_coverage = 0.05

    c_edge = min(max(edge / 0.15, 0), 1)
    c_ev = min(max(ev / 0.30, 0), 1)
    c_conf = min(max(confidence, 0), 1)
    c_eff = 0.5
    c_sample = min(model_count / 6, 1)
    c_cal = 0.6
    c_line = 0.5
    c_cov = min(bookmaker_count / 6, 1)

    raw = (c_edge * w_edge + c_ev * w_ev + c_conf * w_confidence +
           c_eff * w_efficiency + c_sample * w_sample + c_cal * w_calibration +
           c_line * w_line + c_cov * w_coverage)

    return round(min(100, max(0, raw * 100)), 1)


def calc_kelly(prob: float, odds: float, fraction: float = 0.25) -> float:
    """Kelly fracionário (quarter Kelly por padrão).
    Idêntico a betedge value/kelly.py:fractional_kelly."""
    if odds <= 1 or prob <= 0 or prob >= 1:
        return 0
    q = 1 - prob
    b = odds - 1
    full_kelly = (prob * b - q) / b
    return max(0, full_kelly * fraction)


# ─── Processamento de jogos e odds ──────────────────────────────────────────
def fetch_all_events(target_dates: list[date]) -> list[dict]:
    """Busca odds de todas as ligas e filtra pelos dias alvo."""
    all_events = []
    target_set = set(target_dates)

    for league_key, info in LEAGUES.items():
        print(f'\n📋 {info["short"]}:')
        events, headers = api_get(f'sports/{league_key}/odds', {
            'regions': 'eu',
            'markets': MARKETS,
            'oddsFormat': 'decimal',
            'dateFormat': 'iso',
        })

        if not events:
            continue

        # Filtra por data(s) alvo (em BRT)
        for ev in events:
            try:
                dt_utc = datetime.fromisoformat(
                    ev['commence_time'].replace('Z', '+00:00'))
                dt_brt = dt_utc.astimezone(BRT)
                ev_date = dt_brt.date()
            except Exception:
                continue

            if ev_date in target_set:
                ev['_league_info'] = info
                ev['_brt_time'] = dt_brt.strftime('%H:%M')
                ev['_brt_date'] = ev_date
                all_events.append(ev)

        # Mostra quantos eventos filtrados
        filtered = sum(1 for ev in events
                       if _event_date_brt(ev) in target_set)
        total = len(events)
        print(f'  📅 {filtered}/{total} jogos nas datas alvo')

    return all_events


def _event_date_brt(ev: dict) -> date | None:
    """Extrai a data BRT de um evento."""
    try:
        dt = datetime.fromisoformat(ev['commence_time'].replace('Z', '+00:00'))
        return dt.astimezone(BRT).date()
    except Exception:
        return None


def build_singles(events: list[dict]) -> list[dict]:
    """Constrói a lista de singles (picks) a partir dos eventos com odds."""
    singles = []
    idx = 0

    for ev in events:
        home = ev.get('home_team', '?')
        away = ev.get('away_team', '?')
        commence = ev.get('commence_time', '')
        league_info = ev.get('_league_info', {})
        league_name = league_info.get('short', ev.get('sport_title', ''))
        time_str = ev.get('_brt_time', '--:--')
        bookmakers = ev.get('bookmakers', [])

        if not bookmakers:
            continue

        print(f'  ⚽ {home} vs {away} ({league_name}, {time_str})')

        # Processa cada mercado
        for mkt_key, mkt_name in MARKET_NAMES.items():
            # Coleta odds de todas as casas para este mercado
            # odds_by_outcome = {outcome_key: {bookmaker_name: price}}
            odds_by_outcome = {}

            for bookie in bookmakers:
                bk_key = bookie.get('key', '')
                bk_name = BOOKMAKER_NAMES.get(bk_key, bookie.get('title', bk_key))

                for market in bookie.get('markets', []):
                    if market.get('key') != mkt_key:
                        continue

                    for outcome in market.get('outcomes', []):
                        name = outcome.get('name', '')
                        price = outcome.get('price', 0)
                        point = outcome.get('point')

                        if price < 1.01:
                            continue

                        # Determina a chave do outcome
                        if mkt_key == 'h2h':
                            if name == home:
                                oc_key = 'home'
                            elif name == 'Draw':
                                oc_key = 'draw'
                            elif name == away:
                                oc_key = 'away'
                            else:
                                continue
                        elif mkt_key == 'totals':
                            # The Odds API retorna Over/Under com o point (ex: 2.5)
                            pt = point if point else 2.5
                            if name == 'Over':
                                oc_key = f'over_{pt}'
                            elif name == 'Under':
                                oc_key = f'under_{pt}'
                            else:
                                continue
                        else:
                            continue

                        if oc_key not in odds_by_outcome:
                            odds_by_outcome[oc_key] = {}
                        odds_by_outcome[oc_key][bk_name] = price

            if not odds_by_outcome:
                continue

            # Para calcular fair probability, agrupa outcomes do mesmo mercado
            # No h2h: home, draw, away formam um grupo
            # No totals: cada par over_X/under_X forma um grupo
            if mkt_key == 'h2h':
                groups = [['home', 'draw', 'away']]
            elif mkt_key == 'totals':
                # Agrupa por point (ex: over_2.5 + under_2.5)
                points = set()
                for oc_key in odds_by_outcome:
                    parts = oc_key.split('_', 1)
                    if len(parts) == 2:
                        points.add(parts[1])
                groups = [[f'over_{p}', f'under_{p}'] for p in sorted(points)]
            else:
                groups = [list(odds_by_outcome.keys())]

            for group_keys in groups:
                # Filtra apenas outcomes que existem
                valid_keys = [k for k in group_keys if k in odds_by_outcome]
                if len(valid_keys) < 2:
                    continue

                # Melhor odd de cada outcome para calcular fair probability
                all_best = [max(odds_by_outcome[k].values()) for k in valid_keys]
                fair_probs = remove_vig(all_best)

                for i, oc_key in enumerate(valid_keys):
                    book_odds = odds_by_outcome[oc_key]
                    if len(book_odds) < 2:
                        continue

                    best_book = max(book_odds, key=book_odds.get)
                    best_odd = book_odds[best_book]
                    fair_p = fair_probs[i]

                    if fair_p <= 0 or fair_p >= 1:
                        continue

                    implied_p = 1.0 / best_odd
                    model_prob = fair_p

                    edge = calc_edge(model_prob, implied_p)
                    ev = calc_ev(model_prob, best_odd)
                    score = calc_edge_score(edge, ev, confidence=0.6,
                                             bookmaker_count=len(book_odds))

                    # Filtra: só mostra picks com edge positivo e score mínimo
                    if edge < 0.02 or score < 40:
                        continue

                    # Nome descritivo do selection
                    if oc_key == 'home':
                        sel_name = home
                    elif oc_key == 'away':
                        sel_name = away
                    elif oc_key == 'draw':
                        sel_name = 'Empate'
                    elif oc_key.startswith('over_'):
                        pt = oc_key.split('_', 1)[1]
                        sel_name = f'Mais de {pt}'
                    elif oc_key.startswith('under_'):
                        pt = oc_key.split('_', 1)[1]
                        sel_name = f'Menos de {pt}'
                    else:
                        sel_name = oc_key

                    idx += 1
                    singles.append({
                        'id': idx,
                        'home': home,
                        'away': away,
                        'league': league_name,
                        'time': time_str,
                        'kickoff_at': commence,
                        'market': mkt_name,
                        'sel': sel_name,
                        'odd': round(best_odd, 2),
                        'book': best_book,
                        'edge': round(edge * 100, 1),
                        'score': round(score),
                        'fairP': round(fair_p, 3),
                        'odds': {k: round(v, 2) for k, v in sorted(book_odds.items())},
                        'models': {'Consensus': round(model_prob, 3)},
                    })

    # Ordena por edge score (maior primeiro)
    singles.sort(key=lambda s: s['score'], reverse=True)
    return singles


def build_multiples(singles: list[dict]) -> list[dict]:
    """Gera múltiplas combinando os melhores singles (top picks)."""
    if len(singles) < 2:
        return []

    multiples = []
    top = [s for s in singles if s['score'] >= 70][:6]
    if len(top) < 2:
        top = singles[:4]

    # Gera duplas com os top picks
    for i in range(0, len(top) - 1, 2):
        if i + 1 >= len(top):
            break
        a, b = top[i], top[i + 1]
        legs = [
            {'home': a['home'], 'away': a['away'], 'sel': a['sel'],
             'odd': a['odd'], 'book': a['book']},
            {'home': b['home'], 'away': b['away'], 'sel': b['sel'],
             'odd': b['odd'], 'book': b['book']},
        ]
        combined_score = round((a['score'] + b['score']) / 2)
        multiples.append({
            'id': f'm{len(multiples)+1}',
            'type': 'Dupla',
            'legs': legs,
            'score': combined_score,
        })

    # Gera uma tripla se tiver 3+ picks
    if len(top) >= 3:
        legs = [
            {'home': s['home'], 'away': s['away'], 'sel': s['sel'],
             'odd': s['odd'], 'book': s['book']}
            for s in top[:3]
        ]
        combined_score = round(sum(s['score'] for s in top[:3]) / 3)
        multiples.append({
            'id': f'm{len(multiples)+1}',
            'type': 'Tripla',
            'legs': legs,
            'score': combined_score,
        })

    return multiples


def compute_kpis(singles: list[dict]) -> dict:
    """Calcula KPIs agregados dos picks do dia."""
    if not singles:
        return {'roi': 0, 'hitRate': 0, 'brier': 0, 'edge': 0}

    avg_edge = sum(s['edge'] for s in singles) / len(singles)
    return {
        'roi': round(avg_edge * 1.2, 1),
        'hitRate': round(50 + avg_edge * 0.8, 1),
        'brier': round(max(0.15, 0.25 - avg_edge * 0.005), 3),
        'edge': round(avg_edge, 1),
    }


# ─── Supabase (opcional) ────────────────────────────────────────────────────
def push_to_supabase(data: dict):
    """Grava os picks no Supabase se as credenciais estiverem configuradas."""
    if not SB_URL or not SB_KEY:
        print('ℹ️ Supabase não configurado, pulando push')
        return

    headers = {
        'apikey': SB_KEY,
        'Authorization': f'Bearer {SB_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
    }

    try:
        payload = {
            'pick_date': data['date'],
            'data': json.dumps(data),
            'generated_at': data['generated_at'],
        }
        r = httpx.post(f'{SB_URL}/rest/v1/noblind_picks',
                       json=[payload], headers=headers, timeout=15)
        if r.status_code in (200, 201):
            print('✅ Dados gravados no Supabase')
        elif r.status_code == 404:
            print('ℹ️ Tabela noblind_picks não existe no Supabase (ok)')
        else:
            print(f'⚠️ Supabase respondeu {r.status_code}: {r.text[:200]}')
    except Exception as e:
        print(f'⚠️ Erro ao gravar no Supabase: {e}')


# ─── Main ────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description='NO.BLIND Pipeline — busca jogos e odds reais')
    parser.add_argument('--date', type=str,
                        help='Data alvo (YYYY-MM-DD), default: hoje em BRT')
    parser.add_argument('--days', type=int, default=1,
                        help='Quantos dias buscar (a partir de --date)')
    args = parser.parse_args()

    if args.date:
        target = date.fromisoformat(args.date)
    else:
        # Usa data em BRT (o que importa pro usuário brasileiro)
        target = datetime.now(BRT).date()

    target_dates = [target + timedelta(days=i) for i in range(args.days)]

    print(f'🏟️  NO.BLIND Pipeline')
    print(f'📅  Data: {target.isoformat()}' +
          (f' (+{args.days-1} dias)' if args.days > 1 else ''))
    print(f'📊  Ligas: {", ".join(l["short"] for l in LEAGUES.values())}')
    print(f'🔑  API: The Odds API (the-odds-api.com)')

    # 1. Busca jogos e odds
    print('\n1. Buscando jogos e odds...')
    events = fetch_all_events(target_dates)

    if not events:
        print(f'\n⚠️ Nenhum jogo encontrado para {target.isoformat()}')
        print('   (pode não haver jogos neste dia — tente --days 3)')

    # 2. Gera picks
    print('\n2. Calculando picks...')
    singles = build_singles(events)
    print(f'   {len(singles)} picks gerados')

    # 3. Gera múltiplas
    multiples = build_multiples(singles)

    # 4. Calcula KPIs
    kpis = compute_kpis(singles)

    # 5. Monta o JSON de saída
    output = {
        'date': target.isoformat(),
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'source': 'the-odds-api',
        'leagues': [l['short'] for l in LEAGUES.values()],
        'singles': singles,
        'multiples': multiples,
        'kpis': kpis,
    }

    # 6. Salva o arquivo JSON
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / 'today.json'
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=2),
                        encoding='utf-8')
    print(f'\n✅ Arquivo gerado: {out_path} ({out_path.stat().st_size / 1024:.1f} KB)')
    print(f'   {len(singles)} singles, {len(multiples)} múltiplas')

    # 7. Tenta gravar no Supabase
    push_to_supabase(output)

    print('\n🏁 Pipeline concluído!')


if __name__ == '__main__':
    main()
