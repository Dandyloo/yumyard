import { MENU_CATEGORIES, MENU_ITEMS } from "./data/menu.js";
import { icon } from "./ui/icons.js";

const currency = new Intl.NumberFormat("en-GH", {
  style: "currency",
  currency: "GHS",
  minimumFractionDigits: 2,
});

const STORAGE_KEY = "yumyard-demo-orders";

const state = {
  activeCategoryId: "all-items",
  activePage: "pos",
  cart: [],
  orders: JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"),
  checkout: createCheckoutState(),
};

function createCheckoutState() {
  return {
    fulfillmentType: "walk-in",
    source: "direct-pos",
    paymentStatus: "unpaid",
    paymentMethod: "cash",
    customerName: "",
    customerPhone: "",
    deliveryAddress: "",
    deliveryFee: 0,
    riderName: "",
    notes: "",
  };
}

export function renderApp(root) {
  root.innerHTML = renderLayout();
  bindAppEvents(root);
}

function renderLayout() {
  if (state.activePage === "admin") {
    return renderAdminPortal();
  }

  if (state.activePage === "lock") {
    return renderLockScreen();
  }

  return `
    <div class="pos-application">
      ${renderPosTopbar()}
      ${state.activePage === "orders" ? renderOrdersWorkspace() : renderPosWorkspace()}
    </div>
  `;
}

function renderPosTopbar() {
  const activeOrderCount = state.orders.filter(
    (order) => order.status !== "completed",
  ).length;

  return `
    <header class="pos-topbar">
      <button class="brand-button" type="button" data-go-pos aria-label="Start a new order">
        <img src="/yumyard-logo.png" alt="Yum Yard" class="topbar-logo" />
        <span class="brand-divider"></span>
        <span class="brand-label">POS</span>
      </button>

      <div class="topbar-center">
        <button class="topbar-tab ${state.activePage === "pos" ? "is-active" : ""}" type="button" data-go-pos>
          ${icon("cart")}
          <span>New order</span>
        </button>
        <button class="topbar-tab ${state.activePage === "orders" ? "is-active" : ""}" type="button" data-go-orders>
          ${icon("orders")}
          <span>Orders</span>
          ${activeOrderCount ? `<b>${activeOrderCount}</b>` : ""}
        </button>
      </div>

      <div class="topbar-utilities">
        <span class="connection-indicator" title="Internet connection active">
          <i></i>
          ${icon("wifi")}
          <span>Online</span>
        </span>
        <button class="utility-button" type="button" data-go-lock>
          ${icon("lock")}
          <span>Lock</span>
        </button>
      </div>
    </header>
  `;
}

function renderPosWorkspace() {
  return `
    <main class="pos-workspace">
      <aside class="category-rail" aria-label="Menu categories">
        <div class="rail-heading">
          <span>Menu</span>
        </div>

        <div class="category-list">
          ${MENU_CATEGORIES.map(
            (category) => `
              <button
                class="category-button ${state.activeCategoryId === category.id ? "is-active" : ""}"
                type="button"
                data-category="${category.id}"
              >
                <span>${category.name}</span>
                <small>${getCategoryCount(category.id)}</small>
              </button>
            `,
          ).join("")}
        </div>

        <div class="rail-footer">
          <p>Yum Yard</p>
          <span>Abura, Cape Coast</span>
        </div>
      </aside>

      <section class="product-workspace">
        <div class="workspace-heading">
          <div>
            <p class="section-kicker">Create order</p>
            <h1>${getActiveCategoryName()}</h1>
          </div>
          <div class="product-search">
            ${icon("search")}
            <input type="search" placeholder="Search menu" aria-label="Search menu" id="menu-search" />
          </div>
        </div>

        <div class="product-grid" id="product-grid">
          ${renderProductCards(getVisibleProducts())}
        </div>
      </section>

      <aside class="order-panel">
        ${renderOrderPanel()}
      </aside>
    </main>
  `;
}

function renderProductCards(items) {
  if (!items.length) {
    return `
      <div class="products-empty">
        ${icon("search")}
        <h2>No matching items</h2>
        <p>Try another item name or select a different category.</p>
      </div>
    `;
  }

  return items
    .map(
      (item) => `
        <button class="product-card" type="button" data-add-item="${item.id}">
          <div class="product-image ${item.image ? "has-image" : ""}">
            ${
              item.image
                ? `<img src="${item.image}" alt="" loading="lazy" />`
                : `<span>${getInitials(item.name)}</span>`
            }
          </div>
          <div class="product-card-content">
            <h2>${item.name}</h2>
            <p>${item.description}</p>
            <div class="product-card-bottom">
              <strong>${formatMoney(item.price)}</strong>
              <span class="add-product-icon">${icon("add")}</span>
            </div>
          </div>
        </button>
      `,
    )
    .join("");
}

