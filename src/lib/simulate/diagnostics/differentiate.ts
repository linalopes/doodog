/**
 * Time-aware derivatives for a sampled joint trajectory.
 *
 * Playback frame rate is not the analysis sample rate. Each value is paired
 * with the time the sandbox was asked for, in seconds.
 *
 * Interior points use the three-point stencil that is exact for quadratics on
 * an uneven grid. With a step h on either side it reduces to
 * (q[i+1] − q[i−1]) / (2h). Endpoints use the matching one-sided three-point
 * stencil when a third sample exists. A segment of two samples uses the
 * two-point slope at both ends. One sample has no derivative.
 *
 * Acceleration is the same operator applied to the velocity estimates, not a
 * separate second-difference formula. A jump shorter than the sample interval
 * can be missed or spread across the neighbouring samples. The last interval
 * of a range can be shorter than the rest, because the range endpoint is
 * always included.
 */

export interface DerivativeSeries {
  velocity: (number | null)[];
  acceleration: (number | null)[];
}

function forward(times: number[], values: number[]): number | null {
  const t0 = times[0];
  const t1 = times[1];
  const t2 = times[2];
  const q0 = values[0];
  const q1 = values[1];
  const q2 = values[2];
  if (
    t0 === undefined ||
    t1 === undefined ||
    t2 === undefined ||
    q0 === undefined ||
    q1 === undefined ||
    q2 === undefined
  ) {
    return null;
  }
  const h0 = t1 - t0;
  const h1 = t2 - t1;
  if (h0 <= 1e-9 || h1 <= 1e-9) return null;
  const a = -(2 * h0 + h1) / (h0 * (h0 + h1));
  const b = (h0 + h1) / (h0 * h1);
  const c = -h0 / (h1 * (h0 + h1));
  return a * q0 + b * q1 + c * q2;
}

function central(times: number[], values: number[], index: number): number | null {
  const tPrev = times[index - 1];
  const t = times[index];
  const tNext = times[index + 1];
  const qPrev = values[index - 1];
  const q = values[index];
  const qNext = values[index + 1];
  if (
    tPrev === undefined ||
    t === undefined ||
    tNext === undefined ||
    qPrev === undefined ||
    q === undefined ||
    qNext === undefined
  ) {
    return null;
  }
  const h0 = t - tPrev;
  const h1 = tNext - t;
  if (h0 <= 1e-9 || h1 <= 1e-9) return null;
  const a = -h1 / (h0 * (h0 + h1));
  const b = (h1 - h0) / (h0 * h1);
  const c = h0 / (h1 * (h0 + h1));
  return a * qPrev + b * q + c * qNext;
}

function backward(times: number[], values: number[]): number | null {
  const reversedTimes = times.map((time) => -time).reverse();
  const reversedValues = values.slice().reverse();
  const slope = forward(reversedTimes, reversedValues);
  return slope === null ? null : -slope;
}

/** First derivative. Null where the local samples are missing or not increasing in time. */
export function differentiateValues(times: number[], values: number[]): (number | null)[] {
  const count = Math.min(times.length, values.length);
  const velocity: (number | null)[] = new Array(count).fill(null);
  if (count < 2) return velocity;
  if (count === 2) {
    const t0 = times[0];
    const t1 = times[1];
    const q0 = values[0];
    const q1 = values[1];
    if (t0 === undefined || t1 === undefined || q0 === undefined || q1 === undefined) return velocity;
    const step = t1 - t0;
    if (step <= 1e-9) return velocity;
    const slope = (q1 - q0) / step;
    velocity[0] = slope;
    velocity[1] = slope;
    return velocity;
  }
  velocity[0] = forward(times, values);
  for (let index = 1; index < count - 1; index += 1) velocity[index] = central(times, values, index);
  velocity[count - 1] = backward(times, values);
  return velocity;
}

/** Velocity, then acceleration from that velocity. Acceleration follows the same time base. */
export function differentiateSeries(times: number[], values: number[]): DerivativeSeries {
  const velocity = differentiateValues(times, values);
  const finiteTimes: number[] = [];
  const finiteVelocity: number[] = [];
  velocity.forEach((value, index) => {
    const time = times[index];
    if (value === null || time === undefined) return;
    finiteTimes.push(time);
    finiteVelocity.push(value);
  });
  const finiteAcceleration = differentiateValues(finiteTimes, finiteVelocity);
  const acceleration: (number | null)[] = new Array(velocity.length).fill(null);
  let cursor = 0;
  velocity.forEach((value, index) => {
    if (value === null) return;
    acceleration[index] = finiteAcceleration[cursor] ?? null;
    cursor += 1;
  });
  return { velocity, acceleration };
}
