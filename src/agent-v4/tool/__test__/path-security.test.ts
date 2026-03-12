import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  expandHomePath,
  normalizeAllowedDirectories,
  resolveRequestedPath,
  normalizePathWithExistingAncestor,
  isWithinAllowedDirectories,
  assessPathAccess,
  ensurePathWithinAllowed,
  toPosixPath,
} from '../path-security';

describe('expandHomePath', () => {
  it('expands ~ to home directory', () => {
    const result = expandHomePath('~');
    expect(result).toBe(os.homedir());
  });

  it('expands ~/path to home directory path', () => {
    const result = expandHomePath('~/Documents');
    expect(result).toBe(path.join(os.homedir(), 'Documents'));
  });

  it('returns absolute path unchanged', () => {
    const absolutePath = '/absolute/path';
    expect(expandHomePath(absolutePath)).toBe(absolutePath);
  });

  it('returns relative path unchanged', () => {
    const relativePath = 'relative/path';
    expect(expandHomePath(relativePath)).toBe(relativePath);
  });

  it('handles empty string', () => {
    expect(expandHomePath('')).toBe('');
  });
});

describe('normalizeAllowedDirectories', () => {
  it('returns current working directory when no input', () => {
    const result = normalizeAllowedDirectories();
    expect(result).toEqual([process.cwd()]);
  });

  it('returns current working directory for empty array', () => {
    const result = normalizeAllowedDirectories([]);
    expect(result).toEqual([process.cwd()]);
  });

  it('normalizes single directory', () => {
    const result = normalizeAllowedDirectories(['/tmp']);
    expect(result).toHaveLength(1);
    // On macOS, /tmp is a symlink to /private/tmp
    expect(result[0]).toBe(fs.realpathSync('/tmp'));
  });

  it('normalizes multiple directories', () => {
    const tempDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'test1-'));
    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'test2-'));
    try {
      const result = normalizeAllowedDirectories([tempDir1, tempDir2]);
      expect(result).toHaveLength(2);
      expect(result).toContain(fs.realpathSync(tempDir1));
      expect(result).toContain(fs.realpathSync(tempDir2));
    } finally {
      fs.rmSync(tempDir1, { recursive: true });
      fs.rmSync(tempDir2, { recursive: true });
    }
  });

  it('expands home paths', () => {
    const result = normalizeAllowedDirectories(['~/Documents']);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(fs.realpathSync(path.join(os.homedir(), 'Documents')));
  });

  it('resolves relative paths', () => {
    const result = normalizeAllowedDirectories(['./relative']);
    expect(result).toHaveLength(1);
    expect(path.isAbsolute(result[0])).toBe(true);
  });
});

describe('resolveRequestedPath', () => {
  it('resolves absolute path', () => {
    const result = resolveRequestedPath('/absolute/path');
    // On Windows, path.resolve converts /absolute/path to D:\absolute\path
    expect(path.isAbsolute(result)).toBe(true);
    expect(result).toContain('absolute');
    expect(result).toContain('path');
  });

  it('resolves relative path with default base', () => {
    const result = resolveRequestedPath('relative/path');
    expect(result).toBe(path.resolve(process.cwd(), 'relative/path'));
  });

  it('resolves relative path with custom base', () => {
    const result = resolveRequestedPath('relative/path', '/custom/base');
    expect(result).toBe(path.resolve('/custom/base', 'relative/path'));
  });

  it('expands home path', () => {
    const result = resolveRequestedPath('~/Documents');
    expect(result).toBe(path.join(os.homedir(), 'Documents'));
  });

  it('trims whitespace', () => {
    const result = resolveRequestedPath('  /path  ');
    // On Windows, path.resolve converts /path to D:\path
    expect(path.isAbsolute(result)).toBe(true);
    expect(result).toContain('path');
  });
});

describe('normalizePathWithExistingAncestor', () => {
  it('returns real path for existing path', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    try {
      const result = normalizePathWithExistingAncestor(tempDir);
      expect(result).toBe(fs.realpathSync(tempDir));
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('returns resolved path for non-existing path with existing parent', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    try {
      const nonExisting = path.join(tempDir, 'non-existing');
      const result = normalizePathWithExistingAncestor(nonExisting);
      expect(result).toBe(path.join(fs.realpathSync(tempDir), 'non-existing'));
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('returns absolute path for completely non-existing path', () => {
    const result = normalizePathWithExistingAncestor('/completely/non-existing/path');
    expect(path.isAbsolute(result)).toBe(true);
  });

  it('handles root directory', () => {
    const result = normalizePathWithExistingAncestor('/');
    // On Windows, root is 'D:\' not '/'
    expect(path.isAbsolute(result)).toBe(true);
  });
});

describe('isWithinAllowedDirectories', () => {
  it('returns true for path within allowed directory', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    try {
      const subDir = path.join(tempDir, 'subdir');
      fs.mkdirSync(subDir);

      // Normalize the allowed directories
      const allowedDirs = normalizeAllowedDirectories([tempDir]);
      const result = isWithinAllowedDirectories(subDir, allowedDirs);
      expect(result).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('returns false for path outside allowed directory', () => {
    const tempDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'test1-'));
    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'test2-'));
    try {
      // Normalize the allowed directories
      const allowedDirs = normalizeAllowedDirectories([tempDir1]);
      const result = isWithinAllowedDirectories(tempDir2, allowedDirs);
      expect(result).toBe(false);
    } finally {
      fs.rmSync(tempDir1, { recursive: true });
      fs.rmSync(tempDir2, { recursive: true });
    }
  });

  it('returns true for path equal to allowed directory', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    try {
      // Normalize the allowed directories
      const allowedDirs = normalizeAllowedDirectories([tempDir]);
      const result = isWithinAllowedDirectories(tempDir, allowedDirs);
      expect(result).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('checks against multiple allowed directories', () => {
    const tempDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'test1-'));
    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'test2-'));
    try {
      const subDir = path.join(tempDir2, 'subdir');
      fs.mkdirSync(subDir);

      // Normalize the allowed directories
      const allowedDirs = normalizeAllowedDirectories([tempDir1, tempDir2]);
      const result = isWithinAllowedDirectories(subDir, allowedDirs);
      expect(result).toBe(true);
    } finally {
      fs.rmSync(tempDir1, { recursive: true });
      fs.rmSync(tempDir2, { recursive: true });
    }
  });
});

