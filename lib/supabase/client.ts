"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseConfig } from "@/lib/supabase/config";

export function createSupabaseBrowserClient() {
  const { url, publishableKey } = supabaseConfig();
  return createBrowserClient(url, publishableKey);
}
