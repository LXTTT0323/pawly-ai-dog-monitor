import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const nextPath = safeNext(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const supabase = await createSupabaseServerClient();

  const result = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("The sign-in link is incomplete") };

  if (!result.error) {
    const response = NextResponse.redirect(new URL(nextPath, url.origin));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  const loginUrl = new URL("/login", url.origin);
  loginUrl.searchParams.set("next", nextPath);
  loginUrl.searchParams.set("error", "expired_link");
  return NextResponse.redirect(loginUrl);
}

function safeNext(value: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/setup";
  return value;
}
