export type ViewModePreference = 'auto' | 'double' | 'single';

export const MOBILE_SINGLE_PAGE_BREAKPOINT = 560;

export interface StageSizeInput {
  containerWidth: number;
  containerHeight: number;
  pageAspectRatio: number; // width / height of a single PDF page
  isSinglePage: boolean;
  horizontalPadding?: number;
  topPadding?: number;
  bottomReserve?: number;
}

export interface StageSizeOutput {
  stageWidth: number;
  stageHeight: number;
  pageWidth: number;
  pageHeight: number;
}

export function shouldUseSinglePage(
  viewportWidth: number,
  preference: ViewModePreference = 'auto'
): boolean {
  if (preference === 'single') return true;
  if (preference === 'double') return false;
  return viewportWidth < MOBILE_SINGLE_PAGE_BREAKPOINT;
}

export function computeBookStageSize({
  containerWidth,
  containerHeight,
  pageAspectRatio,
  isSinglePage,
  horizontalPadding = 32,
  topPadding = 16,
  bottomReserve = 84,
}: StageSizeInput): StageSizeOutput {
  const safeRatio = pageAspectRatio > 0 ? pageAspectRatio : 0.77;
  const availW = Math.max(240, containerWidth - horizontalPadding);
  const availH = Math.max(240, containerHeight - topPadding - bottomReserve);

  const spreadAspectRatio = isSinglePage ? safeRatio : safeRatio * 2;

  let stageWidth = availW;
  let stageHeight = stageWidth / spreadAspectRatio;

  if (stageHeight > availH) {
    stageHeight = availH;
    stageWidth = stageHeight * spreadAspectRatio;
  }

  const roundedStageW = Math.max(200, Math.floor(stageWidth));
  const roundedStageH = Math.max(200, Math.floor(stageHeight));
  const pageWidth = isSinglePage ? roundedStageW : Math.floor(roundedStageW / 2);

  return {
    stageWidth: isSinglePage ? pageWidth : pageWidth * 2,
    stageHeight: roundedStageH,
    pageWidth,
    pageHeight: roundedStageH,
  };
}

export interface PageIndicatorInput {
  currentIndex: number; // 0-based index from StPageFlip
  totalPages: number;
  isSinglePage: boolean;
}

export interface PageIndicatorOutput {
  label: string;
  activePages: number[]; // 1-based page numbers currently visible
  isFirst: boolean;
  isLast: boolean;
}

export function formatPageIndicator({
  currentIndex,
  totalPages,
  isSinglePage,
}: PageIndicatorInput): PageIndicatorOutput {
  if (totalPages <= 0) {
    return {
      label: 'Página -- de --',
      activePages: [],
      isFirst: true,
      isLast: true,
    };
  }

  const safeIndex = Math.max(0, Math.min(currentIndex, totalPages - 1));

  if (isSinglePage) {
    const pageNum = safeIndex + 1;
    return {
      label: `Página ${pageNum} de ${totalPages}`,
      activePages: [pageNum],
      isFirst: pageNum <= 1,
      isLast: pageNum >= totalPages,
    };
  }

  // Landscape with showCover: true
  // Index 0 is cover alone (Page 1)
  if (safeIndex === 0) {
    return {
      label: `Portada · 1 de ${totalPages}`,
      activePages: [1],
      isFirst: true,
      isLast: totalPages <= 1,
    };
  }

  // In StPageFlip with showCover: true, spreads start at odd 0-based indices (1, 3, 5...)
  // Normalize even interior indices back to the left page of the spread
  const leftIndex = safeIndex % 2 === 1 ? safeIndex : safeIndex - 1;
  const leftPage = leftIndex + 1;
  const rightPage = leftPage + 1;

  if (rightPage <= totalPages) {
    return {
      label: `Páginas ${leftPage}–${rightPage} de ${totalPages}`,
      activePages: [leftPage, rightPage],
      isFirst: false,
      isLast: rightPage >= totalPages,
    };
  }

  // Last page alone (back cover on even totalPages)
  return {
    label: `Contraportada · ${leftPage} de ${totalPages}`,
    activePages: [leftPage],
    isFirst: false,
    isLast: true,
  };
}

export const MIN_ZOOM = 0.75;
export const MAX_ZOOM = 2.5;
export const ZOOM_STEP = 0.25;

export function clampZoom(zoom: number): number {
  const rounded = Math.round(zoom * 100) / 100;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, rounded));
}

export interface PanBoundsInput {
  x: number;
  y: number;
  zoom: number;
  stageWidth: number;
  stageHeight: number;
  containerWidth: number;
  containerHeight: number;
}

export function clampPanOffset({
  x,
  y,
  zoom,
  stageWidth,
  stageHeight,
  containerWidth,
  containerHeight,
}: PanBoundsInput): { x: number; y: number } {
  if (zoom <= 1) {
    return { x: 0, y: 0 };
  }

  const scaledW = stageWidth * zoom;
  const scaledH = stageHeight * zoom;
  const maxOffsetX = Math.max(Math.round(scaledW * 0.25), (scaledW - containerWidth * 0.5) / 2);
  const maxOffsetY = Math.max(Math.round(scaledH * 0.25), (scaledH - containerHeight * 0.5) / 2);

  return {
    x: Math.max(-maxOffsetX, Math.min(maxOffsetX, x)),
    y: Math.max(-maxOffsetY, Math.min(maxOffsetY, y)),
  };
}

