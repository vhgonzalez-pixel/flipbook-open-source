/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bookmark,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Download,
  FileText,
  Hand,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Minus,
  MoreVertical,
  Pencil,
  Plus,
  Printer,
  Search,
  Share2,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  clampPanOffset,
  clampZoom,
  computeBookStageSize,
  formatPageIndicator,
  MAX_ZOOM,
  MIN_ZOOM,
  shouldUseSinglePage,
  ZOOM_STEP,
  type ViewModePreference,
} from './utils/flipbookLayout';
import {
  computeEvictablePages,
  computeRenderPriorityOrder,
  parseDocQueryParam,
} from './utils/pdfLazyLoader';
import {
  joinPdfTextItems,
  searchPagesText,
  type PageSearchResult,
} from './utils/pdfTextSearch';
import {
  getBookmarkDocKey,
  getDefaultBookmarkLabel,
  getLastPageDocKey,
  getVisiblePageIndices,
  parseStoredBookmarks,
  removeBookmarkEntry,
  toggleBookmarkEntry,
  updateBookmarkLabel,
  type BookmarkEntry,
} from './utils/pdfBookmarks';
import { playPaperFlipSound } from './utils/pageSound';
import {
  ACTIVE_LOCAL_ID_STORAGE_KEY,
  createPdfBlobFromRecord,
  getLocalPublicationById,
  parseLocalQueryParam,
  saveLocalPdfToLibrary,
  updateLocalPdfMetadata,
} from './utils/localPdfLibrary';

declare global {
  interface Window {
    pdfjsLib: any;
    St: {
      PageFlip: any;
    };
  }
}

const DEFAULT_PDF_URL =
  'https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf';
const DEFAULT_DOC_TITLE = 'Revista Arquitectura & Diseño Contemporáneo.pdf';
const RENDER_SCALE = 1.35;
const INITIAL_PRIORITY_PAGES = 4;
const MAX_CACHED_CANVASES = 24;

interface PageSlot {
  pageDiv: HTMLDivElement;
  canvas: HTMLCanvasElement;
  placeholder: HTMLDivElement;
  status: 'idle' | 'rendering' | 'ready';
}

