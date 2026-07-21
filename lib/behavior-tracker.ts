import type { DogReading } from "./dog-detector";

interface Point {
  x: number;
  y: number;
  at: number;
}

export class BehaviorTracker {
  private points: Point[] = [];
  private lastRepeatedMovementAt = 0;

  addDogReading(reading: DogReading): boolean {
    const cutoff = reading.observedAt - 60_000;
    this.points = this.points.filter((point) => point.at >= cutoff);
    if (!reading.visible || !reading.box) return false;

    this.points.push({
      x: reading.box.x + reading.box.width / 2,
      y: reading.box.y + reading.box.height / 2,
      at: reading.observedAt,
    });
    if (this.points.length < 6 || reading.observedAt - this.lastRepeatedMovementAt < 5 * 60_000) return false;

    let pathLength = 0;
    let directionChanges = 0;
    let previousVector: { x: number; y: number } | null = null;
    for (let index = 1; index < this.points.length; index += 1) {
      const vector = {
        x: this.points[index].x - this.points[index - 1].x,
        y: this.points[index].y - this.points[index - 1].y,
      };
      const distance = Math.hypot(vector.x, vector.y);
      pathLength += distance;
      if (previousVector && distance > 0.04) {
        const previousLength = Math.hypot(previousVector.x, previousVector.y);
        if (previousLength > 0.04) {
          const cosine = (vector.x * previousVector.x + vector.y * previousVector.y) / (distance * previousLength);
          if (cosine < -0.25) directionChanges += 1;
        }
      }
      if (distance > 0.04) previousVector = vector;
    }

    const repeated = pathLength > 1.8 && directionChanges >= 3;
    if (repeated) this.lastRepeatedMovementAt = reading.observedAt;
    return repeated;
  }

  reset() {
    this.points = [];
    this.lastRepeatedMovementAt = 0;
  }
}

