#!/usr/bin/env node

import path from "node:path";
import { loadDotenv } from "vinext/internal/config/dotenv";
import { startProdServer } from "vinext/server/prod-server";

const projectRoot = path.resolve(process.env.PIKMIN_PROJECT_ROOT?.trim() || process.cwd());
const outDir = path.resolve(argument("--out-dir") ?? path.join(projectRoot, "dist"));
const host = argument("--hostname") ?? "0.0.0.0";
const port = parsePort(argument("--port") ?? process.env.PORT ?? "3000");

loadDotenv({ root: projectRoot, mode: "production" });
await startProdServer({ host, port, outDir });

function parsePort(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error(`Invalid port: ${value}`);
  return parsed;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}
