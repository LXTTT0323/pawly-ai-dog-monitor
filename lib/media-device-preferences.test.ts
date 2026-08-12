import assert from "node:assert/strict";
import test from "node:test";
import {
  audioCaptureConstraints,
  chooseFallbackDevice,
  deviceDisplayName,
  readMediaPreferences,
  videoCaptureConstraints,
  writeMediaPreferences,
} from "./media-device-preferences.ts";

test("reads and writes remembered camera and microphone ids", () => {
  let value = "";
  const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
  writeMediaPreferences(storage, { videoDeviceId: "usb-camera", audioDeviceId: "usb-mic" });
  assert.deepEqual(readMediaPreferences(storage), { videoDeviceId: "usb-camera", audioDeviceId: "usb-mic" });
});

test("recovers from malformed local preferences", () => {
  assert.deepEqual(readMediaPreferences({ getItem: () => "not-json" }), { videoDeviceId: "", audioDeviceId: "" });
});

test("uses an exact device when a USB source was selected", () => {
  assert.deepEqual(videoCaptureConstraints("usb-camera"), {
    deviceId: { exact: "usb-camera" }, width: { ideal: 1280 }, height: { ideal: 720 },
  });
  assert.deepEqual(audioCaptureConstraints("usb-mic"), {
    deviceId: { exact: "usb-mic" }, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
  });
});

test("falls back to facing mode and the next connected camera", () => {
  assert.deepEqual(videoCaptureConstraints("", "environment"), {
    facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 },
  });
  assert.equal(chooseFallbackDevice([{ deviceId: "lost" }, { deviceId: "built-in" }], "lost"), "built-in");
  assert.equal(deviceDisplayName({ label: "", kind: "videoinput" }, 1), "Camera 2");
});
