import { createConfiguredFileHistoryStore, FileHistoryStore } from './file-history-store';
import { writeTextFileAtomically } from './file-system';

export interface WriteTextFileWithHistoryOptions {
  source: string;
  historyStore?: FileHistoryStore;
}

export async function writeTextFileWithHistory(
  targetPath: string,
  content: string,
  options: WriteTextFileWithHistoryOptions
): Promise<void> {
  const historyStore = options.historyStore ?? createConfiguredFileHistoryStore();
  await historyStore.snapshotBeforeWrite({
    targetPath,
    nextContent: content,
    source: options.source,
  });
  await writeTextFileAtomically(targetPath, content);
}
