"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "@/components/brand";
import { createRoomCode, isRoomCode } from "@/lib/domain";

export default function SetupPage() {
  const [roomCode, setRoomCode] = useState("");
  const [origin, setOrigin] = useState("");
  const [joinCode, setJoinCode] = useState("");

  useEffect(() => {
    // These values are intentionally initialized from browser-only storage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
    const existing = window.localStorage.getItem("pawly-room");
    setRoomCode(existing && isRoomCode(existing) ? existing : createRoomCode());
  }, []);

  useEffect(() => {
    if (roomCode) window.localStorage.setItem("pawly-room", roomCode);
  }, [roomCode]);

  const cameraUrl = `${origin}/camera?room=${roomCode}`;
  const watchUrl = `${origin}/watch?room=${roomCode}`;

  return (
    <main className="app-shell">
      <nav className="nav shell"><Brand /><Link className="text-link" href="/">About Pawly</Link></nav>
      <section className="setup-wrap shell">
        <div className="setup-intro"><span className="eyebrow">Private beta setup</span><h1>One room.<br />Two screens.</h1><p>Your iPad becomes the camera. Your phone becomes the quiet dashboard. The 12-character room key is the only way into this beta room—treat it like a password.</p></div>
        <div className="setup-panel">
          <div className="setup-step"><span>1</span><div><h2>Open camera mode on the iPad</h2><p>Use Safari, allow camera and microphone, then keep the page visible.</p><div className="room-code">{roomCode || "••••••••••••"}</div><div className="button-row"><a className="button button-primary" href={cameraUrl}>Open camera on this device</a><button className="button button-ghost" onClick={() => navigator.clipboard.writeText(cameraUrl)}>Copy iPad link</button></div></div></div>
          <div className="divider" />
          <div className="setup-step"><span>2</span><div><h2>Watch from your phone</h2><p>Open the private link on another device, or enter an existing room key.</p><div className="button-row"><a className="button button-primary" href={watchUrl}>Watch this room</a><button className="button button-ghost" onClick={() => navigator.clipboard.writeText(watchUrl)}>Copy owner link</button></div><label className="join-field"><span>Join another room</span><div><input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 12))} placeholder="12-character key" /><a aria-disabled={!isRoomCode(joinCode)} className={`button button-dark ${!isRoomCode(joinCode) ? "disabled" : ""}`} href={isRoomCode(joinCode) ? `/watch?room=${joinCode}` : undefined}>Join</a></div></label></div></div>
        </div>
        <p className="beta-warning"><strong>iPad note:</strong> keep the iPad plugged in and do not press its lock button. Pawly automatically switches to a nearly black standby screen while the camera stays active; tap it—or use “Wake iPad display” from your phone—to show the camera again.</p>
      </section>
    </main>
  );
}
