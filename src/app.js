import { icon } from "./ui/icons.js";
import {
  formatDateTime,
  formatFulfillment,
  formatMoney,
  formatOrderSource,
  formatPaymentMethod,
} from "./lib/formatters.js";
import {
  clearPosSession,
  getPosSession,
  isSessionExpired,
  savePosSession,
} from "./lib/session-store.js";
import {
  authenticatePosWorkerById,
  listBranchWorkers,
  lockPosSession,
  validatePosSession,
} from "./services/auth-service.js";
import { APP_CONFIG } from "./lib/config.js";
import { getPosMenu } from "./services/menu-service.js";
import {
  createPosOrder,
  getPosActiveOrders,
  getPosWorkerOrderDetail,
  getPosWorkerOrderHistory,
  recordOrderPayment,
  updatePosOrderStatus,
} from "./services/order-service.js";
import {
  closeWorkerShift,
  getActiveWorkerShift,
  getShiftClosePreview,
  getShiftOpeningContext,
  openWorkerShift,
  getCloseDayPreview,
  closeBusinessDay,
} from "./services/shift-service.js";

const state = {
  root: null,
  view: "boot",
  isLoading: false,
  error: "",
  notice: "",
  session: null,
  shift: null,
  shiftClosePreview: null,
  shiftOpeningContext: null,
  closeDayPreview: null,
  categories: [],
  menuItems: [],
  activeCategoryId: null, // Will be set to first category after load
  cart: [],
  activeOrders: [],
  checkout: createCheckoutState(),
  isCategoryRailOpen: false,
  loginWorkers: [],
  isLoadingWorkers: false,
  selectedWorkerId: null,
  loginPin: "",
  myOrders: {
    isLoading: false,
    hasLoaded: false,
    list: [],
    totalCount: 0,
    filters: {
      dateFrom: defaultHistoryDateFrom(),
      dateTo: defaultHistoryDateTo(),
      statusBucket: "all",
      search: "",
    },
    limit: 30,
    offset: 0,
  },
};

function defaultHistoryDateTo() {
  return new Date().toISOString().slice(0, 10);
}

function defaultHistoryDateFrom() {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().slice(0, 10);
}

// Inactivity lock tracking lives outside `state` - it ticks constantly and
// has no visual representation of its own, so it shouldn't trigger a
// re-render every time it updates.
let lastActivityAt = Date.now();
let inactivityCheckHandle = null;

function createCheckoutState() {
  return {
    fulfillmentType: "walk-in",
    source: "direct-pos",
    customerName: "",
    customerPhone: "",
    deliveryAddress: "",
    deliveryFee: 0,
    notes: "",
  };
}

export function renderApp(root) {
  state.root = root;
  root.innerHTML = renderScreen();
  bindScreenEvents();
}

export async function startApp(root) {
  state.root = root;
  state.view = "boot";
  renderApp(root);
  setupGlobalActivityListeners();

  const storedSession = getPosSession();

  if (!storedSession || isSessionExpired(storedSession)) {
    clearPosSession();
    showLogin();
    return;
  }

  try {
    state.isLoading = true;
    renderApp(root);

    await validatePosSession(storedSession.sessionToken);
    state.session = storedSession;
    startInactivityWatch();
    await routeAuthenticatedWorker();
  } catch {
    clearPosSession();
    state.session = null;
    state.error = "Your session has expired or was locked. Sign in again.";
    showLogin();
  }
}

function renderScreen() {
  if (state.view === "boot") {
    return renderBootScreen();
  }

  if (state.view === "login") {
    return renderLoginScreen();
  }

  if (state.view === "opening-shift") {
    return renderOpeningShiftScreen();
  }

  if (state.view === "closing-shift") {
    return renderClosingShiftScreen();
  }

  if (state.view === "close-day") {
    return renderCloseDayScreen();
  }

  if (state.view === "orders") {
    return renderPosShell(renderOrdersWorkspace());
  }

  if (state.view === "my-orders") {
    return renderPosShell(renderMyOrdersWorkspace());
  }

  if (state.view === "pos") {
    return renderPosShell(renderPosWorkspace());
  }

  return renderLoginScreen();
}

function renderBootScreen() {
  return `
    <main class="app-boot-screen">
      <section class="app-boot-card">
        <img src="/yumyard-logo.png" alt="Yum Yard" />
        <div class="boot-spinner"></div>
        <p>Loading Yum Yard POS</p>
      </section>
    </main>
  `;
}

function renderLoginScreen() {
  const selectedWorker = state.loginWorkers.find(
    (worker) => worker.workerId === state.selectedWorkerId,
  );

  return `
    <main class="login-screen">
      <section class="login-card login-card--split">
        <div class="login-split-header">
          <img src="/yumyard-logo.png" alt="Yum Yard" class="login-logo" />
          <p class="section-kicker">Yum Yard POS</p>
          <h1>${selectedWorker ? `Enter PIN for ${escapeHtml(selectedWorker.displayName)}` : "Who's working the till?"}</h1>
        </div>

        ${state.error ? `<div class="form-alert error-alert">${escapeHtml(state.error)}</div>` : ""}
        ${state.notice ? `<div class="form-alert success-alert">${escapeHtml(state.notice)}</div>` : ""}

        <div class="login-split">
          <aside class="profile-pane">
            <p class="profile-pane-label">Select your profile</p>
            <div class="profile-list">
              ${renderProfileList(selectedWorker)}
            </div>
          </aside>

          ${renderPinPane(selectedWorker)}
        </div>

        <p class="login-help">Yum Yard · Abura, Cape Coast</p>
      </section>
    </main>
  `;
}

function renderProfileList(selectedWorker) {
  if (state.isLoadingWorkers) {
    return `
      <div class="profile-list-loading">
        <span class="boot-spinner"></span>
      </div>
    `;
  }

  if (!state.loginWorkers.length) {
    return `
      <div class="profile-list-empty">
        <p>No staff profiles found for this branch.</p>
      </div>
    `;
  }

  return state.loginWorkers
    .map(
      (worker) => `
        <button
          class="profile-row ${selectedWorker?.workerId === worker.workerId ? "is-active" : ""}"
          type="button"
          data-select-profile="${worker.workerId}"
        >
          <span class="profile-avatar">${icon("user")}</span>
          <span class="profile-name">${escapeHtml(worker.displayName)}</span>
          ${icon("chevronLeft")}
        </button>
      `,
    )
    .join("");
}

function renderPinPane(selectedWorker) {
  if (!selectedWorker) {
    return `
      <section class="pinpad-pane is-disabled">
        <div class="pinpad-placeholder">
          ${icon("lock")}
          <p>Select your profile to enter your PIN</p>
        </div>
      </section>
    `;
  }

  const pinLength = state.loginPin.length;
  const canSubmit = pinLength >= 4 && !state.isLoading;
  const digitButtons = "123456789"
    .split("")
    .map(
      (digit) =>
        `<button class="pin-key" type="button" data-pin-digit="${digit}" ${state.isLoading ? "disabled" : ""}>${digit}</button>`,
    )
    .join("");

  return `
    <section class="pinpad-pane">
      <button class="pinpad-back" type="button" data-pin-back>
        ${icon("chevronLeft")}
        <span>Back</span>
      </button>

      <div class="pinpad-identity">
        <span class="profile-avatar profile-avatar-lg">${icon("user")}</span>
        <strong>${escapeHtml(selectedWorker.displayName)}</strong>
      </div>

      <div class="pin-dots" role="status" aria-label="${pinLength} digits entered">
        ${renderPinDots(pinLength)}
      </div>

      <div class="pin-keypad">
        ${digitButtons}
        <button class="pin-key pin-key-muted" type="button" data-pin-clear ${state.isLoading ? "disabled" : ""}>Clear</button>
        <button class="pin-key" type="button" data-pin-digit="0" ${state.isLoading ? "disabled" : ""}>0</button>
        <button class="pin-key pin-key-muted" type="button" data-pin-backspace ${state.isLoading ? "disabled" : ""} aria-label="Backspace">
          ${icon("backspace")}
        </button>
      </div>

      <button class="checkout-button pin-submit-button" type="button" data-pin-submit ${canSubmit ? "" : "disabled"}>
        <span>${state.isLoading ? "Signing in..." : "Sign in"}</span>
        ${state.isLoading ? `<span class="button-spinner"></span>` : icon("arrowRight")}
      </button>
    </section>
  `;
}

function renderPinDots(pinLength) {
  const dotCount = Math.max(pinLength, 4);
  let dots = "";

  for (let index = 0; index < dotCount; index += 1) {
    dots += `<span class="pin-dot ${index < pinLength ? "is-filled" : ""}"></span>`;
  }

  return dots;
}

