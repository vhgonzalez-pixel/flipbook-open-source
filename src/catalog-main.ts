import type { User } from 'firebase/auth';
import {
  addCloudPublication,
  auth,
  BLUEPRINT_LIMITS,
  type CloudPublicationItem,
  deleteCloudPublication,
  handleRedirectResult,
  isFirebaseReady,
  saveHiddenBuiltinKeysToCloud,
  signInIndividualUser,
  signOutIndividualUser,
  subscribeToAuth,
  subscribeToUserCatalog,
} from './catalog-firebase';
import {
  buildCanonicalShareLink,
  deleteSharedPublicationFromCloud,
  MAX_SHARED_PDF_BYTES,
  publishPdfBytesToCloudShare,
  verifySharedPublicationExists,
} from './shared-publications';

interface BuiltinPublication {
  titulo: string;
  categoria: string;
  fecha: string;
  descripcion: string;
  rutaPortada: string;
  rutaPdf: string;
}

interface LocalPublication {
  id: string;
  titulo: string;
  fileName: string;
  fileSize: number;
  categoria: string;
  fecha: string;
  descripcion: string;
  pageCount: number | null;
  coverDataUrl: string | null;
  pdfData: ArrayBuffer;
  addedAt: number;
  sharedId?: string | null;
}

type CatalogItem =
  | (BuiltinPublication & { isLocal?: false; isCloud?: false })
  | (LocalPublication & { isLocal: true; isCloud?: false; rutaPortada: string; rutaPdf?: string })
  | CloudPublicationItem;

const PUBLICACIONES: BuiltinPublication[] = [
  {
    titulo: 'Forma & Hormigón: Pabellones del Sur',
    categoria: 'Revistas',
    fecha: 'Marzo 2026',
    descripcion:
      'Monográfico sobre arquitectura brutalista contemporánea, luz natural y geometría estructural en espacios públicos.',
    rutaPortada: 'publicaciones/portadas/rev1.jpg',
    rutaPdf: 'publicaciones/rev1.pdf',
  },
  {
    titulo: 'Colección Atelier · Mobiliario 2026',
    categoria: 'Catálogos',
    fecha: 'Febrero 2026',
    descripcion:
      'Catálogo técnico y fotográfico de piezas en aluminio cepillado, roble ahumado y luminarias de estudio.',
    rutaPortada: 'publicaciones/portadas/rev2.jpg',
    rutaPdf: 'publicaciones/rev2.pdf',
  },
  {
    titulo: 'Sistemas Tipográficos & Retícula Suiza',
    categoria: 'Revistas',
    fecha: 'Enero 2026',
    descripcion:
      'Edición especial dedicada a la composición modular, jerarquías tipográficas y producción editorial impresa.',
    rutaPortada: 'publicaciones/portadas/rev3.jpg',
    rutaPdf: 'publicaciones/rev3.pdf',
  },
  {
    titulo: 'Exposición Forma y Luz · Guía de Sala',
    categoria: 'Folletos',
    fecha: 'Diciembre 2025',
    descripcion:
      'Folleto curatorial con recorrido arquitectónico, ficha de esculturas y notas sobre el atrio de travertino.',
    rutaPortada: 'publicaciones/portadas/rev4.jpg',
    rutaPdf: 'publicaciones/rev4.pdf',
  },
];

const gridEl = document.getElementById('publications-grid') as HTMLElement;
const filtersEl = document.getElementById('category-filters') as HTMLElement;
const emptyStateEl = document.getElementById('empty-state') as HTMLElement;
const totalCountEl = document.getElementById('total-count') as HTMLElement;
const categoryCountEl = document.getElementById('category-count') as HTMLElement;
const activeFilterSummaryEl = document.getElementById('active-filter-summary') as HTMLElement;
const featuredCtaEl = document.getElementById('featured-cta') as HTMLAnchorElement;
const resetFilterBtn = document.getElementById('reset-filter-btn') as HTMLButtonElement;
const catalogPdfUploadEl = document.getElementById('catalog-pdf-upload') as HTMLInputElement | null;
const catalogSyncNoticeEl = document.getElementById('catalog-sync-notice') as HTMLElement | null;
const catalogSyncMessageEl = document.getElementById('catalog-sync-message') as HTMLElement | null;
const catalogSyncOpenLinkEl = document.getElementById('catalog-sync-open-link') as HTMLAnchorElement | null;
const catalogSyncUndoBtn = document.getElementById('catalog-sync-undo-btn') as HTMLButtonElement | null;
const catalogSyncCloseBtn = document.getElementById('catalog-sync-close-btn') as HTMLButtonElement | null;
const restoreCatalogBtn = document.getElementById('restore-catalog-btn') as HTMLButtonElement | null;
const restoreCatalogLabelEl = document.getElementById('restore-catalog-label') as HTMLElement | null;
const emptyStateMessageEl = document.getElementById('empty-state-message') as HTMLElement | null;
const emptyRestoreBtn = document.getElementById('empty-restore-btn') as HTMLButtonElement | null;

// Delete confirmation modal
const deleteConfirmModal = document.getElementById('delete-confirm-modal') as HTMLElement | null;
const deleteModalTargetEl = document.getElementById('delete-modal-target') as HTMLElement | null;
const deleteModalDescEl = document.getElementById('delete-modal-desc') as HTMLElement | null;
const deleteModalCancelBtn = document.getElementById('delete-modal-cancel-btn') as HTMLButtonElement | null;
const deleteModalConfirmBtn = document.getElementById('delete-modal-confirm-btn') as HTMLButtonElement | null;

// Individual Auth & Delete Mode UI
const authSigninBtn = document.getElementById('auth-signin-btn') as HTMLButtonElement | null;
const authUserBadge = document.getElementById('auth-user-badge') as HTMLElement | null;
const authUserNameEl = document.getElementById('auth-user-name') as HTMLElement | null;
const authUserInitialEl = document.getElementById('auth-user-initial') as HTMLElement | null;
const authSignoutBtn = document.getElementById('auth-signout-btn') as HTMLButtonElement | null;
const deleteModeBtn = document.getElementById('delete-mode-btn') as HTMLButtonElement | null;
const deleteModeLabelEl = document.getElementById('delete-mode-label') as HTMLElement | null;
const addCloudBtn = document.getElementById('add-cloud-btn') as HTMLButtonElement | null;

