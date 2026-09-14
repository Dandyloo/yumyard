import { supabase } from "../lib/supabase.js";

export async function getPosMenu(branchId) {
  const [categoriesResponse, itemsResponse, proteinsResponse] = await Promise.all([
    supabase
      .from("menu_categories")
      .select("id, name, slug, sort_order")
      .eq("branch_id", branchId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),

    supabase
      .from("menu_items")
      .select(
        "id, category_id, name, slug, description, base_price, image_url, requires_protein, sort_order",
      )
      .eq("branch_id", branchId)
      .eq("is_available", true)
      .eq("is_archived", false)
      .order("sort_order", { ascending: true }),

    supabase
      .from("menu_item_protein_options")
      .select("menu_item_id, name, price_adjustment, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ]);

  if (categoriesResponse.error) {
    throw new Error(categoriesResponse.error.message);
  }

  if (itemsResponse.error) {
    throw new Error(itemsResponse.error.message);
  }

  if (proteinsResponse.error) {
    throw new Error(proteinsResponse.error.message);
  }

  const proteinsByItemId = (proteinsResponse.data || []).reduce((result, option) => {
    if (!result[option.menu_item_id]) {
      result[option.menu_item_id] = [];
    }

    result[option.menu_item_id].push({
      name: option.name,
      priceAdjustment: Number(option.price_adjustment || 0),
    });

    return result;
  }, {});

  const categories = [
    {
      id: "all-items",
      name: "All items",
      dbId: null,
      sortOrder: 0,
    },
    ...(categoriesResponse.data || []).map((category) => ({
      id: category.slug,
      dbId: category.id,
      name: category.name,
      sortOrder: category.sort_order,
    })),
  ];

  const items = (itemsResponse.data || []).map((item) => ({
    id: item.id,
    categoryId: item.category_id,
    name: item.name,
    slug: item.slug,
    description: item.description || "",
    price: Number(item.base_price),
    image: item.image_url || "",
    requiresProtein: item.requires_protein,
    proteinOptions: proteinsByItemId[item.id] || [],
  }));

  return { categories, items };
}