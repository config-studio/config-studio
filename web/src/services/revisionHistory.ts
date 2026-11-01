import { FileRevision } from '../types';

const REVISION_KEY_PREFIX = 'cs_rev_v1_';
const MAX_REVISIONS_PER_FILE = 30;

class RevisionHistoryService {
  public getRevisions(fileKey: string): FileRevision[] {
    try {
      const data = localStorage.getItem(REVISION_KEY_PREFIX + fileKey);
      if (!data) return [];
      const parsed: FileRevision[] = JSON.parse(data);
      return (parsed || []).map((r) => ({
        ...r,
        timestamp: new Date(r.timestamp),
      }));
    } catch (e) {
      console.warn('[RevisionHistoryService] Failed to load revisions for', fileKey, e);
      return [];
    }
  }

  public addRevision(fileKey: string, rev: FileRevision): FileRevision[] {
    const list = this.getRevisions(fileKey);
    // Don't add identical content to the most recent revision
    if (list.length > 0 && list[0].content === rev.content) {
      return list;
    }

    const updated = [rev, ...list].slice(0, MAX_REVISIONS_PER_FILE);
    try {
      localStorage.setItem(REVISION_KEY_PREFIX + fileKey, JSON.stringify(updated));
    } catch (e) {
      console.warn('[RevisionHistoryService] Storage quota reached, trimming history:', e);
      // If quota exceeded, keep half
      try {
        const trimmed = updated.slice(0, 10);
        localStorage.setItem(REVISION_KEY_PREFIX + fileKey, JSON.stringify(trimmed));
      } catch {
        // ignore
      }
    }
    return updated;
  }

  public clear(fileKey: string): void {
    try {
      localStorage.removeItem(REVISION_KEY_PREFIX + fileKey);
    } catch (e) {
      console.error('[RevisionHistoryService] Failed to clear history:', e);
    }
  }
}

export const revisionHistoryService = new RevisionHistoryService();