function renderOpeningShiftScreen() {
  const context = state.shiftOpeningContext;
  const inheritedCash = Number(context?.inherited_cash || 0);
  const isFirstShift = !context?.previous_shift_id;
  const afterDayClose = Boolean(context?.after_day_close);
  const canCloseDay = ["owner", "manager"].includes(state.session?.workerRole);

  return `
    <main class="shift-screen">
      <section class="shift-card">
        <div class="shift-card-header">
          <img src="/yumyard-logo.png" alt="Yum Yard" />
          <div>
            <p class="section-kicker">Shift opening</p>
            <h1>Welcome, ${escapeHtml(state.session.workerName)}</h1>
          </div>
        </div>

        <div class="shift-intro">
          <h2>${afterDayClose ? "Start a new day" : isFirstShift ? "Set opening cash" : "Confirm cash handover"}</h2>
          <p>
            ${
              afterDayClose
                ? `The previous business day was closed. Count today's starting float before opening the POS.`
                : isFirstShift
                  ? "This is the first recorded shift. Count the physical cash float before opening the POS."
                  : `The previous shift closed with ${formatMoney(inheritedCash)}. Count the cash handed over before continuing.`
            }
          </p>
        </div>

        ${
          afterDayClose
            ? `
              <div class="handover-cash-card">
                <span>Day closed</span>
                <strong>${formatShortDate(context.day_close_business_date)}</strong>
                <small>Starting fresh for today</small>
                <div>
                  <span>Starting float</span>
                  <b>${formatMoney(inheritedCash)}</b>
                </div>
              </div>
            `
            : !isFirstShift
              ? `
                <div class="handover-cash-card">
                  <span>Previous shift</span>
                  <strong>${escapeHtml(context.previous_worker_name || "Previous worker")}</strong>
                  <small>Closed ${formatShortDateTime(context.previous_shift_closed_at)}</small>
                  <div>
                    <span>Expected handover cash</span>
                    <b>${formatMoney(inheritedCash)}</b>
                  </div>
                </div>
              `
              : ""
        }

        ${state.error ? `<div class="form-alert error-alert">${escapeHtml(state.error)}</div>` : ""}
        ${state.notice ? `<div class="form-alert success-alert">${escapeHtml(state.notice)}</div>` : ""}

        <form id="open-shift-form" class="open-shift-form">
          <label class="form-field">
            <span>${isFirstShift || afterDayClose ? "Opening cash float" : "Physical cash received"}</span>
            <div class="money-input">
              <span>GH₵</span>
              <input
                name="openingCash"
                type="number"
                min="0"
                step="0.01"
                inputmode="decimal"
                value="${inheritedCash.toFixed(2)}"
                required
              />
            </div>
          </label>

          <label class="form-field">
            <span>Opening note <em>Optional</em></span>
            <textarea
              name="openingNote"
              rows="2"
              placeholder="${
                isFirstShift || afterDayClose
                  ? "Example: First opening float counted."
                  : "Example: Cash handed over and counted."
              }"
            ></textarea>
          </label>

          <button class="checkout-button" type="submit" ${state.isLoading ? "disabled" : ""}>
            <span>${state.isLoading ? "Opening shift..." : "Open shift"}</span>
            ${state.isLoading ? `<span class="button-spinner"></span>` : icon("arrowRight")}
          </button>
        </form>

        ${
          canCloseDay
            ? `
              <button class="text-button" type="button" data-close-day-instead ${state.isLoading ? "disabled" : ""}>
                ${icon("lock")}
                <span>Close the day instead</span>
              </button>
            `
            : ""
        }

        <button class="text-button" type="button" data-sign-out ${state.isLoading ? "disabled" : ""}>
          Sign out
        </button>
      </section>
    </main>
  `;
}

function renderClosingShiftScreen() {
  const preview = state.shiftClosePreview;
  if (!preview) {
    return renderLoginScreen();
  }

  const openingCash = Number(preview.opening_cash_actual || 0);
  const cashSales = Number(preview.cash_sales_total || 0);
  const momoSales = Number(preview.momo_sales_total || 0);
  const hubtelSales = Number(preview.hubtel_sales_total || 0);
  const expectedClosing = Number(
    preview.expected_cash ?? openingCash + cashSales,
  );
  const openOrders = preview.open_orders || [];
  const closeButtonTitle = openOrders.length
    ? `title="Resolve the ${openOrders.length} active order${openOrders.length === 1 ? "" : "s"} first"`
    : "";

  return `
    <main class="shift-screen">
      <section class="shift-card handover-card">
        <div class="shift-card-header">
          <img src="/yumyard-logo.png" alt="Yum Yard" />
          <div>
            <p class="section-kicker">Close shift</p>
            <h1>Review and close</h1>
          </div>
        </div>

        <div class="shift-intro">
          <h2>Confirm totals and cash</h2>
          <p>Verify the recorded totals and count the physical cash before closing your shift.</p>
        </div>

        <div class="closing-summary-grid">
          <div class="closing-summary-card">
            <span>Opening cash</span>
            <strong>${formatMoney(openingCash)}</strong>
          </div>
          <div class="closing-summary-card">
            <span>Cash sales</span>
            <strong>${formatMoney(cashSales)}</strong>
          </div>
          <div class="closing-summary-card highlight">
            <span>Expected closing cash</span>
            <strong>${formatMoney(expectedClosing)}</strong>
          </div>
        </div>

        <div class="closing-summary-grid">
          <div class="closing-summary-card">
            <span>MoMo sales</span>
            <strong>${formatMoney(momoSales)}</strong>
          </div>
          <div class="closing-summary-card">
            <span>Hubtel sales</span>
            <strong>${formatMoney(hubtelSales)}</strong>
          </div>
          <div class="closing-summary-card">
            <span>Open orders</span>
            <strong>${Number(preview.open_order_count || 0)}</strong>
          </div>
        </div>

        ${state.error ? `<div class="form-alert error-alert">${escapeHtml(state.error)}</div>` : ""}

        ${
          openOrders.length
            ? `
              <div class="form-alert error-alert close-shift-blocked-banner">
                <strong>Cannot close shift yet.</strong>
                <span>${openOrders.length} active order${openOrders.length === 1 ? " is" : "s are"} still open. Complete, cancel, or otherwise resolve ${openOrders.length === 1 ? "it" : "them"} on the Orders screen before closing.</span>
              </div>

              <div class="handover-order-list">
                ${openOrders
                  .map(
                    (order) => `
                      <div class="handover-order-row is-readonly">
                        <span class="handover-order-body">
                          <span class="handover-order-top">
                            <strong>${escapeHtml(order.order_number)}</strong>
                            <b>${formatMoney(order.total)}</b>
                          </span>
                          <span class="handover-order-meta">
                            ${escapeHtml(formatFulfillment(order.fulfillment_type))} ·
                            ${escapeHtml(formatOrderStatus(order.status))} ·
                            ${escapeHtml(order.payment_status)}
                          </span>
                        </span>
                      </div>
                    `,
                  )
                  .join("")}
              </div>

              <button class="outline-action-button close-shift-go-orders-button" type="button" data-go-orders>
                ${icon("orders")}
                <span>Go resolve these orders</span>
              </button>
            `
            : ""
        }

        <form id="close-shift-form" class="open-shift-form">
          <label class="form-field">
            <span>Physical cash counted</span>
            <div class="money-input">
              <span>GH₵</span>
              <input
                name="actualCashCounted"
                type="number"
                min="0"
                step="0.01"
                inputmode="decimal"
                value="${expectedClosing.toFixed(2)}"
                ${openOrders.length ? "disabled" : ""}
                required
              />
            </div>
          </label>

          <p id="close-shift-variance" class="variance-readout is-balanced">Matches expected cash</p>

          <label class="form-field">
            <span>Closing note <em id="closing-note-required-hint">Optional</em></span>
            <textarea
              name="closingNote"
              rows="2"
              placeholder="Example: All cash counted and handed over to manager."
              ${openOrders.length ? "disabled" : ""}
            ></textarea>
          </label>

          <button class="checkout-button" type="submit" ${state.isLoading || openOrders.length ? "disabled" : ""} ${closeButtonTitle}>
            <span>${state.isLoading ? "Closing shift..." : "Close shift"}</span>
            ${state.isLoading ? `<span class="button-spinner"></span>` : icon("logout")}
          </button>
        </form>

        <button class="text-button" type="button" data-cancel-close-shift ${state.isLoading ? "disabled" : ""}>
          Cancel
        </button>
      </section>
    </main>
  `;
}

function renderCloseDayScreen() {
  const preview = state.closeDayPreview;

  if (!preview) {
    return renderLoginScreen();
  }

  const lastCash = Number(preview.last_shift_actual_cash_counted || 0);

  return `
    <main class="shift-screen">
      <section class="shift-card handover-card">
        <div class="shift-card-header">
          <img src="/yumyard-logo.png" alt="Yum Yard" />
          <div>
            <p class="section-kicker">Close day</p>
            <h1>End of day handover</h1>
          </div>
        </div>

        <div class="shift-intro">
          <h2>Confirm today's totals</h2>
          <p>This closes every shift recorded since the last day close and resets tomorrow's opening cash.</p>
        </div>

        <div class="closing-summary-grid">
          <div class="closing-summary-card">
            <span>Shifts today</span>
            <strong>${Number(preview.shifts_count || 0)}</strong>
          </div>
          <div class="closing-summary-card">
            <span>Orders</span>
            <strong>${Number(preview.total_orders || 0)}</strong>
          </div>
          <div class="closing-summary-card highlight">
            <span>Total sales</span>
            <strong>${formatMoney(preview.total_sales)}</strong>
          </div>
        </div>

        ${
          preview.last_shift_worker_name
            ? `
              <div class="handover-cash-card">
                <span>Last shift</span>
                <strong>${escapeHtml(preview.last_shift_worker_name)}</strong>
                <small>Closed ${formatShortDateTime(preview.last_shift_closed_at)}</small>
                <div>
                  <span>Cash counted</span>
                  <b>${formatMoney(lastCash)}</b>
                </div>
              </div>
            `
            : ""
        }

        ${state.error ? `<div class="form-alert error-alert">${escapeHtml(state.error)}</div>` : ""}

        ${
          preview.can_close
            ? `
              <form id="close-day-form" class="open-shift-form">
                <label class="form-field">
                  <span>Cash handed over to owner</span>
                  <div class="money-input">
                    <span>GH₵</span>
                    <input
                      name="cashHandedOver"
                      type="number"
                      min="0"
                      step="0.01"
                      inputmode="decimal"
                      value="${lastCash.toFixed(2)}"
                      required
                    />
                  </div>
                </label>

                <label class="form-field">
                  <span>Opening float for tomorrow</span>
                  <div class="money-input">
                    <span>GH₵</span>
                    <input
                      name="openingFloat"
                      type="number"
                      min="0"
                      step="0.01"
                      inputmode="decimal"
                      value="0.00"
                      required
                    />
                  </div>
                </label>

                <label class="form-field">
                  <span>Notes <em>Optional</em></span>
                  <textarea
                    name="notes"
                    rows="2"
                    placeholder="Example: Full cash count handed to owner in person."
                  ></textarea>
                </label>

                <button class="checkout-button" type="submit" ${state.isLoading ? "disabled" : ""}>
                  <span>${state.isLoading ? "Closing day..." : "Close the day"}</span>
                  ${state.isLoading ? `<span class="button-spinner"></span>` : icon("logout")}
                </button>
              </form>
            `
            : `<div class="form-alert error-alert">${escapeHtml(preview.blocked_reason || "The day cannot be closed right now.")}</div>`
        }

        <button class="text-button" type="button" data-cancel-close-day ${state.isLoading ? "disabled" : ""}>
          Cancel
        </button>
      </section>
    </main>
  `;
}

function renderPosShell(content) {
  const activeOrderCount = state.activeOrders.length;

  return `
    <div class="pos-application">
      <header class="pos-topbar">
        <button class="brand-button" type="button" data-go-pos aria-label="Open new order screen">
          <img src="/yumyard-logo.png" alt="Yum Yard" class="topbar-logo" />
          <span class="brand-divider"></span>
          <span class="brand-label">POS</span>
        </button>

        <div class="topbar-center">
          <button class="topbar-tab ${state.view === "pos" ? "is-active" : ""}" type="button" data-go-pos>
            ${icon("cart")}
            <span>New order</span>
          </button>
          <button class="topbar-tab ${state.view === "orders" ? "is-active" : ""}" type="button" data-go-orders>
            ${icon("orders")}
            <span>Orders</span>
            ${activeOrderCount ? `<b>${activeOrderCount}</b>` : ""}
          </button>
          <button class="topbar-tab ${state.view === "my-orders" ? "is-active" : ""}" type="button" data-go-my-orders>
            ${icon("clock")}
            <span>My history</span>
          </button>
        </div>

        <div class="topbar-utilities">
          <span class="signed-in-worker">
            ${icon("user")}
            <span>${escapeHtml(state.session.workerName)}</span>
          </span>
          <button class="utility-button" type="button" data-close-shift>
            ${icon("logout")}
            <span>Close shift</span>
          </button>
          <button class="utility-button" type="button" data-switch-worker>
            ${icon("user")}
            <span>Switch worker</span>
          </button>
        </div>
      </header>

      ${state.error ? `<div class="global-alert error-alert">${escapeHtml(state.error)}</div>` : ""}
      ${state.notice ? `<div class="global-alert success-alert">${escapeHtml(state.notice)}</div>` : ""}

      ${content}

      ${renderMobileCartBar()}
    </div>
  `;
}

function renderMobileCartBar() {
  // The one entry point to the cart on narrow viewports: shows the
  // running count/total and goes straight to checkout (same as the
  // desktop cart panel's own checkout button) rather than opening a
  // separate "Current Order" review drawer first.
  if (state.cart.length === 0) {
    return "";
  }

  return `
    <button class="mobile-cart-bar" type="button" data-open-checkout>
      <span class="mobile-cart-bar-count">
        ${icon("cart")}
        <span>${getCartCount()} item${getCartCount() === 1 ? "" : "s"}</span>
      </span>
      <span class="mobile-cart-bar-total">${formatMoney(getOrderTotal())}</span>
      <span class="mobile-cart-bar-chevron">${icon("arrowRight")}</span>
    </button>
  `;
}

function renderPosWorkspace() {
  // Ensure a category is always selected
  if (!state.activeCategoryId && state.categories.length > 0) {
    const nonEmptyCategories = state.categories.filter((cat) => {
      const count = state.menuItems.filter(
        (item) => item.categoryId === cat.id,
      ).length;
      return count > 0;
    });
    
    if (nonEmptyCategories.length > 0) {
      state.activeCategoryId = nonEmptyCategories[0].id;
    }
  }

  const showDesktopCart = state.cart.length > 0;

  return `
    <div class="category-rail-overlay ${state.isCategoryRailOpen ? "is-visible" : ""}" data-close-categories></div>
    
    <main class="pos-workspace">
      <aside class="category-rail ${state.isCategoryRailOpen ? "is-open" : ""}" aria-label="Menu categories">
        <div class="rail-heading"><span>Menu</span></div>

        <div class="category-list">
          ${state.categories
            .map(
              (category) => `
                <button
                  class="category-button ${state.activeCategoryId === category.id ? "is-active" : ""}"
                  type="button"
                  data-category="${category.id}"
                >
                  <span>${escapeHtml(category.name)}</span>
                  <small>${getCategoryCount(category.id)}</small>
                </button>
              `,
            )
            .join("")}
        </div>

        <div class="rail-footer">
          <p>${escapeHtml(state.session.workerName)}</p>
          <span>Active shift</span>
        </div>
      </aside>

      <section class="product-workspace">
        <div class="workspace-heading">
          <div>
            <p class="section-kicker">Create order</p>
            <h1>${escapeHtml(getActiveCategoryName())}</h1>
          </div>

          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <button class="category-toggle-button" type="button" data-toggle-categories>
              ${icon("cart")}
              <span>Categories</span>
            </button>
          </div>
        </div>

        <div class="product-grid">
          ${renderProductCards(getVisibleProducts())}
        </div>
      </section>

      <aside class="order-panel">
        ${showDesktopCart ? renderOrderPanel() : renderEmptyOrderPanel()}
      </aside>
    </main>
  `;
}

function renderEmptyOrderPanel() {
  return `
    <div class="order-panel-content">
      <div class="order-empty">
        <div class="empty-outline-icon">${icon("cart")}</div>
        <h3>No items added</h3>
        <p>Select an item from the menu to start an order.</p>
      </div>
    </div>
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
    .map((item) => {
      const categoryName =
        state.categories.find(
          (category) => category.id === item.categoryId,
        )?.name || "";

      return `
        <button
          class="product-card"
          type="button"
          data-add-item="${item.id}"
          data-category-name="${escapeHtml(categoryName)}"
        >
          <div class="product-card-content">
            <h2 class="product-name">${escapeHtml(item.name)}</h2>
            <div class="product-card-bottom">
              <strong>${formatMoney(item.price)}</strong>
              <span class="add-product-icon">${icon("add")}</span>
            </div>
          </div>
        </button>
      `;
    })
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
          ? `<div class="order-item-list">${state.cart.map((item) => renderCartItem(item)).join("")}</div>`
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
        <h3>${escapeHtml(item.name)}</h3>
        ${item.protein ? `<p>${escapeHtml(item.protein)}</p>` : ""}
        <strong>${formatMoney(item.unitPrice * item.quantity)}</strong>
      </div>

      <div class="order-item-controls">
        <div class="quantity-stepper">
          <button type="button" data-decrease-item="${item.cartId}" aria-label="Decrease ${escapeHtml(item.name)}">
            ${icon("minus")}
          </button>
          <span>${item.quantity}</span>
          <button type="button" data-increase-item="${item.cartId}" aria-label="Increase ${escapeHtml(item.name)}">
            ${icon("add")}
          </button>
        </div>

        <button class="remove-order-item" type="button" data-remove-item="${item.cartId}" aria-label="Remove ${escapeHtml(item.name)}">
          ${icon("close")}
        </button>
      </div>
    </article>
  `;
}

function renderOrdersWorkspace() {
  return `
    <main class="orders-workspace">
      <div class="orders-header">
        <div>
          <p class="section-kicker">Active shift orders</p>
          <h1>Orders</h1>
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
        ${renderOrderStatusSummary("awaiting_pickup", "Pickup")}
        ${renderOrderStatusSummary("out_for_delivery", "Delivery")}
      </div>

      ${
        state.activeOrders.length
          ? `<section class="orders-list">${state.activeOrders.map((order) => renderActiveOrderCard(order)).join("")}</section>`
          : `
            <section class="orders-empty">
              <div class="empty-outline-icon">${icon("check")}</div>
              <h2>No active orders</h2>
              <p>Orders created in this shift and accepted handovers will appear here.</p>
              <button class="new-order-button" type="button" data-go-pos>
                ${icon("add")}
                <span>Create order</span>
              </button>
            </section>
          `
      }
    </main>
  `;
}

function renderOrderStatusSummary(status, label) {
  const count = state.activeOrders.filter(
    (order) => order.status === status,
  ).length;

  return `
    <div class="status-summary-item">
      <span class="status-dot status-dot-${status}"></span>
      <span>${label}</span>
      <strong>${count}</strong>
    </div>
  `;
}

function renderActiveOrderCard(order) {
  const nextAction = getNextOrderAction(order);

  return `
    <article class="active-order-card">
      <div class="active-order-head">
        <div>
          <span class="order-reference">${escapeHtml(order.order_number)}</span>
          <h2>${formatMoney(order.total)}</h2>
        </div>
        <span class="status-pill status-${escapeHtml(order.status)}">${escapeHtml(formatOrderStatus(order.status))}</span>
      </div>

      <div class="active-order-meta">
        <span>${getFulfillmentIcon(order.fulfillment_type)} ${escapeHtml(formatFulfillment(order.fulfillment_type))}</span>
        <span class="${order.payment_status === "paid" ? "paid-text" : "unpaid-text"}">
          ${escapeHtml(formatPaymentStatus(order.payment_status))}
        </span>
        <span>${escapeHtml(formatOrderSource(order.source))}</span>
      </div>

      <div class="active-order-summary">
        <p><span>Paid</span><strong>${formatMoney(order.amount_paid)}</strong></p>
        <p><span>Balance</span><strong>${formatMoney(order.balance_due)}</strong></p>
      </div>

      ${
        order.customer_name || order.customer_phone || order.delivery_address
          ? `
            <div class="order-customer-details">
              ${
                order.customer_name || order.customer_phone
                  ? `<p>${icon("user")} <span>${escapeHtml(order.customer_name || "Customer")}${order.customer_phone ? ` · ${escapeHtml(order.customer_phone)}` : ""}</span></p>`
                  : ""
              }
              ${
                order.delivery_address
                  ? `<p>${icon("delivery")} <span>${escapeHtml(order.delivery_address)}</span></p>`
                  : ""
              }
            </div>
          `
          : ""
      }

      ${
        order.handover_note
          ? `<p class="active-handover-note">${escapeHtml(order.handover_note)}</p>`
          : ""
      }

      <div class="active-order-actions">
        <button class="outline-action-button" type="button" data-view-order="${order.order_id}">
          ${icon("receipt")}
          <span>Details</span>
        </button>

        ${
          Number(order.balance_due) > 0
            ? `
              <button class="outline-action-button" type="button" data-collect-payment="${order.order_id}">
                <span>Payment</span>
                ${icon("add")}
              </button>
            `
            : ""
        }

        ${
          nextAction
            ? nextAction.blockedByPayment
              ? `
                <button
                  class="solid-action-button"
                  type="button"
                  disabled
                  title="Record the outstanding ${formatMoney(order.balance_due)} before completing this order"
                >
                  <span>Payment required</span>
                  ${icon("lock")}
                </button>
              `
              : `
                <button
                  class="solid-action-button"
                  type="button"
                  data-update-order="${order.order_id}"
                  data-next-status="${nextAction.status}"
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

function renderMyOrdersWorkspace() {
  const filters = state.myOrders.filters;

  return `
    <main class="orders-workspace">
      <div class="orders-header">
        <div>
          <p class="section-kicker">Your past orders</p>
          <h1>My history</h1>
        </div>
      </div>

      <div class="order-filters">
        <div class="order-filters-grid">
          <label class="form-field">
            <span>From</span>
            <input type="date" data-my-orders-date-from value="${filters.dateFrom}" />
          </label>
          <label class="form-field">
            <span>To</span>
            <input type="date" data-my-orders-date-to value="${filters.dateTo}" />
          </label>
          <label class="form-field">
            <span>Search</span>
            <input type="text" data-my-orders-search value="${escapeHtml(filters.search)}" placeholder="Order #, customer, phone" />
          </label>
        </div>

        <div class="menu-filter-tabs">
          ${renderMyOrdersBucketTab("all", "All")}
          ${renderMyOrdersBucketTab("active", "Active")}
          ${renderMyOrdersBucketTab("completed", "Completed")}
          ${renderMyOrdersBucketTab("cancelled", "Cancelled")}
        </div>
      </div>

      ${renderMyOrdersResults()}
      ${renderMyOrdersPagination()}
    </main>
  `;
}

function renderMyOrdersBucketTab(value, label) {
  return `
    <button class="menu-filter-tab ${state.myOrders.filters.statusBucket === value ? "is-active" : ""}" type="button" data-my-orders-bucket="${value}">
      ${label}
    </button>
  `;
}

function renderMyOrdersResults() {
  if (state.myOrders.isLoading && !state.myOrders.hasLoaded) {
    return `<div class="dashboard-chart-empty"><span class="boot-spinner"></span></div>`;
  }

  if (!state.myOrders.list.length) {
    return `
      <section class="orders-empty">
        <div class="empty-outline-icon">${icon("clock")}</div>
        <h2>No orders match these filters</h2>
        <p>Orders you create will show up here once they exist.</p>
      </section>
    `;
  }

  const rows = state.myOrders.list
    .map(
      (order) => `
        <tr data-view-my-order="${order.orderId}">
          <td class="is-order-number">${escapeHtml(order.orderNumber)}</td>
          <td>${formatDateTime(order.createdAt)}</td>
          <td>${escapeHtml(formatFulfillment(order.fulfillmentType))}</td>
          <td class="is-total">${formatMoney(order.total)}</td>
          <td><span class="order-payment-tag is-${order.paymentStatus}">${escapeHtml(formatPaymentStatus(order.paymentStatus))}</span></td>
          <td><span class="status-pill status-${escapeHtml(order.status)}">${escapeHtml(formatOrderStatus(order.status))}</span></td>
        </tr>
      `,
    )
    .join("");

  const cards = state.myOrders.list
    .map(
      (order) => `
        <div class="order-history-card" data-view-my-order="${order.orderId}">
          <div class="order-history-card-top">
            <strong>${escapeHtml(order.orderNumber)}</strong>
            <span class="status-pill status-${escapeHtml(order.status)}">${escapeHtml(formatOrderStatus(order.status))}</span>
          </div>
          <div class="dashboard-shift-card-row"><span>Date</span><span>${formatDateTime(order.createdAt)}</span></div>
          <div class="dashboard-shift-card-row"><span>Fulfillment</span><span>${escapeHtml(formatFulfillment(order.fulfillmentType))}</span></div>
          <div class="dashboard-shift-card-row"><span>Total</span><span>${formatMoney(order.total)}</span></div>
          <div class="dashboard-shift-card-row"><span>Payment</span><span>${escapeHtml(formatPaymentStatus(order.paymentStatus))}</span></div>
        </div>
      `,
    )
    .join("");

  return `
    <div class="order-table-wrap">
      <table class="order-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Date</th>
            <th>Fulfillment</th>
            <th>Total</th>
            <th>Payment</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="order-history-cards">${cards}</div>
  `;
}

function renderMyOrdersPagination() {
  if (!state.myOrders.totalCount) return "";

  const { offset, limit, totalCount } = state.myOrders;
  const from = totalCount === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, totalCount);

  return `
    <div class="order-pagination">
      <span>${from}–${to} of ${totalCount}</span>
      <div class="menu-form-actions">
        <button class="outline-action-button" type="button" data-my-orders-prev-page ${offset <= 0 ? "disabled" : ""}>Previous</button>
        <button class="outline-action-button" type="button" data-my-orders-next-page ${to >= totalCount ? "disabled" : ""}>Next</button>
      </div>
    </div>
  `;
}

async function loadMyOrdersData() {
  try {
    state.myOrders.isLoading = true;
    state.error = "";
    renderApp(state.root);

    const { orders, totalCount } = await getPosWorkerOrderHistory(
      state.session.sessionToken,
      {
        dateFrom: state.myOrders.filters.dateFrom,
        dateTo: state.myOrders.filters.dateTo,
        statusBucket: state.myOrders.filters.statusBucket,
        search: state.myOrders.filters.search,
        limit: state.myOrders.limit,
        offset: state.myOrders.offset,
      },
    );

    state.myOrders.list = orders;
    state.myOrders.totalCount = totalCount;
    state.myOrders.hasLoaded = true;
  } catch (error) {
    state.error = toUserMessage(error);
  } finally {
    state.myOrders.isLoading = false;
    renderApp(state.root);
  }
}

function applyMyOrdersFilters() {
  state.myOrders.offset = 0;
  loadMyOrdersData();
}

async function openMyOrderDetail(orderId) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="modal-card receipt-modal" role="dialog" aria-modal="true">
      <button class="modal-close-button" type="button" data-close-modal aria-label="Close">${icon("close")}</button>
      <div class="dashboard-chart-empty"><span class="boot-spinner"></span></div>
    </section>
  `;
  document.body.append(modal);
  modal.querySelector("[data-close-modal]")?.addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });

  try {
    const detail = await getPosWorkerOrderDetail(state.session.sessionToken, orderId);
    modal.querySelector(".modal-card").innerHTML =
      `<button class="modal-close-button" type="button" data-close-modal aria-label="Close">${icon("close")}</button>` +
      renderMyOrderDetailBody(detail);
    modal.querySelector("[data-close-modal]")?.addEventListener("click", () => modal.remove());
  } catch (error) {
    modal.querySelector(".modal-card").innerHTML =
      `<button class="modal-close-button" type="button" data-close-modal aria-label="Close">${icon("close")}</button>` +
      `<div class="form-alert error-alert">${escapeHtml(toUserMessage(error))}</div>`;
    modal.querySelector("[data-close-modal]")?.addEventListener("click", () => modal.remove());
  }
}

