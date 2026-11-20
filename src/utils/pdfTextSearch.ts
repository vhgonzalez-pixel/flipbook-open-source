export interface TextSearchSnippet {
  before: string;
  match: string;
  after: string;
}

export interface PageSearchResult {
  pageIndex: number; // 0-based
  pageNumber: number; // 1-based
  matchCount: number;
  snippets: TextSearchSnippet[];
}

export interface NormalizedTextWithMap {
  normalized: string;
  indexMap: number[]; // normalized[i] originates from original[indexMap[i]]
}

/**
 * Strips diacritics and lowercases text while tracking exact character offsets
 * back to the original string so snippets preserve original accents & casing.
 */
export function buildNormalizedSearchMap(text: string): NormalizedTextWithMap {
  let normalized = '';
  const indexMap: number[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const base = ch
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    for (let j = 0; j < base.length; j++) {
      normalized += base[j];
      indexMap.push(i);
    }
  }

  return { normalized, indexMap };
}

export function normalizeQuery(query: string): string {
  return query
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function searchPagesText(
  pagesText: string[],
  rawQuery: string,
  maxSnippetsPerPage = 3,
  contextChars = 36
): PageSearchResult[] {
  const normQuery = normalizeQuery(rawQuery);
  if (!normQuery) return [];

  const results: PageSearchResult[] = [];

  for (let pageIndex = 0; pageIndex < pagesText.length; pageIndex++) {
    const original = pagesText[pageIndex] || '';
    if (!original) continue;

    const { normalized, indexMap } = buildNormalizedSearchMap(original);
    let pos = normalized.indexOf(normQuery);
    if (pos === -1) continue;

    let matchCount = 0;
    const snippets: TextSearchSnippet[] = [];

    while (pos !== -1) {
      matchCount += 1;

      if (snippets.length < maxSnippetsPerPage) {
        const origStart = indexMap[pos] ?? 0;
        const lastNormIdx = pos + normQuery.length - 1;
        const origEnd = (indexMap[lastNormIdx] ?? origStart) + 1;

        const sliceStart = Math.max(0, origStart - contextChars);
        const sliceEnd = Math.min(original.length, origEnd + contextChars);

        const prefixEllipsis = sliceStart > 0 ? '…' : '';
        const suffixEllipsis = sliceEnd < original.length ? '…' : '';

        snippets.push({
          before: prefixEllipsis + original.slice(sliceStart, origStart),
          match: original.slice(origStart, origEnd),
          after: original.slice(origEnd, sliceEnd) + suffixEllipsis,
        });
      }

      pos = normalized.indexOf(normQuery, pos + Math.max(1, normQuery.length));
    }

    results.push({
      pageIndex,
      pageNumber: pageIndex + 1,
      matchCount,
      snippets,
    });
  }

  return results;
}

export interface PdfTextItemLike {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
  width?: number;
  height?: number;
}

/**
 * Joins PDF.js text items into readable whitespace-normalized page text.
 */
export function joinPdfTextItems(items: PdfTextItemLike[]): string {
  const parts: string[] = [];
  for (const item of items) {
    const str = item?.str ?? '';
    if (!str) {
      if (item?.hasEOL && parts.length > 0) parts.push(' ');
      continue;
    }
    parts.push(str);
    parts.push(item.hasEOL ? ' ' : ' ');
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}
