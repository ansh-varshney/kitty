import fs from "node:fs";
import path from "node:path";

/**
 * Secrets live in the repo root (Kitty/.env), one level above this app. Node's built-in loader
 * reads it into process.env without overriding anything already set. On Render the vars come
 * from the dashboard and the file doesn't exist, which is fine.
 */
let loaded = false;
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  for (const file of [path.resolve(process.cwd(), "..", ".env"), path.resolve(process.cwd(), ".env.local")]) {
    if (fs.existsSync(file)) process.loadEnvFile(file);
  }
}
