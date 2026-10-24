/**
 * One MuJoCo model and data pair for the Go2.
 *
 * Loading, stepping, and deleting stay here so the browser worker and the
 * node tests share one implementation. This module does not read the host
 * timeline and it does not send motor commands.
 */

import loadMujoco from '@mujoco/mujoco';
import type { Go2JointState } from '../adapters/types.ts';
import { FLOOR_NOTE, TORQUE_NOTE, go2FloorSceneXml } from './scene.ts';
import {
  JOINT_ORDER,
  type PhysicsContact,
  type PhysicsModelInfo,
  type PhysicsSnapshot,
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
  delete(): void;
}

interface MjData {
  time: number;
  ncon: number;
  qpos: ArrayLike<number>;
  ctrl: { length: number; [index: number]: number };
  contact: { size(): number; get(index: number): MjContact; delete(): void };
  body(name: string): { xpos: ArrayLike<number>; xquat: ArrayLike<number> };
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
  step(count: number): PhysicsSnapshot;
  dispose(): void;
}

const ROOT = '/doodog/go2';
const MAX_STEP_REQUEST = 64;
const CONTACT_LIST = 8;

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

  function guard(): void {
    if (disposed) throw new Error('Physics session is disposed.');
  }

  function restoreReference(): PhysicsSnapshot {
    guard();
    mujoco.mj_resetDataKeyframe(model, data, 0);
    for (let index = 0; index < data.ctrl.length; index += 1) data.ctrl[index] = 0;
    mujoco.mj_forward(model, data);
    return readSnapshot(data, geomNames);
  }

  return {
    info,
    reset: restoreReference,
    step(count: number): PhysicsSnapshot {
      guard();
      const steps = Math.max(0, Math.min(MAX_STEP_REQUEST, Math.floor(count)));
      for (let index = 0; index < steps; index += 1) mujoco.mj_step(model, data);
      return readSnapshot(data, geomNames);
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
  for (let index = 0; index < model.nu; index += 1) actuatorNames.push(model.actuator(index).name);
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

function readSnapshot(data: MjData, geomNames: readonly string[]): PhysicsSnapshot {
  const base = data.body('base');
  const qpos = data.qpos;
  const joints = {} as Go2JointState;
  for (let leg = 0; leg < JOINT_ORDER.length; leg += 1) {
    const id = JOINT_ORDER[leg];
    const offset = 7 + leg * 3;
    if (!id) continue;
    joints[id] = [Number(qpos[offset] ?? 0), Number(qpos[offset + 1] ?? 0), Number(qpos[offset + 2] ?? 0)];
  }
  let maxAbsTorqueNm = 0;
  for (let index = 0; index < data.ctrl.length; index += 1) {
    maxAbsTorqueNm = Math.max(maxAbsTorqueNm, Math.abs(Number(data.ctrl[index] ?? 0)));
  }
  const contactCount = data.ncon;
  const listed = data.contact;
  const contacts: PhysicsContact[] = [];
  const shown = Math.min(CONTACT_LIST, listed.size());
  for (let index = 0; index < shown; index += 1) {
    const contact = listed.get(index);
    contacts.push({
      geom1: geomNames[contact.geom1] ?? `geom ${contact.geom1}`,
      geom2: geomNames[contact.geom2] ?? `geom ${contact.geom2}`,
      distanceM: contact.dist,
    });
    contact.delete();
  }
  listed.delete();
  return {
    time: data.time,
    basePosition: [Number(base.xpos[0]), Number(base.xpos[1]), Number(base.xpos[2])],
    baseQuaternion: [
      Number(base.xquat[0]),
      Number(base.xquat[1]),
      Number(base.xquat[2]),
      Number(base.xquat[3]),
    ],
    joints,
    contactCount,
    contacts,
    maxAbsTorqueNm,
  };
}
