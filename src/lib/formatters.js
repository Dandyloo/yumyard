export const moneyFormatter = new Intl.NumberFormat("en-GH", {
  style: "currency",
  currency: "GHS",
  minimumFractionDigits: 2,
});

export function formatMoney(value) {
  return moneyFormatter.format(Number(value || 0));
}

export function formatDateTime(value) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatTime(value) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GH", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatFulfillment(value) {
  const labels = {
    "walk-in": "Walk-in",
    pickup: "Pickup",
    delivery: "Delivery",
    "dine-in": "Dine-in",
  };

  return labels[value] || value;
}

export function formatPaymentMethod(value) {
  const labels = {
    cash: "Cash",
    momo: "MoMo",
    hubtel: "Hubtel",
  };

  return labels[value] || value || "—";
}

export function formatOrderSource(value) {
  const labels = {
    "direct-pos": "Direct POS",
    "phone-call": "Phone call",
    whatsapp: "WhatsApp",
    hubtel: "Hubtel",
    other: "Other",
  };

  return labels[value] || value;
}