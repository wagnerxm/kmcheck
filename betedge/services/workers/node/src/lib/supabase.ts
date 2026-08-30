/**
 * Cliente Supabase para workers — usa service_role key (acesso total, sem RLS).
 *
 * Este cliente é singleton e reutilizado em todos os jobs. Como workers
 * operam em background sem contexto de usuário, precisam do service role
 * para inserir odds_history, atualizar eventos, etc.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';

// Node 20 não tem WebSocket nativo — polyfill global necessário para que
// o @supabase/supabase-js não falhe ao tentar abrir conexão Realtime.
// Usa createRequire para evitar problemas de resolução de tipos com ESM.
import { createRequire } from 'node:module';
if (typeof globalThis.WebSocket === 'undefined') {
  const _require = createRequire(import.meta.url);
  const WS = _require('ws');
  Object.defineProperty(globalThis, 'WebSocket', { value: WS });
}

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      // Workers não precisam de Realtime — desabilitar para evitar conexões
      // WebSocket desnecessárias em background.
      realtime: { params: { eventsPerSecond: 0 } },
    });
  }
  return _client;
}
