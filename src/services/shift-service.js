import { supabase } from "../lib/supabase.js";

function throwRpcError(error) {
  if (error) {
    throw new Error(error.message || "Something went wrong. Please try again.");
  }
}

export async function getShiftOpeningContext(sessionToken) {
  const { data, error } = await supabase.rpc("get_shift_opening_context", {
    p_session_token: sessionToken,
  });

  throwRpcError(error);

  return Array.isArray(data) ? data[0] : data;
}

export async function getActiveWorkerShift(sessionToken) {
  const { data, error } = await supabase.rpc("get_active_worker_shift", {
    p_session_token: sessionToken,
  });

  throwRpcError(error);

  return Array.isArray(data) ? data[0] : data;
}

export async function openWorkerShift(sessionToken, openingCashActual, openingNote = "") {
  const { data, error } = await supabase.rpc("open_worker_shift", {
    p_session_token: sessionToken,
    p_opening_cash_actual: Number(openingCashActual),
    p_opening_note: openingNote || null,
  });

  throwRpcError(error);

  return Array.isArray(data) ? data[0] : data;
}

export async function getPendingHandoverOrders(sessionToken) {
  const { data, error } = await supabase.rpc("get_pending_handover_orders", {
    p_session_token: sessionToken,
  });

  throwRpcError(error);

  return data || [];
}

export async function claimHandoverOrders(sessionToken, orderIds, acknowledgementNote = "") {
  const { data, error } = await supabase.rpc("claim_handover_orders_for_shift", {
    p_session_token: sessionToken,
    p_order_ids: orderIds,
    p_acknowledgement_note: acknowledgementNote || null,
  });

  throwRpcError(error);

  return data;
}

export async function getShiftClosePreview(sessionToken) {
  const { data, error } = await supabase.rpc("get_shift_close_preview", {
    p_session_token: sessionToken,
  });

  throwRpcError(error);

  return data;
}

export async function closeWorkerShift({
  sessionToken,
  actualCashCounted,
  closingNote = "",
  adminSessionToken = null,
}) {
  const { data, error } = await supabase.rpc("close_worker_shift", {
    p_session_token: sessionToken,
    p_actual_cash_counted: Number(actualCashCounted),
    p_closing_note: closingNote || null,
    p_admin_session_token: adminSessionToken || null,
  });

  throwRpcError(error);

  return data;
}