import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Unsubscribe,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  isFirebaseConfigured,
  OperationType,
} from './firebase';

export { auth };

export const BLUEPRINT_LIMITS = {
  idPattern: /^[a-zA-Z0-9_-]+$/,
  httpsUrlPattern: /^https:\/\/[^\s]+$/,
  tituloMin: 1,
  tituloMax: 140,
  categoriaMin: 1,
  categoriaMax: 40,
  fechaMin: 1,
  fechaMax: 40,
  descripcionMax: 400,
  urlMin: 8,
  urlMax: 500,
  hiddenKeysMax: 50,
  hiddenKeyMaxLen: 200,
  emailMax: 160,
  displayNameMax: 100,
} as const;

export interface CloudPublicationItem {
  id: string;
  ownerId: string;
  titulo: string;
  categoria: string;
  fecha: string;
  descripcion: string;
  rutaPdf: string;
  rutaPortada: string;
  isCloud: true;
}

export interface NewCloudPublicationInput {
  titulo: string;
  categoria: string;
  fecha: string;
  descripcion: string;
  rutaPdf: string;
  rutaPortada: string;
}

export function isFirebaseReady(): boolean {
  return isFirebaseConfigured;
}

export function subscribeToAuth(callback: (user: User | null) => void): Unsubscribe {
  if (!isFirebaseConfigured) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

export async function handleRedirectResult(): Promise<User | null> {
  if (!isFirebaseConfigured) return null;
  try {
    const result = await getRedirectResult(auth);
    if (result && result.user) {
      await syncUserPrivateProfile(result.user);
      return result.user;
    }
  } catch (error) {
    console.error('Error handling auth redirect result:', error);
  }
  return null;
}

export async function signInIndividualUser(): Promise<User | null> {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase no está configurado en esta instancia.');
  }
  try {
    const credential = await signInWithPopup(auth, googleProvider);
    if (credential.user) {
      await syncUserPrivateProfile(credential.user);
    }
    return credential.user;
  } catch (error: any) {
    const code = error?.code;
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return null;
    }
    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/unauthorized-domain' ||
      code === 'auth/operation-not-allowed'
    ) {
      try {
        await signInWithRedirect(auth, googleProvider);
        return null;
      } catch (redirectErr: any) {
        const rCode = redirectErr?.code;
        if (rCode === 'auth/unauthorized-domain') {
          throw new Error(
            'Dominio no autorizado en Firebase. Añade tu dominio de GitHub Pages en Firebase Console -> Authentication -> Settings -> Authorized domains.'
          );
        }
        throw redirectErr;
      }
    }
    if (code === 'auth/unauthorized-domain') {
      throw new Error(
        'Dominio no autorizado en Firebase. Añade tu dominio de GitHub Pages en Firebase Console -> Authentication -> Settings -> Authorized domains.'
      );
    }
    throw error;
  }
}

export async function signOutIndividualUser(): Promise<void> {
  if (!isFirebaseConfigured) return;
  await signOut(auth);
}

export async function syncUserPrivateProfile(user: User): Promise<void> {
  if (!user.emailVerified || !user.email) return;
  const profilePath = `users/${user.uid}/private/profile`;
  try {
    await setDoc(doc(db, 'users', user.uid, 'private', 'profile'), {
      ownerId: user.uid,
      email: user.email.trim().slice(0, BLUEPRINT_LIMITS.emailMax),
      displayName: (user.displayName || '').trim().slice(0, BLUEPRINT_LIMITS.displayNameMax),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, profilePath);
  }
}

export function subscribeToUserCatalog(
  uid: string,
  handlers: {
    onPublications: (items: CloudPublicationItem[]) => void;
    onHiddenKeys: (keys: string[]) => void;
    onError?: (err: Error) => void;
  }
): () => void {
  if (!isFirebaseConfigured || !auth.currentUser || auth.currentUser.uid !== uid) {
    handlers.onPublications([]);
    handlers.onHiddenKeys([]);
    return () => {};
  }

  const pubsPath = `users/${uid}/publications`;
  const pubsQuery = query(collection(db, 'users', uid, 'publications'), where('ownerId', '==', uid));

  const unsubPubs = onSnapshot(
    pubsQuery,
    (snapshot) => {
      const items: CloudPublicationItem[] = snapshot.docs.map((snap) => {
        const data = snap.data();
        return {
          id: snap.id,
          ownerId: String(data.ownerId || uid),
          titulo: String(data.titulo || 'Publicación'),
          categoria: String(data.categoria || 'Nube'),
          fecha: String(data.fecha || ''),
          descripcion: String(data.descripcion || ''),
          rutaPdf: String(data.rutaPdf || ''),
          rutaPortada: String(data.rutaPortada || ''),
          isCloud: true,
        };
      });
      handlers.onPublications(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, pubsPath);
      } catch (wrapped) {
        handlers.onError?.(wrapped as Error);
      }
    }
  );

  const prefsPath = `users/${uid}/preferences/catalog`;
  const unsubPrefs = onSnapshot(
    doc(db, 'users', uid, 'preferences', 'catalog'),
    (snapshot) => {
      if (!snapshot.exists()) {
        handlers.onHiddenKeys([]);
        return;
      }
      const data = snapshot.data();
      const rawKeys = Array.isArray(data.hiddenBuiltinKeys) ? data.hiddenBuiltinKeys : [];
      const keys = rawKeys
        .filter((k): k is string => typeof k === 'string' && k.length > 0)
        .map((k) => k.slice(0, BLUEPRINT_LIMITS.hiddenKeyMaxLen))
        .slice(0, BLUEPRINT_LIMITS.hiddenKeysMax);
      handlers.onHiddenKeys(keys);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, prefsPath);
      } catch (wrapped) {
        handlers.onError?.(wrapped as Error);
      }
    }
  );

  return () => {
    unsubPubs();
    unsubPrefs();
  };
}

