import { APP_CONFIG } from "./config.js";

export function savePosSession(session) {
  sessionStorage.setItem(APP_CONFIG.sessionStorageKey, JSON.stringify(session));
}

export function getPosSession() {
  const rawSession = sessionStorage.getItem(APP_CONFIG.sessionStorageKey);

  if (!rawSession) {
    return null;
  }

  try {
    const session = JSON.parse(rawSession);

    if (!session?.sessionToken || !session?.workerId || !session?.branchId) {
      clearPosSession();
      return null;
    }

    return session;
  } catch {
    clearPosSession();
    return null;
  }
}

export function clearPosSession() {
  sessionStorage.removeItem(APP_CONFIG.sessionStorageKey);
}

export function isSessionExpired(session) {
  if (!session?.expiresAt) {
    return true;
  }

  return new Date(session.expiresAt).getTime() <= Date.now();
}