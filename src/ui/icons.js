const ICONS = {
  add: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  `,
  arrowRight: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  `,
  back: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  `,
  cart: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 4h2l2.1 10.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 1.9-1.4L20 8H7" />
      <path d="M10 20.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0ZM18 20.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0Z" />
    </svg>
  `,
  check: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12 4.2 4.2L19 6.5" />
    </svg>
  `,
  chevronDown: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  `,
  close: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  `,
  delivery: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h11v10H3zM14 9h3l4 4v3h-7z" />
      <path d="M7.5 19.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM17.5 19.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
    </svg>
  `,
  dineIn: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12h16M7 12v7M17 12v7M3 19h18" />
      <path d="M6 12V8a6 6 0 0 1 12 0v4" />
    </svg>
  `,
  edit: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m4 20 4.4-1 10.3-10.3a2.1 2.1 0 0 0-3-3L5.4 16 4 20Z" />
      <path d="m13.8 7.5 2.8 2.8" />
    </svg>
  `,
  lock: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" />
    </svg>
  `,
  minus: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  `,
  more: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h.01M12 12h.01M19 12h.01" />
    </svg>
  `,
  orders: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h10M7 21h10M7 3v3M17 3v3M7 21v-3M17 21v-3" />
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="M8 10h8M8 14h5" />
    </svg>
  `,
  phone: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.7 3.5 4.5 5.1c-.8.6-1 1.7-.5 2.6 2.8 5.8 5.9 8.9 11.7 11.7.9.4 2 .3 2.6-.5l1.6-2.2c.5-.7.4-1.7-.3-2.2l-3-2.1c-.6-.4-1.5-.3-2 .3l-1 1.2a12.7 12.7 0 0 1-3.5-3.5l1.2-1c.6-.5.7-1.4.3-2l-2.1-3c-.5-.7-1.5-.8-2.2-.3Z" />
    </svg>
  `,
  pickup: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 10h16v9H4zM3 10h18M7 10V7a5 5 0 0 1 10 0v3" />
      <path d="M9 14h6" />
    </svg>
  `,
  receipt: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  `,
  search: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  `,
  settings: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.1 2.1-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-3v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2.1-2.1.1-.1A1.7 1.7 0 0 0 7 15a1.7 1.7 0 0 0-1.5-1H5.3v-3h.2A1.7 1.7 0 0 0 7 10a1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.1-2.1.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h3v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.1 2.1-.1.1A1.7 1.7 0 0 0 19.4 10a1.7 1.7 0 0 0 1.5 1h.2v3h-.2a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  `,
  trash: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" />
    </svg>
  `,
  user: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </svg>
  `,
  wifi: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 9.5a13 13 0 0 1 17 0M6.7 12.8a8.5 8.5 0 0 1 10.6 0M9.8 16a4 4 0 0 1 4.4 0M12 20h.01" />
    </svg>
  `,
};

export function icon(name, className = "") {
  const svg = ICONS[name] || "";
  return svg.replace("<svg", `<svg class="icon ${className}"`);
}