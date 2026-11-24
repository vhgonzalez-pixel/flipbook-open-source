export interface LocalPublicationRecord {
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

export interface LocalPublicationSummary {
  id: string;
  titulo: string;
  fileName: string;
  fileSize: number;
  categoria: string;
  fecha: string;
  descripcion: string;
  pageCount: number | null;
  coverDataUrl: string | null;
  addedAt: number;
}

export const LOCAL_DB_NAME = 'flipbook_local_library_v1';
export const LOCAL_DB_VERSION = 1;
export const LOCAL_STORE_NAME = 'publications';
export const ACTIVE_LOCAL_ID_STORAGE_KEY = 'flipbook_active_local_id';
export const LOCAL_CATEGORY_LABEL = 'Mis PDFs';

export function formatPublicationTitleFromFilename(fileName: string): string {
  const cleaned = String(fileName || '')
    .trim()
    .replace(/\.pdf$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Publicación PDF';
}

export function formatSpanishMonthYear(timestamp: number): string {
  try {
    const formatted = new Date(timestamp).toLocaleDateString('es-ES', {
      month: 'long',
      year: 'numeric',
    });
    const clean = formatted.replace(/\s+de\s+/i, ' ').trim();
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  } catch {
    return 'Reciente';
  }
}

export function buildLocalPublicationDescription(
  pageCount: number | null,
  fileSize?: number
): string {
  if (typeof pageCount === 'number' && pageCount > 0) {
    return `PDF cargado localmente · ${pageCount} página${pageCount === 1 ? '' : 's'}`;
  }
  if (typeof fileSize === 'number' && fileSize > 0) {
    const mb = fileSize / (1024 * 1024);
    const sizeText = mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(fileSize / 1024))} KB`;
    return `PDF cargado localmente · ${sizeText}`;
  }
  return 'Publicación PDF cargada localmente.';
}

export function parseLocalQueryParam(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const raw = params.get('local')?.trim() ?? '';
  return raw || null;
}

export function generateLocalPublicationId(now = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 7);
  return `local-${now}-${rand}`;
}

function openLocalLibraryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no está disponible en este navegador.'));
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
    req.onerror = () => reject(req.error || new Error('No se pudo abrir IndexedDB.'));
  });
}

function notifyLocalLibraryChanged(action: 'save' | 'update' | 'delete', id?: string): void {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const ch = new BroadcastChannel('flipbook_local_library_sync');
      ch.postMessage({ action, id: id ?? null, ts: Date.now() });
      ch.close();
    }
  } catch {
    // Ignorar si BroadcastChannel no está soportado
  }
}

export function createPdfBlobFromRecord(record: LocalPublicationRecord): Blob | null {
  if (!record || !record.pdfData) return null;
  if (record.pdfData instanceof Blob) {
    return record.pdfData.type === 'application/pdf'
      ? record.pdfData
      : new Blob([record.pdfData], { type: 'application/pdf' });
  }
  return new Blob([record.pdfData], { type: 'application/pdf' });
}

export async function getAllLocalPublications(): Promise<LocalPublicationRecord[]> {
  try {
    const db = await openLocalLibraryDb();
    return await new Promise((resolve, reject) => {
      let items: LocalPublicationRecord[] = [];
      const tx = db.transaction(LOCAL_STORE_NAME, 'readonly');
      const store = tx.objectStore(LOCAL_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const raw = Array.isArray(req.result) ? (req.result as LocalPublicationRecord[]) : [];
        items = raw
          .filter((item) => Boolean(item && item.id && item.pdfData))
          .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => {
        db.close();
        resolve(items);
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

export async function getLocalPublicationById(
  id: string
): Promise<LocalPublicationRecord | null> {
  if (!id) return null;
  try {
    const db = await openLocalLibraryDb();
    return await new Promise((resolve, reject) => {
      let found: LocalPublicationRecord | null = null;
      const tx = db.transaction(LOCAL_STORE_NAME, 'readonly');
      const store = tx.objectStore(LOCAL_STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        const result = req.result as LocalPublicationRecord | undefined;
        found = result && result.id && result.pdfData ? result : null;
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => {
        db.close();
        resolve(found);
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
    return null;
  }
}

export async function saveLocalPdfToLibrary(
  file: { name: string; size: number },
  pdfData: ArrayBuffer
): Promise<LocalPublicationRecord | null> {
  try {
    const existing = await getAllLocalPublications();
    const matched = existing.find(
      (item) => item.fileName === file.name && item.fileSize === file.size
    );
    const now = Date.now();
    const record: LocalPublicationRecord = {
      id: matched ? matched.id : generateLocalPublicationId(now),
      titulo: formatPublicationTitleFromFilename(file.name),
      fileName: file.name,
      fileSize: file.size,
      categoria: LOCAL_CATEGORY_LABEL,
      fecha: formatSpanishMonthYear(now),
      descripcion:
        matched?.descripcion ||
        buildLocalPublicationDescription(matched?.pageCount ?? null, file.size),
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
      localStorage.setItem(ACTIVE_LOCAL_ID_STORAGE_KEY, record.id);
    } catch {
      // Ignorar si localStorage no está disponible
    }
    notifyLocalLibraryChanged('save', record.id);

    return record;
  } catch {
    return null;
  }
}

export async function updateLocalPdfMetadata(
  id: string,
  patch: { pageCount?: number; coverDataUrl?: string | null; sharedId?: string | null }
): Promise<void> {
  if (!id) return;
  try {
    const db = await openLocalLibraryDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LOCAL_STORE_NAME, 'readwrite');
      const store = tx.objectStore(LOCAL_STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const current = getReq.result as LocalPublicationRecord | undefined;
        if (!current) return;
        const nextPageCount =
          typeof patch.pageCount === 'number' && patch.pageCount > 0
            ? patch.pageCount
            : current.pageCount;
        const updated: LocalPublicationRecord = {
          ...current,
          pageCount: nextPageCount,
          coverDataUrl:
            patch.coverDataUrl !== undefined ? patch.coverDataUrl : current.coverDataUrl,
          sharedId: patch.sharedId !== undefined ? patch.sharedId : (current.sharedId ?? null),
          descripcion: buildLocalPublicationDescription(nextPageCount, current.fileSize),
        };
        const putReq = store.put(updated);
        putReq.onerror = () => reject(putReq.error);
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
        reject(tx.error || new Error('Transacción de actualización abortada'));
      };
    });
    notifyLocalLibraryChanged('update', id);
  } catch {
    // Ignorar errores silenciosamente
  }
}

export async function deleteLocalPublication(id: string): Promise<void> {
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
      if (localStorage.getItem(ACTIVE_LOCAL_ID_STORAGE_KEY) === id) {
        localStorage.removeItem(ACTIVE_LOCAL_ID_STORAGE_KEY);
      }
    } catch {
      // Ignorar
    }
    notifyLocalLibraryChanged('delete', id);
  } catch {
    // Ignorar
  }
}
