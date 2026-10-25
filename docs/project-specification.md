# Desktop virtual piano with closed shapes and MediaPipe

Version: V1.0  
Prepared: October 20, 2026  
Status: initial implementation complete; physical-device acceptance pending.

An ordinary computer camera observes the hands and tracks fingertips. When a fingertip enters a closed on-screen key region and satisfies hover confirmation, the app plays the matching note. It supports simple melodies and basic chords.

The user confirmed camera-based finger tracking and entry into on-screen keys. On October 20, 2026, the specification was moved to `D:\github_clone\Music-` with authorization to implement it there. The following initial key count, stack, and parameters form the original baseline; confirmed additions at the end supersede it where stated.

## 1. Goals and boundaries

1. Play through a camera without a touchscreen, physical keys, or extra sensors.
2. Draw keys as independent closed shapes with matching visible and interactive areas.
3. Complete the pipeline from hand tracking and mapping through note triggering, sound, and visual feedback.
4. Demonstrate reliably on the agreed computer/browser and deliver source, instructions, and test evidence.

Contact means a fingertip hitting a region in a 2D image. It does not establish physical screen/table contact. The first version uses hover, without real contact or downward-press detection.

## 2. Initial scope

| Item            | Requirement                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------- |
| Platform        | Desktop browser, initially Chrome/Edge on Windows; record delivered versions                |
| Hardware        | RGB camera and speakers/headphones; wired audio recommended for latency measurement         |
| Video           | Mirrored view with start, pause, resume, and end                                            |
| Keyboard        | Original baseline C4-B4: seven white/five black keys, named; later extended to C5           |
| Shapes          | Programmatically drawn closed keys; no user drawing editor                                  |
| Tracking        | Up to two hands; index fingers by default, optional all fingers                             |
| Trigger         | Confirm hover, release on exit, reconfirm after re-entry                                    |
| Polyphony       | Different fingers can play different notes; four-note chords are a baseline case            |
| Feedback        | Fingertip markers, optional skeleton, hover indication, active-key highlights, current note |
| Settings        | Volume, delay, fingers, key position/size, skeleton                                         |
| Auxiliary input | Mouse keys for debugging and demos                                                          |
| Persistence     | Local settings with reset                                                                   |
| Privacy         | Local frame processing, no video upload/storage                                             |

Possible later work: downward presses, custom shapes, more octaves, velocity simulation, recording, score teaching, mobile support, MIDI output. No accounts, database, or business backend in the baseline. Teaching additions below are subsequently confirmed scope.

## 3. User flow

1. Open the app and read placement/operation guidance.
2. Start, grant camera access, unlock audio, and await model/samples.
3. Check fingertip markers align with visible hands.
4. Adjust layout and hover delay for posture.
5. Enter a key, hover, then leave to release.
6. Enable multiple fingers for chords if desired.
7. Pause to stop triggering/release notes; end to close camera/audio resources.

Show separate camera, model, and audio readiness. Resume requires fresh finger confirmation, not old hover timers.

## 4. Architecture and modules

Use TypeScript, Vite, MediaPipe Hand Landmarker (`@mediapipe/tasks-vision`), Canvas 2D, and Web Audio. Host model/WASM/audio with the app; pin versions and document provenance/licenses.

| Module      | Responsibility                                        | Output                     |
| ----------- | ----------------------------------------------------- | -------------------------- |
| Camera      | Permission, video, device errors, stream release      | Frames and status          |
| Tracking    | Model setup and timestamped two-hand inference        | Landmarks and handedness   |
| Mapping     | Mirroring, scale, cropping/margins, canvas conversion | Canvas fingertip points    |
| Key model   | Closed contours, notes, layers, drawing/hits          | Candidate key              |
| Interaction | Smoothing, dwell, hysteresis, association, loss       | Note on/off events         |
| Audio       | Preload, polyphony, envelopes, cleanup                | Piano audio and status     |
| UI/settings | Status, visual feedback, layout, persistence          | Configuration and feedback |

Pipeline: new frame -> inference -> fingertips -> mapping/smoothing -> key hit -> state machine -> audio/highlight. MediaPipe inference is synchronous: use a worker while the main thread handles UI/audio scheduling. Keep at most one task in flight; skip frames rather than accumulating a queue. Validate transfer method and target-device performance early.

