import "./style.css";
import { MENU_CATEGORIES, MENU_ITEMS } from "./data/menu.js";

const currency = new Intl.NumberFormat("en-GH", {
  style: "currency",
  currency: "GHS",
  minimumFractionDigits: 2,
});

const state = {
  activeCategoryId: "attieke-packs",
  cart: [],
  activePage: "pos",
  orders: JSON.parse(localStorage.getItem("yumyard-demo-orders") || "[]"),
  checkout: {
    fulfillmentType: "walk-in",
    source: "direct-pos",
    paymentStatus: "unpaid",
    paymentMethod: "cash",
    customerName: "",
    customerPhone: "",
    deliveryAddress: "",
    deliveryFee: 0,
    notes: "",
  },
};

const app = document.querySelector("#app");

function formatMoney(value) {
  return currency.format(value);
}

function createId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getCartSubtotal() {
  return state.cart.reduce((total, item) => total + item.price * item.quantity, 0);
}

function getCartCount() {
  return state.cart.reduce((total, item) => total + item.quantity, 0);
}

function getDeliveryFee() {
  return state.checkout.fulfillmentType === "delivery"
    ? Number(state.checkout.deliveryFee || 0)
    : 0;
}

function getOrderTotal() {
  return getCartSubtotal() + getDeliveryFee();
}

function getCategoryItems() {
  return MENU_ITEMS.filter((item) => item.categoryId === state.activeCategoryId);
}

function getPageTitle() {
  const pageTitles = {
    pos: "Point of Sale",
    orders: "Active Orders",
    inventory: "Inventory",
    reports: "Reports",
    more: "More",
  };

  return pageTitles[state.activePage] || "Yum Yard";
}

function render() {
  app.innerHTML = `
    <div class="app-shell">
      ${renderSidebar()}
      <main class="main-content">
        ${renderTopbar()}
        ${renderPage()}
      </main>
      ${renderMobileNavigation()}
    </div>
  `;

  bindEvents();
}

function renderSidebar() {
  const navItems = [
    { id: "pos", icon: "⊞", label: "POS" },
    { id: "orders", icon: "◷", label: "Orders", count: state.orders.filter((order) => order.status !== "completed").length },
    { id: "inventory", icon: "▤", label: "Inventory" },
    { id: "reports", icon: "◫", label: "Reports" },
    { id: "more", icon: "•••", label: "More" },
  ];

  return `
    <aside class="sidebar">
      <div class="brand">
        <img src="/yumyard-logo.jpg" alt="Yum Yard logo" class="brand-logo" />
        <div class="brand-copy">
          <span>Yum Yard</span>
          <small>POS & Inventory</small>
        </div>
      </div>

      <nav class="sidebar-nav" aria-label="Main navigation">
        ${navItems
          .map(
            (item) => `
              <button
                class="nav-item ${state.activePage === item.id ? "is-active" : ""}"
                type="button"
                data-page="${item.id}"
              >
                <span class="nav-icon">${item.icon}</span>
                <span>${item.label}</span>
                ${item.count ? `<span class="nav-count">${item.count}</span>` : ""}
              </button>
            `,
          )
          .join("")}
      </nav>

      <div class="sidebar-footer">
        <div class="tablet-status">
          <span class="status-dot"></span>
          <span>Tablet online</span>
        </div>
        <p>Abura, Science Taxi Rank Exit</p>
      </div>
    </aside>
  `;
}

