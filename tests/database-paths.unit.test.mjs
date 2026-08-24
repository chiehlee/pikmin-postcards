import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveDatabasePath, resolveProjectRoot } from "../db/database.mjs";

test("project root follows the runtime working directory after the repository moves", () => {
  const movedDirectory = path.join(path.parse(process.cwd()).root, "moved", "pikmin-postcards");

  assert.equal(
    resolveProjectRoot({ environment: {}, workingDirectory: movedDirectory }),
    path.resolve(movedDirectory),
  );
});

test("an explicit project root overrides the runtime working directory", () => {
  const configuredRoot = path.join(path.parse(process.cwd()).root, "srv", "pikmin-postcards");

  assert.equal(
    resolveProjectRoot({
      environment: { PIKMIN_PROJECT_ROOT: `  ${configuredRoot}  ` },
      workingDirectory: path.join(path.parse(process.cwd()).root, "wrong-directory"),
    }),
    path.resolve(configuredRoot),
  );
});

test("the server database path is configurable without exposing it to the browser", () => {
  const root = path.join(path.parse(process.cwd()).root, "srv", "pikmin-postcards");
  const configured = path.join(path.parse(process.cwd()).root, "private", "archive.sqlite3");

  assert.equal(resolveDatabasePath({ environment: {}, root }), path.join(root, "var/pikmin-postcards.sqlite3"));
  assert.equal(
    resolveDatabasePath({ environment: { PIKMIN_DB_DRIVER: "sqlite", PIKMIN_DATABASE_PATH: configured }, root }),
    configured,
  );
  assert.throws(
    () => resolveDatabasePath({ environment: { PIKMIN_DB_DRIVER: "postgresql" }, root }),
    /currently supports sqlite/,
  );
});
