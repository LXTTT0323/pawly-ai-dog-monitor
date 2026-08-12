export interface PawlyMediaPreferences {
  videoDeviceId: string;
  audioDeviceId: string;
}

export const PAWLY_MEDIA_PREFERENCES_KEY = "pawly-media-preferences-v1";

export function readMediaPreferences(storage: Pick<Storage, "getItem">): PawlyMediaPreferences {
  try {
    const parsed = JSON.parse(storage.getItem(PAWLY_MEDIA_PREFERENCES_KEY) ?? "{}") as Partial<PawlyMediaPreferences>;
    return {
      videoDeviceId: typeof parsed.videoDeviceId === "string" ? parsed.videoDeviceId : "",
      audioDeviceId: typeof parsed.audioDeviceId === "string" ? parsed.audioDeviceId : "",
    };
  } catch {
    return { videoDeviceId: "", audioDeviceId: "" };
  }
}

export function writeMediaPreferences(storage: Pick<Storage, "setItem">, preferences: PawlyMediaPreferences) {
  storage.setItem(PAWLY_MEDIA_PREFERENCES_KEY, JSON.stringify(preferences));
}

export function videoCaptureConstraints(deviceId: string, facingMode: "user" | "environment" = "environment"): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facingMode } }),
    width: { ideal: 1280 },
    height: { ideal: 720 },
  };
}

export function audioCaptureConstraints(deviceId: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

export function deviceDisplayName(device: Pick<MediaDeviceInfo, "label" | "kind">, index: number) {
  if (device.label.trim()) return device.label.trim();
  return `${device.kind === "videoinput" ? "Camera" : "Microphone"} ${index + 1}`;
}

export function chooseFallbackDevice(devices: Pick<MediaDeviceInfo, "deviceId">[], disconnectedDeviceId: string) {
  return devices.find((device) => device.deviceId && device.deviceId !== disconnectedDeviceId)?.deviceId ?? "";
}
