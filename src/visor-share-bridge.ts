import {
  auth,
  handleRedirectResult,
  isFirebaseReady,
  signInIndividualUser,
  subscribeToAuth,
} from './catalog-firebase';
import {
  loadSharedPublicationFromCloud,
  MAX_SHARED_PDF_BYTES,
  publishPdfBytesToCloudShare,
  verifySharedPublicationExists,
} from './shared-publications';

export interface VisorCloudShareBridge {
  isReady: () => boolean;
  maxBytes: number;
  getCurrentUser: () => { uid: string; email: string | null; displayName: string | null } | null;
  waitForAuthReady: () => Promise<{ uid: string; email: string | null; displayName: string | null } | null>;
  subscribeAuth: (
    cb: (user: { uid: string; email: string | null; displayName: string | null } | null) => void
  ) => () => void;
  signIn: () => Promise<{ uid: string; email: string | null; displayName: string | null } | null>;
  handleRedirectResult: () => Promise<{
    uid: string;
    email: string | null;
    displayName: string | null;
  } | null>;
  publishPdfBytes: typeof publishPdfBytesToCloudShare;
  verifyShareExists: typeof verifySharedPublicationExists;
  loadSharedPublication: typeof loadSharedPublicationFromCloud;
}

declare global {
  interface Window {
    __flipbookCloudShare?: VisorCloudShareBridge;
  }
}

let latestUser: { uid: string; email: string | null; displayName: string | null } | null = null;
const authListeners = new Set<
  (user: { uid: string; email: string | null; displayName: string | null } | null) => void
>();

subscribeToAuth((user) => {
  latestUser = user
    ? {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
      }
    : null;
  authListeners.forEach((cb) => {
    try {
      cb(latestUser);
    } catch {
      // Ignorar error en listener
    }
  });
});

const bridge: VisorCloudShareBridge = {
  isReady: () => isFirebaseReady(),
  maxBytes: MAX_SHARED_PDF_BYTES,
  getCurrentUser: () => latestUser,
  waitForAuthReady: async () => {
    if (!isFirebaseReady()) return null;
    try {
      if (typeof auth.authStateReady === 'function') {
        await auth.authStateReady();
      }
    } catch {
      // Ignorar
    }
    if (auth.currentUser) {
      latestUser = {
        uid: auth.currentUser.uid,
        email: auth.currentUser.email,
        displayName: auth.currentUser.displayName,
      };
    }
    return latestUser;
  },
  subscribeAuth: (cb) => {
    authListeners.add(cb);
    cb(latestUser);
    return () => {
      authListeners.delete(cb);
    };
  },
  signIn: async () => {
    const user = await signInIndividualUser();
    if (user) {
      latestUser = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
      };
      return latestUser;
    }
    return latestUser;
  },
  handleRedirectResult: async () => {
    const user = await handleRedirectResult();
    if (user) {
      latestUser = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
      };
      return latestUser;
    }
    return latestUser;
  },
  publishPdfBytes: publishPdfBytesToCloudShare,
  verifyShareExists: verifySharedPublicationExists,
  loadSharedPublication: loadSharedPublicationFromCloud,
};

window.__flipbookCloudShare = bridge;
window.dispatchEvent(new CustomEvent('flipbook-cloud-bridge-ready'));