function renderMyOrderDetailBody(detail) {
  const itemsHtml = detail.items.length
    ? detail.items
        .map(
          (item) => `
            <div class="order-detail-row">
              <span>${item.quantity} × ${escapeHtml(item.itemName)}${item.proteinChoice ? ` (${escapeHtml(item.proteinChoice)})` : ""}</span>
              <span>${formatMoney(item.lineTotal)}</span>
            </div>
          `,
        )
        .join("")
    : `<p class="order-detail-empty">No items recorded.</p>`;

  const paymentsHtml = detail.payments.length
    ? detail.payments
        .map(
          (payment) => `
            <div class="order-detail-row">
              <span>${escapeHtml(formatPaymentMethod(payment.paymentMethod))}</span>
              <span>${formatMoney(payment.amount)}</span>
            </div>
          `,
        )
        .join("")
    : `<p class="order-detail-empty">No payments recorded.</p>`;

  return `
    <div class="receipt-header">
      <img src="/yumyard-logo.png" alt="Yum Yard" />
      <div>
        <p class="section-kicker">${escapeHtml(formatFulfillment(detail.fulfillmentType))} · ${escapeHtml(formatOrderSource(detail.source))}</p>
        <h2>${escapeHtml(detail.orderNumber)}</h2>
        <span class="status-pill status-${escapeHtml(detail.status)}">${escapeHtml(formatOrderStatus(detail.status))}</span>
      </div>
    </div>

    ${
      detail.status === "cancelled" && detail.cancellationReason
        ? `<p class="cancelled-note">Cancelled: ${escapeHtml(detail.cancellationReason)}</p>`
        : ""
    }

    <div class="receipt-summary">
      <div><span>Subtotal</span><strong>${formatMoney(detail.subtotal)}</strong></div>
      <div><span>Delivery fee</span><strong>${formatMoney(detail.deliveryFee)}</strong></div>
      <div class="receipt-grand-total"><span>Total</span><strong>${formatMoney(detail.total)}</strong></div>
    </div>

    ${
      detail.customerName || detail.customerPhone
        ? `<p class="receipt-detail">${icon("user")} <span>${escapeHtml(detail.customerName || "Customer")}${detail.customerPhone ? ` · ${escapeHtml(detail.customerPhone)}` : ""}</span></p>`
        : ""
    }
    ${detail.deliveryAddress ? `<p class="receipt-detail">${icon("delivery")} <span>${escapeHtml(detail.deliveryAddress)}</span></p>` : ""}
    ${detail.orderNotes ? `<p class="receipt-detail">${icon("edit")} <span>${escapeHtml(detail.orderNotes)}</span></p>` : ""}

    <div class="order-detail-section">
      <h3>Items</h3>
      ${itemsHtml}
    </div>

    <div class="order-detail-section">
      <h3>Payments</h3>
      ${paymentsHtml}
    </div>
  `;
}

