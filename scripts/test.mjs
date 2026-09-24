import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

// Every run gets its own disposable Postgres cluster, never the application's database.
const root = mkdtempSync(
  join(
    process.platform === "darwin" ? "/private/tmp" : tmpdir(),
    "fixtrail-pg-",
  ),
);
const data = join(root, "data");
let started = false;
function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${cmd} failed. Install PostgreSQL and put initdb/pg_ctl on PATH.\n${result.error?.message || result.stderr || result.stdout}`,
    );
  }
}
try {
  run("initdb", ["-D", data, "-A", "trust", "--no-locale", "--encoding=UTF8"]);
  run("pg_ctl", [
    "-D",
    data,
    "-l",
    join(root, "postgres.log"),
    "-o",
    `-h '' -k ${root} -F`,
    "-w",
    "start",
  ]);
  started = true;
  const url = `postgresql://${encodeURIComponent(userInfo().username)}@localhost/postgres?host=${encodeURIComponent(root)}`;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", "tests/core.test.ts"],
    {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: url },
    },
  );
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  try {
    console.error(readFileSync(join(root, "postgres.log"), "utf8"));
  } catch {}
  process.exitCode = 1;
} finally {
  if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
  rmSync(root, { recursive: true, force: true });
}
