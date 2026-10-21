import {
  mkdir,
  copyFile,
  readdir,
  writeFile,
  readFile,
  stat,
} from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../public/assets/", import.meta.url);
const files = [];
await mkdir(root, { recursive: true });
async function record(path, source) {
  const data = await readFile(new URL(path, root));
  files.push({
    path,
    source,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
async function fetchBuffer(url, githubContent = false) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`${response.status}: ${url}`);
      if (githubContent) {
        const data = await response.json();
        return Buffer.from(data.content, "base64");
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      last = error;
    }
  }
  throw last;
}
async function download(url, path, githubContent = false) {
  const target = new URL(path, root);
  await mkdir(new URL("./", target), { recursive: true });
  const exists = await stat(target).catch(() => undefined);
  if (!exists?.size)
    await writeFile(target, await fetchBuffer(url, githubContent));
  await record(path, url);
  console.log(`Ready: ${path}`);
}
const pkg = new URL(
  "../node_modules/@mediapipe/tasks-vision/",
  import.meta.url,
);
await mkdir(new URL("mediapipe/wasm/", root), { recursive: true });
for (const file of await readdir(new URL("wasm/", pkg))) {
  if (!/\.(js|wasm)$/.test(file)) continue;
  const path = `mediapipe/wasm/${file}`;
  await copyFile(new URL(`wasm/${file}`, pkg), new URL(path, root));
  await record(path, "@mediapipe/tasks-vision@0.10.32");
}
await copyFile(
  new URL("vision_bundle.cjs", pkg),
  new URL("mediapipe/vision_bundle.js", root),
);
await record("mediapipe/vision_bundle.js", "@mediapipe/tasks-vision@0.10.32");
await copyFile(
  new URL("vision_bundle.cjs.map", pkg),
  new URL("mediapipe/vision_bundle_cjs.js.map", root),
);
await record(
  "mediapipe/vision_bundle_cjs.js.map",
  "@mediapipe/tasks-vision@0.10.32",
);
await download(
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  "hand_landmarker.task",
);
for (const note of ["C4", "Ds4", "Fs4", "A4", "C5"])
  await download(
    `https://tonejs.github.io/audio/salamander/${note}.mp3`,
    `piano/${note}.mp3`,
  );
await download(
  "https://api.github.com/repos/google-ai-edge/mediapipe/contents/LICENSE",
  "licenses/MediaPipe-LICENSE.txt",
  true,
);
await download(
  "https://api.github.com/repos/Tonejs/audio/contents/salamander/README",
  "licenses/Salamander-README.txt",
  true,
);
await download(
  "https://creativecommons.org/licenses/by/3.0/legalcode.txt",
  "licenses/CC-BY-3.0.txt",
);
await writeFile(
  new URL("manifest.json", root),
  JSON.stringify({ mediapipe: "0.10.32", files }, null, 2) + "\n",
);
console.log("All local assets are ready.");