function renderOrderPanel() {
  const hasItems = state.cart.length > 0;
  const itemCount = getCartCount();

  return `
    <div class="order-panel-header">
      <div>
        <p class="section-kicker">Current order</p>
        <h2>Order details</h2>
      </div>
      ${
        hasItems
          ? `
            <button class="clear-order-button" type="button" data-clear-order>
              ${icon("trash")}
              <span>Clear</span>
            </button>
          `
          : ""
      }
    </div>

    <div class="order-panel-content">
      ${
        hasItems
          ? `
            <div class="order-item-list">
              ${state.cart.map((item) => renderCartItem(item)).join("")}
            </div>
          `
          : `
            <div class="order-empty">
              <div class="empty-outline-icon">${icon("cart")}</div>
              <h3>No items added</h3>
              <p>Select an item from the menu to start an order.</p>
            </div>
          `
      }
    </div>

    <div class="order-panel-footer">
      <div class="order-item-count">
        <span>${itemCount} item${itemCount === 1 ? "" : "s"}</span>
        <strong>${formatMoney(getCartSubtotal())}</strong>
      </div>

      <div class="order-total-row">
        <span>Total</span>
        <strong>${formatMoney(getOrderTotal())}</strong>
      </div>

      <button class="checkout-button" type="button" data-open-checkout ${hasItems ? "" : "disabled"}>
        <span>Checkout</span>
        <strong>${formatMoney(getOrderTotal())}</strong>
        ${icon("arrowRight")}
      </button>
    </div>
  `;
}

function renderCartItem(item) {
  return `
    <article class="order-item">
      <div class="order-item-copy">
        <h3>${item.name}</h3>
        ${item.protein ? `<p>${item.protein}</p>` : ""}
        <strong>${formatMoney(item.price)}</strong>
      </div>

      <div class="order-item-controls">
        <div class="quantity-stepper">
          <button type="button" data-decrease-item="${item.cartId}" aria-label="Decrease ${item.name}">
            ${icon("minus")}
          </button>
          <span>${item.quantity}</span>
          <button type="button" data-increase-item="${item.cartId}" aria-label="Increase ${item.name}">
            ${icon("add")}
          </button>
        </div>

        <button class="remove-order-item" type="button" data-remove-item="${item.cartId}" aria-label="Remove ${item.name}">
          ${icon("close")}
        </button>
      </div>
    </article>
  `;
}

function renderOrdersWorkspace() {
  const activeOrders = state.orders.filter(
    (order) => order.status !== "completed",
  );
  const completedOrders = state.orders.filter(
    (order) => order.status === "completed",
  );

  return `
    <main class="orders-workspace">
      <div class="orders-header">
        <div>
          <p class="section-kicker">Order management</p>
          <h1>Active orders</h1>
        </div>

        <button class="new-order-button" type="button" data-go-pos>
          ${icon("add")}
          <span>New order</span>
        </button>
      </div>

      <div class="order-status-summary">
        ${renderOrderStatusSummary("confirmed", "Confirmed")}
        ${renderOrderStatusSummary("preparing", "Preparing")}
        ${renderOrderStatusSummary("ready", "Ready")}
        ${renderOrderStatusSummary("awaiting_pickup", "Awaiting pickup")}
        ${renderOrderStatusSummary("out_for_delivery", "Delivery")}
      </div>

      ${
        activeOrders.length
          ? `<section class="orders-list">${activeOrders.map((order) => renderOrderCard(order)).join("")}</section>`
          : `
            <section class="orders-empty">
              <div class="empty-outline-icon">${icon("check")}</div>
              <h2>No active orders</h2>
              <p>New orders created on the POS will appear here.</p>
              <button class="new-order-button" type="button" data-go-pos>
                ${icon("add")}
                <span>Create order</span>
              </button>
            </section>
          `
      }

      ${
        completedOrders.length
          ? `
            <section class="completed-orders-note">
              <span>${icon("receipt")}</span>
              <p><strong>${completedOrders.length}</strong> completed order${completedOrders.length === 1 ? "" : "s"} stored locally in this prototype.</p>
            </section>
          `
          : ""
      }
    </main>
  `;
}

