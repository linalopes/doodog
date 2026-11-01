/**
 * Brush Approach preflight. It classifies the existing gates.
 *
 * It does not change the 5 mm residual, the 5-pass solver, the foot-height
 * gate, or the controller. A jacobian residual and a longer fixed-point trace
 * are comparisons. They are not commands.
 *
 * The path has seven samples, including both ends (`FOOT_PATH_STEPS` is 6).
 * That is the same resolution the approach gate uses. Sampled clearance is
 * not continuous collision freedom. Triangle meshes are not evaluated.
 */

import {
  brushTipInFoot,
  brushWorld,
  calibrationFrom,
  clearanceTarget,
  FOOT_PATH_STEPS,
  paperFrom,
  pathReachable,
  solveTipTarget,
  TIP_SOLVE_PASSES,
  type BrushCalibration,
} from '../go2/brush.ts';
import { analyticalFoot, forwardLeg, REACH_TOLERANCE_M, solveLeg } from '../go2/kinematics.ts';
import { quatMul, quatRotate, sub, type Quat, type Vec3 } from '../go2/math.ts';
import { BODY_POSITION, LEGS, REFERENCE_ANGLES } from '../go2/model.ts';
import { brushAngleToPaper } from '../go2/posture.ts';
import { applyGroundCandidate, boardSpec, isCandidate, isGround, platformSpec, sphereHitsPlatform } from './candidate.ts';
import { FOOT_RADIUS_M, type ExperimentConfig } from './settings.ts';
import type { PhysicsSnapshot } from './types.ts';

export const PROGRESSIVE_CLEARANCE_M = [0.03, 0.02, 0.01] as const;

/** Extra fixed-point passes recorded for diagnosis. The gate still stops at 5. */
const TRACE_PASSES = 12;

export type GateStatus = 'passed' | 'failed' | 'not-evaluated';

export type ApproachClass =
  | 'accepted'
  | 'solver-nonconvergence'
  | 'safety-gate'
  | 'hard-geometric'
  | 'support'
  | 'not-evaluated';

export interface GateCheck {
  id: string;
  label: string;
  status: GateStatus;
  detail: string;
}

export interface PathSampleReport {
  index: number;
  /** Fraction along the straight foot-frame segment. */
  u: number;
  foot: Vec3;
  tip: Vec3 | null;
  /** Collision-sphere centre. Not the foot frame and not the brush tip. */
  sphere: Vec3 | null;
  footClearanceM: number | null;
  ik: GateStatus;
  calf: 'not-evaluated';
  mesh: 'not-evaluated';
}

export interface ApproachPreflight {
  requestedClearanceM: number;
  requestedTip: Vec3;
  /** Tip of the 5-pass solution. Not a measured MuJoCo position. */
  predictedTip: Vec3 | null;
  /** Foot frame of that solution. Not the collision sphere. */
  predictedFoot: Vec3 | null;
  predictedSphere: Vec3 | null;
  footQuat: Quat | null;
  footClearanceM: number | null;
  /** Euclidean tip residual after 5 passes. This is the reported geometric gap. */
  tipResidualM: number | null;
  /** Residual of the same iteration after `TRACE_PASSES`. Not used by the gate. */
  continuedResidualM: number | null;
  /** 1-based pass that first reaches 5 mm. Null when none of the trace does. */
  passesToGate: number | null;
  passResidualM: number[];
  /** `solveLeg` residual. The approach gate does not call it. */
  jacobianResidualM: number | null;
  jacobianOnLimit: boolean | null;
  brushAngleDeg: number | null;
  shaft: Vec3 | null;
  jointsDeg: [number, number, number] | null;
  jointMarginDeg: [number, number, number] | null;
  gates: GateCheck[];
  firstFailure: string | null;
  pathSteps: number;
  path: PathSampleReport[];
  firstRejectedSample: number | null;
  classification: ApproachClass;
  physicalTracking: 'not-evaluated';
  mesh: 'not-evaluated';
  note: string;
}

export interface HomeFootReport {
  keyframePosition: Vec3;
  keyframeJoints: readonly [number, number, number];
  radiusM: number;
  kinematicSphere: Vec3;
  kinematicFrame: Vec3;
  kinematicClearanceM: number;
  /** Present when a MuJoCo snapshot was supplied. */
  mujocoSphere: Vec3 | null;
  mujocoFrame: Vec3 | null;
  mujocoClearanceM: number | null;
  contactDistanceM: number | null;
  sphereMatchesMujoco: boolean | null;
  contactMatchesClearance: boolean | null;
  onHomeKeyframe: boolean | null;
  mesh: 'not-evaluated';
  conclusion: string;
}