function bindMyOrdersEvents() {
  const root = state.root;

  root.querySelector("[data-my-orders-date-from]")?.addEventListener("change", (event) => {
    state.myOrders.filters.dateFrom = event.target.value;
    applyMyOrdersFilters();
  });

  root.querySelector("[data-my-orders-date-to]")?.addEventListener("change", (event) => {
    state.myOrders.filters.dateTo = event.target.value;
    applyMyOrdersFilters();
  });

  let searchDebounce = null;
  root.querySelector("[data-my-orders-search]")?.addEventListener("input", (event) => {
    state.myOrders.filters.search = event.target.value;
    window.clearTimeout(searchDebounce);
    searchDebounce = window.setTimeout(() => applyMyOrdersFilters(), 400);
  });

  root.querySelectorAll("[data-my-orders-bucket]").forEach((button) => {
    button.addEventListener("click", () => {
      state.myOrders.filters.statusBucket = button.dataset.myOrdersBucket;
      applyMyOrdersFilters();
    });
  });

  root.querySelectorAll("[data-view-my-order]").forEach((element) => {
    element.addEventListener("click", () => {
      openMyOrderDetail(element.dataset.viewMyOrder);
    });
  });

  root.querySelector("[data-my-orders-prev-page]")?.addEventListener("click", () => {
    state.myOrders.offset = Math.max(0, state.myOrders.offset - state.myOrders.limit);
    loadMyOrdersData();
  });

  root.querySelector("[data-my-orders-next-page]")?.addEventListener("click", () => {
    state.myOrders.offset += state.myOrders.limit;
    loadMyOrdersData();
  });
}

