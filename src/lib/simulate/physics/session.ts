/**
 * One MuJoCo model and data pair for the Go2.
 *
 * Loading, stepping, and deleting stay here so the browser worker and the
 * node tests share one implementation. Torque commands are written to the
 * motor actuators. This module does not choose those torques and it does
 * not read the creative timeline.
 */

import loadMujoco from '@mujoco/mujoco';
import type { Go2JointState } from '../adapters/types.ts';
import { rollPitch } from './attitude.ts';
import { FLOOR_NOTE, TORQUE_NOTE, go2FloorSceneXml } from './scene.ts';
import { FOOT_RADIUS_M } from './settings.ts';
import { assessSupport, type Planar } from './support.ts';
import {
  JOINT_ORDER,
  type ActuatorRange,
  type FootState,
  type LegId,
  type PhysicsContact,
  type PhysicsModelInfo,
  type PhysicsSnapshot,
  type SupportState,
} from './types.ts';

export { FLOOR_NOTE, TORQUE_NOTE };

interface MujocoFs {
  mkdir(path: string): void;
  writeFile(path: string, data: string | Uint8Array): void;
  unlink?(path: string): void;
}

interface Named {
  name: string;
  mass?: number;
  ctrlrange?: ArrayLike<number>;
}

interface MjModel {
  nq: number;
  nu: number;
  nbody: number;
  njnt: number;
  ngeom: number;
  opt: { timestep: number; gravity: ArrayLike<number> };
  body(index: number | string): Named;
  jnt(index: number): Named;
  actuator(index: number): Named;
  geom(index: number): Named;
  delete(): void;
}

interface MjContact {
  geom1: number;
  geom2: number;
  dist: number;
  pos: ArrayLike<number>;
  delete(): void;
}

interface MjData {
  time: number;
  ncon: number;
  qpos: ArrayLike<number>;
  ctrl: { length: number; [index: number]: number };
  contact: { size(): number; get(index: number): MjContact; delete(): void };
  body(index: number | string): {
    xpos: ArrayLike<number>;
    xquat: ArrayLike<number>;
    xipos: ArrayLike<number>;
  };
  geom(index: number | string): { xpos: ArrayLike<number> };
  jnt(index: number | string): { qvel: number | ArrayLike<number> };
  delete(): void;
}

interface MujocoModule {
  FS: MujocoFs;
  MjModel: { from_xml_path(path: string): MjModel };
  MjData: new (model: MjModel) => MjData;
  mj_resetDataKeyframe(model: MjModel, data: MjData, key: number): void;
  mj_forward(model: MjModel, data: MjData): void;
  mj_step(model: MjModel, data: MjData): void;
}

export interface PhysicsFiles {
  xml: string;
  assets: Readonly<Record<string, Uint8Array>>;
}

export interface PhysicsSession {
  readonly info: PhysicsModelInfo;
  reset(): PhysicsSnapshot;
  /** Current state without advancing time. */
  sample(): PhysicsSnapshot;
  /** Replace motor torques. Values are clamped to the MJCF ctrlrange. */
  setTorques(values: readonly number[]): void;
  step(count: number): PhysicsSnapshot;
  dispose(): void;
}

const ROOT = '/doodog/go2';
const MAX_STEP_REQUEST = 64;
const CONTACT_LIST = 8;
const JOINT_NAMES = ['hip', 'thigh', 'calf'] as const;

let modulePromise: Promise<MujocoModule> | null = null;

function mujocoModule(): Promise<MujocoModule> {
  modulePromise ??= loadMujoco() as unknown as Promise<MujocoModule>;
  return modulePromise;
}

export async function createPhysicsSession(files: PhysicsFiles): Promise<PhysicsSession> {
  const mujoco = await mujocoModule();
  mountModel(mujoco.FS, files);
  const model = mujoco.MjModel.from_xml_path(`${ROOT}/scene.xml`);
  const data = new mujoco.MjData(model);
  const info = readInfo(model);
  const geomNames = geomNameTable(model);
  let disposed = false;
  let saturated = false;

  function guard(): void {
    if (disposed) throw new Error('Physics session is disposed.');
  }

  function restoreReference(): PhysicsSnapshot {
    guard();
    mujoco.mj_resetDataKeyframe(model, data, 0);
    for (let index = 0; index < data.ctrl.length; index += 1) data.ctrl[index] = 0;
    saturated = false;
    mujoco.mj_forward(model, data);
    return readSnapshot(model, data, geomNames, saturated);
  }

  return {
    info,
    reset: restoreReference,
    sample(): PhysicsSnapshot {
      guard();
      return readSnapshot(model, data, geomNames, saturated);
    },
    setTorques(values: readonly number[]): void {
      guard();
      saturated = false;
      for (let index = 0; index < data.ctrl.length; index += 1) {
        const range = info.actuatorRanges[index];
        const min = range?.minNm ?? -23.7;
        const max = range?.maxNm ?? 23.7;
        const raw = Number(values[index] ?? 0);
        const finite = Number.isFinite(raw) ? raw : 0;
        const clamped = Math.min(max, Math.max(min, finite));
        if (Math.abs(clamped - finite) > 1e-6) saturated = true;
        data.ctrl[index] = clamped;
      }
    },
    step(count: number): PhysicsSnapshot {
      guard();
      const steps = Math.max(0, Math.min(MAX_STEP_REQUEST, Math.floor(count)));
      for (let index = 0; index < steps; index += 1) mujoco.mj_step(model, data);
      return readSnapshot(model, data, geomNames, saturated);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      data.delete();
      model.delete();
    },
  };
}