/** The Phase 05I leading sheet. This is a fixed reference, not a new search. */
export function groundReferenceConfig(config: ExperimentConfig): ExperimentConfig {
  return applyGroundCandidate(config, {
    calibration: {
      mountOffset: [0.05, 0, -0.015],
      rollRad: 0,
      pitchRad: (15 * Math.PI) / 180,
      yawRad: 0,
      lengthM: 0.12,
    },
    origin: [0.16, 0.14, 0],
    yawRad: 0,
    boardThicknessM: 0,
  });
}

export function auditApproach(input: {
  config: ExperimentConfig;
  body: Vec3;
  orientation: Quat;
  liftFoot: Vec3;
  seed: readonly [number, number, number];
  supportReady: boolean;
}): ApproachPreflight {
  const calibration = calibrationFrom(input.config);
  const paper = paperFrom(input.config);
  const requestedTip = clearanceTarget(paper, input.config.brushClearanceM);
  const solved = solveTipTarget(input.body, input.orientation, requestedTip, calibration, input.seed);
  const trace = traceTip(input.body, input.orientation, requestedTip, calibration, input.seed);
  const jacobian = jacobianResidual(input.body, input.orientation, requestedTip, calibration);
  const path = sampleFootPath(input.body, input.orientation, input.liftFoot, solved.foot, calibration);
  const pathOk = pathReachable(input.body, input.orientation, input.liftFoot, solved.foot);
  const pose = poseOf(input.body, input.orientation, solved.joints, calibration);
  const margins = jointMargins(solved.joints);
  const onLimit = margins.some((margin) => margin < (1e-3 * 180) / Math.PI);
  const footBelow = solved.foot[2] < input.liftFoot[2] - 1e-4;
  const board = boardHit(input.liftFoot, solved.foot, input.config);
  const passesToGate = trace.findIndex((value) => value <= REACH_TOLERANCE_M);
  const continued = trace[trace.length - 1] ?? null;
  const laterReaches = continued !== null && continued <= REACH_TOLERANCE_M;
  const jacobianReaches = jacobian.residualM <= REACH_TOLERANCE_M && !jacobian.onLimit;

  const gates: GateCheck[] = [
    {
      id: 'support',
      label: 'Three-leg support',
      status: input.supportReady ? 'passed' : 'failed',
      detail: input.supportReady
        ? 'Stand, Shift, and Lift met their measurements before this check.'
        : 'Three-leg support was not established. The approach move was not commanded.',
    },
    {
      id: 'tip-residual',
      label: 'Tip residual after 5 passes',
      status: solved.reachable ? 'passed' : 'failed',
      detail: `The 5-pass tip is ${(solved.errorM * 1000).toFixed(1)} mm from the request. The gate allows ${REACH_TOLERANCE_M * 1000} mm. This distance is the brush tip, not the foot frame and not the collision sphere.`,
    },
    {
      id: 'foot-path',
      label: 'Foot-path inverse kinematics',
      status: pathOk ? 'passed' : 'failed',
      detail: pathOk
        ? `All ${FOOT_PATH_STEPS + 1} foot-frame samples have an inverse-kinematics solution. That is not continuous collision freedom.`
        : `A foot-frame sample has no inverse-kinematics solution. The path has ${FOOT_PATH_STEPS + 1} samples.`,
    },
    {
      id: 'foot-height',
      label: 'Foot above the lift',
      status: footBelow ? 'failed' : 'passed',
      detail: footBelow
        ? `The solved foot is at ${(solved.foot[2] * 1000).toFixed(1)} mm, below the lifted foot at ${(input.liftFoot[2] * 1000).toFixed(1)} mm.`
        : `The solved foot is at ${(solved.foot[2] * 1000).toFixed(1)} mm. The lifted foot is at ${(input.liftFoot[2] * 1000).toFixed(1)} mm.`,
    },
    {
      id: 'board',
      label: 'Board or platform on the foot path',
      status: board.failed ? 'failed' : 'passed',
      detail: board.detail,
    },
    {
      id: 'joint-limits',
      label: 'Joint limits of the 5-pass pose',
      status: onLimit ? 'failed' : 'passed',
      detail: onLimit
        ? 'A solved joint is on a limit. The approach gate does not use a separate limit stop.'
        : `Margins ${margins.map((margin) => `${margin.toFixed(1)}°`).join(', ')}.`,
    },
    {
      id: 'jacobian',
      label: 'Jacobian tip solve',
      status: 'not-evaluated',
      detail: `solveLeg residual ${(jacobian.residualM * 1000).toFixed(3)} mm${jacobian.onLimit ? ', on a joint limit' : ''}. Brush Approach does not call this solver, so the residual is not a pass.`,
    },
    {
      id: 'continued-passes',
      label: 'Further fixed-point passes',
      status: 'not-evaluated',
      detail:
        passesToGate >= 0
          ? `The same iteration is within 5 mm on pass ${passesToGate + 1}. The gate stops at pass ${TIP_SOLVE_PASSES}.`
          : `None of ${TRACE_PASSES} passes is within 5 mm.`,
    },
    {
      id: 'calf',
      label: 'Calf and link primitives on the path',
      status: 'not-evaluated',
      detail: 'Calf cylinders were not tested along this path.',
    },
    {
      id: 'mesh',
      label: 'Triangle meshes',
      status: 'not-evaluated',
      detail: 'Mesh collision was not evaluated.',
    },
    {
      id: 'tracking',
      label: 'Physical tip tracking',
      status: 'not-evaluated',
      detail: 'This report is geometric. It is not a measured MuJoCo tip.',
    },
  ];

  const stopping = ['support', 'tip-residual', 'foot-path', 'foot-height', 'board'];
  const first = gates.find((gate) => stopping.includes(gate.id) && gate.status === 'failed') ?? null;
  let classification: ApproachClass = 'accepted';
  if (!input.supportReady) classification = 'support';
  else if (!solved.reachable && (laterReaches || jacobianReaches) && pathOk && !footBelow && !board.failed) {
    classification = 'solver-nonconvergence';
  } else if (!solved.reachable || !pathOk) classification = 'hard-geometric';
  else if (footBelow || board.failed) classification = 'safety-gate';

  const gap = solved.errorM * 1000;
  const note =
    classification === 'solver-nonconvergence'
      ? `The geometric gap of ${gap.toFixed(1)} mm is the 5-pass brush-tip residual. The foot path is solvable, the foot stays above the lift, and the joints are inside their limits. A later pass of the same iteration, and the existing jacobian solver, both reach the tip. Neither is commanded. Triangle meshes were not evaluated.`
      : classification === 'safety-gate'
        ? 'The tip solver met the 5 mm residual, and a later gate refused the move. The refusal was not changed.'
        : classification === 'hard-geometric'
          ? `The 5-pass residual is ${gap.toFixed(1)} mm, and neither a longer trace nor the jacobian solver placed the tip within 5 mm. That target was not replaced.`
          : classification === 'support'
            ? 'The approach was not checked past support, because the stance had not been established.'
            : 'The existing gates accept this target. Acceptance is not a measured tracking result.';

  return {
    requestedClearanceM: input.config.brushClearanceM,
    requestedTip,
    predictedTip: pose.tip,
    predictedFoot: solved.foot,
    predictedSphere: pose.sphere,
    footQuat: pose.footQuat,
    footClearanceM: pose.sphere ? pose.sphere[2] - FOOT_RADIUS_M : null,
    tipResidualM: solved.errorM,
    continuedResidualM: continued,
    passesToGate: passesToGate >= 0 ? passesToGate + 1 : null,
    passResidualM: trace,
    jacobianResidualM: jacobian.residualM,
    jacobianOnLimit: jacobian.onLimit,
    brushAngleDeg: pose.angleDeg,
    shaft: pose.shaft,
    jointsDeg: [
      (solved.joints[0] * 180) / Math.PI,
      (solved.joints[1] * 180) / Math.PI,
      (solved.joints[2] * 180) / Math.PI,
    ],
    jointMarginDeg: [margins[0] ?? 0, margins[1] ?? 0, margins[2] ?? 0],
    gates,
    firstFailure: first ? first.label : null,
    pathSteps: FOOT_PATH_STEPS,
    path,
    firstRejectedSample: path.find((sample) => sample.ik === 'failed')?.index ?? null,
    classification,
    physicalTracking: 'not-evaluated',
    mesh: 'not-evaluated',
    note,
  };
}