function bindScreenEvents() {
  const root = state.root;

  root
    .querySelector("#open-shift-form")
    ?.addEventListener("submit", handleOpenShiftSubmit);
  root
    .querySelector("#close-shift-form")
    ?.addEventListener("submit", handleCloseShiftSubmit);
  root
    .querySelector("#close-day-form")
    ?.addEventListener("submit", handleCloseDaySubmit);

  const closeCashInput = root.querySelector(
    '#close-shift-form [name="actualCashCounted"]',
  );
  const closeNoteField = root.querySelector(
    '#close-shift-form [name="closingNote"]',
  );

  closeCashInput?.addEventListener("input", updateCloseShiftFormState);
  closeNoteField?.addEventListener("input", updateCloseShiftFormState);

  if (state.view === "closing-shift") {
    updateCloseShiftFormState();
  }

  root.querySelectorAll("[data-sign-out]").forEach((button) => {
    button.addEventListener("click", () => signOut("Signed out from POS."));
  });

  root.querySelectorAll("[data-go-pos]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.view = "pos";
      state.error = "";
      state.notice = "";
      state.isCategoryRailOpen = false;
      await refreshActiveOrders();
      renderApp(root);
    });
  });

  root.querySelectorAll("[data-go-orders]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.view = "orders";
      state.error = "";
      state.notice = "";
      state.isCategoryRailOpen = false;
      await refreshActiveOrders();
      renderApp(root);
    });
  });

  root.querySelectorAll("[data-go-my-orders]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.view = "my-orders";
      state.error = "";
      state.notice = "";
      state.isCategoryRailOpen = false;
      renderApp(root);
      await loadMyOrdersData();
    });
  });

  root.querySelectorAll("[data-switch-worker]").forEach((button) => {
    button.addEventListener("click", () => {
      lockAndReturnToLogin();
    });
  });

  root.querySelectorAll("[data-close-shift]").forEach((button) => {
    button.addEventListener("click", async () => {
      await openCloseShiftFlow();
    });
  });

  root.querySelectorAll("[data-cancel-close-shift]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = "pos";
      state.error = "";
      renderApp(root);
    });
  });

  root.querySelectorAll("[data-close-day-instead]").forEach((button) => {
    button.addEventListener("click", async () => {
      await openCloseDayFlow();
    });
  });

  root.querySelectorAll("[data-cancel-close-day]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.error = "";
      state.view = "opening-shift";
      state.isLoading = true;
      renderApp(root);

      try {
        state.shiftOpeningContext = await getShiftOpeningContext(state.session.sessionToken);
      } catch (error) {
        state.error = toUserMessage(error);
      } finally {
        state.isLoading = false;
        renderApp(root);
      }
    });
  });

  root.querySelectorAll("[data-toggle-categories]").forEach((button) => {
    button.addEventListener("click", () => {
      state.isCategoryRailOpen = !state.isCategoryRailOpen;
      renderApp(root);
    });
  });

  root.querySelectorAll("[data-close-categories]").forEach((overlay) => {
    overlay.addEventListener("click", () => {
      state.isCategoryRailOpen = false;
      renderApp(root);
    });
  });

  root.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      if (window.innerWidth < 768) {
        state.isCategoryRailOpen = false;
      }
      state.activeCategoryId = button.dataset.category;
      renderApp(root);
    });
  });

  root.querySelectorAll("[data-add-item]").forEach((button) => {
  button.addEventListener("click", () => {
    const item = state.menuItems.find(
      (menuItem) => menuItem.id === button.dataset.addItem,
    );
    if (!item) return;

    if (item.requiresProtein) {
      openProteinModal(item);
      return;
    }

    addToCart(item);
  });
});

  bindCartEvents();
  bindOrderEvents();
  bindMyOrdersEvents();
  bindLoginEvents();
}

function bindLoginEvents() {
  const root = state.root;

  root.querySelectorAll("[data-select-profile]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedWorkerId = button.dataset.selectProfile;
      state.loginPin = "";
      state.error = "";
      renderApp(root);
    });
  });

  root.querySelector("[data-pin-back]")?.addEventListener("click", () => {
    state.selectedWorkerId = null;
    state.loginPin = "";
    state.error = "";
    renderApp(root);
  });

  root.querySelectorAll("[data-pin-digit]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.loginPin.length >= 12) return;
      state.loginPin += button.dataset.pinDigit;
      state.error = "";
      renderApp(root);
    });
  });

  root.querySelector("[data-pin-backspace]")?.addEventListener("click", () => {
    state.loginPin = state.loginPin.slice(0, -1);
    renderApp(root);
  });

  root.querySelector("[data-pin-clear]")?.addEventListener("click", () => {
    state.loginPin = "";
    renderApp(root);
  });

  root
    .querySelector("[data-pin-submit]")
    ?.addEventListener("click", handleProfileLoginSubmit);
}

function bindCartEvents() {
  const root = state.root;

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

      if (item.quantity <= 1) {
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

    if (!window.confirm("Clear all items from this order?")) {
      return;
    }

    state.cart = [];
    state.checkout = createCheckoutState();
    renderApp(root);
  });

  root.querySelectorAll("[data-open-checkout]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.cart.length) {
        openCheckoutModal();
      }
    });
  });
}

function bindOrderEvents() {
  const root = state.root;

  root.querySelectorAll("[data-update-order]").forEach((button) => {
    button.addEventListener("click", async () => {
      await handleOrderStatusUpdate(
        button.dataset.updateOrder,
        button.dataset.nextStatus,
      );
    });
  });

  root.querySelectorAll("[data-collect-payment]").forEach((button) => {
    button.addEventListener("click", () => {
      const order = state.activeOrders.find(
        (item) => item.order_id === button.dataset.collectPayment,
      );
      if (order) {
        openPaymentModal(order);
      }
    });
  });

  root.querySelectorAll("[data-view-order]").forEach((button) => {
    button.addEventListener("click", () => {
      const order = state.activeOrders.find(
        (item) => item.order_id === button.dataset.viewOrder,
      );
      if (order) {
        openOrderDetailsModal(order);
      }
    });
  });
}

async function loadLoginWorkers() {
  try {
    state.isLoadingWorkers = true;
    renderApp(state.root);

    state.loginWorkers = await listBranchWorkers();
  } catch (error) {
    state.error = toUserMessage(error);
  } finally {
    state.isLoadingWorkers = false;
    renderApp(state.root);
  }
}

async function handleProfileLoginSubmit() {
  const workerId = state.selectedWorkerId;
  const pin = state.loginPin;
  const worker = state.loginWorkers.find((item) => item.workerId === workerId);

  if (!workerId || !worker) {
    state.error = "Select your profile first.";
    renderApp(state.root);
    return;
  }

  if (pin.length < 4) {
    state.error = "Enter your PIN.";
    renderApp(state.root);
    return;
  }

  try {
    state.isLoading = true;
    state.error = "";
    state.notice = "";
    renderApp(state.root);

    const session = await authenticatePosWorkerById(workerId, pin);
    savePosSession(session);
    state.session = session;
    state.selectedWorkerId = null;
    state.loginPin = "";
    startInactivityWatch();

    await routeAuthenticatedWorker();
  } catch (error) {
    // A wrong PIN shouldn't force the worker to re-find their name in the
    // list - keep them on their own profile with an empty PIN to retry.
    state.loginPin = "";
    state.error = toUserMessage(error);
    state.isLoading = false;
    renderApp(state.root);
  }
}

async function routeAuthenticatedWorker() {
  try {
    const activeShift = await getActiveWorkerShift(state.session.sessionToken);

    if (activeShift?.shift_id) {
      state.shift = normalizeShift(activeShift);
      await loadAfterShiftOpen();
      return;
    }

    const openingContext = await getShiftOpeningContext(
      state.session.sessionToken,
    );

    if (openingContext?.active_shift_id) {
      if (openingContext.active_shift_worker_id !== state.session.workerId) {
        throw new Error(
          `${openingContext.active_shift_worker_name} has an active shift. The shift must be closed before you can open yours.`,
        );
      }

      state.shift = {
        shiftId: openingContext.active_shift_id,
        workerId: openingContext.active_shift_worker_id,
        workerName: openingContext.active_shift_worker_name,
        status: "open",
        openedAt: openingContext.active_shift_opened_at,
      };

      await loadAfterShiftOpen();
      return;
    }

    state.shiftOpeningContext = openingContext;
    state.view = "opening-shift";
    state.isLoading = false;
    state.error = "";
    renderApp(state.root);
  } catch (error) {
    state.isLoading = false;
    state.error = toUserMessage(error);
    state.view = "login";
    renderApp(state.root);
  }
}

