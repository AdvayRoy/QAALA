export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Controllable clock for tests and deterministic expiry checks. */
export class ManualClock implements Clock {
  private current: number;

  constructor(start: Date | string | number) {
    this.current = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  set(to: Date | string | number): void {
    this.current = new Date(to).getTime();
  }

  advanceMinutes(minutes: number): void {
    this.current += minutes * 60_000;
  }

  advanceMs(ms: number): void {
    this.current += ms;
  }
}

export function iso(d: Date): string {
  return d.toISOString();
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}