/**
 * Home-keyframe foot penetration.
 * The kinematic sphere uses the published keyframe. A snapshot is compared
 * with it and is not used to move the robot.
 */
export function describeHomeFoot(snapshot: PhysicsSnapshot | null = null): HomeFootReport {
  const joints = REFERENCE_ANGLES;
  const pose = forwardLeg('FL', joints, [0, 0, 0]);
  const kinematicSphere: Vec3 = [
    pose.sphere[0] + BODY_POSITION[0],
    pose.sphere[1] + BODY_POSITION[1],
    pose.sphere[2] + BODY_POSITION[2],
  ];
  const kinematicFrame: Vec3 = [
    pose.foot[0] + BODY_POSITION[0],
    pose.foot[1] + BODY_POSITION[1],
    pose.foot[2] + BODY_POSITION[2],
  ];
  const kinematicClearanceM = kinematicSphere[2] - FOOT_RADIUS_M;
  const contact = snapshot?.contacts.find((item) => item.geom1 === 'FL' || item.geom2 === 'FL') ?? null;
  const onHome = snapshot ? onHomeKeyframe(snapshot) : null;
  const sphereMatches =
    snapshot && onHome ? distance(snapshot.feet.FL.sphere, kinematicSphere) < 1e-4 : null;
  const contactMatches =
    contact && onHome ? Math.abs(contact.distanceM - kinematicClearanceM) < 1e-4 : null;
  const conclusion = onHome === false
    ? 'This pose is not the home keyframe. The kinematic sphere below is the published keyframe, and it was not applied to the robot.'
    : `The home keyframe is position (0, 0, 0.270) m, identity orientation, and joints (0, 0.9, −1.8) rad. The foot collision sphere has radius 22 mm. Its centre is ${(kinematicSphere[2] * 1000).toFixed(1)} mm above the floor, so the clearance is ${(kinematicClearanceM * 1000).toFixed(1)} mm. The visual foot origin is ${(kinematicFrame[2] * 1000).toFixed(1)} mm above the floor. ${
        sphereMatches
          ? 'MuJoCo’s sphere centre matches that kinematic centre. '
          : ''
      }${
        contactMatches
          ? `The floor contact distance is ${(contact!.distanceM * 1000).toFixed(1)} mm, the same intersection. `
          : ''
      }The penetration is the collision sphere through the floor plane. It is not a frame mismatch and the radius was not subtracted twice. The visual mesh is not a collision geom. Triangle meshes were not evaluated. The keyframe was not rewritten.`;
  return {
    keyframePosition: [BODY_POSITION[0], BODY_POSITION[1], BODY_POSITION[2]],
    keyframeJoints: joints,
    radiusM: FOOT_RADIUS_M,
    kinematicSphere,
    kinematicFrame,
    kinematicClearanceM,
    mujocoSphere: snapshot ? snapshot.feet.FL.sphere : null,
    mujocoFrame: snapshot ? snapshot.feet.FL.frame : null,
    mujocoClearanceM: snapshot ? snapshot.feet.FL.clearanceM : null,
    contactDistanceM: contact ? contact.distanceM : null,
    sphereMatchesMujoco: sphereMatches,
    contactMatchesClearance: contactMatches,
    onHomeKeyframe: onHome,
    mesh: 'not-evaluated',
    conclusion,
  };
}

