import {
  formatDateTime,
  formatFulfillment,
  formatMoney,
  formatPaymentMethod,
} from "./formatters.js";

/**
 * Receipt printing.
 *
 * Works with any printer the device can print to (USB / Bluetooth thermal printers show
 * up in the normal print dialog) and with "Save as PDF" when no printer exists yet.
 * Edit RECEIPT_CONFIG to change what appears on the slip.
 */
export const RECEIPT_CONFIG = {
  businessName: "Yum Yard",
  addressLines: ["Abura, Cape Coast"],
  phone: "", // e.g. "024 000 0000" - leave empty to hide
  footerLines: ["Thank you for dining with us!"],
  logoSrc: "/yumyard-logo.png",
};

const PAPER_KEY = "yy_receipt_paper_mm";

export function getReceiptPaperWidth() {
  try {
    return window.localStorage.getItem(PAPER_KEY) === "58" ? 58 : 80;
  } catch {
    return 80;
  }
}

function saveReceiptPaperWidth(width) {
  try {
    window.localStorage.setItem(PAPER_KEY, String(width));
  } catch {
    // Storage can be blocked; the choice just won't be remembered.
  }
}

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildReceiptHtml(receipt, widthMm = 80) {
  const cfg = RECEIPT_CONFIG;
  const isCancelled = receipt.status === "cancelled";
  const balanceDue = Number(receipt.balanceDue || 0);
  const deliveryFee = Number(receipt.deliveryFee || 0);

  const items = (receipt.items || [])
    .map(
      (item) => `
        <div class="rcpt-row">
          <span class="rcpt-grow">${Number(item.quantity)} x ${esc(item.itemName)}${item.proteinChoice ? ` (${esc(item.proteinChoice)})` : ""}</span>
          <span>${formatMoney(item.lineTotal)}</span>
        </div>
      `,
    )
    .join("");

  const payments = (receipt.payments || [])
    .map(
      (payment) => `
        <div class="rcpt-row">
          <span class="rcpt-grow">${esc(formatPaymentMethod(payment.paymentMethod))}</span>
          <span>${formatMoney(payment.amount)}</span>
        </div>
      `,
    )
    .join("");

  return `
    <div class="rcpt rcpt-w${widthMm}">
      <div class="rcpt-center">
        ${cfg.logoSrc ? `<img class="rcpt-logo" src="${esc(cfg.logoSrc)}" alt="" />` : ""}
        <div class="rcpt-title">${esc(cfg.businessName)}</div>
        ${cfg.addressLines.map((line) => `<div>${esc(line)}</div>`).join("")}
        ${cfg.phone ? `<div>Tel: ${esc(cfg.phone)}</div>` : ""}
      </div>

      <div class="rcpt-rule"></div>

      ${isCancelled ? `<div class="rcpt-center rcpt-strong">*** CANCELLED ***</div>` : ""}
      <div class="rcpt-row"><span>Order</span><span class="rcpt-strong">${esc(receipt.orderNumber)}</span></div>
      <div class="rcpt-row"><span>Date</span><span>${esc(formatDateTime(receipt.createdAt))}</span></div>
      <div class="rcpt-row"><span>Type</span><span>${esc(formatFulfillment(receipt.fulfillmentType))}</span></div>
      ${receipt.createdByName ? `<div class="rcpt-row"><span>Served by</span><span>${esc(receipt.createdByName)}</span></div>` : ""}
      ${
        receipt.customerName || receipt.customerPhone
          ? `<div class="rcpt-row"><span>Customer</span><span>${esc([receipt.customerName, receipt.customerPhone].filter(Boolean).join(" "))}</span></div>`
          : ""
      }
      ${receipt.deliveryAddress ? `<div class="rcpt-row"><span>Deliver to</span><span>${esc(receipt.deliveryAddress)}</span></div>` : ""}

      <div class="rcpt-rule"></div>

      ${items || `<div class="rcpt-center">No items</div>`}

      <div class="rcpt-rule"></div>

      <div class="rcpt-row"><span class="rcpt-grow">Subtotal</span><span>${formatMoney(receipt.subtotal)}</span></div>
      ${deliveryFee > 0 ? `<div class="rcpt-row"><span class="rcpt-grow">Delivery fee</span><span>${formatMoney(deliveryFee)}</span></div>` : ""}
      <div class="rcpt-row rcpt-total"><span class="rcpt-grow">TOTAL</span><span>${formatMoney(receipt.total)}</span></div>

      ${
        isCancelled
          ? ""
          : `
            <div class="rcpt-rule"></div>
            ${payments || `<div class="rcpt-center">No payment recorded</div>`}
            ${
              balanceDue > 0
                ? `<div class="rcpt-row rcpt-strong"><span class="rcpt-grow">BALANCE DUE</span><span>${formatMoney(balanceDue)}</span></div>`
                : payments
                  ? `<div class="rcpt-center rcpt-strong">PAID IN FULL</div>`
                  : ""
            }
          `
      }

      ${receipt.orderNotes ? `<div class="rcpt-rule"></div><div>Note: ${esc(receipt.orderNotes)}</div>` : ""}

      <div class="rcpt-rule"></div>
      <div class="rcpt-center">
        ${cfg.footerLines.map((line) => `<div>${esc(line)}</div>`).join("")}
        <div class="rcpt-small">Printed ${esc(formatDateTime(new Date().toISOString()))}</div>
      </div>
    </div>
  `;
}

