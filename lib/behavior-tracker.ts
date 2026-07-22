import type { DogReading } from "./dog-detector";

interface Point {
  x: number;
  y: number;
  size: number;
  at: number;
}

export interface DogBehaviorUpdate {
  movementScore: number;
  movementStarted: boolean;
  settled: boolean;
  repeatedMovement: boolean;
  cameraShiftIgnored: boolean;
}

const EMPTY_UPDATE: DogBehaviorUpdate = {
  movementScore: 0,
  movementStarted: false,
  settled: false,
  repeatedMovement: false,
  cameraShiftIgnored: false,
};

export class BehaviorTracker {
  private points: Point[] = [];
  private previousPoint: Point | null = null;
  private activeReadings = 0;
  private settledReadings = 0;
  private state: "active" | "settled" = "settled";
  private lastRepeatedMovementAt = 0;

  addDogReading(reading: DogReading, sceneMotionScore = 0): DogBehaviorUpdate {
    if (!reading.visible || !reading.box) {
      this.resetCurrentTrack();
      return EMPTY_UPDATE;
    }

    const point: Point = {
      x: reading.box.x + reading.box.width / 2,
      y: reading.box.y + reading.box.height / 2,
      size: reading.box.width * reading.box.height,
      at: reading.observedAt,
    };

    // A large whole-frame change is normally the tablet being picked up or
    // repositioned. Re-anchor the dog box without reporting dog movement.
    if (sceneMotionScore >= 0.12) {
      this.points = [point];
      this.previousPoint = point;
      this.activeReadings = 0;
      this.settledReadings = 0;
      return { ...EMPTY_UPDATE, cameraShiftIgnored: true };
    }

    const previous = this.previousPoint;
    this.previousPoint = point;
    if (!previous) {
      this.points = [point];
      return EMPTY_UPDATE;
    }

    const centerDistance = Math.hypot(point.x - previous.x, point.y - previous.y);
    const sizeChange = Math.abs(point.size - previous.size) / Math.max(point.size, previous.size, 0.01);
    const movementScore = Math.min(1, centerDistance + sizeChange * 0.18);
    const moving = movementScore >= 0.055;

    if (moving) {
      this.activeReadings += 1;
      this.settledReadings = 0;
    } else {
      this.settledReadings += 1;
      this.activeReadings = 0;
    }

    const movementStarted = this.activeReadings >= 2 && this.state !== "active";
    const settled = this.settledReadings >= 2 && this.state === "active";
    if (movementStarted) this.state = "active";
    if (settled) this.state = "settled";

    const cutoff = reading.observedAt - 60_000;
    this.points = [...this.points.filter((candidate) => candidate.at >= cutoff), point];
    const repeatedMovement = this.detectRepeatedMovement(reading.observedAt);

    return { movementScore, movementStarted, settled, repeatedMovement, cameraShiftIgnored: false };
  }

  private detectRepeatedMovement(observedAt: number): boolean {
    if (this.points.length < 6 || observedAt - this.lastRepeatedMovementAt < 5 * 60_000) return false;

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

    const repeated = pathLength > 1.1 && directionChanges >= 2;
    if (repeated) this.lastRepeatedMovementAt = observedAt;
    return repeated;
  }

  private resetCurrentTrack() {
    this.points = [];
    this.previousPoint = null;
    this.activeReadings = 0;
    this.settledReadings = 0;
    this.state = "settled";
  }

  reset() {
    this.resetCurrentTrack();
    this.lastRepeatedMovementAt = 0;
  }
}
