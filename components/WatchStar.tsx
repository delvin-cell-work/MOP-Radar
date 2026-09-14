"use client";

interface WatchStarProps {
  watched: boolean;
  /** The block's name, for the button's accessible label. */
  title: string;
  onToggle: () => void;
  className?: string;
}

export function WatchStar({ watched, title, onToggle, className = "" }: WatchStarProps) {
  return (
    <button
      type="button"
      aria-pressed={watched}
      aria-label={watched ? `Remove ${title} from watchlist` : `Add ${title} to watchlist`}
      title={watched ? "Remove from watchlist" : "Add to watchlist"}
      onClick={onToggle}
      className={`relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100 ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        className={`h-6 w-6 ${watched ? "fill-amber-400 stroke-amber-600" : "fill-none stroke-slate-500"}`}
        strokeWidth="1.75"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9L12 3.5z" />
      </svg>
    </button>
  );
}
