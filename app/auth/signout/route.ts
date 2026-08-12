import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  const response = NextResponse.redirect(new URL(safeNext(url.searchParams.get("next")), url.origin));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function safeNext(value: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
