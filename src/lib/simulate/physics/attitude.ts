/**
 * Roll and pitch from a MuJoCo quaternion (w, x, y, z).
 *
 * The Menagerie frame is +X forward, +Y left, +Z up. Roll is rotation about
 * +X and pitch is rotation about +Y. Yaw is not part of the stance criteria.
 */

import type { Quat } from '../go2/math.ts';

export function rollPitch(quaternion: Quat): { roll: number; pitch: number } {
  const w = quaternion[0];
  const x = quaternion[1];
  const y = quaternion[2];
  const z = quaternion[3];
  const sinPitch = 2 * (w * y - z * x);
  const pitch =
    Math.abs(sinPitch) >= 1 ? Math.sign(sinPitch) * (Math.PI / 2) : Math.asin(sinPitch);
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  return { roll, pitch };
}