export async function addCloudPublication(
  uid: string,
  input: NewCloudPublicationInput
): Promise<string> {
  const titulo = input.titulo.trim().slice(0, BLUEPRINT_LIMITS.tituloMax);
  const categoria = (input.categoria.trim() || 'Revistas').slice(0, BLUEPRINT_LIMITS.categoriaMax);
  const fecha = (input.fecha.trim() || 'Reciente').slice(0, BLUEPRINT_LIMITS.fechaMax);
  const descripcion = input.descripcion.trim().slice(0, BLUEPRINT_LIMITS.descripcionMax);
  const rutaPdf = input.rutaPdf.trim();
  const rutaPortada = input.rutaPortada.trim();

  if (titulo.length < BLUEPRINT_LIMITS.tituloMin) {
    throw new Error('El título es obligatorio.');
  }
  if (
    rutaPdf.length < BLUEPRINT_LIMITS.urlMin ||
    rutaPdf.length > BLUEPRINT_LIMITS.urlMax ||
    !BLUEPRINT_LIMITS.httpsUrlPattern.test(rutaPdf)
  ) {
    throw new Error('La URL del PDF debe comenzar por https:// y tener máximo 500 caracteres.');
  }
  if (
    rutaPortada.length > 0 &&
    (rutaPortada.length < BLUEPRINT_LIMITS.urlMin ||
      rutaPortada.length > BLUEPRINT_LIMITS.urlMax ||
      !BLUEPRINT_LIMITS.httpsUrlPattern.test(rutaPortada))
  ) {
    throw new Error('La URL de la portada debe comenzar por https:// o dejarse vacía.');
  }

  const pubId = `pub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (!BLUEPRINT_LIMITS.idPattern.test(pubId)) {
    throw new Error('Identificador de publicación inválido.');
  }

  const docPath = `users/${uid}/publications/${pubId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'publications', pubId), {
      ownerId: uid,
      titulo,
      categoria,
      fecha,
      descripcion,
      rutaPdf,
      rutaPortada,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return pubId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, docPath);
  }
}

export async function deleteCloudPublication(uid: string, publicationId: string): Promise<void> {
  if (!BLUEPRINT_LIMITS.idPattern.test(publicationId)) {
    throw new Error('Identificador de publicación inválido.');
  }
  const docPath = `users/${uid}/publications/${publicationId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'publications', publicationId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}

export async function saveHiddenBuiltinKeysToCloud(uid: string, keys: string[]): Promise<void> {
  const sanitized = Array.from(
    new Set(
      keys
        .filter((k) => typeof k === 'string' && k.trim().length > 0)
        .map((k) => k.trim().slice(0, BLUEPRINT_LIMITS.hiddenKeyMaxLen))
    )
  ).slice(0, BLUEPRINT_LIMITS.hiddenKeysMax);

  const docPath = `users/${uid}/preferences/catalog`;
  try {
    await setDoc(doc(db, 'users', uid, 'preferences', 'catalog'), {
      ownerId: uid,
      hiddenBuiltinKeys: sanitized,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, docPath);
  }
}