function renderOrderStatusSummary(status, label) {
  const count = state.orders.filter((order) => order.status === status).length;

  return `
    <div class="status-summary-item">
      <span class="status-dot status-dot-${status}"></span>
      <span>${label}</span>
      <strong>${count}</strong>
    </div>
  `;
}

function renderOrderCard(order) {
  const statusLabels = {
    confirmed: "Confirmed",
    preparing: "Preparing",
    ready: "Ready",
    awaiting_pickup: "Awaiting pickup",
    out_for_delivery: "Out for delivery",
  };

  const nextStatusMap = {
    confirmed: { value: "preparing", label: "Start preparing" },
    preparing: { value: "ready", label: "Mark ready" },
    ready:
      order.fulfillmentType === "delivery"
        ? { value: "out_for_delivery", label: "Send with rider" }
        : { value: "awaiting_pickup", label: "Await pickup" },
    awaiting_pickup: { value: "completed", label: "Complete order" },
    out_for_delivery: { value: "completed", label: "Mark delivered" },
  };

  const nextAction = nextStatusMap[order.status];

  return `
    <article class="active-order-card">
      <div class="active-order-head">
        <div>
          <span class="order-reference">${order.orderNumber}</span>
          <h2>${formatMoney(order.total)}</h2>
        </div>
        <span class="status-pill status-${order.status}">${statusLabels[order.status]}</span>
      </div>

      <div class="active-order-meta">
        <span>${getFulfillmentIcon(order.fulfillmentType)} ${formatFulfillment(order.fulfillmentType)}</span>
        <span class="${order.paymentStatus === "paid" ? "paid-text" : "unpaid-text"}">
          ${order.paymentStatus === "paid" ? "Paid" : "Payment pending"}
        </span>
        <span>${formatSource(order.source)}</span>
      </div>

      <div class="active-order-items">
        ${order.items
          .map(
            (item) => `
              <p>
                <span>${item.quantity} × ${item.name}${item.protein ? ` · ${item.protein}` : ""}</span>
                <strong>${formatMoney(item.price * item.quantity)}</strong>
              </p>
            `,
          )
          .join("")}
      </div>

      ${
        order.deliveryAddress || order.customerName || order.customerPhone
          ? `
            <div class="order-customer-details">
              ${
                order.customerName || order.customerPhone
                  ? `<p>${icon("user")} <span>${escapeHtml(order.customerName || "Customer")}${order.customerPhone ? ` · ${escapeHtml(order.customerPhone)}` : ""}</span></p>`
                  : ""
              }
              ${
                order.deliveryAddress
                  ? `<p>${icon("delivery")} <span>${escapeHtml(order.deliveryAddress)}</span></p>`
                  : ""
              }
            </div>
          `
          : ""
      }

      <div class="active-order-actions">
        <button class="outline-action-button" type="button" data-view-order="${order.id}">
          ${icon("receipt")}
          <span>View</span>
        </button>
        ${
          nextAction
            ? `
              <button
                class="solid-action-button"
                type="button"
                data-update-order="${order.id}"
                data-next-status="${nextAction.value}"
              >
                <span>${nextAction.label}</span>
                ${icon("arrowRight")}
              </button>
            `
            : ""
        }
      </div>
    </article>
  `;
}

function renderLockScreen() {
  return `
    <main class="lock-screen">
      <section class="lock-card">
        <img src="/yumyard-logo.png" alt="Yum Yard" class="lock-logo" />
        <p class="section-kicker">Yum Yard POS</p>
        <h1>Tablet locked</h1>
        <p class="lock-copy">Enter the shared tablet PIN to continue taking orders.</p>

        <form class="pin-form" id="pin-form">
          <label for="tablet-pin">Tablet PIN</label>
          <input id="tablet-pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" type="password" placeholder="Enter PIN" autofocus required />
          <button class="checkout-button" type="submit">
            <span>Unlock POS</span>
            ${icon("arrowRight")}
          </button>
        </form>

        <p class="lock-note">The PIN check will be connected to Supabase in the authentication milestone.</p>
      </section>
    </main>
  `;
}

