import { config } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Carrega .env.test em dev local. Em CI as vars vêm de env nativo (GitHub secrets).
config({ path: '.env.test' });

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    'VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios. ' +
    'Copie .env.test.example para .env.test ou configure os secrets no GitHub.',
  );
}

// Service role bypassa RLS — necessário para setup/teardown de testes.
export const supabase: SupabaseClient = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
