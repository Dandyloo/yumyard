import { supabase } from "../lib/supabase.js";

function throwRpcError(error) {
  if (error) {
    throw new Error(error.message || "Something went wrong. Please try again.");
  }
}

export async function getAdminMenu(sessionToken) {
  const { data, error } = await supabase.rpc("get_admin_menu", {
    p_session_token: sessionToken,
  });

  throwRpcError(error);

  return {
    categories: data?.categories || [],
    items: data?.items || [],
  };
}

export async function createCategory(sessionToken, name) {
  const { error } = await supabase.rpc("admin_create_category", {
    p_session_token: sessionToken,
    p_name: name,
  });

  throwRpcError(error);
}

export async function updateCategory(sessionToken, categoryId, name) {
  const { error } = await supabase.rpc("admin_update_category", {
    p_session_token: sessionToken,
    p_category_id: categoryId,
    p_name: name,
  });

  throwRpcError(error);
}

export async function setCategoryActive(sessionToken, categoryId, isActive) {
  const { error } = await supabase.rpc("admin_set_category_active", {
    p_session_token: sessionToken,
    p_category_id: categoryId,
    p_is_active: isActive,
  });

  throwRpcError(error);
}

export async function reorderCategories(sessionToken, categoryIds) {
  const { error } = await supabase.rpc("admin_reorder_categories", {
    p_session_token: sessionToken,
    p_category_ids: categoryIds,
  });

  throwRpcError(error);
}

export async function createMenuItem(sessionToken, { categoryId, name, basePrice, requiresProtein }) {
  const { error } = await supabase.rpc("admin_create_menu_item", {
    p_session_token: sessionToken,
    p_category_id: categoryId,
    p_name: name,
    p_base_price: basePrice,
    p_requires_protein: requiresProtein,
  });

  throwRpcError(error);
}

export async function updateMenuItem(sessionToken, itemId, { categoryId, name, basePrice, requiresProtein }) {
  const { error } = await supabase.rpc("admin_update_menu_item", {
    p_session_token: sessionToken,
    p_item_id: itemId,
    p_name: name,
    p_category_id: categoryId,
    p_base_price: basePrice,
    p_requires_protein: requiresProtein,
  });

  throwRpcError(error);
}

export async function setMenuItemAvailability(sessionToken, itemId, isAvailable) {
  const { error } = await supabase.rpc("admin_set_menu_item_availability", {
    p_session_token: sessionToken,
    p_item_id: itemId,
    p_is_available: isAvailable,
  });

  throwRpcError(error);
}

export async function setMenuItemArchived(sessionToken, itemId, isArchived) {
  const { error } = await supabase.rpc("admin_set_menu_item_archived", {
    p_session_token: sessionToken,
    p_item_id: itemId,
    p_is_archived: isArchived,
  });

  throwRpcError(error);
}

export async function createProteinOption(sessionToken, menuItemId, { name, priceAdjustment }) {
  const { error } = await supabase.rpc("admin_create_protein_option", {
    p_session_token: sessionToken,
    p_menu_item_id: menuItemId,
    p_name: name,
    p_price_adjustment: priceAdjustment,
  });

  throwRpcError(error);
}

export async function updateProteinOption(sessionToken, optionId, { name, priceAdjustment }) {
  const { error } = await supabase.rpc("admin_update_protein_option", {
    p_session_token: sessionToken,
    p_option_id: optionId,
    p_name: name,
    p_price_adjustment: priceAdjustment,
  });

  throwRpcError(error);
}

export async function setProteinOptionActive(sessionToken, optionId, isActive) {
  const { error } = await supabase.rpc("admin_set_protein_option_active", {
    p_session_token: sessionToken,
    p_option_id: optionId,
    p_is_active: isActive,
  });

  throwRpcError(error);
}
