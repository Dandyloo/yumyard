import { supabase } from "../lib/supabase.js";

/**
 * Everything needed to print a receipt for any order in this branch
 * (items, payments, who served, balance). Any signed-in worker can reprint.
 */
export async function getPosOrderReceipt(sessionToken, orderId) {
  const { data, error } = await supabase.rpc("get_pos_order_receipt", {
    p_session_token: sessionToken,
    p_order_id: orderId,
  });

  if (error) {
    throw new Error(error.message || "Could not load the receipt. Please try again.");
  }

  return data;
}
