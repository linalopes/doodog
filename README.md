# doodog

**doodog — Drawing with four legs.**

**doodog studio — A creative coding environment for robotic drawing.**

doodog is the artistic project. doodog studio is the creative coding application: p5.js for parametric drawing, and, in a later phase, Three.js for visualizing the resulting movements of a Unitree Go2. MuJoCo physics simulation and physical robot control are planned for later phases.

Repository: [linalopes/doodog](https://github.com/linalopes/doodog)  
Package identifier: `doodog`

**Phase 01 · Foundation.** The Create workspace runs sketches. Simulate and Robot are reserved layouts. Nothing in this phase moves a robot, solves inverse kinematics, or runs physics.

Concept, interaction design and development: [Lina Lopes](https://linalopes.info/)

Institutional context: [School of Tomorrow's AI](https://schoolai.linalopes.info/)

Visual identity: [School of Tomorrow's AI brand kit](https://linalopes.github.io/SchoolAI-brand-kit/). Colours, type, spacing, and component styling come from that kit. This application does not introduce a separate identity.

Interaction reference: [Plotter Workspace](https://github.com/linalopes/SchoolAI-plotter-workspace) ([live](https://school-ai-plotter-workspace.vercel.app/)). Patterns were reused; that repository is not modified by this project.

## Implemented in Phase 01

- Svelte 5, TypeScript, and Vite application shell.
- Branded header, workspace tabs (Create, Simulate, Robot), and authorship footer. Personal authorship and institutional context are separate credits.
- **Create:** sketch library stored in this browser, CodeMirror editor, Run and Stop, sandboxed p5.js preview, seven examples (six timed adaptations of the Plotter Workspace studies, plus *Two-brush Lissajous*), and a reserved parameter panel.
- **Simulate:** viewport, playback controls, and timeline reserved for Phase 02. Controls are disabled. There is no placeholder robot and no fake motion.
- **Robot:** overview, connection, and safety sections. Connect is disabled. There is no transport and no motion command.
- Shared motion types (`BrushTarget`, `MotionFrame`) and a single timeline store. Adapter interfaces for a future simulation and a future Go2 controller exist as types only. Nothing implements them.

## Not in this phase

- Three.js scene, Unitree Go2 geometry, or leg inverse kinematics.
- MuJoCo WebAssembly, contact, or balance.
- Unitree SDK, network connection, or any command sent to a physical robot.
- Sampling `motion(t)` out of the sketch iframe. The preview still uses p5’s own `millis()`.
- Live parameter controls. The panel is a layout reservation; values are edited in the sketch.
- SVG export, G-code, or any file handed from p5.js to the robot.

## Run

Requires Node.js 20.19 or newer.

```bash
npm install
npm run dev
```

`npm run check` runs Svelte and TypeScript checks. `npm test` samples every example’s `motion(t)` and checks the shared frame shape. `npm run build` copies the classic p5 build into `public/vendor` and produces `dist/`.

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
- **simulation** is the `SimulationAdapter` boundary in `src/lib/simulate`. A `simulation/` tree is reserved for the engine and is not created yet.

## Architecture

```
src/
  App.svelte                 shell: header, one workspace, footer
  views/                     CreateView, SimulateView, RobotView
  lib/brand/                 brand-kit tokens
  lib/components/            header, tabs, sidebar, dialogs, empty states
  lib/create/                editor, preview, library, examples, parameters
  lib/p5/                    sandboxed sketch runtime (host never evals source)
  lib/sketches/              library, examples, local persistence
  lib/motion/                shared types + timeline (single clock)
  lib/simulate/              reserved UI + SimulationAdapter interface
  lib/robot/                 reserved UI + RobotController interface
  lib/stores/                active workspace, inert UI preferences
```

Create is the only workspace that executes code. Simulate and Robot read the same navigation and layout primitives so later phases fill them without reorganising the page.

### Patterns reused from Plotter Workspace

- Locked header and section chrome, so workspace content cannot compress the navigation.
- Primary tabs plus a section sidebar, with the main column scrolling on its own.
- CodeMirror 6 editor, explicit Run, and a sketch library that saves locally. Examples are immutable templates; using one creates a user-owned copy.
- A sandboxed iframe (`sandbox="allow-scripts"` only) that loads classic p5 in global mode and talks to the host with a typed `postMessage` protocol. Sketch source is never evaluated in the Svelte application.
- Run snapshots: the preview executes the source at click time, and a later edit is marked stale until the next Run.
- Local-only persistence with validated reads. Storage is continuity, not an archive.

Plotter-specific machinery was not carried over: SVG capture, G-code, GRBL, serial, and machine profiles. Those solve a pen plotter. This application’s output is a motion function of time.

### How a sketch will drive the simulation

The sketch stays the authoring surface. It does not export a file.

A sketch defines motion as a pure function of time:

```ts
type BrushTarget = { x: number; y: number; contact: boolean };
type MotionFrame = { time: number; left: BrushTarget; right: BrushTarget };
```

`x` and `y` are canvas units from `createCanvas`. Mapping those units onto the robot’s reachable workspace is an adapter’s job, not the sketch’s. The examples and the blank sketch already follow this shape: `motion(t)` returns a frame, and `draw()` paints it. The example scores are creative trajectories. They are not clipped or rescaled to an assumed Go2 reach.

Phase 02 will make the host timeline the only clock:

1. The host advances `time` on one animation frame and sends it into the iframe (`SET_TIME`).
2. The iframe calls the sketch’s `motion(t)` and draws that frame.
3. The same call returns a `MotionFrame` to the host (`MOTION_FRAMES`).
4. The Simulate workspace passes that frame to a `SimulationAdapter`. The first adapter is a Three.js kinematic preview. A later MuJoCo WebAssembly adapter implements the same interface and is the only place physics is allowed to appear.
5. A future `RobotController` receives the same frame type. It is not constructed anywhere in Phase 01, and the Robot workspace has no transport.

No stage writes SVG or JSON for the next stage to import. Parameters, once the reserved panel is connected, will be another host message (`SET_PARAMS`) into the same iframe, so the preview, the simulation, and the robot share one set of values.

The protocol comments in `src/lib/p5/protocol.ts` name these messages. They are not implemented yet.

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

Editable values live in the `params` object at the top of each sketch. The parameter panel does not write them yet. `npm test` evaluates `motion(t)` for every example in Node. That check is not the Phase 02 host protocol; the running preview still calls `motion` from p5’s `draw()`.

## Technical risks

- **One clock, two runtimes.** Until `SET_TIME` exists, the 2D preview and the timeline can disagree. Phase 02 has to route time into the iframe before any robot pose is shown, or the drawing and the legs will drift.
- **`motion(t)` is a convention, not a checked export.** A sketch can draw without defining it. Sampling will need a clear error when the function is missing, throws, or returns a shape that fails `isMotionFrame`.
- **Sandbox limits.** The iframe cannot touch the host page, which is what keeps sketch code away from a future robot connection. It also means the host cannot call `motion` directly; sampling has to go through `postMessage`.
- **p5 global mode.** Sketches look like the p5 Web Editor, and they can also overwrite `motion` or leak state across runs. The runtime deletes known hooks between runs; unexpected globals are still a risk. p5 2 may defer the first looping `draw()` until the browser paints a frame, so the runtime requests that first frame itself.
- **MuJoCo threads.** A threaded WASM build needs `SharedArrayBuffer`, which requires cross-origin isolation headers. Those headers are intentionally off: they also constrain fonts and the sketch iframe. They should be turned on together with the physics adapter, and the iframe asset loading rechecked at that point.
- **Inverse kinematics and reach.** A canvas point is not a joint angle. The kinematic adapter has to report unreachable targets instead of silently clamping them into a pose that does not match the drawing.
- **Physical Go2.** Any later controller needs an explicit emergency stop, speed caps, and a confirmation step before streaming. The `RobotController` interface reserves `emergencyStop` so it cannot be added as an afterthought. No SDK is chosen yet; the firmware and network mode should be decided before a transport is written.
- **Vendor script.** The iframe loads `public/vendor/p5.min.js`, copied from `node_modules` by `scripts/sync-sketch-vendor.mjs`, because a sandboxed classic script cannot use the Vite module graph. `public/vendor` is generated and not committed.

## Brand

Tokens live in `src/lib/brand/tokens.css` and follow the brand kit: Deep Purple, Gray Green, Pink, Turquoise, White, and link magenta for text on light surfaces. Space Grotesk, Inter, and Courier Prime are loaded from Google Fonts at the weights the kit specifies. The header uses the official particle-cloud mark (`public/brand/sota-mark.svg`) on Deep Purple, which is an approved surface. Violet and coral appear only inside that mark.

The application root carries `data-document-role="page"` so the shell is the artboard boundary for design export.
