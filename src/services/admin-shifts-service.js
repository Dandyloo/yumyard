import { supabase } from "../lib/supabase.js";

function throwRpcError(error) {
  if (error) {
    throw new Error(error.message || "Something went wrong. Please try again.");
  }
}

export async function getAdminShiftHistory(sessionToken, filters = {}) {
  const { data, error } = await supabase.rpc("get_admin_shift_history", {
    p_session_token: sessionToken,
    p_date_from: filters.dateFrom || null,
    p_date_to: filters.dateTo || null,
    p_worker_id: filters.workerId || null,
    p_limit: filters.limit || 50,
    p_offset: filters.offset || 0,
  });

  throwRpcError(error);

  const rows = data || [];

  return {
    shifts: rows.map((row) => ({
      shiftId: row.shift_id,
      workerName: row.worker_name,
      status: row.status,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      openingCashActual: Number(row.opening_cash_actual || 0),
      expectedCash: Number(row.expected_cash || 0),
      actualCashCounted: row.actual_cash_counted == null ? null : Number(row.actual_cash_counted),
      cashVariance: row.cash_variance == null ? null : Number(row.cash_variance),
      closingNote: row.closing_note || "",
    })),
    totalCount: rows.length ? Number(rows[0].total_count) : 0,
  };
}

export async function getAdminShiftDetail(sessionToken, shiftId) {
  const { data, error } = await supabase.rpc("get_admin_shift_detail", {
    p_session_token: sessionToken,
    p_shift_id: shiftId,
  });

  throwRpcError(error);

  return data;
}