/** Sends the receipt to the browser's print dialog (printer or Save as PDF). */
export function printReceipt(receipt, widthMm = getReceiptPaperWidth()) {
  document.getElementById("receipt-print-root")?.remove();

  const root = document.createElement("div");
  root.id = "receipt-print-root";
  root.innerHTML = buildReceiptHtml(receipt, widthMm);
  document.body.append(root);
  document.body.classList.add("printing-receipt");

  const cleanup = () => {
    document.body.classList.remove("printing-receipt");
    root.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);

  // Give the logo a moment to load so it isn't missing from the printout.
  const logo = root.querySelector("img");
  const logoReady =
    logo && !logo.complete
      ? new Promise((resolve) => {
          logo.addEventListener("load", resolve, { once: true });
          logo.addEventListener("error", resolve, { once: true });
          window.setTimeout(resolve, 1500);
        })
      : Promise.resolve();

  logoReady.then(() => window.print());
}

/** On-screen preview (works with no printer) with paper width + Print button. */
export function openReceiptPreview(receipt) {
  let width = getReceiptPaperWidth();

  const modal = document.createElement("div");
  modal.className = "modal-backdrop";

  const render = () => {
    modal.innerHTML = `
      <section class="modal-card receipt-preview-card" role="dialog" aria-modal="true" aria-label="Receipt preview">
        <button class="modal-close-button" type="button" data-close-modal aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
        </button>

        <div class="modal-heading">
          <p class="section-kicker">Receipt</p>
          <h2>${esc(receipt.orderNumber)}</h2>
        </div>

        <div class="receipt-paper-toggle" role="group" aria-label="Paper width">
          <button type="button" class="${width === 58 ? "is-active" : ""}" data-paper="58">58 mm</button>
          <button type="button" class="${width === 80 ? "is-active" : ""}" data-paper="80">80 mm</button>
        </div>

        <div class="receipt-preview-paper">${buildReceiptHtml(receipt, width)}</div>

        <div class="receipt-actions">
          <button class="solid-action-button" type="button" data-do-print><span>Print receipt</span></button>
          <button class="outline-action-button" type="button" data-close-modal><span>Close</span></button>
        </div>
        <p class="receipt-preview-hint">No printer yet? Choose "Save as PDF" in the print window.</p>
      </section>
    `;

    modal
      .querySelectorAll("[data-close-modal]")
      .forEach((button) => button.addEventListener("click", () => modal.remove()));

    modal.querySelectorAll("[data-paper]").forEach((button) => {
      button.addEventListener("click", () => {
        width = Number(button.dataset.paper) === 58 ? 58 : 80;
        saveReceiptPaperWidth(width);
        render();
      });
    });

    modal
      .querySelector("[data-do-print]")
      ?.addEventListener("click", () => printReceipt(receipt, width));
  };

  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });

  render();
  document.body.append(modal);
}