// Auth gate modal
const authGateModal = document.getElementById('auth-gate-modal') as HTMLElement | null;
const authGateSigninBtn = document.getElementById('auth-gate-signin-btn') as HTMLButtonElement | null;
const authGateCancelBtn = document.getElementById('auth-gate-cancel-btn') as HTMLButtonElement | null;
const authGateErrorEl = document.getElementById('auth-gate-error') as HTMLElement | null;

// Add cloud PDF URL modal
const cloudAddModal = document.getElementById('cloud-add-modal') as HTMLElement | null;
const cloudAddForm = document.getElementById('cloud-add-form') as HTMLFormElement | null;
const cloudAddCancelBtn = document.getElementById('cloud-add-cancel-btn') as HTMLButtonElement | null;
const cloudAddErrorEl = document.getElementById('cloud-add-error') as HTMLElement | null;
const cloudTitleInput = document.getElementById('cloud-pub-title') as HTMLInputElement | null;
const cloudCategoryInput = document.getElementById('cloud-pub-category') as HTMLInputElement | null;
const cloudDateInput = document.getElementById('cloud-pub-date') as HTMLInputElement | null;
const cloudPdfUrlInput = document.getElementById('cloud-pub-pdf-url') as HTMLInputElement | null;
const cloudCoverUrlInput = document.getElementById('cloud-pub-cover-url') as HTMLInputElement | null;
const cloudDescInput = document.getElementById('cloud-pub-desc') as HTMLTextAreaElement | null;

// Catalog Share modal
const catalogShareModal = document.getElementById('catalog-share-modal') as HTMLElement | null;
const catalogShareItemTitleEl = document.getElementById('catalog-share-item-title') as HTMLElement | null;
const catalogShareReadonlyBadge = document.getElementById('catalog-share-readonly-badge') as HTMLElement | null;
const catalogSharePublishBox = document.getElementById('catalog-share-publish-box') as HTMLElement | null;
const catalogShareProgress = document.getElementById('catalog-share-progress') as HTMLElement | null;
const catalogShareStatus = document.getElementById('catalog-share-status') as HTMLElement | null;
const catalogSharePct = document.getElementById('catalog-share-pct') as HTMLElement | null;
const catalogShareBar = document.getElementById('catalog-share-bar') as HTMLElement | null;
const catalogShareError = document.getElementById('catalog-share-error') as HTMLElement | null;
const catalogSharePublishBtn = document.getElementById('catalog-share-publish-btn') as HTMLButtonElement | null;
const catalogSharePublishBtnLabel = document.getElementById('catalog-share-publish-btn-label') as HTMLElement | null;
const catalogShareUrlInput = document.getElementById('catalog-share-url-input') as HTMLInputElement | null;
const catalogShareCopyBtn = document.getElementById('catalog-share-copy-btn') as HTMLButtonElement | null;
const catalogShareNativeBtn = document.getElementById('catalog-share-native-btn') as HTMLButtonElement | null;
const catalogShareWhatsappBtn = document.getElementById('catalog-share-whatsapp-btn') as HTMLAnchorElement | null;
const catalogShareTwitterBtn = document.getElementById('catalog-share-twitter-btn') as HTMLAnchorElement | null;
const catalogShareEmailBtn = document.getElementById('catalog-share-email-btn') as HTMLAnchorElement | null;
const catalogShareCloseX = document.getElementById('catalog-share-close-x') as HTMLButtonElement | null;
const catalogShareCloseBtn = document.getElementById('catalog-share-close-btn') as HTMLButtonElement | null;

const LOCAL_DB_NAME = 'flipbook_local_library_v1';
const LOCAL_DB_VERSION = 1;
const LOCAL_STORE_NAME = 'publications';
const ACTIVE_LOCAL_ID_KEY = 'flipbook_active_local_id';
const REMOVED_CATALOG_KEY = 'flipbook_removed_catalog_v1';
const LOCAL_CATEGORY_LABEL = 'Mis PDFs';

let localPublications: LocalPublication[] = [];
let cloudPublications: CloudPublicationItem[] = [];
let cloudHiddenKeys: string[] | null = null;
let currentUser: User | null = auth.currentUser || null;
let unsubscribeUserCatalog: (() => void) | null = null;
let isDeleteModeUnlocked = false;
let pendingUnlockAfterAuth = false;

let activeCategory = 'Todas';
let activeSyncPromise: Promise<void> | null = null;
let pendingDeleteItem: CatalogItem | null = null;
let lastUndoKey: string | null = null;
let activeShareTarget: CatalogItem | null = null;
let currentCatalogShareUrl = '';
let isPublishingCatalogShare = false;

function notifyLocalLibraryChanged(action: string, id?: string): void {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel('flipbook_local_library_sync');
      ch.postMessage({ action, id: id || null, ts: Date.now() });
      ch.close();
    }
  } catch {
    // Ignorar si BroadcastChannel no está soportado
  }
}

function openLocalLibraryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible'));
      return;
    }
    const req = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOCAL_STORE_NAME)) {
        db.createObjectStore(LOCAL_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Error al abrir IndexedDB'));
  });
}

async function getAllLocalPublications(): Promise<LocalPublication[]> {
  try {
    const db = await openLocalLibraryDb();
    return await new Promise((resolve, reject) => {
      let list: LocalPublication[] = [];
      const tx = db.transaction(LOCAL_STORE_NAME, 'readonly');
      const store = tx.objectStore(LOCAL_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const raw = Array.isArray(req.result) ? req.result : [];
        list = raw
          .filter((item): item is LocalPublication => Boolean(item && item.id && item.pdfData))
          .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => {
        db.close();
        resolve(list);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error('Transacción abortada'));
      };
    });
  } catch {
    return [];
  }
}

