export interface BookmarkEntry {
  pageIndex: number; // 0-based index
  pageNumber: number; // 1-based page number
  label: string;
  createdAt: number;
}

const STORAGE_PREFIX = 'flipbook_bookmarks_v1::';
const LAST_PAGE_PREFIX = 'flipbook_last_page_v1::';

export function getBookmarkDocKey(docUrl: string, docTitle: string): string {
  const cleanUrl = (docUrl || '').trim();
  const cleanTitle = (docTitle || 'documento').trim();
  if (!cleanUrl || cleanUrl.startsWith('blob:')) {
    return `${STORAGE_PREFIX}local::${cleanTitle}`;
  }
  return `${STORAGE_PREFIX}${cleanUrl}`;
}

export function getLastPageDocKey(docUrl: string, docTitle: string): string {
  const cleanUrl = (docUrl || '').trim();
  const cleanTitle = (docTitle || 'documento').trim();
  if (!cleanUrl || cleanUrl.startsWith('blob:')) {
    return `${LAST_PAGE_PREFIX}local::${cleanTitle}`;
  }
  return `${LAST_PAGE_PREFIX}${cleanUrl}`;
}

export function parseStoredBookmarks(rawJson: string | null): BookmarkEntry[] {
  if (!rawJson) return [];
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) return [];
    const byPage = new Map<number, BookmarkEntry>();

    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const pageIndex = Number((item as BookmarkEntry).pageIndex);
      if (!Number.isInteger(pageIndex) || pageIndex < 0) continue;

      const rawLabel = typeof (item as BookmarkEntry).label === 'string'
        ? (item as BookmarkEntry).label.trim()
        : '';
      const createdAt = Number((item as BookmarkEntry).createdAt);

      byPage.set(pageIndex, {
        pageIndex,
        pageNumber: pageIndex + 1,
        label: rawLabel || `Página ${pageIndex + 1}`,
        createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
      });
    }

    return Array.from(byPage.values()).sort((a, b) => a.pageIndex - b.pageIndex);
  } catch {
    return [];
  }
}

export function getVisiblePageIndices(
  currentIndex: number,
  totalPages: number,
  isSinglePage: boolean
): number[] {
  if (totalPages <= 0) return [];
  const safe = Math.max(0, Math.min(currentIndex, totalPages - 1));
  if (isSinglePage || safe === 0) return [safe];

  const leftIndex = safe % 2 === 1 ? safe : safe - 1;
  const rightIndex = leftIndex + 1;
  if (rightIndex < totalPages) {
    return [leftIndex, rightIndex];
  }
  return [leftIndex];
}

export function getDefaultBookmarkLabel(
  pageIndex: number,
  totalPages: number,
  isSinglePage: boolean
): string {
  if (pageIndex === 0) return 'Portada · Página 1';
  if (!isSinglePage) {
    const visible = getVisiblePageIndices(pageIndex, totalPages, false);
    if (visible.length === 2) {
      return `Páginas ${visible[0] + 1}–${visible[1] + 1}`;
    }
    if (totalPages > 0 && visible[0] === totalPages - 1) {
      return `Contraportada · Página ${visible[0] + 1}`;
    }
  }
  return `Página ${pageIndex + 1}`;
}

export function toggleBookmarkEntry(
  entries: BookmarkEntry[],
  pageIndex: number,
  label?: string,
  now: number = Date.now()
): { entries: BookmarkEntry[]; added: boolean } {
  if (!Number.isInteger(pageIndex) || pageIndex < 0) {
    return { entries: [...entries], added: false };
  }
  const exists = entries.some((entry) => entry.pageIndex === pageIndex);
  if (exists) {
    return {
      entries: entries.filter((entry) => entry.pageIndex !== pageIndex),
      added: false,
    };
  }

  const nextLabel = (label || '').trim() || `Página ${pageIndex + 1}`;
  const next = [
    ...entries,
    {
      pageIndex,
      pageNumber: pageIndex + 1,
      label: nextLabel,
      createdAt: now,
    },
  ].sort((a, b) => a.pageIndex - b.pageIndex);

  return { entries: next, added: true };
}

export function updateBookmarkLabel(
  entries: BookmarkEntry[],
  pageIndex: number,
  newLabel: string
): BookmarkEntry[] {
  const clean = newLabel.trim();
  return entries.map((entry) =>
    entry.pageIndex === pageIndex
      ? { ...entry, label: clean || `Página ${pageIndex + 1}` }
      : entry
  );
}

export function removeBookmarkEntry(
  entries: BookmarkEntry[],
  pageIndex: number
): BookmarkEntry[] {
  return entries.filter((entry) => entry.pageIndex !== pageIndex);
}
