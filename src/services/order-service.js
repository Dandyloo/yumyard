import { supabase } from "../lib/supabase.js";

function throwRpcError(error) {
  if (error) {
    throw new Error(error.message || "Something went wrong. Please try again.");
  }
}

export async function createPosOrder(sessionToken, checkout, cartItems) {
  const orderItems = cartItems.map((item) => ({
    menu_item_id: item.menuItemId,
    quantity: item.quantity,
    ...(item.protein ? { protein_choice: item.protein } : {}),
  }));

  const { data, error } = await supabase.rpc("create_pos_order", {
    p_session_token: sessionToken,
    p_fulfillment_type: checkout.fulfillmentType,
    p_source: checkout.source,
    p_customer_name: checkout.customerName || null,
    p_customer_phone: checkout.customerPhone || null,
    p_delivery_address: checkout.deliveryAddress || null,
    p_delivery_fee:
      checkout.fulfillmentType === "delivery"
        ? Number(checkout.deliveryFee || 0)
        : 0,
    p_rider_id: null,
    p_order_notes: checkout.notes || null,
    p_items: orderItems,
  });

  throwRpcError(error);

  return data;
}

export async function getPosActiveOrders(sessionToken) {
  const { data, error } = await supabase.rpc("get_pos_active_orders", {
    p_session_token: sessionToken,
  });

  throwRpcError(error);

  return data || [];
}

export async function updatePosOrderStatus(
  sessionToken,
  orderId,
  nextStatus,
  cancellationReason = null,
) {
  const { data, error } = await supabase.rpc("update_pos_order_status", {
    p_session_token: sessionToken,
    p_order_id: orderId,
    p_next_status: nextStatus,
    p_cancellation_reason: cancellationReason,
  });

  throwRpcError(error);

  return data;
}

export async function getPosWorkerOrderHistory(sessionToken, filters = {}) {
  const { data, error } = await supabase.rpc("get_pos_worker_order_history", {
    p_session_token: sessionToken,
    p_date_from: filters.dateFrom || null,
    p_date_to: filters.dateTo || null,
    p_status_bucket: filters.statusBucket || "all",
    p_search: filters.search || null,
    p_limit: filters.limit || 50,
    p_offset: filters.offset || 0,
  });

  throwRpcError(error);

  const rows = data || [];

  return {
    orders: rows.map((row) => ({
      orderId: row.order_id,
      orderNumber: row.order_number,
      createdAt: row.created_at,
      fulfillmentType: row.fulfillment_type,
      total: Number(row.total),
      paymentStatus: row.payment_status,
      status: row.status,
    })),
    totalCount: rows.length ? Number(rows[0].total_count) : 0,
  };
}

export async function getPosWorkerOrderDetail(sessionToken, orderId) {
  const { data, error } = await supabase.rpc("get_pos_worker_order_detail", {
    p_session_token: sessionToken,
    p_order_id: orderId,
  });

  throwRpcError(error);

  return data;
}

export async function recordOrderPayment(
  sessionToken,
  orderId,
  paymentMethod,
  amount,
  reference = "",
) {
  const { data, error } = await supabase.rpc("record_order_payment", {
    p_session_token: sessionToken,
    p_order_id: orderId,
    p_payment_method: paymentMethod,
    p_amount: Number(amount),
    p_reference: reference || null,
  });

  throwRpcError(error);

  return data;
}