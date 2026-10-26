/**
 * Three.js view of the Unitree Go2.
 *
 * The scene uses the MuJoCo frame (+X forward, +Y left, +Z up). Joint
 * transforms are copied from a PoseSnapshot. This file does not sample
 * motion, advance time, or solve inverse kinematics.
 *
 * Rendering runs on demand: a pose change, a camera change, or a resize.
 * A hidden viewport (zero size) does not draw.
 */

import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as THREE from 'three';
import { brushTipInFoot, type BrushCalibration } from '../go2/brush.ts';
import type { BrushMount } from '../go2/defaults.ts';
import type { Vec3 } from '../go2/math.ts';
import {
  BODY_POSITION,
  GO2_MESHES,
  GO2_MODEL,
  LEGS,
  MESH_COLOURS,
  type LegId,
  type MeshMaterialName,
  type MeshPart,
} from '../go2/model.ts';
import { trailLines } from '../go2/paint.ts';
import type { PoseSnapshot, TrailMark } from '../go2/pose.ts';
import type { Go2JointState } from '../adapters/types.ts';
import type { QuatWxyz } from '../physics/types.ts';

export type CameraView = 'perspective' | 'top' | 'side';

export interface PhysicsMeshPose {
  joints: Go2JointState;
  basePosition: Vec3;
  baseQuaternion: QuatWxyz;
}

/** Measured support, the requested foot target, and an air path. Empty arrays hide a mark. */
export interface PhysicsGuide {
  support: readonly Vec3[];
  triangle: readonly Vec3[];
  com: Vec3 | null;
  flTarget: Vec3 | null;
  /** Requested circle. Not ink. */
  desiredPath: readonly Vec3[];
  /** Measured foot frame. Not ink. */
  achievedPath: readonly Vec3[];
  /** Creative brush-down runs. Not ink. */
  brushDown: readonly (readonly Vec3[])[];
  /** Creative brush-up travel. Not ink, and not discarded. */
  brushUp: readonly (readonly Vec3[])[];
  /** Measured brush tip in the world. Geometry, not contact. */
  tipMeasured: Vec3 | null;
  /** Commanded brush tip in the world. Geometry, not contact. */
  tipDesired: Vec3 | null;
}

export interface Go2View {
  readonly ready: Promise<void>;
  setPose(snapshot: PoseSnapshot): void;
  /** Paper only. Physics mode uses this so the sheet can move without pinning the body. */
  setPaper(snapshot: PoseSnapshot): void;
  /** Body pose and joint angles from MuJoCo. Does not move the paper or the paint. */
  setPhysicsPose(pose: PhysicsMeshPose): void;
  /** Support polygon, centre of mass, and the requested foot target. */
  setPhysicsGuide(guide: PhysicsGuide | null): void;
  setMarks(marks: readonly TrailMark[]): void;
  setHelpers(grid: boolean, frames: boolean): void;
  setBrushes(left: BrushMount, right: BrushMount): void;
  /** Places the FL shaft from the attachment to the tip. Null keeps the kinematic mount. */
  setBrushCalibration(calibration: BrushCalibration | null): void;
  setView(view: CameraView): void;
  resize(): void;
  dispose(): void;
}

