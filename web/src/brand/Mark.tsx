import s from "./brand.module.css";

/**
 * The linked hive: two halves of a hexagon, two people's sides, joined by one link. Every colour
 * is a theme variable, so it follows the chosen theme. The link and its far node carry
 * `data-link` so a container can brighten them on hover.
 */
export function Mark({
  size = 18,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className ? `${s.mark} ${className}` : s.mark}
    >
      <g
        fill="none"
        strokeWidth={3.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 7.6 L8.4 14.3 L8.4 33.7 L20 40.4" stroke="var(--mark)" />
        <path
          d="M28 7.6 L39.6 14.3 L39.6 33.7 L28 40.4"
          stroke="var(--fresh-4)"
        />
        <path data-link="" d="M17 24 L31 24" stroke="var(--fresh-7)" />
      </g>
      <circle cx={17} cy={24} r={4} fill="var(--mark)" />
      <circle data-link="" cx={31} cy={24} r={4} fill="var(--fresh-7)" />
    </svg>
  );
}