async function saveLocalPdfToLibrary(file: File, pdfData: ArrayBuffer): Promise<LocalPublication | null> {
  try {
    const existing = await getAllLocalPublications();
    const matched = existing.find(
      (item) => item.fileName === file.name && item.fileSize === file.size
    );
    const now = Date.now();
    const title =
      (file.name || '')
        .trim()
        .replace(/\.pdf$/i, '')
        .replace(/[_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Publicación PDF';

    let fecha = 'Reciente';
    try {
      const fmt = new Date(now)
        .toLocaleDateString('es-ES', {
          month: 'long',
          year: 'numeric',
        })
        .replace(/\s+de\s+/i, ' ')
        .trim();
      fecha = fmt.charAt(0).toUpperCase() + fmt.slice(1);
    } catch {
      fecha = 'Reciente';
    }

    const mb = file.size / (1024 * 1024);
    const sizeText =
      mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;

    const record: LocalPublication = {
      id: matched ? matched.id : `local-${now}-${Math.random().toString(36).slice(2, 7)}`,
      titulo: title,
      fileName: file.name,
      fileSize: file.size,
      categoria: LOCAL_CATEGORY_LABEL,
      fecha,
      descripcion: matched?.descripcion || `PDF cargado localmente · ${sizeText}`,
      pageCount: matched?.pageCount ?? null,
      coverDataUrl: matched?.coverDataUrl ?? null,
      pdfData,
      addedAt: now,
      sharedId: matched?.sharedId ?? null,
    };

    const db = await openLocalLibraryDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE_NAME, 'readwrite');
      const store = tx.objectStore(LOCAL_STORE_NAME);
      const req = store.put(record);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error('Transacción de guardado abortada'));
      };
    });

    try {
      localStorage.setItem(ACTIVE_LOCAL_ID_KEY, record.id);
    } catch {
      // Ignorar
    }
    notifyLocalLibraryChanged('save', record.id);
    return record;
  } catch (err) {
    console.error('Error guardando PDF en IndexedDB:', err);
    return null;
  }
}

async function deleteLocalPublication(id: string): Promise<void> {
  if (!id) return;
  try {
    const db = await openLocalLibraryDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE_NAME, 'readwrite');
      const store = tx.objectStore(LOCAL_STORE_NAME);
      const req = store.delete(id);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error('Transacción de eliminación abortada'));
      };
    });
    try {
      if (localStorage.getItem(ACTIVE_LOCAL_ID_KEY) === id) {
        localStorage.removeItem(ACTIVE_LOCAL_ID_KEY);
      }
    } catch {
      // Ignorar
    }
    notifyLocalLibraryChanged('delete', id);
  } catch {
    // Ignorar
  }
}

async function updateLocalSharedId(id: string, sharedId: string | null): Promise<void> {
  if (!id) return;
  try {
    const db = await openLocalLibraryDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE_NAME, 'readwrite');
      const store = tx.objectStore(LOCAL_STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result as LocalPublication | undefined;
        if (!record) return;
        record.sharedId = sharedId;
        store.put(record);
      };
      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error('Transacción abortada'));
      };
    });
    localPublications = localPublications.map((p) => (p.id === id ? { ...p, sharedId } : p));
    notifyLocalLibraryChanged('update', id);
  } catch {
    // Ignorar
  }
}

function getBuiltinCatalogKey(item: BuiltinPublication | CatalogItem): string {
  return String(('rutaPdf' in item && item.rutaPdf) || item.titulo || '').trim();
}

