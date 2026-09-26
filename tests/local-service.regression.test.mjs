import assert from "node:assert/strict";
import test from "node:test";
import {
  activeJobCount,
  classifyChangedPaths,
  renderLaunchAgent,
} from "../scripts/local-service.mjs";

test("local service only rebuilds runtime-affecting commits", () => {
  assert.deepEqual(
    classifyChangedPaths(["README.md", "tests/example.regression.test.mjs"]),
    { build: false, installDependencies: false, syncDatabase: false },
  );
  assert.deepEqual(
    classifyChangedPaths(["app/page.tsx"]),
    { build: true, installDependencies: false, syncDatabase: false },
  );
  assert.deepEqual(
    classifyChangedPaths(["package-lock.json"]),
    { build: true, installDependencies: true, syncDatabase: false },
  );
  assert.deepEqual(
    classifyChangedPaths(["db/migrations/019_example.sql"]),
    { build: true, installDependencies: false, syncDatabase: true },
  );
  assert.deepEqual(
    classifyChangedPaths([], { initial: true }),
    { build: true, installDependencies: false, syncDatabase: false },
  );
});

test("local service defers deployment while AI jobs are active", () => {
  assert.equal(activeJobCount(null), 0);
  assert.equal(activeJobCount({ jobs: [] }), 0);
  assert.equal(activeJobCount({ jobs: [
    { status: "queued" },
    { status: "in_progress" },
    { status: "applying" },
    { status: "completed" },
  ] }), 3);
});

test("launch agent keeps the supervisor alive and escapes local paths", () => {
  const plist = renderLaunchAgent({
    label: "com.example.postcards",
    nodePath: "/Users/example/Node & Tools/node",
    scriptPath: "/Users/example/Postcards/scripts/local-service.mjs",
    projectRoot: "/Users/example/Postcards",
    logPath: "/Users/example/Postcards Data/logs/service.log",
    executablePath: "/usr/bin:/bin",
  });
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(plist, /Node &amp; Tools\/node/);
  assert.match(plist, /local-service\.mjs/);
});
