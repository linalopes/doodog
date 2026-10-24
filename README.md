# doodog

**doodog — Drawing with four legs.**

**doodog studio — A creative coding environment for robotic drawing.**

doodog is the artistic project. doodog studio is the creative coding application: p5.js for parametric drawing, and Three.js for a kinematic view of those movements on a Unitree Go2. MuJoCo physics and physical robot control are later phases.

Repository: [linalopes/doodog](https://github.com/linalopes/doodog)  
Package identifier: `doodog`

**Phase 02B · Kinematic preview.** One host timeline samples `motion(t)` and poses a Unitree Go2 in Three.js. The result is labeled **Kinematic Preview — Not Physically Validated**. Physics and the physical robot are not in this phase.

Concept, interaction design and development: [Lina Lopes](https://linalopes.info/)

Institutional context: [School of Tomorrow's AI](https://schoolai.linalopes.info/)

Visual identity: [School of Tomorrow's AI brand kit](https://linalopes.github.io/SchoolAI-brand-kit/). Colours, type, spacing, and component styling come from that kit. This application does not introduce a separate identity.

Interaction reference: [Plotter Workspace](https://github.com/linalopes/SchoolAI-plotter-workspace) ([live](https://school-ai-plotter-workspace.vercel.app/)). Patterns were reused; that repository is not modified by this project.

## Implemented in Phase 01

- Svelte 5, TypeScript, and Vite application shell.
- Branded header, workspace tabs (Create, Simulate, Robot), and authorship footer. Personal authorship and institutional context are separate credits.
- **Create:** sketch library stored in this browser, CodeMirror editor, Run and Stop, sandboxed p5.js preview, seven examples (six timed adaptations of the Plotter Workspace studies, plus *Two-brush Lissajous*), and a reserved parameter panel.
- **Simulate:** the same timeline and the latest `MotionFrame`. Playback seeks, plays, pauses, and resets that clock. The 3D stage is empty. There is no placeholder robot and no fake motion.
- **Robot:** overview, connection, and safety sections. Connect is disabled. There is no transport and no motion command.
- Shared motion types (`BrushTarget`, `MotionFrame`) and a single timeline store. Adapter interfaces for a future simulation and a future Go2 controller exist as types only. Nothing implements them.

## Implemented in Phase 02A

- One host timeline, advanced with `requestAnimationFrame`. The step is elapsed time, capped so a stalled frame cannot skip the score ahead. Play, pause, stop / reset, seek, and playback speed write that store.
- The sandboxed preview uses that time as `millis()`. p5 is not a second clock. Play moves the drawing. Pause stops the drawing and stops new samples.
- Seeking backward re-executes the sketch and redraws from the start of the score up to the requested time, so marks from later in the score do not remain. Lifted travel is still not painted. A forward gap wider than the preview can fill safely is stepped rather than drawn as one chord.
- `SET_TIME` / `MOTION_FRAME` on the existing `postMessage` protocol. The iframe evaluates `motion(t)`. The host checks the run id, the sample serial, the message shape, and finite coordinates. One sample is in flight; a newer time replaces a time that has not been sent.
- The latest validated frame is kept on the host motion store (`src/lib/motion/output.ts`): time, both brush targets, canvas x/y, and contact. Create and Simulate read that store. Switching workspace does not reset the score, because Create stays mounted. A bounded sample list for the 3D trail is separate from that one frame.
- `scorePeriod()` is the duration convention. A finite number greater than zero is one loop. If it is missing, throws, or is not a positive finite number, playback is continuous and the host does not invent a length. The six adapted examples declare a period. Lissajous and the blank sketch do not.

## Implemented in Phase 02B

- A Three.js viewport in Simulate: orbit, zoom, pan, perspective, top, and side views, a ground plane, axes, and an optional grid. The renderer resizes with its container, draws when the pose or the camera changes, and disposes its geometries when the view is destroyed.
- The Unitree Go2 visual model from [MuJoCo Menagerie `unitree_go2`](https://github.com/google-deepmind/mujoco_menagerie/tree/main/unitree_go2). The MJCF is not loaded by Three.js. Joint origins, axes, limits, and the home keyframe are taken from `go2.xml` and mirrored in `src/lib/simulate/go2/model.ts`. The OBJ meshes are the Menagerie assets, vendored under `public/models/go2/` with the model’s BSD-3-Clause license (copyright HangZhou YuShu TECHNOLOGY CO.,LTD. / Unitree Robotics). The scene uses the Menagerie frame: +X forward, +Y left, +Z up.
- Twelve actuated joints, three per leg (FL, FR, RL, RR). Forward kinematics follows that chain. The body stays on the home keyframe (base at z = 0.27 m, reference angles 0, 0.9, −1.8). Rear legs hold that pose.
- Inverse kinematics for the front legs only. It uses the model axes and limits, returns the same angles for the same target, and reports an unreachable target with a position error instead of rescaling the drawing. A target that needs the body to move is reported as unreachable.
- Two brushes, left on FL and right on FR, with offsets in the foot frame (the visual foot mesh, not the collision sphere). Each has visibility and activation. An inactive brush holds the reference pose and does not paint. Mounts are calibration data in the Simulate panel, not sketch code.
- A horizontal sheet with a size in metres, an origin, a yaw, and a boundary. Canvas mapping is a separate layer: metres per canvas unit, or a scale derived from the sheet size and the reported canvas. There is no single pixel-to-metre constant. Canvas +Y is down. The default axes put canvas-right on the robot’s right and canvas-down toward the robot. Out-of-sheet points are kept.
- Brush-up, and an inactive brush, use a configurable lift height. They are not treated as contact.
- The viewport consumes the stored `MotionFrame` through `SimulationAdapter.applyFrame`. Play, pause, stop / reset, seek, and speed are the existing timeline. The robot does not run its own clock. A backward seek replaces the 3D trail with the samples the iframe already evaluated while redrawing, capped at 320 frames.
- Three paths are drawn separately: the desired sheet path (dashed), the achieved tip path (turquoise), and geometric paint. Paint is drawn only when contact was requested, the brush is active, the target is reachable, and the tip is within 8 mm of the sheet. It is labeled a geometric preview, not simulated paint.
- The Robot model section lists joint names, angles, limits, foot positions, the foot-sphere centre, brush tips, and the canvas → paper → world numbers. Joint sliders are a manual inspection pose. They do not follow the timeline until “Follow timeline”, and they do not address hardware.

## Not in this phase

- MuJoCo, contact forces, friction, or balance. Kinematic reach is not physical stability.
- Unitree SDK, network connection, or any command sent to a physical robot. The Robot workspace stays disabled.
- Moving the body or solving the rear legs to extend the drawing reach.
- Live parameter controls. The panel is a layout reservation; values are edited in the sketch.
- SVG export, G-code, or any file handed from p5.js to the robot.
- New drawing examples.

### Later MuJoCo adapter

`createKinematicAdapter()` is the current `SimulationAdapter`. A MuJoCo WebAssembly adapter should implement the same interface, subscribe to the same frame, and replace this object. It should not sample `motion(t)`, start a clock, or require changes to sketches, `MotionFrame`, the timeline, or navigation. Joint angles are computed inside the adapter, after `applyFrame` receives canvas-space targets. Physics remains the only place contact may be treated as real. A threaded WASM build needs cross-origin isolation; those headers stay off until that adapter exists.

## Limitations

- A single seek across more than 120 seconds of a continuous score repaints only the latest 120 seconds, so the page stays responsive.
- `draw()` is re-run from the beginning after a backward seek or a loop. A sketch whose paint depends on randomness or on input will not reconstruct the same trace.
- `millis()` follows the host. p5’s `deltaTime` is not retimed. Sketches should read `millis() / 1000` or the `t` passed to `motion`.
- A sketch with no `motion(t)` still draws. The readout says the simulation has nothing to follow. The robot then holds the reference pose. A bad return or a throw is reported the same way and does not stop the preview by itself.
- The parameter panel does not push values into the running sketch.
- The default sheet is 0.20 m × 0.20 m, centred 0.30 m in front of the body. Some of the seven scores fall outside the front legs at that scale. That is reported as unreachable. The scores are not reshaped to fit.
- Paint in the viewport is geometric proximity, not contact physics. A lifted move does not leave a mark.
- The 3D trail keeps at most 6000 samples. A continuous score longer than that drops the oldest marks. A seek across more than 120 seconds still rebuilds only the latest 120 seconds of the drawing, and the trail follows that rebuild.

## Run

Requires Node.js 20.19 or newer.

```bash
npm install
npm run dev
```

`npm run check` runs Svelte and TypeScript checks. `npm test` samples every example’s `motion(t)`, checks the timeline and message guards, and checks Go2 forward kinematics, inverse kinematics, canvas mapping, and trail reconstruction. `npm run build` copies the classic p5 build into `public/vendor` and produces `dist/`.

Sketches persist in `localStorage` under the prefix `doodog`. Clearing site data removes them. Built-in examples are not stored; **Use example** copies one into the library.

## Naming

| Name | Refers to |
| --- | --- |
| doodog | The artistic project |
| doodog studio | This application |
| `sketches` | The algorithm and creative coding library |
| `scores` | Motion compositions |
| `simulation` | The simulation engine and related modules |

Phase 01 keeps the source layout already in the application. `sketches`, `scores`, and `simulation` name that organization. They are not extra directories in this phase.

- **sketches** live in `src/lib/sketches`.
- **scores** are the shared motion model in `src/lib/motion` (`MotionFrame` and the single timeline). A `scores/` tree is reserved for later compositions and is not created yet.
- **simulation** is `src/lib/simulate`: the `SimulationAdapter` boundary, the Go2 kinematic model, and the Three.js view.

## Architecture

```
src/
  App.svelte                 shell: header, workspaces, footer, timeline clock
  views/                     CreateView, SimulateView, RobotView
  lib/brand/                 brand-kit tokens
  lib/components/            header, tabs, sidebar, dialogs, motion readout
  lib/create/                editor, preview, library, examples, parameters
  lib/p5/                    sandboxed sketch runtime (host never evals source)
  lib/sketches/              library, examples, local persistence
  lib/motion/                shared types, timeline, clock, latest frame, trail samples
  lib/simulate/              playback, Go2 kinematics, Three.js view, SimulationAdapter
  lib/robot/                 reserved UI + RobotController interface
  lib/stores/                active workspace, inert UI preferences
```

Create is the only workspace that executes code, and it stays mounted when another tab is visible so the iframe keeps the active score. Simulate reads the same timeline and the same frame. Robot does not.

### Patterns reused from Plotter Workspace

- Locked header and section chrome, so workspace content cannot compress the navigation.
- Primary tabs plus a section sidebar, with the main column scrolling on its own.
- CodeMirror 6 editor, explicit Run, and a sketch library that saves locally. Examples are immutable templates; using one creates a user-owned copy.
- A sandboxed iframe (`sandbox="allow-scripts"` only) that loads classic p5 in global mode and talks to the host with a typed `postMessage` protocol. Sketch source is never evaluated in the Svelte application.
- Run snapshots: the preview executes the source at click time, and a later edit is marked stale until the next Run.
- Local-only persistence with validated reads. Storage is continuity, not an archive.

Plotter-specific machinery was not carried over: SVG capture, G-code, GRBL, serial, and machine profiles. Those solve a pen plotter. This application’s output is a motion function of time.

### How a sketch drives the simulation

The sketch stays the authoring surface. It does not export a file.

A sketch defines motion as a function of time:

```ts
type BrushTarget = { x: number; y: number; contact: boolean };
type MotionFrame = { time: number; left: BrushTarget; right: BrushTarget };
```

`x` and `y` are canvas units from `createCanvas`. Mapping those units onto the robot’s reachable workspace is an adapter’s job, not the sketch’s. The examples and the blank sketch already follow this shape: `motion(t)` returns a frame, and `draw()` paints it. The example scores are creative trajectories. They are not clipped or rescaled to an assumed Go2 reach.

The host timeline is the only clock:

1. The host advances `time` on one animation frame and sends that one time into the iframe (`SET_TIME`).
2. The iframe sets `millis()` from that time, redraws the sketch up to it, and calls `motion(t)` there. When the redraw visits more than the newest instant, those frames come back as `samples` on the same message, capped at 320. The host does not build an unbounded queue.
3. One `MOTION_FRAME` comes back. The host stores the latest frame only after the run id, serial, shape, and coordinates check out.
4. `createKinematicAdapter().applyFrame` receives that canvas-space frame. Mapping onto the sheet and the leg solution happen inside the adapter. The Three.js view only applies the resulting joint angles. A later MuJoCo adapter would implement the same interface. It is not constructed.
5. A future `RobotController` receives the same frame type. It is not constructed, and the Robot workspace has no transport.

`scorePeriod()` tells the host when to wrap. The six adapted examples return one pass over their segments. Lissajous and a new blank sketch leave it out and play continuously.

No stage writes SVG or JSON for the next stage to import. Parameters, once the reserved panel is connected, will be another host message (`SET_PARAMS`) into the same iframe. That message is named and not implemented.

## Example library

The gallery lists seven immutable templates. **Use example** copies one into the local sketch library and does not replace sketches already stored. A first visit still seeds an editable copy of **Two-brush Lissajous** (`two-brush-lissajous`).

Six examples adapt studies from [Plotter Workspace](https://github.com/linalopes/SchoolAI-plotter-workspace). In that project they are static `noLoop()` drawings, captured afterward as SVG. Here the same constructions — Cartesian lines, a grid of loops, concentric radii, sine rows, a noise field, an ordered vertex list — are schedules for a brush. `t` is seconds. Each score has a finite period. The last segment travels, with the brush up, back to the first pose, so a repeat does not jump.

The preview paints a mark only when the brush stays in contact for two consecutive frames. Lifted travel draws nothing. A filled dot is the brush while it draws; an outline is the brush while it is up. The six adapted scores use one brush. The other rests, lifted, in the corner. `params.brush` swaps which one draws. **Two-brush Lissajous** is the original studio example and still draws with both.

| Example | Score |
| --- | --- |
| Simple Line | Draw the main diagonal, hold, lift, and return along it. |
| Grid | Vertical strokes, then horizontal strokes, lifting between lines. |
| Concentric Circles | One full turn per radius, then a lifted step outward. |
| Wave Lines | Sine rows. Amplitude, frequency, spacing, and phase sit in `params`. |
| Noise Field | Short marks on a grid. The angle comes from deterministic noise. Travel between marks is lifted. |
| Polyline Composition | Quad, open sine, rectangle, and circle, walked vertex to vertex, with holds on the corners and lifts between shapes. |
| Two-brush Lissajous | Both brushes, unchanged. |

The plotter noise field used p5 Perlin noise and `noiseSeed(42)`. This score uses a small value-noise function with that same seed, called from `motion(t)`, so the field does not depend on p5 setup. It will not match the plotter SVG stroke for stroke. The schedule is the same idea: nested loops, a short segment, brush up between segments.

The polyline vertices are the plotter composition written on the 600 canvas. That file used a 400 canvas; each coordinate here is one and a half times the original. That places the drawing in the studio preview. It is not a fit to the robot.

Editable values live in the `params` object at the top of each sketch. The parameter panel does not write them yet. `scorePeriod()` is the loop length for the six adapted scores. Lissajous has no period. `npm test` evaluates `motion(t)` for every example in Node, checks timeline stepping, replay, and the `MOTION_FRAME` guard, and checks the Go2 chain against the Menagerie joint data. The running preview samples `motion(t)` inside the iframe when the host timeline moves. The kinematic view reads that sample. It does not refit these scores to the robot.

## Technical risks

- **One clock.** The host timeline is that clock. The preview, the motion store, and the kinematic pose all follow it. A second timer in the Three.js view would let the drawing and the legs drift.
- **`motion(t)` is still a convention.** A sketch can draw without defining it. A missing function, a throw, or a value that fails `isMotionFrame` is reported on the readout. The preview keeps drawing. The robot holds its reference pose.
- **Sandbox limits.** The iframe cannot touch the host page, which is what keeps sketch code away from a future robot connection. It also means the host cannot call `motion` directly; sampling has to go through `postMessage`.
- **p5 global mode.** Sketches look like the p5 Web Editor, and they can also overwrite `motion` or leak state across runs. The runtime deletes known hooks between runs; unexpected globals are still a risk. p5 2 may defer the first looping `draw()` until the browser paints a frame, so the runtime requests that first frame itself.
- **MuJoCo threads.** A threaded WASM build needs `SharedArrayBuffer`, which requires cross-origin isolation headers. Those headers are intentionally off: they also constrain fonts and the sketch iframe. They should be turned on together with the physics adapter, and the iframe asset loading rechecked at that point.
- **Inverse kinematics and reach.** A canvas point is not a joint angle. The kinematic adapter reports unreachable targets and a millimetre error. It does not silently rescale the score. The body does not walk toward the sheet, so many marks in the seven examples stay out of reach at the default sheet. That is an expected limit of this phase, not a failed drawing.
- **Geometric paint.** Marks in the viewport mean the tip was near the sheet while contact was requested. They are not a pressure or friction result. The on-screen label says so.
- **Physical Go2.** Any later controller needs an explicit emergency stop, speed caps, and a confirmation step before streaming. The `RobotController` interface reserves `emergencyStop` so it cannot be added as an afterthought. No SDK is chosen yet; the firmware and network mode should be decided before a transport is written.
- **Vendor script.** The iframe loads `public/vendor/p5.min.js`, copied from `node_modules` by `scripts/sync-sketch-vendor.mjs`, because a sandboxed classic script cannot use the Vite module graph. `public/vendor` is generated and not committed.

## Brand

Tokens live in `src/lib/brand/tokens.css` and follow the brand kit: Deep Purple, Gray Green, Pink, Turquoise, White, and link magenta for text on light surfaces. Space Grotesk, Inter, and Courier Prime are loaded from Google Fonts at the weights the kit specifies. The header uses the official particle-cloud mark (`public/brand/sota-mark.svg`) on Deep Purple, which is an approved surface. Violet and coral appear only inside that mark.

The application root carries `data-document-role="page"` so the shell is the artboard boundary for design export.
