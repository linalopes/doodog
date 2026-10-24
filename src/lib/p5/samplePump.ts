/**
 * One in-flight motion sample.
 *
 * Playback must not queue a `SET_TIME` per animation frame. A request replaces
 * the pending time, and the next send happens only after the current serial is
 * acknowledged or expired. A late message for an older serial is ignored.
 */

export interface SamplePump {
  request(time: number): void;
  /** True when `serial` is the sample currently in flight. */
  acknowledge(serial: number): boolean;
  /**
   * Drops the in-flight sample so a late reply cannot match it.
   * True when that serial was in flight and no replacement was sent.
   */
  expire(serial: number): boolean;
  /** True when a replacement sample was sent as part of expiring `serial`. */
  isInFlight(): boolean;
  reset(): void;
}

export function createSamplePump(send: (time: number, serial: number) => void): SamplePump {
  let issued = 0;
  let expected = 0;
  let inFlight = false;
  let queued: number | null = null;

  function pump(): void {
    if (inFlight || queued === null) return;
    const time = queued;
    queued = null;
    issued += 1;
    expected = issued;
    inFlight = true;
    send(time, expected);
  }

  return {
    request(time: number): void {
      if (!Number.isFinite(time) || time < 0) return;
      queued = time;
      pump();
    },
    acknowledge(serial: number): boolean {
      if (!inFlight || serial !== expected) return false;
      inFlight = false;
      pump();
      return true;
    },
    expire(serial: number): boolean {
      if (!inFlight || serial !== expected) return false;
      inFlight = false;
      issued += 1;
      expected = issued;
      pump();
      return !inFlight;
    },
    isInFlight(): boolean {
      return inFlight;
    },
    reset(): void {
      inFlight = false;
      queued = null;
      issued += 1;
      expected = issued;
    },
  };
}
