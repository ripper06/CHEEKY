import { createBrowserClient } from "@supabase/ssr"

let browserClient: ReturnType<typeof createBrowserClient> | null = null

export function getSupabaseBrowser() {
  if (browserClient) return browserClient
  // These are provided automatically by the Supabase integration.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey)
  return browserClient
}
