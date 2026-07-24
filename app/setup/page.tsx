"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "@/components/brand";
import { createRoomCode, isRoomCode } from "@/lib/domain";

type CopyTarget = "camera" | "owner" | null;

export default function SetupPage() {
  const [roomCode, setRoomCode] = useState("");
  const [origin, setOrigin] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [copied, setCopied] = useState<CopyTarget>(null);
  const [showRotateConfirm, setShowRotateConfirm] = useState(false);
  const [keyChanged, setKeyChanged] = useState(false);

  useEffect(() => {
    // Room keys intentionally live in this browser profile only.
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

  async function copyLink(target: Exclude<CopyTarget, null>, url: string) {
    await navigator.clipboard.writeText(url);
    setCopied(target);
    window.setTimeout(() => setCopied(null), 1800);
  }

  function createNewRoom() {
    let nextCode = createRoomCode();
    while (nextCode === roomCode) nextCode = createRoomCode();
    setRoomCode(nextCode);
    setShowRotateConfirm(false);
    setCopied(null);
    setKeyChanged(true);
  }

  return (
    <main className="app-shell">
      <nav className="nav shell">
        <Brand />
        <Link className="text-link" href="/">About Pawly</Link>
      </nav>

      <section className="setup-wrap shell">
        <div className="setup-intro">
          <span className="eyebrow">Private beta setup</span>
          <h1>One room.<br />Two screens.</h1>
          <p>Any spare phone, tablet, or computer becomes the dog-aware camera. Your other device becomes the quiet dashboard.</p>
          <div className="room-key-note">
            <strong>Your room key lives in this browser.</strong>
            <span>Each browser profile creates its own random key the first time. Share only the camera or owner link with devices you want in this room.</span>
          </div>
        </div>

        <div className="setup-panel">
          <div className="setup-step">
            <span>1</span>
            <div>
              <h2>Open camera mode</h2>
              <p>Use a modern browser and allow the camera. Microphone access is optional and can be changed anytime.</p>
              <div className="room-key-row">
                <div>
                  <small>Private room key</small>
                  <code className="room-code">{roomCode || "••••••••••••"}</code>
                </div>
                <button className="rotate-key-button" type="button" onClick={() => setShowRotateConfirm(true)}>New key</button>
              </div>

              {showRotateConfirm && (
                <div className="rotate-confirm" role="alert">
                  <strong>Create a different private room?</strong>
                  <p>Reopen both camera and owner links afterward. Tabs already open with the old key stay in that old room until closed.</p>
                  <div>
                    <button type="button" onClick={() => setShowRotateConfirm(false)}>Cancel</button>
                    <button className="confirm-new-key" type="button" onClick={createNewRoom}>Create new key</button>
                  </div>
                </div>
              )}

              {keyChanged && !showRotateConfirm && (
                <p className="key-changed-message" role="status">New room created. Use the updated links below on both devices.</p>
              )}

              <div className="button-row">
                <a className="button button-primary" href={cameraUrl}>Open camera on this device</a>
                <button className="button button-ghost" type="button" onClick={() => void copyLink("camera", cameraUrl)}>
                  {copied === "camera" ? "Camera link copied" : "Copy camera link"}
                </button>
              </div>
            </div>
          </div>

          <div className="divider" />

          <div className="setup-step">
            <span>2</span>
            <div>
              <h2>Watch from your other device</h2>
              <p>Open the private owner link on another device. Anyone with this link can enter the beta room, so treat it like a password.</p>
              <div className="button-row">
                <a className="button button-primary" href={watchUrl}>Watch this room</a>
                <button className="button button-ghost" type="button" onClick={() => void copyLink("owner", watchUrl)}>
                  {copied === "owner" ? "Owner link copied" : "Copy owner link"}
                </button>
              </div>

              <label className="join-field">
                <span>Join another room</span>
                <div>
                  <input
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 12))}
                    placeholder="12-character key"
                    inputMode="text"
                    autoCapitalize="characters"
                    spellCheck={false}
                  />
                  <a
                    aria-disabled={!isRoomCode(joinCode)}
                    className={`button button-dark ${!isRoomCode(joinCode) ? "disabled" : ""}`}
                    href={isRoomCode(joinCode) ? `/watch?room=${joinCode}` : undefined}
                  >
                    Join
                  </a>
                </div>
              </label>
            </div>
          </div>
        </div>

        <p className="beta-warning"><strong>Camera-device note:</strong> keep it plugged in and do not lock the screen. Pawly can switch to a nearly black standby page while monitoring stays active; tap it—or use “Wake camera display” from the dashboard—to show the preview again.</p>
      </section>
    </main>
  );
}
