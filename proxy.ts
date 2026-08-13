import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const SITES_ORIGIN = "https://pawly-coach-beta.lxttt.chatgpt.site";

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });

  const { data } = await supabase.auth.getUser();

  if (process.env.VERCEL === "1" && request.nextUrl.pathname.startsWith("/api/")) {
    return forwardApiRequest(request, data.user ?? null);
  }

  return response;
}

async function forwardApiRequest(request: NextRequest, user: { email?: string; user_metadata?: Record<string, unknown> } | null) {
  const destination = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, SITES_ORIGIN);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("host");
  requestHeaders.delete("content-length");

  const mutatingRequest = request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS";
  const browserOrigin = request.headers.get("origin");
  if (mutatingRequest && browserOrigin && browserOrigin !== request.nextUrl.origin) {
    return NextResponse.json(
      { error: "Cross-site request blocked" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  // The browser-facing origin was checked above. The private bridge is a
  // same-origin server-to-server request authenticated by its own secret.
  requestHeaders.set("origin", SITES_ORIGIN);
  requestHeaders.set("referer", `${SITES_ORIGIN}/`);

  const bridgeSecret = process.env.PAWLY_VERCEL_BRIDGE_SECRET;
  const email = user?.email?.trim().toLowerCase();
  if (bridgeSecret && email) {
    requestHeaders.set("x-pawly-vercel-bridge", bridgeSecret);
    requestHeaders.set("x-pawly-owner-id", email);
    const fullName = user?.user_metadata?.full_name;
    requestHeaders.set("x-pawly-owner-name", encodeURIComponent(typeof fullName === "string" && fullName.trim() ? fullName.trim() : email.split("@")[0]));
  }

  try {
    // Buffer the body before forwarding. Passing NextRequest.body directly can
    // fail in Vercel's proxy runtime because the stream requires duplex mode.
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
    const upstream = await fetch(destination, {
      method: request.method,
      headers: requestHeaders,
      body,
      redirect: "manual",
    });
    const upstreamHeaders = new Headers(upstream.headers);
    // fetch() transparently decodes compressed upstream responses. Forwarding
    // the old encoding/length headers makes browsers reject the decoded body.
    upstreamHeaders.delete("content-encoding");
    upstreamHeaders.delete("content-length");
    upstreamHeaders.delete("transfer-encoding");
    upstreamHeaders.set("Cache-Control", "private, no-store");
    return new NextResponse(upstream.body, { status: upstream.status, headers: upstreamHeaders });
  } catch (cause) {
    console.error("Pawly API bridge failed", cause);
    return NextResponse.json(
      { error: "Pawly could not reach its private data service. Please try again." },
      { status: 502, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
