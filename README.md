# REDSHIFT

Launch an electric hypercar off neon ramps, then fly it with air-blast thrusters and land it clean. A physics game for the browser, built with Three.js, Vite and TypeScript.

The car does 0 to 100 km/h in under a second: four rear exhausts blast compressed air for the launch, then the wheels take over. Off the lip it becomes a lunar lander, with twelve nozzles for pitch, roll, yaw and lift and a finite air tank. Ten ramps throw you off at different angles and with different spins; every landing hill is designed from the ramp's own launch trajectories.

```
npm install
npm run dev          # http://localhost:5173
npm run build        # dist/ (static site, deploy anywhere)
npm run build:single # dist-single/index.html (one self-contained file)
npm run sim          # headless check: the autopilot flies every level and reports the landings
```

URL params: `?level=4` jumps straight into a ramp, `&cam=dash|chase|cinematic`, `&auto=1` lets the autopilot fly.

`VITE_SITE_URL` in `.env` is the public address used for the canonical link and the Open Graph / Twitter preview image (`public/og-image.jpg`).

## Controls

| | Ground / ramp | In the air |
|---|---|---|
| W / S | throttle / brake | pitch nose down / up |
| A / D | steer | roll |
| Q / E | | yaw blasts |
| Space | | belly blasts (lift, cushions landings) |
| C | camera: chase, dash, cinematic | |
| F | assist: rate-hold or raw thrust | |
| G | guidance (predicted arc, impact reticle, ideal-attitude ghost) | |
| R / Esc | retry / pause | |

**Touch:** a floating stick under the left thumb steers on the ground and pitches and rolls in the air. On the right, the big button is THROTTLE (with BRAKE beside it) and becomes LIFT once airborne, with the two YAW blasts above it. Camera, retry and pause sit top right. Phones get a lighter render setting.

**Gamepad:** triggers throttle/brake, left stick pitch/roll, bumpers or right stick yaw, A lift, Y camera.

## How it works

- `src/physics/Track.ts`: ramps are segment lists (straights, pitch arcs, twists that pivot on the low edge) integrated into a frame every 25 cm (position, tangent, normal, curvature, frame angular velocity).
- `src/physics/CarSim.ts`: two regimes. On the track the car is a rail body with lateral steering; normal force comes from curvature, gravity, downforce and the ground-effect fan, and if it goes negative you lose grip. Off the lip it becomes a 6-DOF rigid body (inertia tensor, gyroscopic term) with drag, 12 air-blast nozzles applied at their real positions (torque from r × F), a finite air tank, 4 raycast spring/damper wheels with a friction circle and body contact points for crashes. Exit spin comes from the track frame, so curved and twisted lips throw you into flips and rolls. Fixed 240 Hz step with render interpolation.
- `src/levels/LevelBuilder.ts`: each level runs a full-throttle design pass, launches a family of trajectories across a speed window and searches for the straight landing slope that minimises the worst impact, then adds a knoll and a run-out.
- `src/render/Smoke.ts`: simulated smoke with curl-noise turbulence, cooling buoyancy, ground spreading, car-wake entrainment, jets pushing it around, CPU lighting from scene lights and sorted soft billboards. Plumes are laid along each nozzle's path so they read as continuous trails.
- `src/render/TrackMesh.ts`, `src/render/World.ts`: track, supports (kept clear of the road, loops and the flight path), runway lights, floodlights and searchlights.
- `src/ui/Touch.ts`: on-screen controls. `src/core/Device.ts` picks render quality per device.
- `src/assets/car.glb`: the car, built procedurally in Blender by `tools/blender/car_build.py` (materials are swapped in code by name). It is embedded as plain base64 so the single-file build has no binary data URLs.

Scoring: launch speed, air time and rotation, landing quality (attitude against the surface, impact speed, slip, spin, distance from the target line) and air reserve.

## Tools

- `tools/sim.ts`: autopilot validation of every level (`npm run sim`).
- `tools/shot.mjs`, `tools/mobile.mjs`: Playwright screenshot and touch smoke tests (set `CHROMIUM_PATH` if Playwright's browser isn't installed).
