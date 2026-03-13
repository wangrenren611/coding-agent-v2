import * as syncFs from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getFileStorageConfig, type FileStorageConfig } from './file-storage-config';
import {
  readJsonFileIfExists,
  writeJsonFileAtomically,
  writeTextFileAtomically,
} from './file-system';

interface FileHistoryManifest {
  schemaVersion: 1;
  targetPath: string;
  pathKey: string;
  versions: FileHistoryVersion[];
}

export interface FileHistoryVersion {
  versionId: string;
  createdAt: number;
  byteSize: number;
  contentHash: string;
  source: string;
  snapshotFile: string;
}

export interface SnapshotBeforeWriteInput {
  targetPath: string;
  nextContent: string;
  source: string;
}

export interface FileHistoryStoreOptions {
  config?: FileStorageConfig;
}

export class FileHistoryStore {
  private readonly config: FileStorageConfig;

  constructor(options: FileHistoryStoreOptions = {}) {
    this.config = options.config ?? getFileStorageConfig();
  }

  async snapshotBeforeWrite(input: SnapshotBeforeWriteInput): Promise<FileHistoryVersion | null> {
    if (!this.config.historyEnabled) {
      return null;
    }

    const targetPath = this.normalizeTargetPath(input.targetPath);
    let currentContent: string;
    try {
      currentContent = await fs.readFile(targetPath, 'utf8');
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return null;
      }
      throw error;
    }

    if (currentContent === input.nextContent) {
      return null;
    }

    const manifest = (await this.loadManifest(targetPath)) || this.createManifest(targetPath);
    const createdAt = Date.now();
    const versionId = `v_${createdAt}_${randomUUID().slice(0, 8)}`;
    const version: FileHistoryVersion = {
      versionId,
      createdAt,
      byteSize: Buffer.byteLength(currentContent, 'utf8'),
      contentHash: createHash('sha256').update(currentContent).digest('hex'),
      source: input.source,
      snapshotFile: path.join(manifest.pathKey, `${versionId}.snapshot`),
    };

    await this.writeSnapshot(version.snapshotFile, currentContent);
    manifest.versions.push(version);

    await this.pruneManifest(manifest);
    await this.saveManifest(manifest);
    await this.pruneTotalSize();

