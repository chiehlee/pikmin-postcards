import path from "node:path";
import { projectRoot } from "./database.mjs";

export function publicPathToLocalPath(publicPath) {
  if (typeof publicPath !== "string" || !publicPath.startsWith("/images/")) {
    throw new Error(`Unsupported public asset path: ${publicPath}`);
  }
  const segments = publicPath.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error(`Unsafe public asset path: ${publicPath}`);
  }
  return path.posix.join("public", publicPath);
}

export function resolveStoredLocalPath(storedPath) {
  return path.isAbsolute(storedPath)
    ? storedPath
    : path.resolve(projectRoot, storedPath);
}

export function storeLocalPath(absolutePath) {
  const resolved = path.resolve(absolutePath);
  const relative = path.relative(projectRoot, resolved);
  if (relative && !relative.startsWith(`..${path.sep}`) && relative !== "..") {
    return relative.split(path.sep).join(path.posix.sep);
  }
  return resolved;
}
