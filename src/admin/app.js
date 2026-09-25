import { icon } from "../ui/icons.js";
import { formatMoney, formatDateTime, formatFulfillment, formatOrderSource, formatPaymentMethod } from "../lib/formatters.js";
import {
  clearAdminSession,
  getAdminSession,
  isAdminSessionExpired,
  saveAdminSession,
} from "../lib/admin-session-store.js";
import {
  authenticateAdminWorkerById,
  lockAdminSession,
  listBranchWorkers,
  validateAdminSession,
} from "../services/auth-service.js";
import {
  getAdminDashboardToday,
  getAdminSalesByHour,
  getAdminShiftsClosedToday,
} from "../services/admin-service.js";
import {
  getAdminMenu,
  createCategory,
  updateCategory,
  setCategoryActive,
  reorderCategories,
  createMenuItem,
  updateMenuItem,
  setMenuItemAvailability,
  setMenuItemArchived,
  createProteinOption,
  updateProteinOption,
  setProteinOptionActive,
} from "../services/admin-menu-service.js";
import {
  getAdminStaff,
  createWorker,
  updateWorker,
  setWorkerActive,
  resetWorkerPin,
} from "../services/admin-staff-service.js";
import { getAdminOrderHistory, getAdminOrderDetail } from "../services/admin-orders-service.js";
import { getAdminShiftHistory, getAdminShiftDetail } from "../services/admin-shifts-service.js";
import { getAdminRevenueSummary, getAdminRevenueTrend } from "../services/admin-reports-service.js";
import { getAdminItemSales, getAdminCategorySales } from "../services/admin-performance-service.js";
import { APP_CONFIG } from "../lib/config.js";

const SIDEBAR_COLLAPSE_STORAGE_KEY = "yumyard-admin-sidebar-collapsed";

// Tracks an in-progress category drag gesture. Kept outside `state` on
// purpose - it changes on every dragover as the pointer moves, and none
// of that is worth a full re-render; only the drop result matters.
let draggedCategoryId = null;

// Drives the sidebar. Sections beyond Dashboard are placeholders until
// their own Phase 3 task lands - kept here up front so the shell doesn't
// need reshaping each time a new one is built, just enabled: true.
const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: "grid", enabled: true },
  { key: "reports", label: "Reports", icon: "barChart", enabled: true },
  { key: "menu", label: "Menu", icon: "list", enabled: true },
  { key: "staff", label: "Staff", icon: "user", enabled: true },
  { key: "orders", label: "Orders", icon: "orders", enabled: true },
  { key: "shifts", label: "Shifts", icon: "clock", enabled: true },
  { key: "performance", label: "Performance", icon: "trophy", enabled: true },
];

const state = {
  root: null,
  view: "boot", // boot | login | dashboard
  activeNav: "dashboard",
  isSidebarCollapsed: false,
  isMobileSidebarOpen: false,
  isLoading: false,
  isLoadingDashboard: false,
  error: "",
  notice: "",
  session: null,
  loginWorkers: [],
  isLoadingWorkers: false,
  selectedWorkerId: null,
  loginPin: "",
  dashboardToday: null,
  salesByHour: [],
  shiftsToday: [],
  menu: {
    isLoading: false,
    hasLoaded: false,
    categories: [],
    items: [],
    selectedCategoryId: "all",
    isAddingCategory: false,
    newCategoryName: "",
    editingCategoryId: null,
    editingCategoryName: "",
    isAddingItem: false,
    newItem: { name: "", categoryId: "", basePrice: "", requiresProtein: false },
    editingItemId: null,
    editingItem: { name: "", categoryId: "", basePrice: "", requiresProtein: false },
    expandedItemId: null,
    addingOptionForItemId: null,
    newOption: { name: "", priceAdjustment: "" },
    editingOptionId: null,
    editingOption: { name: "", priceAdjustment: "" },
    isSaving: false,
  },
  staff: {
    isLoading: false,
    hasLoaded: false,
    workers: [],
    isAddingWorker: false,
    newWorker: { displayName: "", username: "", pin: "", confirmPin: "", role: "cashier" },
    editingWorkerId: null,
    editingWorker: { displayName: "", role: "" },
    resettingPinWorkerId: null,
    resetPin: { pin: "", confirmPin: "" },
    isSaving: false,
  },
  orders: {
    isLoading: false,
    hasLoaded: false,
    list: [],
    totalCount: 0,
    filters: {
      dateFrom: defaultDateFrom(),
      dateTo: defaultDateTo(),
      workerId: "",
      statusBucket: "all",
      search: "",
    },
    limit: 50,
    offset: 0,
    detail: null,
    isLoadingDetail: false,
  },
  shifts: {
    isLoading: false,
    hasLoaded: false,
    list: [],
    totalCount: 0,
    filters: {
      dateFrom: defaultDateFrom(),
      dateTo: defaultDateTo(),
      workerId: "",
    },
    limit: 50,
    offset: 0,
  },
  reports: {
    isLoading: false,
    hasLoaded: false,
    summary: null,
    trendGranularity: "day",
    trend: [],
  },
  performance: {
    isLoading: false,
    hasLoaded: false,
    items: [],
    categories: [],
    filters: {
      dateFrom: defaultDateFrom(),
      dateTo: defaultDateTo(),
    },
    view: "items", // items | categories
    sortBy: "revenue", // revenue | quantity
  },
};

function defaultDateTo() {
  return new Date().toISOString().slice(0, 10);
}

function defaultDateFrom() {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().slice(0, 10);
}

export function renderAdminApp(root) {
  state.root = root;
  root.innerHTML = renderScreen();
  bindScreenEvents();
}

