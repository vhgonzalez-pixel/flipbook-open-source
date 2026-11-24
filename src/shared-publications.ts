import {
  Bytes,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  isFirebaseConfigured,
  OperationType,
} from './firebase';

export const SHARED_CHUNK_BYTE_SIZE = 700_000;
export const MAX_SHARED_CHUNKS = 30;
export const MAX_SHARED_PDF_BYTES = SHARED_CHUNK_BYTE_SIZE * MAX_SHARED_CHUNKS; // 21 MB (~20 MiB)
const SHARE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export type LoadedSharedPublication =
  | { kind: 'url'; shareId: string; titulo: string; pdfUrl: string }
  | { kind: 'bytes'; shareId: string; titulo: string; bytes: Uint8Array };

function truncateUtf8(input: string, maxBytes: number): string {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';
  if (typeof TextEncoder === 'undefined') {
    return trimmed.slice(0, maxBytes);
  }
  const encoder = new TextEncoder();
  let result = '';
  let byteCount = 0;
  for (const ch of trimmed) {
    const chBytes = encoder.encode(ch).length;
    if (byteCount + chBytes > maxBytes) break;
    result += ch;
    byteCount += chBytes;
  }
  return result.trim();
}

function generateShareId(): string {
  const randomBytes = new Uint8Array(9);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < randomBytes.length; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const hex = Array.from(randomBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `sh-${Date.now().toString(36)}-${hex}`;
}

export function isValidShareId(id: string | null | undefined): id is string {
  return typeof id === 'string' && SHARE_ID_PATTERN.test(id.trim());
}

export function parseShareQueryParam(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const raw = params.get('share')?.trim() ?? '';
  return isValidShareId(raw) ? raw : null;
}

export function buildCanonicalShareLink(
  shareId: string,
  targetPath = 'visor.html',
  baseHref = typeof window !== 'undefined' ? window.location.href : 'https://example.com/'
): string {
  const url = new URL(targetPath, baseHref || 'https://example.com/');
  url.search = '';
  url.searchParams.set('share', shareId);
  return url.toString();
}

export async function verifySharedPublicationExists(shareId: string): Promise<boolean> {
  if (!isFirebaseConfigured || !isValidShareId(shareId)) return false;
  const docPath = `sharedPublications/${shareId}`;
  try {
    const snap = await getDocFromServer(doc(db, 'sharedPublications', shareId));
    return snap.exists();
  } catch {
    try {
      const cached = await getDoc(doc(db, 'sharedPublications', shareId));
      return cached.exists();
    } catch (err) {
      console.warn(`No se pudo verificar ${docPath}:`, err);
      return false;
    }
  }
}

export async function publishPdfBytesToCloudShare(params: {
  titulo: string;
  bytes: Uint8Array;
  onProgress?: (completed: number, total: number) => void;
}): Promise<string> {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase no está configurado en esta instancia.');
  }
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Debes iniciar sesión con Google para generar un enlace compartible.');
  }
  if (!user.emailVerified) {
    throw new Error('Tu cuenta debe tener el correo verificado para publicar enlaces.');
  }

  const bytes = params.bytes;
  if (!bytes || bytes.byteLength === 0) {
    throw new Error('El archivo PDF está vacío.');
  }
  if (bytes.byteLength > MAX_SHARED_PDF_BYTES) {
    throw new Error(
      'Este PDF supera el límite de 20 MB para publicación directa. Súbelo a Google Drive, Dropbox o GitHub y pega el enlace HTTPS.'
    );
  }

  const chunkCount = Math.ceil(bytes.byteLength / SHARED_CHUNK_BYTE_SIZE);
  if (chunkCount < 1 || chunkCount > MAX_SHARED_CHUNKS) {
    throw new Error('El archivo excede el número máximo de fragmentos permitidos.');
  }

  const cleanTitle = truncateUtf8(params.titulo || 'Publicación PDF', 140) || 'Publicación PDF';
  const shareId = generateShareId();
  const parentPath = `sharedPublications/${shareId}`;

  try {
    await setDoc(doc(db, 'sharedPublications', shareId), {
      ownerId: user.uid,
      titulo: cleanTitle,
      sourceType: 'chunks',
      pdfUrl: '',
      chunkCount,
      fileSize: bytes.byteLength,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, parentPath);
  }

  let completed = 0;
  params.onProgress?.(0, chunkCount);

  try {
    const batchSize = 4;
    for (let start = 0; start < chunkCount; start += batchSize) {
      const end = Math.min(chunkCount, start + batchSize);
      const tasks: Promise<void>[] = [];
      for (let i = start; i < end; i++) {
        const offset = i * SHARED_CHUNK_BYTE_SIZE;
        const slice = bytes.subarray(offset, Math.min(bytes.byteLength, offset + SHARED_CHUNK_BYTE_SIZE));
        const chunkRef = doc(db, 'sharedPublications', shareId, 'chunks', String(i));
        const chunkPath = `${parentPath}/chunks/${i}`;
        tasks.push(
          setDoc(chunkRef, {
            ownerId: user.uid,
            shareId,
            index: i,
            data: Bytes.fromUint8Array(slice),
            createdAt: serverTimestamp(),
          })
            .then(() => {
              completed += 1;
              params.onProgress?.(completed, chunkCount);
            })
            .catch((err) => {
              handleFirestoreError(err, OperationType.CREATE, chunkPath);
            })
        );
      }
      await Promise.all(tasks);
    }
    return shareId;
  } catch (error) {
    // Limpieza best-effort si falló un fragmento intermedio
    try {
      await deleteDoc(doc(db, 'sharedPublications', shareId));
    } catch {
      // Ignorar errores de limpieza
    }
    throw error;
  }
}

