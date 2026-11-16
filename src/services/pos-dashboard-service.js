import { supabase } from "../lib/supabase.js";
import { normalizeProductSales } from "../lib/product-sales.js";

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

/**
 * Packs/products sold since the last day close (what the Close Day screen shows).
 */
export async function getPosDayProductSales(sessionToken) {
  const { data, error } = await supabase.rpc("pos_day_product_sales", {
    p_session_token: sessionToken,
  });

  throwRpcError(error);

  return normalizeProductSales(data);
}
