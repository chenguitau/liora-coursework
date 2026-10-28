import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "liora-e2e-"));
const binary = join(temporary, process.platform === "win32" ? "liora.exe" : "liora");
const config = join(temporary, "config.json");
writeFileSync(config, "{}");
const result = spawnSync("go", ["build", "-tags", "embedui", "-o", binary, "./cmd/liora"], {
  cwd: root,
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);
const environment = { ...process.env };
// No test may inherit a real model provider or make paid model calls.
for (const key of Object.keys(environment)) {
  if (key.startsWith("LIORA_LLM_") || key.endsWith("API_KEY")) delete environment[key];
}
const port = process.env.LIORA_E2E_PORT || "18787";
const child = spawn(
  binary,
  ["-addr", `127.0.0.1:${port}`, "-proxy=", "-data", join(temporary, "data"), "-key-dir", join(temporary, "auth")],
  {
    cwd: temporary,
    stdio: "inherit",
    env: {
      ...environment,
      LIORA_CONFIG: config,
      LIORA_SQLITE_PATH: join(temporary, "data", "liora.db"),
      LIORA_SKILL_DIR: join(root, "skills"),
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill());
child.on("exit", (code) => process.exit(code ?? 0));
