import { NextRequest, NextResponse } from "next/server";

// Vercel is the public landing page. Stateful and private routes always run on
// Sites, where Sign in with ChatGPT provides the verified account identity.
// This retires the old browser-wide owner key rather than maintaining two
// incompatible authentication systems.
const SITES_ORIGIN = "https://pawly-coach-beta.lxttt.chatgpt.site";
const PRIVATE_PREFIXES = ["/setup", "/watch", "/guest", "/owner-access", "/camera", "/pair"];

export function proxy(request: NextRequest) {
  if (process.env.VERCEL !== "1") return NextResponse.next();
  if (PRIVATE_PREFIXES.some((prefix) => request.nextUrl.pathname === prefix || request.nextUrl.pathname.startsWith(`${prefix}/`))) {
    const destination = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, SITES_ORIGIN);
    return NextResponse.redirect(destination, 307);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|og.png).*)"] };
