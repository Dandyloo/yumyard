import { formatMoney } from "./formatters.js";

// Shared bar chart for the Admin dashboard (sales by hour) and Reports (daily / monthly trend).
// Pure HTML + CSS (no chart library): hover or tap a bar to see its value, nice y-axis ticks,
// dashed average line, gold highlight on the best bucket. Styles live in style.css under `.ch-*`.

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Round the top of the axis to a "nice" number so ticks read 0 / 200 / 400 / 600 instead of 0 / 187 / 374.
function niceScale(maxValue, tickCount = 4) {
  if (maxValue <= 0) return { max: tickCount, step: 1 };

  const rawStep = maxValue / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const niceResidual = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10;
  const step = niceResidual * magnitude;

  return { max: step * tickCount, step };
}

export function formatCompactMoney(value) {
  const number = Number(value || 0);

  if (number >= 1000) {
    const thousands = number / 1000;
    return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
  }

  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

/**
 * buckets: [{ label, tipTitle, tipLines?: string[], value, showLabel?, isCurrent? }]
 * options: { ariaLabel, valueSuffix? }
 */
export function renderBarChart(buckets, { ariaLabel = "Chart", averageLabel = "Avg" } = {}) {
  const values = buckets.map((bucket) => bucket.value);
  const maxValue = Math.max(0, ...values);
  const { max: axisMax, step } = niceScale(maxValue);
  const lastIndex = buckets.length - 1;

  const activeBuckets = buckets.filter((bucket) => bucket.value > 0);
  const average = activeBuckets.length
    ? activeBuckets.reduce((sum, bucket) => sum + bucket.value, 0) / activeBuckets.length
    : 0;

  const ticks = Array.from({ length: 5 }, (_, index) => index * step);
  const pct = (value) => Math.min((value / axisMax) * 100, 100);

  const grid = ticks
    .map(
      (tick) => `
        <div class="ch-gridline" style="bottom:${pct(tick).toFixed(2)}%">
          <span class="ch-ytick">${formatCompactMoney(tick)}</span>
        </div>`,
    )
    .join("");

  const columns = buckets
    .map((bucket, index) => {
      const isPeak = bucket.value > 0 && bucket.value === maxValue;
      const height = bucket.value > 0 ? Math.max(pct(bucket.value), 1.5) : 0;
      const tipSide = index <= 1 ? "ch-tip--left" : index >= lastIndex - 1 ? "ch-tip--right" : "";
      const tipLines = (bucket.tipLines || []).map((line) => `<span>${esc(line)}</span>`).join("");

      return `
        <button
          class="ch-col ${isPeak ? "is-peak" : ""} ${bucket.isCurrent ? "is-current" : ""} ${bucket.value <= 0 ? "is-empty" : ""}"
          type="button"
          aria-label="${esc(bucket.tipTitle)}: ${esc(formatMoney(bucket.value))}"
        >
          <span class="ch-bar" style="height:${height.toFixed(2)}%"></span>
          <span class="ch-tip ${tipSide}" role="tooltip" style="bottom:calc(${height.toFixed(2)}% + 10px)">
            <strong>${esc(bucket.tipTitle)}</strong>
            <b>${formatMoney(bucket.value)}</b>
            ${tipLines}
          </span>
        </button>`;
    })
    .join("");

  const labels = buckets
    .map(
      (bucket) =>
        `<span class="ch-xlabel ${bucket.showLabel ? "" : "is-minor"}">${bucket.showLabel ? esc(bucket.label) : ""}</span>`,
    )
    .join("");

  const averageLine =
    average > 0
      ? `<div class="ch-average" style="bottom:${pct(average).toFixed(2)}%"><span>${esc(averageLabel)} ${formatMoney(average)}</span></div>`
      : "";

  return `
    <div class="ch" role="group" aria-label="${esc(ariaLabel)}" style="--ch-cols:${buckets.length}">
      <div class="ch-plot">
        ${grid}
        ${averageLine}
        <div class="ch-bars">${columns}</div>
      </div>
      <div class="ch-xaxis">${labels}</div>
    </div>`;
}

/** Small stat tiles shown above a chart: [{ label, value, hint? }] */
export function renderChartStats(stats) {
  return `
    <div class="ch-stats">
      ${stats
        .map(
          (stat) => `
            <div class="ch-stat">
              <span>${esc(stat.label)}</span>
              <strong>${esc(stat.value)}</strong>
              ${stat.hint ? `<small>${esc(stat.hint)}</small>` : ""}
            </div>`,
        )
        .join("")}
    </div>`;
}
