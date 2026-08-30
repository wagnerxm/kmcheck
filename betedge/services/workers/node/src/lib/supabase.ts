/**
 * Cliente Supabase para workers — usa service_role key (acesso total, sem RLS).
 *
 * Este cliente é singleton e reutilizado em todos os jobs. Como workers
 * operam em background sem contexto de usuário, precisam do service role
 * para inserir odds_history, atualizar eventos, etc.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';

// Node 20 não tem WebSocket nativo — importar ws como polyfill global
// para o @supabase/supabase-js não falhar ao tentar Realtime.
import WebSocket from 'ws';
// @ts-expect-error — polyfill global necessário para Node <22
if (typeof globalThis.WebSocket === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = WebSocket;
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
