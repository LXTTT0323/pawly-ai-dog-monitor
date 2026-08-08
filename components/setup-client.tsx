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
  isMonitored: boolean;
  photos: Array<{ id: string; url: string; createdAt: number }>;
}

async function preparePetPhoto(file: File) {
  const directlySupported = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  if (directlySupported && file.size <= 4 * 1024 * 1024) return file;

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("This photo format could not be prepared. Try a screenshot or JPG."));
      image.src = objectUrl;
    });
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
    if (!blob) throw new Error("This photo could not be prepared. Try another image.");
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "pet-photo"}.jpg`, { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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
  const [selectedPetId, setSelectedPetId] = useState<string | null>(null);
  const [petFormMode, setPetFormMode] = useState<"add" | "edit">("add");
  const [petName, setPetName] = useState("");
  const [petSpecies, setPetSpecies] = useState<"dog" | "cat">("dog");
  const [savingPet, setSavingPet] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);

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
        const savedPets = profile.pets ?? [];
        setPets(savedPets);
        const selectedPet = savedPets.find((pet) => pet.isPrimary) ?? savedPets[0];
        if (selectedPet) {
          setSelectedPetId(selectedPet.id);
          setPetFormMode("edit");
          setPetName(selectedPet.name);
          setPetSpecies(selectedPet.species);
        }
      }
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open your room");
      setStatus("error");
    }
  }, []);

  useEffect(() => { void loadRoom(); }, [loadRoom]);

  const watchUrl = useMemo(() => room ? `/watch?room=${room.code}` : "#", [room]);
  const selectedPet = useMemo(() => pets.find((pet) => pet.id === selectedPetId) ?? null, [pets, selectedPetId]);

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

  function selectPet(pet: PetProfile) {
    setSelectedPetId(pet.id);
    setPetFormMode("edit");
    setPetName(pet.name);
    setPetSpecies(pet.species);
  }

  function beginAddingPet() {
    setSelectedPetId(null);
    setPetFormMode("add");
    setPetName("");
    setPetSpecies("dog");
  }

  async function savePet() {
    if (!petName.trim()) return;
    setSavingPet(true);
    setError("");
    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: petFormMode === "edit" ? selectedPetId : undefined,
          name: petName,
          species: petSpecies,
          ...(petFormMode === "add" && pets.length === 0 ? { isPrimary: true } : {}),
          ...(petFormMode === "add" ? { isMonitored: true } : {}),
        }),
      });
      const data = await response.json() as { pet?: PetProfile; pets?: PetProfile[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not save your pet");
      const savedPets = data.pets ?? [];
      setPets(savedPets);
      const savedPet = data.pet ?? savedPets.find((pet) => pet.id === selectedPetId);
      if (savedPet) selectPet(savedPet);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your pet");
    } finally {
      setSavingPet(false);
    }
  }

  async function makePrimaryPet(pet: PetProfile) {
    setSavingPet(true);
    setError("");
    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: pet.id, name: pet.name, species: pet.species, isPrimary: true, isMonitored: true }),
      });
      const data = await response.json() as { pet?: PetProfile; pets?: PetProfile[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not select this pet");
      setPets(data.pets ?? []);
      if (data.pet) selectPet({ ...data.pet, isPrimary: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not select this pet");
    } finally {
      setSavingPet(false);
    }
  }

  async function togglePetMonitoring(pet: PetProfile) {
    if (pet.isPrimary && pet.isMonitored) {
      setError("Choose another main pet before removing this one from monitoring.");
      return;
    }
    setSavingPet(true);
    setError("");
    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: pet.id, name: pet.name, species: pet.species, isMonitored: !pet.isMonitored }),
      });
      const data = await response.json() as { pet?: PetProfile; pets?: PetProfile[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not update monitoring");
      setPets(data.pets ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update monitoring");
    } finally {
      setSavingPet(false);
    }
  }

  async function uploadPetPhotos(files: File[]) {
    if (!selectedPet || files.length === 0) return;
    setUploadingPhotos(true);
    setError("");
    try {
      const remaining = Math.max(0, 5 - selectedPet.photos.length);
      const chosen = files.slice(0, remaining);
      if (chosen.length === 0) throw new Error("This pet already has five reference photos.");
      const prepared = await Promise.all(chosen.map(preparePetPhoto));
      const form = new FormData();
      for (const file of prepared) form.append("photos", file);
      const response = await fetch(`/api/pets/${encodeURIComponent(selectedPet.id)}/photos`, { method: "POST", body: form });
      const data = await response.json() as { photos?: PetProfile["photos"]; error?: string };
      if (!response.ok || !data.photos) throw new Error(data.error ?? "Could not upload pet photos");
      setPets((current) => current.map((pet) => pet.id === selectedPet.id ? { ...pet, photos: data.photos ?? pet.photos } : pet));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload pet photos");
    } finally {
      setUploadingPhotos(false);
    }
  }

  async function removePetPhoto(petId: string, photoId: string) {
    setDeletingPhotoId(photoId);
    setError("");
    try {
      const response = await fetch(`/api/pets/${encodeURIComponent(petId)}/photos/${encodeURIComponent(photoId)}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? "Could not remove pet photo");
      }
      setPets((current) => current.map((pet) => pet.id === petId ? { ...pet, photos: pet.photos.filter((photo) => photo.id !== photoId) } : pet));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove pet photo");
    } finally {
      setDeletingPhotoId(null);
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
                <div>
                  <span className="eyebrow">Your pets</span>
                  <h2>{pets.length ? `${pets.filter((pet) => pet.isMonitored).length} pet${pets.filter((pet) => pet.isMonitored).length === 1 ? "" : "s"} being monitored` : "Who should Pawly watch?"}</h2>
                  <p>{pets.length ? "Select any pets that are home today, edit their details, and add private reference photos." : "Add a dog or cat now. You can add more pets later."}</p>
                </div>
                {pets.length > 0 && <button className="pet-add-link" type="button" onClick={beginAddingPet}>+ Add pet</button>}
              </div>
              {pets.length > 0 && <div className="pet-profile-list" aria-label="Saved pets">
                {pets.map((pet) => <button type="button" className={`${selectedPetId === pet.id ? "selected" : ""} ${pet.isPrimary ? "primary" : ""} ${pet.isMonitored ? "monitored" : ""}`} key={pet.id} onClick={() => selectPet(pet)}>
                  <b aria-hidden="true">{pet.photos[0] ? <img src={pet.photos[0].url} alt="" /> : pet.species === "cat" ? "◉" : "●"}</b>
                  <strong>{pet.name}</strong>
                  <small>{pet.species}{pet.isMonitored ? " · monitoring" : ""}{pet.isPrimary ? " · main" : ""}</small>
                </button>)}
              </div>}
              <div className="pet-profile-editor">
                <div className="pet-editor-heading">
                  <strong>{petFormMode === "add" ? "Add a new pet" : `Edit ${selectedPet?.name ?? "pet"}`}</strong>
                  {petFormMode === "edit" && selectedPet?.isPrimary && <span>Main pet for summaries</span>}
                </div>
                {petFormMode === "edit" && selectedPet && <div className="pet-photo-manager">
                  <div className="pet-photo-heading">
                    <div><strong>Reference photos</strong><small>{selectedPet.photos.length}/5 · front, side, and full-body photos work best</small></div>
                    <label className={selectedPet.photos.length >= 5 || uploadingPhotos ? "disabled" : ""}>
                      {uploadingPhotos ? "Uploading…" : "+ Add photos"}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        disabled={selectedPet.photos.length >= 5 || uploadingPhotos}
                        onChange={(event) => {
                          const files = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
                          event.currentTarget.value = "";
                          void uploadPetPhotos(files);
                        }}
                      />
                    </label>
                  </div>
                  {selectedPet.photos.length > 0 ? <div className="pet-photo-grid">
                    {selectedPet.photos.map((photo) => <div key={photo.id}>
                      <img src={photo.url} alt={`Reference for ${selectedPet.name}`} />
                      <button type="button" aria-label={`Remove reference photo for ${selectedPet.name}`} disabled={deletingPhotoId === photo.id} onClick={() => void removePetPhoto(selectedPet.id, photo.id)}>×</button>
                    </div>)}
                  </div> : <div className="pet-photo-empty"><span aria-hidden="true">◎</span><p>Add 3–5 clear photos to prepare this profile for individual pet recognition.</p></div>}
                  <p className="pet-photo-privacy">Private to your account. Pawly does not publish these photos.</p>
                </div>}
                <div className="pet-profile-form">
                  <label><span>Name</span><input aria-label="Pet name" placeholder="Pet name" value={petName} onChange={(event) => setPetName(event.target.value)} maxLength={40} /></label>
                  <div className="pet-type-field"><span>Type</span><div className="pet-species-toggle" role="group" aria-label="Pet species">
                    <button type="button" className={petSpecies === "dog" ? "selected" : ""} aria-pressed={petSpecies === "dog"} onClick={() => setPetSpecies("dog")}>Dog</button>
                    <button type="button" className={petSpecies === "cat" ? "selected" : ""} aria-pressed={petSpecies === "cat"} onClick={() => setPetSpecies("cat")}>Cat</button>
                  </div></div>
                </div>
                <div className="pet-editor-actions">
                  <button className="pet-save-button" type="button" onClick={() => void savePet()} disabled={!petName.trim() || savingPet}>{savingPet ? "Saving…" : petFormMode === "add" ? "Add pet" : "Save changes"}</button>
                  {petFormMode === "edit" && selectedPet && <button className={`pet-monitor-button ${selectedPet.isMonitored ? "selected" : ""}`} type="button" onClick={() => void togglePetMonitoring(selectedPet)} disabled={savingPet}>{selectedPet.isMonitored ? "✓ Monitoring" : "Include in monitoring"}</button>}
                  {petFormMode === "edit" && selectedPet && !selectedPet.isPrimary && <button className="pet-use-button" type="button" onClick={() => void makePrimaryPet(selectedPet)} disabled={savingPet}>Make main pet</button>}
                  {petFormMode === "add" && pets.length > 0 && <button className="pet-cancel-button" type="button" onClick={() => selectPet(pets.find((pet) => pet.isPrimary) ?? pets[0])}>Cancel</button>}
                </div>
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
                  <div><strong>Pairing link ready</strong><span>Valid for 15 minutes</span></div>
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
