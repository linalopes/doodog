/**
 * The vendored `go2.xml` is the Menagerie robot. It has no ground geom.
 * A small wrapper includes that file and adds one plane so a fall can
 * produce a contact. The file in `public/models/go2/` is not rewritten.
 */

export const PHYSICS_ASSET_FILES = [
  'base_0.obj',
  'base_1.obj',
  'base_2.obj',
  'base_3.obj',
  'base_4.obj',
  'hip_0.obj',
  'hip_1.obj',
  'thigh_0.obj',
  'thigh_1.obj',
  'thigh_mirror_0.obj',
  'thigh_mirror_1.obj',
  'calf_0.obj',
  'calf_1.obj',
  'calf_mirror_0.obj',
  'calf_mirror_1.obj',
  'foot.obj',
] as const;

export const FLOOR_NOTE =
  'go2.xml has no ground. The physics loader includes that file unchanged and adds a plane named floor. Without the plane the robot would fall and never report a ground contact.';

export const TORQUE_NOTE =
  'The home keyframe lists ctrl values equal to the crouched joint angles. These actuators are torque motors, so those numbers are not sent. Every motor command stays at 0 Nm. There is no balance controller.';

export interface PlatformGeom {
  center: readonly [number, number, number];
  half: readonly [number, number, number];
}

/**
 * Ground stays at z = 0. A platform is added only for Candidate A.
 * `go2.xml` is included and is not rewritten. The box top is the paper plane.
 * The brush is not a geom in this file.
 */
export function go2FloorSceneXml(platform: PlatformGeom | null = null): string {
  const slab = platform
    ? `\n    <geom name="paper_platform" type="box" pos="${platform.center.map(format).join(' ')}" size="${platform.half.map(format).join(' ')}" rgba="0.792 0.847 0.847 1"/>`
    : '';
  return `<mujoco model="go2-floor">
  <include file="go2.xml"/>
  <worldbody>
    <geom name="floor" type="plane" size="5 5 0.1" rgba="0.85 0.9 0.9 1"/>${slab}
  </worldbody>
</mujoco>
`;
}

function format(value: number): string {
  return value.toFixed(6);
}