export async function startAdminApp(root) {
  state.root = root;
  state.view = "boot";
  state.isSidebarCollapsed = readStoredSidebarPreference();
  renderAdminApp(root);

  const storedSession = getAdminSession();

  if (!storedSession || isAdminSessionExpired(storedSession)) {
    clearAdminSession();
    showLogin();
    return;
  }

  try {
    state.isLoading = true;
    renderAdminApp(root);

    await validateAdminSession(storedSession.sessionToken);
    state.session = storedSession;
    await goToDashboard();
  } catch {
    clearAdminSession();
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

  if (state.view === "dashboard" && state.activeNav === "reports") {
    return renderAdminShell(renderReportsContent());
  }

  if (state.view === "dashboard" && state.activeNav === "menu") {
    return renderAdminShell(renderMenuContent());
  }

  if (state.view === "dashboard" && state.activeNav === "staff") {
    return renderAdminShell(renderStaffContent());
  }

  if (state.view === "dashboard" && state.activeNav === "orders") {
    return renderAdminShell(renderOrdersContent());
  }

  if (state.view === "dashboard" && state.activeNav === "shifts") {
    return renderAdminShell(renderShiftsContent());
  }

  if (state.view === "dashboard" && state.activeNav === "performance") {
    return renderAdminShell(renderPerformanceContent());
  }

  if (state.view === "dashboard") {
    return renderAdminShell(renderDashboardContent());
  }

  return renderLoginScreen();
}

function renderBootScreen() {
  return `
    <main class="app-boot-screen">
      <section class="app-boot-card">
        <img src="/yumyard-logo.png" alt="Yum Yard" />
        <div class="boot-spinner"></div>
        <p>Loading Yum Yard Admin</p>
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
          <p class="section-kicker">Yum Yard Admin</p>
          <h1>${selectedWorker ? `Enter PIN for ${escapeHtml(selectedWorker.displayName)}` : "Who's signing in?"}</h1>
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

        <p class="login-help">Yum Yard · Abura, Cape Coast · Admin</p>
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
        <p>No owner, admin, or manager profiles found for this branch.</p>
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

// --- Admin shell: sidebar + topbar, shared by every Phase 3 section -----

function renderAdminShell(contentHtml) {
  const activeItem = NAV_ITEMS.find((item) => item.key === state.activeNav);
  const isRefreshing =
    state.activeNav === "menu"
      ? state.menu.isLoading
      : state.activeNav === "staff"
        ? state.staff.isLoading
        : state.activeNav === "orders"
          ? state.orders.isLoading
          : state.activeNav === "shifts"
            ? state.shifts.isLoading
            : state.activeNav === "reports"
              ? state.reports.isLoading
              : state.activeNav === "performance"
                ? state.performance.isLoading
                : state.isLoadingDashboard;

  return `
    <div class="admin-shell">
      ${renderSidebar()}
      <div class="admin-main">
        <header class="admin-topbar">
          <button class="admin-topbar-hamburger" type="button" data-open-mobile-sidebar aria-label="Open menu">
            ${icon("hamburger")}
          </button>

          <div class="admin-topbar-title">
            <p class="section-kicker">Today</p>
            <h1>${escapeHtml(activeItem?.label || "Dashboard")}</h1>
          </div>

          <div class="admin-topbar-utilities">
            <span class="signed-in-worker">
              ${icon("user")}
              <span>${escapeHtml(state.session.workerName)} · ${escapeHtml(formatRole(state.session.workerRole))}</span>
            </span>
            <button class="utility-button" type="button" data-refresh-current ${isRefreshing ? "disabled" : ""}>
              ${isRefreshing ? `<span class="button-spinner"></span>` : icon("grid")}
              <span>Refresh</span>
            </button>
            <button class="utility-button" type="button" data-sign-out>
              ${icon("logout")}
              <span>Sign out</span>
            </button>
          </div>
        </header>

        ${state.error ? `<div class="global-alert error-alert">${escapeHtml(state.error)}</div>` : ""}
        ${state.notice ? `<div class="global-alert success-alert">${escapeHtml(state.notice)}</div>` : ""}

        ${contentHtml}
      </div>
    </div>
  `;
}

function renderSidebar() {
  return `
    <aside class="admin-sidebar ${state.isSidebarCollapsed ? "is-collapsed" : ""} ${state.isMobileSidebarOpen ? "is-mobile-open" : ""}">
      <div class="admin-sidebar-brand">
        <img src="/yumyard-logo.png" alt="Yum Yard" />
        <span class="admin-sidebar-brand-name">
          Yum Yard
          <small>Admin</small>
        </span>
      </div>

      <nav class="admin-sidebar-nav">
        ${NAV_ITEMS.map(renderSidebarNavItem).join("")}
      </nav>

      <div class="admin-sidebar-footer">
        <button
          class="admin-sidebar-collapse-toggle"
          type="button"
          data-toggle-sidebar-collapse
          title="${state.isSidebarCollapsed ? "Expand" : "Collapse"} sidebar"
        >
          ${icon("chevronLeft")}
          <span class="sidebar-label">Collapse</span>
        </button>
      </div>
    </aside>
    <div
      class="admin-sidebar-overlay ${state.isMobileSidebarOpen ? "is-visible" : ""}"
      data-close-mobile-sidebar
    ></div>
  `;
}

function renderSidebarNavItem(item) {
  if (!item.enabled) {
    return `
      <button class="admin-nav-item is-disabled" type="button" disabled title="Coming in ${escapeHtml(item.comingSoon)}">
        ${icon(item.icon)}
        <span class="sidebar-label">${escapeHtml(item.label)}</span>
        <span class="admin-nav-soon sidebar-label">Soon</span>
      </button>
    `;
  }

  return `
    <button
      class="admin-nav-item ${state.activeNav === item.key ? "is-active" : ""}"
      type="button"
      data-nav="${item.key}"
    >
      ${icon(item.icon)}
      <span class="sidebar-label">${escapeHtml(item.label)}</span>
    </button>
  `;
}

// --- Dashboard content ----------------------------------------------------

function renderDashboardContent() {
  return `
    <main class="admin-dashboard">
      ${renderSummaryGrid()}

      <section class="dashboard-section">
        <div class="dashboard-section-heading">
          <div>
            <p class="section-kicker">Today's sales</p>
            <h2>By hour</h2>
          </div>
        </div>
        ${renderSalesChart()}
      </section>

      <section class="dashboard-section">
        <div class="dashboard-section-heading">
          <div>
            <p class="section-kicker">Cash handovers</p>
            <h2>Shifts closed today</h2>
          </div>
        </div>
        ${renderShiftsTable()}
      </section>
    </main>
  `;
}

function renderSummaryGrid() {
  const totals = state.dashboardToday;

  if (state.isLoadingDashboard || !totals) {
    return `
      <div class="dashboard-summary-grid">
        ${Array.from({ length: 5 })
          .map(
            () => `
              <div class="dashboard-summary-card">
                <span class="boot-spinner"></span>
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  return `
    <div class="dashboard-summary-grid">
      <div class="dashboard-summary-card highlight">
        <span class="dashboard-summary-icon">${icon("receipt")}</span>
        <div class="dashboard-summary-card-body">
          <span>Total sales</span>
          <strong>${formatMoney(totals.totalSales)}</strong>
        </div>
      </div>
      <div class="dashboard-summary-card">
        <span class="dashboard-summary-icon">${icon("orders")}</span>
        <div class="dashboard-summary-card-body">
          <span>Total orders</span>
          <strong>${totals.totalOrders}</strong>
        </div>
      </div>
      <div class="dashboard-summary-card">
        <span class="dashboard-summary-icon">${icon("delivery")}</span>
        <div class="dashboard-summary-card-body">
          <span>Delivery orders</span>
          <strong>${totals.totalDeliveryOrders}</strong>
        </div>
      </div>
      <div class="dashboard-summary-card ${totals.cancelledOrders > 0 ? "danger" : ""}">
        <span class="dashboard-summary-icon">${icon("ban")}</span>
        <div class="dashboard-summary-card-body">
          <span>Cancelled orders</span>
          <strong>${totals.cancelledOrders}</strong>
        </div>
      </div>
      <div class="dashboard-summary-card highlight">
        <span class="dashboard-summary-icon">${icon("grid")}</span>
        <div class="dashboard-summary-card-body">
          <span>Total revenue</span>
          <strong>${formatMoney(totals.totalRevenue)}</strong>
        </div>
      </div>
    </div>
  `;
}

function renderSalesChart() {
  if (state.isLoadingDashboard) {
    return `
      <div class="dashboard-chart-empty">
        <span class="boot-spinner"></span>
      </div>
    `;
  }

  const hours = state.salesByHour;
  const maxSales = Math.max(0, ...hours.map((row) => row.sales));

  if (!hours.length || maxSales <= 0) {
    return `
      <div class="dashboard-chart-empty">
        ${icon("receipt")}
        <p>No sales recorded yet today.</p>
      </div>
    `;
  }

  const chartWidth = 720;
  const chartHeight = 190;
  const axisHeight = 22;
  const barSlot = chartWidth / 24;
  const barWidth = barSlot * 0.62;
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const y = chartHeight - chartHeight * fraction;
    return `<line class="chart-gridline" x1="0" y1="${y}" x2="${chartWidth}" y2="${y}" />`;
  });

  const bars = hours
    .map((row) => {
      const barHeight =
        maxSales > 0 ? Math.max((row.sales / maxSales) * chartHeight, row.sales > 0 ? 3 : 0) : 0;
      const x = row.hour * barSlot + (barSlot - barWidth) / 2;
      const y = chartHeight - barHeight;
      const isPeak = row.sales === maxSales && maxSales > 0;
      const showLabel = row.hour % 3 === 0;

      return `
        <g>
          <title>${formatHourLabel(row.hour)}: ${formatMoney(row.sales)}</title>
          <rect
            class="chart-bar ${isPeak ? "is-peak" : ""}"
            x="${x.toFixed(1)}"
            y="${y.toFixed(1)}"
            width="${barWidth.toFixed(1)}"
            height="${barHeight.toFixed(1)}"
            rx="2"
          />
          ${
            showLabel
              ? `<text class="chart-axis-label" x="${(row.hour * barSlot + barSlot / 2).toFixed(1)}" y="${chartHeight + 14}" text-anchor="middle">${formatHourShort(row.hour)}</text>`
              : ""
          }
        </g>
      `;
    })
    .join("");

  return `
    <svg class="dashboard-bar-chart" viewBox="0 0 ${chartWidth} ${chartHeight + axisHeight}" role="img" aria-label="Sales by hour today">
      ${gridLines.join("")}
      ${bars}
    </svg>
  `;
}

function renderShiftsTable() {
  if (state.isLoadingDashboard) {
    return `
      <div class="dashboard-chart-empty">
        <span class="boot-spinner"></span>
      </div>
    `;
  }

  if (!state.shiftsToday.length) {
    return `<p class="dashboard-table-empty">No shifts have been closed yet today.</p>`;
  }

  const rows = state.shiftsToday.map(shiftToViewModel);

  const tableRows = rows
    .map(
      (shift) => `
        <tr>
          <td class="is-worker">${escapeHtml(shift.workerName)}</td>
          <td>${shift.openedAtLabel}</td>
          <td>${shift.closedAtLabel}</td>
          <td>${formatMoney(shift.openingCashActual)}</td>
          <td>${formatMoney(shift.expectedCash)}</td>
          <td>${formatMoney(shift.actualCashCounted)}</td>
          <td class="${shift.varianceClass}">${shift.varianceLabel}</td>
          <td>${shift.noteLabel}</td>
        </tr>
      `,
    )
    .join("");

  const cards = rows
    .map(
      (shift) => `
        <div class="dashboard-shift-card">
          <span class="dashboard-shift-card-worker">${escapeHtml(shift.workerName)}</span>
          <div class="dashboard-shift-card-row">
            <span>Opened</span>
            <span>${shift.openedAtLabel}</span>
          </div>
          <div class="dashboard-shift-card-row">
            <span>Closed</span>
            <span>${shift.closedAtLabel}</span>
          </div>
          <div class="dashboard-shift-card-row">
            <span>Opening cash</span>
            <span>${formatMoney(shift.openingCashActual)}</span>
          </div>
          <div class="dashboard-shift-card-row">
            <span>Expected</span>
            <span>${formatMoney(shift.expectedCash)}</span>
          </div>
          <div class="dashboard-shift-card-row">
            <span>Actual</span>
            <span>${formatMoney(shift.actualCashCounted)}</span>
          </div>
          <div class="dashboard-shift-card-row ${shift.varianceClass}">
            <span>Variance</span>
            <span>${shift.varianceLabel}</span>
          </div>
          <div class="dashboard-shift-card-row">
            <span>Notes</span>
            <span>${shift.noteLabel}</span>
          </div>
        </div>
      `,
    )
    .join("");

  return `
    <div class="dashboard-table-wrap">
      <table class="dashboard-table">
        <thead>
          <tr>
            <th>Worker</th>
            <th>Opened</th>
            <th>Closed</th>
            <th>Opening cash</th>
            <th>Expected</th>
            <th>Actual</th>
            <th>Variance</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
    <div class="dashboard-shift-cards">
      ${cards}
    </div>
  `;
}

function shiftToViewModel(shift) {
  const varianceClass = shift.cashVariance === 0 ? "is-balanced" : "is-off";
  const varianceLabel =
    shift.cashVariance === 0
      ? "Matches"
      : `${shift.cashVariance > 0 ? "Over" : "Short"} ${formatMoney(Math.abs(shift.cashVariance))}`;

  return {
    workerName: shift.workerName,
    openedAtLabel: formatTime(shift.openedAt),
    closedAtLabel: formatTime(shift.closedAt),
    openingCashActual: shift.openingCashActual,
    expectedCash: shift.expectedCash,
    actualCashCounted: shift.actualCashCounted,
    varianceClass,
    varianceLabel,
    noteLabel: shift.closingNote ? escapeHtml(shift.closingNote) : "—",
  };
}

// --- Menu management (Task 3) ---------------------------------------------

function renderMenuContent() {
  if (state.menu.isLoading && !state.menu.hasLoaded) {
    return `
      <main class="admin-dashboard">
        <div class="dashboard-chart-empty"><span class="boot-spinner"></span></div>
      </main>
    `;
  }

  return `
    <main class="admin-dashboard">
      <div class="menu-layout">
        <section class="dashboard-section">
          <div class="dashboard-section-heading">
            <div>
              <p class="section-kicker">Categories</p>
              <h2>${state.menu.categories.length} total</h2>
            </div>
          </div>
          ${renderCategoriesPanel()}
        </section>

        <section class="dashboard-section">
          <div class="dashboard-section-heading">
            <div>
              <p class="section-kicker">Menu</p>
              <h2>${state.menu.items.length} items</h2>
            </div>
          </div>
          ${renderItemsPanel()}
        </section>
      </div>
    </main>
  `;
}

function renderCategoriesPanel() {
  const categories = state.menu.categories;

  const rows = categories
    .map((category, index) => {
      if (state.menu.editingCategoryId === category.id) {
        return `
          <div class="menu-category-row">
            <input class="menu-text-input" type="text" data-edit-category-name value="${escapeAttr(state.menu.editingCategoryName)}" />
            <button class="menu-icon-button" type="button" data-save-category="${category.id}" ${state.menu.isSaving ? "disabled" : ""}>${icon("check")}</button>
            <button class="menu-icon-button" type="button" data-cancel-edit-category>${icon("close")}</button>
          </div>
        `;
      }

      return `
        <div class="menu-category-row ${category.isActive ? "" : "is-inactive"}" draggable="true" data-category-row="${category.id}">
          <span class="menu-drag-handle" aria-hidden="true">⋮⋮</span>
          <div class="menu-reorder-buttons">
            <button class="menu-icon-button" type="button" data-move-category-up="${category.id}" ${index === 0 ? "disabled" : ""} aria-label="Move up">▲</button>
            <button class="menu-icon-button" type="button" data-move-category-down="${category.id}" ${index === categories.length - 1 ? "disabled" : ""} aria-label="Move down">▼</button>
          </div>
          <span class="menu-category-row-name">${escapeHtml(category.name)}</span>
          <button class="pill-toggle ${category.isActive ? "is-on" : "is-off"}" type="button" data-toggle-category-active="${category.id}" data-current="${category.isActive}">
            ${category.isActive ? "Active" : "Inactive"}
          </button>
          <button class="menu-icon-button" type="button" data-edit-category="${category.id}" title="Rename">${icon("edit")}</button>
        </div>
      `;
    })
    .join("");

  const emptyState = categories.length ? "" : `<p class="menu-empty-state">No categories yet.</p>`;

  const addForm = state.menu.isAddingCategory
    ? `
      <div class="menu-inline-form">
        <input class="menu-text-input" type="text" data-new-category-name placeholder="Category name" value="${escapeAttr(state.menu.newCategoryName)}" />
        <button class="menu-icon-button" type="button" data-save-new-category ${state.menu.isSaving ? "disabled" : ""}>${icon("check")}</button>
        <button class="menu-icon-button" type="button" data-cancel-new-category>${icon("close")}</button>
      </div>
    `
    : `
      <button class="menu-add-button" type="button" data-start-add-category>
        ${icon("add")}
        <span>Add category</span>
      </button>
    `;

  return `
    <div class="menu-category-list">${rows}</div>
    ${emptyState}
    ${addForm}
  `;
}

function renderCategoryOptions(selectedId) {
  return state.menu.categories
    .map(
      (category) =>
        `<option value="${category.id}" ${category.id === selectedId ? "selected" : ""}>${escapeHtml(category.name)}</option>`,
    )
    .join("");
}

function renderItemsPanel() {
  const { items, categories, selectedCategoryId } = state.menu;
  const visibleItems =
    selectedCategoryId === "all" ? items : items.filter((item) => item.categoryId === selectedCategoryId);

  const tabs = `
    <div class="menu-filter-tabs">
      <button class="menu-filter-tab ${selectedCategoryId === "all" ? "is-active" : ""}" type="button" data-filter-category="all">
        All <small>${items.length}</small>
      </button>
      ${categories
        .map(
          (category) => `
            <button class="menu-filter-tab ${selectedCategoryId === category.id ? "is-active" : ""}" type="button" data-filter-category="${category.id}">
              ${escapeHtml(category.name)} <small>${items.filter((item) => item.categoryId === category.id).length}</small>
            </button>
          `,
        )
        .join("")}
    </div>
  `;

  const addSection = state.menu.isAddingItem
    ? renderNewItemForm()
    : `
      <button class="menu-add-button" type="button" data-start-add-item ${categories.length ? "" : "disabled"} title="${categories.length ? "" : "Add a category first"}">
        ${icon("add")}
        <span>Add item</span>
      </button>
    `;

  const list = visibleItems.length
    ? `<div class="menu-item-list">${visibleItems.map(renderMenuItemCard).join("")}</div>`
    : `<p class="menu-empty-state">No items in this category yet.</p>`;

  return `${tabs}${addSection}${list}`;
}

function renderNewItemForm() {
  const draft = state.menu.newItem;

  return `
    <div class="menu-item-card">
      <div class="menu-item-edit-form">
        <div class="menu-item-edit-grid">
          <label class="form-field">
            <span>Name</span>
            <input type="text" data-new-item-name value="${escapeAttr(draft.name)}" placeholder="e.g. Jollof Special" />
          </label>
          <label class="form-field">
            <span>Category</span>
            <select data-new-item-category>${renderCategoryOptions(draft.categoryId)}</select>
          </label>
          <label class="form-field">
            <span>Price (GH₵)</span>
            <input type="number" min="0" step="0.5" data-new-item-price value="${escapeAttr(draft.basePrice)}" />
          </label>
          <label class="menu-checkbox-field">
            <input type="checkbox" data-new-item-requires-protein ${draft.requiresProtein ? "checked" : ""} />
            Requires a protein choice
          </label>
        </div>
        <div class="menu-form-actions">
          <button class="solid-action-button" type="button" data-save-new-item ${state.menu.isSaving ? "disabled" : ""}>
            ${state.menu.isSaving ? `<span class="button-spinner"></span>` : "Save item"}
          </button>
          <button class="outline-action-button" type="button" data-cancel-new-item>Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function renderMenuItemCard(item) {
  if (state.menu.editingItemId === item.id) {
    return renderItemEditForm(item);
  }

  const category = state.menu.categories.find((candidate) => candidate.id === item.categoryId);
  const isExpanded = state.menu.expandedItemId === item.id;

  return `
    <div class="menu-item-card ${item.isArchived ? "is-archived" : ""}">
      <div class="menu-item-top">
        <div class="menu-item-name-block">
          <strong>${escapeHtml(item.name)}</strong>
          <span class="menu-item-category-tag">${escapeHtml(category?.name || "Uncategorized")}</span>
        </div>
        <span class="menu-item-price">${formatMoney(item.basePrice)}</span>
      </div>

      <div class="menu-item-badges">
        <button
          class="pill-toggle ${item.isAvailable ? "is-on" : "is-off"}"
          type="button"
          data-toggle-item-available="${item.id}"
          ${item.isArchived ? "disabled" : ""}
        >
          ${item.isAvailable ? "Available" : "Unavailable"}
        </button>
        ${item.isArchived ? `<span class="menu-archived-badge">Archived</span>` : ""}
        ${
          item.requiresProtein && !item.proteinOptions.some((option) => option.isActive)
            ? `<span class="menu-warning-badge">Hidden - needs a protein option</span>`
            : ""
        }
      </div>

      <div class="menu-item-actions">
        <button class="menu-icon-button" type="button" data-edit-item="${item.id}" title="Edit" ${item.isArchived ? "disabled" : ""}>
          ${icon("edit")}
        </button>
        <button class="menu-icon-button" type="button" data-toggle-item-archived="${item.id}" title="${item.isArchived ? "Restore" : "Archive"}">
          ${item.isArchived ? icon("check") : icon("ban")}
        </button>
      </div>

      <button class="menu-protein-toggle ${isExpanded ? "is-expanded" : ""}" type="button" data-toggle-protein-options="${item.id}">
        ${icon("chevronLeft")}
        <span>Protein options (${item.proteinOptions.length})</span>
      </button>

      ${isExpanded ? renderProteinOptionsSection(item) : ""}
    </div>
  `;
}

function renderItemEditForm(item) {
  const draft = state.menu.editingItem;

  return `
    <div class="menu-item-card">
      <div class="menu-item-edit-form">
        <div class="menu-item-edit-grid">
          <label class="form-field">
            <span>Name</span>
            <input type="text" data-edit-item-name value="${escapeAttr(draft.name)}" />
          </label>
          <label class="form-field">
            <span>Category</span>
            <select data-edit-item-category>${renderCategoryOptions(draft.categoryId)}</select>
          </label>
          <label class="form-field">
            <span>Price (GH₵)</span>
            <input type="number" min="0" step="0.5" data-edit-item-price value="${escapeAttr(draft.basePrice)}" />
          </label>
          <label class="menu-checkbox-field">
            <input type="checkbox" data-edit-item-requires-protein ${draft.requiresProtein ? "checked" : ""} />
            Requires a protein choice
          </label>
        </div>
        <div class="menu-form-actions">
          <button class="solid-action-button" type="button" data-save-item="${item.id}" ${state.menu.isSaving ? "disabled" : ""}>
            ${state.menu.isSaving ? `<span class="button-spinner"></span>` : "Save"}
          </button>
          <button class="outline-action-button" type="button" data-cancel-edit-item>Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function renderProteinOptionsSection(item) {
  const rows = item.proteinOptions
    .map((option) => {
      if (state.menu.editingOptionId === option.id) {
        const draft = state.menu.editingOption;
        return `
          <div class="menu-protein-row">
            <input class="menu-text-input" type="text" data-edit-option-name value="${escapeAttr(draft.name)}" />
            <input class="menu-text-input menu-protein-price-input" type="number" step="0.5" data-edit-option-price value="${escapeAttr(draft.priceAdjustment)}" />
            <button class="menu-icon-button" type="button" data-save-option="${option.id}" ${state.menu.isSaving ? "disabled" : ""}>${icon("check")}</button>
            <button class="menu-icon-button" type="button" data-cancel-edit-option>${icon("close")}</button>
          </div>
        `;
      }

      return `
        <div class="menu-protein-row">
          <span class="menu-protein-row-name">${escapeHtml(option.name)}</span>
          <span class="menu-protein-row-price">${option.priceAdjustment > 0 ? "+" : ""}${formatMoney(option.priceAdjustment)}</span>
          <button class="pill-toggle ${option.isActive ? "is-on" : "is-off"}" type="button" data-toggle-option-active="${option.id}">
            ${option.isActive ? "Active" : "Inactive"}
          </button>
          <button class="menu-icon-button" type="button" data-edit-option="${option.id}" title="Edit">${icon("edit")}</button>
        </div>
      `;
    })
    .join("");

  const addForm =
    state.menu.addingOptionForItemId === item.id
      ? `
        <div class="menu-protein-row">
          <input class="menu-text-input" type="text" placeholder="Option name" data-new-option-name value="${escapeAttr(state.menu.newOption.name)}" />
          <input class="menu-text-input menu-protein-price-input" type="number" step="0.5" placeholder="+GH₵" data-new-option-price value="${escapeAttr(state.menu.newOption.priceAdjustment)}" />
          <button class="menu-icon-button" type="button" data-save-new-option="${item.id}" ${state.menu.isSaving ? "disabled" : ""}>${icon("check")}</button>
          <button class="menu-icon-button" type="button" data-cancel-new-option>${icon("close")}</button>
        </div>
      `
      : `
        <button class="menu-add-button" type="button" data-start-add-option="${item.id}">
          ${icon("add")}
          <span>Add option</span>
        </button>
      `;

  return `<div class="menu-protein-list">${rows}${addForm}</div>`;
}

async function loadMenuData() {
  try {
    state.menu.isLoading = true;
    state.error = "";
    renderAdminApp(state.root);

    const { categories, items } = await getAdminMenu(state.session.sessionToken);
    state.menu.categories = categories;
    state.menu.items = items;
    state.menu.hasLoaded = true;

    if (
      state.menu.selectedCategoryId !== "all" &&
      !categories.some((category) => category.id === state.menu.selectedCategoryId)
    ) {
      state.menu.selectedCategoryId = "all";
    }
  } catch (error) {
    state.error = toUserMessage(error);
  } finally {
    state.menu.isLoading = false;
    renderAdminApp(state.root);
  }
}

// Every menu mutation follows the same shape: run it, then reload the
// whole menu so sort order, slugs, and nested protein options always
// reflect exactly what the database has - simpler and safer than trying
// to patch local state to match a dozen different RPC shapes.
async function runMenuMutation(action) {
  try {
    state.menu.isSaving = true;
    state.error = "";
    renderAdminApp(state.root);

    await action();

    state.menu.isAddingCategory = false;
    state.menu.newCategoryName = "";
    state.menu.editingCategoryId = null;
    state.menu.isAddingItem = false;
    state.menu.editingItemId = null;
    state.menu.addingOptionForItemId = null;
    state.menu.editingOptionId = null;

    await loadMenuData();
  } catch (error) {
    state.error = toUserMessage(error);
  } finally {
    state.menu.isSaving = false;
    renderAdminApp(state.root);
  }
}

function bindMenuEvents() {
  const root = state.root;
  const token = () => state.session.sessionToken;

  // Categories
  root.querySelector("[data-start-add-category]")?.addEventListener("click", () => {
    state.menu.isAddingCategory = true;
    state.menu.newCategoryName = "";
    renderAdminApp(root);
  });

  root.querySelector("[data-cancel-new-category]")?.addEventListener("click", () => {
    state.menu.isAddingCategory = false;
    renderAdminApp(root);
  });

  root.querySelector("[data-new-category-name]")?.addEventListener("input", (event) => {
    state.menu.newCategoryName = event.target.value;
  });

  root.querySelector("[data-save-new-category]")?.addEventListener("click", () => {
    const name = state.menu.newCategoryName.trim();
    if (!name) return;
    runMenuMutation(() => createCategory(token(), name));
  });

  root.querySelectorAll("[data-edit-category]").forEach((button) => {
    button.addEventListener("click", () => {
      const category = state.menu.categories.find((item) => item.id === button.dataset.editCategory);
      state.menu.editingCategoryId = category.id;
      state.menu.editingCategoryName = category.name;
      renderAdminApp(root);
    });
  });

  root.querySelector("[data-cancel-edit-category]")?.addEventListener("click", () => {
    state.menu.editingCategoryId = null;
    renderAdminApp(root);
  });

  root.querySelector("[data-edit-category-name]")?.addEventListener("input", (event) => {
    state.menu.editingCategoryName = event.target.value;
  });

  root.querySelectorAll("[data-save-category]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = state.menu.editingCategoryName.trim();
      if (!name) return;
      runMenuMutation(() => updateCategory(token(), button.dataset.saveCategory, name));
    });
  });

  root.querySelectorAll("[data-toggle-category-active]").forEach((button) => {
    button.addEventListener("click", () => {
      const isCurrentlyActive = button.dataset.current === "true";
      runMenuMutation(() =>
        setCategoryActive(token(), button.dataset.toggleCategoryActive, !isCurrentlyActive),
      );
    });
  });

  root.querySelectorAll("[data-move-category-up], [data-move-category-down]").forEach((button) => {
    button.addEventListener("click", () => {
      const categoryId = button.dataset.moveCategoryUp || button.dataset.moveCategoryDown;
      const direction = button.dataset.moveCategoryUp ? -1 : 1;
      const ids = state.menu.categories.map((category) => category.id);
      const index = ids.indexOf(categoryId);
      const targetIndex = index + direction;

      if (targetIndex < 0 || targetIndex >= ids.length) return;

      [ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]];
      runMenuMutation(() => reorderCategories(token(), ids));
    });
  });

  // Drag-to-reorder categories (desktop pointer drag; the up/down buttons
  // above remain the reliable path on touch/tablet, where native HTML5
  // drag-and-drop isn't consistently supported).
  root.querySelectorAll("[data-category-row]").forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      draggedCategoryId = row.dataset.categoryRow;
      event.dataTransfer.effectAllowed = "move";
      row.classList.add("is-dragging");
    });

    row.addEventListener("dragend", () => {
      draggedCategoryId = null;
      row.classList.remove("is-dragging");
      root.querySelectorAll("[data-category-row]").forEach((el) => el.classList.remove("is-drag-over"));
    });

    row.addEventListener("dragover", (event) => {
      if (!draggedCategoryId || draggedCategoryId === row.dataset.categoryRow) return;
      event.preventDefault();
      row.classList.add("is-drag-over");
    });

    row.addEventListener("dragleave", () => {
      row.classList.remove("is-drag-over");
    });

    row.addEventListener("drop", (event) => {
      event.preventDefault();
      row.classList.remove("is-drag-over");

      const targetId = row.dataset.categoryRow;
      if (!draggedCategoryId || draggedCategoryId === targetId) return;

      const ids = state.menu.categories.map((category) => category.id);
      const fromIndex = ids.indexOf(draggedCategoryId);
      const toIndex = ids.indexOf(targetId);
      if (fromIndex === -1 || toIndex === -1) return;

      ids.splice(toIndex, 0, ids.splice(fromIndex, 1)[0]);
      draggedCategoryId = null;
      runMenuMutation(() => reorderCategories(token(), ids));
    });
  });

  // Item category filter tabs
  root.querySelectorAll("[data-filter-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.menu.selectedCategoryId = button.dataset.filterCategory;
      renderAdminApp(root);
    });
  });

  // New item
  root.querySelector("[data-start-add-item]")?.addEventListener("click", () => {
    state.menu.isAddingItem = true;
    state.menu.newItem = {
      name: "",
      categoryId: state.menu.categories[0]?.id || "",
      basePrice: "",
      requiresProtein: false,
    };
    renderAdminApp(root);
  });

  root.querySelector("[data-cancel-new-item]")?.addEventListener("click", () => {
    state.menu.isAddingItem = false;
    renderAdminApp(root);
  });

  root.querySelector("[data-new-item-name]")?.addEventListener("input", (event) => {
    state.menu.newItem.name = event.target.value;
  });

  root.querySelector("[data-new-item-category]")?.addEventListener("change", (event) => {
    state.menu.newItem.categoryId = event.target.value;
  });

  root.querySelector("[data-new-item-price]")?.addEventListener("input", (event) => {
    state.menu.newItem.basePrice = event.target.value;
  });

  root.querySelector("[data-new-item-requires-protein]")?.addEventListener("change", (event) => {
    state.menu.newItem.requiresProtein = event.target.checked;
  });

  root.querySelector("[data-save-new-item]")?.addEventListener("click", () => {
    const draft = state.menu.newItem;
    const name = draft.name.trim();
    const basePrice = Number(draft.basePrice);

    if (!name || !draft.categoryId || !Number.isFinite(basePrice) || basePrice < 0) {
      state.error = "Enter an item name, category, and a valid price.";
      renderAdminApp(root);
      return;
    }

    runMenuMutation(() =>
      createMenuItem(token(), {
        categoryId: draft.categoryId,
        name,
        basePrice,
        requiresProtein: draft.requiresProtein,
      }),
    );
  });

  // Edit item
  root.querySelectorAll("[data-edit-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.menu.items.find((candidate) => candidate.id === button.dataset.editItem);
      state.menu.editingItemId = item.id;
      state.menu.editingItem = {
        name: item.name,
        categoryId: item.categoryId,
        basePrice: item.basePrice,
        requiresProtein: item.requiresProtein,
      };
      renderAdminApp(root);
    });
  });

  root.querySelector("[data-cancel-edit-item]")?.addEventListener("click", () => {
    state.menu.editingItemId = null;
    renderAdminApp(root);
  });

  root.querySelector("[data-edit-item-name]")?.addEventListener("input", (event) => {
    state.menu.editingItem.name = event.target.value;
  });

  root.querySelector("[data-edit-item-category]")?.addEventListener("change", (event) => {
    state.menu.editingItem.categoryId = event.target.value;
  });

  root.querySelector("[data-edit-item-price]")?.addEventListener("input", (event) => {
    state.menu.editingItem.basePrice = event.target.value;
  });

  root.querySelector("[data-edit-item-requires-protein]")?.addEventListener("change", (event) => {
    state.menu.editingItem.requiresProtein = event.target.checked;
  });

  root.querySelectorAll("[data-save-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const draft = state.menu.editingItem;
      const name = draft.name.trim();
      const basePrice = Number(draft.basePrice);

      if (!name || !draft.categoryId || !Number.isFinite(basePrice) || basePrice < 0) {
        state.error = "Enter an item name, category, and a valid price.";
        renderAdminApp(root);
        return;
      }

      runMenuMutation(() =>
        updateMenuItem(token(), button.dataset.saveItem, {
          categoryId: draft.categoryId,
          name,
          basePrice,
          requiresProtein: draft.requiresProtein,
        }),
      );
    });
  });

  root.querySelectorAll("[data-toggle-item-available]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.menu.items.find((candidate) => candidate.id === button.dataset.toggleItemAvailable);
      runMenuMutation(() => setMenuItemAvailability(token(), item.id, !item.isAvailable));
    });
  });

  root.querySelectorAll("[data-toggle-item-archived]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.menu.items.find((candidate) => candidate.id === button.dataset.toggleItemArchived);
      runMenuMutation(() => setMenuItemArchived(token(), item.id, !item.isArchived));
    });
  });

  // Protein options
  root.querySelectorAll("[data-toggle-protein-options]").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = button.dataset.toggleProteinOptions;
      state.menu.expandedItemId = state.menu.expandedItemId === itemId ? null : itemId;
      renderAdminApp(root);
    });
  });

  root.querySelectorAll("[data-start-add-option]").forEach((button) => {
    button.addEventListener("click", () => {
      state.menu.addingOptionForItemId = button.dataset.startAddOption;
      state.menu.newOption = { name: "", priceAdjustment: "" };
      renderAdminApp(root);
    });
  });

  root.querySelector("[data-cancel-new-option]")?.addEventListener("click", () => {
    state.menu.addingOptionForItemId = null;
    renderAdminApp(root);
  });

  root.querySelector("[data-new-option-name]")?.addEventListener("input", (event) => {
    state.menu.newOption.name = event.target.value;
  });

  root.querySelector("[data-new-option-price]")?.addEventListener("input", (event) => {
    state.menu.newOption.priceAdjustment = event.target.value;
  });

  root.querySelectorAll("[data-save-new-option]").forEach((button) => {
    button.addEventListener("click", () => {
      const draft = state.menu.newOption;
      const name = draft.name.trim();
      const priceAdjustment = draft.priceAdjustment === "" ? 0 : Number(draft.priceAdjustment);

      if (!name || !Number.isFinite(priceAdjustment)) {
        state.error = "Enter an option name and a valid price adjustment.";
        renderAdminApp(root);
        return;
      }

      runMenuMutation(() =>
        createProteinOption(token(), button.dataset.saveNewOption, { name, priceAdjustment }),
      );
    });
  });

  root.querySelectorAll("[data-edit-option]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.menu.items.find((candidate) =>
        candidate.proteinOptions.some((option) => option.id === button.dataset.editOption),
      );
      const option = item.proteinOptions.find((candidate) => candidate.id === button.dataset.editOption);
      state.menu.editingOptionId = option.id;
      state.menu.editingOption = { name: option.name, priceAdjustment: option.priceAdjustment };
      renderAdminApp(root);
    });
  });

  root.querySelector("[data-cancel-edit-option]")?.addEventListener("click", () => {
    state.menu.editingOptionId = null;
    renderAdminApp(root);
  });

  root.querySelector("[data-edit-option-name]")?.addEventListener("input", (event) => {
    state.menu.editingOption.name = event.target.value;
  });

  root.querySelector("[data-edit-option-price]")?.addEventListener("input", (event) => {
    state.menu.editingOption.priceAdjustment = event.target.value;
  });

  root.querySelectorAll("[data-save-option]").forEach((button) => {
    button.addEventListener("click", () => {
      const draft = state.menu.editingOption;
      const name = draft.name.trim();
      const priceAdjustment = draft.priceAdjustment === "" ? 0 : Number(draft.priceAdjustment);

      if (!name || !Number.isFinite(priceAdjustment)) {
        state.error = "Enter an option name and a valid price adjustment.";
        renderAdminApp(root);
        return;
      }

      runMenuMutation(() =>
        updateProteinOption(token(), button.dataset.saveOption, { name, priceAdjustment }),
      );
    });
  });

  root.querySelectorAll("[data-toggle-option-active]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.menu.items.find((candidate) =>
        candidate.proteinOptions.some((option) => option.id === button.dataset.toggleOptionActive),
      );
      const option = item.proteinOptions.find(
        (candidate) => candidate.id === button.dataset.toggleOptionActive,
      );
      runMenuMutation(() => setProteinOptionActive(token(), option.id, !option.isActive));
    });
  });
}

// --- Staff management (Task 4) -----------------------------------------

const ROLE_OPTIONS = ["owner", "admin", "manager", "supervisor", "cashier"];

function renderStaffContent() {
  if (state.staff.isLoading && !state.staff.hasLoaded) {
    return `
      <main class="admin-dashboard">
        <div class="dashboard-chart-empty"><span class="boot-spinner"></span></div>
      </main>
    `;
  }

  return `
    <main class="admin-dashboard">
      <section class="dashboard-section">
        <div class="dashboard-section-heading">
          <div>
            <p class="section-kicker">Team</p>
            <h2>${state.staff.workers.length} staff</h2>
          </div>
        </div>
        ${state.staff.isAddingWorker ? renderNewWorkerForm() : `
          <button class="menu-add-button" type="button" data-start-add-worker>
            ${icon("add")}
            <span>Add worker</span>
          </button>
        `}
        <div class="menu-item-list">
          ${state.staff.workers.map(renderStaffCard).join("")}
        </div>
      </section>
    </main>
  `;
}

function renderRoleOptions(selectedRole) {
  return ROLE_OPTIONS.map(
    (role) => `<option value="${role}" ${role === selectedRole ? "selected" : ""}>${formatRole(role)}</option>`,
  ).join("");
}

function renderNewWorkerForm() {
  const draft = state.staff.newWorker;

  return `
    <div class="menu-item-card">
      <div class="menu-item-edit-form">
        <div class="menu-item-edit-grid">
          <label class="form-field">
            <span>Name</span>
            <input type="text" data-new-worker-name value="${escapeAttr(draft.displayName)}" placeholder="e.g. Kwame Asante" />
          </label>
          <label class="form-field">
            <span>Username</span>
            <input type="text" data-new-worker-username value="${escapeAttr(draft.username)}" placeholder="e.g. kwame" />
          </label>
          <label class="form-field">
            <span>Role</span>
            <select data-new-worker-role>${renderRoleOptions(draft.role)}</select>
          </label>
          <label class="form-field">
            <span>PIN (4-8 digits)</span>
            <input type="password" inputmode="numeric" data-new-worker-pin value="${escapeAttr(draft.pin)}" />
          </label>
          <label class="form-field">
            <span>Confirm PIN</span>
            <input type="password" inputmode="numeric" data-new-worker-confirm-pin value="${escapeAttr(draft.confirmPin)}" />
          </label>
        </div>
        <div class="menu-form-actions">
          <button class="solid-action-button" type="button" data-save-new-worker ${state.staff.isSaving ? "disabled" : ""}>
            ${state.staff.isSaving ? `<span class="button-spinner"></span>` : "Create worker"}
          </button>
          <button class="outline-action-button" type="button" data-cancel-new-worker>Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function renderStaffCard(worker) {
  const isSelf = state.session.workerId === worker.workerId;
  const canResetPins = ["owner", "manager"].includes(state.session.workerRole);

  if (state.staff.editingWorkerId === worker.workerId) {
    return renderWorkerEditForm(worker);
  }

  if (state.staff.resettingPinWorkerId === worker.workerId) {
    return renderResetPinForm(worker);
  }

  return `
    <div class="menu-item-card ${worker.isActive ? "" : "is-archived"}">
      <div class="menu-item-top">
        <div class="menu-item-name-block">
          <strong>${escapeHtml(worker.displayName)}${isSelf ? " (You)" : ""}</strong>
          <span class="menu-item-category-tag">${formatRole(worker.role)} · @${escapeHtml(worker.username)}</span>
        </div>
      </div>

      <div class="dashboard-shift-card-row">
        <span>Last login</span>
        <span>${worker.lastLoginAt ? formatDateTime(worker.lastLoginAt) : "Never"}</span>
      </div>
      <div class="dashboard-shift-card-row">
        <span>Last shift</span>
        <span>${worker.lastShiftDate ? formatDateTime(worker.lastShiftDate) : "Never"}</span>
      </div>

      <div class="menu-item-badges">
        <button
          class="pill-toggle ${worker.isActive ? "is-on" : "is-off"}"
          type="button"
          data-toggle-worker-active="${worker.workerId}"
          ${isSelf ? "disabled title=\"You cannot deactivate your own account\"" : ""}
        >
          ${worker.isActive ? "Active" : "Inactive"}
        </button>
      </div>

      <div class="menu-item-actions">
        <button class="menu-icon-button" type="button" data-edit-worker="${worker.workerId}" title="Edit name/role">
          ${icon("edit")}
        </button>
        ${
          canResetPins
            ? `<button class="menu-icon-button" type="button" data-reset-worker-pin="${worker.workerId}" title="Reset PIN">${icon("lock")}</button>`
            : ""
        }
      </div>
    </div>
  `;
}

function renderWorkerEditForm(worker) {
  const draft = state.staff.editingWorker;

  return `
    <div class="menu-item-card">
      <div class="menu-item-edit-form">
        <div class="menu-item-edit-grid">
          <label class="form-field">
            <span>Name</span>
            <input type="text" data-edit-worker-name value="${escapeAttr(draft.displayName)}" />
          </label>
          <label class="form-field">
            <span>Role</span>
            <select data-edit-worker-role>${renderRoleOptions(draft.role)}</select>
          </label>
        </div>
        <div class="menu-form-actions">
          <button class="solid-action-button" type="button" data-save-worker="${worker.workerId}" ${state.staff.isSaving ? "disabled" : ""}>
            ${state.staff.isSaving ? `<span class="button-spinner"></span>` : "Save"}
          </button>
          <button class="outline-action-button" type="button" data-cancel-edit-worker>Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function renderResetPinForm(worker) {
  const draft = state.staff.resetPin;

  return `
    <div class="menu-item-card">
      <div class="menu-item-edit-form">
        <p class="menu-item-category-tag">Resetting PIN for ${escapeHtml(worker.displayName)} - they'll be signed out everywhere and need the new PIN to sign back in.</p>
        <div class="menu-item-edit-grid">
          <label class="form-field">
            <span>New PIN (4-8 digits)</span>
            <input type="password" inputmode="numeric" data-reset-pin-value value="${escapeAttr(draft.pin)}" />
          </label>
          <label class="form-field">
            <span>Confirm new PIN</span>
            <input type="password" inputmode="numeric" data-reset-pin-confirm value="${escapeAttr(draft.confirmPin)}" />
          </label>
        </div>
        <div class="menu-form-actions">
          <button class="solid-action-button" type="button" data-save-reset-pin="${worker.workerId}" ${state.staff.isSaving ? "disabled" : ""}>
            ${state.staff.isSaving ? `<span class="button-spinner"></span>` : "Reset PIN"}
          </button>
          <button class="outline-action-button" type="button" data-cancel-reset-pin>Cancel</button>
        </div>
      </div>
    </div>
  `;
}

async function loadStaffData() {
  try {
    state.staff.isLoading = true;
    state.error = "";
    renderAdminApp(state.root);

    state.staff.workers = await getAdminStaff(state.session.sessionToken);
    state.staff.hasLoaded = true;
  } catch (error) {
    state.error = toUserMessage(error);
  } finally {
    state.staff.isLoading = false;
    renderAdminApp(state.root);
  }
}

async function runStaffMutation(action) {
  try {
    state.staff.isSaving = true;
    state.error = "";
    renderAdminApp(state.root);

    await action();

    state.staff.isAddingWorker = false;
    state.staff.newWorker = { displayName: "", username: "", pin: "", confirmPin: "", role: "cashier" };
    state.staff.editingWorkerId = null;
    state.staff.resettingPinWorkerId = null;

    await loadStaffData();
  } catch (error) {
    state.error = toUserMessage(error);
  } finally {
    state.staff.isSaving = false;
    renderAdminApp(state.root);
  }
}

function bindStaffEvents() {
  const root = state.root;
  const token = () => state.session.sessionToken;

  root.querySelector("[data-start-add-worker]")?.addEventListener("click", () => {
    state.staff.isAddingWorker = true;
    state.staff.newWorker = { displayName: "", username: "", pin: "", confirmPin: "", role: "cashier" };
    renderAdminApp(root);
  });

  root.querySelector("[data-cancel-new-worker]")?.addEventListener("click", () => {
    state.staff.isAddingWorker = false;
    renderAdminApp(root);
  });

  root.querySelector("[data-new-worker-name]")?.addEventListener("input", (event) => {
    state.staff.newWorker.displayName = event.target.value;
  });

  root.querySelector("[data-new-worker-username]")?.addEventListener("input", (event) => {
    state.staff.newWorker.username = event.target.value;
  });

  root.querySelector("[data-new-worker-role]")?.addEventListener("change", (event) => {
    state.staff.newWorker.role = event.target.value;
  });

  root.querySelector("[data-new-worker-pin]")?.addEventListener("input", (event) => {
    state.staff.newWorker.pin = event.target.value;
  });

  root.querySelector("[data-new-worker-confirm-pin]")?.addEventListener("input", (event) => {
    state.staff.newWorker.confirmPin = event.target.value;
  });

  root.querySelector("[data-save-new-worker]")?.addEventListener("click", () => {
    const draft = state.staff.newWorker;
    const displayName = draft.displayName.trim();
    const username = draft.username.trim();

    if (!displayName || !username) {
      state.error = "Enter a name and username.";
      renderAdminApp(root);
      return;
    }

    if (!/^[0-9]{4,8}$/.test(draft.pin)) {
      state.error = "PIN must be 4 to 8 digits.";
      renderAdminApp(root);
      return;
    }

    if (draft.pin !== draft.confirmPin) {
      state.error = "PIN and confirmation don't match.";
      renderAdminApp(root);
      return;
    }

    runStaffMutation(() =>
      createWorker(token(), { displayName, username, pin: draft.pin, role: draft.role }),
    );
  });

  // Edit worker
  root.querySelectorAll("[data-edit-worker]").forEach((button) => {
    button.addEventListener("click", () => {
      const worker = state.staff.workers.find((candidate) => candidate.workerId === button.dataset.editWorker);
      state.staff.editingWorkerId = worker.workerId;
      state.staff.editingWorker = { displayName: worker.displayName, role: worker.role };
      renderAdminApp(root);
    });
  });

  root.querySelector("[data-cancel-edit-worker]")?.addEventListener("click", () => {
    state.staff.editingWorkerId = null;
    renderAdminApp(root);
  });

  root.querySelector("[data-edit-worker-name]")?.addEventListener("input", (event) => {
    state.staff.editingWorker.displayName = event.target.value;
  });

  root.querySelector("[data-edit-worker-role]")?.addEventListener("change", (event) => {
    state.staff.editingWorker.role = event.target.value;
  });

  root.querySelectorAll("[data-save-worker]").forEach((button) => {
    button.addEventListener("click", () => {
      const draft = state.staff.editingWorker;
      const displayName = draft.displayName.trim();

      if (!displayName) {
        state.error = "Name is required.";
        renderAdminApp(root);
        return;
      }

      runStaffMutation(() =>
        updateWorker(token(), button.dataset.saveWorker, { displayName, role: draft.role }),
      );
    });
  });

  // Activate/deactivate
  root.querySelectorAll("[data-toggle-worker-active]").forEach((button) => {
    button.addEventListener("click", () => {
      const worker = state.staff.workers.find(
        (candidate) => candidate.workerId === button.dataset.toggleWorkerActive,
      );
      runStaffMutation(() => setWorkerActive(token(), worker.workerId, !worker.isActive));
    });
  });

  // Reset PIN
  root.querySelectorAll("[data-reset-worker-pin]").forEach((button) => {
    button.addEventListener("click", () => {
      state.staff.resettingPinWorkerId = button.dataset.resetWorkerPin;
      state.staff.resetPin = { pin: "", confirmPin: "" };
      renderAdminApp(root);
    });
  });

  root.querySelector("[data-cancel-reset-pin]")?.addEventListener("click", () => {
    state.staff.resettingPinWorkerId = null;
    renderAdminApp(root);
  });

  root.querySelector("[data-reset-pin-value]")?.addEventListener("input", (event) => {
    state.staff.resetPin.pin = event.target.value;
  });

  root.querySelector("[data-reset-pin-confirm]")?.addEventListener("input", (event) => {
    state.staff.resetPin.confirmPin = event.target.value;
  });

  root.querySelectorAll("[data-save-reset-pin]").forEach((button) => {
    button.addEventListener("click", () => {
      const draft = state.staff.resetPin;

      if (!/^[0-9]{4,8}$/.test(draft.pin)) {
        state.error = "PIN must be 4 to 8 digits.";
        renderAdminApp(root);
        return;
      }

      if (draft.pin !== draft.confirmPin) {
        state.error = "PIN and confirmation don't match.";
        renderAdminApp(root);
        return;
      }

      runStaffMutation(() => resetWorkerPin(token(), button.dataset.saveResetPin, draft.pin));
    });
  });
}

// --- Order history (Task 5) ----------------------------------------------

function renderOrdersContent() {
  const filters = state.orders.filters;

  return `
    <main class="admin-dashboard">
      <section class="dashboard-section">
        <div class="dashboard-section-heading">
          <div>
            <p class="section-kicker">History</p>
            <h2>${state.orders.totalCount} order${state.orders.totalCount === 1 ? "" : "s"} match</h2>
          </div>
        </div>

        <div class="order-filters">
          <div class="order-filters-grid">
            <label class="form-field">
              <span>From</span>
              <input type="date" data-filter-date-from value="${filters.dateFrom}" />
            </label>
            <label class="form-field">
              <span>To</span>
              <input type="date" data-filter-date-to value="${filters.dateTo}" />
            </label>
            <label class="form-field">
              <span>Worker</span>
              <select data-filter-worker>
                <option value="">All workers</option>
                ${state.staff.workers
                  .map(
                    (worker) =>
                      `<option value="${worker.workerId}" ${worker.workerId === filters.workerId ? "selected" : ""}>${escapeHtml(worker.displayName)}</option>`,
                  )
                  .join("")}
              </select>
            </label>
            <label class="form-field">
              <span>Search</span>
              <input type="text" data-filter-search value="${escapeAttr(filters.search)}" placeholder="Order #, customer, phone" />
            </label>
          </div>

          <div class="menu-filter-tabs">
            ${renderStatusBucketTab("all", "All")}
            ${renderStatusBucketTab("active", "Active")}
            ${renderStatusBucketTab("completed", "Completed")}
            ${renderStatusBucketTab("cancelled", "Cancelled")}
          </div>
        </div>

        ${renderOrdersResults()}

        ${renderOrdersPagination()}
      </section>
    </main>
  `;
}

function renderStatusBucketTab(value, label) {
  return `
    <button class="menu-filter-tab ${state.orders.filters.statusBucket === value ? "is-active" : ""}" type="button" data-filter-status-bucket="${value}">
      ${label}
    </button>
  `;
}

function renderOrdersResults() {
  if (state.orders.isLoading && !state.orders.hasLoaded) {
    return `<div class="dashboard-chart-empty"><span class="boot-spinner"></span></div>`;
  }

  if (!state.orders.list.length) {
    return `<p class="menu-empty-state">No orders match these filters.</p>`;
  }

  const rows = state.orders.list
    .map(
      (order) => `
        <tr data-view-order="${order.orderId}">
          <td class="is-order-number">${escapeHtml(order.orderNumber)}</td>
          <td>${formatDateTime(order.createdAt)}</td>
          <td>${escapeHtml(order.workerName)}</td>
          <td>${escapeHtml(formatFulfillment(order.fulfillmentType))}</td>
          <td class="is-total">${formatMoney(order.total)}</td>
          <td><span class="order-payment-tag is-${order.paymentStatus}">${escapeHtml(formatPaymentStatus(order.paymentStatus))}</span></td>
          <td><span class="status-pill status-${escapeHtml(order.status)}">${escapeHtml(formatOrderStatus(order.status))}</span></td>
        </tr>
      `,
    )
    .join("");

  const cards = state.orders.list
    .map(
      (order) => `
        <div class="order-history-card" data-view-order="${order.orderId}">
          <div class="order-history-card-top">
            <strong>${escapeHtml(order.orderNumber)}</strong>
            <span class="status-pill status-${escapeHtml(order.status)}">${escapeHtml(formatOrderStatus(order.status))}</span>
          </div>
          <div class="dashboard-shift-card-row"><span>Date</span><span>${formatDateTime(order.createdAt)}</span></div>
          <div class="dashboard-shift-card-row"><span>Worker</span><span>${escapeHtml(order.workerName)}</span></div>
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
            <th>Worker</th>
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

function renderOrdersPagination() {
  if (!state.orders.totalCount) return "";

  const { offset, limit, totalCount } = state.orders;
  const from = totalCount === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, totalCount);

  return `
    <div class="order-pagination">
      <span>${from}–${to} of ${totalCount}</span>
      <div class="menu-form-actions">
        <button class="outline-action-button" type="button" data-orders-prev-page ${offset <= 0 ? "disabled" : ""}>Previous</button>
        <button class="outline-action-button" type="button" data-orders-next-page ${to >= totalCount ? "disabled" : ""}>Next</button>
      </div>
    </div>
  `;
}

async function loadOrdersData() {
  try {
    state.orders.isLoading = true;
    state.error = "";
    renderAdminApp(state.root);

    if (!state.staff.hasLoaded) {
      state.staff.workers = await getAdminStaff(state.session.sessionToken);
      state.staff.hasLoaded = true;
    }

    const { orders, totalCount } = await getAdminOrderHistory(state.session.sessionToken, {
      dateFrom: state.orders.filters.dateFrom,
      dateTo: state.orders.filters.dateTo,
      workerId: state.orders.filters.workerId || null,
      statusBucket: state.orders.filters.statusBucket,
      search: state.orders.filters.search,
      limit: state.orders.limit,
      offset: state.orders.offset,
    });

    state.orders.list = orders;
    state.orders.totalCount = totalCount;
    state.orders.hasLoaded = true;
  } catch (error) {
    state.error = toUserMessage(error);
  } finally {
    state.orders.isLoading = false;
    renderAdminApp(state.root);
  }
}

function applyOrderFilters() {
  state.orders.offset = 0;
  loadOrdersData();
}

async function openOrderDetail(orderId) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="modal-card receipt-modal detail-modal" role="dialog" aria-modal="true">
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
    const detail = await getAdminOrderDetail(state.session.sessionToken, orderId);
    modal.querySelector(".modal-card").innerHTML =
      `<button class="modal-close-button" type="button" data-close-modal aria-label="Close">${icon("close")}</button>` +
      renderOrderDetailBody(detail);
    modal.querySelector("[data-close-modal]")?.addEventListener("click", () => modal.remove());
  } catch (error) {
    modal.querySelector(".modal-card").innerHTML =
      `<button class="modal-close-button" type="button" data-close-modal aria-label="Close">${icon("close")}</button>` +
      `<div class="form-alert error-alert">${escapeHtml(toUserMessage(error))}</div>`;
    modal.querySelector("[data-close-modal]")?.addEventListener("click", () => modal.remove());
  }
}

function renderOrderDetailBody(detail) {
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
              <span>${escapeHtml(formatPaymentMethod(payment.paymentMethod))} · ${escapeHtml(payment.receivedByWorkerName)}</span>
              <span>${formatMoney(payment.amount)}</span>
            </div>
            ${payment.reference ? `<p class="order-detail-row-note">Ref: ${escapeHtml(payment.reference)}</p>` : ""}
          `,
        )
        .join("")
    : `<p class="order-detail-empty">No payments recorded.</p>`;

  const historyHtml = detail.statusHistory.length
    ? detail.statusHistory
        .map(
          (entry) => `
            <div class="order-detail-row">
              <span>${escapeHtml(formatStatusHistoryLine(entry))}</span>
              <span>${formatDateTime(entry.at)}</span>
            </div>
          `,
        )
        .join("")
    : `<p class="order-detail-empty">No history recorded.</p>`;

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
        ? `<p class="cancelled-note">Cancelled by ${escapeHtml(detail.cancelledByWorkerName || "unknown")}: ${escapeHtml(detail.cancellationReason)}</p>`
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

    <div class="order-detail-section">
      <h3>Status history</h3>
      ${historyHtml}
    </div>
  `;
}

function formatStatusHistoryLine(entry) {
  const details = entry.details || {};

  if (entry.action === "pos_order_created") {
    return `Order created by ${entry.workerName || "unknown"}`;
  }

  if (entry.action === "pos_order_status_updated") {
    const from = formatOrderStatus(details.previous_status);
    const to = formatOrderStatus(details.next_status);
    const who = entry.workerName || "unknown";

    if (details.next_status === "cancelled") {
      return `${who} cancelled the order${details.cancellation_reason ? `: ${details.cancellation_reason}` : ""}`;
    }

    return `${who} moved it from ${from} to ${to}`;
  }

  if (entry.action === "order_handed_over") {
    return `${entry.workerName || "Worker"} handed the order to the next shift`;
  }

  if (entry.action === "order_handover_claimed") {
    return `${entry.workerName || "Worker"} claimed the handed-over order`;
  }

  return entry.action;
}

function bindOrdersEvents() {
  const root = state.root;

  root.querySelector("[data-filter-date-from]")?.addEventListener("change", (event) => {
    state.orders.filters.dateFrom = event.target.value;
    applyOrderFilters();
  });

  root.querySelector("[data-filter-date-to]")?.addEventListener("change", (event) => {
    state.orders.filters.dateTo = event.target.value;
    applyOrderFilters();
  });

  root.querySelector("[data-filter-worker]")?.addEventListener("change", (event) => {
    state.orders.filters.workerId = event.target.value;
    applyOrderFilters();
  });

  let searchDebounce = null;
  root.querySelector("[data-filter-search]")?.addEventListener("input", (event) => {
    state.orders.filters.search = event.target.value;
    window.clearTimeout(searchDebounce);
    searchDebounce = window.setTimeout(() => applyOrderFilters(), 400);
  });

  root.querySelectorAll("[data-filter-status-bucket]").forEach((button) => {
    button.addEventListener("click", () => {
      state.orders.filters.statusBucket = button.dataset.filterStatusBucket;
      applyOrderFilters();
    });
  });

  root.querySelectorAll("[data-view-order]").forEach((element) => {
    element.addEventListener("click", () => {
      openOrderDetail(element.dataset.viewOrder);
    });
  });

  root.querySelector("[data-orders-prev-page]")?.addEventListener("click", () => {
    state.orders.offset = Math.max(0, state.orders.offset - state.orders.limit);
    loadOrdersData();
  });

  root.querySelector("[data-orders-next-page]")?.addEventListener("click", () => {
    state.orders.offset += state.orders.limit;
    loadOrdersData();
  });
}

// --- Shift history (Task 6) ------------------------------------------

function renderShiftsContent() {
  const filters = state.shifts.filters;

  return `
    <main class="admin-dashboard">
      <section class="dashboard-section">
        <div class="dashboard-section-heading">
          <div>
            <p class="section-kicker">History</p>
            <h2>${state.shifts.totalCount} shift${state.shifts.totalCount === 1 ? "" : "s"} match</h2>
          </div>
        </div>

        <div class="order-filters">
          <div class="order-filters-grid">
            <label class="form-field">
              <span>From</span>
              <input type="date" data-shift-filter-date-from value="${filters.dateFrom}" />
            </label>
            <label class="form-field">
              <span>To</span>
              <input type="date" data-shift-filter-date-to value="${filters.dateTo}" />
            </label>
            <label class="form-field">
              <span>Worker</span>
              <select data-shift-filter-worker>
                <option value="">All workers</option>
                ${state.staff.workers
                  .map(
                    (worker) =>
                      `<option value="${worker.workerId}" ${worker.workerId === filters.workerId ? "selected" : ""}>${escapeHtml(worker.displayName)}</option>`,
                  )
                  .join("")}
              </select>
            </label>
          </div>
        </div>

        ${renderShiftsResults()}

        ${renderShiftsPagination()}
      </section>
    </main>
  `;
}

function renderShiftsResults() {
  if (state.shifts.isLoading && !state.shifts.hasLoaded) {
    return `<div class="dashboard-chart-empty"><span class="boot-spinner"></span></div>`;
  }

  if (!state.shifts.list.length) {
    return `<p class="menu-empty-state">No shifts match these filters.</p>`;
  }

  const rows = state.shifts.list.map(renderShiftTableRow).join("");
  const cards = state.shifts.list.map(renderShiftHistoryCard).join("");

  return `
    <div class="dashboard-table-wrap">
      <table class="dashboard-table is-clickable">
        <thead>
          <tr>
            <th>Worker</th>
            <th>Status</th>
            <th>Opened</th>
            <th>Closed</th>
            <th>Opening cash</th>
            <th>Expected</th>
            <th>Actual</th>
            <th>Variance</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="dashboard-shift-cards is-clickable">${cards}</div>
  `;
}

function shiftToRowViewModel(shift) {
  const varianceClass = shift.cashVariance === null ? "" : shift.cashVariance === 0 ? "is-balanced" : "is-off";
  const varianceLabel =
    shift.cashVariance === null
      ? "—"
      : shift.cashVariance === 0
        ? "Matches"
        : `${shift.cashVariance > 0 ? "Over" : "Short"} ${formatMoney(Math.abs(shift.cashVariance))}`;

  return {
    workerName: shift.workerName,
    // Open shifts don't have a green "Closed" pill yet - reusing
    // status-confirmed (blue, already styled) for "Open" avoids adding a
    // near-duplicate CSS rule for a state that's rare in history (most
    // rows here are already closed).
    statusClass: shift.status === "open" ? "status-confirmed" : "status-completed",
    statusLabel: shift.status === "open" ? "Open" : "Closed",
    openedAtLabel: formatDateTime(shift.openedAt),
    closedAtLabel: shift.closedAt ? formatDateTime(shift.closedAt) : "—",
    openingCashActual: shift.openingCashActual,
    expectedCash: shift.expectedCash,
    actualCashCounted: shift.actualCashCounted,
    varianceClass,
    varianceLabel,
    noteLabel: shift.closingNote ? escapeHtml(shift.closingNote) : "—",
  };
}

function renderShiftTableRow(shift) {
  const vm = shiftToRowViewModel(shift);

  return `
    <tr data-view-shift="${shift.shiftId}">
      <td class="is-worker">${escapeHtml(vm.workerName)}</td>
      <td><span class="status-pill ${vm.statusClass}">${vm.statusLabel}</span></td>
      <td>${vm.openedAtLabel}</td>
      <td>${vm.closedAtLabel}</td>
      <td>${formatMoney(vm.openingCashActual)}</td>
      <td>${formatMoney(vm.expectedCash)}</td>
      <td>${vm.actualCashCounted === null ? "—" : formatMoney(vm.actualCashCounted)}</td>
      <td class="${vm.varianceClass}">${vm.varianceLabel}</td>
      <td>${vm.noteLabel}</td>
    </tr>
  `;
}

function renderShiftHistoryCard(shift) {
  const vm = shiftToRowViewModel(shift);

  return `
    <div class="dashboard-shift-card" data-view-shift="${shift.shiftId}">
      <span class="dashboard-shift-card-worker">${escapeHtml(vm.workerName)} · <span class="status-pill ${vm.statusClass}">${vm.statusLabel}</span></span>
      <div class="dashboard-shift-card-row"><span>Opened</span><span>${vm.openedAtLabel}</span></div>
      <div class="dashboard-shift-card-row"><span>Closed</span><span>${vm.closedAtLabel}</span></div>
      <div class="dashboard-shift-card-row"><span>Opening cash</span><span>${formatMoney(vm.openingCashActual)}</span></div>
      <div class="dashboard-shift-card-row"><span>Expected</span><span>${formatMoney(vm.expectedCash)}</span></div>
      <div class="dashboard-shift-card-row"><span>Actual</span><span>${vm.actualCashCounted === null ? "—" : formatMoney(vm.actualCashCounted)}</span></div>
      <div class="dashboard-shift-card-row ${vm.varianceClass}"><span>Variance</span><span>${vm.varianceLabel}</span></div>
      <div class="dashboard-shift-card-row"><span>Notes</span><span>${vm.noteLabel}</span></div>
    </div>
  `;
}

function renderShiftsPagination() {
  if (!state.shifts.totalCount) return "";

  const { offset, limit, totalCount } = state.shifts;
  const from = totalCount === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, totalCount);

  return `
    <div class="order-pagination">
      <span>${from}–${to} of ${totalCount}</span>
      <div class="menu-form-actions">
        <button class="outline-action-button" type="button" data-shifts-prev-page ${offset <= 0 ? "disabled" : ""}>Previous</button>
        <button class="outline-action-button" type="button" data-shifts-next-page ${to >= totalCount ? "disabled" : ""}>Next</button>
      </div>
    </div>
  `;
}

async function loadShiftsData() {
  try {
    state.shifts.isLoading = true;
    state.error = "";
    renderAdminApp(state.root);

    if (!state.staff.hasLoaded) {
      state.staff.workers = await getAdminStaff(state.session.sessionToken);
      state.staff.hasLoaded = true;
    }

    const { shifts, totalCount } = await getAdminShiftHistory(state.session.sessionToken, {
      dateFrom: state.shifts.filters.dateFrom,
      dateTo: state.shifts.filters.dateTo,
      workerId: state.shifts.filters.workerId || null,
      limit: state.shifts.limit,
      offset: state.shifts.offset,
    });

    state.shifts.list = shifts;
    state.shifts.totalCount = totalCount;
    state.shifts.hasLoaded = true;
  } catch (error) {
    state.error = toUserMessage(error);
  } finally {
    state.shifts.isLoading = false;
    renderAdminApp(state.root);
  }
}

function applyShiftFilters() {
  state.shifts.offset = 0;
  loadShiftsData();
}

async function openShiftDetail(shiftId) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="modal-card receipt-modal detail-modal" role="dialog" aria-modal="true">
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
    const detail = await getAdminShiftDetail(state.session.sessionToken, shiftId);
    modal.querySelector(".modal-card").innerHTML =
      `<button class="modal-close-button" type="button" data-close-modal aria-label="Close">${icon("close")}</button>` +
      renderShiftDetailBody(detail);
    modal.querySelector("[data-close-modal]")?.addEventListener("click", () => modal.remove());
  } catch (error) {
    modal.querySelector(".modal-card").innerHTML =
      `<button class="modal-close-button" type="button" data-close-modal aria-label="Close">${icon("close")}</button>` +
      `<div class="form-alert error-alert">${escapeHtml(toUserMessage(error))}</div>`;
    modal.querySelector("[data-close-modal]")?.addEventListener("click", () => modal.remove());
  }
}