interface LegNodes {
  abduction: THREE.Group;
  hip: THREE.Group;
  knee: THREE.Group;
  brush: THREE.Group;
  shaft: THREE.Mesh;
  tip: THREE.Mesh;
  attachment: THREE.Mesh;
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export function createGo2View(
  container: HTMLElement,
  hooks: { onReady: () => void; onError: (message: string) => void },
): Go2View {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f7f7);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.04, 30);
  camera.up.set(0, 0, 1);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0xf4f7f7, 1);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.target.set(0.22, 0, 0.1);

  const materials = new Map<MeshMaterialName, THREE.MeshStandardMaterial>();
  for (const name of Object.keys(MESH_COLOURS) as MeshMaterialName[]) {
    const rgb = MESH_COLOURS[name];
    materials.set(
      name,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(rgb[0], rgb[1], rgb[2]),
        roughness: name === 'metal' ? 0.38 : 0.74,
        metalness: name === 'metal' ? 0.12 : 0,
      }),
    );
  }

  const frames: THREE.Object3D[] = [];
  let disposed = false;
  let frame = 0;

  scene.add(new THREE.AmbientLight(0xffffff, 0.74));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(0.9, -0.7, 1.6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd5e4e4, 0.45);
  fill.position.set(-0.8, 0.9, 0.6);
  scene.add(fill);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 2.4),
    new THREE.MeshStandardMaterial({ color: 0xd7e4e4, roughness: 1 }),
  );
  ground.position.z = -0.002;
  scene.add(ground);

  const grid = buildGrid();
  scene.add(grid);

  const worldAxes = new THREE.AxesHelper(0.22);
  scene.add(worldAxes);
  frames.push(worldAxes);

  const robot = new THREE.Group();
  robot.position.set(BODY_POSITION[0], BODY_POSITION[1], BODY_POSITION[2]);
  scene.add(robot);
  const bodyAxes = new THREE.AxesHelper(0.14);
  robot.add(bodyAxes);
  frames.push(bodyAxes);

  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({
      color: 0xfffbff,
      roughness: 0.9,
      transparent: true,
      opacity: 0.94,
      side: THREE.DoubleSide,
    }),
  );
  paper.position.z = 0.001;
  const border = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.5, -0.5, 0.002),
      new THREE.Vector3(0.5, -0.5, 0.002),
      new THREE.Vector3(0.5, 0.5, 0.002),
      new THREE.Vector3(-0.5, 0.5, 0.002),
    ]),
    new THREE.LineBasicMaterial({ color: 0x22113e }),
  );
  paper.add(border);
  const paperAxes = new THREE.AxesHelper(0.1);
  paper.add(paperAxes);
  frames.push(paperAxes);
  scene.add(paper);

  const lines = {
    desiredLeft: makeLine(0x22113e, true),
    desiredRight: makeLine(0xea7dff, true),
    achievedLeft: makeLine(0x08f2db, false),
    achievedRight: makeLine(0x08f2db, false),
    paintLeft: makeLine(0x22113e, false),
    paintRight: makeLine(0xea7dff, false),
    support: makeLine(0x08f2db, false),
    triangle: makeLine(0x22113e, true),
    com: makeLine(0xea7dff, false),
    target: makeLine(0x22113e, true),
  };
  for (const line of Object.values(lines)) scene.add(line);
  const comDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xea7dff }),
  );
  const targetDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x22113e }),
  );
  comDot.visible = false;
  targetDot.visible = false;
  const measuredTipDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.009, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xea7dff }),
  );
  const desiredTipDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.009, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x08f2db }),
  );
  measuredTipDot.visible = false;
  desiredTipDot.visible = false;
  const desiredTube = pathTube(0x22113e);
  const achievedTube = pathTube(0xea7dff);
  const downTubes = [pathTube(0x22113e), pathTube(0x22113e), pathTube(0x22113e), pathTube(0x22113e)];
  const upTubes = [pathTube(0x08f2db), pathTube(0x08f2db), pathTube(0x08f2db), pathTube(0x08f2db)];
  for (const tube of [...downTubes, ...upTubes]) scene.add(tube);
  scene.add(comDot, targetDot, measuredTipDot, desiredTipDot, desiredTube, achievedTube);

  const legs: Partial<Record<LegId, LegNodes>> = {};

  function requestRender(): void {
    if (disposed || frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (disposed) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width < 2 || height < 2) return;
      controls.update();
      renderer.render(scene, camera);
    });
  }

  function resize(): void {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width < 2 || height < 2) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    requestRender();
  }

  function setView(view: CameraView): void {
    camera.up.set(0, 0, 1);
    if (view === 'top') {
      camera.up.set(1, 0, 0);
      camera.position.set(0.3, -0.001, 1.4);
      controls.target.set(0.3, 0, 0);
    } else if (view === 'side') {
      camera.position.set(0.28, -1.25, 0.32);
      controls.target.set(0.28, 0, 0.12);
    } else {
      camera.position.set(0.85, -0.95, 0.58);
      controls.target.set(0.22, 0, 0.1);
    }
    controls.update();
    requestRender();
  }

  function setHelpers(showGrid: boolean, showFrames: boolean): void {
    grid.visible = showGrid;
    for (const helper of frames) helper.visible = showFrames;
    requestRender();
  }

  function setBrushes(left: BrushMount, right: BrushMount): void {
    placeBrush(legs.FL, left, 0x22113e);
    placeBrush(legs.FR, right, 0xea7dff);
    requestRender();
  }

  function setBrushCalibration(calibration: BrushCalibration | null): void {
    const nodes = legs.FL;
    if (!nodes) return;
    if (!calibration) {
      nodes.attachment.position.set(0, 0, 0);
      nodes.attachment.visible = nodes.brush.visible;
      requestRender();
      return;
    }
    const localTip = brushTipInFoot(calibration);
    const mount = new THREE.Vector3(calibration.mountOffset[0], calibration.mountOffset[1], calibration.mountOffset[2]);
    const tip = new THREE.Vector3(localTip[0], localTip[1], localTip[2]);
    const direction = tip.clone().sub(mount);
    const length = Math.max(direction.length(), 0.001);
    direction.normalize();
    nodes.brush.visible = true;
    nodes.shaft.scale.set(1, length, 1);
    nodes.shaft.position.copy(mount).addScaledVector(direction, length * 0.5);
    nodes.shaft.quaternion.setFromUnitVectors(Y_AXIS, direction);
    nodes.tip.position.copy(tip);
    nodes.attachment.position.copy(mount);
    nodes.attachment.visible = true;
    const shaftMaterial = nodes.shaft.material;
    const tipMaterial = nodes.tip.material;
    const attachmentMaterial = nodes.attachment.material;
    if (shaftMaterial instanceof THREE.MeshStandardMaterial) shaftMaterial.color.setHex(0x22113e);
    if (tipMaterial instanceof THREE.MeshStandardMaterial) tipMaterial.color.setHex(0xea7dff);
    if (attachmentMaterial instanceof THREE.MeshStandardMaterial) attachmentMaterial.color.setHex(0x08f2db);
    requestRender();
  }

  function applyJoints(joints: Go2JointState): void {
    for (const id of ['FL', 'FR', 'RL', 'RR'] as const) {
      const nodes = legs[id];
      const angles = joints[id];
      if (!nodes || !angles) continue;
      nodes.abduction.quaternion.setFromAxisAngle(X_AXIS, angles[0]);
      nodes.hip.quaternion.setFromAxisAngle(Y_AXIS, angles[1]);
      nodes.knee.quaternion.setFromAxisAngle(Y_AXIS, angles[2]);
    }
  }

  function pinBase(): void {
    robot.position.set(BODY_POSITION[0], BODY_POSITION[1], BODY_POSITION[2]);
    robot.quaternion.identity();
  }

  function setPaper(snapshot: PoseSnapshot): void {
    paper.position.set(snapshot.paperOrigin[0], snapshot.paperOrigin[1], snapshot.paperOrigin[2] + 0.001);
    paper.scale.set(Math.max(snapshot.paperSize.widthM, 0.01), Math.max(snapshot.paperSize.heightM, 0.01), 1);
    paper.rotation.z = snapshot.paperYawRad;
    requestRender();
  }

  function setPose(snapshot: PoseSnapshot): void {
    pinBase();
    applyJoints({
      FL: [snapshot.legs.FL.joints[0], snapshot.legs.FL.joints[1], snapshot.legs.FL.joints[2]],
      FR: [snapshot.legs.FR.joints[0], snapshot.legs.FR.joints[1], snapshot.legs.FR.joints[2]],
      RL: [snapshot.legs.RL.joints[0], snapshot.legs.RL.joints[1], snapshot.legs.RL.joints[2]],
      RR: [snapshot.legs.RR.joints[0], snapshot.legs.RR.joints[1], snapshot.legs.RR.joints[2]],
    });
    setPaper(snapshot);
  }

  function setPhysicsPose(pose: PhysicsMeshPose): void {
    applyJoints(pose.joints);
    robot.position.set(pose.basePosition[0], pose.basePosition[1], pose.basePosition[2]);
    const quat = pose.baseQuaternion;
    robot.quaternion.set(quat[1], quat[2], quat[3], quat[0]);
    requestRender();
  }

  function setPhysicsGuide(guide: PhysicsGuide | null): void {
    setSegments(lines.support, guide ? loopPairs(guide.support, 0.004) : []);
    setSegments(lines.triangle, guide ? loopPairs(guide.triangle, 0.006) : []);
    if (guide?.com) {
      comDot.visible = true;
      comDot.position.set(guide.com[0], guide.com[1], 0.012);
      setSegments(lines.com, [
        [
          [guide.com[0], guide.com[1], guide.com[2]],
          [guide.com[0], guide.com[1], 0.004],
        ],
      ]);
    } else {
      comDot.visible = false;
      setSegments(lines.com, []);
    }
    if (guide?.flTarget) {
      targetDot.visible = true;
      targetDot.position.set(guide.flTarget[0], guide.flTarget[1], guide.flTarget[2]);
      setSegments(lines.target, [
        [
          [guide.flTarget[0], guide.flTarget[1], guide.flTarget[2]],
          [guide.flTarget[0], guide.flTarget[1], 0.004],
        ],
      ]);
    } else {
      targetDot.visible = false;
      setSegments(lines.target, []);
    }
    if (guide?.tipMeasured) {
      measuredTipDot.visible = true;
      measuredTipDot.position.set(guide.tipMeasured[0], guide.tipMeasured[1], guide.tipMeasured[2]);
    } else {
      measuredTipDot.visible = false;
    }
    if (guide?.tipDesired) {
      desiredTipDot.visible = true;
      desiredTipDot.position.set(guide.tipDesired[0], guide.tipDesired[1], guide.tipDesired[2]);
    } else {
      desiredTipDot.visible = false;
    }
    setTube(desiredTube, guide?.desiredPath ?? []);
    setTube(achievedTube, guide?.achievedPath ?? []);
    downTubes.forEach((tube, index) => setTube(tube, guide?.brushDown?.[index] ?? []));
    upTubes.forEach((tube, index) => setTube(tube, guide?.brushUp?.[index] ?? []));
    requestRender();
  }

  function setMarks(marks: readonly TrailMark[]): void {
    const left = trailLines(marks.filter((mark) => mark.side === 'left'));
    const right = trailLines(marks.filter((mark) => mark.side === 'right'));
    setSegments(lines.desiredLeft, raise(left.desired, 0.004));
    setSegments(lines.desiredRight, raise(right.desired, 0.004));
    setSegments(lines.achievedLeft, left.achieved);
    setSegments(lines.achievedRight, right.achieved);
    setSegments(lines.paintLeft, raise(left.paint, 0.006));
    setSegments(lines.paintRight, raise(right.paint, 0.006));
    requestRender();
  }

  const ready = loadModel()
    .then(() => {
      if (disposed) return;
      hooks.onReady();
      setView('perspective');
      resize();
    })
    .catch((error: unknown) => {
      if (disposed) return;
      const message = error instanceof Error ? error.message : 'The Go2 model failed to load.';
      hooks.onError(message);
    });

  controls.addEventListener('change', requestRender);

  return {
    ready,
    setPose,
    setPaper,
    setPhysicsPose,
    setPhysicsGuide,
    setMarks,
    setHelpers,
    setBrushes,
    setBrushCalibration,
    setView,
    resize,
    dispose() {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      controls.dispose();
      const geometries = new Set<THREE.BufferGeometry>();
      const materialSet = new Set<THREE.Material>();
      scene.traverse((child) => {
        const withGeom = child as THREE.Mesh;
        if (!withGeom.geometry) return;
        geometries.add(withGeom.geometry);
        const material = withGeom.material;
        const list = Array.isArray(material) ? material : material ? [material] : [];
        for (const item of list) materialSet.add(item);
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materialSet) material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };

  async function loadModel(): Promise<void> {
    const loader = new OBJLoader();
    const files = uniqueFiles();
    const loaded = new Map<string, THREE.Object3D>();
    await Promise.all(
      [...files].map(async (file) => {
        const root = await loader.loadAsync(`${GO2_MODEL.meshRoot}${file}`);
        loaded.set(file, root);
      }),
    );
    if (disposed) return;

    const partGroup = (parts: readonly MeshPart[]): THREE.Group => {
      const group = new THREE.Group();
      for (const part of parts) {
        const source = loaded.get(part.file);
        const material = materials.get(part.material);
        if (!source || !material) continue;
        source.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          const mesh = new THREE.Mesh(child.geometry, material);
          mesh.position.copy(child.position);
          mesh.quaternion.copy(child.quaternion);
          mesh.scale.copy(child.scale);
          group.add(mesh);
        });
      }
      return group;
    };

    const templates = {
      base: partGroup(GO2_MESHES.base),
      hip: partGroup(GO2_MESHES.hip),
      thigh: partGroup(GO2_MESHES.thigh),
      thighMirror: partGroup(GO2_MESHES.thighMirror),
      calf: partGroup(GO2_MESHES.calf),
      calfMirror: partGroup(GO2_MESHES.calfMirror),
      foot: partGroup(GO2_MESHES.foot),
    };
    robot.add(templates.base);

    for (const id of ['FL', 'FR', 'RL', 'RR'] as const) {
      const spec = LEGS[id];
      const abduction = new THREE.Group();
      abduction.position.set(spec.hipPosition[0], spec.hipPosition[1], spec.hipPosition[2]);
      const visual = new THREE.Group();
      const quat = spec.hipMeshQuat;
      visual.quaternion.set(quat[1], quat[2], quat[3], quat[0]);
      visual.add(templates.hip.clone(true));
      abduction.add(visual);

      const hip = new THREE.Group();
      hip.position.set(0, spec.thighOffsetY, 0);
      hip.add((spec.mirrorThigh ? templates.thighMirror : templates.thigh).clone(true));

      const knee = new THREE.Group();
      knee.position.set(0, 0, -spec.thighLength);
      knee.add((spec.mirrorCalf ? templates.calfMirror : templates.calf).clone(true));

      const foot = new THREE.Group();
      foot.position.set(spec.footInCalf[0], spec.footInCalf[1], spec.footInCalf[2]);
      foot.add(templates.foot.clone(true));
      const footAxes = new THREE.AxesHelper(0.05);
      foot.add(footAxes);
      frames.push(footAxes);

      const brush = new THREE.Group();
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0035, 0.0035, 1, 10),
        new THREE.MeshStandardMaterial({ color: 0x22113e, roughness: 0.45 }),
      );
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.008, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0xea7dff, roughness: 0.4 }),
      );
      const attachment = new THREE.Mesh(
        new THREE.SphereGeometry(0.006, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0x08f2db, roughness: 0.4 }),
      );
      brush.add(shaft, tip, attachment);
      foot.add(brush);
      knee.add(foot);
      hip.add(knee);
      abduction.add(hip);
      robot.add(abduction);
      legs[id] = { abduction, hip, knee, brush, shaft, tip, attachment };
    }
  }
}

