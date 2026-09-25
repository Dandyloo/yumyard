import { supabase } from "../lib/supabase.js";

function throwRpcError(error) {
  if (error) {
    throw new Error(error.message || "Something went wrong. Please try again.");
  }
}

export async function getAdminItemSales(sessionToken, { dateFrom, dateTo } = {}) {
  const { data, error } = await supabase.rpc("get_admin_item_sales", {
    p_session_token: sessionToken,
    p_date_from: dateFrom || null,
    p_date_to: dateTo || null,
  });

  throwRpcError(error);

  return (data || []).map((row) => ({
    itemId: row.item_id,
    itemName: row.item_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    isArchived: row.is_archived,
    quantitySold: Number(row.quantity_sold),
    revenue: Number(row.revenue),
    orderCount: Number(row.order_count),
  }));
}

export async function getAdminCategorySales(sessionToken, { dateFrom, dateTo } = {}) {
  const { data, error } = await supabase.rpc("get_admin_category_sales", {
    p_session_token: sessionToken,
    p_date_from: dateFrom || null,
    p_date_to: dateTo || null,
  });

  throwRpcError(error);

  return (data || []).map((row) => ({
    categoryId: row.category_id,
    categoryName: row.category_name,
    isActive: row.is_active,
    itemCount: Number(row.item_count),
    quantitySold: Number(row.quantity_sold),
    revenue: Number(row.revenue),
    orderCount: Number(row.order_count),
  }));
}