function renderTopbar() {
  const today = new Intl.DateTimeFormat("en-GH", {
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(new Date());

  return `
    <header class="topbar">
      <div>
        <p class="eyebrow">${today}</p>
        <h1>${getPageTitle()}</h1>
      </div>
      <div class="topbar-actions">
        <button class="icon-button" id="new-order-button" type="button" aria-label="Start a new order">＋</button>
        <button class="operator-button" type="button">
          <span class="operator-avatar">Y</span>
          <span>Yum Yard Tablet</span>
        </button>
      </div>
    </header>
  `;
}

function renderPage() {
  if (state.activePage === "pos") {
    return renderPosPage();
  }

  if (state.activePage === "orders") {
    return renderOrdersPage();
  }

  return renderPlaceholderPage();
}

function renderPosPage() {
  return `
    <section class="pos-layout">
      <div class="menu-panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Build an order</p>
            <h2>Menu</h2>
          </div>
          <span class="menu-count">${MENU_ITEMS.length} items</span>
        </div>

        <div class="category-tabs" role="tablist" aria-label="Menu categories">
          ${MENU_CATEGORIES.map(
            (category) => `
              <button
                class="category-tab ${state.activeCategoryId === category.id ? "is-active" : ""}"
                type="button"
                data-category="${category.id}"
              >
                ${category.name}
              </button>
            `,
          ).join("")}
        </div>

        <div class="menu-grid">
          ${getCategoryItems()
            .map(
              (item) => `
                <article class="menu-card">
                  <div class="menu-card-top">
                    <div class="food-mark">${getFoodEmoji(item.categoryId)}</div>
                    ${item.badge ? `<span class="menu-badge">${item.badge}</span>` : ""}
                  </div>
                  <h3>${item.name}</h3>
                  <p>${item.description}</p>
                  <div class="menu-card-footer">
                    <strong>${formatMoney(item.price)}</strong>
                    <button class="add-button" type="button" data-add-item="${item.id}">
                      Add <span>＋</span>
                    </button>
                  </div>
                </article>
              `,
            )
            .join("")}
        </div>
      </div>

      <aside class="cart-panel">
        ${renderCart()}
      </aside>
    </section>
  `;
}

function getFoodEmoji(categoryId) {
  const icons = {
    "attieke-packs": "🍛",
    "banku-packs": "🍲",
    extras: "🍳",
    drinks: "🧃",
  };

  return icons[categoryId] || "🍽️";
}

function renderCart() {
  const isEmpty = state.cart.length === 0;

  return `
    <div class="cart-header">
      <div>
        <p class="eyebrow">Current sale</p>
        <h2>Order</h2>
      </div>
      <span class="cart-count">${getCartCount()} item${getCartCount() === 1 ? "" : "s"}</span>
    </div>

    <div class="cart-content">
      ${
        isEmpty
          ? `
            <div class="empty-cart">
              <div class="empty-cart-icon">🍽️</div>
              <h3>Your order is empty</h3>
              <p>Add a pack, extra, or drink from the menu to begin.</p>
            </div>
          `
          : `
            <div class="cart-items">
              ${state.cart
                .map(
                  (cartItem) => `
                    <article class="cart-item">
                      <div class="cart-item-main">
                        <h3>${cartItem.name}</h3>
                        ${cartItem.protein ? `<p>${cartItem.protein}</p>` : ""}
                        <strong>${formatMoney(cartItem.price)}</strong>
                      </div>
                      <div class="quantity-control">
                        <button type="button" data-decrease-item="${cartItem.cartId}" aria-label="Decrease quantity">−</button>
                        <span>${cartItem.quantity}</span>
                        <button type="button" data-increase-item="${cartItem.cartId}" aria-label="Increase quantity">＋</button>
                      </div>
                      <button class="remove-item" type="button" data-remove-item="${cartItem.cartId}" aria-label="Remove ${cartItem.name}">×</button>
                    </article>
                  `,
                )
                .join("")}
            </div>
          `
      }
    </div>

    <div class="cart-summary">
      <div class="summary-row">
        <span>Items subtotal</span>
        <strong>${formatMoney(getCartSubtotal())}</strong>
      </div>
      ${
        getDeliveryFee() > 0
          ? `
            <div class="summary-row">
              <span>Delivery fee</span>
              <strong>${formatMoney(getDeliveryFee())}</strong>
            </div>
          `
          : ""
      }
      <div class="summary-total">
        <span>Total</span>
        <strong>${formatMoney(getOrderTotal())}</strong>
      </div>
      <div class="cart-actions">
        <button class="secondary-button" id="clear-order-button" type="button" ${isEmpty ? "disabled" : ""}>
          Clear
        </button>
        <button class="primary-button" id="checkout-button" type="button" ${isEmpty ? "disabled" : ""}>
          Checkout <span>→</span>
        </button>
      </div>
    </div>
  `;
}

function renderOrdersPage() {
  const activeOrders = state.orders.filter((order) => order.status !== "completed");
  const completedOrders = state.orders.filter((order) => order.status === "completed");

  return `
    <section class="page-content">
      <div class="section-heading page-heading">
        <div>
          <p class="eyebrow">Live kitchen and fulfillment queue</p>
          <h2>Active Orders</h2>
        </div>
        <button class="primary-button" type="button" id="orders-new-order">
          New order <span>＋</span>
        </button>
      </div>

      ${
        activeOrders.length
          ? `
            <div class="order-grid">
              ${activeOrders.map((order) => renderOrderCard(order)).join("")}
            </div>
          `
          : `
            <div class="empty-state">
              <div class="empty-cart-icon">✓</div>
              <h3>No active orders</h3>
              <p>Orders created from the POS will appear here for preparation and fulfillment.</p>
              <button class="primary-button" type="button" id="empty-state-new-order">Create an order <span>＋</span></button>
            </div>
          `
      }

      ${
        completedOrders.length
          ? `
            <div class="completed-section">
              <h3>Completed today</h3>
              <p>${completedOrders.length} completed order${completedOrders.length === 1 ? "" : "s"} stored locally in this prototype.</p>
            </div>
          `
          : ""
      }
    </section>
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
    <article class="order-card">
      <div class="order-card-header">
        <div>
          <span class="order-number">${order.orderNumber}</span>
          <h3>${formatMoney(order.total)}</h3>
        </div>
        <span class="order-status status-${order.status}">${statusLabels[order.status]}</span>
      </div>

      <div class="order-meta">
        <span>${formatFulfillment(order.fulfillmentType)}</span>
        <span>${order.paymentStatus === "paid" ? "Paid" : "Unpaid"}</span>
        <span>${formatSource(order.source)}</span>
      </div>

      <div class="order-item-list">
        ${order.items
          .map(
            (item) => `
              <p>
                <span>${item.quantity}× ${item.name}${item.protein ? ` · ${item.protein}` : ""}</span>
                <strong>${formatMoney(item.price * item.quantity)}</strong>
              </p>
            `,
          )
          .join("")}
      </div>

      ${
        order.customerName || order.customerPhone
          ? `
            <div class="customer-summary">
              <span>Customer</span>
              <strong>${order.customerName || "Walk-in customer"}${order.customerPhone ? ` · ${order.customerPhone}` : ""}</strong>
            </div>
          `
          : ""
      }

      <div class="order-card-actions">
        <button class="secondary-button" type="button" data-view-order="${order.id}">View</button>
        ${
          nextAction
            ? `
              <button
                class="primary-button small-primary"
                type="button"
                data-update-order="${order.id}"
                data-next-status="${nextAction.value}"
              >
                ${nextAction.label}
              </button>
            `
            : ""
        }
      </div>
    </article>
  `;
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

function renderPlaceholderPage() {
  const content = {
    inventory: {
      icon: "▤",
      title: "Inventory setup comes next",
      text: "This screen will manage tilapia, chicken, attiéké, drinks, takeaway packs, bags, stock receipts, waste, and physical stock counts.",
    },
    reports: {
      icon: "◫",
      title: "Reports will connect to real sales",
      text: "Once Supabase is connected, this screen will show daily sales, cash versus MoMo versus Hubtel, popular meals, delivery fees, and stock variance.",
    },
    more: {
      icon: "•••",
      title: "Business settings",
      text: "The next stages will add menu editing, owner-controlled delivery fee defaults, tablet PIN settings, and printer setup.",
    },
  };

  const page = content[state.activePage];

  return `
    <section class="page-content">
      <div class="empty-state placeholder-state">
        <div class="empty-cart-icon">${page.icon}</div>
        <h2>${page.title}</h2>
        <p>${page.text}</p>
        <button class="primary-button" type="button" data-page="pos">
          Go to POS <span>→</span>
        </button>
      </div>
    </section>
  `;
}

function renderMobileNavigation() {
  const navItems = [
    { id: "pos", icon: "⊞", label: "POS" },
    { id: "orders", icon: "◷", label: "Orders" },
    { id: "inventory", icon: "▤", label: "Stock" },
    { id: "reports", icon: "◫", label: "Reports" },
    { id: "more", icon: "•••", label: "More" },
  ];

  return `
    <nav class="mobile-nav" aria-label="Mobile navigation">
      ${navItems
        .map(
          (item) => `
            <button
              class="${state.activePage === item.id ? "is-active" : ""}"
              type="button"
              data-page="${item.id}"
            >
              <span>${item.icon}</span>
              <small>${item.label}</small>
            </button>
          `,
        )
        .join("")}
    </nav>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activePage = button.dataset.page;
      render();
    });
  });

  document.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeCategoryId = button.dataset.category;
      render();
    });
  });

  document.querySelectorAll("[data-add-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = MENU_ITEMS.find((menuItem) => menuItem.id === button.dataset.addItem);

      if (item.requiresProtein) {
        openProteinModal(item);
        return;
      }

      addToCart(item);
    });
  });

  document.querySelectorAll("[data-increase-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const cartItem = state.cart.find((item) => item.cartId === button.dataset.increaseItem);
      if (cartItem) {
        cartItem.quantity += 1;
        render();
      }
    });
  });

  document.querySelectorAll("[data-decrease-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const cartItem = state.cart.find((item) => item.cartId === button.dataset.decreaseItem);
      if (!cartItem) return;

      if (cartItem.quantity === 1) {
        state.cart = state.cart.filter((item) => item.cartId !== cartItem.cartId);
      } else {
        cartItem.quantity -= 1;
      }

      render();
    });
  });

  document.querySelectorAll("[data-remove-item]").forEach((button) => {
    button.addEventListener("click", () => {
      state.cart = state.cart.filter((item) => item.cartId !== button.dataset.removeItem);
      render();
    });
  });

  document.querySelector("#clear-order-button")?.addEventListener("click", () => {
    if (!state.cart.length) return;
    state.cart = [];
    resetCheckout();
    render();
  });

  document.querySelector("#checkout-button")?.addEventListener("click", () => {
    if (!state.cart.length) return;
    openCheckoutModal();
  });

  document.querySelector("#new-order-button")?.addEventListener("click", () => {
    state.activePage = "pos";
    state.cart = [];
    resetCheckout();
    render();
  });

  document.querySelector("#orders-new-order")?.addEventListener("click", () => {
    state.activePage = "pos";
    state.cart = [];
    resetCheckout();
    render();
  });

  document.querySelector("#empty-state-new-order")?.addEventListener("click", () => {
    state.activePage = "pos";
    render();
  });

  document.querySelectorAll("[data-update-order]").forEach((button) => {
    button.addEventListener("click", () => {
      updateOrderStatus(button.dataset.updateOrder, button.dataset.nextStatus);
    });
  });

  document.querySelectorAll("[data-view-order]").forEach((button) => {
    button.addEventListener("click", () => {
      const order = state.orders.find((item) => item.id === button.dataset.viewOrder);
      if (order) openOrderReceiptModal(order);
    });
  });
}

function addToCart(item, protein = null) {
  const existingCartItem = state.cart.find(
    (cartItem) => cartItem.menuItemId === item.id && cartItem.protein === protein,
  );

  if (existingCartItem) {
    existingCartItem.quantity += 1;
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

  render();
}

function openProteinModal(item) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="modal-card small-modal" role="dialog" aria-modal="true" aria-labelledby="protein-modal-title">
      <button class="modal-close" type="button" data-close-modal aria-label="Close">×</button>
      <div class="modal-title-block">
        <p class="eyebrow">Required selection</p>
        <h2 id="protein-modal-title">Choose protein</h2>
        <p>${item.name} includes either tilapia or chicken at the same price.</p>
      </div>

      <div class="protein-options">
        ${item.proteinOptions
          .map(
            (protein) => `
              <button class="protein-option" type="button" data-protein="${protein}">
                <span>${protein === "Tilapia" ? "🐟" : "🍗"}</span>
                <strong>${protein}</strong>
                <small>Included</small>
              </button>
            `,
          )
          .join("")}
      </div>
    </section>
  `;

  document.body.append(modal);

  modal.querySelector("[data-close-modal]").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });

  modal.querySelectorAll("[data-protein]").forEach((button) => {
    button.addEventListener("click", () => {
      addToCart(item, button.dataset.protein);
      modal.remove();
    });
  });
}

function openCheckoutModal() {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="modal-card checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-modal-title">
      <button class="modal-close" type="button" data-close-modal aria-label="Close">×</button>

      <div class="modal-title-block">
        <p class="eyebrow">Order total: ${formatMoney(getOrderTotal())}</p>
        <h2 id="checkout-modal-title">Checkout order</h2>
        <p>Choose fulfillment, capture the order source, and record payment when received.</p>
      </div>

      <form id="checkout-form">
        <div class="form-section">
          <label>Fulfillment type</label>
          <div class="segmented-control" data-field="fulfillmentType">
            ${renderSegmentButton("walk-in", "Walk-in", state.checkout.fulfillmentType)}
            ${renderSegmentButton("pickup", "Pickup", state.checkout.fulfillmentType)}
            ${renderSegmentButton("delivery", "Delivery", state.checkout.fulfillmentType)}
            ${renderSegmentButton("dine-in", "Dine-in", state.checkout.fulfillmentType)}
          </div>
        </div>

        <div class="form-grid two-columns">
          <label class="field">
            <span>Order source</span>
            <select name="source">
              <option value="direct-pos" ${state.checkout.source === "direct-pos" ? "selected" : ""}>Direct POS</option>
              <option value="phone-call" ${state.checkout.source === "phone-call" ? "selected" : ""}>Phone call</option>
              <option value="whatsapp" ${state.checkout.source === "whatsapp" ? "selected" : ""}>WhatsApp</option>
              <option value="hubtel" ${state.checkout.source === "hubtel" ? "selected" : ""}>Hubtel</option>
              <option value="other" ${state.checkout.source === "other" ? "selected" : ""}>Other</option>
            </select>
          </label>

          <label class="field">
            <span>Payment status</span>
            <select name="paymentStatus">
              <option value="unpaid" ${state.checkout.paymentStatus === "unpaid" ? "selected" : ""}>Unpaid</option>
              <option value="paid" ${state.checkout.paymentStatus === "paid" ? "selected" : ""}>Paid</option>
            </select>
          </label>
        </div>

        <div class="form-grid two-columns">
          <label class="field">
            <span>Customer name <em>Optional</em></span>
            <input name="customerName" value="${escapeHtml(state.checkout.customerName)}" placeholder="e.g. Ama Mensah" />
          </label>

          <label class="field">
            <span>Phone number <em>Optional</em></span>
            <input name="customerPhone" value="${escapeHtml(state.checkout.customerPhone)}" placeholder="e.g. 054 000 0000" inputmode="tel" />
          </label>
        </div>

        <div id="delivery-fields">
          ${renderDeliveryFields()}
        </div>

        <div id="payment-fields">
          ${renderPaymentFields()}
        </div>

        <label class="field">
          <span>Order note <em>Optional</em></span>
          <textarea name="notes" rows="2" placeholder="Special instructions, landmark, customer request...">${escapeHtml(state.checkout.notes)}</textarea>
        </label>

        <div class="checkout-total-box">
          <div><span>Food subtotal</span><strong>${formatMoney(getCartSubtotal())}</strong></div>
          <div class="${state.checkout.fulfillmentType === "delivery" ? "" : "muted-row"}"><span>Delivery fee</span><strong>${formatMoney(getDeliveryFee())}</strong></div>
          <div class="checkout-grand-total"><span>Total payable</span><strong>${formatMoney(getOrderTotal())}</strong></div>
        </div>

        <button class="primary-button checkout-submit" type="submit">
          Confirm order <span>→</span>
        </button>
      </form>
    </section>
  `;

  document.body.append(modal);
  bindCheckoutModal(modal);
}

function renderSegmentButton(value, label, selectedValue) {
  return `
    <button
      class="segment-button ${value === selectedValue ? "is-active" : ""}"
      type="button"
      data-fulfillment="${value}"
    >
      ${label}
    </button>
  `;
}

function renderDeliveryFields() {
  if (state.checkout.fulfillmentType !== "delivery") {
    return "";
  }

  return `
    <div class="delivery-box">
      <p class="delivery-title">Delivery details</p>
      <div class="form-grid two-columns">
        <label class="field">
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

        <label class="field">
          <span>Rider <em>Optional</em></span>
          <input name="riderName" placeholder="Assign later or enter name" />
        </label>
      </div>

      <label class="field">
        <span>Delivery location / landmark</span>
        <input
          name="deliveryAddress"
          value="${escapeHtml(state.checkout.deliveryAddress)}"
          placeholder="e.g. UCC, Kotokuraba, near ..."
          required
        />
      </label>
    </div>
  `;
}

function renderPaymentFields() {
  if (state.checkout.paymentStatus !== "paid") {
    return `
      <div class="payment-note">
        <span>ℹ</span>
        <p>This order will enter the queue as unpaid. Payment can be recorded when the customer picks up or receives it.</p>
      </div>
    `;
  }

  return `
    <div class="form-section">
      <label>Payment method</label>
      <div class="segmented-control" data-field="paymentMethod">
        ${renderPaymentButton("cash", "Cash")}
        ${renderPaymentButton("momo", "MoMo")}
        ${renderPaymentButton("hubtel", "Hubtel")}
      </div>
    </div>
  `;
}

function renderPaymentButton(value, label) {
  return `
    <button
      class="segment-button ${value === state.checkout.paymentMethod ? "is-active" : ""}"
      type="button"
      data-payment-method="${value}"
    >
      ${label}
    </button>
  `;
}

function bindCheckoutModal(modal) {
  const form = modal.querySelector("#checkout-form");

  modal.querySelector("[data-close-modal]").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });

  modal.querySelectorAll("[data-fulfillment]").forEach((button) => {
    button.addEventListener("click", () => {
      state.checkout.fulfillmentType = button.dataset.fulfillment;
      if (state.checkout.fulfillmentType !== "delivery") {
        state.checkout.deliveryFee = 0;
        state.checkout.deliveryAddress = "";
      }
      modal.remove();
      openCheckoutModal();
    });
  });

  modal.querySelectorAll("[data-payment-method]").forEach((button) => {
    button.addEventListener("click", () => {
      state.checkout.paymentMethod = button.dataset.paymentMethod;
      modal.remove();
      openCheckoutModal();
    });
  });

  form.addEventListener("change", (event) => {
    if (event.target.name === "paymentStatus") {
      state.checkout.paymentStatus = event.target.value;
      modal.remove();
      openCheckoutModal();
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    state.checkout.source = formData.get("source");
    state.checkout.paymentStatus = formData.get("paymentStatus");
    state.checkout.customerName = formData.get("customerName").trim();
    state.checkout.customerPhone = formData.get("customerPhone").trim();
    state.checkout.deliveryAddress = (formData.get("deliveryAddress") || "").trim();
    state.checkout.deliveryFee = Number(formData.get("deliveryFee") || 0);
    state.checkout.notes = formData.get("notes").trim();

    if (state.checkout.fulfillmentType === "delivery" && !state.checkout.deliveryAddress) {
      window.alert("Enter the delivery location or landmark before confirming this order.");
      return;
    }

    createOrder();
    modal.remove();
  });
}

function createOrder() {
  const fulfillmentType = state.checkout.fulfillmentType;
  const isDelivery = fulfillmentType === "delivery";

  const order = {
    id: createId("order"),
    orderNumber: `YY-${String(state.orders.length + 1).padStart(3, "0")}`,
    createdAt: new Date().toISOString(),
    status: "confirmed",
    fulfillmentType,
    source: state.checkout.source,
    customerName: state.checkout.customerName,
    customerPhone: state.checkout.customerPhone,
    deliveryAddress: isDelivery ? state.checkout.deliveryAddress : "",
    deliveryFee: isDelivery ? Number(state.checkout.deliveryFee || 0) : 0,
    paymentStatus: state.checkout.paymentStatus,
    paymentMethod: state.checkout.paymentStatus === "paid" ? state.checkout.paymentMethod : null,
    notes: state.checkout.notes,
    items: state.cart.map((item) => ({ ...item })),
    subtotal: getCartSubtotal(),
    total: getOrderTotal(),
  };

  state.orders.unshift(order);
  localStorage.setItem("yumyard-demo-orders", JSON.stringify(state.orders));

  state.cart = [];
  resetCheckout();
  state.activePage = "orders";
  render();
  openOrderReceiptModal(order);
}

function updateOrderStatus(orderId, status) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return;

  order.status = status;
  localStorage.setItem("yumyard-demo-orders", JSON.stringify(state.orders));
  render();
}

function openOrderReceiptModal(order) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="modal-card receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
      <button class="modal-close" type="button" data-close-modal aria-label="Close">×</button>

      <div class="receipt-brand">
        <img src="/yumyard-logo.jpg" alt="Yum Yard" />
        <div>
          <h2 id="receipt-title">Order ${order.orderNumber}</h2>
          <p>Abura, Science Taxi Rank Exit</p>
          <p>Call / WhatsApp: 0544603124</p>
        </div>
      </div>

      <div class="receipt-meta">
        <span>${new Intl.DateTimeFormat("en-GH", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(order.createdAt))}</span>
        <span>${formatFulfillment(order.fulfillmentType)}</span>
      </div>

      <div class="receipt-items">
        ${order.items
          .map(
            (item) => `
              <div>
                <span>${item.quantity} × ${item.name}${item.protein ? ` (${item.protein})` : ""}</span>
                <strong>${formatMoney(item.price * item.quantity)}</strong>
              </div>
            `,
          )
          .join("")}
      </div>

      <div class="receipt-totals">
        <div><span>Food subtotal</span><strong>${formatMoney(order.subtotal)}</strong></div>
        ${
          order.deliveryFee
            ? `<div><span>Delivery fee</span><strong>${formatMoney(order.deliveryFee)}</strong></div>`
            : ""
        }
        <div class="receipt-total"><span>Total</span><strong>${formatMoney(order.total)}</strong></div>
      </div>

      <div class="receipt-payment">
        <span class="${order.paymentStatus === "paid" ? "paid-pill" : "unpaid-pill"}">
          ${order.paymentStatus === "paid" ? `Paid · ${order.paymentMethod?.toUpperCase()}` : "Payment pending"}
        </span>
      </div>

      ${
        order.deliveryAddress
          ? `<p class="receipt-note"><strong>Delivery:</strong> ${escapeHtml(order.deliveryAddress)}</p>`
          : ""
      }
      ${
        order.notes
          ? `<p class="receipt-note"><strong>Note:</strong> ${escapeHtml(order.notes)}</p>`
          : ""
      }

      <div class="receipt-actions">
        <button class="secondary-button" type="button" data-close-modal>Close</button>
        <button class="primary-button" type="button" data-copy-receipt="${order.id}">Copy summary</button>
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

  modal.querySelector("[data-copy-receipt]")?.addEventListener("click", async () => {
    const summary = buildShareSummary(order);

    try {
      await navigator.clipboard.writeText(summary);
      modal.querySelector("[data-copy-receipt]").textContent = "Copied!";
    } catch {
      window.prompt("Copy this order summary:", summary);
    }
  });
}

function buildShareSummary(order) {
  const orderLines = order.items
    .map(
      (item) =>
        `${item.quantity}x ${item.name}${item.protein ? ` (${item.protein})` : ""} — ${formatMoney(item.price * item.quantity)}`,
    )
    .join("\n");

  return [
    `YUM YARD — ${order.orderNumber}`,
    `Abura, Science Taxi Rank Exit`,
    "",
    orderLines,
    order.deliveryFee ? `Delivery fee — ${formatMoney(order.deliveryFee)}` : "",
    `TOTAL — ${formatMoney(order.total)}`,
    `Payment: ${order.paymentStatus === "paid" ? `${order.paymentMethod?.toUpperCase()} paid` : "Pending"}`,
    `Fulfillment: ${formatFulfillment(order.fulfillmentType)}`,
    order.deliveryAddress ? `Delivery: ${order.deliveryAddress}` : "",
    "",
    "Call / WhatsApp: 0544603124",
  ]
    .filter(Boolean)
    .join("\n");
}

function resetCheckout() {
  state.checkout = {
    fulfillmentType: "walk-in",
    source: "direct-pos",
    paymentStatus: "unpaid",
    paymentMethod: "cash",
    customerName: "",
    customerPhone: "",
    deliveryAddress: "",
    deliveryFee: 0,
    notes: "",
  };
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

render();