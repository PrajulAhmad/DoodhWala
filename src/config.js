/**
 * DoodhWala Central Configuration
 * Reads from Vite environment variables built at compilation time.
 */
export const config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  isDev: import.meta.env.DEV
};
