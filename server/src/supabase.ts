import dotenv from 'dotenv';
dotenv.config();

import WebSocket from 'ws';
if (typeof globalThis.WebSocket === 'undefined') {
  // @ts-ignore
  globalThis.WebSocket = WebSocket;
}

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

export let supabase: SupabaseClient | null = null;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    console.log('⚡ [Supabase] Conectado com sucesso ao Supabase!');
  } catch (err: any) {
    console.error('❌ [Supabase] Erro ao inicializar cliente:', err?.message || err);
  }
} else {
  console.warn(
    'ℹ️ [Supabase] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas. Operando em modo de memória local (fallback).'
  );
}

export function isSupabaseConfigured(): boolean {
  return supabase !== null;
}
