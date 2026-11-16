import { formatMoney } from "./formatters.js";

// Shared by the POS close-day screen and the Admin "Daily Sales" tab.
// Turns the jsonb returned by admin_daily_product_sales / pos_day_product_sales
// into a view model, and renders the grouped "how many of each product" list.

export function normalizeProductSales(raw) {
  const data = raw || {};

  return {
    date: data.date || null,
    isToday: Boolean(data.is_today),
    ordersCount: Number(data.orders_count || 0),
    totalSales: Number(data.total_sales || 0),
    cancelledCount: Number(data.cancelled_count || 0),
    totalUnits: Number(data.total_units || 0),
    items: (data.items || []).map((item) => ({
      itemId: item.item_id,
      itemName: item.item_name,
      categoryName: item.category_name,
      quantity: Number(item.quantity || 0),
      revenue: Number(item.revenue || 0),
      orders: Number(item.orders || 0),
      proteins: (item.proteins || []).map((protein) => ({
        name: protein.name,
        quantity: Number(protein.quantity || 0),
      })),
    })),
  };
}

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderProductSalesList(sales, { emptyText = "No sales recorded." } = {}) {
  if (!sales.items.length) {
    return `<p class="menu-empty-state">${esc(emptyText)}</p>`;
  }

  // Items arrive already ordered by category then menu order.
  const groups = [];
  for (const item of sales.items) {
    let group = groups[groups.length - 1];
    if (!group || group.name !== item.categoryName) {
      group = { name: item.categoryName, units: 0, revenue: 0, items: [] };
      groups.push(group);
    }
    group.units += item.quantity;
    group.revenue += item.revenue;
    group.items.push(item);
  }

  return `
    <div class="ps-list">
      ${groups
        .map(
          (group) => `
            <section class="ps-group">
              <header class="ps-group-head">
                <h3>${esc(group.name)}</h3>
                <span>${group.units} sold · ${formatMoney(group.revenue)}</span>
              </header>
              ${group.items
                .map(
                  (item) => `
                    <div class="ps-row">
                      <div class="ps-row-main">
                        <strong>${esc(item.itemName)}</strong>
                        ${
                          item.proteins.length
                            ? `<small>${item.proteins
                                .map((protein) => `${esc(protein.name)} ${protein.quantity}`)
                                .join(" · ")}</small>`
                            : ""
                        }
                      </div>
                      <span class="ps-row-revenue">${formatMoney(item.revenue)}</span>
                      <span class="ps-row-qty" aria-label="${item.quantity} sold">${item.quantity}</span>
                    </div>
                  `,
                )
                .join("")}
            </section>
          `,
        )
        .join("")}
    </div>
  `;
}