describe('assessPathAccess', () => {
  it('returns allowed true for path within allowed directory', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    try {
      const subDir = path.join(tempDir, 'subdir');
      fs.mkdirSync(subDir);

      // Use realpathSync to get the real path
      const realTempDir = fs.realpathSync(tempDir);
      const realSubDir = fs.realpathSync(subDir);

      const result = assessPathAccess(realSubDir, [realTempDir]);
      expect(result.allowed).toBe(true);
      expect(result.normalizedCandidate).toBeDefined();
      // Message always contains 'outside allowed directories' regardless of allowed status
      expect(result.message).toContain('outside allowed directories');
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('returns allowed false for path outside allowed directory', () => {
    const tempDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'test1-'));
    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'test2-'));
    try {
      const result = assessPathAccess(tempDir2, [tempDir1]);
      expect(result.allowed).toBe(false);
      expect(result.message).toContain(tempDir2);
      expect(result.message).toContain(tempDir1);
    } finally {
      fs.rmSync(tempDir1, { recursive: true });
      fs.rmSync(tempDir2, { recursive: true });
    }
  });

  it('uses custom error prefix', () => {
    const tempDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'test1-'));
    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'test2-'));
    try {
      const result = assessPathAccess(tempDir2, [tempDir1], 'CUSTOM_ERROR');
      expect(result.message).toContain('CUSTOM_ERROR');
    } finally {
      fs.rmSync(tempDir1, { recursive: true });
      fs.rmSync(tempDir2, { recursive: true });
    }
  });
});

describe('ensurePathWithinAllowed', () => {
  it('returns normalized path when allowed', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    try {
      const subDir = path.join(tempDir, 'subdir');
      fs.mkdirSync(subDir);

      // Normalize the allowed directories
      const allowedDirs = normalizeAllowedDirectories([tempDir]);
      const result = ensurePathWithinAllowed(subDir, allowedDirs);
      expect(result).toBeDefined();
    } finally {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('throws error when not allowed', () => {
    const tempDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'test1-'));
    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'test2-'));
    try {
      expect(() => ensurePathWithinAllowed(tempDir2, [tempDir1])).toThrow();
    } finally {
      fs.rmSync(tempDir1, { recursive: true });
      fs.rmSync(tempDir2, { recursive: true });
    }
  });

  it('returns path when not allowed but allowOutsideAllowedDirectories is true', () => {
    const tempDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'test1-'));
    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'test2-'));
    try {
      const result = ensurePathWithinAllowed(tempDir2, [tempDir1], 'PATH_NOT_ALLOWED', true);
      expect(result).toBeDefined();
    } finally {
      fs.rmSync(tempDir1, { recursive: true });
      fs.rmSync(tempDir2, { recursive: true });
    }
  });

  it('uses custom error prefix', () => {
    const tempDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'test1-'));
    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'test2-'));
    try {
      expect(() => ensurePathWithinAllowed(tempDir2, [tempDir1], 'CUSTOM_ERROR')).toThrow(
        'CUSTOM_ERROR'
      );
    } finally {
      fs.rmSync(tempDir1, { recursive: true });
      fs.rmSync(tempDir2, { recursive: true });
    }
  });
});

describe('toPosixPath', () => {
  it('converts path separators to POSIX format', () => {
    // Test with the current platform's separator
    const testPath = path.join('Users', 'test', 'file.txt');
    const result = toPosixPath(testPath);

    // Should always use forward slashes
    expect(result).toBe('Users/test/file.txt');
  });

  it('leaves POSIX path unchanged', () => {
    const result = toPosixPath('/Users/test/file.txt');
    expect(result).toBe('/Users/test/file.txt');
  });

  it('handles empty string', () => {
    expect(toPosixPath('')).toBe('');
  });

  it('handles path with no separators', () => {
    expect(toPosixPath('filename')).toBe('filename');
  });
});
