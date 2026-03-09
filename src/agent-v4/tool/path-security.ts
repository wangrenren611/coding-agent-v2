import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function expandHomePath(rawPath: string): string {
  if (rawPath === '~') {
    return os.homedir();
  }
  if (rawPath.startsWith('~/')) {
    return path.join(os.homedir(), rawPath.slice(2));
  }
  return rawPath;
}

function normalizeExistingPath(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function normalizeAllowedDirectories(inputDirectories?: string[]): string[] {
  const directories =
    inputDirectories && inputDirectories.length > 0 ? inputDirectories : [process.cwd()];
  return directories.map((directory) => normalizeExistingPath(expandHomePath(directory)));
}

export function resolveRequestedPath(requestedPath: string, baseDirectory = process.cwd()): string {
  const expanded = expandHomePath(requestedPath.trim());
  if (path.isAbsolute(expanded)) {
    return path.resolve(expanded);
  }
  return path.resolve(baseDirectory, expanded);
}

export function normalizePathWithExistingAncestor(inputPath: string): string {
  const absolute = path.resolve(inputPath);
  let current = absolute;
  const trailingSegments: string[] = [];

  for (;;) {
    try {
      const realCurrent = fs.realpathSync(current);
      if (trailingSegments.length === 0) {
        return realCurrent;
      }
      return path.join(realCurrent, ...trailingSegments.reverse());
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'ENOENT' && nodeError.code !== 'ENOTDIR') {
        return absolute;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return absolute;
      }
      trailingSegments.push(path.basename(current));
      current = parent;
    }
  }
}

function isPathInsideDirectory(candidatePath: string, directoryPath: string): boolean {
  return candidatePath === directoryPath || candidatePath.startsWith(`${directoryPath}${path.sep}`);
}

export function isWithinAllowedDirectories(
  candidatePath: string,
  allowedDirectories: string[]
): boolean {
  const normalizedCandidate = normalizePathWithExistingAncestor(candidatePath);
  return allowedDirectories.some((allowedDirectory) =>
    isPathInsideDirectory(normalizedCandidate, allowedDirectory)
  );
}

export function ensurePathWithinAllowed(
  candidatePath: string,
  allowedDirectories: string[],
  errorPrefix = 'PATH_NOT_ALLOWED'
): string {
  const normalizedCandidate = normalizePathWithExistingAncestor(candidatePath);
  const allowed = allowedDirectories.some((allowedDirectory) =>
    isPathInsideDirectory(normalizedCandidate, allowedDirectory)
  );
  if (!allowed) {
    throw new Error(
      `${errorPrefix}: ${candidatePath} is outside allowed directories: ${allowedDirectories.join(', ')}`
    );
  }
  return normalizedCandidate;
}

export function toPosixPath(rawPath: string): string {
  return rawPath.split(path.sep).join('/');
}