function uniqueFiles(): Set<string> {
  const files = new Set<string>();
  for (const group of Object.values(GO2_MESHES)) {
    for (const part of group) files.add(part.file);
  }
  return files;
}

function buildGrid(): THREE.Group {
  const group = new THREE.Group();
  const points: THREE.Vector3[] = [];
  for (let x = -0.6; x <= 1.2 + 1e-6; x += 0.1) {
    points.push(new THREE.Vector3(x, -0.7, 0), new THREE.Vector3(x, 0.7, 0));
  }
  for (let y = -0.7; y <= 0.7 + 1e-6; y += 0.1) {
    points.push(new THREE.Vector3(-0.6, y, 0), new THREE.Vector3(1.2, y, 0));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x22113e, transparent: true, opacity: 0.18 })));
  return group;
}

function makeLine(color: number, dashed: boolean): THREE.LineSegments {
  const material = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.008, gapSize: 0.006 })
    : new THREE.LineBasicMaterial({ color });
  const line = new THREE.LineSegments(new THREE.BufferGeometry(), material);
  line.frustumCulled = false;
  return line;
}

function pathTube(color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color }));
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

/** Display thickness only. The path coordinates stay on the foot frame. */
function setTube(mesh: THREE.Mesh, points: readonly Vec3[]): void {
  mesh.geometry.dispose();
  if (points.length < 2) {
    mesh.geometry = new THREE.BufferGeometry();
    mesh.visible = false;
    return;
  }
  const curve = new THREE.CatmullRomCurve3(
    points.map((point) => new THREE.Vector3(point[0], point[1], point[2])),
  );
  mesh.geometry = new THREE.TubeGeometry(curve, Math.max(8, points.length), 0.002, 6, false);
  mesh.visible = true;
}

