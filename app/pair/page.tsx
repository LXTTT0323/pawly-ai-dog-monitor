"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "@/components/brand";

export default function PairPage() {
  const [state, setState] = useState<"ready" | "pairing" | "success" | "error">("ready");
  const [message, setMessage] = useState("Approve this device only if you opened the link sent by the room owner.");
  const [roomCode, setRoomCode] = useState("");
  const [token, setToken] = useState("");

  useEffect(() => {
    const pairingToken = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!pairingToken) {
      setState("error");
      setMessage("This pairing link is incomplete.");
      return;
    }
    setToken(pairingToken);
  }, []);

  async function pairThisDevice() {
    if (!token || state === "pairing") return;
    setState("pairing");
    setMessage("Securely approving this camera device…");
    const deviceName = /iPad/i.test(navigator.userAgent)
      ? "iPad camera"
      : /iPhone|Android/i.test(navigator.userAgent)
        ? "Phone camera"
        : "Browser camera";

    try {
      const response = await fetch("/api/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, deviceName }),
      });
      const data = await response.json() as { roomCode?: string; error?: string };
      if (!response.ok || !data.roomCode) throw new Error(data.error ?? "Pairing failed");
      window.history.replaceState({}, "", "/pair");
      localStorage.setItem("pawly-paired-room", data.roomCode);
      setRoomCode(data.roomCode);
      setState("success");
      setMessage("This browser is now trusted for 180 days. Open the camera below, then bookmark it or add it to your Home Screen. You will not need another pairing link tomorrow.");
    } catch (cause) {
      setState("error");
      setMessage(cause instanceof Error ? cause.message : "This pairing link could not be used.");
    }
  }

  return <main className="pair-page">
    <nav className="nav shell"><Brand /><Link className="text-link" href="/">About Pawly</Link></nav>
    <section className="pair-card">
      <span className={`pair-shield ${state}`} aria-hidden="true">●</span>
      <span className="eyebrow">{state === "success" ? "Camera approved" : state === "error" ? "Pairing unavailable" : "Secure pairing"}</span>
      <h1>{state === "success" ? "Ready to watch the room." : state === "error" ? "Ask the owner for a new link." : state === "pairing" ? "Approving this device…" : "Pair this camera device?"}</h1>
      <p>{message}</p>
      {state === "ready" && <button className="button button-primary" type="button" onClick={() => void pairThisDevice()}>Approve & pair this device</button>}
      {state === "success" && <><a className="button button-primary" href={`/camera?room=${roomCode}`}>Open camera & allow access</a><p className="privacy-footnote">Use this same camera page whenever you monitor again. A new pairing link is only needed if browser data is cleared or the owner removes this device.</p></>}
      {state === "error" && <p className="privacy-footnote">Pairing links expire after 15 minutes and can only approve one device.</p>}
      {state === "ready" && <p className="privacy-footnote">Opening or copying this page does not use the link. It is consumed only after you approve this device.</p>}
    </section>
  </main>;
}
