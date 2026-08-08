export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (origin === new URL(request.url).origin) return;
  const allowedOrigins = (process.env.PAWLY_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (allowedOrigins.includes(origin)) return;
  throw new SecurityError("Cross-site request blocked");
}

export class SecurityError extends Error {
  constructor(message: string, public status = 403) {
    super(message);
  }
}

export function noStoreHeaders() {
  return { "Cache-Control": "no-store, max-age=0", "Pragma": "no-cache" };
}