function mountModel(fs: MujocoFs, files: PhysicsFiles): void {
  mkdir(fs, '/doodog');
  mkdir(fs, ROOT);
  mkdir(fs, `${ROOT}/assets`);
  writeFile(fs, `${ROOT}/go2.xml`, files.xml);
  writeFile(fs, `${ROOT}/scene.xml`, go2FloorSceneXml());
  for (const [name, bytes] of Object.entries(files.assets)) {
    writeFile(fs, `${ROOT}/assets/${name}`, bytes);
  }
}

function mkdir(fs: MujocoFs, path: string): void {
  try {
    fs.mkdir(path);
  } catch {
    // The virtual directory is already there from an earlier load.
  }
}

function writeFile(fs: MujocoFs, path: string, data: string | Uint8Array): void {
  try {
    fs.writeFile(path, data);
  } catch {
    fs.unlink?.(path);
    fs.writeFile(path, data);
  }
}

function readInfo(model: MjModel): PhysicsModelInfo {
  const jointNames: string[] = [];
  for (let index = 0; index < model.njnt; index += 1) jointNames.push(model.jnt(index).name);
  const actuatorNames: string[] = [];
  const actuatorRanges: ActuatorRange[] = [];
  for (let index = 0; index < model.nu; index += 1) {
    const actuator = model.actuator(index);
    actuatorNames.push(actuator.name);
    const range = actuator.ctrlrange;
    actuatorRanges.push({
      name: actuator.name,
      minNm: Number(range?.[0] ?? -23.7),
      maxNm: Number(range?.[1] ?? 23.7),
    });
  }
  let massKg = 0;
  for (let index = 0; index < model.nbody; index += 1) massKg += Number(model.body(index).mass ?? 0);
  return {
    timestep: model.opt.timestep,
    gravity: [Number(model.opt.gravity[0]), Number(model.opt.gravity[1]), Number(model.opt.gravity[2])],
    massKg,
    nq: model.nq,
    nu: model.nu,
    jointNames,
    actuatorNames,
    actuatorRanges,
  };
}

function geomNameTable(model: MjModel): string[] {
  const names: string[] = [];
  for (let index = 0; index < model.ngeom; index += 1) {
    const name = model.geom(index).name;
    names.push(name.length > 0 ? name : `unnamed geom ${index}`);
  }
  return names;
}

function readSnapshot(
  model: MjModel,
  data: MjData,
  geomNames: readonly string[],
  saturated: boolean,
): PhysicsSnapshot {
  const base = data.body('base');
  const qpos = data.qpos;
  const joints = {} as Go2JointState;
  const jointVelocity = {} as Go2JointState;
  for (let leg = 0; leg < JOINT_ORDER.length; leg += 1) {
    const id = JOINT_ORDER[leg];
    if (!id) continue;
    const offset = 7 + leg * 3;
    joints[id] = [Number(qpos[offset] ?? 0), Number(qpos[offset + 1] ?? 0), Number(qpos[offset + 2] ?? 0)];
    jointVelocity[id] = JOINT_NAMES.map((name) => scalar(data.jnt(`${id}_${name}_joint`).qvel)) as [
      number,
      number,
      number,
    ];
  }
  const attitude = rollPitch([
    Number(base.xquat[0]),
    Number(base.xquat[1]),
    Number(base.xquat[2]),
    Number(base.xquat[3]),
  ]);
  const torquesNm: number[] = [];
  let maxAbsTorqueNm = 0;
  let effortNm = 0;
  for (let index = 0; index < data.ctrl.length; index += 1) {
    const torque = Number(data.ctrl[index] ?? 0);
    torquesNm.push(torque);
    maxAbsTorqueNm = Math.max(maxAbsTorqueNm, Math.abs(torque));
    effortNm += Math.abs(torque);
  }
  const feet = readFeet(data, geomNames);
  return {
    time: data.time,
    basePosition: vec3(base.xpos),
    baseQuaternion: [
      Number(base.xquat[0]),
      Number(base.xquat[1]),
      Number(base.xquat[2]),
      Number(base.xquat[3]),
    ],
    rollRad: attitude.roll,
    pitchRad: attitude.pitch,
    joints,
    jointVelocity,
    contactCount: feet.contactCount,
    contacts: feet.contacts,
    maxAbsTorqueNm,
    effortNm,
    torquesNm,
    saturated,
    feet: feet.feet,
    support: readSupport(model, data, feet.feet),
  };
}