## 5. Core interaction rules

### Geometry and coordinates

- Each key has a unique ID, note, MIDI pitch, closed path, layer, and sample mapping.
- Drawing and hit testing share geometry; black keys win overlaps.
- Preserve video aspect ratio and display it fully by default. Any cropping must share its transform with landmarks.
- Mirror once, with video, landmarks, and hits in the same coordinates.
- Update transforms on resize, DPR changes, and layout changes. Clear active input while adjusting layout.

### Hover and repetition

Each finger independently maintains outside, candidate, and active states.

| Situation                 | Behavior                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| First entry               | Start dwell and show candidate feedback                                                                  |
| Same-key hits reach dwell | Emit one on event and highlight                                                                          |
| Continued hold            | Keep ownership, never attack per frame; allow natural decay                                              |
| Exit release boundary     | Emit off and clear that owner                                                                            |
| Key change                | Release old key and restart confirmation                                                                 |
| Re-entry                  | Confirm again before another attack                                                                      |
| Tracking loss             | Original baseline cancels incomplete dwell and retains active state briefly; see adaptive addition below |
| Tracking returns          | Reestablish candidate without replaying missed notes                                                     |

Initial defaults: 100 ms dwell, adjustable 50-300 ms, and 200 ms loss-release timeout. Use elapsed time, not fixed frame counts; tune against measurements. Apply light smoothing, contracted entry, and expanded release boundaries proportional to key size without invading neighboring key centers. Clear entry into a new key takes priority.

### Hands and ownership

- Associate hands using handedness, wrists, and frame distances; array indices are not permanent IDs.
- Crossed/ambiguous identities require affected input cleanup and fresh confirmation.
- Multiple fingers on one pitch share one attack; only the final departure releases it.
- Handle mouse down/up/exit and window blur to prevent stuck notes.
- Pause, end, backgrounding, and inference errors release all notes through one cleanup path.

### Audio

- Use redistributable piano samples with provenance and decode before Ready.
- Smooth attacks/releases to reduce clicks.
- Create separate voices for polyphony and leave headroom against clipping.
- Holding never automatically repeats; natural sample decay is expected.
- Create/resume AudioContext from a user start click. Unready audio must not appear playable.

## 6. Development tasks

Actual progress and evidence are in the acceptance record.

| ID  | Task                       | Depends on                     | Completion criterion                                   |
| --- | -------------------------- | ------------------------------ | ------------------------------------------------------ |
| T01 | Project/resource inventory | User development authorization | Runs/builds; pinned, traceable assets                  |
| T02 | Camera lifecycle           | T01                            | Open/close and actionable permission/device errors     |
| T03 | MediaPipe worker           | T02                            | Two-hand inference, bounded work, timing output        |
| T04 | Mapping/calibration        | T03                            | Alignment after mirroring/resizing                     |
| T05 | Closed keys/hits           | T01                            | Original 12 keys, correct overlaps, shared paths       |
| T06 | Piano engine               | T01                            | Mouse verifies pitches, polyphony, release-all         |
| T07 | Hover/single finger        | T04-T06                        | Melody, no repeat while held, retrigger on entry       |
| T08 | Jitter/hands/ownership     | T07                            | Four-note chords, shared-note releases, no stuck notes |
| T09 | Settings/feedback          | T07                            | Layout, sensitivity, volume, fingers, reset            |
| T10 | Recovery/performance       | T08-T09                        | Loss, blur, pause, permission/resource failure         |
| T11 | Acceptance/delivery        | T10                            | Build, source, instructions, evidence, limitations     |

Milestones: M1=T01-T04 (inference/mapping), M2=T05-T07 (minimum playable loop), M3=T08-T10 (polyphony/stability), M4=T11 (delivery). Initial estimate: 5-9 working days after authorization for one developer. If device/viewpoint validation fails, provide measurements and proposed adjustments before subsequent work.

## 7. Acceptance conditions

Record computer, CPU, camera, video resolution, browser, audio device, and parameters. Baseline: stable lighting, unobstructed hands, fixed camera, initially 640x480.

