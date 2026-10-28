import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const source = resolve(root, "web/dist");
const target = resolve(root, "server/webui/dist");
if (
  target !== resolve(root, "server", "webui", "dist") ||
  !target.startsWith(resolve(root) + (process.platform === "win32" ? "\\" : "/"))
) {
  throw new Error("Unexpected embedded assets directory");
}
// Only generated assets are replaced; never merge obsolete pages into a build.
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
console.log("Synced Rsbuild output to server/webui/dist");