function loopPairs(points: readonly Vec3[], z: number): Array<[Vec3, Vec3]> {
  if (points.length < 3) return [];
  const pairs: Array<[Vec3, Vec3]> = [];
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    if (!start || !end) continue;
    pairs.push([
      [start[0], start[1], z],
      [end[0], end[1], z],
    ]);
  }
  return pairs;
}

function raise(pairs: Array<[Vec3, Vec3]>, amount: number): Array<[Vec3, Vec3]> {
  return pairs.map(([a, b]) => [
    [a[0], a[1], a[2] + amount],
    [b[0], b[1], b[2] + amount],
  ]);
}

function setSegments(line: THREE.LineSegments, pairs: Array<[Vec3, Vec3]>): void {
  const positions = new Float32Array(Math.max(pairs.length, 1) * 6);
  pairs.forEach(([a, b], index) => {
    positions.set([a[0], a[1], a[2], b[0], b[1], b[2]], index * 6);
  });
  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry();
  line.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (pairs.length === 0) line.geometry.setDrawRange(0, 0);
  if (line.material instanceof THREE.LineDashedMaterial) line.computeLineDistances();
}

function placeBrush(nodes: LegNodes | undefined, mount: BrushMount, color: number): void {
  if (!nodes) return;
  nodes.brush.visible = mount.visible;
  const offset = new THREE.Vector3(mount.offset[0], mount.offset[1], mount.offset[2]);
  const length = Math.max(offset.length(), 0.001);
  nodes.shaft.scale.set(1, length, 1);
  nodes.shaft.position.copy(offset).multiplyScalar(0.5);
  const direction = offset.clone().normalize();
  if (direction.lengthSq() > 0) {
    nodes.shaft.quaternion.setFromUnitVectors(Y_AXIS, direction);
  }
  nodes.tip.position.copy(offset);
  const material = nodes.tip.material;
  if (material instanceof THREE.MeshStandardMaterial) material.color.setHex(color);
  const shaftMaterial = nodes.shaft.material;
  if (shaftMaterial instanceof THREE.MeshStandardMaterial) shaftMaterial.color.setHex(color);
}