function renderAdminPortal() {
  return `
    <main class="admin-preview">
      <header class="admin-preview-header">
        <button class="admin-brand" type="button" data-go-pos>
          <img src="/yumyard-logo.png" alt="Yum Yard" />
          <span>Yum Yard Admin</span>
        </button>
        <button class="outline-action-button" type="button" data-go-pos>
          ${icon("back")}
          <span>POS preview</span>
        </button>
      </header>

      <section class="admin-preview-content">
        <p class="section-kicker">Owner workspace</p>
        <h1>Admin portal</h1>
        <p class="admin-preview-copy">
          This is deliberately separate from the tablet POS. Betty will use this mobile-first area to manage menu items, prices, inventory, riders, delivery defaults, sales, and reports.
        </p>

        <div class="admin-preview-grid">
          <article>
            ${icon("orders")}
            <h2>Orders</h2>
            <p>Search history, follow unpaid balances, and resolve delivery issues.</p>
          </article>
          <article>
            ${icon("edit")}
            <h2>Menu</h2>
            <p>Add products, update prices, and toggle an item unavailable.</p>
          </article>
          <article>
            ${icon("settings")}
            <h2>Inventory</h2>
            <p>Record stock, waste, physical counts, and recipe-based usage.</p>
          </article>
          <article>
            ${icon("delivery")}
            <h2>Delivery</h2>
            <p>Manage riders and optional saved delivery-fee defaults.</p>
          </article>
        </div>

        <button class="checkout-button admin-preview-button" type="button" data-go-pos>
          <span>Return to POS</span>
          ${icon("arrowRight")}
        </button>
      </section>
    </main>
  `;
}

function bindAppEvents(root) {
  root.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeCategoryId = button.dataset.category;
      renderApp(root);
    });
  });

  root.querySelectorAll("[data-add-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = MENU_ITEMS.find(
        (menuItem) => menuItem.id === button.dataset.addItem,
      );
      if (!item) return;

      if (item.requiresProtein) {
        openProteinModal(root, item);
        return;
      }

      addToCart(root, item);
    });
  });

  root.querySelectorAll("[data-increase-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.cart.find(
        (cartItem) => cartItem.cartId === button.dataset.increaseItem,
      );
      if (!item) return;
      item.quantity += 1;
      renderApp(root);
    });
  });

  root.querySelectorAll("[data-decrease-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.cart.find(
        (cartItem) => cartItem.cartId === button.dataset.decreaseItem,
      );
      if (!item) return;

      if (item.quantity === 1) {
        state.cart = state.cart.filter(
          (cartItem) => cartItem.cartId !== item.cartId,
        );
      } else {
        item.quantity -= 1;
      }

      renderApp(root);
    });
  });

  root.querySelectorAll("[data-remove-item]").forEach((button) => {
    button.addEventListener("click", () => {
      state.cart = state.cart.filter(
        (item) => item.cartId !== button.dataset.removeItem,
      );
      renderApp(root);
    });
  });

  root.querySelector("[data-clear-order]")?.addEventListener("click", () => {
    if (!state.cart.length) return;

    const shouldClear = window.confirm(
      "Clear all items from this current order?",
    );
    if (!shouldClear) return;

    state.cart = [];
    state.checkout = createCheckoutState();
    renderApp(root);
  });

  root.querySelector("[data-open-checkout]")?.addEventListener("click", () => {
    if (state.cart.length) openCheckoutModal(root);
  });

  root.querySelectorAll("[data-go-pos]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activePage = "pos";
      renderApp(root);
    });
  });

  root.querySelectorAll("[data-go-orders]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activePage = "orders";
      renderApp(root);
    });
  });

  root.querySelectorAll("[data-go-lock]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activePage = "lock";
      renderApp(root);
    });
  });

  root.querySelectorAll("[data-update-order]").forEach((button) => {
    button.addEventListener("click", () => {
      updateOrderStatus(
        root,
        button.dataset.updateOrder,
        button.dataset.nextStatus,
      );
    });
  });

  root.querySelectorAll("[data-view-order]").forEach((button) => {
    button.addEventListener("click", () => {
      const order = state.orders.find(
        (item) => item.id === button.dataset.viewOrder,
      );
      if (order) openOrderReceiptModal(order);
    });
  });

  const searchInput = root.querySelector("#menu-search");
  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      const productGrid = root.querySelector("#product-grid");
      productGrid.innerHTML = renderProductCards(
        getVisibleProducts(event.target.value),
      );
      bindProductCardEvents(root);
    });
  }

  root.querySelector("#pin-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    state.activePage = "pos";
    renderApp(root);
  });
}

function bindProductCardEvents(root) {
  root.querySelectorAll("[data-add-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = MENU_ITEMS.find(
        (menuItem) => menuItem.id === button.dataset.addItem,
      );
      if (!item) return;

      if (item.requiresProtein) {
        openProteinModal(root, item);
        return;
      }

      addToCart(root, item);
    });
  });
}

