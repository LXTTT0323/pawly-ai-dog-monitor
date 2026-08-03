"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "@/components/brand";

export default function PairPage() {
  const [state, setState] = useState<"pairing" | "success" | "error">("pairing");
  const [message, setMessage] = useState("Verifying this private pairing link…");
  const [roomCode, setRoomCode] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!token) {
      setState("error");
      setMessage("This pairing link is incomplete.");
      return;
    }
    const deviceName = /iPad/i.test(navigator.userAgent) ? "iPad camera" : /iPhone|Android/i.test(navigator.userAgent) ? "Phone camera" : "Browser camera";
    void fetch("/api/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, deviceName }),
    }).then(async (response) => {
      const data = await response.json() as { roomCode?: string; error?: string };
      window.history.replaceState({}, "", "/pair");
      if (!response.ok || !data.roomCode) throw new Error(data.error ?? "Pairing failed");
      setRoomCode(data.roomCode);
      setState("success");
      setMessage("This device is approved. Only your signed-in owner can watch it.");
    }).catch((cause) => {
      setState("error");
      setMessage(cause instanceof Error ? cause.message : "This pairing link could not be used.");
    });
  }, []);

  return <main className="pair-page">
    <nav className="nav shell"><Brand /><Link className="text-link" href="/">About Pawly</Link></nav>
    <section className="pair-card">
      <span className={`pair-shield ${state}`}>◆</span>
      <span className="eyebrow">{state === "success" ? "Camera approved" : state === "error" ? "Pairing unavailable" : "Secure pairing"}</span>
      <h1>{state === "success" ? "Ready to watch the room." : state === "error" ? "Ask the owner for a new link." : "Pairing this device…"}</h1>
      <p>{message}</p>
      {state === "success" && <a className="button button-primary" href={`/camera?room=${roomCode}`}>Open camera & allow access</a>}
      {state === "error" && <p className="privacy-footnote">Pairing links expire after five minutes and can only be used once.</p>}
    </section>
  </main>;
}