async function handleOpenShiftSubmit(event) {
  event.preventDefault();

  const formData = new FormData(event.currentTarget);
  const openingCash = Number(formData.get("openingCash"));
  const openingNote = String(formData.get("openingNote") || "").trim();

  if (Number.isNaN(openingCash) || openingCash < 0) {
    state.error = "Enter a valid opening cash amount.";
    renderApp(state.root);
    return;
  }

  try {
    state.isLoading = true;
    state.error = "";
    renderApp(state.root);

    const shift = await openWorkerShift(
      state.session.sessionToken,
      openingCash,
      openingNote,
    );

    state.shift = normalizeShift(shift);
    await loadAfterShiftOpen();
  } catch (error) {
    state.isLoading = false;
    state.error = toUserMessage(error);
    renderApp(state.root);
  }
}

async function loadAfterShiftOpen() {
  try {
    state.isLoading = true;
    const [menu, orders] = await Promise.all([
      getPosMenu(state.session.branchId),
      getPosActiveOrders(state.session.sessionToken),
    ]);

    state.categories = menu.categories;
    state.menuItems = menu.items;
    state.activeOrders = orders;

    // Auto-select first category (skip empty ones)
    const nonEmptyCategories = state.categories.filter((cat) => {
      const count = state.menuItems.filter(
        (item) => item.categoryId === cat.id,
      ).length;
      return count > 0;
    });

    if (nonEmptyCategories.length > 0) {
      state.activeCategoryId = nonEmptyCategories[0].id;
    } else {
      state.activeCategoryId = null;
    }

    state.isCategoryRailOpen = false;
    state.isLoading = false;
    state.error = "";
    state.view = "pos";

    renderApp(state.root);
  } catch (error) {
    state.isLoading = false;
    state.error = toUserMessage(error);
    state.view = "login";
    renderApp(state.root);
  }
}

async function openCloseShiftFlow() {
  try {
    state.isLoading = true;
    state.error = "";
    renderApp(state.root);

    const preview = await getShiftClosePreview(state.session.sessionToken);

    state.shiftClosePreview = preview;
    state.view = "closing-shift";
    state.isLoading = false;
    renderApp(state.root);
  } catch (error) {
    state.isLoading = false;
    state.error = toUserMessage(error);
    renderApp(state.root);
  }
}

async function openCloseDayFlow() {
  try {
    state.isLoading = true;
    state.error = "";
    renderApp(state.root);

    const preview = await getCloseDayPreview(state.session.sessionToken);

    state.closeDayPreview = preview;
    state.view = "close-day";
    state.isLoading = false;
    renderApp(state.root);
  } catch (error) {
    state.isLoading = false;
    state.error = toUserMessage(error);
    renderApp(state.root);
  }
}

async function handleCloseDaySubmit(event) {
  event.preventDefault();

  const formData = new FormData(event.currentTarget);
  const cashHandedOver = Number(formData.get("cashHandedOver"));
  const openingFloat = Number(formData.get("openingFloat"));
  const notes = String(formData.get("notes") || "").trim();

  if (Number.isNaN(cashHandedOver) || cashHandedOver < 0) {
    state.error = "Enter a valid cash amount.";
    renderApp(state.root);
    return;
  }

  if (Number.isNaN(openingFloat) || openingFloat < 0) {
    state.error = "Enter a valid opening float for tomorrow.";
    renderApp(state.root);
    return;
  }

  try {
    state.isLoading = true;
    state.error = "";
    renderApp(state.root);

    await closeBusinessDay(state.session.sessionToken, {
      cashHandedOver,
      openingFloatForNextDay: openingFloat,
      notes,
    });

    state.closeDayPreview = null;
    state.notice = "Day closed. Ready for a new day.";
    state.shiftOpeningContext = await getShiftOpeningContext(state.session.sessionToken);
    state.view = "opening-shift";
    state.isLoading = false;
    renderApp(state.root);
  } catch (error) {
    state.isLoading = false;
    state.error = toUserMessage(error);
    renderApp(state.root);
  }
}

// Keeps the variance readout and the closing-note required state in sync
// with the cash input as the worker types, without a full renderApp() (that
// would drop input focus mid-keystroke). Mirrors handleCloseShiftSubmit's
// own variance math and the same policy: a note is required whenever the
// counted cash doesn't match the expected cash.
function updateCloseShiftFormState() {
  const root = state.root;
  const preview = state.shiftClosePreview;
  if (!root || !preview) return;

  const cashInput = root.querySelector(
    '#close-shift-form [name="actualCashCounted"]',
  );
  const noteField = root.querySelector(
    '#close-shift-form [name="closingNote"]',
  );
  const varianceEl = root.querySelector("#close-shift-variance");
  const noteHint = root.querySelector("#closing-note-required-hint");
  const submitButton = root.querySelector('#close-shift-form button[type="submit"]');

  if (!cashInput) return;

  const openOrders = preview.open_orders || [];
  const expectedCash = Number(preview.expected_cash ?? 0);
  const counted = Number(cashInput.value);
  const hasValidCash =
    cashInput.value !== "" && !Number.isNaN(counted) && counted >= 0;
  const variance = hasValidCash
    ? Number((counted - expectedCash).toFixed(2))
    : 0;
  const noteFilled = Boolean(noteField?.value.trim());

  if (varianceEl) {
    if (!hasValidCash) {
      varianceEl.textContent = "Enter the counted cash amount";
      varianceEl.className = "variance-readout";
    } else if (variance === 0) {
      varianceEl.textContent = "Matches expected cash";
      varianceEl.className = "variance-readout is-balanced";
    } else {
      varianceEl.textContent = `${variance > 0 ? "Over" : "Short"} by ${formatMoney(Math.abs(variance))}`;
      varianceEl.className = "variance-readout is-off";
    }
  }

  if (noteField) {
    noteField.required = variance !== 0;
  }

  if (noteHint) {
    noteHint.textContent =
      variance !== 0 ? "Required — explain the difference" : "Optional";
    noteHint.className = variance !== 0 ? "required-hint is-required" : "";
  }

  // Open orders and an in-flight submit already force this disabled via
  // the server-rendered markup - only layer the variance/note check on
  // top when the form is otherwise interactive.
  if (submitButton && !openOrders.length && !state.isLoading) {
    const blockedByVariance = variance !== 0 && !noteFilled;
    submitButton.disabled = !hasValidCash || blockedByVariance;
    submitButton.title = blockedByVariance
      ? "Add a closing note explaining the cash difference"
      : "";
  }
}

async function handleCloseShiftSubmit(event) {
  event.preventDefault();

  const formData = new FormData(event.currentTarget);
  const actualCashCounted = Number(formData.get("actualCashCounted"));
  const closingNote = String(formData.get("closingNote") || "").trim();
  const openOrders = state.shiftClosePreview?.open_orders || [];

  // Matches close_worker_shift()'s unconditional rule: no active order may
  // remain tied to this shift. There is no handover/admin-approval bypass.
  if (openOrders.length) {
    state.error = `${openOrders.length} active order${openOrders.length === 1 ? " is" : "s are"} still open. Complete, cancel, or otherwise resolve ${openOrders.length === 1 ? "it" : "them"} before closing.`;
    renderApp(state.root);
    return;
  }

  if (Number.isNaN(actualCashCounted) || actualCashCounted < 0) {
    state.error = "Enter a valid cash amount.";
    renderApp(state.root);
    return;
  }

  // close_worker_shift() rejects a variance without an explanation, so ask
  // for the note here rather than surfacing a raw server error.
  const expectedCash = Number(
    state.shiftClosePreview?.expected_cash ?? actualCashCounted,
  );
  const cashVariance = Number(
    (actualCashCounted - expectedCash).toFixed(2),
  );

  if (cashVariance !== 0 && !closingNote) {
    state.error = `Counted cash is ${formatMoney(Math.abs(cashVariance))} ${
      cashVariance > 0 ? "over" : "short"
    }. Add a closing note explaining the difference.`;
    renderApp(state.root);
    return;
  }

  try {
    state.isLoading = true;
    state.error = "";
    renderApp(state.root);

    await closeWorkerShift({
      sessionToken: state.session.sessionToken,
      actualCashCounted,
      closingNote,
    });

    clearPosSession();
    resetOperationalState();
    state.notice = "Shift closed successfully.";
    showLogin();
  } catch (error) {
    state.isLoading = false;
    state.error = toUserMessage(error);
    renderApp(state.root);
  }
}

function addToCart(item, proteinOption = null) {
  const protein = proteinOption?.name || null;
  const unitPrice =
    Number(item.price) + Number(proteinOption?.priceAdjustment || 0);

  const existing = state.cart.find(
    (cartItem) =>
      cartItem.menuItemId === item.id &&
      cartItem.protein === protein &&
      cartItem.unitPrice === unitPrice,
  );

  if (existing) {
    existing.quantity += 1;
  } else {
    state.cart.push({
      cartId: createId("cart"),
      menuItemId: item.id,
      name: item.name,
      unitPrice,
      protein,
      quantity: 1,
    });
  }

  renderApp(state.root);
}

