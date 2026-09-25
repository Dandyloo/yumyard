import { APP_CONFIG } from "./config.js";

export function saveAdminSession(session) {
  sessionStorage.setItem(
    APP_CONFIG.adminSessionStorageKey,
    JSON.stringify(session),
  );
}

export function getAdminSession() {
  const rawSession = sessionStorage.getItem(APP_CONFIG.adminSessionStorageKey);

  if (!rawSession) {
    return null;
  }

  try {
    const session = JSON.parse(rawSession);

    // Support both snake_case (from RPC) and camelCase (already-normalized)
    // shapes, same as session-store.js.
    const hasToken = session.session_token || session.sessionToken;
    const hasWorker = session.worker_id || session.workerId;
    const hasBranch = session.branch_id || session.branchId;

    if (!hasToken || !hasWorker || !hasBranch) {
      clearAdminSession();
      return null;
    }

    return {
      sessionToken: session.session_token || session.sessionToken,
      workerId: session.worker_id || session.workerId,
      workerName: session.worker_name || session.workerName,
      workerRole: session.worker_role || session.workerRole,
      branchId: session.branch_id || session.branchId,
      branchSlug: session.branch_slug || session.branchSlug,
      expiresAt: session.session_expires_at || session.expiresAt,
    };
  } catch {
    clearAdminSession();
    return null;
  }
}

export function clearAdminSession() {
  sessionStorage.removeItem(APP_CONFIG.adminSessionStorageKey);
}

export function isAdminSessionExpired(session) {
  if (!session?.expiresAt) {
    return true;
  }

  return new Date(session.expiresAt).getTime() <= Date.now();
}