function renderShiftDetailBody(detail) {
  const variance = Number(detail.cashVariance || 0);
  const varianceLabel =
    variance === 0 ? "Matches" : `${variance > 0 ? "Over" : "Short"} ${formatMoney(Math.abs(variance))}`;

  const ordersHtml = detail.orders.length
    ? detail.orders
        .map(
          (order) => `
            <div class="order-detail-row">
              <span>${escapeHtml(order.orderNumber)} · ${escapeHtml(formatOrderStatus(order.status))}</span>
              <span>${formatMoney(order.total)}</span>
            </div>
          `,
        )
        .join("")
    : `<p class="order-detail-empty">No orders in this shift.</p>`;

  const paymentsHtml = detail.payments.length
    ? detail.payments
        .map(
          (payment) => `
            <div class="order-detail-row">
              <span>${escapeHtml(payment.orderNumber)} · ${escapeHtml(formatPaymentMethod(payment.paymentMethod))}</span>
              <span>${formatMoney(payment.amount)}</span>
            </div>
          `,
        )
        .join("")
    : `<p class="order-detail-empty">No payments in this shift.</p>`;

  const movementsHtml = detail.cashMovements.length
    ? detail.cashMovements
        .map(
          (movement) => `
            <div class="order-detail-row">
              <span>${escapeHtml(movement.movementType)}${movement.reason ? ` — ${escapeHtml(movement.reason)}` : ""}</span>
              <span>${formatMoney(movement.amount)}</span>
            </div>
          `,
        )
        .join("")
    : `<p class="order-detail-empty">No cash movements recorded.</p>`;

  return `
    <div class="receipt-header">
      <img src="/yumyard-logo.png" alt="Yum Yard" />
      <div>
        <p class="section-kicker">Shift · ${escapeHtml(detail.status === "open" ? "Open" : "Closed")}</p>
        <h2>${escapeHtml(detail.workerName)}</h2>
        <span>${formatDateTime(detail.openedAt)} – ${detail.closedAt ? formatDateTime(detail.closedAt) : "still open"}</span>
      </div>
    </div>

    <div class="receipt-summary">
      <div><span>Opening cash</span><strong>${formatMoney(detail.openingCashActual)}</strong></div>
      <div><span>Expected cash</span><strong>${formatMoney(detail.expectedCash)}</strong></div>
      <div class="receipt-grand-total"><span>Actual counted</span><strong>${detail.actualCashCounted == null ? "—" : formatMoney(detail.actualCashCounted)}</strong></div>
    </div>

    <div class="receipt-summary">
      <div><span>Cash sales</span><strong>${formatMoney(detail.cashSalesTotal)}</strong></div>
      <div><span>MoMo sales</span><strong>${formatMoney(detail.momoSalesTotal)}</strong></div>
      <div><span>Hubtel sales</span><strong>${formatMoney(detail.hubtelSalesTotal)}</strong></div>
    </div>

    ${
      detail.actualCashCounted != null
        ? `<p class="receipt-detail">${icon("check")} <span>Variance: ${varianceLabel}</span></p>`
        : ""
    }
    ${detail.closingNote ? `<p class="receipt-detail">${icon("edit")} <span>${escapeHtml(detail.closingNote)}</span></p>` : ""}

    <div class="order-detail-section">
      <h3>Orders in this shift</h3>
      ${ordersHtml}
    </div>

    <div class="order-detail-section">
      <h3>Payments received</h3>
      ${paymentsHtml}
    </div>

    <div class="order-detail-section">
      <h3>Cash movements</h3>
      ${movementsHtml}
    </div>
  `;
}