| Check                | Method                                        | Pass condition                                                |
| -------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| Mapping              | Center/edges and resizing                     | Aligned fingertips, no systematic shift or wrong mirror       |
| Hits                 | All original 12 keys and overlaps             | Correct names/sound/highlights; black priority                |
| Single attack        | Hold 3 seconds, repeat 10 times               | One attack per entry                                          |
| Repetition           | Enter/exit same key 20 times beyond dwell     | Each valid entry sounds; no stuck note                        |
| Polyphony            | Two/four fingers on distinct keys, 10 repeats | Independent notes and correct releases                        |
| Shared pitch         | Two owners leave separately                   | First attacks, last releases                                  |
| Tracking loss        | Leave camera and return                       | Timed release, reconfirmation, no automatic replay            |
| Pause/background/end | Interrupt playing                             | No new notes; release active audio; end closes camera         |
| Errors               | Deny camera; fail model/audio load            | Specific reason/retry, no false readiness                     |
| Stability            | 15 minutes alternating single/multi-finger    | No crash, stuck note, growing queue, or persistent leak signs |

Target performance is device-measured; suggested recognition rate above 24 FPS without sustained UI stalls. Report separately: configured dwell (initially 100 ms), processing latency (capture/inference/state/audio scheduling), and physical motion-to-sound latency including output. Event timestamp differences are not end-to-end measurements.

Automate overlaps, transforms, hover/repetition, shared ownership, and loss release. Manually assess camera tracking and audible output. Record low light, occlusion, fast motion, and crossed hands separately from baseline.

## 8. Risks and requirements

| Risk                     | Mitigation                                                |
| ------------------------ | --------------------------------------------------------- |
| Adjacent fingers misfire | Index default, finger selection, dwell, hysteresis        |
| Narrow black keys        | Layout scaling, controlled density, one-octave validation |
| Occluded camera view     | Placement guidance and early single/two-hand checks       |
| Smoothing adds latency   | Tune separately from dwell and record tradeoffs           |
| Main-thread blocking     | Worker, bounded tasks, fresh frames, resource release     |
| Resource failure         | Bundled assets, progress, errors/retry                    |
| Browser restrictions     | Explicit start, HTTPS/localhost                           |
| Unclear sample rights    | Clearly licensed material and inventory                   |

## 9. Delivery and completion

Deliver source/lockfile/buildable project; runnable static output/local startup; camera/permission/play/troubleshooting instructions; architecture/rules/parameters/extensions; resource provenance/licenses; acceptance evidence, measurements, and limitations.

Completion requires baseline acceptance of agreed features, no blocking playback defect or persistent stuck sound, and no unreleased camera after end. Document other known issues, impact, and reproduction.

## 10. Technical references

- [MediaPipe Hand Landmarker Web](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js): landmarks, coordinates, APIs, synchronous inference.
- [Browser autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay): user-triggered audio.
- [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia): permission, secure contexts, errors.

## 11. Confirmed addition: songs and note practice (October 21, 2026)

Authorized scope: extend to 13 keys C4-C5, include 3-5 single-melody teaching songs (four implemented), selection, preview, current-target highlight, correct advancement, wrong-note feedback, pause/restart, and results. Explain song sources/adaptations in the UI.

Practice waits for correct input, without rhythm/long-note grading. Repeated notes require release, and success waits for every held key to release. Preview is exclusive and cannot advance practice. Show first-try accuracy, mistakes, completed-note count, and active time excluding pauses.

Local structured scores reject invalid durations/ranges. Song changes, backgrounding, errors, and end cancel old work and release sound while retaining/resetting appropriate state. Test complete songs, repeated pitches, wrong-note hold, simultaneous keys, preview isolation, loading races, and free-play regression. Rhythm scoring, chord teaching, user MIDI uploads, and accounts are excluded.

## 12. Confirmed addition: interaction and teaching improvements (October 21, 2026)

Authorized improvements: adaptive hover tolerance, non-trigger reasons, optional diagnostics, focused practice layout, reach guidance, sections/loops/tricky retries, filters, preview speed, and local completed records.

Unify pause/resume while retaining MediaStream and worker. Resume must not request the camera again; end stops tracks. Verify permission-call count, object identity, and track state rather than appearance alone.

Brief misses may freeze and retain confirmation progress but cannot count missing time or let drawing trigger notes. Slower observations must still confirm; long loss releases. Regress free play, repetition, and preview isolation. Keep 50 records, compare matching song/range, allow clearing. Human feel, real occlusion, and physical reach still need manual acceptance.
