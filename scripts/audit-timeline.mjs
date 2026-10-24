/**
 * Host timeline, replay plan, sample pump, and motion-message checks.
 * No browser and no sketch evaluation. Irregular frame gaps are applied as
 * elapsed seconds, not as a count of frames.
 */
import assert from 'node:assert/strict';
import { isMotionFrame } from '../src/lib/motion/types.ts';
import {
  applyDuration,
  applyPlayState,
  applySeek,
  clampTime,
  frameDeltaSeconds,
  MAX_FRAME_DELTA_SECONDS,
  playbackMode,
  scrubMaximum,
  stepTimeline,
} from '../src/lib/motion/timelineMath.ts';
import { MAX_REPLAY_SPAN_SECONDS, replayPlan } from '../src/lib/p5/replayPlan.ts';
import { createSamplePump } from '../src/lib/p5/samplePump.ts';
import { isRuntimeMessage, isStaleRunId } from '../src/lib/p5/protocol.ts';

const PAINT_GAP_LIMIT = 0.75;

function playing(time, extra = {}) {
  return {
    time,
    durationSeconds: null,
    playState: 'playing',
    rate: 1,
    ...extra,
  };
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} !== ${expected}`);
}

function gapsStayPaintable(times, start) {
  let previous = start;
  for (const time of times) {
    assert.ok(time - previous <= PAINT_GAP_LIMIT + 1e-9, `${time - previous} exceeds paint gap`);
    assert.ok(time + 1e-9 >= previous);
    previous = time;
  }
  return previous;
}

// Play, pause, rate, irregular deltas, finite wrap, continuous growth.
{
  const paused = stepTimeline({ ...playing(3), playState: 'paused' }, 1);
  assert.equal(paused.time, 3);

  const stoppedState = { ...playing(3), playState: 'stopped' };
  assert.equal(stepTimeline(stoppedState, 1), stoppedState);
  assert.equal(stoppedState.time, 3);

  let state = playing(0);
  state = stepTimeline(state, 0.016);
  state = stepTimeline(state, 0.5);
  close(state.time, 0.516);
  assert.equal(stepTimeline(state, 0), state);
  assert.equal(stepTimeline(state, -1), state);

  const doubled = stepTimeline(playing(0, { rate: 2 }), 0.25);
  close(doubled.time, 0.5);

  const wrapped = stepTimeline(playing(7.5, { durationSeconds: 8 }), 1);
  close(wrapped.time, 0.5);
  assert.equal(wrapped.durationSeconds, 8);

  const continuous = stepTimeline(playing(100), 50);
  close(continuous.time, 150);
  assert.equal(continuous.durationSeconds, null);
  assert.equal(playbackMode(null), 'continuous');
  assert.equal(playbackMode(8), 'loop');
}

// The clock caps a stalled animation frame. stepTimeline itself honours the delta.
{
  assert.equal(frameDeltaSeconds(1000, null), 0);
  close(frameDeltaSeconds(1016, 1000), 0.016);
  assert.equal(frameDeltaSeconds(1000, 2000), 0);
  assert.equal(frameDeltaSeconds(5000, 1000), MAX_FRAME_DELTA_SECONDS);
  const jumped = stepTimeline(playing(1, { durationSeconds: 30 }), 2);
  close(jumped.time, 3);
}

// Seek, stop, and duration. A missing or non-positive period stays continuous.
{
  assert.equal(clampTime(-4, 8), 0);
  assert.equal(clampTime(Number.NaN, null), 0);
  assert.equal(clampTime(9, 8), 8);
  assert.equal(clampTime(40, null), 40);

  const sought = applySeek(playing(2, { durationSeconds: 8 }), 20);
  assert.equal(sought.time, 8);
  assert.equal(applySeek(sought, 8), sought);

  const reset = applyPlayState(playing(5, { playState: 'paused' }), 'stopped');
  assert.equal(reset.playState, 'stopped');
  assert.equal(reset.time, 0);

  const declared = applyDuration(playing(10), 8);
  close(declared.time, 2);
  assert.equal(declared.durationSeconds, 8);
  assert.equal(applyDuration(declared, 8), declared);
  assert.equal(applyDuration(playing(4, { durationSeconds: 8 }), 0).durationSeconds, null);
  assert.equal(applyDuration(playing(4, { durationSeconds: 8 }), Number.NaN).durationSeconds, null);

  assert.equal(scrubMaximum(playing(0)), 30);
  assert.equal(scrubMaximum(playing(45)), 45);
  assert.equal(scrubMaximum(playing(12, { durationSeconds: 8 })), 8);
}

// Backward seek rebuilds. Small forward steps do not. Large jumps stay paintable.
{
  const first = replayPlan(null, 0);
  assert.equal(first.rebuild, true);
  assert.deepEqual(first.times, [0]);

  const ahead = replayPlan(1, 1.01);
  assert.equal(ahead.rebuild, false);
  assert.deepEqual(ahead.times, [1.01]);

  const back = replayPlan(5, 2);
  assert.equal(back.rebuild, true);
  assert.equal(back.times[0], 0);
  close(back.times[back.times.length - 1], 2);
  gapsStayPaintable(back.times.slice(1), 0);

  const across = replayPlan(0, 10);
  assert.equal(across.rebuild, false);
  close(gapsStayPaintable(across.times, 0), 10);

  const looped = replayPlan(8.1, 0.04);
  assert.equal(looped.rebuild, true);
  assert.equal(looped.times[0], 0);

  const distant = replayPlan(0, 500);
  assert.equal(distant.rebuild, true);
  close(distant.times[0], 500 - MAX_REPLAY_SPAN_SECONDS);
  close(distant.times[distant.times.length - 1], 500);
  gapsStayPaintable(distant.times.slice(1), distant.times[0]);
  assert.ok(distant.times.length < 300);
}

// One sample in flight. A newer time replaces the queued one. Stale serials die.
{
  const sent = [];
  const pump = createSamplePump((time, serial) => sent.push([time, serial]));
  pump.request(1);
  pump.request(2);
  pump.request(3);
  assert.deepEqual(sent, [[1, 1]]);
  assert.equal(pump.acknowledge(1), true);
  assert.deepEqual(sent, [
    [1, 1],
    [3, 2],
  ]);
  assert.equal(pump.acknowledge(1), false);

  pump.request(4);
  pump.request(9);
  assert.equal(pump.expire(2), false);
  assert.deepEqual(sent[sent.length - 1], [9, 4]);
  assert.equal(pump.acknowledge(2), false);
  assert.equal(pump.acknowledge(4), true);

  const idle = [];
  const quiet = createSamplePump((time, serial) => idle.push([time, serial]));
  quiet.request(1);
  assert.equal(quiet.expire(1), true);
  assert.equal(quiet.isInFlight(), false);
  assert.equal(quiet.acknowledge(1), false);
  quiet.request(Number.NaN);
  assert.deepEqual(idle, [[1, 1]]);
  quiet.reset();
  assert.equal(quiet.acknowledge(2), false);
}

// Message shape, finite coordinates, and stale run ids.
{
  const frame = {
    time: 1,
    left: { x: 10, y: 20, contact: true },
    right: { x: 30, y: 40, contact: false },
  };
  assert.equal(isMotionFrame(frame), true);
  assert.equal(
    isMotionFrame({ ...frame, left: { x: Number.NaN, y: 0, contact: true } }),
    false,
  );

  const valid = {
    type: 'MOTION_FRAME',
    runId: 'run-1',
    serial: 2,
    frame,
    errorCode: null,
    errorMessage: null,
    durationSeconds: 8,
    canvasWidth: 600,
    canvasHeight: 600,
  };
  assert.equal(isRuntimeMessage(valid), true);
  assert.equal(isStaleRunId(valid, 'run-1'), false);
  assert.equal(isStaleRunId(valid, 'run-2'), true);
  assert.equal(isStaleRunId(valid, null), true);
  assert.equal(isStaleRunId({ type: 'RUNTIME_READY' }, null), false);

  assert.equal(
    isRuntimeMessage({
      ...valid,
      frame: null,
      errorCode: 'missing',
      errorMessage: 'This sketch has no motion(t).',
      durationSeconds: null,
    }),
    true,
  );
  assert.equal(
    isRuntimeMessage({
      ...valid,
      frame: { ...frame, right: { x: Number.POSITIVE_INFINITY, y: 1, contact: false } },
    }),
    false,
  );
  assert.equal(isRuntimeMessage({ ...valid, serial: Number.NaN }), false);
  assert.equal(isRuntimeMessage({ ...valid, errorCode: 'timeout' }), false);
  assert.equal(isRuntimeMessage({ ...valid, durationSeconds: Number.POSITIVE_INFINITY }), false);
  assert.equal(isRuntimeMessage({ ...valid, runId: '' }), false);
}

console.log('timeline audit ok');
