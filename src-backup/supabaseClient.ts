// Supabase Client export
import { supabase } from './lib/supabase';
import { createClient } from '@supabase/supabase-js';

// Fallback to avoid null reference if .env is still being populated
const client = supabase || createClient(
  import.meta.env.VITE_SUPABASE_2_URL || import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co',
  import.meta.env.VITE_SUPABASE_2_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder'
);

export { client as supabase };
export default client;
