const [major, minor] = process.versions.node.split(".").map(Number);
if (
  !(
    (major === 20 && minor >= 19) ||
    (major === 22 && minor >= 12) ||
    major > 22
  )
) {
  console.error(
    `Node.js ${process.versions.node} is too old. Install Node.js 22.12 or newer, reopen your terminal, or use start.cmd with the project-local runtime.`,
  );
  process.exit(1);
}
