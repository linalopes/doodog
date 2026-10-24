/**
 * Unitree Go2 kinematic constants, copied from the MuJoCo Menagerie model.
 *
 * Source: google-deepmind/mujoco_menagerie `unitree_go2/go2.xml`
 * (BSD-3-Clause, copyright HangZhou YuShu TECHNOLOGY CO.,LTD. / Unitree Robotics).
 * The XML and the OBJ meshes ship in `public/models/go2/`. That file is an
 * MJCF description derived from the Unitree URDF. This module does not load
 * MJCF at runtime. The numbers below are the compiled defaults and the `home`
 * keyframe of that file, so the joint hierarchy, axes, origins, and limits
 * stay the ones Menagerie publishes.
 *
 * Frame: +X forward, +Y left, +Z up, metres, radians.
 * Each leg is hip abduction (axis +X), thigh (axis +Y), knee (axis +Y).
 * The knee range is entirely negative. A zero knee angle is outside the model.
 *
 * The base body's `pos` in the XML is (0, 0, 0.445). The `home` keyframe
 * replaces that with a free-joint pose of (0, 0, 0.27) and the crouched
 * angles below. The kinematic preview fixes the body on that keyframe.
 * It does not use the 0.445 default, which belongs to a different pose.
 */

import type { Quat, Vec3 } from './math.ts';

export type LegId = 'FL' | 'FR' | 'RL' | 'RR';

export const LEG_IDS: readonly LegId[] = ['FL', 'FR', 'RL', 'RR'];

export const GO2_MODEL = {
  id: 'unitree-go2-menagerie',
  name: 'Unitree Go2',
  sourceUrl: 'https://github.com/google-deepmind/mujoco_menagerie/tree/main/unitree_go2',
  sourceFile: 'go2.xml',
  license: 'BSD-3-Clause',
  copyright: 'Copyright (c) 2016-2022 HangZhou YuShu TECHNOLOGY CO.,LTD. ("Unitree Robotics")',
  meshRoot: '/models/go2/assets/',
} as const;

/** Home keyframe free-joint position. Orientation is identity. */
export const BODY_POSITION: Vec3 = [0, 0, 0.27];

/** Home keyframe, every leg: abduction 0, thigh 0.9, knee -1.8. */
export const REFERENCE_ANGLES = [0, 0.9, -1.8] as const;

const ABDUCTION = { axis: [1, 0, 0] as Vec3, min: -1.0472, max: 1.0472 };
const KNEE = { axis: [0, 1, 0] as Vec3, min: -2.7227, max: -0.83776 };
const FRONT_HIP = { axis: [0, 1, 0] as Vec3, min: -1.5708, max: 3.4907 };
const BACK_HIP = { axis: [0, 1, 0] as Vec3, min: -0.5236, max: 4.5379 };

export interface JointSpec {
  name: string;
  role: 'abduction' | 'hip' | 'knee';
  axis: Vec3;
  min: number;
  max: number;
}

export interface LegSpec {
  id: LegId;
  /** Hip body origin in the base frame, from the XML `pos`. */
  hipPosition: Vec3;
  /** Thigh origin relative to the hip body. Sign follows the XML. */
  thighOffsetY: number;
  /** Thigh joint origin to calf joint, and calf joint to the foot frame. */
  thighLength: number;
  calfLength: number;
  /** Visual foot mesh origin in the calf frame. The brush hangs off this frame. */
  footInCalf: Vec3;
  /** Foot collision sphere centre in the calf frame. Not the brush tip. */
  footSphereInCalf: Vec3;
  abduction: JointSpec;
  hip: JointSpec;
  knee: JointSpec;
  /** Extra visual quaternion on the hip meshes (w, x, y, z). Not a joint. */
  hipMeshQuat: Quat;
  mirrorThigh: boolean;
  mirrorCalf: boolean;
}

function leg(
  id: LegId,
  x: number,
  ySign: 1 | -1,
  front: boolean,
  hipMeshQuat: Quat,
): LegSpec {
  const hip = front ? FRONT_HIP : BACK_HIP;
  return {
    id,
    hipPosition: [x, ySign * 0.0465, 0],
    thighOffsetY: ySign * 0.0955,
    thighLength: 0.213,
    calfLength: 0.213,
    footInCalf: [0, 0, -0.213],
    footSphereInCalf: [-0.002, 0, -0.213],
    abduction: { name: `${id}_hip_joint`, role: 'abduction', ...ABDUCTION },
    hip: { name: `${id}_thigh_joint`, role: 'hip', ...hip },
    knee: { name: `${id}_calf_joint`, role: 'knee', ...KNEE },
    hipMeshQuat,
    mirrorThigh: ySign < 0,
    mirrorCalf: ySign < 0,
  };
}

export const LEGS: Record<LegId, LegSpec> = {
  FL: leg('FL', 0.1934, 1, true, [1, 0, 0, 0]),
  FR: leg('FR', 0.1934, -1, true, [4.63268e-5, 1, 0, 0]),
  RL: leg('RL', -0.1934, 1, false, [4.63268e-5, 0, 1, 0]),
  RR: leg('RR', -0.1934, -1, false, [2.14617e-9, 4.63268e-5, 4.63268e-5, -1]),
};

export type MeshMaterialName = 'black' | 'white' | 'gray' | 'metal';

export interface MeshPart {
  file: string;
  material: MeshMaterialName;
}

export const GO2_MESHES: {
  base: readonly MeshPart[];
  hip: readonly MeshPart[];
  thigh: readonly MeshPart[];
  thighMirror: readonly MeshPart[];
  calf: readonly MeshPart[];
  calfMirror: readonly MeshPart[];
  foot: readonly MeshPart[];
} = {
  base: [
    { file: 'base_0.obj', material: 'black' },
    { file: 'base_1.obj', material: 'black' },
    { file: 'base_2.obj', material: 'black' },
    { file: 'base_3.obj', material: 'white' },
    { file: 'base_4.obj', material: 'gray' },
  ],
  hip: [
    { file: 'hip_0.obj', material: 'metal' },
    { file: 'hip_1.obj', material: 'gray' },
  ],
  thigh: [
    { file: 'thigh_0.obj', material: 'metal' },
    { file: 'thigh_1.obj', material: 'gray' },
  ],
  thighMirror: [
    { file: 'thigh_mirror_0.obj', material: 'metal' },
    { file: 'thigh_mirror_1.obj', material: 'gray' },
  ],
  calf: [
    { file: 'calf_0.obj', material: 'gray' },
    { file: 'calf_1.obj', material: 'black' },
  ],
  calfMirror: [
    { file: 'calf_mirror_0.obj', material: 'gray' },
    { file: 'calf_mirror_1.obj', material: 'black' },
  ],
  foot: [{ file: 'foot.obj', material: 'black' }],
};

/** RGBA from the MJCF materials. Metal is the pale shell colour in the file. */
export const MESH_COLOURS: Record<MeshMaterialName, readonly [number, number, number]> = {
  black: [0, 0, 0],
  white: [1, 1, 1],
  gray: [0.671705, 0.692426, 0.77427],
  metal: [0.9, 0.95, 0.95],
};