function traceTip(
  body: Vec3,
  orientation: Quat,
  target: Vec3,
  calibration: BrushCalibration,
  seed: readonly [number, number, number],
): number[] {
  let joints: [number, number, number] = [seed[0], seed[1], seed[2]];
  const residuals: number[] = [];
  for (let pass = 0; pass < TRACE_PASSES; pass += 1) {
    const pose = forwardLeg('FL', joints, [0, 0, 0]);
    const footQuat = quatMul(orientation, pose.footRotation);
    const foot = sub(target, quatRotate(footQuat, brushTipInFoot(calibration)));
    const solved = analyticalFoot('FL', worldPointToBody(body, orientation, foot));
    if (!solved) break;
    joints = [solved.joints[0], solved.joints[1], solved.joints[2]];
    const next = forwardLeg('FL', joints, [0, 0, 0]);
    const worldFoot = addVec(body, quatRotate(orientation, next.foot));
    const tip = brushWorld(worldFoot, quatMul(orientation, next.footRotation), calibration).tip;
    residuals.push(Math.hypot(tip[0] - target[0], tip[1] - target[1], tip[2] - target[2]));
  }
  return residuals;
}

function jacobianResidual(
  body: Vec3,
  orientation: Quat,
  target: Vec3,
  calibration: BrushCalibration,
): { residualM: number; onLimit: boolean } {
  const local = worldPointToBody(body, orientation, target);
  const solved = solveLeg('FL', local, brushTipInFoot(calibration));
  return { residualM: solved.positionErrorM, onLimit: solved.onLimit };
}