function bindShiftsEvents() {
  const root = state.root;

  root.querySelector("[data-shift-filter-date-from]")?.addEventListener("change", (event) => {
    state.shifts.filters.dateFrom = event.target.value;
    applyShiftFilters();
  });

  root.querySelector("[data-shift-filter-date-to]")?.addEventListener("change", (event) => {
    state.shifts.filters.dateTo = event.target.value;
    applyShiftFilters();
  });

  root.querySelector("[data-shift-filter-worker]")?.addEventListener("change", (event) => {
    state.shifts.filters.workerId = event.target.value;
    applyShiftFilters();
  });

  root.querySelectorAll("[data-view-shift]").forEach((element) => {
    element.addEventListener("click", () => {
      openShiftDetail(element.dataset.viewShift);
    });
  });

  root.querySelector("[data-shifts-prev-page]")?.addEventListener("click", () => {
    state.shifts.offset = Math.max(0, state.shifts.offset - state.shifts.limit);
    loadShiftsData();
  });

  root.querySelector("[data-shifts-next-page]")?.addEventListener("click", () => {
    state.shifts.offset += state.shifts.limit;
    loadShiftsData();
  });
}

// --- Revenue reports -------------------------------------------------

function renderReportsContent() {
  if (state.reports.isLoading && !state.reports.hasLoaded) {
    return `
      <main class="admin-dashboard">
        <div class="dashboard-chart-empty"><span class="boot-spinner"></span></div>
      </main>
    `;
  }

  return `
    <main class="admin-dashboard">
      ${renderRevenueSummaryGrid()}

      <section class="dashboard-section">
        <div class="dashboard-section-heading">
          <div>
            <p class="section-kicker">Trend</p>
            <h2>${state.reports.trendGranularity === "day" ? "Last 30 days" : "Last 12 months"}</h2>
          </div>
          <div class="menu-filter-tabs">
            <button class="menu-filter-tab ${state.reports.trendGranularity === "day" ? "is-active" : ""}" type="button" data-reports-granularity="day">Daily</button>
            <button class="menu-filter-tab ${state.reports.trendGranularity === "month" ? "is-active" : ""}" type="button" data-reports-granularity="month">Monthly</button>
          </div>
        </div>
        ${renderTrendChart()}
      </section>
    </main>
  `;
}

