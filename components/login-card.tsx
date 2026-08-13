"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginCard({ configured, nextPath, initialError = "" }: { configured: boolean; nextPath: string; initialError?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState(initialError);

  async function sendMagicLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured || !email.trim()) return;
    setStatus("sending");
    setError("");
    try {
      const callback = new URL("/auth/callback", window.location.origin);
      callback.searchParams.set("next", nextPath);
      const supabase = createSupabaseBrowserClient();
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: callback.toString(), shouldCreateUser: true },
      });
      if (authError) throw authError;
      setStatus("sent");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not send the sign-in email.");
      setStatus("idle");
    }
  }

  return <div className="login-card">
    <div className="login-lock" aria-hidden="true">P</div>
    <span className="eyebrow">Your private Pawly account</span>
    <h1>Welcome home.</h1>
    <p>Sign in to see your pets, trusted cameras, and private room from any of your devices.</p>

    {!configured ? <div className="login-notice" role="status"><strong>Email sign-in is ready in the app.</strong><span>Connect the Supabase project keys to turn it on for pawlycam.com.</span></div> : status === "sent" ? <div className="login-success" role="status"><strong>Check your email</strong><span>We sent a secure Pawly sign-in link to {email}. For this beta, open it in this same browser on this device.</span><button type="button" onClick={() => setStatus("idle")}>Use another email</button></div> : <>
      <form className="login-form" onSubmit={sendMagicLink}>
        <label htmlFor="pawly-email">Email address</label>
        <input id="pawly-email" type="email" autoComplete="email" inputMode="email" required placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
        <button className="button button-primary" type="submit" disabled={status === "sending"}>{status === "sending" ? "Sending secure link…" : "Email me a sign-in link"}</button>
      </form>
    </>}
    {error && <p className="error-text" role="alert">{error}</p>}
    <small>No password to remember. Your email link is single-use, and camera connections are encrypted in transit.</small>
  </div>;
}
