import { supabase } from "../lib/supabase.js";

function throwRpcError(error) {
  if (error) {
    throw new Error(error.message || "Something went wrong. Please try again.");
  }
}

/**
 * Per-worker sales dashboard for the signed-in POS worker.
 * scope: "shift" (current shift) or "day" (since the last day close).
 */
export async function getPosWorkerDashboard(sessionToken, scope = "shift") {
  const { data, error } = await supabase.rpc("get_pos_worker_dashboard", {
    p_session_token: sessionToken,
    p_scope: scope,
  });

  throwRpcError(error);

  return data;
}
