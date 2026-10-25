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
  throw new Error(
    "MediaPipe and static asset versions differ. Run npm run assets.",
  );
for (const file of manifest.files) {
  const bytes = await readFile(new URL(file.path, root));
  if (
    bytes.length !== file.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== file.sha256
  )
    throw new Error(
      `Asset integrity mismatch: ${file.path}. Remove the damaged file and run npm run assets.`,
    );
}
console.log(`Verified ${manifest.files.length} local assets (SHA256).`);
