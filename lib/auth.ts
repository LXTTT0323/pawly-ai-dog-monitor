import { headers } from "next/headers";
import { redirect } from "next/navigation";

export interface PawlyUser {
  email: string;
  displayName: string;
}

const EMAIL_HEADER = "oai-authenticated-user-email";
const NAME_HEADER = "oai-authenticated-user-full-name";
const NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";

export async function getPawlyUser(): Promise<PawlyUser | null> {
  const requestHeaders = await headers();
  const email = requestHeaders.get(EMAIL_HEADER)?.trim().toLowerCase();
  if (email) {
    const encodedName = requestHeaders.get(NAME_HEADER);
    const displayName = encodedName && requestHeaders.get(NAME_ENCODING_HEADER) === "percent-encoded-utf-8"
      ? safeDecode(encodedName) ?? email
      : email;
    return { email, displayName };
  }
  const bridgeSecret = process.env.PAWLY_VERCEL_BRIDGE_SECRET;
  const suppliedBridgeSecret = requestHeaders.get("x-pawly-vercel-bridge");
  if (bridgeSecret && suppliedBridgeSecret && safeEqual(bridgeSecret, suppliedBridgeSecret)) {
    const bridgedOwner = requestHeaders.get("x-pawly-owner-id")?.trim().toLowerCase();
    if (bridgedOwner === "vercel-owner@pawly.beta") {
      return { email: bridgedOwner, displayName: "Pawly beta owner" };
    }
  }
  if (process.env.NODE_ENV !== "production") {
    const localEmail = (process.env.PAWLY_LOCAL_OWNER_EMAIL ?? "owner@pawly.local").trim().toLowerCase();
    return { email: localEmail, displayName: "Local owner" };
  }
  return null;
}

export async function requirePawlyUser(returnTo: string): Promise<PawlyUser> {
  const user = await getPawlyUser();
  if (user) return user;
  redirect(`/signin-with-chatgpt?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`);
}

export function signOutPath(returnTo = "/") {
  return `/signout-with-chatgpt?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

function safeReturnTo(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://pawly.local");
    if (url.origin !== "https://pawly.local") return "/";
    if (["/signin-with-chatgpt", "/signout-with-chatgpt", "/callback"].includes(url.pathname)) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
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
