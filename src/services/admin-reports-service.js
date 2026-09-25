import { supabase } from "../lib/supabase.js";

function throwRpcError(error) {
  if (error) {
    throw new Error(error.message || "Something went wrong. Please try again.");
  }
}

export async function getAdminRevenueSummary(sessionToken) {
  const { data, error } = await supabase.rpc("get_admin_revenue_summary", {
    p_session_token: sessionToken,
  });

  throwRpcError(error);

  const row = Array.isArray(data) ? data[0] : data;

  return {
    todaySales: Number(row?.today_sales || 0),
    todayOrders: Number(row?.today_orders || 0),
    weekToDateSales: Number(row?.week_to_date_sales || 0),
    weekToDateOrders: Number(row?.week_to_date_orders || 0),
    monthToDateSales: Number(row?.month_to_date_sales || 0),
    monthToDateOrders: Number(row?.month_to_date_orders || 0),
    yearToDateSales: Number(row?.year_to_date_sales || 0),
    yearToDateOrders: Number(row?.year_to_date_orders || 0),
  };
}

export async function getAdminRevenueTrend(sessionToken, granularity, periods) {
  const { data, error } = await supabase.rpc("get_admin_revenue_trend", {
    p_session_token: sessionToken,
    p_granularity: granularity,
    p_periods: periods,
  });

  throwRpcError(error);

  return (data || []).map((row) => ({
    bucketDate: row.bucket_date,
    sales: Number(row.sales || 0),
    orders: Number(row.orders || 0),
  }));
}
