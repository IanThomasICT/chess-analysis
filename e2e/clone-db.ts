/**
 * Clone the production database into an isolated file for e2e/test runs.
 *
 *   bun e2e/clone-db.ts            # analysis.db → test.db
 *   SOURCE_DB=foo.db DATABASE_PATH=bar.db bun e2e/clone-db.ts
 *
 * Uses SQLite `VACUUM INTO`, which takes a consistent read snapshot of the
 * source — safe to run while another process (e.g. the metrics backfill) is
 * actively writing analysis.db under WAL. The source is never modified.
 */
import { Database } from "bun:sqlite";
import { existsSync, rmSync } from "node:fs";

const SRC = process.env.SOURCE_DB ?? "analysis.db";
const DEST = process.env.DATABASE_PATH ?? "test.db";

if (!existsSync(SRC)) {
  console.error(`Source DB not found: ${SRC}`);
  process.exit(1);
}

// VACUUM INTO refuses to overwrite, so clear any prior clone (+ WAL sidecars).
for (const file of [DEST, `${DEST}-wal`, `${DEST}-shm`]) {
  if (existsSync(file)) {
    rmSync(file);
  }
}

const db = new Database(SRC);
db.run(`VACUUM INTO '${DEST}'`);
db.close();

console.log(`Cloned ${SRC} → ${DEST}`);
