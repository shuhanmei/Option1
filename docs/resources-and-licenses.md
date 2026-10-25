# Third-party resources and licenses

## MediaPipe

- Runtime: `@mediapipe/tasks-vision@0.10.32`, pinned in `package-lock.json`.
- Distribution: `public/assets/mediapipe/vision_bundle.js` is the package's unchanged `vision_bundle.cjs` with a browser-compatible extension; includes its source map and SIMD/non-SIMD WASM loaders/binaries.
- License: Apache License 2.0; full text in `public/assets/licenses/MediaPipe-LICENSE.txt`.
- Model: Hand Landmarker, float16, version 1, including palm detection and hand landmarks.
- [Model download](https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task).
- [Official model card and licensing](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20%28Lite_Full%29%20with%20Fairness%20Oct%202021.pdf): Apache License 2.0.
- [Official Web API documentation](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js).

## Salamander Grand Piano

- Author: Alexander Holm; instrument: sampled Yamaha C5 piano.
- Source: [Tone.js Audio Salamander](https://github.com/Tonejs/audio/tree/master/salamander).
- License: [Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/).
- Original credit/license statement: `public/assets/licenses/Salamander-README.txt`.
- Full license: `public/assets/licenses/CC-BY-3.0.txt`.
- The app distributes five unchanged MP3 samples: C4, D-sharp-4, F-sharp-4, A4, C5. Other notes are transposed at playback; gain and attack/release envelopes are applied at runtime.
- In-app help preserves credit, license, and transposition details. `THIRD_PARTY_NOTICES.txt` in the build root also preserves attribution.

## Development and testing dependencies

Vite, TypeScript, Vitest, Playwright, and Prettier support development, builds, or tests only. Exact versions are in the lockfile; installed package directories retain licenses. Playback does not load them from public CDNs.

Browser tests download the [official Google hand fixture](https://storage.googleapis.com/mediapipe-assets/thumb_up.jpg) into ignored `work/thumb_up.jpg` for synthetic camera replay. The fixture is not distributed with the application build.

## Integrity

`public/assets/manifest.json` records origin, byte length, and SHA256. Build checks every file and verifies installed MediaPipe matches the manifest. `.gitattributes` prevents line-ending conversion of bundled asset bytes.

`npm run assets` copies the pinned runtime, preserves existing downloads, and regenerates the manifest. For damaged content, remove the specific damaged file before downloading again. Regenerating hashes is not a substitute for reviewing unexpected changes. Preserve third-party assets and original license texts.
