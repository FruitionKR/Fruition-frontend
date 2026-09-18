// mock API 서버와 next dev를 함께 띄운다. 한쪽이 끝나거나 Ctrl+C면 둘 다 종료한다.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const mock = spawn(process.execPath, [path.join(root, "mock", "server.mjs")], { cwd: root, stdio: "inherit" });
const next = spawn(npx, ["next", "dev"], { cwd: root, stdio: "inherit", env: { ...process.env, ACCESS_CODE: "" } });

let exiting = false;
function stopAll(code = 0) {
  if (exiting) return;
  exiting = true;
  for (const child of [mock, next]) if (child.exitCode === null) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}

mock.on("exit", (code) => stopAll(code ?? 0));
next.on("exit", (code) => stopAll(code ?? 0));
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
