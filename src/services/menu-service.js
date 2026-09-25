import { supabase } from "../lib/supabase.js";

export async function getPosMenu(branchId) {
  if (!branchId) {
    throw new Error("Branch ID is required to load the POS menu.");
  }

  const [categoriesResult, itemsResult, proteinsResult] = await Promise.all([
    supabase
      .from("menu_categories")
      .select("id,name,sort_order")
      .eq("branch_id", branchId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),

    supabase
      .from("menu_items")
      .select("id,name,description,base_price,image_url,category_id,requires_protein,is_available,is_archived")
      .eq("branch_id", branchId)
      .eq("is_available", true)
      .eq("is_archived", false)
      .order("name"),

    supabase
      .from("menu_item_protein_options")
      .select("id,name,price_adjustment,menu_item_id")
      .eq("is_active", true),
  ]);

  if (categoriesResult.error) throw categoriesResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (proteinsResult.error) throw proteinsResult.error;

  // Build categories (NO "All Items")
  const categories = categoriesResult.data.map((row) => ({
    id: `category-${row.id}`,
    name: row.name,
    dbId: row.id,
  }));

  // Build protein options map
  const proteinByItemId = new Map();
  for (const opt of proteinsResult.data) {
    const list = proteinByItemId.get(opt.menu_item_id) || [];
    list.push({
      id: opt.id,
      name: opt.name,
      priceAdjustment: Number(opt.price_adjustment),
    });
    proteinByItemId.set(opt.menu_item_id, list);
  }

  // Build items with prices
  const items = itemsResult.data
    .map((row) => {
      const opts = proteinByItemId.get(row.id) || [];

      // Skip items that require protein but have no options
      if (row.requires_protein && !opts.length) {
        return null;
      }

      // Use base_price or derive from cheapest protein
      let price = row.base_price != null ? Number(row.base_price) : 0;

      if (!price && opts.length) {
        price = Math.min(...opts.map((o) => o.priceAdjustment));
      }

      return {
        id: row.id,
        name: row.name,
        description: row.description,
        price,
        image: row.image_url,
        categoryId: `category-${row.category_id}`,
        requiresProtein: !!row.requires_protein,
        proteinOptions: opts,
      };
    })
    .filter(Boolean);

  return { categories, items };
}