# Air Piano acceptance record

Historical test results below describe their recorded environment and version, not a claim that every test passes on every computer.

## English conversion and local startup repair - October 22, 2026

Local setup initially used Node.js 16.16.0, which cannot run Vite 7.3.1. A verified official project-local Node.js 22.23.4 runtime was prepared, with `start.cmd` to prefer it. Six assets had CRLF conversions; restoring original LF bytes matched the recorded SHA256 hashes. `.gitattributes` prevents recurrence, and scripts report unsupported Node versions clearly.

The interface, song metadata, help, feedback, and errors were converted to English. Production build, 36 unit tests, and eight lesson/optimization browser tests passed. Desktop and 390-pixel layouts were checked without horizontal overflow or Chinese visible text. Real-model image recognition passed, but two live-tracking checks failed in the automated environment; one measured inference took about 14 seconds. Physical-camera performance remains unverified here. This differs from the historical measurements below.

## Interaction improvements - October 21, 2026

Added adaptive hover tolerance, observation-based progress, black-key edge protection, input reasons/diagnostics, shared pause behavior, focused practice, filters, sections/loops, tricky retries, preview speed, reach checks, and local history.

- 36 unit checks passed, including 150 ms cadence, frozen missing-frame progress, no clock-only attack, black-edge protection, sections, mistakes, records, and speed.
- 19 browser checks passed in the recorded environment, including free play/real-model regression, full songs, loops/history, invalid ranges, tricky retries, and diagnostics.
- Camera reuse: alternate both pause controls for two rounds; `getUserMedia` stays at one call, MediaStream identity is unchanged, tracks stay live, and end changes them to ended. Mouse/keyboard cannot pass reach checking.
- Build and 15 asset hashes passed; desktop/390-pixel screenshots checked.

Synthetic camera plus real MediaPipe was used. Human low-rate/occlusion feel and physical reach remain manual checks. The 15-minute run was not repeated. Earlier fixed-timeout and non-persistence descriptions are superseded by these changes.

## Songs and note practice - October 21, 2026

Implemented four songs, 13 keys C4-C5, selection/range checks, synchronized preview, targets, wrong-note hold, full-release gating, pause/resume, and results, retaining free play.

| Check                   | Recorded result | Evidence                                                                                                                   |
| ----------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Build/integrity         | Pass            | TypeScript, Vite, 15 hashes                                                                                                |
| Unit tests              | 29 passed       | Original 12 plus 17 score/repetition/release/timing/scheduling/cancellation checks                                         |
| Browser tests           | 16 passed       | Original 11 plus five teaching flows; 42-note completion, accuracy, pause, load races, isolation, narrow layout            |
| Real-model lesson input | Pass            | Official image index finger triggered F-sharp-4, advancing original steps from 6/26 to 7/26; holding did not advance again |
| Visual inspection       | Pass            | 1440x1100 and 390x844 screenshots; targets, library, practice, no horizontal overflow                                      |

Adding C5 moved the fixed fixture's hit from F4 to F-sharp-4; browser/soak expectations were updated. The 15-minute record below belongs to the original 12-key app, not this version. A human still needs to complete a song on the target camera and assess stability and sound.

First-try accuracy counts steps correct on their first attempt divided by total notes; pauses are excluded from time. Rhythm, rests, long notes, and chords are not assessed. At this historical stage results were not persisted. Song sources/adaptations were shown in the UI.

## Original acceptance - October 20, 2026

Historical workspace: `D:\github_clone\Music-`. Scope: initial implementation, automated tests, production build. Recorded environment: Windows 10.0.26200, Intel Core Ultra 9 275HX, Node.js v24.18.0, Edge 155.0.4283.62, headless browser. Synthetic input is not physical-camera performance.

T01-T10 features were implemented. T11 source, static build, startup/development instructions, and resource licensing were delivered; manual physical-camera/human acceptance remained pending. The original direction remained ordinary computer, camera tracking, 2D closed keys, and hover.

| Check                | Recorded result | Coverage                                                                                                    |
| -------------------- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| TypeScript/Vite      | Pass            | Complete static site with model/WASM/audio                                                                  |
| Integrity            | Pass            | 15 SHA256 checks and MediaPipe version                                                                      |
| Vitest               | 12 passed       | Black priority, mapping, hover/repetition, shared/four-note ownership, loss, identity, settings             |
| Browser integration  | 11 passed       | Real worker/model, video, image-to-note, retry, blur/background, mouse/keyboard, touch chord, narrow screen |
| Production resources | Pass            | Fixed MIME loading by serving CommonJS content as .js; static-preview inference verified                    |
| Visual review        | Pass            | Desktop/narrow screenshots; fixed initial narrow-screen overlap                                             |
| 15-minute replay     | Pass            | Production build and official image input; details below                                                    |

Browser checks used real MediaPipe and Web Audio with synthetic video, including no-hand frames and the official image. They observed 21 landmarks and tested F4 attack, a single attack during hold, release on loss, re-entry, pause/resume.

Audio checks verified decoded nonzero samples and real source starts; they do not establish audible speaker quality or physical output latency. Four-note touch input used browser events on C4/E4/G4/B4, not human four-finger tracking.

## Historical continuous replay

The original production build replayed a static hand image for 15 minutes, with 30 samples and no page exceptions or stalled recognition. All samples retained F4; end released video.

- Recognition updates: 30-31 FPS.
- Stable-phase sampled inference: 6-16 ms.
- Renderer JS heap after collection: about 2.47-2.52 MiB, without a sustained sampled increase.
- Raw data: [soak-report.json](soak-report.json). Display-state labels are translated; numeric data, date, and outcome are unchanged.

This covers video transfer, inference, fingertip state, and end cleanup. It does not replace a human 15-minute repeat/chord session or analyze all GPU, worker, and physical-camera memory.

## Resolved issues

1. Shared pitch releases only when its final owner leaves.
2. Late streams after canceled startup are stopped using generation isolation.
3. Old end/restart callbacks cannot overwrite a new session.
4. Old audio loads cannot replace new-context buffers/status.
5. CommonJS runtime served as .js fixes classic-worker MIME loading.
6. Geometry stays within actual video content after aspect changes.
7. Narrow-screen empty-state decorations no longer overlap keys.
8. The Windows test runner owns Vite in-process so it closes normally after tests.

## Physical-device checklist

All items remain pending unless separately documented.

| Item                         | Method                                                           |
| ---------------------------- | ---------------------------------------------------------------- |
| Camera alignment             | Center/edges, then resize and recheck                            |
| All 13 keys                  | Match note/highlight/sound, especially black keys and C5         |
| Full human song              | Gestures, target guidance, repeated notes, pause/results         |
| Same-key repetition          | 20 full exits/entries beyond dwell                               |
| Two/four-finger chords       | Human input, occlusion, releases                                 |
| Low light/complex background | Record false/missed notes separately from baseline               |
| Crossed hands/fast motion    | Check identities, release, reconfirmation                        |
| Long playing                 | 15 minutes observing camera, sound, browser resources            |
| End-to-end latency           | External audiovisual recording; separate dwell/processing/output |
| First-time user              | Follow in-app guidance without extra verbal coaching             |

## Limitations

- A monocular camera tests 2D regions, not real screen/table contact.
- Overlapping hands, low light, motion blur, and finger occlusion can reduce stability.
- Cold GPU/CPU inference can be much slower; stale results are discarded.
- Displayed inference time excludes dwell, camera acquisition, and audio output.
- One octave, one sampled velocity, transposition, no pedal or real velocity simulation.
- Root hosting is assumed; subpaths require asset-path changes.