export default function App() {
  const initialQuery = useMemo(
    () =>
      parseDocQueryParam(
        typeof window !== 'undefined' ? window.location.search : ''
      ),
    []
  );

  const [pdfUrl, setPdfUrl] = useState<string>(
    initialQuery.hasDocParam && initialQuery.docUrl
      ? initialQuery.docUrl
      : DEFAULT_PDF_URL
  );
  const [docTitle, setDocTitle] = useState<string>(
    initialQuery.hasDocParam && initialQuery.displayTitle
      ? initialQuery.displayTitle
      : DEFAULT_DOC_TITLE
  );
  const [hasUrlDocParam] = useState<boolean>(initialQuery.hasDocParam);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadingMessage, setLoadingMessage] = useState<string>('Conectando con el documento PDF...');
  const [loadingPercent, setLoadingPercent] = useState<number>(4);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    initialQuery.hasDocParam && initialQuery.isInvalidScheme
      ? 'El parámetro ?doc= contiene una ruta o esquema no válido.'
      : null
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [thumbnails, setThumbnails] = useState<(string | null)[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<PageSearchResult[]>([]);
  const [searchCursor, setSearchCursor] = useState<number>(-1);
  const [searchStatus, setSearchStatus] = useState<string>('Escribe para buscar en todas las páginas');
  const [isBookmarksOpen, setIsBookmarksOpen] = useState<boolean>(false);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  const [lastReadPage, setLastReadPage] = useState<number | null>(null);
  const [editingBookmarkIdx, setEditingBookmarkIdx] = useState<number | null>(null);
  const [editingBookmarkText, setEditingBookmarkText] = useState<string>('');
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState<boolean>(false);
  const [isPreparingPrint, setIsPreparingPrint] = useState<boolean>(false);
  const [printPrepProgress, setPrintPrepProgress] = useState<string>('Generando páginas...');
  const [shareModalOpen, setShareModalOpen] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [isHandPanMode, setIsHandPanMode] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<ViewModePreference>('auto');
  const [pageAspectRatio, setPageAspectRatio] = useState<number>(612 / 792);
  const [renderVersion, setRenderVersion] = useState<number>(0);
  const [reloadNonce, setReloadNonce] = useState<number>(0);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? Math.max(400, window.innerHeight - 64) : 760,
  });

  const mainRef = useRef<HTMLElement>(null);
  const bookContainerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const moreActionsWrapperRef = useRef<HTMLDivElement>(null);
  const printStageRef = useRef<HTMLDivElement>(null);
  const cancelPrintRef = useRef<boolean>(false);
  const pageFlipRef = useRef<any>(null);
  const pdfDocRef = useRef<any>(null);
  const pageTextCacheRef = useRef<string[]>([]);
  const pageSlotsRef = useRef<PageSlot[]>([]);
  const activeLoadTokenRef = useRef<number>(0);
  const idleHandleRef = useRef<number | null>(null);
  const renderQueueRef = useRef<number[]>([]);
  const isProcessingQueueRef = useRef<boolean>(false);
  const currentIndexRef = useRef<number>(0);
  const totalPagesRef = useRef<number>(0);
  const pageAspectRatioRef = useRef<number>(612 / 792);
  const soundEnabledRef = useRef<boolean>(true);
  const objectUrlRef = useRef<string | null>(null);
  const activeLocalIdRef = useRef<string | null>(null);
  const panOriginRef = useRef<{ startX: number; startY: number; originX: number; originY: number }>({
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });
  const zoomRef = useRef<number>(1);
  const isSpacePressedRef = useRef<boolean>(false);
  const isBgPanningRef = useRef<boolean>(false);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    totalPagesRef.current = totalPages;
  }, [totalPages]);

  useEffect(() => {
    pageAspectRatioRef.current = pageAspectRatio;
  }, [pageAspectRatio]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const cancelIdleRender = useCallback(() => {
    if (idleHandleRef.current !== null) {
      if (typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleHandleRef.current);
      } else {
        window.clearTimeout(idleHandleRef.current);
      }
      idleHandleRef.current = null;
    }
  }, []);

  const evictDistantSlots = useCallback((centerIdx: number) => {
    const slots = pageSlotsRef.current;
    const count = totalPagesRef.current;
    const readyIndices: number[] = [];
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].status === 'ready') readyIndices.push(i);
    }
    const toEvict = computeEvictablePages(readyIndices, centerIdx, count, MAX_CACHED_CANVASES);
    for (const idx of toEvict) {
      const slot = slots[idx];
      if (!slot) continue;
      slot.canvas.width = 1;
      slot.canvas.height = 1;
      slot.status = 'idle';
      slot.placeholder.classList.remove('is-hidden');
    }
  }, []);

  const renderPageSlot = useCallback(
    async (idx: number, loadToken: number) => {
      const slot = pageSlotsRef.current[idx];
      const pdfDoc = pdfDocRef.current;
      if (!slot || slot.status !== 'idle' || !pdfDoc || loadToken !== activeLoadTokenRef.current) {
        return;
      }

      slot.status = 'rendering';
      try {
        const page = await pdfDoc.getPage(idx + 1);
        if (loadToken !== activeLoadTokenRef.current) return;

        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const canvas = slot.canvas;
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        canvas.style.backgroundColor = '#ffffff';
        canvas.style.opacity = '1';

        const context = canvas.getContext('2d', { alpha: false });
        if (context) {
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({
            canvasContext: context,
            viewport,
            background: '#ffffff',
          }).promise;
        }

        if (loadToken !== activeLoadTokenRef.current) return;
        slot.status = 'ready';
        slot.placeholder.classList.add('is-hidden');

        // Generar miniatura ligera al vuelo sin duplicar lienzos en memoria
        const ratio = pageAspectRatioRef.current || 612 / 792;
        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = 120;
        thumbCanvas.height = Math.max(40, Math.round(120 / ratio));
        const thumbCtx = thumbCanvas.getContext('2d', { alpha: false });
        if (thumbCtx) {
          thumbCtx.fillStyle = '#ffffff';
          thumbCtx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);
          thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
          const thumbDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.78);
          setThumbnails((prev) => {
            if (prev[idx] === thumbDataUrl) return prev;
            const next = [...prev];
            next[idx] = thumbDataUrl;
            return next;
          });
        }

        evictDistantSlots(currentIndexRef.current);
      } catch (err) {
        if (loadToken === activeLoadTokenRef.current) {
          slot.status = 'idle';
          console.warn(`Error renderizando página ${idx + 1}:`, err);
        }
      }
    },
    [evictDistantSlots]
  );

  const scheduleNextLazyStep = useCallback(
    (loadToken: number) => {
      if (
        isProcessingQueueRef.current ||
        loadToken !== activeLoadTokenRef.current ||
        renderQueueRef.current.length === 0
      ) {
        return;
      }

      const runStep = async () => {
        idleHandleRef.current = null;
        if (loadToken !== activeLoadTokenRef.current || isProcessingQueueRef.current) return;

        const slots = pageSlotsRef.current;
        const count = totalPagesRef.current;
        const center = currentIndexRef.current;

        while (renderQueueRef.current.length > 0) {
          const nextIdx = renderQueueRef.current.shift()!;
          const slot = slots[nextIdx];
          if (!slot || slot.status !== 'idle') continue;

          const isNearActive = nextIdx === 0 || Math.abs(nextIdx - center) <= 6;
          if (!isNearActive && count > MAX_CACHED_CANVASES) {
            continue;
          }

          isProcessingQueueRef.current = true;
          await renderPageSlot(nextIdx, loadToken);
          isProcessingQueueRef.current = false;
          break;
        }

        if (renderQueueRef.current.length > 0 && loadToken === activeLoadTokenRef.current) {
          scheduleNextLazyStep(loadToken);
        }
      };

      if (typeof window.requestIdleCallback === 'function') {
        idleHandleRef.current = window.requestIdleCallback(() => {
          void runStep();
        }, { timeout: 120 });
      } else {
        idleHandleRef.current = window.setTimeout(() => {
          void runStep();
        }, 35);
      }
    },
    [renderPageSlot]
  );

  const prioritizeWindowAround = useCallback(
    (centerIdx: number, loadToken: number) => {
      const slots = pageSlotsRef.current;
      const count = totalPagesRef.current;
      if (!pdfDocRef.current || slots.length === 0 || loadToken !== activeLoadTokenRef.current) {
        return;
      }

      const immediateTargets = [
        centerIdx,
        centerIdx + 1,
        centerIdx - 1,
        centerIdx + 2,
        centerIdx + 3,
        centerIdx - 2,
        0,
      ].filter((idx, pos, arr) => idx >= 0 && idx < count && arr.indexOf(idx) === pos);

      void (async () => {
        for (const idx of immediateTargets) {
          if (loadToken !== activeLoadTokenRef.current) return;
          if (slots[idx] && slots[idx].status === 'idle') {
            await renderPageSlot(idx, loadToken);
          }
        }
        if (loadToken !== activeLoadTokenRef.current) return;
        renderQueueRef.current = computeRenderPriorityOrder(centerIdx, count).filter(
          (idx) => slots[idx] && slots[idx].status === 'idle'
        );
        scheduleNextLazyStep(loadToken);
      })();
    },
    [renderPageSlot, scheduleNextLazyStep]
  );

  // Medir el área disponible en <main> de forma responsiva
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setContainerSize((prev) => {
          if (
            Math.abs(prev.width - rect.width) < 4 &&
            Math.abs(prev.height - rect.height) < 4
          ) {
            return prev;
          }
          return { width: rect.width, height: rect.height };
        });
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    window.addEventListener('resize', updateSize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  // Sincronizar estado de pantalla completa
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const isSinglePage = useMemo(
    () => shouldUseSinglePage(containerSize.width, viewMode),
    [containerSize.width, viewMode]
  );

  const stageSize = useMemo(
    () =>
      computeBookStageSize({
        containerWidth: containerSize.width,
        containerHeight: containerSize.height,
        pageAspectRatio,
        isSinglePage,
      }),
    [containerSize.width, containerSize.height, pageAspectRatio, isSinglePage]
  );

  const pageIndicator = useMemo(
    () =>
      formatPageIndicator({
        currentIndex,
        totalPages,
        isSinglePage,
      }),
    [currentIndex, totalPages, isSinglePage]
  );

  const applyZoom = useCallback(
    (nextZoomValue: number) => {
      const clamped = clampZoom(nextZoomValue);
      setZoom(clamped);
      if (clamped <= 1) {
        setPan({ x: 0, y: 0 });
        setIsHandPanMode(false);
      } else {
        setPan((prev) =>
          clampPanOffset({
            x: prev.x,
            y: prev.y,
            zoom: clamped,
            stageWidth: stageSize.stageWidth,
            stageHeight: stageSize.stageHeight,
            containerWidth: containerSize.width,
            containerHeight: containerSize.height,
          })
        );
      }
      try {
        if (pageFlipRef.current && typeof pageFlipRef.current.update === 'function') {
          pageFlipRef.current.update();
        }
      } catch {}
    },
    [stageSize.stageWidth, stageSize.stageHeight, containerSize.width, containerSize.height]
  );

  // Restaurar publicación local desde ?local= o último PDF local activo si no hay ?doc=
  useEffect(() => {
    if (initialQuery.hasDocParam) return;
    let cancelled = false;
    const requestedLocalId = parseLocalQueryParam(
      typeof window !== 'undefined' ? window.location.search : ''
    );
    let storedId: string | null = null;
    try {
      storedId = localStorage.getItem(ACTIVE_LOCAL_ID_STORAGE_KEY);
    } catch {
      storedId = null;
    }
    const targetId = requestedLocalId || storedId;
    if (!targetId) return;

    void (async () => {
      const record = await getLocalPublicationById(targetId);
      if (cancelled || !record || !record.pdfData) return;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      const blob = createPdfBlobFromRecord(record);
      if (!blob) return;
      const nextUrl = URL.createObjectURL(blob);
      objectUrlRef.current = nextUrl;
      activeLocalIdRef.current = record.id;
      try {
        localStorage.setItem(ACTIVE_LOCAL_ID_STORAGE_KEY, record.id);
      } catch {
        // Ignorar
      }
      if (!requestedLocalId && typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        params.set('local', record.id);
        window.history.replaceState(null, '', `?${params.toString()}`);
      }
      setPdfUrl(nextUrl);
      setDocTitle(record.fileName);
    })();

    return () => {
      cancelled = true;
    };
  }, [initialQuery.hasDocParam]);

  // Cargar PDF con barra de progreso real y renderizado perezoso prioritario
  useEffect(() => {
    if (initialQuery.hasDocParam && initialQuery.isInvalidScheme && pdfUrl === DEFAULT_PDF_URL) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    const loadToken = ++activeLoadTokenRef.current;
    cancelIdleRender();
    isProcessingQueueRef.current = false;
    renderQueueRef.current = [];

    async function loadPDF() {
      if (!window.pdfjsLib) {
        setLoadingMessage('Cargando motor PDF.js...');
        setTimeout(() => {
          if (isMounted && loadToken === activeLoadTokenRef.current) {
            void loadPDF();
          }
        }, 250);
        return;
      }

      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

      try {
        setErrorMessage(null);
        setIsLoading(true);
        setLoadingPercent(4);
        setLoadingMessage('Descargando documento PDF...');

        if (pdfDocRef.current && typeof pdfDocRef.current.destroy === 'function') {
          try {
            await pdfDocRef.current.destroy();
          } catch {
            // Ignorar errores de limpieza de PDF previo
          }
          pdfDocRef.current = null;
        }

        const loadingTask = window.pdfjsLib.getDocument(pdfUrl);
        loadingTask.onProgress = (progressData: { loaded: number; total?: number }) => {
          if (!isMounted || loadToken !== activeLoadTokenRef.current) return;
          if (progressData && progressData.total && progressData.total > 0) {
            const ratio = Math.min(1, progressData.loaded / progressData.total);
            const mbLoaded = (progressData.loaded / (1024 * 1024)).toFixed(1);
            const mbTotal = (progressData.total / (1024 * 1024)).toFixed(1);
            setLoadingPercent(Math.round(6 + ratio * 58));
            setLoadingMessage(`Descargando PDF (${mbLoaded} / ${mbTotal} MB)...`);
          } else if (progressData && progressData.loaded > 0) {
            const kbLoaded = Math.round(progressData.loaded / 1024);
            setLoadingPercent(35);
            setLoadingMessage(`Descargando PDF (${kbLoaded} KB)...`);
          }
        };

        const pdfDoc = await loadingTask.promise;
        if (!isMounted || loadToken !== activeLoadTokenRef.current) {
          pdfDoc.destroy?.();
          return;
        }

        pdfDocRef.current = pdfDoc;
        const numPages = pdfDoc.numPages;
        setTotalPages(numPages);
        totalPagesRef.current = numPages;
        setCurrentIndex(0);
        currentIndexRef.current = 0;
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setThumbnails(Array.from({ length: numPages }, () => null));

        setLoadingPercent(68);
        setLoadingMessage('Analizando formato editorial...');
        const firstPage = await pdfDoc.getPage(1);
        if (!isMounted || loadToken !== activeLoadTokenRef.current) return;

        const firstViewport = firstPage.getViewport({ scale: RENDER_SCALE });
        const ratio = firstViewport.width / firstViewport.height;
        setPageAspectRatio(ratio);
        pageAspectRatioRef.current = ratio;

        // Crear contenedores ligeros para todas las páginas (sin saturar memoria)
        const slots: PageSlot[] = [];
        for (let i = 0; i < numPages; i++) {
          const pageDiv = document.createElement('div');
          pageDiv.className = 'flipbook-page';
          pageDiv.dataset.pageNumber = String(i + 1);
          pageDiv.style.backgroundColor = '#ffffff';
          pageDiv.style.opacity = '1';

          const inner = document.createElement('div');
          inner.className = 'flipbook-page-inner';
          inner.style.backgroundColor = '#ffffff';
          inner.style.opacity = '1';

          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          canvas.style.backgroundColor = '#ffffff';
          canvas.style.opacity = '1';

          const placeholder = document.createElement('div');
          placeholder.className = 'flipbook-page-placeholder';
          placeholder.innerHTML = `
            <div class="w-5 h-5 border-2 border-amber-500/70 border-t-transparent rounded-full animate-spin"></div>
            <span class="text-[11px] font-mono text-zinc-400">Página ${i + 1}</span>
          `;

          const spineShadow = document.createElement('div');
          spineShadow.className = 'flipbook-spine-shadow';

          inner.appendChild(canvas);
          inner.appendChild(placeholder);
          inner.appendChild(spineShadow);
          pageDiv.appendChild(inner);

          slots.push({
            pageDiv,
            canvas,
            placeholder,
            status: 'idle',
          });
        }
        pageSlotsRef.current = slots;

        // Renderizar únicamente portada y primeras páginas antes de mostrar el visor
        const priorityCount = Math.min(INITIAL_PRIORITY_PAGES, numPages);
        for (let i = 0; i < priorityCount; i++) {
          if (!isMounted || loadToken !== activeLoadTokenRef.current) return;
          setLoadingPercent(Math.round(70 + ((i + 1) / priorityCount) * 26));
          setLoadingMessage(`Renderizando portada y primeras páginas (${i + 1}/${priorityCount})...`);
          await renderPageSlot(i, loadToken);
        }

        if (!isMounted || loadToken !== activeLoadTokenRef.current) return;
        if (activeLocalIdRef.current && slots[0] && slots[0].status === 'ready') {
          try {
            const sourceCanvas = slots[0].canvas;
            const targetW = 360;
            const targetH = Math.max(120, Math.round((targetW * sourceCanvas.height) / sourceCanvas.width));
            const thumbCanvas = document.createElement('canvas');
            thumbCanvas.width = targetW;
            thumbCanvas.height = targetH;
            const thumbCtx = thumbCanvas.getContext('2d', { alpha: false });
            let coverDataUrl: string | null = null;
            if (thumbCtx) {
              thumbCtx.fillStyle = '#ffffff';
              thumbCtx.fillRect(0, 0, targetW, targetH);
              thumbCtx.drawImage(sourceCanvas, 0, 0, targetW, targetH);
              coverDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.85);
            }
            void updateLocalPdfMetadata(activeLocalIdRef.current, {
              pageCount: numPages,
              coverDataUrl,
            });
          } catch {
            // Ignorar error de miniatura
          }
        }
        setLoadingPercent(100);
        setLoadingMessage('Abriendo visor interactivo...');
        setRenderVersion((v) => v + 1);
        setIsLoading(false);

        // Continuar renderizado progresivo en segundo plano
        prioritizeWindowAround(0, loadToken);
      } catch (err) {
        console.error('Error al cargar PDF:', err);
        if (!isMounted || loadToken !== activeLoadTokenRef.current) return;
        setIsLoading(false);
        setErrorMessage(
          'No se pudo cargar el archivo PDF. Verifica la ruta del parámetro ?doc= o sube un PDF local.'
        );
      }
    }

    void loadPDF();

    return () => {
      isMounted = false;
      cancelIdleRender();
    };
  }, [pdfUrl, reloadNonce, cancelIdleRender, renderPageSlot, prioritizeWindowAround, initialQuery]);

  // Inicializar o reconfigurar StPageFlip reutilizando los PageSlots sin duplicar bitmaps
  useEffect(() => {
    const slots = pageSlotsRef.current;
    const container = bookRef.current;
    if (!container || slots.length === 0 || renderVersion === 0) return;

    let retryTimer: number | null = null;
    let isCancelled = false;

    const mountFlipbook = () => {
      if (isCancelled) return;
      if (!window.St || !window.St.PageFlip) {
        retryTimer = window.setTimeout(mountFlipbook, 250);
        return;
      }

      if (pageFlipRef.current) {
        try {
          pageFlipRef.current.destroy();
        } catch {
          // Ignorar errores de limpieza de instancia previa
        }
        pageFlipRef.current = null;
      }

      container.innerHTML = '';
      const hostEl = document.createElement('div');
      hostEl.className = 'w-full h-full';
      container.appendChild(hostEl);

      const pageElements: HTMLElement[] = slots.map((slot) => {
        slot.pageDiv.className = 'flipbook-page';
        slot.pageDiv.style.cssText = 'background-color: #ffffff; opacity: 1;';
        hostEl.appendChild(slot.pageDiv);
        return slot.pageDiv;
      });

      const startIdx = Math.max(0, Math.min(currentIndexRef.current, slots.length - 1));

      const flip = new window.St.PageFlip(hostEl, {
        width: stageSize.pageWidth,
        height: stageSize.pageHeight,
        size: isSinglePage ? 'fixed' : 'stretch',
        minWidth: isSinglePage ? stageSize.pageWidth : 140,
        maxWidth: isSinglePage ? stageSize.pageWidth : 1400,
        minHeight: isSinglePage ? stageSize.pageHeight : 180,
        maxHeight: isSinglePage ? stageSize.pageHeight : 1600,
        drawShadow: true,
        maxShadowOpacity: 0.28,
        showCover: true,
        mobileScrollSupport: false,
        usePortrait: isSinglePage,
        showPageCorners: true,
        flippingTime: 650,
        startPage: startIdx,
      });

      flip.loadFromHTML(pageElements);
      pageFlipRef.current = flip;

      // Sincronizar coordenadas de cursor con el nivel de zoom para que el pase con selección directa funcione a cualquier escala
      if (flip.ui && typeof flip.ui.getMousePos === 'function') {
        flip.ui.getMousePos = function (clientX: number, clientY: number) {
          const rect = this.distElement.getBoundingClientRect();
          const z = zoomRef.current > 0 ? zoomRef.current : 1;
          return {
            x: (clientX - rect.left) / z,
            y: (clientY - rect.top) / z,
          };
        };
      }

      // Evitar excepciones internas de StPageFlip al soltar el ratón sin posición de pliegue calculada
      const fc = typeof flip.getFlipController === 'function' ? flip.getFlipController() : null;
      if (fc && typeof fc.stopMove === 'function') {
        const origStopMove = fc.stopMove.bind(fc);
        fc.stopMove = function () {
          if (!this.calc || !this.calc.getPosition()) return;
          origStopMove();
        };
      }

      flip.on('flip', (e: any) => {
        const nextIdx = typeof e?.data === 'number' ? e.data : 0;
        setCurrentIndex(nextIdx);
        if (soundEnabledRef.current) {
          playPaperFlipSound();
        }
        prioritizeWindowAround(nextIdx, activeLoadTokenRef.current);
      });
    };

    mountFlipbook();

    return () => {
      isCancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
      if (pageFlipRef.current) {
        try {
          pageFlipRef.current.destroy();
        } catch {
          // Ignorar errores de limpieza
        }
        pageFlipRef.current = null;
      }
      if (container) {
        container.innerHTML = '';
      }
    };
    // Re-instanciar cuando cambia el PDF, el modo (doble/simple), o el ancho en modo simple
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderVersion, isSinglePage, isSinglePage ? stageSize.pageWidth : 0]);

  const handlePrev = useCallback(() => {
    if (pageFlipRef.current) {
      pageFlipRef.current.flipPrev();
    }
  }, []);

  const handleNext = useCallback(() => {
    if (pageFlipRef.current) {
      pageFlipRef.current.flipNext();
    }
  }, []);

  const jumpToPage = useCallback(
    (index: number) => {
      if (!pageFlipRef.current) return;
      const safeIdx = Math.max(0, Math.min(index, Math.max(0, totalPagesRef.current - 1)));
      prioritizeWindowAround(safeIdx, activeLoadTokenRef.current);
      try {
        pageFlipRef.current.flip(safeIdx);
      } catch (err) {
        console.error('Error al saltar a página:', err);
      }
      setIsSidebarOpen(false);
    },
    [prioritizeWindowAround]
  );

  // Limpiar caché de búsqueda cuando cambia el documento PDF
  useEffect(() => {
    pageTextCacheRef.current = [];
    setSearchQuery('');
    setSearchResults([]);
    setSearchCursor(-1);
    setSearchStatus('Escribe para buscar en todas las páginas');
  }, [pdfUrl, reloadNonce]);

  const executeTextSearch = useCallback(
    async (rawQuery: string, autoJump = false) => {
      setSearchQuery(rawQuery);
      const trimmed = rawQuery.trim();
      if (!trimmed) {
        setSearchResults([]);
        setSearchCursor(-1);
        setSearchStatus('Escribe para buscar en todas las páginas');
        return;
      }

      const doc = pdfDocRef.current;
      const count = totalPagesRef.current;
      if (!doc || count <= 0) return;

      if (pageTextCacheRef.current.length !== count) {
        const texts: string[] = new Array(count).fill('');
        for (let i = 0; i < count; i++) {
          if (pdfDocRef.current !== doc) return;
          setSearchStatus(`Indexando páginas (${i + 1}/${count})...`);
          try {
            const page = await doc.getPage(i + 1);
            const content = await page.getTextContent();
            texts[i] = joinPdfTextItems(content?.items || []);
          } catch {
            texts[i] = '';
          }
        }
        if (pdfDocRef.current !== doc) return;
        pageTextCacheRef.current = texts;
      }

      const found = searchPagesText(pageTextCacheRef.current, trimmed);
      setSearchResults(found);
      if (found.length === 0) {
        setSearchCursor(-1);
        setSearchStatus(`Sin resultados para "${trimmed}"`);
      } else {
        const totalMatches = found.reduce((acc, r) => acc + r.matchCount, 0);
        setSearchCursor(0);
        setSearchStatus(`${totalMatches} coincidencia${totalMatches === 1 ? '' : 's'} en ${found.length} pág.`);
        if (autoJump) {
          jumpToPage(found[0].pageIndex);
        }
      }
    },
    [jumpToPage]
  );

  const stepSearchResult = useCallback(
    (delta: number) => {
      if (searchResults.length === 0) return;
      const nextCursor =
        searchCursor < 0
          ? 0
          : (searchCursor + delta + searchResults.length) % searchResults.length;
      setSearchCursor(nextCursor);
      jumpToPage(searchResults[nextCursor].pageIndex);
    },
    [searchResults, searchCursor, jumpToPage]
  );

  const bookmarkDocKey = useMemo(
    () => getBookmarkDocKey(pdfUrl, docTitle),
    [pdfUrl, docTitle]
  );
  const lastPageDocKey = useMemo(
    () => getLastPageDocKey(pdfUrl, docTitle),
    [pdfUrl, docTitle]
  );

  // Cargar marcadores y última página leída desde localStorage al cambiar documento
  useEffect(() => {
    setEditingBookmarkIdx(null);
    try {
      setBookmarks(parseStoredBookmarks(localStorage.getItem(bookmarkDocKey)));
      const rawLast = localStorage.getItem(lastPageDocKey);
      const parsedLast = rawLast !== null ? Number(rawLast) : NaN;
      setLastReadPage(Number.isInteger(parsedLast) && parsedLast > 0 ? parsedLast : null);
    } catch {
      setBookmarks([]);
      setLastReadPage(null);
    }
  }, [bookmarkDocKey, lastPageDocKey]);

  // Guardar última página visitada automáticamente
  useEffect(() => {
    if (totalPages <= 0) return;
    try {
      localStorage.setItem(lastPageDocKey, String(currentIndex));
    } catch {
      // Ignorar errores de almacenamiento
    }
  }, [currentIndex, totalPages, lastPageDocKey]);

  const persistBookmarks = useCallback(
    (next: BookmarkEntry[]) => {
      setBookmarks(next);
      try {
        localStorage.setItem(bookmarkDocKey, JSON.stringify(next));
      } catch {
        // Ignorar errores de almacenamiento
      }
    },
    [bookmarkDocKey]
  );

  const visiblePageIndices = useMemo(
    () => getVisiblePageIndices(currentIndex, totalPages, isSinglePage),
    [currentIndex, totalPages, isSinglePage]
  );

  const isCurrentBookmarked = useMemo(
    () => visiblePageIndices.some((idx) => bookmarks.some((b) => b.pageIndex === idx)),
    [visiblePageIndices, bookmarks]
  );

  const toggleCurrentBookmark = useCallback(() => {
    if (totalPages <= 0) return;
    const activeMatch = visiblePageIndices.find((idx) =>
      bookmarks.some((b) => b.pageIndex === idx)
    );
    if (activeMatch !== undefined) {
      persistBookmarks(removeBookmarkEntry(bookmarks, activeMatch));
    } else {
      const targetIdx = visiblePageIndices[0] ?? Math.max(0, currentIndex);
      const label = getDefaultBookmarkLabel(targetIdx, totalPages, isSinglePage);
      const { entries } = toggleBookmarkEntry(bookmarks, targetIdx, label);
      persistBookmarks(entries);
    }
    setEditingBookmarkIdx(null);
  }, [totalPages, visiblePageIndices, bookmarks, currentIndex, isSinglePage, persistBookmarks]);

  const ensurePdfFilename = (rawName: string): string => {
    const cleaned = String(rawName || 'publicacion')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .trim();
    const base = cleaned || 'publicacion';
    return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
  };

  const clearPrintStage = useCallback(() => {
    if (printStageRef.current) {
      printStageRef.current.innerHTML = '';
    }
  }, []);

  const downloadActivePdf = useCallback(async () => {
    setIsMoreMenuOpen(false);
    const filename = ensurePdfFilename(docTitle);
    const doc = pdfDocRef.current;
    try {
      let blob: Blob | null = null;
      if (doc && typeof doc.getData === 'function') {
        const bytes = await doc.getData();
        blob = new Blob([bytes], { type: 'application/pdf' });
      } else if (pdfUrl) {
        const resp = await fetch(pdfUrl);
        blob = await resp.blob();
      }
      if (blob) {
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
      }
    } catch (err) {
      console.error('Error descargando PDF:', err);
      if (pdfUrl) {
        const link = document.createElement('a');
        link.href = pdfUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    }
  }, [docTitle, pdfUrl]);

  const printActivePdf = useCallback(async () => {
    setIsMoreMenuOpen(false);
    const doc = pdfDocRef.current;
    const count = totalPagesRef.current;
    const printStage = printStageRef.current;
    if (!doc || count <= 0 || !printStage || isPreparingPrint) return;

    setIsPreparingPrint(true);
    cancelPrintRef.current = false;
    setPrintPrepProgress(`Preparando página 1 de ${count}...`);
    clearPrintStage();

    try {
      const frag = document.createDocumentFragment();
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d', { alpha: false });

      for (let i = 1; i <= count; i++) {
        if (cancelPrintRef.current) break;
        setPrintPrepProgress(`Preparando página ${i} de ${count}...`);

        const page = await doc.getPage(i);
        if (cancelPrintRef.current) break;

        const viewport = page.getViewport({ scale: 1.5 });
        tempCanvas.width = Math.round(viewport.width);
        tempCanvas.height = Math.round(viewport.height);

        if (tempCtx) {
          tempCtx.fillStyle = '#ffffff';
          tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
          await page.render({
            canvasContext: tempCtx,
            viewport,
            background: '#ffffff',
          }).promise;
        }

        const sheet = document.createElement('div');
        sheet.className = 'print-page-sheet';
        const img = document.createElement('img');
        img.src = tempCanvas.toDataURL('image/jpeg', 0.92);
        img.alt = `Página ${i}`;
        sheet.appendChild(img);
        frag.appendChild(sheet);
      }

      tempCanvas.width = 1;
      tempCanvas.height = 1;

      if (!cancelPrintRef.current) {
        printStage.appendChild(frag);
        setIsPreparingPrint(false);
        window.print();
      } else {
        clearPrintStage();
      }
    } catch (err) {
      console.error('Error preparando impresión:', err);
      clearPrintStage();
    } finally {
      setIsPreparingPrint(false);
    }
  }, [clearPrintStage, isPreparingPrint]);

  useEffect(() => {
    window.addEventListener('afterprint', clearPrintStage);
    return () => window.removeEventListener('afterprint', clearPrintStage);
  }, [clearPrintStage]);

  useEffect(() => {
    if (!isMoreMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        moreActionsWrapperRef.current &&
        !moreActionsWrapperRef.current.contains(e.target as Node)
      ) {
        setIsMoreMenuOpen(false);
      }
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [isMoreMenuOpen]);

  // Atajos de teclado (Ctrl+F, Ctrl+P, B, Escape, flechas izquierda/derecha y zoom +/-/0)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsMoreMenuOpen(false);
        setIsBookmarksOpen(false);
        setIsSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 30);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        if (pdfDocRef.current && totalPagesRef.current > 0) {
          e.preventDefault();
          void printActivePdf();
        }
        return;
      }
      if (e.key === 'Escape') {
        setIsHandPanMode(false);
        if (isMoreMenuOpen) setIsMoreMenuOpen(false);
        if (isSearchOpen) setIsSearchOpen(false);
        if (isBookmarksOpen) setIsBookmarksOpen(false);
        if (shareModalOpen) setShareModalOpen(false);
        return;
      }
      if (shareModalOpen) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key.toLowerCase() === 'b') toggleCurrentBookmark();
      if (e.key.toLowerCase() === 'h' && zoom > 1) {
        setIsHandPanMode((prev) => !prev);
      }
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
      if (e.key === '+' || e.key === '=') applyZoom(zoom + ZOOM_STEP);
      if (e.key === '-') applyZoom(zoom - ZOOM_STEP);
      if (e.key === '0') applyZoom(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handlePrev,
    handleNext,
    shareModalOpen,
    isMoreMenuOpen,
    isSearchOpen,
    isBookmarksOpen,
    applyZoom,
    zoom,
    toggleCurrentBookmark,
    printActivePdf,
  ]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      try {
        const buffer = await file.arrayBuffer();
        const saved = await saveLocalPdfToLibrary(file, buffer);
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
        }
        const url = URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' }));
        objectUrlRef.current = url;
        activeLocalIdRef.current = saved ? saved.id : null;
        if (saved?.id && typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          params.delete('doc');
          params.set('local', saved.id);
          window.history.replaceState(null, '', `?${params.toString()}`);
        }
        setPdfUrl(url);
        setDocTitle(file.name);
        setErrorMessage(null);
      } catch {
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
        }
        const url = URL.createObjectURL(file);
        objectUrlRef.current = url;
        activeLocalIdRef.current = null;
        setPdfUrl(url);
        setDocTitle(file.name);
        setErrorMessage(null);
      }
    } else {
      setErrorMessage('El archivo seleccionado no es un documento PDF válido.');
    }
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error('Error al intentar pantalla completa:', err);
      });
    } else {
      document.exitFullscreen?.();
    }
  };

  const toggleSound = () => {
    setSoundEnabled((prev) => {
      const next = !prev;
      if (next) {
        playPaperFlipSound();
      }
      return next;
    });
  };

  // Paneo con rueda del ratón / trackpad cuando el zoom es superior al 100%
  useEffect(() => {
    const container = bookContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (zoomRef.current <= 1) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      setPan((prev) =>
        clampPanOffset({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
          zoom: zoomRef.current,
          stageWidth: stageSize.stageWidth,
          stageHeight: stageSize.stageHeight,
          containerWidth: rect.width || containerSize.width,
          containerHeight: rect.height || containerSize.height,
        })
      );
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [stageSize.stageWidth, stageSize.stageHeight, containerSize.width, containerSize.height]);

  // Soporte para paneo manteniendo presionada la barra espaciadora
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes((document.activeElement as HTMLElement)?.tagName)) {
        if (!isSpacePressedRef.current) {
          isSpacePressedRef.current = true;
          if (zoomRef.current > 1 && bookContainerRef.current) {
            bookContainerRef.current.style.cursor = 'grab';
          }
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false;
        if (bookContainerRef.current) {
          bookContainerRef.current.style.cursor = 'default';
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Manejador de paneo directo en el contenedor (sin bloquear el libro ni el pase directo de página)
  const handleContainerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    const target = e.target as HTMLElement | null;
    const isBook = !!target?.closest('#book');
    const shouldPan = !isBook || isSpacePressedRef.current || e.button === 1;
    if (shouldPan) {
      isBgPanningRef.current = true;
      setIsPanning(true);
      panOriginRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: pan.x,
        originY: pan.y,
      };
      if (bookContainerRef.current) {
        bookContainerRef.current.style.cursor = 'grabbing';
        try {
          bookContainerRef.current.setPointerCapture(e.pointerId);
        } catch {}
      }
    }
  };

  const handleContainerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isBgPanningRef.current) return;
    const dx = e.clientX - panOriginRef.current.startX;
    const dy = e.clientY - panOriginRef.current.startY;
    const rect = bookContainerRef.current?.getBoundingClientRect();
    setPan(
      clampPanOffset({
        x: panOriginRef.current.originX + dx,
        y: panOriginRef.current.originY + dy,
        zoom,
        stageWidth: stageSize.stageWidth,
        stageHeight: stageSize.stageHeight,
        containerWidth: rect?.width ?? containerSize.width,
        containerHeight: rect?.height ?? containerSize.height,
      })
    );
  };

  const handleContainerPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isBgPanningRef.current) return;
    isBgPanningRef.current = false;
    setIsPanning(false);
    if (bookContainerRef.current) {
      try {
        if (bookContainerRef.current.hasPointerCapture(e.pointerId)) {
          bookContainerRef.current.releasePointerCapture(e.pointerId);
        }
      } catch {}
      bookContainerRef.current.style.cursor = isSpacePressedRef.current ? 'grab' : 'default';
    }
  };

  // Paneo directo sobre la publicación cuando el modo mano está activo (con liberación garantizada y soltar con 1 clic)
  const isHandOverlayDraggingRef = useRef<boolean>(false);
  const handHasDraggedRef = useRef<boolean>(false);
  const handPendingReleaseRef = useRef<boolean>(false);
  const panOverlayRef = useRef<HTMLDivElement>(null);

  const stopHandOverlayPan = useCallback((pointerId?: number) => {
    if (!isHandOverlayDraggingRef.current) return;
    isHandOverlayDraggingRef.current = false;
    setIsPanning(false);
    if (panOverlayRef.current && pointerId !== undefined) {
      try {
        if (panOverlayRef.current.hasPointerCapture(pointerId)) {
          panOverlayRef.current.releasePointerCapture(pointerId);
        }
      } catch {}
    }
    if (!handHasDraggedRef.current) {
      handPendingReleaseRef.current = true;
      window.setTimeout(() => {
        if (handPendingReleaseRef.current) {
          handPendingReleaseRef.current = false;
          setIsHandPanMode(false);
        }
      }, 50);
    }
  }, []);

  useEffect(() => {
    const onWinPointerMove = (e: PointerEvent) => {
      if (isBgPanningRef.current) {
        const dx = e.clientX - panOriginRef.current.startX;
        const dy = e.clientY - panOriginRef.current.startY;
        const rect = bookContainerRef.current?.getBoundingClientRect();
        setPan(
          clampPanOffset({
            x: panOriginRef.current.originX + dx,
            y: panOriginRef.current.originY + dy,
            zoom: zoomRef.current,
            stageWidth: stageSize.stageWidth,
            stageHeight: stageSize.stageHeight,
            containerWidth: rect?.width ?? containerSize.width,
            containerHeight: rect?.height ?? containerSize.height,
          })
        );
      }
      if (isHandOverlayDraggingRef.current) {
        const dx = e.clientX - panOriginRef.current.startX;
        const dy = e.clientY - panOriginRef.current.startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
          handHasDraggedRef.current = true;
        }
        const rect = bookContainerRef.current?.getBoundingClientRect();
        setPan(
          clampPanOffset({
            x: panOriginRef.current.originX + dx,
            y: panOriginRef.current.originY + dy,
            zoom: zoomRef.current,
            stageWidth: stageSize.stageWidth,
            stageHeight: stageSize.stageHeight,
            containerWidth: rect?.width ?? containerSize.width,
            containerHeight: rect?.height ?? containerSize.height,
          })
        );
      }
    };

    const onWinPointerEnd = (e: PointerEvent) => {
      if (isBgPanningRef.current) {
        isBgPanningRef.current = false;
        setIsPanning(false);
        if (bookContainerRef.current) {
          try {
            if (bookContainerRef.current.hasPointerCapture(e.pointerId)) {
              bookContainerRef.current.releasePointerCapture(e.pointerId);
            }
          } catch {}
          bookContainerRef.current.style.cursor = isSpacePressedRef.current ? 'grab' : 'default';
        }
      }
      if (isHandOverlayDraggingRef.current) {
        stopHandOverlayPan(e.pointerId);
      }
    };

    const onWinEndFallback = () => {
      if (isBgPanningRef.current) {
        isBgPanningRef.current = false;
        setIsPanning(false);
        if (bookContainerRef.current) {
          bookContainerRef.current.style.cursor = isSpacePressedRef.current ? 'grab' : 'default';
        }
      }
      if (isHandOverlayDraggingRef.current) {
        stopHandOverlayPan();
      }
    };

    window.addEventListener('pointermove', onWinPointerMove);
    window.addEventListener('pointerup', onWinPointerEnd);
    window.addEventListener('pointercancel', onWinPointerEnd);
    window.addEventListener('mouseup', onWinEndFallback);
    window.addEventListener('blur', onWinEndFallback);
    return () => {
      window.removeEventListener('pointermove', onWinPointerMove);
      window.removeEventListener('pointerup', onWinPointerEnd);
      window.removeEventListener('pointercancel', onWinPointerEnd);
      window.removeEventListener('mouseup', onWinEndFallback);
      window.removeEventListener('blur', onWinEndFallback);
    };
  }, [stageSize.stageWidth, stageSize.stageHeight, containerSize.width, containerSize.height, stopHandOverlayPan]);

  const handleHandOverlayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1 || !isHandPanMode) return;
    e.preventDefault();
    e.stopPropagation();
    isHandOverlayDraggingRef.current = true;
    handHasDraggedRef.current = false;
    handPendingReleaseRef.current = false;
    setIsPanning(true);
    panOriginRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: pan.x,
      originY: pan.y,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const handleHandOverlayPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    stopHandOverlayPan(e.pointerId);
  };

  const handleHandOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isHandPanMode) return;
    e.preventDefault();
    e.stopPropagation();
    if (!handHasDraggedRef.current || handPendingReleaseRef.current) {
      handPendingReleaseRef.current = false;
      setIsHandPanMode(false);
    }
  };

  // Centrar visualmente la portada o contraportada cuando se muestra sola en modo doble página
  const stageTranslateClass = useMemo(() => {
    if (isSinglePage || totalPages <= 1) return 'translate-x-0';
    if (currentIndex === 0) return '-translate-x-1/4';
    if (totalPages % 2 === 0 && currentIndex >= totalPages - 1) return 'translate-x-1/4';
    return 'translate-x-0';
  }, [isSinglePage, totalPages, currentIndex]);

  return (
    <div className="app-shell h-screen w-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans select-none overflow-hidden">
      {/* BARRA SUPERIOR EDITORIAL ICONOGRÁFICA */}
      <header className="no-print h-14 sm:h-16 border-b border-zinc-800/80 bg-zinc-900/90 backdrop-blur-md px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 shrink-0 z-50">
        <div className="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-amber-500 flex items-center justify-center text-zinc-950 font-bold text-base sm:text-lg shrink-0 shadow-md shadow-amber-500/20">
            F
          </div>
          <div className="min-w-0 hidden min-[460px]:block">
            <h1 className="font-bold text-xs sm:text-sm tracking-wide text-zinc-100 whitespace-nowrap truncate">
              FLIPBOOK <span className="text-amber-500 font-normal hidden sm:inline">OPEN SOURCE</span>
            </h1>
          </div>
          <div className="h-5 w-px bg-zinc-800 hidden md:block shrink-0" />
          <div className="hidden md:flex items-center gap-2 text-sm text-zinc-300 min-w-0">
            <span
              className="group relative inline-flex items-center justify-center shrink-0 text-amber-400"
              tabIndex={0}
              aria-label="Publicación actual"
            >
              <BookOpen className="w-4 h-4" aria-hidden="true" />
              <span
                role="tooltip"
                className="rollover-tip pointer-events-none absolute top-full mt-2.5 left-0 px-2.5 py-1 rounded-md bg-zinc-900/95 border border-zinc-700/80 text-[11px] font-medium text-zinc-100 whitespace-nowrap shadow-xl opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0 transition-all duration-150 z-50"
              >
                Publicación actual
              </span>
            </span>
            <span className="font-medium truncate max-w-[180px] lg:max-w-xs" title={docTitle}>
              {docTitle}
            </span>
          </div>
        </div>

        {/* ACCIONES ICONOGRÁFICAS SUPERIORES CON ETIQUETAS ROLLOVER */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <a
            href="index.html"
            aria-label="Volver al catálogo de publicaciones"
            className="group relative p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 hover:text-amber-400 transition border border-zinc-700/80 flex items-center justify-center shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <ChevronLeft className="w-4 h-4 text-amber-500 shrink-0" aria-hidden="true" />
            <span
              role="tooltip"
              className="rollover-tip pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md bg-zinc-900/95 border border-zinc-700/80 text-[11px] font-medium text-zinc-100 whitespace-nowrap shadow-xl opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0 transition-all duration-150 z-50"
            >
              Volver al catálogo
            </span>
          </a>

          <button
            type="button"
            onClick={toggleCurrentBookmark}
            aria-pressed={isCurrentBookmarked}
            aria-label={
              isCurrentBookmarked
                ? 'Quitar marcador de esta página'
                : 'Guardar marcador en página actual (B)'
            }
            className={`group relative p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition border shrink-0 cursor-pointer flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
              isCurrentBookmarked
                ? 'border-amber-500/50 text-amber-400'
                : 'border-zinc-700/70 text-zinc-300'
            }`}
          >
            <Bookmark
              className="w-4 h-4"
              fill={isCurrentBookmarked ? 'currentColor' : 'none'}
              aria-hidden="true"
            />
            <span
              role="tooltip"
              className="rollover-tip pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md bg-zinc-900/95 border border-zinc-700/80 text-[11px] font-medium text-zinc-100 whitespace-nowrap shadow-xl opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0 transition-all duration-150 z-50"
            >
              {isCurrentBookmarked ? 'Quitar marcador' : 'Guardar marcador (B)'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsMoreMenuOpen(false);
              setIsSearchOpen(false);
              setIsBookmarksOpen((open) => !open);
            }}
            className="group relative p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition border border-zinc-700/70 flex items-center justify-center shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            aria-label="Ver marcadores guardados"
            aria-expanded={isBookmarksOpen}
          >
            <svg
              className="w-4 h-4 text-amber-400 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5zM9 8h6M9 12h4"
              />
            </svg>
            {bookmarks.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-zinc-950 font-mono tabular-nums text-[10px] font-bold flex items-center justify-center leading-none">
                {bookmarks.length}
              </span>
            )}
            <span
              role="tooltip"
              className="rollover-tip pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md bg-zinc-900/95 border border-zinc-700/80 text-[11px] font-medium text-zinc-100 whitespace-nowrap shadow-xl opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0 transition-all duration-150 z-50"
            >
              Marcadores guardados
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsMoreMenuOpen(false);
              setIsBookmarksOpen(false);
              setIsSearchOpen((open) => {
                const next = !open;
                if (next) setTimeout(() => searchInputRef.current?.focus(), 30);
                return next;
              });
            }}
            className="group relative p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition border border-zinc-700/70 flex items-center justify-center shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            aria-label="Buscar texto en la publicación"
            aria-expanded={isSearchOpen}
          >
            <Search className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
            <span
              role="tooltip"
              className="rollover-tip pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md bg-zinc-900/95 border border-zinc-700/80 text-[11px] font-medium text-zinc-100 whitespace-nowrap shadow-xl opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0 transition-all duration-150 z-50"
            >
              Buscar texto (Ctrl+F)
            </span>
          </button>

          <button
            type="button"
            onClick={() => setIsSidebarOpen((open) => !open)}
            className="group relative p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition border border-zinc-700/70 flex items-center justify-center shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            aria-label="Índice de páginas"
            aria-expanded={isSidebarOpen}
          >
            <LayoutGrid className="w-4 h-4 text-amber-500 shrink-0" aria-hidden="true" />
            <span
              role="tooltip"
              className="rollover-tip pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md bg-zinc-900/95 border border-zinc-700/80 text-[11px] font-medium text-zinc-100 whitespace-nowrap shadow-xl opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0 transition-all duration-150 z-50"
            >
              Índice de páginas
            </span>
          </button>

          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={soundEnabled}
            aria-label={soundEnabled ? 'Silenciar sonido' : 'Activar sonido'}
            className="group relative hidden sm:inline-flex p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition border border-zinc-700/70 shrink-0 cursor-pointer items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            {soundEnabled ? (
              <Volume2 className="w-4 h-4 text-amber-400" aria-hidden="true" />
            ) : (
              <VolumeX className="w-4 h-4 text-zinc-400" aria-hidden="true" />
            )}
            <span
              role="tooltip"
              className="rollover-tip pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md bg-zinc-900/95 border border-zinc-700/80 text-[11px] font-medium text-zinc-100 whitespace-nowrap shadow-xl opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0 transition-all duration-150 z-50"
            >
              {soundEnabled ? 'Silenciar sonido' : 'Activar sonido'}
            </span>
          </button>

          <button
            type="button"
            onClick={toggleFullScreen}
            className="group relative hidden sm:inline-flex p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition border border-zinc-700/70 shrink-0 cursor-pointer items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4 text-amber-400" aria-hidden="true" />
            ) : (
              <Maximize2 className="w-4 h-4 text-zinc-300" aria-hidden="true" />
            )}
            <span
              role="tooltip"
              className="rollover-tip pointer-events-none absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md bg-zinc-900/95 border border-zinc-700/80 text-[11px] font-medium text-zinc-100 whitespace-nowrap shadow-xl opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0 transition-all duration-150 z-50"
            >
              {isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            </span>
          </button>

          {/* Menú compacto de acciones secundarias (Descargar, Imprimir, Compartir) */}
          <div ref={moreActionsWrapperRef} className="relative shrink-0">
            <button
              id="more-actions-btn"
              type="button"
              onClick={() => setIsMoreMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={isMoreMenuOpen}
              aria-controls="more-actions-menu"
              aria-label="Más opciones (Descargar, Imprimir y Compartir)"
              className="group relative p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition border border-zinc-700/70 flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              <MoreVertical className="w-4 h-4 text-zinc-200" aria-hidden="true" />
              <span
                role="tooltip"
                className="rollover-tip pointer-events-none absolute top-full mt-2 right-0 px-2.5 py-1 rounded-md bg-zinc-900/95 border border-zinc-700/80 text-[11px] font-medium text-zinc-100 whitespace-nowrap shadow-xl opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0 transition-all duration-150 z-50"
              >
                Más opciones
              </span>
            </button>

            {isMoreMenuOpen && (
              <div
                id="more-actions-menu"
                role="menu"
                aria-labelledby="more-actions-btn"
                className="absolute right-0 mt-2 w-56 rounded-xl bg-zinc-900/98 backdrop-blur-xl border border-zinc-800 shadow-2xl p-1.5 z-50 text-xs"
              >
                <button
                  id="menu-download-btn"
                  type="button"
                  role="menuitem"
                  onClick={() => void downloadActivePdf()}
                  className="w-full px-3 py-2 rounded-lg text-left text-zinc-200 hover:bg-zinc-800 hover:text-amber-400 transition flex items-center gap-2.5 cursor-pointer"
                >
                  <Download className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="flex-1 font-medium">Descargar PDF</span>
                </button>

                <button
                  id="menu-print-btn"
                  type="button"
                  role="menuitem"
                  onClick={() => void printActivePdf()}
                  className="w-full px-3 py-2 rounded-lg text-left text-zinc-200 hover:bg-zinc-800 hover:text-amber-400 transition flex items-center gap-2.5 cursor-pointer"
                >
                  <Printer className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="flex-1 font-medium">Imprimir publicación</span>
                </button>

                <div className="sm:hidden my-1 border-t border-zinc-800" />

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    toggleSound();
                    setIsMoreMenuOpen(false);
                  }}
                  className="sm:hidden w-full px-3 py-2 rounded-lg text-left text-zinc-200 hover:bg-zinc-800 transition flex items-center gap-2.5 cursor-pointer"
                >
                  {soundEnabled ? (
                    <Volume2 className="w-4 h-4 text-zinc-400 shrink-0" />
                  ) : (
                    <VolumeX className="w-4 h-4 text-zinc-400 shrink-0" />
                  )}
                  <span className="flex-1">{soundEnabled ? 'Silenciar sonido' : 'Activar sonido'}</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    toggleFullScreen();
                  }}
                  className="sm:hidden w-full px-3 py-2 rounded-lg text-left text-zinc-200 hover:bg-zinc-800 transition flex items-center gap-2.5 cursor-pointer"
                >
                  {isFullscreen ? (
                    <Minimize2 className="w-4 h-4 text-zinc-400 shrink-0" />
                  ) : (
                    <Maximize2 className="w-4 h-4 text-zinc-400 shrink-0" />
                  )}
                  <span className="flex-1">{isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    setShareModalOpen(true);
                  }}
                  className="w-full px-3 py-2 rounded-lg text-left text-zinc-200 hover:bg-zinc-800 transition flex items-center gap-2.5 cursor-pointer"
                >
                  <Share2 className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="flex-1">Compartir publicación</span>
                </button>
              </div>
            )}
          </div>

          {/* Respaldo secundario: oculto automáticamente si se abrió vía ?doc= */}
          {!hasUrlDocParam && (
            <>
              <div className="h-5 w-px bg-zinc-800 hidden sm:block shrink-0" />
              <label
                data-testid="upload-local-header"
                aria-label="Subir archivo PDF local"
                className="group relative cursor-pointer bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/80 p-2 rounded-lg transition flex items-center justify-center shrink-0 focus-within:ring-2 focus-within:ring-amber-500"
              >
                <Upload className="w-4 h-4 text-amber-500 shrink-0" aria-hidden="true" />
                <span
                  role="tooltip"
                  className="rollover-tip pointer-events-none absolute top-full mt-2 right-0 px-2.5 py-1 rounded-md bg-zinc-900/95 border border-zinc-700/80 text-[11px] font-medium text-zinc-100 whitespace-nowrap shadow-xl opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0 transition-all duration-150 z-50"
                >
                  Subir PDF local
                </span>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileUpload}
                  className="hidden"
                  aria-label="Subir PDF local"
                />
              </label>
            </>
          )}
        </div>
      </header>

      {/* ÁREA PRINCIPAL CON FLIPBOOK */}
      <div className="no-print flex-1 flex relative overflow-hidden bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-zinc-900 via-zinc-950 to-zinc-950">
        {/* LOADER CON BARRA DE PROGRESO */}
        {isLoading && (
          <div
            data-testid="loading-overlay"
            className="absolute inset-0 bg-zinc-950/92 backdrop-blur-md flex flex-col items-center justify-center p-6 z-40 transition-opacity duration-300"
            role="status"
            aria-live="polite"
          >
            <div className="w-full max-w-sm bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-2xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                  <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-zinc-100 truncate">{docTitle}</p>
                  <p className="text-xs text-zinc-400 truncate mt-0.5">{loadingMessage}</p>
                </div>
                <span
                  data-testid="loading-percent"
                  className="text-xs font-mono tabular-nums font-semibold text-amber-400 shrink-0"
                >
                  {loadingPercent}%
                </span>
              </div>
              <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all duration-200 ease-out"
                  style={{ width: `${Math.max(4, loadingPercent)}%` }}
                />
              </div>
              <p className="text-[11px] text-zinc-500 mt-3 text-center">
                Carga progresiva activada para lectura rápida
              </p>
            </div>
          </div>
        )}

        {/* ESTADO DE ERROR CON RESPALDO LOCAL */}
        {errorMessage && !isLoading && (
          <div className="absolute inset-0 bg-zinc-950/92 backdrop-blur-sm flex items-center justify-center p-6 z-40">
            <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-6 text-center shadow-2xl">
              <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
              <h2 className="text-base font-semibold text-zinc-100 mb-2">
                No se pudo abrir el documento
              </h2>
              <p className="text-xs text-zinc-400 mb-5 leading-relaxed">{errorMessage}</p>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage(null);
                    setReloadNonce((n) => n + 1);
                  }}
                  className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition cursor-pointer"
                >
                  Reintentar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage(null);
                    setPdfUrl(DEFAULT_PDF_URL);
                    setDocTitle(DEFAULT_DOC_TITLE);
                  }}
                  className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition cursor-pointer"
                >
                  Abrir revista demo
                </button>
                <label className="cursor-pointer px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold transition">
                  <span>Subir PDF local</span>
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* SIDEBAR DE MINIATURAS */}
        <aside
          className={`absolute top-0 left-0 bottom-0 w-72 sm:w-80 bg-zinc-900/95 backdrop-blur-xl border-r border-zinc-800 z-30 transition-transform duration-300 flex flex-col shadow-2xl ${
            isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          aria-hidden={!isSidebarOpen}
        >
          <div className="h-14 border-b border-zinc-800 px-5 flex items-center justify-between shrink-0">
            <h2 className="font-bold text-sm text-zinc-100 flex items-center gap-2">
              <LayoutGrid className="w-4 h-4 text-amber-500" />
              <span>Índice de Páginas</span>
            </h2>
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="text-zinc-300 hover:text-zinc-100 text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition cursor-pointer"
            >
              Cerrar
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 gap-3">
            {thumbnails.map((thumb, idx) => {
              const pageNumber = idx + 1;
              const isActive = pageIndicator.activePages.includes(pageNumber);
              return (
                <button
                  type="button"
                  key={pageNumber}
                  onClick={() => jumpToPage(idx)}
                  className={`group relative rounded-lg overflow-hidden border-2 transition text-left bg-zinc-950 p-1.5 flex flex-col items-center cursor-pointer ${
                    isActive
                      ? 'border-amber-500 shadow-md shadow-amber-500/15'
                      : 'border-zinc-800 hover:border-zinc-600'
                  }`}
                >
                  <div className="w-full aspect-[3/4] overflow-hidden rounded bg-white flex items-center justify-center">
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={`Página ${pageNumber}`}
                        className="w-full h-full object-contain group-hover:scale-105 transition duration-300"
                      />
                    ) : (
                      <span className="text-[11px] font-mono text-zinc-400">
                        Pág. {pageNumber}
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-[11px] font-mono tabular-nums mt-1.5 ${
                      isActive ? 'text-amber-400 font-bold' : 'text-zinc-400'
                    }`}
                  >
                    Página {pageNumber}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* CONTENEDOR CENTRAL DEL LIBRO */}
        <main
          ref={mainRef}
          className="flex-1 flex flex-col items-center justify-start pt-4 pb-20 px-4 relative overflow-hidden"
        >
          <div
            ref={bookContainerRef}
            id="book-container"
            onPointerDown={handleContainerPointerDown}
            onPointerMove={handleContainerPointerMove}
            onPointerUp={handleContainerPointerUp}
            onPointerCancel={handleContainerPointerUp}
            className="flex-1 w-full flex items-center justify-center overflow-hidden relative"
          >
            <div
              data-testid="zoom-layer"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transition: isPanning ? 'none' : 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              className="flex items-center justify-center origin-center will-change-transform"
            >
              <div
                id="book-stage"
                data-testid="book-stage"
                data-view-mode={isSinglePage ? 'single' : 'double'}
                style={{
                  width: `${stageSize.stageWidth}px`,
                  height: `${stageSize.stageHeight}px`,
                }}
                className={`relative flex items-center justify-center transition-transform duration-500 ease-out ${stageTranslateClass}`}
              >
                <div ref={bookRef} id="book" className="w-full h-full" />
              </div>
            </div>

            {/* Capa de arrastre con mano (solo activa cuando zoom > 100% y el modo mano está encendido) */}
            <div
              ref={panOverlayRef}
              data-testid="pan-overlay"
              onPointerDown={handleHandOverlayPointerDown}
              onPointerUp={handleHandOverlayPointerUp}
              onPointerCancel={handleHandOverlayPointerUp}
              onClick={handleHandOverlayClick}
              className={
                zoom > 1 && isHandPanMode
                  ? `block absolute inset-0 z-10 touch-none pointer-events-auto ${
                      isPanning ? 'cursor-grabbing' : 'cursor-grab'
                    }`
                  : 'hidden pointer-events-none'
              }
              aria-hidden="true"
            />
          </div>

          {/* BARRA INFERIOR FLOTANTE DE CONTROL Y ZOOM */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 sm:gap-3 bg-zinc-900/95 border border-zinc-800 px-2.5 sm:px-5 py-2 rounded-full shadow-2xl backdrop-blur-md z-20 max-w-[96vw]">
            <button
              type="button"
              onClick={handlePrev}
              disabled={pageIndicator.isFirst}
              className="px-2 sm:px-3 py-1.5 rounded-full text-xs font-semibold hover:bg-zinc-800 text-zinc-200 transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              aria-label="Página anterior"
              title="Página anterior (←)"
            >
              <ChevronLeft className="w-4 h-4 text-amber-500 shrink-0" />
              <span className="hidden md:inline">Anterior</span>
            </button>

            <div className="h-4 w-px bg-zinc-800 shrink-0" />

            <div
              data-testid="page-indicator"
              className="text-[11px] sm:text-xs font-mono tabular-nums text-zinc-200 px-1 sm:px-1.5 whitespace-nowrap shrink-0"
            >
              {pageIndicator.label}
            </div>

            <div className="h-4 w-px bg-zinc-800 shrink-0" />

            <button
              type="button"
              onClick={handleNext}
              disabled={pageIndicator.isLast}
              className="px-2 sm:px-3 py-1.5 rounded-full text-xs font-semibold hover:bg-zinc-800 text-zinc-200 transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
              aria-label="Página siguiente"
              title="Página siguiente (→)"
            >
              <span className="hidden md:inline">Siguiente</span>
              <ChevronRight className="w-4 h-4 text-amber-500 shrink-0" />
            </button>

            <div className="h-4 w-px bg-zinc-800 shrink-0" />

            {/* Controles de Zoom Inteligente y Mano para Mover Vista */}
            <div
              className="flex items-center bg-zinc-950/80 border border-zinc-800 rounded-full p-0.5 shrink-0"
              role="group"
              aria-label="Controles de zoom y desplazamiento"
            >
              <button
                type="button"
                onClick={() => applyZoom(zoom - ZOOM_STEP)}
                disabled={zoom <= MIN_ZOOM}
                aria-label="Alejar (-)"
                title="Alejar (-)"
                className="p-1.5 rounded-full text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                data-testid="zoom-reset"
                onClick={() => applyZoom(1)}
                aria-label="Restaurar zoom al 100%"
                title="Restaurar (100%)"
                className={`px-2 py-1 rounded-full text-[11px] font-mono tabular-nums hover:bg-zinc-800 transition whitespace-nowrap cursor-pointer ${
                  zoom !== 1 ? 'text-amber-400 font-semibold' : 'text-zinc-200'
                }`}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => applyZoom(zoom + ZOOM_STEP)}
                disabled={zoom >= MAX_ZOOM}
                aria-label="Acercar (+)"
                title="Acercar (+)"
                className="p-1.5 rounded-full text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <div className="h-3.5 w-px bg-zinc-800 mx-0.5 shrink-0" />
              <button
                type="button"
                data-testid="pan-mode-btn"
                onClick={() => {
                  if (zoom > 1) setIsHandPanMode((prev) => !prev);
                }}
                disabled={zoom <= 1}
                aria-pressed={zoom > 1 && isHandPanMode}
                aria-label={
                  zoom <= 1
                    ? 'Amplía el zoom (>100%) para mover con la mano'
                    : isHandPanMode
                      ? 'Soltar mano (clic en la página o pulsa H)'
                      : 'Mover publicación con la mano (H)'
                }
                title={
                  zoom <= 1
                    ? 'Amplía el zoom (>100%) para mover con la mano'
                    : isHandPanMode
                      ? 'Soltar mano (clic en la página o pulsa H)'
                      : 'Mover publicación con la mano (H)'
                }
                className={
                  zoom > 1 && isHandPanMode
                    ? 'p-1.5 rounded-full bg-amber-500 text-zinc-950 font-semibold transition cursor-pointer'
                    : 'p-1.5 rounded-full text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer'
                }
              >
                <Hand className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="h-4 w-px bg-zinc-800 shrink-0" />

            {/* Selector de vista Doble / Una página */}
            <div
              className="hidden sm:flex items-center bg-zinc-950/80 border border-zinc-800 rounded-full p-0.5 shrink-0"
              role="group"
              aria-label="Modo de visualización"
            >
              <button
                type="button"
                onClick={() => setViewMode('double')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                  !isSinglePage
                    ? 'bg-amber-500 text-zinc-950 font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Ver a doble página"
              >
                <Columns2 className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden lg:inline">Doble</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('single')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                  isSinglePage
                    ? 'bg-amber-500 text-zinc-950 font-semibold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Ver una página"
              >
                <BookOpen className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden lg:inline">1 pág</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setViewMode(isSinglePage ? 'double' : 'single')}
              aria-label="Alternar vista doble o una página"
              title={isSinglePage ? 'Cambiar a doble página' : 'Cambiar a una página'}
              className="sm:hidden p-1.5 rounded-full bg-zinc-950/80 border border-zinc-800 text-amber-400 hover:bg-zinc-800 transition shrink-0 cursor-pointer"
            >
              {isSinglePage ? <BookOpen className="w-3.5 h-3.5" /> : <Columns2 className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* PANEL DE BÚSQUEDA DE TEXTO */}
          {isSearchOpen && (
            <aside
              aria-label="Buscar texto en la publicación"
              className="absolute top-3 right-3 sm:right-6 w-[calc(100vw-1.5rem)] sm:w-96 max-h-[calc(100%-6.5rem)] bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 rounded-2xl shadow-2xl z-30 flex flex-col overflow-hidden"
            >
              <div className="p-3 border-b border-zinc-800/80 flex items-center gap-2">
                <div className="relative flex-1 flex items-center">
                  <Search className="w-4 h-4 text-amber-400 absolute left-3 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={searchQuery}
                    onChange={(e) => {
                      void executeTextSearch(e.target.value, false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (searchResults.length > 0) {
                          stepSearchResult(e.shiftKey ? -1 : 1);
                        } else {
                          void executeTextSearch(searchQuery, true);
                        }
                      }
                    }}
                    placeholder="Buscar palabra o frase..."
                    aria-label="Buscar palabra o frase en el PDF"
                    className="w-full bg-zinc-950/90 border border-zinc-700/80 focus:border-amber-500 rounded-xl pl-9 pr-8 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 outline-none transition"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        void executeTextSearch('');
                        searchInputRef.current?.focus();
                      }}
                      aria-label="Limpiar búsqueda"
                      className="absolute right-2 p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setIsSearchOpen(false)}
                  className="px-2.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition cursor-pointer shrink-0"
                >
                  Cerrar
                </button>
              </div>

              <div className="px-3.5 py-2 border-b border-zinc-800/70 bg-zinc-950/50 flex items-center justify-between gap-2 text-[11px]">
                <span className="text-zinc-400 truncate">{searchStatus}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={searchResults.length === 0}
                    onClick={() => stepSearchResult(-1)}
                    aria-label="Resultado anterior"
                    className="p-1.5 rounded-lg bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={searchResults.length === 0}
                    onClick={() => stepSearchResult(1)}
                    aria-label="Siguiente resultado"
                    className="p-1.5 rounded-lg bg-zinc-800/90 hover:bg-zinc-700 text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5 text-xs">
                {searchResults.length === 0 ? (
                  <p className="text-zinc-500 text-center py-6 px-4 leading-relaxed">
                    {searchQuery.trim()
                      ? 'No se encontraron coincidencias en el documento.'
                      : 'Busca cualquier término dentro de la publicación. Haz clic en un resultado para ir directamente a esa página.'}
                  </p>
                ) : (
                  searchResults.map((res, idx) => (
                    <button
                      type="button"
                      key={res.pageNumber}
                      onClick={() => {
                        setSearchCursor(idx);
                        jumpToPage(res.pageIndex);
                      }}
                      className={`w-full text-left p-2.5 rounded-xl border transition cursor-pointer ${
                        idx === searchCursor
                          ? 'bg-amber-500/12 border-amber-500/60'
                          : 'bg-zinc-950/60 border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-800/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-amber-400 font-mono tabular-nums">
                          Página {res.pageNumber}
                        </span>
                        <span className="text-[10px] text-zinc-400 font-mono tabular-nums">
                          {res.matchCount} coinc.
                        </span>
                      </div>
                      {res.snippets.slice(0, 2).map((s, sIdx) => (
                        <p key={sIdx} className="text-[11px] text-zinc-300 leading-relaxed mt-1">
                          {s.before}
                          <mark className="bg-amber-500/35 text-amber-200 px-0.5 rounded">{s.match}</mark>
                          {s.after}
                        </p>
                      ))}
                    </button>
                  ))
                )}
              </div>
            </aside>
          )}

          {/* PANEL DE MARCADORES PERSISTENTES */}
          {isBookmarksOpen && (
            <aside
              aria-label="Marcadores guardados"
              className="absolute top-3 right-3 sm:right-6 w-[calc(100vw-1.5rem)] sm:w-96 max-h-[calc(100%-6.5rem)] bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 rounded-2xl shadow-2xl z-30 flex flex-col overflow-hidden"
            >
              <div className="p-3.5 border-b border-zinc-800/80 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Bookmark className="w-4 h-4 text-amber-400 shrink-0" fill="currentColor" />
                  <h2 className="text-xs sm:text-sm font-semibold text-zinc-100 truncate">
                    Marcadores
                  </h2>
                  <span className="text-[11px] font-mono tabular-nums text-zinc-400">
                    ({bookmarks.length})
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={toggleCurrentBookmark}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-[11px] font-semibold transition cursor-pointer whitespace-nowrap"
                  >
                    {isCurrentBookmarked ? 'Quitar actual' : '+ Guardar actual'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsBookmarksOpen(false)}
                    className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-medium transition cursor-pointer"
                  >
                    Cerrar
                  </button>
                </div>
              </div>

              {lastReadPage !== null &&
                lastReadPage < totalPages &&
                !visiblePageIndices.includes(lastReadPage) && (
                  <div className="px-3.5 py-2.5 border-b border-zinc-800/70 bg-amber-500/10 flex items-center justify-between gap-2 text-xs">
                    <span className="text-amber-200 truncate">
                      Última lectura: Página {lastReadPage + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const target = lastReadPage;
                        setLastReadPage(null);
                        jumpToPage(target);
                      }}
                      className="px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-400 text-zinc-950 text-[11px] font-semibold transition cursor-pointer shrink-0"
                    >
                      Retomar
                    </button>
                  </div>
                )}

              <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5 text-xs">
                {bookmarks.length === 0 ? (
                  <p className="text-zinc-500 text-center py-6 px-4 leading-relaxed">
                    Aún no tienes marcadores guardados en esta publicación. Pulsa el ícono de marcador en la barra superior para guardar tu página actual.
                  </p>
                ) : (
                  bookmarks.map((entry) => {
                    const isActivePage = visiblePageIndices.includes(entry.pageIndex);
                    return (
                      <div
                        key={entry.pageIndex}
                        className={`p-2.5 rounded-xl border transition flex items-start justify-between gap-2 ${
                          isActivePage
                            ? 'bg-amber-500/12 border-amber-500/60'
                            : 'bg-zinc-950/60 border-zinc-800/80 hover:border-zinc-700'
                        }`}
                      >
                        {editingBookmarkIdx === entry.pageIndex ? (
                          <form
                            className="flex-1 flex items-center gap-1.5"
                            onSubmit={(ev) => {
                              ev.preventDefault();
                              persistBookmarks(
                                updateBookmarkLabel(bookmarks, entry.pageIndex, editingBookmarkText)
                              );
                              setEditingBookmarkIdx(null);
                            }}
                          >
                            <input
                              type="text"
                              value={editingBookmarkText}
                              maxLength={60}
                              onChange={(ev) => setEditingBookmarkText(ev.target.value)}
                              aria-label="Etiqueta del marcador"
                              className="flex-1 bg-zinc-900 border border-amber-500/70 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 outline-none"
                            />
                            <button
                              type="submit"
                              className="px-2.5 py-1.5 rounded-lg bg-amber-500 text-zinc-950 text-[11px] font-semibold cursor-pointer"
                            >
                              OK
                            </button>
                          </form>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => jumpToPage(entry.pageIndex)}
                              className="flex-1 text-left min-w-0 cursor-pointer"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-semibold text-amber-400 font-mono tabular-nums shrink-0">
                                  Pág. {entry.pageNumber}
                                </span>
                                <span className="text-[10px] text-zinc-500 truncate">
                                  {new Date(entry.createdAt).toLocaleString('es-ES', {
                                    day: '2-digit',
                                    month: 'short',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              </div>
                              <p className="text-xs font-medium text-zinc-200 truncate mt-0.5">
                                {entry.label}
                              </p>
                            </button>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingBookmarkIdx(entry.pageIndex);
                                  setEditingBookmarkText(entry.label);
                                }}
                                aria-label={`Editar etiqueta de página ${entry.pageNumber}`}
                                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  persistBookmarks(removeBookmarkEntry(bookmarks, entry.pageIndex))
                                }
                                aria-label={`Eliminar marcador de página ${entry.pageNumber}`}
                                className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-zinc-800 transition cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {bookmarks.length > 0 && (
                <div className="px-3.5 py-2.5 border-t border-zinc-800/80 bg-zinc-950/60 flex items-center justify-between text-[11px] text-zinc-400">
                  <span>Guardado automáticamente en este navegador</span>
                  <button
                    type="button"
                    onClick={() => {
                      persistBookmarks([]);
                      setEditingBookmarkIdx(null);
                    }}
                    className="text-zinc-400 hover:text-red-400 font-medium transition cursor-pointer"
                  >
                    Borrar todos
                  </button>
                </div>
              )}
            </aside>
          )}
        </main>
      </div>

      {/* MODAL DE COMPARTIR */}
      {shareModalOpen && (
        <div
          className="no-print fixed inset-0 bg-zinc-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-modal-title"
        >
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3
              id="share-modal-title"
              className="text-lg font-bold text-zinc-100 mb-2 flex items-center gap-2"
            >
              <Share2 className="w-5 h-5 text-amber-500" />
              <span>Compartir Publicación</span>
            </h3>
            <p className="text-xs text-zinc-400 mb-4 flex items-start gap-2">
              <FileText className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
              <span>
                Copia el enlace para compartir este flipbook interactivo con tus lectores o clientes.
              </span>
            </p>
            <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-xl p-2 mb-4">
              <input
                type="text"
                readOnly
                value={typeof window !== 'undefined' ? window.location.href : ''}
                aria-label="Enlace de la publicación"
                className="bg-transparent text-xs text-zinc-300 flex-1 px-2 outline-none font-mono"
              />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-semibold px-3 py-1.5 rounded-lg transition flex items-center gap-1 whitespace-nowrap cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : null}
                <span>{copied ? '¡Copiado!' : 'Copiar'}</span>
              </button>
            </div>

            <div className="space-y-2 mb-5">
              {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.share({
                      title: docTitle,
                      text: 'Explora esta publicación interactiva',
                      url: window.location.href,
                    }).catch(() => {});
                  }}
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Share2 className="w-4 h-4 text-amber-400" />
                  <span>Compartir mediante aplicaciones del dispositivo...</span>
                </button>
              )}

              <div className="grid grid-cols-3 gap-2">
                <a
                  href={`https://api.whatsapp.com/send?text=${encodeURIComponent('¡Hola! Te comparto esta publicación interactiva: ' + docTitle + ' - ' + (typeof window !== 'undefined' ? window.location.href : ''))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-medium transition flex items-center justify-center gap-1.5"
                >
                  <span className="text-emerald-400 font-bold">W</span> WhatsApp
                </a>
                <a
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent('Explora esta publicación digital: ' + docTitle)}&url=${encodeURIComponent(typeof window !== 'undefined' ? window.location.href : '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-medium transition flex items-center justify-center gap-1.5"
                >
                  <span className="text-sky-400 font-bold">X</span> Twitter
                </a>
                <a
                  href={`mailto:?subject=${encodeURIComponent('Publicación: ' + docTitle)}&body=${encodeURIComponent('Hola,\n\nTe comparto este enlace para leer la publicación interactiva:\n\n' + (typeof window !== 'undefined' ? window.location.href : ''))}`}
                  className="px-3 py-2 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-medium transition flex items-center justify-center gap-1.5"
                >
                  <span className="text-amber-400 font-bold">@</span> Correo
                </a>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShareModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diálogo de preparación para impresión */}
      {isPreparingPrint && (
        <div
          id="print-prep-overlay"
          role="status"
          aria-live="polite"
          className="no-print fixed inset-0 bg-zinc-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-xs bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-2xl text-center">
            <div className="w-7 h-7 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm font-semibold text-zinc-100">Preparando impresión</p>
            <p className="text-xs text-zinc-400 mt-1">{printPrepProgress}</p>
            <button
              type="button"
              onClick={() => {
                cancelPrintRef.current = true;
                setIsPreparingPrint(false);
              }}
              className="mt-4 px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 font-medium transition cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Contenedor exclusivo para @media print */}
      <div id="print-stage" ref={printStageRef} aria-hidden="true" />
    </div>
  );
}