function openProteinModal(item) {
  const options = item.proteinOptions || [];

  if (!options.length) {
    state.error = `${item.name} has no active protein options. Ask the owner to update the menu.`;
    renderApp(state.root);
    return;
  }

  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="modal-card protein-modal" role="dialog" aria-modal="true" aria-labelledby="protein-modal-title">
      <button class="modal-close-button" type="button" data-close-modal aria-label="Close">
        ${icon("close")}
      </button>

      <div class="modal-heading">
        <p class="section-kicker">Required selection</p>
        <h2 id="protein-modal-title">Choose protein</h2>
        <p>${escapeHtml(item.name)} includes tilapia or chicken at the listed pack price.</p>
      </div>

      <div class="protein-selection-grid">
        ${options
          .map(
            (option) => `
              <button class="protein-selection-button" type="button" data-protein-option="${escapeHtml(option.name)}">
                <span>${escapeHtml(option.name)}</span>
                <small>${
                  Number(option.priceAdjustment) > 0
                    ? `+ ${formatMoney(option.priceAdjustment)}`
                    : "Included in pack"
                }</small>
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
    ?.addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });

  modal.querySelectorAll("[data-protein-option]").forEach((button) => {
    button.addEventListener("click", () => {
      const selectedOption = options.find(
        (option) => option.name === button.dataset.proteinOption,
      );

      if (selectedOption) {
        addToCart(item, selectedOption);
      }

      modal.remove();
    });
  });
}

function openCheckoutModal() {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = renderCheckoutModal();
  document.body.append(modal);
  bindCheckoutModal(modal);
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
        <p>Confirm where the order is going. Payments are recorded from the Orders screen when received.</p>
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
            <span>Customer name <em>Optional</em></span>
            <input name="customerName" value="${escapeHtml(state.checkout.customerName)}" placeholder="Customer name" autocomplete="off" />
          </label>
        </div>

        <div class="checkout-field-grid">
          <label class="form-field">
            <span>Phone number <em>Optional</em></span>
            <input name="customerPhone" value="${escapeHtml(state.checkout.customerPhone)}" placeholder="054 000 0000" inputmode="tel" autocomplete="off" />
          </label>

          <div></div>
        </div>

        <div id="delivery-fields">${renderDeliveryFields()}</div>

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

        <button class="checkout-button checkout-confirm-button" type="submit" ${state.isLoading ? "disabled" : ""}>
          <span>${state.isLoading ? "Creating order..." : "Confirm order"}</span>
          <strong>${formatMoney(getOrderTotal())}</strong>
          ${state.isLoading ? `<span class="button-spinner"></span>` : icon("arrowRight")}
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
          <div class="money-input">
            <span>GH₵</span>
            <input
              name="deliveryFee"
              type="number"
              min="0"
              step="0.01"
              value="${Number(state.checkout.deliveryFee || 0).toFixed(2)}"
              inputmode="decimal"
              required
            />
          </div>
        </label>

        <div></div>
      </div>

      <label class="form-field">
        <span>Location / landmark</span>
        <input
          name="deliveryAddress"
          value="${escapeHtml(state.checkout.deliveryAddress)}"
          placeholder="Example: UCC, Kotokuraba, near..."
          autocomplete="off"
          required
        />
      </label>
    </section>
  `;
}

function bindCheckoutModal(modal) {
  const form = modal.querySelector("#checkout-form");

  modal
    .querySelector("[data-close-modal]")
    ?.addEventListener("click", () => modal.remove());

  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });

  modal.querySelectorAll("[data-fulfillment]").forEach((button) => {
    button.addEventListener("click", () => {
      persistCheckoutFormValues(form);
      state.checkout.fulfillmentType = button.dataset.fulfillment;

      if (state.checkout.fulfillmentType !== "delivery") {
        state.checkout.deliveryFee = 0;
        state.checkout.deliveryAddress = "";
      }

      modal.innerHTML = renderCheckoutModal();
      bindCheckoutModal(modal);
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    persistCheckoutFormValues(form);

    if (
      state.checkout.fulfillmentType === "delivery" &&
      !state.checkout.deliveryAddress
    ) {
      showModalError(modal, "Enter a delivery location or landmark.");
      return;
    }

    try {
      state.isLoading = true;
      modal.innerHTML = renderCheckoutModal();
      bindCheckoutModal(modal);

      const createdOrder = await createPosOrder(
        state.session.sessionToken,
        state.checkout,
        state.cart,
      );

      state.cart = [];
      state.checkout = createCheckoutState();
      await refreshActiveOrders();

      state.isLoading = false;
      state.view = "orders";
      state.notice = `${createdOrder.order_number} created successfully.`;
      modal.remove();
      renderApp(state.root);
    } catch (error) {
      state.isLoading = false;
      showModalError(modal, toUserMessage(error));
    }
  });
}

function persistCheckoutFormValues(form) {
  const formData = new FormData(form);

  state.checkout.source = String(formData.get("source") || "direct-pos");
  state.checkout.customerName = String(
    formData.get("customerName") || "",
  ).trim();
  state.checkout.customerPhone = String(
    formData.get("customerPhone") || "",
  ).trim();
  state.checkout.deliveryAddress = String(
    formData.get("deliveryAddress") || "",
  ).trim();
  state.checkout.deliveryFee = Number(formData.get("deliveryFee") || 0);
  state.checkout.notes = String(formData.get("notes") || "").trim();
}

async function handleOrderStatusUpdate(orderId, nextStatus, cancellationReason = null) {
  try {
    state.isLoading = true;
    state.error = "";
    renderApp(state.root);

    const result = await updatePosOrderStatus(
      state.session.sessionToken,
      orderId,
      nextStatus,
      cancellationReason,
    );

    await refreshActiveOrders();
    state.isLoading = false;
    state.notice =
      nextStatus === "cancelled"
        ? `${result.order_number} cancelled: ${cancellationReason}`
        : `${result.order_number} marked ${formatOrderStatus(result.status).toLowerCase()}.`;
    renderApp(state.root);
  } catch (error) {
    state.isLoading = false;
    state.error = toUserMessage(error);
    renderApp(state.root);
  }
}

function openPaymentModal(order) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="modal-card payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-title">
      <button class="modal-close-button" type="button" data-close-modal aria-label="Close payment">
        ${icon("close")}
      </button>

      <div class="modal-heading">
        <p class="section-kicker">${escapeHtml(order.order_number)}</p>
        <h2 id="payment-title">Record payment</h2>
        <p>Balance due: <strong>${formatMoney(order.balance_due)}</strong></p>
      </div>

      <form id="payment-form" class="checkout-form">
        <div class="checkout-section">
          <label class="form-section-label">Payment method</label>
          <div class="payment-method-grid">
            ${renderPaymentButton("cash", "Cash")}
            ${renderPaymentButton("momo", "Mobile Money")}
            ${renderPaymentButton("hubtel", "Hubtel")}
          </div>
        </div>

        <label class="form-field">
          <span>Amount received</span>
          <div class="money-input">
            <span>GH₵</span>
            <input
              name="amount"
              type="number"
              min="0.01"
              max="${Number(order.balance_due)}"
              step="0.01"
              value="${Number(order.balance_due).toFixed(2)}"
              inputmode="decimal"
              required
            />
          </div>
        </label>

        <label class="form-field">
          <span>Reference <em>Optional</em></span>
          <input name="reference" placeholder="MoMo reference or note" autocomplete="off" />
        </label>

        <button class="checkout-button" type="submit">
          <span>Record payment</span>
          <strong>${formatMoney(order.balance_due)}</strong>
          ${icon("check")}
        </button>
      </form>
    </section>
  `;

  document.body.append(modal);

  let selectedMethod = "cash";

  modal
    .querySelector("[data-close-modal]")
    ?.addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });

  modal.querySelectorAll("[data-payment-method]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedMethod = button.dataset.paymentMethod;
      modal.querySelectorAll("[data-payment-method]").forEach((item) => {
        item.classList.toggle(
          "is-active",
          item.dataset.paymentMethod === selectedMethod,
        );
      });
    });
  });

  modal
    .querySelector("#payment-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();

      const formData = new FormData(event.currentTarget);
      const amount = Number(formData.get("amount"));
      const reference = String(formData.get("reference") || "").trim();

      if (!amount || amount <= 0) {
        showModalError(modal, "Enter a valid payment amount.");
        return;
      }

      if (amount > Number(order.balance_due)) {
        showModalError(modal, "Payment cannot exceed the remaining balance.");
        return;
      }

      try {
        const result = await recordOrderPayment(
          state.session.sessionToken,
          order.order_id,
          selectedMethod,
          amount,
          reference,
        );

        await refreshActiveOrders();
        state.notice =
          result.payment_status === "paid"
            ? `${order.order_number} is fully paid.`
            : `${formatMoney(result.payment_amount)} payment recorded.`;

        modal.remove();
        renderApp(state.root);
      } catch (error) {
        showModalError(modal, toUserMessage(error));
      }
    });
}

function renderPaymentButton(value, label) {
  return `
    <button
      class="payment-method-button ${value === "cash" ? "is-active" : ""}"
      type="button"
      data-payment-method="${value}"
    >
      <span>${label}</span>
      ${value === "cash" ? icon("check") : ""}
    </button>
  `;
}

function renderOrderDetailsView(order) {
  return `
    <section class="modal-card receipt-modal" role="dialog" aria-modal="true" aria-labelledby="order-detail-title">
      <button class="modal-close-button" type="button" data-close-modal aria-label="Close">
        ${icon("close")}
      </button>

      <div class="receipt-header">
        <img src="/yumyard-logo.png" alt="Yum Yard" />
        <div>
          <p class="section-kicker">Active order</p>
          <h2 id="order-detail-title">${escapeHtml(order.order_number)}</h2>
          <span>${escapeHtml(formatFulfillment(order.fulfillment_type))} · ${escapeHtml(formatOrderStatus(order.status))}</span>
        </div>
      </div>

      <div class="receipt-summary">
        <div>
          <span>Food subtotal</span>
          <strong>${formatMoney(order.subtotal)}</strong>
        </div>
        <div>
          <span>Delivery fee</span>
          <strong>${formatMoney(order.delivery_fee)}</strong>
        </div>
        <div class="receipt-grand-total">
          <span>Total</span>
          <strong>${formatMoney(order.total)}</strong>
        </div>
      </div>

      <div class="receipt-summary">
        <div>
          <span>Paid</span>
          <strong>${formatMoney(order.amount_paid)}</strong>
        </div>
        <div>
          <span>Balance due</span>
          <strong>${formatMoney(order.balance_due)}</strong>
        </div>
      </div>

      ${
        order.customer_name || order.customer_phone
          ? `<p class="receipt-detail">${icon("user")} <span>${escapeHtml(order.customer_name || "Customer")}${order.customer_phone ? ` · ${escapeHtml(order.customer_phone)}` : ""}</span></p>`
          : ""
      }

      ${
        order.delivery_address
          ? `<p class="receipt-detail">${icon("delivery")} <span>${escapeHtml(order.delivery_address)}</span></p>`
          : ""
      }

      ${
        order.order_notes
          ? `<p class="receipt-detail">${icon("edit")} <span>${escapeHtml(order.order_notes)}</span></p>`
          : ""
      }

      ${
        order.handover_note
          ? `<p class="receipt-detail">${icon("orders")} <span>${escapeHtml(order.handover_note)}</span></p>`
          : ""
      }

      <div class="receipt-actions">
        <button class="solid-action-button" type="button" data-close-modal>
          <span>Done</span>
          ${icon("check")}
        </button>
        <button class="danger-outline-button" type="button" data-open-cancel-order>
          ${icon("ban")}
          <span>Cancel order</span>
        </button>
      </div>
    </section>
  `;
}

function renderCancelOrderView(order) {
  return `
    <section class="modal-card receipt-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-order-title">
      <button class="modal-close-button" type="button" data-close-modal aria-label="Close">
        ${icon("close")}
      </button>

      <div class="modal-heading">
        <p class="section-kicker">${escapeHtml(order.order_number)}</p>
        <h2 id="cancel-order-title">Cancel this order?</h2>
        <p>This can't be undone. A reason is required and is recorded on the order.</p>
      </div>

      <form id="cancel-order-form" class="checkout-form">
        <label class="form-field">
          <span>Cancellation reason</span>
          <textarea
            name="cancellationReason"
            rows="3"
            placeholder="Example: Customer no longer wants the order"
            required
          ></textarea>
        </label>

        <div class="modal-action-row">
          <button class="text-button" type="button" data-cancel-order-back>Back</button>
          <button class="destructive-button" type="submit">
            <span>Confirm cancellation</span>
            ${icon("ban")}
          </button>
        </div>
      </form>
    </section>
  `;
}

function openOrderDetailsModal(order) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = renderOrderDetailsView(order);
  document.body.append(modal);

  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });

  bindOrderDetailsView(modal, order);
}

function bindOrderDetailsView(modal, order) {
  modal
    .querySelector("[data-close-modal]")
    ?.addEventListener("click", () => modal.remove());

  modal.querySelector("[data-open-cancel-order]")?.addEventListener("click", () => {
    modal.innerHTML = renderCancelOrderView(order);
    bindCancelOrderView(modal, order);
  });
}

function bindCancelOrderView(modal, order) {
  modal
    .querySelector("[data-close-modal]")
    ?.addEventListener("click", () => modal.remove());

  modal.querySelector("[data-cancel-order-back]")?.addEventListener("click", () => {
    modal.innerHTML = renderOrderDetailsView(order);
    bindOrderDetailsView(modal, order);
  });

  modal
    .querySelector("#cancel-order-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();

      const formData = new FormData(event.currentTarget);
      const reason = String(formData.get("cancellationReason") || "").trim();

      if (!reason) {
        showModalError(modal, "Enter a reason for cancelling this order.");
        return;
      }

      const submitButton = event.currentTarget.querySelector(
        "button[type=submit]",
      );
      if (submitButton) submitButton.disabled = true;

      try {
        const result = await updatePosOrderStatus(
          state.session.sessionToken,
          order.order_id,
          "cancelled",
          reason,
        );

        await refreshActiveOrders();
        state.notice = `${result.order_number} cancelled: ${reason}`;

        modal.remove();
        renderApp(state.root);
      } catch (error) {
        if (submitButton) submitButton.disabled = false;
        showModalError(modal, toUserMessage(error));
      }
    });
}

async function refreshActiveOrders() {
  if (!state.session?.sessionToken) return;

  state.activeOrders = await getPosActiveOrders(state.session.sessionToken);
}

async function lockAndReturnToLogin() {
  const sessionToken = state.session?.sessionToken;

  try {
    if (sessionToken) {
      await lockPosSession(sessionToken, "Locked from Yum Yard tablet");
    }
  } catch {
    // Local session still must be cleared even when the network request fails.
  }

  clearPosSession();
  resetOperationalState();
  state.notice = "POS locked.";
  showLogin();
}

async function signOut(notice = "") {
  const sessionToken = state.session?.sessionToken;

  try {
    if (sessionToken) {
      await lockPosSession(sessionToken, "Signed out from Yum Yard POS");
    }
  } catch {
    // Clear browser state even if the remote request fails.
  }

  clearPosSession();
  resetOperationalState();
  state.notice = notice;
  showLogin();
}

function showLogin() {
  state.view = "login";
  state.isLoading = false;
  state.selectedWorkerId = null;
  state.loginPin = "";
  renderApp(state.root);
  loadLoginWorkers();
}

function setupGlobalActivityListeners() {
  const markActivity = () => {
    lastActivityAt = Date.now();
  };

  document.addEventListener("click", markActivity, { passive: true });
  document.addEventListener("keydown", markActivity, { passive: true });
  document.addEventListener("touchstart", markActivity, { passive: true });
  document.addEventListener("pointerdown", markActivity, { passive: true });
}

// Views where a worker is signed in and the inactivity clock should run.
function isAuthenticatedView(view) {
  return (
    view === "opening-shift" ||
    view === "closing-shift" ||
    view === "close-day" ||
    view === "orders" ||
    view === "my-orders" ||
    view === "pos"
  );
}

function startInactivityWatch() {
  lastActivityAt = Date.now();
  stopInactivityWatch();

  inactivityCheckHandle = window.setInterval(() => {
    if (!state.session || !isAuthenticatedView(state.view)) {
      return;
    }

    const elapsedMinutes = (Date.now() - lastActivityAt) / 60000;

    if (elapsedMinutes >= APP_CONFIG.inactivityLockMinutes) {
      stopInactivityWatch();
      lockAndReturnToLogin();
    }
  }, 15000);
}

function stopInactivityWatch() {
  if (inactivityCheckHandle) {
    window.clearInterval(inactivityCheckHandle);
    inactivityCheckHandle = null;
  }
}

function resetOperationalState() {
  state.session = null;
  state.shift = null;
  state.shiftClosePreview = null;
  state.shiftOpeningContext = null;
  state.closeDayPreview = null;
  state.categories = [];
  state.menuItems = [];
  state.activeOrders = [];
  state.cart = [];
  state.activeCategoryId = null;
  state.isCategoryRailOpen = false;
  state.selectedWorkerId = null;
  state.loginPin = "";
  state.checkout = createCheckoutState();
  state.error = "";
  state.myOrders.hasLoaded = false;
  state.myOrders.list = [];
  state.myOrders.totalCount = 0;
  state.myOrders.offset = 0;
  stopInactivityWatch();
}

function getVisibleProducts() {
  return state.menuItems.filter((item) => {
    const activeCategory = state.categories.find(
      (category) => category.id === state.activeCategoryId,
    );

    if (!activeCategory) {
      return false;
    }

    return item.categoryId === activeCategory.id;
  });
}

function getCategoryCount(categoryId) {
  const category = state.categories.find((item) => item.id === categoryId);

  if (!category) {
    return 0;
  }

  return state.menuItems.filter((item) => item.categoryId === category.id)
    .length;
}

function getActiveCategoryName() {
  return (
    state.categories.find((category) => category.id === state.activeCategoryId)
      ?.name || "Menu"
  );
}

function getCartSubtotal() {
  return state.cart.reduce(
    (total, item) => total + item.unitPrice * item.quantity,
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

function getNextOrderAction(order) {
  const actions = {
    confirmed: { status: "preparing", label: "Start preparing" },
    preparing: { status: "ready", label: "Mark ready" },
    ready:
      order.fulfillment_type === "delivery"
        ? { status: "out_for_delivery", label: "Send with rider" }
        : { status: "awaiting_pickup", label: "Await pickup" },
    awaiting_pickup: { status: "completed", label: "Complete order" },
    out_for_delivery: { status: "completed", label: "Mark delivered" },
  };

  const nextAction = actions[order.status] || null;

  // An order can only be completed once it is fully paid. Mirrors the
  // server-side gate in update_pos_order_status so the worker sees why
  // the action is unavailable instead of hitting an RPC error.
  if (
    nextAction?.status === "completed" &&
    Number(order.balance_due) > 0
  ) {
    return { ...nextAction, blockedByPayment: true };
  }

  return nextAction;
}

function getFulfillmentIcon(type) {
  const iconNames = {
    "walk-in": "cart",
    pickup: "pickup",
    delivery: "delivery",
    "dine-in": "dineIn",
  };

  return icon(iconNames[type] || "cart");
}

function formatOrderStatus(status) {
  const labels = {
    confirmed: "Confirmed",
    preparing: "Preparing",
    ready: "Ready",
    awaiting_pickup: "Awaiting pickup",
    out_for_delivery: "Out for delivery",
    completed: "Completed",
    cancelled: "Cancelled",
    voided: "Voided",
  };

  return labels[status] || status;
}

function formatPaymentStatus(status) {
  const labels = {
    unpaid: "Payment pending",
    partially_paid: "Partially paid",
    paid: "Paid",
  };

  return labels[status] || status;
}

function normalizeShift(shift) {
  return {
    shiftId: shift.shift_id,
    workerId: shift.worker_id,
    workerName: shift.worker_name,
    status: shift.status,
    openedAt: shift.opened_at,
    openingCashActual: Number(shift.opening_cash_actual || 0),
  };
}

function formatShortDateTime(value) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatShortDate(value) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function showModalError(modal, message) {
  const existing = modal.querySelector(".modal-error");

  if (existing) {
    existing.textContent = message;
    return;
  }

  const error = document.createElement("div");
  error.className = "form-alert error-alert modal-error";
  error.textContent = message;

  const form = modal.querySelector("form");
  form?.prepend(error);
}

function selected(value, currentValue) {
  return value === currentValue ? "selected" : "";
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toUserMessage(error) {
  const message = error?.message || "Something went wrong. Please try again.";

  if (message.includes("session is invalid")) {
    return "Your session expired or was locked. Sign in again.";
  }

  if (message.includes("active shift")) {
    return message;
  }

  return message;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