function getLocalRemovedCatalogKeys(): string[] {
  try {
    const raw = localStorage.getItem(REMOVED_CATALOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function getRemovedCatalogKeys(): string[] {
  if (currentUser && cloudHiddenKeys !== null) {
    return cloudHiddenKeys;
  }
  return getLocalRemovedCatalogKeys();
}

async function saveRemovedCatalogKeys(keys: string[]): Promise<void> {
  const normalized = Array.from(new Set(keys.filter((k) => typeof k === 'string' && k.trim().length > 0))).slice(
    0,
    BLUEPRINT_LIMITS.hiddenKeysMax
  );
  try {
    if (normalized.length === 0) {
      localStorage.removeItem(REMOVED_CATALOG_KEY);
    } else {
      localStorage.setItem(REMOVED_CATALOG_KEY, JSON.stringify(normalized));
    }
  } catch {
    // Ignorar
  }
  if (currentUser) {
    cloudHiddenKeys = normalized;
    await saveHiddenBuiltinKeysToCloud(currentUser.uid, normalized);
  }
}

async function hideBuiltinPublication(key: string): Promise<void> {
  if (!key) return;
  const current = getRemovedCatalogKeys();
  if (!current.includes(key)) {
    await saveRemovedCatalogKeys([...current, key]);
  }
}

async function restoreBuiltinPublication(key: string): Promise<void> {
  if (!key) return;
  const next = getRemovedCatalogKeys().filter((k) => k !== key);
  await saveRemovedCatalogKeys(next);
}

async function restoreAllBuiltinPublications(): Promise<void> {
  await saveRemovedCatalogKeys([]);
}

function getCatalogPublications(): CatalogItem[] {
  const removedKeys = new Set(getRemovedCatalogKeys());
  const localMapped = localPublications.map((item) => ({
    ...item,
    isLocal: true as const,
    rutaPortada: item.coverDataUrl || '',
  }));
  const activeBuiltin = PUBLICACIONES.filter(
    (item) => !removedKeys.has(getBuiltinCatalogKey(item))
  );
  return [...cloudPublications, ...localMapped, ...activeBuiltin];
}

function buildViewerUrl(item: CatalogItem): string {
  if ('isLocal' in item && item.isLocal && item.id) {
    if (item.sharedId) {
      return `visor.html?share=${encodeURIComponent(item.sharedId)}`;
    }
    const params = new URLSearchParams({
      local: item.id,
      title: item.titulo || item.fileName || 'Publicación local',
    });
    return `visor.html?${params.toString()}`;
  }
  const params = new URLSearchParams({
    doc: item.rutaPdf || '',
    title: item.titulo,
  });
  return `visor.html?${params.toString()}`;
}

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createFallbackCoverSvg(item: CatalogItem): string {
  const safeTitle = escapeXml((item.titulo || 'Publicación PDF').slice(0, 48));
  const safeCategory = escapeXml(item.categoria || 'PDF');
  const safeDate = escapeXml(item.fecha || '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800">
    <rect width="600" height="800" fill="#18181b"/>
    <rect x="36" y="36" width="528" height="728" fill="none" stroke="#3f3f46" stroke-width="2"/>
    <rect x="36" y="36" width="84" height="6" fill="#f59e0b"/>
    <text x="64" y="110" fill="#f59e0b" font-family="sans-serif" font-size="22" font-weight="600">${safeCategory}</text>
    <text x="64" y="210" fill="#f4f4f5" font-family="Georgia, serif" font-size="36" font-weight="600">
      <tspan x="64" dy="0">${safeTitle.slice(0, 24)}</tspan>
      <tspan x="64" dy="48">${safeTitle.slice(24, 48)}</tspan>
    </text>
    <text x="64" y="716" fill="#a1a1aa" font-family="sans-serif" font-size="20">${safeDate}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function getUniqueCategories(items: CatalogItem[]): string[] {
  const seen = new Set<string>();
  const cats: string[] = [];
  for (const item of items) {
    if (item.categoria && !seen.has(item.categoria)) {
      seen.add(item.categoria);
      cats.push(item.categoria);
    }
  }
  return cats;
}

function canUseDeleteMode(): boolean {
  return Boolean(currentUser && isDeleteModeUnlocked);
}

function updateAuthAndModeUi(): void {
  const signedIn = Boolean(currentUser);

  if (authSigninBtn) {
    authSigninBtn.classList.toggle('hidden', signedIn);
    authSigninBtn.classList.toggle('inline-flex', !signedIn);
  }

  if (authUserBadge) {
    authUserBadge.classList.toggle('hidden', !signedIn);
    authUserBadge.classList.toggle('inline-flex', signedIn);
  }

  if (signedIn && currentUser) {
    const label = currentUser.displayName || currentUser.email || 'Usuario';
    if (authUserNameEl) {
      authUserNameEl.textContent = label.split(' ')[0];
      authUserNameEl.title = currentUser.email || label;
    }
    if (authUserInitialEl) {
      authUserInitialEl.textContent = label.charAt(0).toUpperCase();
    }
  }

  if (addCloudBtn) {
    addCloudBtn.classList.toggle('hidden', !signedIn);
    addCloudBtn.classList.toggle('inline-flex', signedIn);
  }

  if (deleteModeBtn && deleteModeLabelEl) {
    const unlocked = canUseDeleteMode();
    deleteModeBtn.setAttribute('aria-pressed', String(unlocked));
    deleteModeBtn.className = unlocked
      ? 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-950/70 hover:bg-red-900/80 text-red-300 border border-red-500/50 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer'
      : 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-amber-400 border border-zinc-800 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer';
    deleteModeLabelEl.textContent = unlocked ? 'Modo Borrar: Activo' : 'Modo Borrar';
    deleteModeBtn.title = unlocked
      ? 'Bloquear modo borrar y volver a solo lectura'
      : signedIn
      ? 'Desbloquear modo borrar para eliminar publicaciones de tu catálogo'
      : 'Acceso exclusivo de usuario autenticado para eliminar publicaciones';
  }
}

function renderCategoryFilters(): void {
  const allItems = getCatalogPublications();
  const availableCategories = getUniqueCategories(allItems);
  if (activeCategory !== 'Todas' && !availableCategories.includes(activeCategory)) {
    activeCategory = 'Todas';
  }

  const categories = ['Todas', ...availableCategories];
  filtersEl.innerHTML = '';

  categories.forEach((cat) => {
    const count =
      cat === 'Todas' ? allItems.length : allItems.filter((p) => p.categoria === cat).length;
    const isActive = activeCategory === cat;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.category = cat;
    btn.setAttribute('aria-pressed', String(isActive));
    btn.className = `px-3.5 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
      isActive
        ? 'bg-amber-500 text-zinc-950 font-semibold'
        : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70'
    }`;
    btn.innerHTML = `${escapeXml(cat)} <span class="ml-1 tabular-nums ${
      isActive ? 'text-zinc-900/80' : 'text-zinc-500'
    }">(${count})</span>`;

    btn.addEventListener('click', () => {
      activeCategory = cat;
      renderCategoryFilters();
      renderPublicationsGrid();
    });

    filtersEl.appendChild(btn);
  });
}

function renderPublicationsGrid(): void {
  const allItems = getCatalogPublications();
  const filtered =
    activeCategory === 'Todas'
      ? allItems
      : allItems.filter((item) => item.categoria === activeCategory);

  activeFilterSummaryEl.textContent =
    activeCategory === 'Todas'
      ? `Mostrando ${filtered.length} publicaciones`
      : `Mostrando ${filtered.length} en ${activeCategory}`;

  gridEl.innerHTML = '';
  const showDeleteButtons = canUseDeleteMode();

  if (filtered.length === 0) {
    emptyStateEl.classList.remove('hidden');
    const removedCount = getRemovedCatalogKeys().length;
    if (allItems.length === 0) {
      if (emptyStateMessageEl) {
        emptyStateMessageEl.textContent = 'No hay publicaciones disponibles en el catálogo.';
      }
      resetFilterBtn.classList.add('hidden');
    } else {
      if (emptyStateMessageEl) {
        emptyStateMessageEl.textContent = 'No hay publicaciones registradas en esta categoría.';
      }
      resetFilterBtn.classList.remove('hidden');
    }
    if (emptyRestoreBtn) {
      emptyRestoreBtn.classList.toggle('hidden', !(currentUser && removedCount > 0));
    }
    return;
  }
  emptyStateEl.classList.add('hidden');

  filtered.forEach((item) => {
    const viewerHref = buildViewerUrl(item);
    const article = document.createElement('article');
    article.className = 'publication-card flex flex-col';
    if ('isLocal' in item && item.isLocal) {
      article.dataset.localId = item.id;
    } else if ('isCloud' in item && item.isCloud) {
      article.dataset.cloudId = item.id;
    }

    const coverLink = document.createElement('a');
    coverLink.href = viewerHref;
    coverLink.setAttribute('aria-label', `Abrir ${item.titulo} en el visor`);
    coverLink.className =
      'block book-frame aspect-[3/4] overflow-hidden bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500';

    const img = document.createElement('img');
    img.src = item.rutaPortada || createFallbackCoverSvg(item);
    img.alt = `Portada de ${item.titulo}`;
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.className = 'w-full h-full object-cover block';
    img.addEventListener('error', () => {
      if (!img.dataset.fallbackApplied) {
        img.dataset.fallbackApplied = '1';
        img.src = createFallbackCoverSvg(item);
      }
    });

    const spineCrease = document.createElement('div');
    spineCrease.className = 'book-spine-crease';

    coverLink.appendChild(img);
    coverLink.appendChild(spineCrease);

    const body = document.createElement('div');
    body.className = 'pt-4 flex-1 flex flex-col';

    const meta = document.createElement('div');
    meta.className = 'flex items-center gap-2 text-xs text-zinc-400 tabular-nums';
    meta.innerHTML = `
      <span class="text-amber-400 font-medium">${escapeXml(item.categoria)}</span>
      <span aria-hidden="true" class="text-zinc-600">·</span>
      <span>${escapeXml(item.fecha)}</span>
    `;

    const title = document.createElement('h3');
    title.className = 'mt-1.5 text-base font-semibold text-zinc-100 leading-snug';
    title.textContent = item.titulo;

    const desc = document.createElement('p');
    desc.className = 'mt-1.5 text-xs sm:text-sm text-zinc-400 leading-relaxed line-clamp-2 flex-1';
    desc.textContent = item.descripcion;

    const ctaRow = document.createElement('div');
    ctaRow.className = 'mt-4 pt-3 border-t border-zinc-800/80 flex items-center justify-between gap-2';

    const readBtn = document.createElement('a');
    readBtn.href = viewerHref;
    readBtn.className =
      'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-900 hover:bg-amber-500 text-zinc-100 hover:text-zinc-950 border border-zinc-700/80 hover:border-amber-500 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500';
    readBtn.innerHTML = `
      <span>Leer Publicación</span>
      <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"/>
      </svg>
    `;
    ctaRow.appendChild(readBtn);

    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.title = `Compartir enlace de solo lectura de ${item.titulo}`;
    shareBtn.setAttribute('aria-label', `Compartir ${item.titulo}`);
    shareBtn.className =
      'p-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-amber-400 border border-zinc-700/80 hover:border-amber-500/40 transition-colors cursor-pointer shrink-0';
    shareBtn.innerHTML = `
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
      </svg>
    `;
    shareBtn.addEventListener('click', () => {
      void openCatalogShareModal(item);
    });
    ctaRow.appendChild(shareBtn);

    if (showDeleteButtons) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.title =
        'isLocal' in item && item.isLocal
          ? 'Eliminar PDF guardado de este navegador'
          : 'isCloud' in item && item.isCloud
          ? 'Eliminar publicación de tu cuenta en Firebase'
          : 'Eliminar publicación del catálogo';
      removeBtn.setAttribute('aria-label', `Eliminar ${item.titulo} del catálogo`);
      removeBtn.className =
        'p-2.5 rounded-lg bg-zinc-900 hover:bg-red-950/60 text-zinc-400 hover:text-red-400 border border-zinc-700/80 hover:border-red-500/40 transition-colors cursor-pointer shrink-0';
      removeBtn.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
        </svg>
      `;
      removeBtn.addEventListener('click', () => {
        openDeleteModal(item);
      });
      ctaRow.appendChild(removeBtn);
    }

    body.appendChild(meta);
    body.appendChild(title);
    body.appendChild(desc);
    body.appendChild(ctaRow);

    article.appendChild(coverLink);
    article.appendChild(body);
    gridEl.appendChild(article);
  });
}

function updateCatalogCountsAndToolbar(): void {
  const allItems = getCatalogPublications();
  const uniqueCategories = getUniqueCategories(allItems);
  const removedCount = getRemovedCatalogKeys().length;

  totalCountEl.textContent = String(allItems.length);
  categoryCountEl.textContent = String(uniqueCategories.length);

  if (restoreCatalogBtn && restoreCatalogLabelEl) {
    const showRestore = Boolean(currentUser && removedCount > 0);
    restoreCatalogBtn.classList.toggle('hidden', !showRestore);
    restoreCatalogBtn.classList.toggle('inline-flex', showRestore);
    restoreCatalogLabelEl.textContent = `Restaurar catálogo (${removedCount})`;
  }

  if (allItems.length > 0) {
    const firstBuiltin = allItems.find((item) => !('isLocal' in item && item.isLocal));
    featuredCtaEl.href = buildViewerUrl(firstBuiltin || allItems[0]);
  } else {
    featuredCtaEl.href = 'visor.html';
  }

  updateAuthAndModeUi();
  renderCategoryFilters();
  renderPublicationsGrid();
}

async function syncCatalogWithIndexedDB(): Promise<void> {
  if (activeSyncPromise) {
    await activeSyncPromise;
  }
  activeSyncPromise = (async () => {
    localPublications = await getAllLocalPublications();

    try {
      const storedId = localStorage.getItem(ACTIVE_LOCAL_ID_KEY);
      if (storedId && !localPublications.some((item) => item.id === storedId)) {
        localStorage.removeItem(ACTIVE_LOCAL_ID_KEY);
      }
    } catch {
      // Ignorar
    }

    updateCatalogCountsAndToolbar();
  })();

  try {
    await activeSyncPromise;
  } finally {
    activeSyncPromise = null;
  }
}

function refreshCatalog(): Promise<void> {
  return syncCatalogWithIndexedDB();
}

function showCatalogNotice({
  message,
  openHref = null,
  undoKey = null,
}: {
  message: string;
  openHref?: string | null;
  undoKey?: string | null;
}): void {
  if (!catalogSyncNoticeEl || !catalogSyncMessageEl || !catalogSyncOpenLinkEl) return;
  lastUndoKey = undoKey;
  catalogSyncMessageEl.textContent = message;
  if (openHref) {
    catalogSyncOpenLinkEl.href = openHref;
    catalogSyncOpenLinkEl.classList.remove('hidden');
  } else {
    catalogSyncOpenLinkEl.classList.add('hidden');
  }
  if (catalogSyncUndoBtn) {
    catalogSyncUndoBtn.classList.toggle('hidden', !undoKey);
  }
  catalogSyncNoticeEl.classList.remove('hidden');
  catalogSyncNoticeEl.classList.add('flex');
}

function hideCatalogNotice(): void {
  lastUndoKey = null;
  if (!catalogSyncNoticeEl) return;
  catalogSyncNoticeEl.classList.add('hidden');
  catalogSyncNoticeEl.classList.remove('flex');
}

function openAuthGateModal(): void {
  if (!authGateModal) return;
  if (authGateErrorEl) {
    authGateErrorEl.classList.add('hidden');
    authGateErrorEl.textContent = '';
  }
  authGateModal.classList.remove('hidden');
  authGateModal.classList.add('flex');
  authGateSigninBtn?.focus();
}

function closeAuthGateModal(): void {
  if (!authGateModal) return;
  authGateModal.classList.add('hidden');
  authGateModal.classList.remove('flex');
}

function openCloudAddModal(): void {
  if (!currentUser) {
    openAuthGateModal();
    return;
  }
  if (!cloudAddModal) return;
  if (cloudAddErrorEl) {
    cloudAddErrorEl.classList.add('hidden');
    cloudAddErrorEl.textContent = '';
  }
  cloudAddModal.classList.remove('hidden');
  cloudAddModal.classList.add('flex');
  cloudTitleInput?.focus();
}

function closeCloudAddModal(): void {
  if (!cloudAddModal) return;
  cloudAddModal.classList.add('hidden');
  cloudAddModal.classList.remove('flex');
  cloudAddForm?.reset();
}

function openDeleteModal(item: CatalogItem): void {
  if (!canUseDeleteMode()) {
    openAuthGateModal();
    return;
  }
  if (!deleteConfirmModal || !item) return;
  pendingDeleteItem = item;
  if (deleteModalTargetEl) {
    deleteModalTargetEl.textContent = item.titulo || 'Publicación';
  }
  if (deleteModalDescEl) {
    if ('isLocal' in item && item.isLocal) {
      deleteModalDescEl.textContent =
        'Este PDF se eliminará de tu biblioteca local en este navegador. Si quieres volver a leerlo luego, deberás subirlo nuevamente.';
    } else if ('isCloud' in item && item.isCloud) {
      deleteModalDescEl.textContent =
        'Esta publicación se eliminará permanentemente de tu cuenta en Firebase Firestore.';
    } else {
      deleteModalDescEl.textContent =
        'Esta publicación se retirará de tu catálogo personal sincronizado en Firebase. Podrás restaurarla cuando quieras con «Restaurar catálogo».';
    }
  }
  deleteConfirmModal.classList.remove('hidden');
  deleteConfirmModal.classList.add('flex');
  deleteModalCancelBtn?.focus();
}

function closeDeleteModal(): void {
  pendingDeleteItem = null;
  if (deleteConfirmModal) {
    deleteConfirmModal.classList.add('hidden');
    deleteConfirmModal.classList.remove('flex');
  }
}

async function executeControlledDeletion(): Promise<void> {
  const target = pendingDeleteItem;
  closeDeleteModal();
  if (!target || !canUseDeleteMode() || !currentUser) return;

  if ('isLocal' in target && target.isLocal) {
    if (target.sharedId) {
      void deleteSharedPublicationFromCloud(target.sharedId);
    }
    await deleteLocalPublication(target.id);
    await refreshCatalog();
    showCatalogNotice({
      message: `«${target.titulo}» eliminada de tu biblioteca local.`,
    });
  } else if ('isCloud' in target && target.isCloud) {
    await deleteCloudPublication(currentUser.uid, target.id);
    await refreshCatalog();
    showCatalogNotice({
      message: `«${target.titulo}» eliminada de tu cuenta en Firebase.`,
    });
  } else {
    const key = getBuiltinCatalogKey(target);
    await hideBuiltinPublication(key);
    await refreshCatalog();
    showCatalogNotice({
      message: `«${target.titulo}» eliminada de tu catálogo personal.`,
      undoKey: key,
    });
  }
}

function updateCatalogShareUi(item: CatalogItem): void {
  const title = item.titulo || 'Publicación Editorial';
  let url = '';
  let needsPublish = false;

  if ('isLocal' in item && item.isLocal) {
    if (item.sharedId) {
      url = buildCanonicalShareLink(item.sharedId);
    } else {
      needsPublish = true;
    }
  } else {
    url = new URL(buildViewerUrl(item), window.location.href).toString();
  }

  currentCatalogShareUrl = url;
  const hasUrl = Boolean(url);

  if (catalogShareItemTitleEl) catalogShareItemTitleEl.textContent = title;
  if (catalogShareReadonlyBadge) catalogShareReadonlyBadge.classList.toggle('hidden', !hasUrl);
  if (catalogSharePublishBox) catalogSharePublishBox.classList.toggle('hidden', !needsPublish);
  if (catalogShareUrlInput) {
    catalogShareUrlInput.value = url;
    catalogShareUrlInput.placeholder = needsPublish ? 'Genera el enlace arriba para copiarlo' : '';
  }
  if (catalogShareCopyBtn) {
    catalogShareCopyBtn.disabled = !hasUrl;
  }
  if (catalogSharePublishBtn && catalogSharePublishBtnLabel) {
    catalogSharePublishBtn.disabled = isPublishingCatalogShare;
    catalogSharePublishBtnLabel.textContent = isPublishingCatalogShare
      ? 'Generando enlace...'
      : currentUser
        ? 'Generar enlace público de lectura'
        : 'Conectar con Google y generar enlace';
  }

  const updateSocial = (el: HTMLAnchorElement | null, href: string) => {
    if (!el) return;
    if (hasUrl) {
      el.href = href;
      el.removeAttribute('aria-disabled');
      el.classList.remove('opacity-40', 'pointer-events-none');
    } else {
      el.href = '#';
      el.setAttribute('aria-disabled', 'true');
      el.classList.add('opacity-40', 'pointer-events-none');
    }
  };

  updateSocial(
    catalogShareWhatsappBtn,
    `https://api.whatsapp.com/send?text=${encodeURIComponent(`¡Hola! Te comparto esta publicación interactiva: ${title} - ${url}`)}`
  );
  updateSocial(
    catalogShareTwitterBtn,
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(`Explora esta publicación digital: ${title}`)}&url=${encodeURIComponent(url)}`
  );
  updateSocial(
    catalogShareEmailBtn,
    `mailto:?subject=${encodeURIComponent(`Publicación: ${title}`)}&body=${encodeURIComponent(`Hola,\n\nTe comparto este enlace de solo lectura para ver la publicación interactiva:\n\n${url}`)}`
  );

  if (catalogShareNativeBtn) {
    catalogShareNativeBtn.classList.toggle('hidden', !(typeof navigator.share === 'function' && hasUrl));
  }
}

async function publishLocalCatalogItemToShare(item: CatalogItem): Promise<void> {
  if (!('isLocal' in item && item.isLocal) || isPublishingCatalogShare) return;
  if (!isFirebaseReady()) {
    if (catalogShareError) {
      catalogShareError.textContent = 'Firebase no está configurado en esta instancia.';
      catalogShareError.classList.remove('hidden');
    }
    return;
  }

  if (catalogShareError) {
    catalogShareError.classList.add('hidden');
    catalogShareError.textContent = '';
  }

  try {
    if (!currentUser) {
      const user = await signInIndividualUser();
      if (!user) return;
      currentUser = user;
    }

    isPublishingCatalogShare = true;
    updateCatalogShareUi(item);
    if (catalogShareProgress) catalogShareProgress.classList.remove('hidden');
    if (catalogShareStatus) catalogShareStatus.textContent = 'Preparando documento...';
    if (catalogSharePct) catalogSharePct.textContent = '5%';
    if (catalogShareBar) catalogShareBar.style.width = '5%';

    const bytes = new Uint8Array(item.pdfData);
    const shareId = await publishPdfBytesToCloudShare({
      titulo: item.titulo || item.fileName || 'Publicación PDF',
      bytes,
      onProgress: (done, total) => {
        const pct = Math.max(8, Math.min(100, Math.round((done / Math.max(1, total)) * 100)));
        if (catalogShareStatus) {
          catalogShareStatus.textContent = `Publicando enlace de lectura (${done}/${total})...`;
        }
        if (catalogSharePct) catalogSharePct.textContent = `${pct}%`;
        if (catalogShareBar) catalogShareBar.style.width = `${pct}%`;
      },
    });

    item.sharedId = shareId;
    await updateLocalSharedId(item.id, shareId);
    if (catalogShareProgress) catalogShareProgress.classList.add('hidden');
    if (activeShareTarget && 'isLocal' in activeShareTarget && activeShareTarget.isLocal && activeShareTarget.id === item.id) {
      activeShareTarget.sharedId = shareId;
      updateCatalogShareUi(activeShareTarget);
    }
  } catch (err) {
    if (catalogShareProgress) catalogShareProgress.classList.add('hidden');
    if (catalogShareError) {
      catalogShareError.textContent =
        err instanceof Error && err.message
          ? err.message
          : 'No se pudo generar el enlace público. Verifica tu sesión e intenta nuevamente.';
      catalogShareError.classList.remove('hidden');
    }
  } finally {
    isPublishingCatalogShare = false;
    if (activeShareTarget) {
      updateCatalogShareUi(activeShareTarget);
    }
  }
}

async function openCatalogShareModal(item: CatalogItem): Promise<void> {
  if (!catalogShareModal) return;
  activeShareTarget = item;
  if (catalogShareError) {
    catalogShareError.classList.add('hidden');
    catalogShareError.textContent = '';
  }
  if (catalogShareProgress) {
    catalogShareProgress.classList.add('hidden');
  }

  if ('isLocal' in item && item.isLocal && item.sharedId) {
    const exists = await verifySharedPublicationExists(item.sharedId);
    if (!exists) {
      item.sharedId = null;
      await updateLocalSharedId(item.id, null);
    }
  }

  updateCatalogShareUi(item);
  catalogShareModal.classList.remove('hidden');
  catalogShareModal.classList.add('flex');

  if ('isLocal' in item && item.isLocal && !item.sharedId && currentUser && isFirebaseReady()) {
    void publishLocalCatalogItemToShare(item);
  }
}

function closeCatalogShareModal(): void {
  activeShareTarget = null;
  if (!catalogShareModal) return;
  catalogShareModal.classList.add('hidden');
  catalogShareModal.classList.remove('flex');
}

async function handleSignInFlow(): Promise<void> {
  if (!isFirebaseReady()) {
    if (authGateErrorEl) {
      authGateErrorEl.textContent =
        'Firebase aún no está configurado en firebase-applet-config.json.';
      authGateErrorEl.classList.remove('hidden');
    }
    return;
  }
  try {
    const user = await signInIndividualUser();
    if (user) {
      closeAuthGateModal();
      showCatalogNotice({
        message: `Sesión iniciada como ${user.displayName || user.email}. Modo Lectura activo; pulsa «Modo Borrar» cuando desees gestionar publicaciones.`,
      });
    }
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'No se pudo iniciar sesión con Google.';
    if (authGateErrorEl) {
      authGateErrorEl.textContent = msg;
      authGateErrorEl.classList.remove('hidden');
    } else {
      showCatalogNotice({ message: msg });
    }
  }
}

// Auth state listener
subscribeToAuth((user) => {
  currentUser = user;
  if (unsubscribeUserCatalog) {
    unsubscribeUserCatalog();
    unsubscribeUserCatalog = null;
  }

  if (!user) {
    cloudPublications = [];
    cloudHiddenKeys = null;
    isDeleteModeUnlocked = false;
    pendingUnlockAfterAuth = false;
    updateCatalogCountsAndToolbar();
    return;
  }

  if (pendingUnlockAfterAuth) {
    isDeleteModeUnlocked = true;
    pendingUnlockAfterAuth = false;
  }

  unsubscribeUserCatalog = subscribeToUserCatalog(user.uid, {
    onPublications: (items) => {
      cloudPublications = items;
      updateCatalogCountsAndToolbar();
    },
    onHiddenKeys: (keys) => {
      cloudHiddenKeys = keys;
      updateCatalogCountsAndToolbar();
    },
    onError: (err) => {
      showCatalogNotice({
        message: `Error de sincronización con Firestore: ${err.message}`,
      });
    },
  });

  updateCatalogCountsAndToolbar();
});

// Event listeners
authSigninBtn?.addEventListener('click', () => {
  void handleSignInFlow();
});

authGateSigninBtn?.addEventListener('click', () => {
  pendingUnlockAfterAuth = true;
  void handleSignInFlow();
});

authGateCancelBtn?.addEventListener('click', () => {
  pendingUnlockAfterAuth = false;
  closeAuthGateModal();
});

authGateModal?.addEventListener('click', (e) => {
  if (e.target === authGateModal) {
    pendingUnlockAfterAuth = false;
    closeAuthGateModal();
  }
});

authSignoutBtn?.addEventListener('click', async () => {
  isDeleteModeUnlocked = false;
  await signOutIndividualUser();
  hideCatalogNotice();
  showCatalogNotice({
    message: 'Sesión cerrada. El catálogo volvió al Modo Lectura protegido.',
  });
});

deleteModeBtn?.addEventListener('click', () => {
  if (!currentUser) {
    pendingUnlockAfterAuth = true;
    openAuthGateModal();
    return;
  }
  isDeleteModeUnlocked = !isDeleteModeUnlocked;
  updateCatalogCountsAndToolbar();
  showCatalogNotice({
    message: isDeleteModeUnlocked
      ? 'Modo Borrar activado para tu cuenta. Ya puedes eliminar publicaciones de forma controlada.'
      : 'Modo Borrar bloqueado. Catálogo protegido en solo lectura.',
  });
});

addCloudBtn?.addEventListener('click', openCloudAddModal);
cloudAddCancelBtn?.addEventListener('click', closeCloudAddModal);
cloudAddModal?.addEventListener('click', (e) => {
  if (e.target === cloudAddModal) closeCloudAddModal();
});

cloudAddForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) {
    closeCloudAddModal();
    openAuthGateModal();
    return;
  }
  if (cloudAddErrorEl) {
    cloudAddErrorEl.classList.add('hidden');
    cloudAddErrorEl.textContent = '';
  }
  try {
    const title = cloudTitleInput?.value || '';
    const category = cloudCategoryInput?.value || 'Revistas';
    const date = cloudDateInput?.value || 'Reciente';
    const pdfUrl = cloudPdfUrlInput?.value || '';
    const coverUrl = cloudCoverUrlInput?.value || '';
    const desc = cloudDescInput?.value || '';
    await addCloudPublication(currentUser.uid, {
      titulo: title,
      categoria: category,
      fecha: date,
      rutaPdf: pdfUrl,
      rutaPortada: coverUrl,
      descripcion: desc,
    });
    closeCloudAddModal();
    showCatalogNotice({
      message: `«${title.trim()}» agregada a tu catálogo personal en Firebase.`,
    });
  } catch (err) {
    if (cloudAddErrorEl) {
      cloudAddErrorEl.textContent =
        err instanceof Error ? err.message : 'Error guardando publicación.';
      cloudAddErrorEl.classList.remove('hidden');
    }
  }
});

deleteModalCancelBtn?.addEventListener('click', closeDeleteModal);
deleteModalConfirmBtn?.addEventListener('click', () => {
  void executeControlledDeletion();
});
deleteConfirmModal?.addEventListener('click', (e) => {
  if (e.target === deleteConfirmModal) closeDeleteModal();
});

catalogSharePublishBtn?.addEventListener('click', () => {
  if (activeShareTarget) {
    void publishLocalCatalogItemToShare(activeShareTarget);
  }
});
catalogShareCopyBtn?.addEventListener('click', async () => {
  if (!currentCatalogShareUrl) return;
  try {
    await navigator.clipboard.writeText(currentCatalogShareUrl);
    const span = catalogShareCopyBtn.querySelector('span');
    if (span) {
      const prev = span.textContent;
      span.textContent = '¡Copiado!';
      setTimeout(() => {
        span.textContent = prev;
      }, 2000);
    }
  } catch {
    if (catalogShareUrlInput) {
      catalogShareUrlInput.select();
      document.execCommand('copy');
    }
  }
});
catalogShareNativeBtn?.addEventListener('click', async () => {
  if (typeof navigator.share === 'function' && currentCatalogShareUrl && activeShareTarget) {
    try {
      await navigator.share({
        title: activeShareTarget.titulo || 'Publicación Editorial',
        text: 'Explora esta publicación interactiva',
        url: currentCatalogShareUrl,
      });
    } catch {
      // Ignorar cancelación
    }
  }
});
[catalogShareWhatsappBtn, catalogShareTwitterBtn, catalogShareEmailBtn].forEach((el) => {
  el?.addEventListener('click', (e) => {
    if (!currentCatalogShareUrl) e.preventDefault();
  });
});
catalogShareCloseX?.addEventListener('click', closeCatalogShareModal);
catalogShareCloseBtn?.addEventListener('click', closeCatalogShareModal);
catalogShareModal?.addEventListener('click', (e) => {
  if (e.target === catalogShareModal) closeCatalogShareModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (deleteConfirmModal && !deleteConfirmModal.classList.contains('hidden')) {
    closeDeleteModal();
  }
  if (authGateModal && !authGateModal.classList.contains('hidden')) {
    pendingUnlockAfterAuth = false;
    closeAuthGateModal();
  }
  if (cloudAddModal && !cloudAddModal.classList.contains('hidden')) {
    closeCloudAddModal();
  }
  if (catalogShareModal && !catalogShareModal.classList.contains('hidden')) {
    closeCatalogShareModal();
  }
});

catalogSyncUndoBtn?.addEventListener('click', async () => {
  if (!lastUndoKey) return;
  await restoreBuiltinPublication(lastUndoKey);
  hideCatalogNotice();
  await refreshCatalog();
});

restoreCatalogBtn?.addEventListener('click', async () => {
  await restoreAllBuiltinPublications();
  hideCatalogNotice();
  await refreshCatalog();
});

emptyRestoreBtn?.addEventListener('click', async () => {
  await restoreAllBuiltinPublications();
  activeCategory = 'Todas';
  hideCatalogNotice();
  await refreshCatalog();
});

catalogSyncCloseBtn?.addEventListener('click', () => {
  hideCatalogNotice();
});

catalogPdfUploadEl?.addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files && input.files[0];
  if (!file) {
    input.value = '';
    return;
  }
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    input.value = '';
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    const saved = await saveLocalPdfToLibrary(file, buffer);
    let publishWarning = '';
    if (saved && saved.id && !saved.sharedId && currentUser && isFirebaseReady()) {
      if (buffer.byteLength <= MAX_SHARED_PDF_BYTES) {
        try {
          const shareId = await publishPdfBytesToCloudShare({
            titulo: saved.titulo,
            bytes: new Uint8Array(buffer),
          });
          saved.sharedId = shareId;
          await updateLocalSharedId(saved.id, shareId);
        } catch (pubErr) {
          publishWarning =
            pubErr instanceof Error && pubErr.message
              ? ` (${pubErr.message})`
              : ' (no se pudo publicar el enlace en la nube automáticamente; intenta desde el botón Compartir)';
        }
      } else {
        publishWarning = ' (supera los 20 MB para enlace directo; usa Enlace PDF con HTTPS)';
      }
    }
    await syncCatalogWithIndexedDB();
    if (saved && saved.id) {
      showCatalogNotice({
        message: saved.sharedId
          ? `«${saved.titulo}» guardado y publicado: listo para compartir con enlace de solo lectura.`
          : `«${saved.titulo}» guardado solo en este navegador${publishWarning || '. Pulsa el ícono Compartir en la tarjeta para generar el enlace público'}.`,
        openHref: saved.sharedId
          ? `visor.html?share=${encodeURIComponent(saved.sharedId)}`
          : `visor.html?local=${encodeURIComponent(saved.id)}`,
      });
    }
  } finally {
    input.value = '';
  }
});

resetFilterBtn.addEventListener('click', () => {
  activeCategory = 'Todas';
  renderCategoryFilters();
  renderPublicationsGrid();
});

try {
  if (typeof BroadcastChannel !== 'undefined') {
    const syncChannel = new BroadcastChannel('flipbook_local_library_sync');
    syncChannel.addEventListener('message', () => {
      void syncCatalogWithIndexedDB();
    });
  }
} catch {
  // Ignorar
}

window.addEventListener('DOMContentLoaded', async () => {
  const redirectedUser = await handleRedirectResult();
  if (redirectedUser) {
    currentUser = redirectedUser;
    updateAuthAndModeUi();
  }
  void syncCatalogWithIndexedDB();
});

window.addEventListener('pageshow', () => {
  void syncCatalogWithIndexedDB();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void syncCatalogWithIndexedDB();
  }
});