function renderRevenueSummaryGrid() {
  const summary = state.reports.summary;

  if (state.reports.isLoading || !summary) {
    return `
      <div class="dashboard-summary-grid">
        ${Array.from({ length: 4 })
          .map(() => `<div class="dashboard-summary-card"><span class="boot-spinner"></span></div>`)
          .join("")}
      </div>
    `;
  }

  return `
    <div class="dashboard-summary-grid">
      <div class="dashboard-summary-card highlight">
        <span class="dashboard-summary-icon">${icon("receipt")}</span>
        <div class="dashboard-summary-card-body">
          <span>Today</span>
          <strong>${formatMoney(summary.todaySales)}</strong>
        </div>
      </div>
      <div class="dashboard-summary-card">
        <span class="dashboard-summary-icon">${icon("grid")}</span>
        <div class="dashboard-summary-card-body">
          <span>This week</span>
          <strong>${formatMoney(summary.weekToDateSales)}</strong>
        </div>
      </div>
      <div class="dashboard-summary-card">
        <span class="dashboard-summary-icon">${icon("barChart")}</span>
        <div class="dashboard-summary-card-body">
          <span>This month</span>
          <strong>${formatMoney(summary.monthToDateSales)}</strong>
        </div>
      </div>
      <div class="dashboard-summary-card highlight">
        <span class="dashboard-summary-icon">${icon("orders")}</span>
        <div class="dashboard-summary-card-body">
          <span>This year</span>
          <strong>${formatMoney(summary.yearToDateSales)}</strong>
        </div>
      </div>
    </div>
  `;
}

