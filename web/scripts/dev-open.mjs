// Local only: start `next dev` with the dev console OPEN (no DEV_CONSOLE_KEY), for automated browser checks.
// An empty value is kept by process.loadEnvFile, so the key in ../.env is ignored. Never used on Render.
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Its own database, so automated checks never touch the owner's local test data.
const scratch = path.join(os.homedir(), ".kitty-dev", "pglite-open");
const child = spawn("npm", ["run", "dev"], { cwd: web, stdio: "inherit", shell: true, env: { ...process.env, DEV_CONSOLE_KEY: "", PGLITE_DIR: scratch } });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
