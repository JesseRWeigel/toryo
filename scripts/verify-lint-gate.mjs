import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error(
    "npm_execpath is unavailable. Run this check with `npm run test:lint-gate`."
  );
}

const fixtureRoot = await mkdtemp(path.join(repoRoot, "packages", "lint-fixture-"));
const fixtureSource = path.join(fixtureRoot, "src");
const fixtureFile = path.join(fixtureSource, "seeded-violation.ts");

try {
  await mkdir(fixtureSource);
  await writeFile(fixtureFile, "const seededLintViolation = 1;\n", "utf8");

  const result = spawnSync(process.execPath, [npmCli, "run", "lint"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const fixtureName = path.basename(fixtureRoot);

  if (result.status === 0) {
    throw new Error("The lint command accepted the seeded violation.");
  }
  if (
    !output.includes(fixtureName) ||
    !output.includes("@typescript-eslint/no-unused-vars")
  ) {
    throw new Error(
      `Lint failed for an unrelated reason instead of rejecting the seeded violation:\n${output}`
    );
  }

  console.log("Lint gate rejected the seeded no-unused-vars violation.");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
