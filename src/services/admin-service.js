import { supabase } from "../lib/supabase.js";

function throwRpcError(error) {
  if (error) {
    throw new Error(error.message || "Something went wrong. Please try again.");
  }
}

export async function getAdminDashboardToday(sessionToken) {
  const { data, error } = await supabase.rpc("get_admin_dashboard_today", {
    p_session_token: sessionToken,
  });

  throwRpcError(error);

  const row = Array.isArray(data) ? data[0] : data;

  return {
    totalSales: Number(row?.total_sales || 0),
    totalOrders: Number(row?.total_orders || 0),
    totalDeliveryOrders: Number(row?.total_delivery_orders || 0),
    cancelledOrders: Number(row?.cancelled_orders || 0),
    totalRevenue: Number(row?.total_revenue || 0),
  };
}

export async function getAdminSalesByHour(sessionToken) {
  const { data, error } = await supabase.rpc("get_admin_sales_by_hour", {
    p_session_token: sessionToken,
  });

  throwRpcError(error);

  return (data || []).map((row) => ({
    hour: Number(row.hour_of_day),
    sales: Number(row.sales || 0),
  }));
}

export async function getAdminShiftsClosedToday(sessionToken) {
  const { data, error } = await supabase.rpc("get_admin_shifts_closed_today", {
    p_session_token: sessionToken,
  });

  throwRpcError(error);

  return (data || []).map((row) => ({
    shiftId: row.shift_id,
    workerName: row.worker_name,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    openingCashActual: Number(row.opening_cash_actual || 0),
    expectedCash: Number(row.expected_cash || 0),
    actualCashCounted: Number(row.actual_cash_counted || 0),
    cashVariance: Number(row.cash_variance || 0),
    closingNote: row.closing_note || "",
  }));
}
