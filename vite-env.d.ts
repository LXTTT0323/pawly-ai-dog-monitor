/// <reference types="vite/client" />

declare module "livekit-client/e2ee-worker?worker" {
  const LiveKitE2EEWorker: {
    new (): Worker;
  };
  export default LiveKitE2EEWorker;
}