    return version;
  }

  async listVersions(targetPath: string): Promise<FileHistoryVersion[]> {
    const manifest = await this.loadManifest(targetPath);
    return manifest
      ? [...manifest.versions].sort((left, right) => right.createdAt - left.createdAt)
      : [];
  }

  async restoreVersion(targetPath: string, versionId: string): Promise<boolean> {
    const normalizedTargetPath = this.normalizeTargetPath(targetPath);
    const manifest = await this.loadManifest(normalizedTargetPath);
    if (!manifest) {
      return false;
    }

    const version = manifest.versions.find((entry) => entry.versionId === versionId);
    if (!version) {
      return false;
    }

    const snapshotPath = this.resolveSnapshotPath(version.snapshotFile);
    const content = await fs.readFile(snapshotPath, 'utf8');
    await this.snapshotBeforeWrite({
      targetPath: normalizedTargetPath,
      nextContent: content,
      source: 'file_history_restore',
    });
    await writeTextFileAtomically(normalizedTargetPath, content);
    return true;
  }

  private createManifest(targetPath: string): FileHistoryManifest {
    return {
      schemaVersion: 1,
      targetPath,
      pathKey: this.pathKey(targetPath),
      versions: [],
    };
  }

  private async loadManifest(targetPath: string): Promise<FileHistoryManifest | null> {
    const resolvedTargetPath = this.normalizeTargetPath(targetPath);
    const manifestPath = this.manifestPathByTarget(resolvedTargetPath);
    return readJsonFileIfExists<FileHistoryManifest>(manifestPath);
  }

  private async saveManifest(manifest: FileHistoryManifest): Promise<void> {
    await writeJsonFileAtomically(this.manifestPath(manifest.pathKey), manifest);
  }

  private async writeSnapshot(snapshotFile: string, content: string): Promise<void> {
    const snapshotPath = this.resolveSnapshotPath(snapshotFile);
    await writeTextFileAtomically(snapshotPath, content);
  }

  private async pruneManifest(manifest: FileHistoryManifest): Promise<void> {
    let versions = [...manifest.versions].sort((left, right) => left.createdAt - right.createdAt);
    const maxPerFile = this.config.historyMaxPerFile;
    const maxAgeDays = this.config.historyMaxAgeDays;

    if (maxAgeDays > 0) {
      const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
      const removed = versions.filter((entry) => entry.createdAt < cutoff);
      versions = versions.filter((entry) => entry.createdAt >= cutoff);
      await this.deleteSnapshots(removed);
    }

    if (maxPerFile > 0 && versions.length > maxPerFile) {
      const overflow = versions.length - maxPerFile;
      const removed = versions.slice(0, overflow);
      versions = versions.slice(overflow);
      await this.deleteSnapshots(removed);
    }

    manifest.versions = versions;
  }

  private async pruneTotalSize(): Promise<void> {
    const maxTotalBytes = this.config.historyMaxTotalBytes;
    if (maxTotalBytes <= 0) {
      return;
    }

    const manifestsDir = this.manifestsDir();
    let manifestFiles: string[] = [];
    try {
      manifestFiles = await fs.readdir(manifestsDir);
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return;
      }
      throw error;
    }

    const manifests = (
      await Promise.all(
        manifestFiles
          .filter((entry) => entry.endsWith('.json'))
          .map(async (entry) =>
            readJsonFileIfExists<FileHistoryManifest>(path.join(manifestsDir, entry))
          )
      )
    ).filter((manifest): manifest is FileHistoryManifest => manifest !== null);

    const allVersions = manifests
      .flatMap((manifest) =>
        manifest.versions.map((version) => ({
          manifest,
          version,
        }))
      )
      .sort((left, right) => left.version.createdAt - right.version.createdAt);

    let totalBytes = allVersions.reduce((sum, item) => sum + item.version.byteSize, 0);
    if (totalBytes <= maxTotalBytes) {
      return;
    }

    const removals = new Map<string, Set<string>>();
    const snapshotsToDelete: FileHistoryVersion[] = [];

    for (const item of allVersions) {
      if (totalBytes <= maxTotalBytes) {
        break;
      }
      totalBytes -= item.version.byteSize;
      snapshotsToDelete.push(item.version);
      const manifestRemovals = removals.get(item.manifest.pathKey) || new Set<string>();
      manifestRemovals.add(item.version.versionId);
      removals.set(item.manifest.pathKey, manifestRemovals);
    }

    await this.deleteSnapshots(snapshotsToDelete);

    await Promise.all(
      manifests.map(async (manifest) => {
        const manifestRemovals = removals.get(manifest.pathKey);
        if (!manifestRemovals || manifestRemovals.size === 0) {
          return;
        }
        manifest.versions = manifest.versions.filter(
          (version) => !manifestRemovals.has(version.versionId)
        );
        await this.saveManifest(manifest);
      })
    );
  }

  private async deleteSnapshots(versions: FileHistoryVersion[]): Promise<void> {
    await Promise.all(
      versions.map((version) =>
        fs.rm(this.resolveSnapshotPath(version.snapshotFile), { force: true })
      )
    );
  }

  private manifestPathByTarget(targetPath: string): string {
    return this.manifestPath(this.pathKey(targetPath));
  }

  private manifestPath(pathKey: string): string {
    return path.join(this.manifestsDir(), `${pathKey}.json`);
  }

  private manifestsDir(): string {
    return path.join(this.config.historyDir, 'manifests');
  }

  private resolveSnapshotPath(snapshotFile: string): string {
    return path.join(this.config.historyDir, 'snapshots', snapshotFile);
  }

  private pathKey(targetPath: string): string {
    return createHash('sha256')
      .update(this.normalizeTargetPath(targetPath))
      .digest('hex')
      .slice(0, 24);
  }

  private normalizeTargetPath(targetPath: string): string {
    const absolute = path.resolve(targetPath);
    try {
      return syncFs.realpathSync(absolute);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'ENOENT' && nodeError.code !== 'ENOTDIR') {
        return absolute;
      }
    }

    let current = absolute;
    const trailingSegments: string[] = [];

    for (;;) {
      try {
        const realCurrent = syncFs.realpathSync(current);
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

  private isNotFoundError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    );
  }
}

export function createConfiguredFileHistoryStore(): FileHistoryStore {
  return new FileHistoryStore();
}
