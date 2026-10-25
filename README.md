# doodog

**doodog — Drawing with four legs.**

**doodog studio — A creative coding environment for robotic drawing.**

doodog is the artistic project. doodog studio is the creative coding application: p5.js for parametric drawing, Three.js for a kinematic view of those movements on a Unitree Go2, and an optional MuJoCo experiment. Physical robot control is not in this phase.

Repository: [linalopes/doodog](https://github.com/linalopes/doodog)  
Package identifier: `doodog`

**Phase 05D · Creative score tracking.** One host timeline samples `motion(t)` and poses a Unitree Go2 in Three.js. Creative parameters update the drawing and the kinematic pose together. The Create canvas can show where each front brush can reach. Simulate can chart the joint motion of a score. An optional MuJoCo experiment can drop the same Go2 under gravity, hold the home posture, stand on three legs, trace a small circle with the raised front-left foot, or follow one creative brush with that same foot. The kinematic view stays labeled **Kinematic Preview — Not Physically Validated**. The physics view is labeled **MuJoCo Physics — Experimental**. The physical robot is not in this phase.

Concept, interaction design and development: [Lina Lopes](https://linalopes.info/)

Institutional context: [School of Tomorrow's AI](https://schoolai.linalopes.info/)

Visual identity: [School of Tomorrow's AI brand kit](https://linalopes.github.io/SchoolAI-brand-kit/). Colours, type, spacing, and component styling come from that kit. This application does not introduce a separate identity.

Interaction reference: [Plotter Workspace](https://github.com/linalopes/SchoolAI-plotter-workspace) ([live](https://school-ai-plotter-workspace.vercel.app/)). Patterns were reused; that repository is not modified by this project.

## Implemented in Phase 01

- Svelte 5, TypeScript, and Vite application shell.
- Branded header, workspace tabs (Create, Simulate, Robot), and authorship footer. Personal authorship and institutional context are separate credits.
- **Create:** sketch library stored in this browser, CodeMirror editor, Run and Stop, sandboxed p5.js preview, seven examples (six timed adaptations of the Plotter Workspace studies, plus *Two-brush Lissajous*), and parameter controls for a running sketch.
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

## Implemented in Phase 03

- A running sketch may declare `const params = { amplitude: 120, brush: 'left' }`. The iframe reads that object after Run and describes a control for each number, boolean, or string. Optional `paramInfo` on the same keys sets `min`, `max`, `step`, `options`, and `label`. A sketch with no `params` still runs, and the panel stays empty.
- The host does not evaluate sketch source to discover parameters. The sandbox reports the schema. Create and Simulate share that state. Changing a control sends `SET_PARAMS` into the live iframe, samples `motion(t)` at the current host time, and updates the drawing and the kinematic pose. The iframe is not reloaded and the Three.js scene is not rebuilt.
- Editing the source is separate. Those edits stay in the editor until Run. Run starts from the values written in the source. A control change does not rewrite the editor.
- A control change rebuilds the accumulated 2D and 3D traces from the new values, including after pause, seek, reset, or a loop. Slider moves are debounced (about 120 ms, and at least one update within 280 ms). Releasing a slider sends immediately. A backward seek replays up to 120 seconds, as before. If `scorePeriod()` changes, the host timeline uses the new length.
- `motion(t)` should read `params` when it is called. A copy taken once at load time will not follow the panel.
- Creative parameters stay separate from the robot. Amplitude, frequency, phase, spacing, brush choice, and contact pattern live on the sketch. Paper position and size, canvas mapping, brush mounts, lift height, and the reference pose stay in the robot model panel. A sketch that draws outside the sheet is reported as unreachable. The sheet is not resized to fit it.
- The viewport reports current reachability, left and right tip error in millimetres, a joint-limit mark, and how many trail samples requested contact but were geometrically unreachable. Reachable does not mean dynamically safe.

## Implemented in Phase 04A

- A reachability overlay on the Create preview. It samples the p5 canvas on a grid and solves the front legs with the same inverse kinematics and brush offsets as the kinematic Go2. The regions are left only, right only, both, and neither. They are not circles and they are not drawn by the sketch.
- Brush down evaluates the tip on the paper. Brush up evaluates it at the configured lift height. The overlay names which of those heights is in use.
- The map is a layer in the host page. It does not change the p5 drawing and it is not written into sketch source. Reach, opacity, tip height, and grid density are display controls.
- Pointing at the canvas reports that Cartesian point, which brush can reach it, and the position error in millimetres. An inactive brush is reported as inactive.
- The grid is solved again when the paper, the canvas mapping, a brush offset, the lift height, the canvas size, the tip height, or the grid density changes. Playback does not solve the grid. A short delay batches those updates, and the solve is spread across turns so the page can still paint. Opacity changes only the tint.
- The label states that the map is geometric reach. It is not balance, force, a collision-free path, or a claim that the motion is safe to run.

## Implemented in Phase 04B

Motion diagnostics sit in Simulate, under the shared timeline. They describe how a drawing becomes front-leg joint motion. They do not certify that motion.

- The sandbox is asked for `motion(t)` at the analysis times. That request does not redraw the sketch and does not move the Three.js robot. Seeking a chart does: it uses the same host timeline as Play and the scrubber, which updates the preview and the kinematic pose. Nothing is sent to a physical robot.
- Each returned frame is solved with the same `solvePose` path as the viewport. There is no second kinematic model. A lifted brush is still solved. An inactive brush holds the reference pose and does not raise events.
- Units inside the solver stay radians, metres, and seconds. The charts show degrees, degrees/second, and degrees/second². Tip error is in millimetres.
- Derivatives are finite differences on the analysis sample times, not on the playback frame rate. An interior point uses the three-point stencil that is exact for quadratics on an uneven grid. Endpoints use the one-sided three-point stencil when a third sample exists. Two samples use a single slope. Acceleration is that same operator applied to the velocity estimates. A gap in valid samples starts a new segment. The range endpoint is always included, so the last step can be shorter than the rest. A spike shorter than the interval can be missed or spread across neighbouring samples.
- A score with `scorePeriod()` is analyzed for one declared period. A score without one stays continuous. The panel then uses a window, 8 seconds from t = 0 unless you change it. That window is not a score length.
- The default interval is 0.05 s, capped at 400 samples. A longer period widens the interval, and the panel says so.
- Events use thresholds you can edit. The defaults are a 2° margin to a joint limit, a 12° jump between samples, 180°/s, 1500°/s², and 15 mm of tip error. Unreachable targets use the solver’s existing 5 mm tolerance. Velocity and acceleration crossings are marked as estimates. The others are measurements. None of these numbers are Unitree motor ratings.
- Reachable, smooth under these settings, dynamically feasible, and physically safe are different claims. This phase only measures the first and estimates the second. It does not smooth, clip, or slow the score.
- A new run, a parameter flush, a paper or brush change, or a new interval invalidates the previous pass. Playback does not. A batch from an older run or parameter revision is discarded.

## Implemented in Phase 05A

MuJoCo is an optional experiment. The kinematic adapter is unchanged, and `applyFrame` is still a geometric pose, not a physics step.

- The package is the official single-threaded `@mujoco/mujoco` build (Apache-2.0). It does not use `SharedArrayBuffer`, so the app does not send `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy`. The multi-threaded build would need those headers. They would block the Google Fonts stylesheet and can stop the sandboxed p5 iframe from loading its script, so they stay off.
- WASM loads in a worker the first time the artist chooses Initialize. Opening Create, running a sketch, or viewing the kinematic preview does not load the physics engine.
- The worker reads the vendored Menagerie `go2.xml` and its OBJ meshes. That file is the Unitree model (BSD-3-Clause, HangZhou YuShu TECHNOLOGY CO.,LTD. / Unitree Robotics). It has no ground. The loader includes it and adds a plane named `floor`. The vendored XML is not rewritten. The home posture already meets that plane, so contact can be reported before any step. Motor commands are cleared to 0 Nm after the home keyframe, because those `ctrl` numbers are crouched joint angles and these actuators are torque motors. Motors Off leaves them at 0 Nm. If the robot falls, that is the simulated result.
- The host timeline stays the clock the artist sees. Physics time advances by the model timestep (0.002 s) toward the time since Initialize or Reset. At most 16 steps run before the page can paint again. Seeking backward inside the run resets the model and replays it. Seeking before the run is refused, and the pose is not jumped. Play and pause are the shared timeline controls.
- The existing Three.js Go2 is moved by the simulated base pose and joint angles. It is not a second robot. Geometric paint is hidden while the physics pose is showing. Switching back to Kinematic Preview restores the fixed-body pose and does not change the sketch or its parameters.
- Motion diagnostics, the reachability map, and the seven sketches stay on the kinematic solve.

## Implemented in Phase 05B

Three-Leg Stance is a second physics mode. Motors Off is unchanged: zero torque, and the creative timeline still drives that fall. Posture Hold and Three-Leg Stance do not follow the creative clock. Their clock is physics experiment time, and it advances only while the experiment is playing. Seeking the score does not rewind a pose the controller has moved. Reset returns the Menagerie home posture and clears the motor commands.

The actuators in `go2.xml` are `<motor>` elements, so the command is torque in Nm, not a joint position. The home keyframe’s `ctrl` numbers stay unused. A joint-space PD law writes the torques. Commands are clamped to the ctrlrange in that file, about ±23.7 Nm on the hip actuators and ±45.43 Nm on the knees. That range is the model file, not a certified continuous-torque rating. The PD gains are simulation settings. The controller does not write `qpos`.

The schedule is Stand, Shift, Lift, Hold, Return. Stand holds the home joints. Shift moves the body toward the centroid of the FR–RL–RR triangle, with the feet kept at the pose captured at the end of Stand. Lift raises the front-left foot. The requested height is clearance of the foot sphere above the floor. The home posture starts with that sphere inside the floor, so the foot has to climb out of the penetration as well as reach the clearance. Hold keeps the foot up. Return lowers it and shifts the body back. The default request is 15 mm, with two seconds for each of shift, lift, hold, and return. Stand is one second and is not a slider.

Completed is not “the animation reached Return.” Every stage has a measurement: four feet down and the body upright after Stand, the centre-of-mass projection at least 5 mm inside the FR–RL–RR triangle after Shift, the front-left foot off the floor and at least halfway to the requested clearance after Lift and throughout Hold, and four feet down again after Return. A projection inside the triangle is not dynamic stability and it is not a safety result. If the body falls or tips, the schedule stops and the outcome is Failed. Stop, Reset, and a mode change report Interrupted or return to the home posture instead of jumping the state.

In the automated MuJoCo check, with the default 15 mm request, the run completes: the front-left foot leaves the floor and clears it by about 12 mm, the three-leg margin during the hold is about 70 mm, roll and pitch stay within a few degrees, body height stays near 0.26 m, and the largest command stays near 11 Nm, inside the MJCF ranges. The foot comes back down on Return. Posture Hold keeps four feet down at about the home height. Motors Off still falls. Those are simulation results for this model and these gains, not a guarantee on another machine and not a claim about a physical Go2.

The same Three.js robot draws the simulated body. The turquoise loop is the convex hull of the feet that are actually on the floor. The dark loop is the FR–RL–RR triangle. The pink mark is the measured centre of mass and its projection. The dark marker above the front-left foot is the requested target, not the measured foot. Geometric paint stays hidden. Switching back to Kinematic Preview restores the fixed-body pose and does not change the sketch.

## Implemented in Phase 05C

Drawing in the Air keeps the Phase 05B torque controller and adds a circle after the lift. The stages are Stand, Shift, Lift, Draw, Hold, Return. Motors Off, Posture Hold, and Three-Leg Stance are unchanged. The circle is not read from a score and it is not ink.

The path is a horizontal circle in the world frame. Its anchor is the commanded front-left foot target at the end of Lift, and the path starts and ends on that point. The centre is one radius toward world −X, which is what lets the path include the anchor instead of starting at the middle. The default radius is 10 mm, the default duration is 4 s, and the default direction is counterclockwise when seen from above. The angle follows a smootherstep. A constant speed would leave Lift, where the target velocity is already zero, with a sideways speed of about 16 mm/s. The radius is not reduced when a point is hard to reach.

The drawing height is that commanded target, not a snap to the measured foot. Snapping would move the command by whatever tracking error the lift still had. The measured foot height at the start of Draw is shown beside the plane. In the automated run the plane was at 38.6 mm and the measured foot frame was at 35.9 mm.

The three supporting legs stay on the stance targets. The front-left target is the circle point, expressed in the measured body frame and solved with the same inverse kinematics as the lift. The solver does not write joint positions. The PD torque is unchanged, and commands stay inside the MJCF ctrlrange.

The tracked point is the kinematic foot frame, the same point the inverse kinematics commands. It is not the brush tip and it is not the collision sphere. The dark line in the viewport is the requested circle. The pink line is the measured foot frame. Both are drawn 2 mm thick so the small circle can be seen; that thickness is display only and is not part of the measurement. Neither line is paint.

Completed still requires the three-leg measurements. Draw adds its own: the front-left foot stays up, the three support feet stay down, every circle point is reachable, and the maximum distance between the commanded foot frame and the measured foot frame stays within 8 mm. That 8 mm is an evaluation threshold for this experiment. It is not a motor rating. Reaching the end of the four seconds is not enough. A centre-of-mass projection inside the triangle is not dynamic stability.

In the automated MuJoCo check, with the defaults, the run completes both times and the second matches the first. The maximum foot-frame error is 5.5 mm and the root-mean-square error is 4.7 mm. During the circle the lowest FR–RL–RR margin is about 72 mm. The measured path spans about 19.9 mm by 18.6 mm, against a commanded span of 20 mm by 20 mm. The largest roll is about 4.5° and the largest pitch is about 2.8°. The largest torque in the run is about 14.9 Nm, and about 11.0 Nm during the circle. No command saturates. The revolution finishes and the front-left foot returns to the floor, with the body near 0.264 m. The lowest three-leg margin in the whole run is about −10 mm, and it occurs during Return, while the body is moving back onto four feet. It is not the margin during the circle. Those are results for this model and these gains.

Physics experiment time stays separate from the creative score. Changing the radius, the duration, or the direction does not rewrite the sketch.

## Implemented in Phase 05D

Creative Score Tracking uses the same torque controller as Drawing in the Air. The stages are Stand, Shift, Lift, Track Creative Score, Hold, Return. Motors Off, Posture Hold, Three-Leg Stance, and Drawing in the Air stay available. The physical drawing leg is the front-left leg. The other three legs stay on the stance controller.

The sandbox is the only place that evaluates `motion(t)`. The host asks it for a bounded list of times, in chunks of at most 32, and keeps a versioned buffer. A reply from another run, another parameter revision, or an older request is discarded. The MuJoCo worker receives the samples. It does not receive sketch source. If sampling fails, or the selected brush does not move, the experiment does not start and no path is invented. Choosing the other brush is a separate action. The interface names the brush that is ignored.

The buffer is canvas space. At the end of Lift the worker maps it around the commanded front-left foot target. The longer canvas side maps to the gesture envelope. The shorter side keeps the canvas proportions. The default envelope is 20 mm, so a 600×600 canvas becomes 20 mm × 20 mm. That envelope is not the 0.20 m paper, and the drawing is not resized to the reachable workspace. The height is the aerial plane from the lift, the same plane the circle uses. Contact is kept as metadata. It does not create a paper collision and it does not leave ink. Brush-up travel stays in the command and is drawn as its own line. A sample step larger than 12% of the canvas diagonal is held instead of blended. Contact itself is never blended.

The foot does not jump to the first score point. For one second, by default, it moves from the lift pose to that point with a smootherstep. If the first mapped point is outside the geometric workspace, tracking does not start. Later unreachable points are reported and are not clipped into a shorter drawing. Three-leg support has to be established before Track. The support legs stay on the commanded body. The front-left target is solved from the measured body pose, then turned into a PD torque. Commands stay inside the MJCF ctrlrange.

Score time and physics time stay separate. A declared `scorePeriod()` is sampled once. A continuous score uses the window control, which defaults to 8 s of score time. Playback rate is score-seconds per physics-second during Track. The stage length is fixed from the rate at the moment Track begins. Raising the rate finishes the score early and then holds the last sample. Lowering it leaves the score unfinished when the stage ends, and the outcome is Failed. Motion diagnostics keep their own sample clock.

Completed still requires the three-leg measurements. Track adds its own: the front-left foot stays up, the three support feet stay down, the first target was reachable, later targets stay reachable, the selected score is played through, and the maximum foot-frame error stays within 8 mm. That 8 mm is the same evaluation threshold as the circle. It is not a motor rating. Reaching the end of the stage is not enough.

In the browser, Simple Line at 1× on the 20 mm envelope completed. The maximum foot-frame error was 5.5 mm and the root-mean-square error was 4.3 mm. The score cursor reached the declared 8.17 s. During tracking the lowest FR–RL–RR margin was 72 mm, roll and pitch stayed within 2.5° and 0.3°, and the largest torque was 11.0 Nm. Over the whole run the largest roll was 4.5°, the largest pitch was 3.0°, and the largest torque was 14.9 Nm. No command saturated. The front-left foot returned to the floor and the body height was 0.264 m. The lowest three-leg margin was −11 mm, during Return. The creative timeline stayed paused at 5.60 s while the physics clock ran to 18.17 s.

Concentric Circles also completed in the browser. Its 28.40 s period needed 569 samples at 0.05 s, so the interval was widened to 0.089 s and the panel said so. The maximum error was 5.2 mm and the root-mean-square error was 4.3 mm. The tracking margin was 72 mm. Tracking roll and pitch were 2.8° and 0.3°. Tracking torque was 11.0 Nm. The whole run reached 4.5° of roll, 2.6° of pitch, and 14.9 Nm, without saturation. The foot returned to the floor at a body height of 0.263 m. The lowest three-leg margin was −7 mm, again during Return. The creative clock was left playing and had wrapped to about 0.02 s when the physics clock read 38.40 s.

Selecting the right brush on Simple Line, which does not move, reported that the right brush does not move and that the other brush was not used instead. The robot stayed at the home height. Changing the margin dropped the previous trajectory and left `margin: 80` in the sketch source. Stop during Shift reported Interrupted, kept the body at 0.265 m, and said the state was not jumped. Reset restored 0.270 m and 0 Nm. Switching back to Kinematic Preview restored that label and the geometric-paint legend. The Robot workspace still says physical control is not in this phase.

The dark line is brush-down creative instruction. The turquoise line is brush-up travel. The pink line is the measured foot. The tubes are 2 mm thick so the 20 mm gesture can be seen. That thickness is display only. None of the lines is ink.

An automated MuJoCo check drives the same controller with a synthetic buffer, because the worker cannot call the sandbox. That run also completed: 5.25 mm maximum error, 4.21 mm root-mean-square, 71.9 mm tracking margin, 11.03 Nm during tracking, 14.88 Nm in the run, unsaturated, with both a brush-down run and a brush-up run. The browser numbers above are the validation of the real sketches.

### Still later

- A second physical drawing leg. One creative brush is followed, and it always drives FL.
- Walking, or a balance controller beyond this stance.
- Real brush contact, pressure, and paint deposition.
- Any claim that a motion is physically safe, and any connection to a Unitree robot.

## Not in this phase

- Unitree SDK, network connection, or any command sent to a physical robot. The Robot workspace stays disabled.
- Moving the body or solving the rear legs in the kinematic preview to extend the drawing reach.
- SVG export, G-code, or any file handed from p5.js to the robot.
- New drawing examples.

## Limitations

- A single seek across more than 120 seconds of a continuous score repaints only the latest 120 seconds, so the page stays responsive.
- `draw()` is re-run from the beginning after a backward seek or a loop. A sketch whose paint depends on randomness or on input will not reconstruct the same trace.
- `millis()` follows the host. p5’s `deltaTime` is not retimed. Sketches should read `millis() / 1000` or the `t` passed to `motion`.
- A sketch with no `motion(t)` still draws. The readout says the simulation has nothing to follow. The robot then holds the reference pose. A bad return or a throw is reported the same way and does not stop the preview by itself.
- Parameter controls accept numbers inside the declared range, booleans, listed choices, and text up to 80 characters. Other values are ignored. At most 24 controls are shown.
- The default sheet is 0.20 m × 0.20 m, centred 0.30 m in front of the body. Some of the seven scores fall outside the front legs at that scale. That is reported as unreachable. The scores are not reshaped to fit.
- The reachability overlay samples a grid. A cell is the reach of its centre. The boundary between colours is that grid, not a continuous outline of the workspace.
- Motion diagnostics call `motion(t)` without redrawing. A sketch whose motion reads the canvas can disagree with the painted frame. The included scores are functions of time. The derivative of a jump is an estimate on the sample grid, not a measured motor speed.
- Paint in the kinematic viewport is geometric proximity, not contact physics. A lifted move does not leave a mark. MuJoCo contacts are a separate experiment and are not paint.
- Physics keeps up with the shared clock only as fast as 16 steps per turn. A long seek shows a replaying or integrating state until the model has been stepped to that time. Playback faster than the step budget lags behind the clock instead of skipping the fall.
- A motion function that reads the canvas can disagree with a physics pose. The MuJoCo worker does not evaluate sketch source. Creative Score Tracking samples `motion(t)` in the sandbox and sends the resulting buffer.
- While Posture Hold, Three-Leg Stance, Drawing in the Air, or Creative Score Tracking is selected, the creative timeline does not move the robot. Physics experiment time is separate. A seek on the score is not a physics rewind. Playback rate changes the commanded speed only during Track, and the stage length stays at the rate from when tracking began.
- The default 15 mm lift is a clearance request. The home posture begins with the foot sphere inside the floor, so part of the motion is spent climbing out of that contact. The check’s completed run cleared about 12 mm, which meets the halfway rule and is not the full 15 mm.
- The support margin is a static measurement. It does not certify that the stance will survive a push, a faster lift, or a different gain.
- The 8 mm tracking threshold is an evaluation setting for the circle and for Creative Score Tracking. The default circle, Simple Line, and Concentric Circles met it in the checks above. A larger gesture, a faster score, or a different gain can miss it, and the experiment then reports the miss instead of resizing the drawing.
- The three-leg margin can be negative during Return, while the body moves back onto four feet. In the default circle check that low point is about −10 mm. Simple Line reached about −11 mm and Concentric Circles about −7 mm, both during Return. The margin that belongs to the gesture is the one measured during Draw or Track, about 72 mm in those runs.
- Creative Score Tracking follows one brush with FL, in the air. The 20 mm envelope is not the 0.20 m paper. Contact does not touch the floor and does not leave ink. A score that would need more than 320 samples is sampled more coarsely, and the panel says the interval was widened. A brush that does not move is reported. The other brush is not substituted.
- The 3D trail keeps at most 6000 samples. A continuous score longer than that drops the oldest marks. A seek across more than 120 seconds still rebuilds only the latest 120 seconds of the drawing, and the trail follows that rebuild.

## Run

Requires Node.js 20.19 or newer.

```bash
npm install
npm run dev
```

`npm run check` runs Svelte and TypeScript checks. `npm test` samples every example’s `motion(t)`, checks the timeline and message guards, checks Go2 forward kinematics, inverse kinematics, canvas mapping, and trail reconstruction, checks parameter inference, checks the reachability map, checks motion diagnostics, checks the MuJoCo load, gravity, contacts, and replay, checks the stance geometry, torque clamp, posture hold, and three-leg schedule, checks the air-circle geometry, tracking error, and drawing schedule, and checks creative-score mapping, contact steps, stale buffers, and a synthetic tracking run. `npm run build` copies the classic p5 build into `public/vendor` and produces `dist/`.

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

No stage writes SVG or JSON for the next stage to import. Parameter edits are a `SET_PARAMS` message into the same iframe. The host still does not evaluate sketch source.

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

Editable values live in `params` at the top of each sketch. Optional `paramInfo` sets the slider range, the step, the choices, and the label:

```javascript
const params = { amplitude: 16, brush: 'left' };
const paramInfo = {
  amplitude: { min: 0, max: 80, step: 1, label: 'Amplitude' },
  brush: { options: ['left', 'right'], label: 'Brush' },
};
```

Without `paramInfo`, a finite number becomes a slider, a boolean becomes a checkbox, and a string becomes text unless `options` lists the choices. `motion(t)` must read `params` at call time. The panel writes those values into the running sketch. It does not change the editor text, and it does not refit the drawing to the robot. Saved sketches that were copied before `paramInfo` existed still run; their controls are inferred from the values.

`scorePeriod()` is the loop length for the six adapted scores. Lissajous has no period. `npm test` evaluates `motion(t)` for every example in Node, checks timeline stepping, replay, and the message guards, checks the Go2 chain against the Menagerie joint data, and checks that these defaults still match the controls. The running preview samples `motion(t)` inside the iframe when the host timeline moves. The kinematic view reads that sample. It does not refit these scores to the robot.

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