function sampleFootPath(
  body: Vec3,
  orientation: Quat,
  from: Vec3,
  to: Vec3,
  calibration: BrushCalibration,
): PathSampleReport[] {
  const samples: PathSampleReport[] = [];
  for (let index = 0; index <= FOOT_PATH_STEPS; index += 1) {
    const u = index / FOOT_PATH_STEPS;
    const foot: Vec3 = [
      from[0] + (to[0] - from[0]) * u,
      from[1] + (to[1] - from[1]) * u,
      from[2] + (to[2] - from[2]) * u,
    ];
    const solved = analyticalFoot('FL', worldPointToBody(body, orientation, foot));
    if (!solved || !solved.reachable) {
      samples.push({
        index,
        u,
        foot,
        tip: null,
        sphere: null,
        footClearanceM: null,
        ik: 'failed',
        calf: 'not-evaluated',
        mesh: 'not-evaluated',
      });
      continue;
    }
    const pose = poseOf(body, orientation, solved.joints, calibration);
    samples.push({
      index,
      u,
      foot,
      tip: pose.tip,
      sphere: pose.sphere,
      footClearanceM: pose.sphere ? pose.sphere[2] - FOOT_RADIUS_M : null,
      ik: 'passed',
      calf: 'not-evaluated',
      mesh: 'not-evaluated',
    });
  }
  return samples;
}

function poseOf(
  body: Vec3,
  orientation: Quat,
  joints: readonly [number, number, number],
  calibration: BrushCalibration,
): { tip: Vec3; sphere: Vec3; footQuat: Quat; shaft: Vec3; angleDeg: number } {
  const local = forwardLeg('FL', joints, [0, 0, 0]);
  const footQuat = quatMul(orientation, local.footRotation);
  const worldFoot = addVec(body, quatRotate(orientation, local.foot));
  const world = brushWorld(worldFoot, footQuat, calibration);
  const sphere = addVec(body, quatRotate(orientation, local.sphere));
  const shaft = quatRotate(world.rotation, [0, 0, -1]);
  return {
    tip: world.tip,
    sphere,
    footQuat,
    shaft,
    angleDeg: (brushAngleToPaper(shaft) * 180) / Math.PI,
  };
}

function boardHit(start: Vec3, end: Vec3, config: ExperimentConfig): { failed: boolean; detail: string } {
  const spec = isCandidate(config) ? platformSpec(config) : isGround(config) ? boardSpec(config) : null;
  if (!spec) {
    return {
      failed: false,
      detail: 'There is no collision board. The paper uses the existing floor. Calf cylinders and triangle meshes were not evaluated.',
    };
  }
  for (let step = 0; step <= 12; step += 1) {
    const t = step / 12;
    const point: Vec3 = [
      start[0] + (end[0] - start[0]) * t,
      start[1] + (end[1] - start[1]) * t,
      start[2] + (end[2] - start[2]) * t,
    ];
    if (sphereHitsPlatform(point, FOOT_RADIUS_M, spec)) {
      return {
        failed: true,
        detail: 'The foot-frame path meets the collision box. The gate tests that frame with the 22 mm radius. It is not a mesh test.',
      };
    }
  }
  return {
    failed: false,
    detail: 'The foot-frame samples miss the collision box. Calf cylinders and triangle meshes were not evaluated.',
  };
}

function jointMargins(joints: readonly [number, number, number]): number[] {
  const spec = LEGS.FL;
  const pairs = [
    [joints[0], spec.abduction.min, spec.abduction.max],
    [joints[1], spec.hip.min, spec.hip.max],
    [joints[2], spec.knee.min, spec.knee.max],
  ] as const;
  return pairs.map(([value, min, max]) => (Math.min(value - min, max - value) * 180) / Math.PI);
}

function onHomeKeyframe(snapshot: PhysicsSnapshot): boolean {
  const position = distance(snapshot.basePosition, BODY_POSITION) < 1e-3;
  const joints = snapshot.joints.FL.every((value, index) => {
    const expected = REFERENCE_ANGLES[index];
    return expected !== undefined && Math.abs(value - expected) < 1e-3;
  });
  const upright = Math.abs(snapshot.rollRad) < 1e-3 && Math.abs(snapshot.pitchRad) < 1e-3;
  return position && joints && upright;
}

function worldPointToBody(body: Vec3, orientation: Quat, world: Vec3): Vec3 {
  return quatRotate([orientation[0], -orientation[1], -orientation[2], -orientation[3]], sub(world, body));
}

function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
}
