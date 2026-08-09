"use client";
import { useEffect, useState } from "react";

export function GuestRedeem({ token }: { token: string }) {
  const [message, setMessage] = useState("Confirming your private guest access…");
  useEffect(() => { void (async () => { const response = await fetch("/api/guest/redeem", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }); const data = await response.json() as { roomCode?: string; error?: string }; if (!response.ok || !data.roomCode) { setMessage(data.error ?? "This invitation is not available."); return; } window.location.replace(`/watch?room=${encodeURIComponent(data.roomCode)}&guest=1`); })(); }, [token]);
  return <main className="guest-redeem-page"><div><span className="eyebrow">Private Pawly invitation</span><h1>{message}</h1><p>You must be signed in to accept a private room invitation.</p></div></main>;
}