function openProteinModal(root, item) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="modal-card protein-modal" role="dialog" aria-modal="true" aria-labelledby="protein-modal-title">
      <button class="modal-close-button" type="button" data-close-modal aria-label="Close selection">
        ${icon("close")}
      </button>

      <div class="modal-heading">
        <p class="section-kicker">Required selection</p>
        <h2 id="protein-modal-title">Choose a protein</h2>
        <p>${item.name} has the same price with tilapia or chicken.</p>
      </div>

      <div class="protein-selection-grid">
        ${item.proteinOptions
          .map(
            (protein) => `
              <button class="protein-selection-button" type="button" data-select-protein="${protein}">
                <span>${protein}</span>
                <small>Included in pack</small>
                ${icon("arrowRight")}
              </button>
            `,
          )
          .join("")}
      </div>
    </section>
  `;

  document.body.append(modal);

  modal
    .querySelector("[data-close-modal]")
    .addEventListener("click", () => modal.remove());

  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });

  modal.querySelectorAll("[data-select-protein]").forEach((button) => {
    button.addEventListener("click", () => {
      addToCart(root, item, button.dataset.selectProtein);
      modal.remove();
    });
  });
}

function openCheckoutModal(root) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = renderCheckoutModal();

  document.body.append(modal);
  bindCheckoutModal(root, modal);
}

function renderCheckoutModal() {
  return `
    <section class="modal-card checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
      <button class="modal-close-button" type="button" data-close-modal aria-label="Close checkout">
        ${icon("close")}
      </button>

      <div class="modal-heading">
        <p class="section-kicker">Complete order</p>
        <h2 id="checkout-title">Checkout</h2>
        <p>Choose fulfillment and record payment only when it has been received.</p>
      </div>

      <form id="checkout-form" class="checkout-form">
        <div class="checkout-section">
          <label class="form-section-label">Fulfillment</label>
          <div class="selection-grid selection-grid-four">
            ${renderFulfillmentButton("walk-in", "Walk-in", "cart")}
            ${renderFulfillmentButton("pickup", "Pickup", "pickup")}
            ${renderFulfillmentButton("delivery", "Delivery", "delivery")}
            ${renderFulfillmentButton("dine-in", "Dine-in", "dineIn")}
          </div>
        </div>

        <div class="checkout-field-grid">
          <label class="form-field">
            <span>Order source</span>
            <select name="source">
              <option value="direct-pos" ${selected("direct-pos", state.checkout.source)}>Direct POS</option>
              <option value="phone-call" ${selected("phone-call", state.checkout.source)}>Phone call</option>
              <option value="whatsapp" ${selected("whatsapp", state.checkout.source)}>WhatsApp</option>
              <option value="hubtel" ${selected("hubtel", state.checkout.source)}>Hubtel</option>
              <option value="other" ${selected("other", state.checkout.source)}>Other</option>
            </select>
          </label>

          <label class="form-field">
            <span>Payment status</span>
            <select name="paymentStatus" id="payment-status">
              <option value="unpaid" ${selected("unpaid", state.checkout.paymentStatus)}>Unpaid</option>
              <option value="paid" ${selected("paid", state.checkout.paymentStatus)}>Paid</option>
            </select>
          </label>
        </div>

        <div class="checkout-field-grid">
          <label class="form-field">
            <span>Customer name <em>Optional</em></span>
            <input name="customerName" value="${escapeHtml(state.checkout.customerName)}" placeholder="Customer name" autocomplete="off" />
          </label>

          <label class="form-field">
            <span>Phone number <em>Optional</em></span>
            <input name="customerPhone" value="${escapeHtml(state.checkout.customerPhone)}" placeholder="054 000 0000" inputmode="tel" autocomplete="off" />
          </label>
        </div>

        <div id="delivery-fields">${renderDeliveryFields()}</div>
        <div id="payment-fields">${renderPaymentFields()}</div>

        <label class="form-field">
          <span>Order note <em>Optional</em></span>
          <textarea name="notes" rows="2" placeholder="Special request or delivery instruction">${escapeHtml(state.checkout.notes)}</textarea>
        </label>

        <div class="checkout-summary">
          <div>
            <span>Food subtotal</span>
            <strong>${formatMoney(getCartSubtotal())}</strong>
          </div>
          <div class="${state.checkout.fulfillmentType === "delivery" ? "" : "summary-muted"}">
            <span>Delivery fee</span>
            <strong>${formatMoney(getDeliveryFee())}</strong>
          </div>
          <div class="checkout-summary-total">
            <span>Total payable</span>
            <strong>${formatMoney(getOrderTotal())}</strong>
          </div>
        </div>

        <button class="checkout-button checkout-confirm-button" type="submit">
          <span>Confirm order</span>
          <strong>${formatMoney(getOrderTotal())}</strong>
          ${icon("arrowRight")}
        </button>
      </form>
    </section>
  `;
}

function renderFulfillmentButton(value, label, iconName) {
  return `
    <button
      class="fulfillment-button ${state.checkout.fulfillmentType === value ? "is-active" : ""}"
      type="button"
      data-fulfillment="${value}"
    >
      ${icon(iconName)}
      <span>${label}</span>
    </button>
  `;
}

function renderDeliveryFields() {
  if (state.checkout.fulfillmentType !== "delivery") return "";

  return `
    <section class="delivery-fields-box">
      <div class="delivery-fields-title">
        ${icon("delivery")}
        <span>Delivery details</span>
      </div>

      <div class="checkout-field-grid">
        <label class="form-field">
          <span>Delivery fee</span>
          <input
            name="deliveryFee"
            type="number"
            min="0"
            step="0.01"
            value="${Number(state.checkout.deliveryFee || 0)}"
            inputmode="decimal"
            required
          />
        </label>

        <label class="form-field">
          <span>Rider <em>Optional</em></span>
          <input name="riderName" value="${escapeHtml(state.checkout.riderName)}" placeholder="Assign later" autocomplete="off" />
        </label>
      </div>

      <label class="form-field">
        <span>Location / landmark</span>
        <input
          name="deliveryAddress"
          value="${escapeHtml(state.checkout.deliveryAddress)}"
          placeholder="e.g. UCC, Kotokuraba, near..."
          autocomplete="off"
          required
        />
      </label>
    </section>
  `;
}

function renderPaymentFields() {
  if (state.checkout.paymentStatus !== "paid") {
    return `
      <div class="unpaid-info-box">
        <span>${icon("receipt")}</span>
        <p>The order will be recorded as unpaid. Payment can be captured when the customer picks up or receives the food.</p>
      </div>
    `;
  }

  return `
    <div class="checkout-section">
      <label class="form-section-label">Payment method</label>
      <div class="payment-method-grid">
        ${renderPaymentMethodButton("cash", "Cash")}
        ${renderPaymentMethodButton("momo", "Mobile Money")}
        ${renderPaymentMethodButton("hubtel", "Hubtel")}
      </div>
    </div>
  `;
}

function renderPaymentMethodButton(value, label) {
  return `
    <button
      class="payment-method-button ${state.checkout.paymentMethod === value ? "is-active" : ""}"
      type="button"
      data-payment-method="${value}"
    >
      <span>${label}</span>
      ${state.checkout.paymentMethod === value ? icon("check") : ""}
    </button>
  `;
}

function bindCheckoutModal(root, modal) {
  const form = modal.querySelector("#checkout-form");

  modal
    .querySelector("[data-close-modal]")
    .addEventListener("click", () => modal.remove());

  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });

  modal.querySelectorAll("[data-fulfillment]").forEach((button) => {
    button.addEventListener("click", () => {
      state.checkout.fulfillmentType = button.dataset.fulfillment;

      if (state.checkout.fulfillmentType !== "delivery") {
        state.checkout.deliveryFee = 0;
        state.checkout.deliveryAddress = "";
        state.checkout.riderName = "";
      }

      modal.innerHTML = renderCheckoutModal();
      bindCheckoutModal(root, modal);
    });
  });

  modal.querySelectorAll("[data-payment-method]").forEach((button) => {
    button.addEventListener("click", () => {
      state.checkout.paymentMethod = button.dataset.paymentMethod;
      modal.innerHTML = renderCheckoutModal();
      bindCheckoutModal(root, modal);
    });
  });

  form.addEventListener("change", (event) => {
    if (event.target.name !== "paymentStatus") return;

    state.checkout.paymentStatus = event.target.value;
    modal.innerHTML = renderCheckoutModal();
    bindCheckoutModal(root, modal);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const formData = new FormData(form);

    state.checkout.source = formData.get("source");
    state.checkout.paymentStatus = formData.get("paymentStatus");
    state.checkout.customerName = formData.get("customerName").trim();
    state.checkout.customerPhone = formData.get("customerPhone").trim();
    state.checkout.deliveryAddress = (
      formData.get("deliveryAddress") || ""
    ).trim();
    state.checkout.deliveryFee = Number(formData.get("deliveryFee") || 0);
    state.checkout.riderName = (formData.get("riderName") || "").trim();
    state.checkout.notes = formData.get("notes").trim();

    if (
      state.checkout.fulfillmentType === "delivery" &&
      !state.checkout.deliveryAddress
    ) {
      window.alert(
        "Enter a delivery location or landmark before confirming this order.",
      );
      return;
    }

    const order = createOrder();
    modal.remove();

    state.activePage = "orders";
    renderApp(root);
    openOrderReceiptModal(order);
  });
}

function createOrder() {
  const isDelivery = state.checkout.fulfillmentType === "delivery";
  const order = {
    id: createId("order"),
    orderNumber: createOrderNumber(),
    createdAt: new Date().toISOString(),
    status: "confirmed",
    fulfillmentType: state.checkout.fulfillmentType,
    source: state.checkout.source,
    customerName: state.checkout.customerName,
    customerPhone: state.checkout.customerPhone,
    deliveryAddress: isDelivery ? state.checkout.deliveryAddress : "",
    deliveryFee: isDelivery ? Number(state.checkout.deliveryFee || 0) : 0,
    riderName: isDelivery ? state.checkout.riderName : "",
    paymentStatus: state.checkout.paymentStatus,
    paymentMethod:
      state.checkout.paymentStatus === "paid"
        ? state.checkout.paymentMethod
        : null,
    notes: state.checkout.notes,
    items: state.cart.map((item) => ({ ...item })),
    subtotal: getCartSubtotal(),
    total: getOrderTotal(),
  };

  state.orders.unshift(order);
  persistOrders();

  state.cart = [];
  state.checkout = createCheckoutState();

  return order;
}

function openOrderReceiptModal(order) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="modal-card receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
      <button class="modal-close-button" type="button" data-close-modal aria-label="Close order summary">
        ${icon("close")}
      </button>

      <div class="receipt-header">
        <img src="/yumyard-logo.png" alt="Yum Yard" />
        <div>
          <p class="section-kicker">Order confirmed</p>
          <h2 id="receipt-title">${order.orderNumber}</h2>
          <span>${formatFulfillment(order.fulfillmentType)} · ${formatSource(order.source)}</span>
        </div>
      </div>

      <div class="receipt-content">
        ${order.items
          .map(
            (item) => `
              <div class="receipt-line">
                <span>${item.quantity} × ${item.name}${item.protein ? ` · ${item.protein}` : ""}</span>
                <strong>${formatMoney(item.price * item.quantity)}</strong>
              </div>
            `,
          )
          .join("")}
      </div>

      <div class="receipt-summary">
        <div>
          <span>Food subtotal</span>
          <strong>${formatMoney(order.subtotal)}</strong>
        </div>
        ${
          order.deliveryFee
            ? `
              <div>
                <span>Delivery fee</span>
                <strong>${formatMoney(order.deliveryFee)}</strong>
              </div>
            `
            : ""
        }
        <div class="receipt-grand-total">
          <span>Total</span>
          <strong>${formatMoney(order.total)}</strong>
        </div>
      </div>

      <div class="receipt-status-row">
        <span class="${order.paymentStatus === "paid" ? "receipt-paid" : "receipt-unpaid"}">
          ${order.paymentStatus === "paid" ? `Paid · ${formatPaymentMethod(order.paymentMethod)}` : "Payment pending"}
        </span>
        <span class="receipt-date">${new Intl.DateTimeFormat("en-GH", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(order.createdAt))}</span>
      </div>

      ${
        order.deliveryAddress
          ? `<p class="receipt-detail">${icon("delivery")} <span>${escapeHtml(order.deliveryAddress)}${order.riderName ? ` · Rider: ${escapeHtml(order.riderName)}` : ""}</span></p>`
          : ""
      }
      ${
        order.notes
          ? `<p class="receipt-detail">${icon("edit")} <span>${escapeHtml(order.notes)}</span></p>`
          : ""
      }

      <div class="receipt-actions">
        <button class="outline-action-button" type="button" data-copy-summary>
          ${icon("receipt")}
          <span>Copy summary</span>
        </button>
        <button class="solid-action-button" type="button" data-close-modal>
          <span>Done</span>
          ${icon("check")}
        </button>
      </div>
    </section>
  `;

  document.body.append(modal);

  modal.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => modal.remove());
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });

  modal
    .querySelector("[data-copy-summary]")
    ?.addEventListener("click", async (event) => {
      try {
        await navigator.clipboard.writeText(buildShareSummary(order));
        event.currentTarget.querySelector("span").textContent = "Copied";
      } catch {
        window.prompt("Copy this order summary:", buildShareSummary(order));
      }
    });
}

