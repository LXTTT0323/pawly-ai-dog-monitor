import type { ClipTrigger, SavedClip } from "./clip-store";

const CLIP_DURATION_MS = 12_000;

function supportedMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

export async function recordEventClip(
  stream: MediaStream,
  roomCode: string,
  trigger: ClipTrigger,
): Promise<SavedClip> {
  if (typeof MediaRecorder === "undefined") throw new Error("Event clips are not supported by this browser");
  if (stream.getVideoTracks().length === 0) throw new Error("No live video track is available");

  const mimeType = supportedMimeType();
  const options: MediaRecorderOptions = {
    videoBitsPerSecond: 420_000,
    audioBitsPerSecond: 32_000,
    ...(mimeType ? { mimeType } : {}),
  };

  return new Promise((resolve, reject) => {
    const chunks: BlobPart[] = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, options);
    } catch (cause) {
      reject(cause);
      return;
    }

    const timer = window.setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, CLIP_DURATION_MS);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("Event clip recording failed"));
    };
    recorder.onstop = () => {
      window.clearTimeout(timer);
      const finalType = recorder.mimeType || mimeType || "video/webm";
      const blob = new Blob(chunks, { type: finalType });
      if (blob.size === 0) {
        reject(new Error("The event clip was empty"));
        return;
      }
      resolve({
        id: crypto.randomUUID(),
        roomCode,
        createdAt: Date.now(),
        durationMs: CLIP_DURATION_MS,
        trigger,
        mimeType: finalType,
        blob,
      });
    };
    recorder.start(1_000);
  });
}
