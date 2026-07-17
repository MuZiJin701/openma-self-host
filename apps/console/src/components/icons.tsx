/**
 * Inline SVG icons used across the console — single source of truth so the
 * sidebar nav, page headers, badges, and any future surfaces all render the
 * same glyph for the same concept.
 *
 * Each icon accepts an optional `className` (defaults to w-4 h-4) and
 * inherits `currentColor` from its parent text color, so dark mode and
 * status tones (info / danger / success) work automatically.
 *
 * Stroke-based by default so dark mode and status tones inherit cleanly.
 */

import type { ReactNode } from "react";

interface IconProps {
  className?: string;
}

function StrokeIcon({ d, className }: { d: string; className?: string }) {
  return (
    <svg
      className={className ?? "w-4 h-4"}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      <path d={d} />
    </svg>
  );
}

/**
 * Wrapper for the larger, thinner-stroked icons used inside `<EmptyState>`.
 * Defaults to 36px (w-9) and stroke-width 1.5 so the glyph reads as a
 * decorative illustration rather than a chunky UI affordance. Takes
 * `children` so individual icons can mix paths, circles, and grouped
 * transforms (e.g. the tilted `EmptyFileIcon`).
 */
function EmptyStateSvg({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      className={className ?? "w-9 h-9"}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

// ─── Resource icons (used in sidebar nav AND page header badges) ──────────

export function DashboardIcon({ className }: IconProps) {
  return <StrokeIcon className={className} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />;
}

export function AgentIcon({ className }: IconProps) {
  return <StrokeIcon className={className} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />;
}

export function SessionsIcon({ className }: IconProps) {
  return <StrokeIcon className={className} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />;
}

export function EnvIcon({ className }: IconProps) {
  return <StrokeIcon className={className} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />;
}

export function VaultIcon({ className }: IconProps) {
  return <StrokeIcon className={className} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />;
}

export function SkillsIcon({ className }: IconProps) {
  return <StrokeIcon className={className} d="M13 10V3L4 14h7v7l9-11h-7z" />;
}

export function MemoryIcon({ className }: IconProps) {
  return <StrokeIcon className={className} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />;
}

export function ModelCardsIcon({ className }: IconProps) {
  return <StrokeIcon className={className} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />;
}

export function ApiKeysIcon({ className }: IconProps) {
  return <StrokeIcon className={className} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />;
}

/** Local Runtimes — the user's machine running `oma bridge daemon`. Laptop /
 *  desktop-mac silhouette. */
export function RuntimesIcon({ className }: IconProps) {
  return <StrokeIcon className={className} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />;
}

export function FilesIcon({ className }: IconProps) {
  return <StrokeIcon className={className} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />;
}

// ─── Generic UI icons ────────────────────────────────────────────────────

export function ClockIcon({ className }: IconProps) {
  return <StrokeIcon className={className} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />;
}

// "Time spent" / duration. Same glyph as ClockIcon for now — kept separate
// so the call site reads as intent (duration vs absolute time).
export function DurationIcon({ className }: IconProps) {
  return <StrokeIcon className={className} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />;
}

export function ChevronDownIcon({ className }: IconProps) {
  return <StrokeIcon className={className} d="M19 9l-7 7-7-7" />;
}

// ─── EmptyState entity icons ──────────────────────────────────────────────
// Larger, thinner-stroked illustrations rendered above the title in
// `<EmptyState>`. Distinct from the sidebar nav icons (which are 16px and
// chunkier) so the empty page reads as an illustration, not a button. Each
// is intentionally a different shape vocabulary (hexagon, isometric box,
// bar chart, padlock, …) so a user glancing at any list page can tell at a
// distance "ah, that's the agents empty state, not the vaults one."

/** Hexagonal robot head with two eye slits and a mouth bar. Avoids the
 *  cliché chat-bubble "AI assistant" look. */
export function EmptyAgentIcon({ className }: IconProps) {
  return (
    <EmptyStateSvg className={className}>
      <path d="M12 3 L20 7.5 L20 16.5 L12 21 L4 16.5 L4 7.5 Z" />
      <path d="M9 11 v2 M15 11 v2" />
      <path d="M9.5 16 h5" />
    </EmptyStateSvg>
  );
}

/** Two overlapping speech bubbles — back bubble in the top-right, front
 *  bubble in the bottom-left. Reads as "a conversation" without copying
 *  any existing messenger app icon. */
export function EmptySessionIcon({ className }: IconProps) {
  return (
    <EmptyStateSvg className={className}>
      <path d="M11 3 h9 a1 1 0 011 1 v6 a1 1 0 01-1 1 h-3 l-2 2 v-2 h-4 a1 1 0 01-1-1 V4 a1 1 0 011-1 Z" />
      <path d="M3 9 h9 a1 1 0 011 1 v6 a1 1 0 01-1 1 h-4 l-2 2 v-2 H3 a1 1 0 01-1-1 v-6 a1 1 0 011-1 Z" />
    </EmptyStateSvg>
  );
}

/** Document with the canonical folded corner, tilted ~6° so it doesn't
 *  feel like a database table row. */
export function EmptyFileIcon({ className }: IconProps) {
  return (
    <EmptyStateSvg className={className}>
      <g transform="rotate(-6 12 12)">
        <path d="M6 3 h8 l4 4 v13 a1 1 0 01-1 1 H6 a1 1 0 01-1-1 V4 a1 1 0 011-1 Z" />
        <path d="M14 3 v4 h4" />
        <path d="M8 12 h7 M8 15 h5 M8 18 h6" />
      </g>
    </EmptyStateSvg>
  );
}

/** Isometric 3D box / container. */
export function EmptyEnvIcon({ className }: IconProps) {
  return (
    <EmptyStateSvg className={className}>
      <path d="M12 3 L20 7 L20 16 L12 20 L4 16 L4 7 Z" />
      <path d="M4 7 L12 11 L20 7" />
      <path d="M12 11 V20" />
    </EmptyStateSvg>
  );
}

/** Front card with two stack-hint lines above suggesting more cards
 *  layered behind. Picked over "stacked discs" because discs would
 *  collide visually with the database cylinder used for memory. */
export function EmptySkillIcon({ className }: IconProps) {
  return (
    <EmptyStateSvg className={className}>
      <path d="M5 6 h12 v1" />
      <path d="M3 9 h14 v1" />
      <path d="M2 12 h16 a1 1 0 011 1 v6 a1 1 0 01-1 1 H2 a1 1 0 01-1-1 v-6 a1 1 0 011-1 Z" />
    </EmptyStateSvg>
  );
}

/** Card frame with three horizontal bars inside — mocks the
 *  label/value/sub layout of an actual model-card row. */
export function EmptyModelCardIcon({ className }: IconProps) {
  return (
    <EmptyStateSvg className={className}>
      <path d="M3 5 h18 a1 1 0 011 1 v12 a1 1 0 01-1 1 H3 a1 1 0 01-1-1 V6 a1 1 0 011-1 Z" />
      <path d="M6 10 h6" />
      <path d="M6 13 h12" />
      <path d="M6 16 h8" />
    </EmptyStateSvg>
  );
}

/** Key silhouette — round bow on the left with a hole in it, shaft
 *  pointing right, two teeth at the tip. Different from the existing
 *  `ApiKeysIcon` (hex-handle key) so the empty state has its own
 *  vocabulary. */
export function EmptyApiKeyIcon({ className }: IconProps) {
  return (
    <EmptyStateSvg className={className}>
      <circle cx="7" cy="12" r="3.5" />
      <circle cx="7" cy="12" r="1" />
      <path d="M10.5 12 H21" />
      <path d="M19 12 V14" />
      <path d="M16 12 V13.5" />
    </EmptyStateSvg>
  );
}
