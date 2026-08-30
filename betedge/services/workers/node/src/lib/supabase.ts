/**
 * Cliente Supabase para workers — usa service_role key (acesso total, sem RLS).
 *
 * Este cliente é singleton e reutilizado em todos os jobs. Como workers
 * operam em background sem contexto de usuário, precisam do service role
 * para inserir odds_history, atualizar eventos, etc.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return _client;
}
