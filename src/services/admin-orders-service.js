import { supabase } from "../lib/supabase.js";

function throwRpcError(error) {
  if (error) {
    throw new Error(error.message || "Something went wrong. Please try again.");
  }
}

export async function getAdminOrderHistory(sessionToken, filters = {}) {
  const { data, error } = await supabase.rpc("get_admin_order_history", {
    p_session_token: sessionToken,
    p_date_from: filters.dateFrom || null,
    p_date_to: filters.dateTo || null,
    p_worker_id: filters.workerId || null,
    p_status_bucket: filters.statusBucket || "all",
    p_search: filters.search || null,
    p_limit: filters.limit || 100,
    p_offset: filters.offset || 0,
  });

  throwRpcError(error);

  const rows = data || [];

  return {
    orders: rows.map((row) => ({
      orderId: row.order_id,
      orderNumber: row.order_number,
      createdAt: row.created_at,
      workerName: row.worker_name,
      fulfillmentType: row.fulfillment_type,
      total: Number(row.total),
      paymentStatus: row.payment_status,
      status: row.status,
    })),
    totalCount: rows.length ? Number(rows[0].total_count) : 0,
  };
}

export async function getAdminOrderDetail(sessionToken, orderId) {
  const { data, error } = await supabase.rpc("get_admin_order_detail", {
    p_session_token: sessionToken,
    p_order_id: orderId,
  });

  throwRpcError(error);

  return data;
}
