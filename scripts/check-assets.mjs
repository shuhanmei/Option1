import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../public/assets/", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("manifest.json", root), "utf8"),
);
const packageJson = JSON.parse(
  await readFile(
    new URL(
      "../node_modules/@mediapipe/tasks-vision/package.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
if (manifest.mediapipe !== packageJson.version)
  throw new Error("MediaPipe与静态资源版本不一致，请执行 npm run assets");
for (const file of manifest.files) {
  const bytes = await readFile(new URL(file.path, root));
  if (
    bytes.length !== file.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== file.sha256
  )
    throw new Error(
      `资源损坏: ${file.path}。请移除损坏文件后执行 npm run assets。`,
    );
}
console.log(`Verified ${manifest.files.length} local assets (SHA256).`);