function updateOrderStatus(root, orderId, nextStatus) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return;

  order.status = nextStatus;
  persistOrders();
  renderApp(root);
}

function addToCart(root, item, protein = null) {
  const existingItem = state.cart.find(
    (cartItem) =>
      cartItem.menuItemId === item.id && cartItem.protein === protein,
  );

  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    state.cart.push({
      cartId: createId("cart"),
      menuItemId: item.id,
      name: item.name,
      price: item.price,
      protein,
      quantity: 1,
    });
  }

  renderApp(root);
}

function getVisibleProducts(searchTerm = "") {
  const normalizedSearch = searchTerm.trim().toLowerCase();

  return MENU_ITEMS.filter((item) => {
    const categoryMatches =
      state.activeCategoryId === "all-items" ||
      item.categoryId === state.activeCategoryId;

    const searchMatches =
      !normalizedSearch ||
      item.name.toLowerCase().includes(normalizedSearch) ||
      item.description.toLowerCase().includes(normalizedSearch);

    return categoryMatches && searchMatches;
  });
}

function getCategoryCount(categoryId) {
  if (categoryId === "all-items") return MENU_ITEMS.length;
  return MENU_ITEMS.filter((item) => item.categoryId === categoryId).length;
}

function getActiveCategoryName() {
  return (
    MENU_CATEGORIES.find((category) => category.id === state.activeCategoryId)
      ?.name || "Menu"
  );
}

