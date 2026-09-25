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
}) {
  const { data, error } = await supabase.rpc("close_worker_shift", {
    p_session_token: sessionToken,
    p_actual_cash_counted: Number(actualCashCounted),
    p_closing_note: closingNote || null,
  });

  throwRpcError(error);

  return data;
}

export async function getCloseDayPreview(sessionToken) {
  const { data, error } = await supabase.rpc("get_close_day_preview", {
    p_session_token: sessionToken,
  });

  throwRpcError(error);

  return Array.isArray(data) ? data[0] : data;
}

export async function closeBusinessDay(sessionToken, { cashHandedOver, openingFloatForNextDay = 0, notes = "" }) {
  const { data, error } = await supabase.rpc("close_business_day", {
    p_session_token: sessionToken,
    p_cash_handed_over: Number(cashHandedOver),
    p_opening_float_for_next_day: Number(openingFloatForNextDay),
    p_notes: notes || null,
  });

  throwRpcError(error);

  return data;
}