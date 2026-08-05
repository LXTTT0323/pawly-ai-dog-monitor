import { ExternalE2EEKeyProvider, Room, type Participant } from "livekit-client";
import LiveKitE2EEWorker from "livekit-client/e2ee-worker?worker";

export async function createEncryptedRoom(e2eeKey: string, options: ConstructorParameters<typeof Room>[0]) {
  if (!supportsE2EE()) {
    throw new Error("This browser is too old for Pawly's private encrypted video. Update the browser or device and try again.");
  }
  const keyProvider = new ExternalE2EEKeyProvider();
  await keyProvider.setKey(e2eeKey);
  // Let Vite emit the worker as a same-origin hashed asset. A package-relative
  // import.meta.url can survive vinext's server bundle as a file:// URL.
  const worker = new LiveKitE2EEWorker();
  return {
    room: new Room({ ...options, e2ee: { keyProvider, worker } }),
    disposeEncryption: () => worker.terminate(),
  };
}

export function participantRole(participant?: Participant | null): "owner" | "camera" | null {
  if (!participant?.metadata) return null;
  try {
    const metadata = JSON.parse(participant.metadata) as { role?: string };
    return metadata.role === "owner" || metadata.role === "camera" ? metadata.role : null;
  } catch {
    return null;
  }
}

function supportsE2EE() {
  if (typeof window === "undefined" || typeof window.Worker === "undefined") return false;
  const sender = window.RTCRtpSender?.prototype as RTCRtpSender & { createEncodedStreams?: unknown };
  const scriptTransform = (window as typeof window & { RTCRtpScriptTransform?: unknown }).RTCRtpScriptTransform;
  return typeof sender?.createEncodedStreams === "function" || typeof scriptTransform !== "undefined";
}
