export interface AudioEnergyReading {
  level: number;
  active: boolean;
  intervalMs: number;
}

export async function startAudioEnergyAnalyzer(
  track: MediaStreamTrack,
  onReading: (reading: AudioEnergyReading) => void,
): Promise<() => void> {
  const audioContext = new AudioContext({ sampleRate: 16_000 });
  await audioContext.resume();
  const source = audioContext.createMediaStreamSource(new MediaStream([track]));
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.35;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let noiseFloor = 0.008;
  const intervalMs = 500;

  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const level = Math.sqrt(sum / samples.length);
    const threshold = Math.max(0.035, noiseFloor * 3.2);
    const active = level > threshold;
    if (!active) noiseFloor = noiseFloor * 0.98 + level * 0.02;
    onReading({ level: Math.min(1, level * 8), active, intervalMs });
  }, intervalMs);

  return () => {
    window.clearInterval(timer);
    source.disconnect();
    analyser.disconnect();
    void audioContext.close();
  };
}

