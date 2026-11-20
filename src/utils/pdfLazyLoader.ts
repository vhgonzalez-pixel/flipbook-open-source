export interface DocQueryResult {
  hasDocParam: boolean;
  docUrl: string | null;
  displayTitle: string | null;
  isInvalidScheme: boolean;
}

/**
 * Extracts and validates the ?doc= (and optional ?title=) query parameters
 * for GitHub Pages static deployment (e.g. visor.html?doc=publicaciones/revista.pdf).
 */
export function parseDocQueryParam(search: string): DocQueryResult {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const rawDoc = params.get('doc')?.trim() ?? '';
  const rawTitle = params.get('title')?.trim() ?? '';

  if (!rawDoc) {
    return {
      hasDocParam: false,
      docUrl: null,
      displayTitle: null,
      isInvalidScheme: false,
    };
  }

  const lower = rawDoc.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('data:text/html')) {
    return {
      hasDocParam: true,
      docUrl: null,
      displayTitle: null,
      isInvalidScheme: true,
    };
  }

  let extractedName = rawDoc;
  try {
    const cleanPath = rawDoc.split('?')[0].split('#')[0];
    const lastSegment = cleanPath.split('/').filter(Boolean).pop() ?? cleanPath;
    extractedName = decodeURIComponent(lastSegment);
  } catch {
    extractedName = rawDoc;
  }

  return {
    hasDocParam: true,
    docUrl: rawDoc,
    displayTitle: rawTitle || extractedName || 'Publicación PDF',
    isInvalidScheme: false,
  };
}

/**
 * Computes an ordered list of 0-based page indices to render with priority around `currentIndex`.
 * Priority: visible spread -> next spread -> previous spread -> cover -> remaining pages outward.
 */
export function computeRenderPriorityOrder(
  currentIndex: number,
  totalPages: number
): number[] {
  if (totalPages <= 0) return [];
  const safeCenter = Math.max(0, Math.min(currentIndex, totalPages - 1));
  const seen = new Set<number>();
  const order: number[] = [];

  const push = (idx: number) => {
    if (idx >= 0 && idx < totalPages && !seen.has(idx)) {
      seen.add(idx);
      order.push(idx);
    }
  };

  // Immediate visible pages + lookahead
  push(safeCenter);
  push(safeCenter + 1);
  push(safeCenter - 1);
  push(safeCenter + 2);
  push(safeCenter + 3);
  push(safeCenter - 2);
  push(0); // Always prioritize cover

  // Radiate outward across the rest of the document
  for (let delta = 3; delta < totalPages; delta++) {
    push(safeCenter + delta);
    push(safeCenter - delta);
  }

  return order;
}

/**
 * Returns 0-based page indices to evict from canvas bitmap memory when exceeding `maxCachedPages`
 * (useful for 50+ page magazines), always preserving cover (0) and the active reading window.
 */
export function computeEvictablePages(
  renderedIndices: number[],
  currentIndex: number,
  totalPages: number,
  maxCachedPages = 24
): number[] {
  if (totalPages <= maxCachedPages || renderedIndices.length <= maxCachedPages) {
    return [];
  }

  const safeCenter = Math.max(0, Math.min(currentIndex, totalPages - 1));
  const protectedMin = Math.max(0, safeCenter - 4);
  const protectedMax = Math.min(totalPages - 1, safeCenter + 6);

  const candidates = renderedIndices
    .filter((idx) => idx !== 0 && (idx < protectedMin || idx > protectedMax))
    .sort((a, b) => Math.abs(b - safeCenter) - Math.abs(a - safeCenter));

  const excess = renderedIndices.length - maxCachedPages;
  return candidates.slice(0, Math.max(0, excess));
}
