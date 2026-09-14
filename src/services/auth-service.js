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