import { APP_CONFIG } from "../lib/config.js";
import { supabase } from "../lib/supabase.js";

function throwRpcError(error) {
  if (error) {
    throw new Error(error.message || "Something went wrong. Please try again.");
  }
}

export async function authenticatePosWorker(username, pin) {
  const { data, error } = await supabase.rpc("authenticate_worker", {
    p_branch_slug: APP_CONFIG.branchSlug,
    p_username: username.trim(),
    p_pin: pin,
    p_access_area: "pos",
  });

  throwRpcError(error);

  const session = Array.isArray(data) ? data[0] : data;

  if (!session?.session_token) {
    throw new Error("Could not start a POS session. Please try again.");
  }

  return {
    workerId: session.worker_id,
    workerName: session.worker_name,
    username: session.worker_username,
    workerRole: session.worker_role,
    branchId: session.branch_id,
    branchSlug: session.branch_slug,
    sessionToken: session.session_token,
    expiresAt: session.session_expires_at,
    accessArea: "pos",
  };
}

// Name-only roster for the Cosy-style profile picker. Never exposes
// username or pin_hash - see list_branch_workers() in
// 0013_worker_profile_login.sql.
export async function listBranchWorkers() {
  const { data, error } = await supabase.rpc("list_branch_workers", {
    p_branch_slug: APP_CONFIG.branchSlug,
  });

  throwRpcError(error);

  return (data || []).map((worker) => ({
    workerId: worker.worker_id,
    displayName: worker.display_name,
    role: worker.role,
  }));
}

// Used by the profile+PIN login screen: the worker is already chosen from
// the profile list, so authentication only needs their id and PIN.
export async function authenticatePosWorkerById(workerId, pin) {
  const { data, error } = await supabase.rpc("authenticate_worker_by_id", {
    p_branch_slug: APP_CONFIG.branchSlug,
    p_worker_id: workerId,
    p_pin: pin,
    p_access_area: "pos",
  });

  throwRpcError(error);

  const session = Array.isArray(data) ? data[0] : data;

  if (!session?.session_token) {
    throw new Error("Could not start a POS session. Please try again.");
  }

  return {
    workerId: session.worker_id,
    workerName: session.worker_name,
    username: session.worker_username,
    workerRole: session.worker_role,
    branchId: session.branch_id,
    branchSlug: session.branch_slug,
    sessionToken: session.session_token,
    expiresAt: session.session_expires_at,
    accessArea: "pos",
  };
}

// Used only to obtain a short-lived admin-area session token so
// close_worker_shift() can approve closing a shift that still has
// orders being handed over (see p_admin_session_token).
export async function authenticateAdminWorker(username, pin) {
  const { data, error } = await supabase.rpc("authenticate_worker", {
    p_branch_slug: APP_CONFIG.branchSlug,
    p_username: username.trim(),
    p_pin: pin,
    p_access_area: "admin",
  });

  throwRpcError(error);

  const session = Array.isArray(data) ? data[0] : data;

  if (!session?.session_token) {
    throw new Error("Could not verify owner/admin approval. Please try again.");
  }

  return {
    workerName: session.worker_name,
    sessionToken: session.session_token,
  };
}

// Used by the admin app's profile+PIN login screen. Mirrors
// authenticatePosWorkerById() but requests the "admin" access area, which
// authenticate_worker_by_id() only grants to owner/admin/manager roles.
export async function authenticateAdminWorkerById(workerId, pin) {
  const { data, error } = await supabase.rpc("authenticate_worker_by_id", {
    p_branch_slug: APP_CONFIG.branchSlug,
    p_worker_id: workerId,
    p_pin: pin,
    p_access_area: "admin",
  });

  throwRpcError(error);

  const session = Array.isArray(data) ? data[0] : data;

  if (!session?.session_token) {
    throw new Error("Could not start an admin session. Please try again.");
  }

  return {
    workerId: session.worker_id,
    workerName: session.worker_name,
    username: session.worker_username,
    workerRole: session.worker_role,
    branchId: session.branch_id,
    branchSlug: session.branch_slug,
    sessionToken: session.session_token,
    expiresAt: session.session_expires_at,
    accessArea: "admin",
  };
}

export async function validateAdminSession(sessionToken) {
  const { data, error } = await supabase.rpc("current_worker_session", {
    p_session_token: sessionToken,
    p_required_access_area: "admin",
  });

  throwRpcError(error);

  const session = Array.isArray(data) ? data[0] : data;

  if (!session?.session_id) {
    throw new Error("Your admin session is no longer valid.");
  }

  return session;
}

export async function validatePosSession(sessionToken) {
  const { data, error } = await supabase.rpc("current_worker_session", {
    p_session_token: sessionToken,
    p_required_access_area: "pos",
  });

  throwRpcError(error);

  const session = Array.isArray(data) ? data[0] : data;

  if (!session?.session_id) {
    throw new Error("Your POS session is no longer valid.");
  }

  return session;
}

export async function lockPosSession(sessionToken, reason = "Locked from tablet") {
  const { error } = await supabase.rpc("lock_worker_session", {
    p_session_token: sessionToken,
    p_reason: reason,
  });

  throwRpcError(error);
}

// lock_worker_session() isn't access-area specific - this is just a
// same-named alias so admin call sites don't read as reusing POS code.
export const lockAdminSession = lockPosSession;