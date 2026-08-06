import { NextRequest, NextResponse } from "next/server";

const ACCESS_COOKIE = "__Host-pawly_vercel_owner";
const OWNER_EMAIL = "vercel-owner@pawly.beta";

export async function proxy(request: NextRequest) {
  if (process.env.VERCEL !== "1") return NextResponse.next();

  const accessKey = process.env.PAWLY_VERCEL_ACCESS_KEY;
  const bridgeSecret = process.env.PAWLY_VERCEL_BRIDGE_SECRET;
  if (!accessKey || !bridgeSecret) {
    return new NextResponse("Pawly owner access is not configured.", { status: 503 });
  }

  if (request.nextUrl.pathname === "/vercel-access") {
    const suppliedKey = request.nextUrl.searchParams.get("key") ?? "";
    if (!safeEqual(accessKey, suppliedKey)) {
      return new NextResponse("This Pawly owner link is invalid.", { status: 403 });
    }
    const destination = new URL(safeReturnTo(request.nextUrl.searchParams.get("return_to")), request.url);
    const response = NextResponse.redirect(destination);
    response.cookies.set(ACCESS_COOKIE, await digest(accessKey), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 180 * 24 * 60 * 60,
    });
    return response;
  }

  const suppliedCookie = request.cookies.get(ACCESS_COOKIE)?.value ?? "";
  const isOwner = safeEqual(await digest(accessKey), suppliedCookie);
  const protectedPage = request.nextUrl.pathname === "/setup"
    || request.nextUrl.pathname === "/watch"
    || request.nextUrl.pathname === "/signin-with-chatgpt";

  if (!isOwner && protectedPage) {
    return NextResponse.redirect(new URL("/?owner_access=required", request.url));
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-pawly-vercel-bridge");
  requestHeaders.delete("x-pawly-owner-id");
  requestHeaders.delete("oai-authenticated-user-email");
  requestHeaders.delete("oai-authenticated-user-full-name");
  requestHeaders.delete("oai-authenticated-user-full-name-encoding");

  if (isOwner) {
    requestHeaders.set("x-pawly-vercel-bridge", bridgeSecret);
    requestHeaders.set("x-pawly-owner-id", OWNER_EMAIL);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|og.png).*)"],
};

function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/setup";
  try {
    const url = new URL(value, "https://pawly.local");
    if (url.origin !== "https://pawly.local") return "/setup";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/setup";
  }
}

function safeEqual(expected: string, supplied: string) {
  if (expected.length !== supplied.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return mismatch === 0;
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
