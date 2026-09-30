import { cp, lstat, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function copyArtifact(source, destination) {
  try {
    await lstat(source);
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
  await cp(source, destination, { recursive: true });
  return true;
}

// Preserve the exact local contents, including uncommitted edits. Callers may
// inspect failed candidates before restoration; reporting cannot prevent it.
export async function withArtifactTransaction(files, action, onFailure) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "plex-backup-"));
  let restoreFailed = false;
  try {
    const saved = [];
    for (const [index, file] of files.entries()) {
      const backup = path.join(directory, String(index));
      saved.push({ file, backup, existed: await copyArtifact(file, backup) });
    }
    try {
      return await action();
    } catch (error) {
      const errors = [error];
      try {
        await onFailure?.(error);
      } catch (reportError) {
        errors.push(reportError);
      }
      for (const { file, backup, existed } of saved) {
        try {
          await rm(file, { recursive: true, force: true });
          if (existed) {
            await cp(backup, file, { recursive: true });
          }
        } catch (restoreError) {
          restoreFailed = true;
          errors.push(restoreError);
        }
      }
      if (errors.length > 1) {
        throw new AggregateError(
          errors,
          `Plex update failed during reporting or restoration; ${restoreFailed ? `backups retained at ${directory}` : "original artifacts restored"}`,
          { cause: error },
        );
      }
      throw error;
    }
  } finally {
    if (!restoreFailed) {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
