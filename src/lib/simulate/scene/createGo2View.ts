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

export type CameraView = 'perspective' | 'top' | 'side';

export interface Go2View {
  readonly ready: Promise<void>;
  setPose(snapshot: PoseSnapshot): void;
  setMarks(marks: readonly TrailMark[]): void;
  setHelpers(grid: boolean, frames: boolean): void;
  setBrushes(left: BrushMount, right: BrushMount): void;
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
  };
  for (const line of Object.values(lines)) scene.add(line);

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

  function setPose(snapshot: PoseSnapshot): void {
    for (const id of ['FL', 'FR', 'RL', 'RR'] as const) {
      const nodes = legs[id];
      const report = snapshot.legs[id];
      if (!nodes || !report) continue;
      nodes.abduction.quaternion.setFromAxisAngle(X_AXIS, report.joints[0]);
      nodes.hip.quaternion.setFromAxisAngle(Y_AXIS, report.joints[1]);
      nodes.knee.quaternion.setFromAxisAngle(Y_AXIS, report.joints[2]);
    }
    paper.position.set(snapshot.paperOrigin[0], snapshot.paperOrigin[1], snapshot.paperOrigin[2] + 0.001);
    paper.scale.set(Math.max(snapshot.paperSize.widthM, 0.01), Math.max(snapshot.paperSize.heightM, 0.01), 1);
    paper.rotation.z = snapshot.paperYawRad;
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
    setMarks,
    setHelpers,
    setBrushes,
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
      brush.add(shaft, tip);
      foot.add(brush);
      knee.add(foot);
      hip.add(knee);
      abduction.add(hip);
      robot.add(abduction);
      legs[id] = { abduction, hip, knee, brush, shaft, tip };
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