function renderTrendChart() {
  if (state.reports.isLoading) {
    return `<div class="dashboard-chart-empty"><span class="boot-spinner"></span></div>`;
  }

  const rows = state.reports.trend;
  const granularity = state.reports.trendGranularity;
  const maxSales = Math.max(0, ...rows.map((row) => row.sales));

  if (!rows.length || maxSales <= 0) {
    return `
      <div class="dashboard-chart-empty">
        ${icon("receipt")}
        <p>No sales recorded in this period yet.</p>
      </div>
    `;
  }

  const chartWidth = 720;
  const chartHeight = 190;
  const axisHeight = 22;
  const barSlot = chartWidth / rows.length;
  const barWidth = barSlot * 0.62;
  // Daily view has up to 30 bars - labeling every one would collide, so
  // space them out; monthly view has at most 12, so every bar gets one.
  const labelStep = granularity === "day" ? Math.ceil(rows.length / 8) : 1;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const y = chartHeight - chartHeight * fraction;
    return `<line class="chart-gridline" x1="0" y1="${y}" x2="${chartWidth}" y2="${y}" />`;
  });

  const bars = rows
    .map((row, index) => {
      const barHeight =
        maxSales > 0 ? Math.max((row.sales / maxSales) * chartHeight, row.sales > 0 ? 3 : 0) : 0;
      const x = index * barSlot + (barSlot - barWidth) / 2;
      const y = chartHeight - barHeight;
      const isPeak = row.sales === maxSales && maxSales > 0;
      const showLabel = index % labelStep === 0;

      return `
        <g>
          <title>${formatBucketLabel(row.bucketDate, granularity, false)}: ${formatMoney(row.sales)}</title>
          <rect
            class="chart-bar ${isPeak ? "is-peak" : ""}"
            x="${x.toFixed(1)}"
            y="${y.toFixed(1)}"
            width="${barWidth.toFixed(1)}"
            height="${barHeight.toFixed(1)}"
            rx="2"
          />
          ${
            showLabel
              ? `<text class="chart-axis-label" x="${(index * barSlot + barSlot / 2).toFixed(1)}" y="${chartHeight + 14}" text-anchor="middle">${formatBucketLabel(row.bucketDate, granularity, true)}</text>`
              : ""
          }
        </g>
      `;
    })
    .join("");

  return `
    <svg class="dashboard-bar-chart" viewBox="0 0 ${chartWidth} ${chartHeight + axisHeight}" role="img" aria-label="Sales trend">
      ${gridLines.join("")}
      ${bars}
    </svg>
  `;
}