function readFeet(
  data: MjData,
  geomNames: readonly string[],
): { feet: Record<LegId, FootState>; contacts: PhysicsContact[]; contactCount: number } {
  const totals: Record<LegId, { count: number; x: number; y: number; z: number }> = {
    FL: { count: 0, x: 0, y: 0, z: 0 },
    FR: { count: 0, x: 0, y: 0, z: 0 },
    RL: { count: 0, x: 0, y: 0, z: 0 },
    RR: { count: 0, x: 0, y: 0, z: 0 },
  };
  const contactCount = data.ncon;
  const listed = data.contact;
  const contacts: PhysicsContact[] = [];
  const shown = Math.min(CONTACT_LIST, listed.size());
  const total = listed.size();
  for (let index = 0; index < total; index += 1) {
    const contact = listed.get(index);
    const geom1 = geomNames[contact.geom1] ?? `geom ${contact.geom1}`;
    const geom2 = geomNames[contact.geom2] ?? `geom ${contact.geom2}`;
    const foot = footOfPair(geom1, geom2);
    if (foot) {
      const bucket = totals[foot];
      bucket.count += 1;
      bucket.x += Number(contact.pos[0] ?? 0);
      bucket.y += Number(contact.pos[1] ?? 0);
      bucket.z += Number(contact.pos[2] ?? 0);
    }
    if (index < shown) contacts.push({ geom1, geom2, distanceM: contact.dist });
    contact.delete();
  }
  listed.delete();
  const feet = {} as Record<LegId, FootState>;
  for (const id of JOINT_ORDER) {
    const sphere = vec3(data.geom(id).xpos);
    const bucket = totals[id];
    feet[id] = {
      sphere,
      clearanceM: sphere[2] - FOOT_RADIUS_M,
      onFloor: bucket.count > 0,
      contact:
        bucket.count > 0
          ? [bucket.x / bucket.count, bucket.y / bucket.count, bucket.z / bucket.count]
          : null,
    };
  }
  return { feet, contacts, contactCount };
}

function readSupport(model: MjModel, data: MjData, feet: Record<LegId, FootState>): SupportState {
  let mass = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let index = 0; index < model.nbody; index += 1) {
    const bodyMass = Number(model.body(index).mass ?? 0);
    if (!(bodyMass > 0)) continue;
    const inertial = data.body(index).xipos;
    mass += bodyMass;
    x += bodyMass * Number(inertial[0] ?? 0);
    y += bodyMass * Number(inertial[1] ?? 0);
    z += bodyMass * Number(inertial[2] ?? 0);
  }
  const com: [number, number, number] = mass > 0 ? [x / mass, y / mass, z / mass] : [0, 0, 0];
  const down = JOINT_ORDER.filter((id) => feet[id].onFloor);
  const points = down.map((id) => planar(feet[id]));
  const assessed = assessSupport([com[0], com[1]], points);
  const triangleIds = ['FR', 'RL', 'RR'] as const;
  const threeLegFeetDown = triangleIds.every((id) => feet[id].onFloor);
  const trianglePoints = triangleIds.map((id) => planar(feet[id]));
  const triangle = threeLegFeetDown
    ? assessSupport([com[0], com[1]], trianglePoints)
    : { polygon: [], inside: false, marginM: null };
  return {
    feet: down,
    polygon: assessed.polygon.map((point) => [point[0], point[1], 0]),
    com,
    comProjection: [com[0], com[1]],
    marginM: assessed.marginM,
    inside: assessed.inside,
    threeLegFeetDown,
    threeLegTriangle: threeLegFeetDown ? triangleIds.map((id) => [planar(feet[id])[0], planar(feet[id])[1], 0]) : [],
    threeLegMarginM: triangle.marginM,
    threeLegInside: triangle.inside,
  };
}

function planar(foot: FootState): Planar {
  const point = foot.contact ?? foot.sphere;
  return [point[0], point[1]];
}

function footOfPair(geom1: string, geom2: string): LegId | null {
  if (geom1 === 'floor' && isFoot(geom2)) return geom2;
  if (geom2 === 'floor' && isFoot(geom1)) return geom1;
  return null;
}

function isFoot(name: string): name is LegId {
  return name === 'FL' || name === 'FR' || name === 'RL' || name === 'RR';
}

function vec3(value: ArrayLike<number>): [number, number, number] {
  return [Number(value[0] ?? 0), Number(value[1] ?? 0), Number(value[2] ?? 0)];
}

function scalar(value: number | ArrayLike<number>): number {
  if (typeof value === 'number') return value;
  return Number(value[0] ?? 0);
}
