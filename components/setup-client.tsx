"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Brand } from "@/components/brand";
import type { PawlyUser } from "@/lib/auth";

interface Device {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
}

interface RoomResponse {
  room: { code: string; createdAt: number } | null;
  devices: Device[];
}

interface PetProfile {
  id: string;
  name: string;
  species: "dog" | "cat";
  isPrimary: boolean;
}

export function SetupClient({ user }: { user: PawlyUser }) {
  const [room, setRoom] = useState<RoomResponse["room"]>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [pairing, setPairing] = useState<{ url: string; expiresAt: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [pets, setPets] = useState<PetProfile[]>([]);
  const [petName, setPetName] = useState("");
  const [petSpecies, setPetSpecies] = useState<"dog" | "cat">("dog");
  const [savingPet, setSavingPet] = useState(false);

  const loadRoom = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      let response = await fetch("/api/rooms", { cache: "no-store" });
      let data = await response.json() as RoomResponse & { error?: string };
      if (response.ok && !data.room) {
        response = await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        data = await response.json() as RoomResponse & { error?: string };
      }
      if (!response.ok || !data.room) throw new Error(data.error ?? "Could not open your room");
      setRoom(data.room);
      setDevices(data.devices ?? []);
      const profileResponse = await fetch("/api/profile", { cache: "no-store" });
      if (profileResponse.ok) {
        const profile = await profileResponse.json() as { pets?: PetProfile[] };
        setPets(profile.pets ?? []);
      }
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open your room");
      setStatus("error");
    }
  }, []);

  useEffect(() => { void loadRoom(); }, [loadRoom]);

  const watchUrl = useMemo(() => room ? `/watch?room=${room.code}` : "#", [room]);

  async function createPairing() {
    if (!room) return;
    setError("");
    const response = await fetch(`/api/rooms/${room.code}/pairing`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const data = await response.json() as { pairingUrl?: string; expiresAt?: number; error?: string };
    if (!response.ok || !data.pairingUrl || !data.expiresAt) {
      setError(data.error ?? "Could not create pairing link");
      return;
    }
    setPairing({ url: data.pairingUrl, expiresAt: data.expiresAt });
    setCopied(false);
  }

  async function copyPairing() {
    if (!pairing) return;
    await navigator.clipboard.writeText(pairing.url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function revoke(deviceId: string) {
    if (!room) return;
    setRevoking(deviceId);
    const response = await fetch(`/api/rooms/${room.code}/devices/${deviceId}`, { method: "DELETE" });
    if (response.ok) setDevices((current) => current.filter((device) => device.id !== deviceId));
    else setError((await response.json()).error ?? "Could not remove this device");
    setRevoking(null);
  }

  async function savePet() {
    if (!petName.trim()) return;
    setSavingPet(true);
    setError("");
    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: petName, species: petSpecies }),
      });
      const data = await response.json() as { pets?: PetProfile[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not save your pet");
      setPets(data.pets ?? []);
      setPetName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your pet");
    } finally {
      setSavingPet(false);
    }
  }

  return (
    <main className="app-shell">
      <nav className="nav shell">
        <Brand />
        <div className="security-account">
          <span>{user.displayName}</span>
          <a className="text-link" href="/signout-with-chatgpt?return_to=/">Sign out</a>
        </div>
      </nav>

      <section className="setup-wrap shell">
        <div className="setup-intro">
          <span className="eyebrow">Private room setup</span>
          <h1>Pair once.<br />Watch privately.</h1>
          <p>Your owner account controls who can enter. A room link alone can no longer open the camera.</p>
          <div className="security-promise">
            <strong>Protected by default</strong>
            <span>End-to-end encrypted live video</span>
            <span>One-time camera pairing</span>
            <span>Revoke any device instantly</span>
          </div>
        </div>

        <div className="setup-panel secure-setup-panel">
          {status === "loading" && <div className="secure-loading">Preparing your private room…</div>}
          {status === "error" && <div className="secure-error" role="alert"><strong>Room unavailable</strong><p>{error}</p><button className="button button-dark" onClick={() => void loadRoom()}>Try again</button></div>}

          {status === "ready" && room && <>
            <div className="pet-profile-card">
              <div className="pet-profile-heading">
                <span className="eyebrow">Your pets</span>
                <h2>{pets.length ? "Pawly knows who to watch" : "Who should Pawly watch?"}</h2>
                <p>{pets.length ? "Pawly will use species-aware detection and wording in your live room." : "Add a dog or cat now. You can add more pets later."}</p>
              </div>
              {pets.length > 0 && <div className="pet-profile-list" aria-label="Saved pets">
                {pets.map((pet) => <span key={pet.id}><b aria-hidden="true">{pet.species === "cat" ? "◉" : "●"}</b><strong>{pet.name}</strong><small>{pet.species}</small></span>)}
              </div>}
              <div className="pet-profile-form">
                <input aria-label="Pet name" placeholder="Pet name" value={petName} onChange={(event) => setPetName(event.target.value)} maxLength={40} />
                <div className="pet-species-toggle" role="group" aria-label="Pet species">
                  <button type="button" className={petSpecies === "dog" ? "selected" : ""} aria-pressed={petSpecies === "dog"} onClick={() => setPetSpecies("dog")}>Dog</button>
                  <button type="button" className={petSpecies === "cat" ? "selected" : ""} aria-pressed={petSpecies === "cat"} onClick={() => setPetSpecies("cat")}>Cat</button>
                </div>
                <button type="button" onClick={() => void savePet()} disabled={!petName.trim() || savingPet}>{savingPet ? "Saving…" : "Add pet"}</button>
              </div>
            </div>

            <div className="divider" />

            <div className="setup-step">
              <span>1</span>
              <div>
                <h2>{devices.length ? "Add another camera device" : "Pair a camera device"}</h2>
                <p>Create a private link, then open it on any iPad, phone, or computer you want to use as a camera. Each link lasts 15 minutes and approves one device.</p>
                <button className="button button-primary" type="button" onClick={() => void createPairing()}>{devices.length ? "Create link for another camera" : "Create private pairing link"}</button>
                {pairing && <div className="pairing-card" role="status">
                  <div><strong>Pairing link ready</strong><span>Expires {new Date(pairing.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></div>
                  <div className="button-row">
                    <button className="button button-dark" onClick={() => void copyPairing()}>{copied ? "Link copied" : "Copy link"}</button>
                    <a className="button button-ghost" href={pairing.url}>Open pairing page</a>
                  </div>
                  <small>Copying or opening the link does not consume it. The camera device must tap “Approve & pair” before the link is used.</small>
                </div>}
              </div>
            </div>

            <div className="divider" />

            <div className="setup-step">
              <span>2</span>
              <div>
                <h2>Watch as the owner</h2>
                <p>You will be asked to sign in on every new browser. Pawly verifies room ownership before it connects.</p>
                <Link className="button button-primary" href={watchUrl}>Open my room</Link>
              </div>
            </div>

            <div className="divider" />

            <div className="setup-step">
              <span>3</span>
              <div className="paired-devices-section">
                <h2>Camera devices ({devices.length})</h2>
                {devices.length === 0 ? <p>No camera is paired yet.</p> : <div className="device-list">
                  {devices.map((device) => <div className="device-row" key={device.id}>
                    <div><strong>{device.name}</strong><span>Last connected {new Date(device.lastSeenAt).toLocaleString()}</span></div>
                    <button type="button" onClick={() => void revoke(device.id)} disabled={revoking === device.id}>{revoking === device.id ? "Removing…" : "Remove"}</button>
                  </div>)}
                </div>}
                <p className="privacy-footnote">You can add multiple camera devices with separate pairing links. Removing one disconnects only that device and prevents it from reconnecting.</p>
              </div>
            </div>
          </>}

          {error && status === "ready" && <p className="error-text" role="alert">{error}</p>}
        </div>
      </section>
    </main>
  );
}
