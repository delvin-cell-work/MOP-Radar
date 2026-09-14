import { FLAT_TYPES } from "@/lib/flat-types";
import { formatMonthLabel, formatPrice } from "@/lib/format";
import { parseMonth } from "@/lib/months";
import type { PriceSeries } from "@/lib/transactions";

const WIDTH = 300;
const HEIGHT = 72;
const PAD_X = 4;
const PAD_Y = 6;

/**
 * Resale prices over time for one flat type. Dated facts only: no trend line,
 * forecast or colour that could read as a valuation.
 */
export function PriceSparkline({ series }: { series: PriceSeries }) {
  const label = FLAT_TYPES.find((type) => type.key === series.flatType)?.label ?? series.flatType;
  const { points } = series;
  const first = points[0];
  const last = points[points.length - 1];
  const prices = points.map((point) => point.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const startMonth = parseMonth(first.month);
  const monthSpan = Math.max(1, parseMonth(last.month) - startMonth);
  const priceSpan = Math.max(1, high - low);

  const coordinates = points.map((point) => {
    const x = PAD_X + ((parseMonth(point.month) - startMonth) / monthSpan) * (WIDTH - PAD_X * 2);
    const y = PAD_Y + (1 - (point.price - low) / priceSpan) * (HEIGHT - PAD_Y * 2);
    return { x, y };
  });
  const path = coordinates.map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  const description =
    `${label} resale prices: ${formatPrice(first.price)} in ${formatMonthLabel(first.month)}, ` +
    `${formatPrice(last.price)} in ${formatMonthLabel(last.month)}, across ${points.length} resales. ` +
    `Lowest ${formatPrice(low)}, highest ${formatPrice(high)}.`;

  return (
    <figure className="rounded-xl border border-slate-200 p-3">
      <figcaption className="text-xs text-slate-500">
        {label} resale prices, {formatMonthLabel(first.month)} – {formatMonthLabel(last.month)} ({points.length} resales)
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={description}
        className="mt-2 block h-[4.5rem] w-full"
      >
        <path d={path} fill="none" stroke="#334155" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        {coordinates.map(({ x, y }, index) => (
          <circle key={index} cx={x} cy={y} r="2" fill="#334155" />
        ))}
      </svg>
      <div aria-hidden="true" className="mt-1 flex justify-between gap-3 text-xs tabular-nums text-slate-600">
        <span>
          {formatPrice(first.price)} · {formatMonthLabel(first.month)}
        </span>
        <span className="text-right">
          {formatPrice(last.price)} · {formatMonthLabel(last.month)}
        </span>
      </div>
    </figure>
  );
}
