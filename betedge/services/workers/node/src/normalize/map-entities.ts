/**
 * Mapeamento de entidades externas (times, ligas, eventos) para os IDs
 * internos do BetEdge.
 *
 * Cada provedor de odds (`OddsProvider`) identifica times/ligas/eventos com
 * seus próprios IDs e grafias de nome (ex.: "Man United" vs. "Manchester
 * United" vs. "Manchester Utd"). Sem uma camada de normalização, o mesmo
 * time apareceria como entidades distintas conforme o provedor de origem,
 * quebrando tanto a agregação de odds entre casas quanto o histórico usado
 * para treinar os modelos estatísticos.
 */

/** Uma linha da tabela de mapeamento provedor -> entidade interna. */
export interface EntityMapping {
  provider: string;
  providerEntityId: string;
  /** ID interno do BetEdge (times, ligas e eventos vivem em tabelas próprias — este é o UUID correspondente). */
  internalEntityId: string;
  entityType: "team" | "league" | "event";
}

/**
 * Resolve o ID interno correspondente a uma entidade externa, consultando a
 * tabela de mapeamento persistida (Supabase/Postgres).
 *
 * TODO(fase 1): consultar a tabela `entity_mappings` por
 * `(provider, provider_entity_id, entity_type)`. Retorna `null` quando não
 * há mapeamento conhecido — o chamador decide se isso deve disparar
 * `suggestEntityMatch` (fluxo de matching automático/manual) ou apenas
 * pular o registro por ora.
 */
export async function resolveInternalEntityId(
  provider: string,
  providerEntityId: string,
  entityType: EntityMapping["entityType"],
): Promise<string | null> {
  throw new Error(
    `resolveInternalEntityId não implementado (provider=${provider}, providerEntityId=${providerEntityId}, entityType=${entityType}).`,
  );
}

/**
 * Registra um novo mapeamento provedor -> entidade interna (após matching
 * automático de alta confiança ou confirmação manual via painel admin).
 *
 * TODO(fase 1): upsert em `entity_mappings`.
 */
export async function registerEntityMapping(mapping: EntityMapping): Promise<void> {
  throw new Error(`registerEntityMapping não implementado (mapping=${JSON.stringify(mapping)}).`);
}

/**
 * Tenta encontrar automaticamente a entidade interna correspondente a um
 * nome externo não mapeado, via comparação de similaridade textual
 * (normalização de acentos/caixa + distância de edição/fuzzy match).
 *
 * TODO(fase 1/2): implementar a heurística de matching (ex.: normalizar
 * removendo sufixos comuns como "FC"/"CF", comparar via similaridade de
 * string, e só aceitar automaticamente acima de um limiar de confiança —
 * abaixo disso, encaminhar para revisão manual em vez de mapear errado).
 */
export async function suggestEntityMatch(
  providerEntityName: string,
  entityType: EntityMapping["entityType"],
): Promise<{ internalEntityId: string; confidence: number }[]> {
  throw new Error(
    `suggestEntityMatch não implementado (providerEntityName=${providerEntityName}, entityType=${entityType}).`,
  );
}