function formatBucketLabel(bucketDate, granularity, short) {
  const date = new Date(`${bucketDate}T00:00:00Z`);

  if (granularity === "month") {
    return new Intl.DateTimeFormat("en-GH", {
      month: short ? "short" : "long",
      year: short ? undefined : "numeric",
      timeZone: "UTC",
    }).format(date);
  }

  return new Intl.DateTimeFormat("en-GH", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

async function loadReportsData() {
  try {
    state.reports.isLoading = true;
    state.error = "";
    renderAdminApp(state.root);

    const sessionToken = state.session.sessionToken;
    const periods = state.reports.trendGranularity === "day" ? 30 : 12;
    const [summary, trend] = await Promise.all([
      getAdminRevenueSummary(sessionToken),
      getAdminRevenueTrend(sessionToken, state.reports.trendGranularity, periods),
    ]);

    state.reports.summary = summary;
    state.reports.trend = trend;
    state.reports.hasLoaded = true;
  } catch (error) {
    state.error = toUserMessage(error);
  } finally {
    state.reports.isLoading = false;
    renderAdminApp(state.root);
  }
}

function bindReportsEvents() {
  const root = state.root;

  root.querySelectorAll("[data-reports-granularity]").forEach((button) => {
    button.addEventListener("click", () => {
      const granularity = button.dataset.reportsGranularity;
      if (granularity === state.reports.trendGranularity) return;
      state.reports.trendGranularity = granularity;
      loadReportsData();
    });
  });
}

// --- Item/category sales performance ---------------------------------

function renderPerformanceContent() {
  if (state.performance.isLoading && !state.performance.hasLoaded) {
    return `
      <main class="admin-dashboard">
        <div class="dashboard-chart-empty"><span class="boot-spinner"></span></div>
      </main>
    `;
  }

  const filters = state.performance.filters;

  return `
    <main class="admin-dashboard">
      <section class="dashboard-section">
        <div class="dashboard-section-heading">
          <div>
            <p class="section-kicker">Performance</p>
            <h2>Best and worst sellers</h2>
          </div>
          <div class="menu-filter-tabs">
            <button class="menu-filter-tab ${state.performance.view === "items" ? "is-active" : ""}" type="button" data-performance-view="items">Items</button>
            <button class="menu-filter-tab ${state.performance.view === "categories" ? "is-active" : ""}" type="button" data-performance-view="categories">Categories</button>
          </div>
        </div>

        <div class="order-filters">
          <div class="order-filters-grid">
            <label class="form-field">
              <span>From</span>
              <input type="date" data-performance-date-from value="${filters.dateFrom}" />
            </label>
            <label class="form-field">
              <span>To</span>
              <input type="date" data-performance-date-to value="${filters.dateTo}" />
            </label>
            <label class="form-field">
              <span>Sort by</span>
              <select data-performance-sort>
                <option value="revenue" ${state.performance.sortBy === "revenue" ? "selected" : ""}>Revenue</option>
                <option value="quantity" ${state.performance.sortBy === "quantity" ? "selected" : ""}>Quantity sold</option>
              </select>
            </label>
          </div>
        </div>

        ${state.performance.view === "items" ? renderItemPerformanceResults() : renderCategoryPerformanceResults()}
      </section>
    </main>
  `;
}

function sortedPerformanceRows(rows) {
  const key = state.performance.sortBy === "quantity" ? "quantitySold" : "revenue";
  return [...rows].sort((a, b) => b[key] - a[key]);
}

function renderItemPerformanceResults() {
  const rows = sortedPerformanceRows(state.performance.items.filter((item) => !item.isArchived));

  if (!rows.length) {
    return `<p class="menu-empty-state">No sales recorded in this period yet.</p>`;
  }

  const maxValue = Math.max(...rows.map((row) => (state.performance.sortBy === "quantity" ? row.quantitySold : row.revenue)), 1);

  const tableRows = rows
    .map((row, index) => {
      const value = state.performance.sortBy === "quantity" ? row.quantitySold : row.revenue;
      const barWidth = Math.max((value / maxValue) * 100, value > 0 ? 4 : 0);
      const rankClass = index === 0 && value > 0 ? "is-top-seller" : index === rows.length - 1 && value === 0 ? "is-zero-seller" : "";

      return `
        <tr class="${rankClass}">
          <td class="is-order-number">${escapeHtml(row.itemName)}</td>
          <td>${escapeHtml(row.categoryName)}</td>
          <td>${row.quantitySold}</td>
          <td>${row.orderCount}</td>
          <td class="is-total">${formatMoney(row.revenue)}</td>
          <td><div class="performance-bar-track"><div class="performance-bar-fill" style="width:${barWidth.toFixed(1)}%"></div></div></td>
        </tr>
      `;
    })
    .join("");

  const cards = rows
    .map(
      (row) => `
        <div class="order-history-card">
          <div class="order-history-card-top">
            <strong>${escapeHtml(row.itemName)}</strong>
            <span class="menu-item-category-tag">${escapeHtml(row.categoryName)}</span>
          </div>
          <div class="dashboard-shift-card-row"><span>Qty sold</span><span>${row.quantitySold}</span></div>
          <div class="dashboard-shift-card-row"><span>Orders</span><span>${row.orderCount}</span></div>
          <div class="dashboard-shift-card-row"><span>Revenue</span><span>${formatMoney(row.revenue)}</span></div>
        </div>
      `,
    )
    .join("");

  return `
    <div class="order-table-wrap">
      <table class="order-table performance-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Category</th>
            <th>Qty sold</th>
            <th>Orders</th>
            <th>Revenue</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <div class="order-history-cards">${cards}</div>
  `;
}

function renderCategoryPerformanceResults() {
  const rows = sortedPerformanceRows(state.performance.categories);

  if (!rows.length) {
    return `<p class="menu-empty-state">No categories to report on yet.</p>`;
  }

  const maxValue = Math.max(...rows.map((row) => (state.performance.sortBy === "quantity" ? row.quantitySold : row.revenue)), 1);

  const tableRows = rows
    .map((row) => {
      const value = state.performance.sortBy === "quantity" ? row.quantitySold : row.revenue;
      const barWidth = Math.max((value / maxValue) * 100, value > 0 ? 4 : 0);

      return `
        <tr>
          <td class="is-order-number">${escapeHtml(row.categoryName)}${row.isActive ? "" : ` <span class="menu-archived-badge">Inactive</span>`}</td>
          <td>${row.itemCount}</td>
          <td>${row.quantitySold}</td>
          <td>${row.orderCount}</td>
          <td class="is-total">${formatMoney(row.revenue)}</td>
          <td><div class="performance-bar-track"><div class="performance-bar-fill" style="width:${barWidth.toFixed(1)}%"></div></div></td>
        </tr>
      `;
    })
    .join("");

  const cards = rows
    .map(
      (row) => `
        <div class="order-history-card">
          <div class="order-history-card-top">
            <strong>${escapeHtml(row.categoryName)}</strong>
            ${row.isActive ? "" : `<span class="menu-archived-badge">Inactive</span>`}
          </div>
          <div class="dashboard-shift-card-row"><span>Items</span><span>${row.itemCount}</span></div>
          <div class="dashboard-shift-card-row"><span>Qty sold</span><span>${row.quantitySold}</span></div>
          <div class="dashboard-shift-card-row"><span>Orders</span><span>${row.orderCount}</span></div>
          <div class="dashboard-shift-card-row"><span>Revenue</span><span>${formatMoney(row.revenue)}</span></div>
        </div>
      `,
    )
    .join("");

  return `
    <div class="order-table-wrap">
      <table class="order-table performance-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Items</th>
            <th>Qty sold</th>
            <th>Orders</th>
            <th>Revenue</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <div class="order-history-cards">${cards}</div>
  `;
}

async function loadPerformanceData() {
  try {
    state.performance.isLoading = true;
    state.error = "";
    renderAdminApp(state.root);

    const sessionToken = state.session.sessionToken;
    const { dateFrom, dateTo } = state.performance.filters;
    const [items, categories] = await Promise.all([
      getAdminItemSales(sessionToken, { dateFrom, dateTo }),
      getAdminCategorySales(sessionToken, { dateFrom, dateTo }),
    ]);

    state.performance.items = items;
    state.performance.categories = categories;
    state.performance.hasLoaded = true;
  } catch (error) {
    state.error = toUserMessage(error);
  } finally {
    state.performance.isLoading = false;
    renderAdminApp(state.root);
  }
}

function bindPerformanceEvents() {
  const root = state.root;

  root.querySelectorAll("[data-performance-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.performance.view = button.dataset.performanceView;
      renderAdminApp(root);
    });
  });

  root.querySelector("[data-performance-date-from]")?.addEventListener("change", (event) => {
    state.performance.filters.dateFrom = event.target.value;
    loadPerformanceData();
  });

  root.querySelector("[data-performance-date-to]")?.addEventListener("change", (event) => {
    state.performance.filters.dateTo = event.target.value;
    loadPerformanceData();
  });

  root.querySelector("[data-performance-sort]")?.addEventListener("change", (event) => {
    state.performance.sortBy = event.target.value;
    renderAdminApp(root);
  });
}