export async function loadSharedPublicationFromCloud(
  shareId: string,
  onProgress?: (completed: number, total: number) => void
): Promise<LoadedSharedPublication> {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase no está disponible en esta instancia.');
  }
  if (!isValidShareId(shareId)) {
    throw new Error('El identificador del enlace compartido no es válido.');
  }

  const parentPath = `sharedPublications/${shareId}`;
  let snap;
  try {
    snap = await getDoc(doc(db, 'sharedPublications', shareId));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, parentPath);
  }

  if (!snap.exists()) {
    throw new Error('Esta publicación compartida no existe o fue retirada por su autor.');
  }

  const data = snap.data();
  const titulo = String(data.titulo || 'Publicación Editorial');
  const sourceType = String(data.sourceType || '');

  if (sourceType === 'url') {
    const pdfUrl = String(data.pdfUrl || '').trim();
    if (!/^https:\/\//i.test(pdfUrl)) {
      throw new Error('El enlace compartido no contiene una URL PDF válida.');
    }
    return { kind: 'url', shareId, titulo, pdfUrl };
  }

  if (sourceType !== 'chunks') {
    throw new Error('Formato de publicación compartida no reconocido.');
  }

  const chunkCount = Number(data.chunkCount || 0);
  if (!Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > MAX_SHARED_CHUNKS) {
    throw new Error('La publicación compartida está incompleta.');
  }

  const slices: Uint8Array[] = new Array(chunkCount);
  let totalBytes = 0;
  let completed = 0;
  onProgress?.(0, chunkCount);

  const batchSize = 6;
  for (let start = 0; start < chunkCount; start += batchSize) {
    const end = Math.min(chunkCount, start + batchSize);
    const tasks: Promise<void>[] = [];
    for (let i = start; i < end; i++) {
      const chunkPath = `${parentPath}/chunks/${i}`;
      tasks.push(
        getDoc(doc(db, 'sharedPublications', shareId, 'chunks', String(i)))
          .then((chunkSnap) => {
            if (!chunkSnap.exists()) {
              throw new Error(`Falta un fragmento de la publicación (${i + 1}/${chunkCount}).`);
            }
            const chunkData = chunkSnap.data()?.data;
            if (!chunkData || typeof chunkData.toUint8Array !== 'function') {
              throw new Error('El fragmento del documento PDF tiene un formato inválido.');
            }
            const arr = chunkData.toUint8Array() as Uint8Array;
            slices[i] = arr;
            totalBytes += arr.byteLength;
            completed += 1;
            onProgress?.(completed, chunkCount);
          })
          .catch((err) => {
            if (err instanceof Error && err.message.startsWith('Falta un fragmento')) {
              throw err;
            }
            handleFirestoreError(err, OperationType.GET, chunkPath);
          })
      );
    }
    await Promise.all(tasks);
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (let i = 0; i < chunkCount; i++) {
    const part = slices[i];
    merged.set(part, offset);
    offset += part.byteLength;
  }

  return { kind: 'bytes', shareId, titulo, bytes: merged };
}

export async function deleteSharedPublicationFromCloud(shareId: string): Promise<void> {
  if (!isFirebaseConfigured || !isValidShareId(shareId) || !auth.currentUser) return;
  const parentPath = `sharedPublications/${shareId}`;
  try {
    const snap = await getDoc(doc(db, 'sharedPublications', shareId));
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.ownerId !== auth.currentUser.uid) return;
    const chunkCount = Number(data.chunkCount || 0);
    if (Number.isInteger(chunkCount) && chunkCount > 0 && chunkCount <= MAX_SHARED_CHUNKS) {
      const delTasks: Promise<void>[] = [];
      for (let i = 0; i < chunkCount; i++) {
        delTasks.push(
          deleteDoc(doc(db, 'sharedPublications', shareId, 'chunks', String(i))).catch(() => {})
        );
      }
      await Promise.all(delTasks);
    }
    await deleteDoc(doc(db, 'sharedPublications', shareId));
  } catch (error) {
    console.warn(`No se pudo eliminar ${parentPath}:`, error);
  }
}
