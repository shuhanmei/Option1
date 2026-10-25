# Air Piano development guide

## Implemented scope

The app has 13 closed keys (C4-C5), up to two tracked hands, index/all-finger modes, hover confirmation, polyphonic ownership, sampled piano, mouse and accessible keyboard input, status feedback, layout controls, local settings, pause/end, and recovery. Four teaching songs, note guidance, preview, and results were added October 21, 2026.

Video stays in the browser. There is no upload endpoint, recording, account, or database. Resources load from the same site.

## Modules

| File                         | Responsibility                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `src/core.ts`                | Geometry, hits, mapping, ownership, hover, hand association, settings validation |
| `src/audio.ts`               | Audio context, five decoded samples, transposition, envelopes, cleanup           |
| `src/tracking.ts`            | Camera permission, capture, worker messages, timeouts                            |
| `public/tracker.worker.js`   | Model setup, inference, landmarks, bitmap cleanup                                |
| `src/main.ts`                | UI, session orchestration, controls, canvas                                      |
| `src/songs.ts`               | Scores, pitch names, validation, practice-note extraction                        |
| `src/lesson.ts`              | Note-by-note state, mistakes, timing                                             |
| `src/song-player.ts`         | Audio-clock previews and cancellation                                            |
| `src/practice.ts`            | Sections, tricky ranges, record validation                                       |
| `src/style.css`              | Theme, layout, responsiveness, accessibility                                     |
| `scripts/prepare-assets.mjs` | Runtime copy, downloads, integrity manifest                                      |
| `scripts/check-assets.mjs`   | Hash and MediaPipe version checks                                                |
| `tests/*.test.ts`            | Isolated rules and state-machine checks                                          |
| `tests/browser/`             | Browser integration and end-to-end checks                                        |

## Coordinates and closed geometry

Video uses `object-fit: contain` and horizontal mirroring. `mapPoint` uses identical scaling and margins and mirrors exactly once. Logical canvas units are CSS pixels; DPR affects backing resolution only. Generate keys inside the actual video content rectangle, excluding letterboxing. Resize, DPR changes, camera readiness, and layout changes regenerate geometry and release input.

White and black keys share rectangular data between drawing and hit tests. Black keys draw later and win overlaps. Polygon extensions must update both methods together.

## Hand association and hover

Associate wrists by distance and handedness, independently of detection order. Ambiguity creates a new ID; old state expires. A 35 ms time constant smooths positions without predicting occlusion.

Finger IDs are `hand:<hand-id>:<landmark-index>`. Index mode uses 8; all fingers use 4, 8, 12, 16, 20. States are outside, candidate, active. Key changes restart timing; staying never repeats attacks. Contract entry and expand hold boundaries slightly. A black-key edge cannot fall through to the white key underneath. Default dwell: 100 ms, adjustable 50-300 ms.

`confirmedMs` accumulates valid consecutive observations, at most 120 ms per update. A miss sets `interrupted`; progress can survive briefly, but the returning frame cannot count the gap. Cadence is an exponential mean; `graceMs = clamp(cadence * 2.5, 160, 320)`. Candidates clear on timeout; active release waits `max(200, graceMs)`. Expiration requires reconfirmation.

Only new observations attack. Drawing-loop `expire` can release only. Rings never fill by wall-clock time. Hand identities persist at most 350 ms while note timeout remains independent. `NoteOwners` unifies inputs: first owner attacks, final owner releases. Pause, blur, end, layout/config changes clear all input.

## Inference and lifecycle

Transfer at most one ImageBitmap at a time to a classic worker. Classic mode supports WASM `importScripts`; define `self.exports` before importing the CommonJS bundle. Always close images in `finally`.

Process new video timestamps, capped near 30 FPS. Model initialization times out at 45 seconds and in-flight inference at 5 seconds. Both report errors and clean up. Results older than 200 ms cannot interact; cold-start frames may be skipped before subsequent valid frames.

States are stopped, starting, running, paused, stopping. Generation numbers isolate late permission/model/audio tasks. Stop a late stream after cancellation. Pause retains the stream and worker. End terminates the worker, stops tracks, disconnects video, and closes audio.

## Audio

Five samples cover C4, D-sharp-4, F-sharp-4, A4, C5. Other pitches transpose the nearest sample by semitone distance. Holding does not loop samples or simulate velocity. Each attack creates a BufferSource with an 8 ms fade-in; release fades for 120 ms. Master gain and a compressor reduce polyphonic peaks. End stops release tails and closes AudioContext. All samples must decode before Ready; failure allows retry.

## Songs, lessons, and previews

`SongStep` stores MIDI pitch and quarter-note beats; `null` is rest. Validate tempo, duration, count, and MIDI 60-72 before starting. Practice removes rests; previews retain timing. Built-ins are manual teaching arrangements with source/adaptation notes.

`Lesson` is independent of DOM: idle, playing, release, paused, completed. `index` counts completed notes and identifies the target. Valid user ownership events feed audio and lessons, preventing per-frame duplicate assessment. Correct on consumes one step and waits for `held` to empty. Wrong on retains progress, increments mistakes, and shows 500 ms feedback. Duplicate presses and release-gate attacks do not consume steps. Timing uses `performance.now()`, excludes pause, and freezes on completion.

`SongPlayer` converts beats with `beats * 60 / BPM`, scheduling 80 ms ahead on `AudioContext.currentTime`. A 25 ms timer reads the clock for visuals only. `PianoAudio.schedule` owns separate sources, bypassing ownership and lesson input; preview cannot complete lessons.

Before song changes, library return, restart, pause, blur, or hiding, pause assessment, release user notes, and cancel preview timers/sources. `lessonGeneration` rejects obsolete loading callbacks. Both pause controls call `togglePause`; resume reuses stream/worker without `openCamera`. Only end calls `tracker.stop`. Reach checking explicitly keeps lessons paused while accepting gestures; mouse cannot pass it.

Targets use blue outlines/arrows, actual input green, and mistakes orange. White-key target outlines sit below black keys. A separate strip shows five upcoming notes. Practice does not assess rhythm, rests, or long notes. Accuracy is `firstTry / notes.length`, not eventual success.

`mistakeSteps` finds a retry range with neighboring context. `songSection` slices by actual note index and retains internal rests/durations. Practice and preview share the range. Preview speed changes timing only.

Completion saves to `air-piano:history:v1`: 50 stored, 10 displayed. Reads validate song/range/date/duration/counts; output uses `textContent`. Compare the same song/range only. `recorded` prevents redraw/off duplicates. Loops require completion plus empty ownership; `allowLoop` and `clearingNotes` prevent cleanup from accidentally restarting.

Feedback refreshes every 150 ms. Expanded diagnostics show cadence, stale frames, and reasons without video/history storage. Practice/preview hides library/introduction; Back to library enables reselection.

## Settings and extension constraints

Validate `air-piano:v1` types and bounds; malformed JSON uses defaults and blocked storage still permits a session. More octaves require geometry, sample mapping, width, and test changes. Downward-press detection needs its own strategy and posture calibration. Relative model z is not real contact distance.

Production assumes domain-root hosting; subpaths need worker path changes. Review licenses and regenerate the manifest after intentional asset updates. Do not commit dependencies, work files, temporary tests, or credentials. Preserve third-party bytes and licenses.
