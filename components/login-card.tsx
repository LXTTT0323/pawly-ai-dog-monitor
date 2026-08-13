"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

export function LoginCard({ configured, nextPath, initialError = "" }: { configured: boolean; nextPath: string; initialError?: string }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setError("");
  }

  async function authenticate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured || !email.trim() || password.length < 8) return;

    setBusy(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const credentials = { email: email.trim().toLowerCase(), password };
      const result = mode === "signup"
        ? await supabase.auth.signUp(credentials)
        : await supabase.auth.signInWithPassword(credentials);

      if (result.error) throw result.error;
      if (!result.data.session) {
        throw new Error("Your account was created, but email confirmation is still required. Please check your inbox.");
      }

      window.location.assign(nextPath);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "We could not sign you in.";
      setError(friendlyAuthError(message, mode));
      setBusy(false);
    }
  }

  return <div className="login-card">
    <div className="login-lock" aria-hidden="true">P</div>
    <span className="eyebrow">Your private Pawly account</span>
    <h1>{mode === "signin" ? "Welcome home." : "Create your account."}</h1>
    <p>{mode === "signin" ? "Sign in to see your pets, trusted cameras, and private room." : "Keep your pets and camera devices together in one private Pawly account."}</p>

    {!configured ? <div className="login-notice" role="status"><strong>Account sign-in is ready in the app.</strong><span>Connect the Supabase project keys to turn it on for pawlycam.com.</span></div> : <>
      <div className="login-mode" role="tablist" aria-label="Account access">
        <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "active" : ""} onClick={() => switchMode("signin")}>Sign in</button>
        <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "active" : ""} onClick={() => switchMode("signup")}>Create account</button>
      </div>
      <form className="login-form" onSubmit={authenticate}>
        <label htmlFor="pawly-email">Email address</label>
        <input id="pawly-email" type="email" autoComplete="email" inputMode="email" required placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
        <label htmlFor="pawly-password">Password</label>
        <div className="password-field">
          <input id="pawly-password" type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required placeholder="At least 8 characters" value={password} onChange={(event) => setPassword(event.target.value)} />
          <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? "Hide" : "Show"}</button>
        </div>
        <button className="button button-primary" type="submit" disabled={busy || password.length < 8}>{busy ? (mode === "signin" ? "Signing in..." : "Creating account...") : (mode === "signin" ? "Sign in" : "Create account")}</button>
      </form>
    </>}
    {error && <p className="error-text" role="alert">{error}</p>}
    <small>No email-link wait or daily pairing. Your session stays securely saved on this device, and camera connections are encrypted in transit.</small>
  </div>;
}

function friendlyAuthError(message: string, mode: Mode) {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) return "That email and password do not match. Try again or create a new account.";
  if (normalized.includes("user already registered")) return "An account already exists for this email. Choose Sign in instead.";
  if (normalized.includes("password should be")) return "Use a password with at least 8 characters.";
  if (normalized.includes("rate limit")) return "Too many attempts. Please wait a moment and try again.";
  if (mode === "signup" && normalized.includes("email confirmation")) return "Your account was created. Check your email once to confirm it, then sign in here.";
  return message;
}
