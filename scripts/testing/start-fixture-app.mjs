/** Test launcher only. Environment overrides affect this child process, never .env.local. */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const port = Number(process.env.FIXTURE_APP_PORT || 43000);
const child = spawn(process.execPath, [fileURLToPath(new URL("../../node_modules/next/dist/bin/next", import.meta.url)), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: fileURLToPath(new URL("../../", import.meta.url)),
  env: { ...process.env, NOVELAI_TEST_MODE: "1", NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${Number(process.env.FIXTURE_PORT || 43001)}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "testanon-fixture-only" },
  stdio: "inherit", windowsHide: true,
});
child.on("error", (error) => { console.error(error); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code || 0; });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