function getCartSubtotal() {
  return state.cart.reduce(
    (total, item) => total + item.price * item.quantity,
    0,
  );
}

function getCartCount() {
  return state.cart.reduce((count, item) => count + item.quantity, 0);
}

function getDeliveryFee() {
  return state.checkout.fulfillmentType === "delivery"
    ? Number(state.checkout.deliveryFee || 0)
    : 0;
}

function getOrderTotal() {
  return getCartSubtotal() + getDeliveryFee();
}

function createOrderNumber() {
  const datePart = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replaceAll("-", "");

  const todaysOrders = state.orders.filter((order) =>
    order.createdAt.startsWith(new Date().toISOString().slice(0, 10)),
  );
  return `YY-${datePart}-${String(todaysOrders.length + 1).padStart(3, "0")}`;
}

function getInitials(name) {
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getFulfillmentIcon(type) {
  const icons = {
    "walk-in": icon("cart"),
    pickup: icon("pickup"),
    delivery: icon("delivery"),
    "dine-in": icon("dineIn"),
  };

  return icons[type] || icon("cart");
}

function formatMoney(value) {
  return currency.format(Number(value || 0));
}

function formatFulfillment(value) {
  const labels = {
    "walk-in": "Walk-in",
    pickup: "Pickup",
    delivery: "Delivery",
    "dine-in": "Dine-in",
  };

  return labels[value] || value;
}

function formatSource(value) {
  const labels = {
    "direct-pos": "Direct POS",
    "phone-call": "Phone",
    whatsapp: "WhatsApp",
    hubtel: "Hubtel",
    other: "Other",
  };

  return labels[value] || value;
}

function formatPaymentMethod(value) {
  const labels = {
    cash: "Cash",
    momo: "MoMo",
    hubtel: "Hubtel",
  };

  return labels[value] || value || "";
}

function selected(value, currentValue) {
  return value === currentValue ? "selected" : "";
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function persistOrders() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.orders));
}

function buildShareSummary(order) {
  const items = order.items
    .map(
      (item) =>
        `${item.quantity}x ${item.name}${item.protein ? ` (${item.protein})` : ""} — ${formatMoney(item.price * item.quantity)}`,
    )
    .join("\n");

  return [
    `YUM YARD — ${order.orderNumber}`,
    "Abura, Science Taxi Rank Exit",
    "",
    items,
    order.deliveryFee ? `Delivery fee — ${formatMoney(order.deliveryFee)}` : "",
    `TOTAL — ${formatMoney(order.total)}`,
    `Payment — ${
      order.paymentStatus === "paid"
        ? `${formatPaymentMethod(order.paymentMethod)} paid`
        : "Pending"
    }`,
    `Fulfillment — ${formatFulfillment(order.fulfillmentType)}`,
    order.deliveryAddress ? `Delivery location — ${order.deliveryAddress}` : "",
    "",
    "Call / WhatsApp: 0544603124",
  ]
    .filter(Boolean)
    .join("\n");
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function openAdminPreview(root) {
  state.activePage = "admin";
  renderApp(root);
}