// --- Events ----------------------------------------------------------------

function bindScreenEvents() {
  const root = state.root;

  root.querySelectorAll("[data-sign-out]").forEach((button) => {
    button.addEventListener("click", () => signOut("Signed out of admin."));
  });

  root.querySelectorAll("[data-refresh-current]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.activeNav === "menu") {
        loadMenuData();
      } else if (state.activeNav === "staff") {
        loadStaffData();
      } else if (state.activeNav === "orders") {
        loadOrdersData();
      } else if (state.activeNav === "shifts") {
        loadShiftsData();
      } else if (state.activeNav === "reports") {
        loadReportsData();
      } else if (state.activeNav === "performance") {
        loadPerformanceData();
      } else {
        loadDashboardData();
      }
    });
  });

  root.querySelectorAll("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => selectNav(button.dataset.nav));
  });

  root.querySelector("[data-toggle-sidebar-collapse]")?.addEventListener("click", () => {
    state.isSidebarCollapsed = !state.isSidebarCollapsed;
    writeStoredSidebarPreference(state.isSidebarCollapsed);
    renderAdminApp(root);
  });

  root.querySelector("[data-open-mobile-sidebar]")?.addEventListener("click", () => {
    state.isMobileSidebarOpen = true;
    renderAdminApp(root);
  });

  root.querySelector("[data-close-mobile-sidebar]")?.addEventListener("click", () => {
    state.isMobileSidebarOpen = false;
    renderAdminApp(root);
  });

  bindLoginEvents();
  bindMenuEvents();
  bindStaffEvents();
  bindOrdersEvents();
  bindShiftsEvents();
  bindReportsEvents();
  bindPerformanceEvents();
}

function selectNav(navKey) {
  const item = NAV_ITEMS.find((navItem) => navItem.key === navKey);

  if (!item || !item.enabled) {
    return;
  }

  state.activeNav = navKey;
  state.isMobileSidebarOpen = false;
  renderAdminApp(state.root);

  if (navKey === "menu" && !state.menu.hasLoaded) {
    loadMenuData();
  }

  if (navKey === "staff" && !state.staff.hasLoaded) {
    loadStaffData();
  }

  if (navKey === "orders" && !state.orders.hasLoaded) {
    loadOrdersData();
  }

  if (navKey === "shifts" && !state.shifts.hasLoaded) {
    loadShiftsData();
  }

  if (navKey === "reports" && !state.reports.hasLoaded) {
    loadReportsData();
  }

  if (navKey === "performance" && !state.performance.hasLoaded) {
    loadPerformanceData();
  }
}

function bindLoginEvents() {
  const root = state.root;

  root.querySelectorAll("[data-select-profile]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedWorkerId = button.dataset.selectProfile;
      state.loginPin = "";
      state.error = "";
      renderAdminApp(root);
    });
  });

  root.querySelector("[data-pin-back]")?.addEventListener("click", () => {
    state.selectedWorkerId = null;
    state.loginPin = "";
    state.error = "";
    renderAdminApp(root);
  });

  root.querySelectorAll("[data-pin-digit]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.loginPin.length >= 12) return;
      state.loginPin += button.dataset.pinDigit;
      state.error = "";
      renderAdminApp(root);
    });
  });

  root.querySelector("[data-pin-backspace]")?.addEventListener("click", () => {
    state.loginPin = state.loginPin.slice(0, -1);
    renderAdminApp(root);
  });

  root.querySelector("[data-pin-clear]")?.addEventListener("click", () => {
    state.loginPin = "";
    renderAdminApp(root);
  });

  root
    .querySelector("[data-pin-submit]")
    ?.addEventListener("click", handleProfileLoginSubmit);
}

async function loadLoginWorkers() {
  try {
    state.isLoadingWorkers = true;
    renderAdminApp(state.root);

    const workers = await listBranchWorkers();
    state.loginWorkers = workers.filter((worker) =>
      APP_CONFIG.adminRoles.includes(worker.role),
    );
  } catch (error) {
    state.error = toUserMessage(error);
  } finally {
    state.isLoadingWorkers = false;
    renderAdminApp(state.root);
  }
}

async function handleProfileLoginSubmit() {
  const workerId = state.selectedWorkerId;
  const pin = state.loginPin;
  const worker = state.loginWorkers.find((item) => item.workerId === workerId);

  if (!workerId || !worker) {
    state.error = "Select your profile first.";
    renderAdminApp(state.root);
    return;
  }

  if (pin.length < 4) {
    state.error = "Enter your PIN.";
    renderAdminApp(state.root);
    return;
  }

  try {
    state.isLoading = true;
    state.error = "";
    state.notice = "";
    renderAdminApp(state.root);

    const session = await authenticateAdminWorkerById(workerId, pin);
    saveAdminSession(session);
    state.session = session;
    state.selectedWorkerId = null;
    state.loginPin = "";
    state.isLoading = false;
    await goToDashboard();
  } catch (error) {
    state.loginPin = "";
    state.error = toUserMessage(error);
    state.isLoading = false;
    renderAdminApp(state.root);
  }
}

async function goToDashboard() {
  state.view = "dashboard";
  state.activeNav = "dashboard";
  state.error = "";
  renderAdminApp(state.root);
  await loadDashboardData();
}

async function loadDashboardData() {
  try {
    state.isLoadingDashboard = true;
    state.error = "";
    renderAdminApp(state.root);

    const sessionToken = state.session.sessionToken;
    const [today, salesByHour, shiftsToday] = await Promise.all([
      getAdminDashboardToday(sessionToken),
      getAdminSalesByHour(sessionToken),
      getAdminShiftsClosedToday(sessionToken),
    ]);

    state.dashboardToday = today;
    state.salesByHour = salesByHour;
    state.shiftsToday = shiftsToday;
  } catch (error) {
    state.error = toUserMessage(error);
  } finally {
    state.isLoadingDashboard = false;
    renderAdminApp(state.root);
  }
}

async function signOut(notice = "") {
  const sessionToken = state.session?.sessionToken;

  try {
    if (sessionToken) {
      await lockAdminSession(sessionToken, "Signed out from Yum Yard Admin");
    }
  } catch {
    // Clear browser state even if the remote request fails.
  }

  clearAdminSession();
  state.session = null;
  state.dashboardToday = null;
  state.salesByHour = [];
  state.shiftsToday = [];
  state.isMobileSidebarOpen = false;
  state.notice = notice;
  showLogin();
}

function showLogin() {
  state.view = "login";
  state.isLoading = false;
  state.selectedWorkerId = null;
  state.loginPin = "";
  renderAdminApp(state.root);
  loadLoginWorkers();
}

function readStoredSidebarPreference() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStoredSidebarPreference(isCollapsed) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, String(isCollapsed));
  } catch {
    // Not critical - just a remembered UI preference.
  }
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
    unpaid: "Unpaid",
    partially_paid: "Partially paid",
    paid: "Paid",
  };

  return labels[status] || status;
}

function formatRole(role) {
  const labels = {
    owner: "Owner",
    admin: "Admin",
    manager: "Manager",
    supervisor: "Supervisor",
    cashier: "Cashier",
  };

  return labels[role] || role;
}

function formatHourLabel(hour) {
  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:00 ${period}`;
}

function formatHourShort(hour) {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

function formatTime(value) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("en-GH", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function toUserMessage(error) {
  const message = error?.message || "Something went wrong. Please try again.";

  if (message.includes("session is invalid")) {
    return "Your session expired or was locked. Sign in again.";
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

// Same escaping works for quoted HTML attribute values; kept as a
// separate name at call sites so it's clear which context is being
// escaped for.
const escapeAttr = escapeHtml;
