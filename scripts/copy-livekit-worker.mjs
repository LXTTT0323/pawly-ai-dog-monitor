import { copyFile } from "node:fs/promises";
import path from "node:path";

const source = path.resolve(
  "node_modules/livekit-client/dist/livekit-client.e2ee.worker.js",
);
const target = path.resolve("public/livekit-e2ee-worker.js");

await copyFile(source, target);
