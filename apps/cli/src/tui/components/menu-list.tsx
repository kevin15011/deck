import React from "react";
import { Box, Text, useStdout } from "ink";

export type MenuItem = {
  id?: string;
  label: string;
  hint?: string;
  checked?: boolean;
};

type MenuListProps = {
  items: MenuItem[];
  cursor: number;
  multiselect?: boolean;
  maxVisible?: number;
};

/**
 * Compute visible window for menu items.
 * Ensures cursor is always visible within the window.
 * Prefers centering cursor when possible.
 *
 * When windowing is active, two rows are reserved for scroll indicators
 * (top and bottom) so the rendered list height stays constant as the
 * cursor moves. This prevents the cursor and items from visually
 * shifting when the indicators appear or disappear while navigating.
 *
 * `maxVisible` is the total number of rendered rows including indicators.
 */
export function computeWindow(cursor: number, totalItems: number, maxVisible: number): { start: number; end: number } {
  if (totalItems <= maxVisible) {
    return { start: 0, end: totalItems };
  }

  // Clamp cursor to valid range
  const clampedCursor = Math.max(0, Math.min(cursor, totalItems - 1));

  // Reserve up to two rows for scroll indicators so the total rendered
  // height stays constant as the cursor moves through a long list.
  const reservedRows = 2;
  const itemSlots = Math.max(1, maxVisible - reservedRows);

  // Start with cursor at the center of the item window
  const halfWindow = Math.floor(itemSlots / 2);
  let start = clampedCursor - halfWindow;
  let end = start + itemSlots;

  // Adjust if window goes out of bounds
  if (start < 0) {
    start = 0;
    end = itemSlots;
  } else if (end > totalItems) {
    end = totalItems;
    start = totalItems - itemSlots;
  }

  return { start, end };
}

export function MenuList({ items, cursor, multiselect = false, maxVisible }: MenuListProps) {
  const { stdout } = useStdout();

  // Use terminal height minus chrome (title, help, padding, borders)
  // Conservative estimate: 6 rows for frame chrome
  const defaultMax = stdout?.rows ? Math.max(5, stdout.rows - 6) : 20;
  const effectiveMax = maxVisible ?? defaultMax;

  // Defensive clamp: the cursor may briefly be out of range if the items
  // list changes asynchronously (e.g. provider swap, async model load)
  // while the parent state has not yet re-clamped. computeWindow already
  // clamps internally for window math, but the `focused` check below
  // compares against the raw cursor — so we clamp here too to guarantee
  // the selector (❯) is always rendered on a visible item.
  const safeCursor =
    items.length === 0 ? 0 : Math.max(0, Math.min(cursor, items.length - 1));

  const { start, end } = computeWindow(safeCursor, items.length, effectiveMax);
  const visibleItems = items.slice(start, end);
  // Windowing is active whenever the visible slice doesn't cover the
  // entire list — in that case we always render two indicator slots so
  // the cursor's visual position stays stable across navigation.
  const isWindowing = start > 0 || end < items.length;
  const topHasMore = start > 0;
  const bottomHasMore = end < items.length;

  return (
    <Box flexDirection="column">
      {isWindowing ? (
        topHasMore ? (
          <Text dimColor>…</Text>
        ) : (
          // Zero-width space (U+200B) — NOT matched by \s, so it survives
          // Ink's per-line trimEnd() in Output.get(). A regular space
          // (" ") would be trimmed to an empty string, producing a
          // trailing "\n" in the joined output and causing Ink's
          // log-update to over-erase by one line on the next render —
          // the visual symptom is the cursor/items "disappearing" while
          // navigating near the top or bottom of a long list. ZWSP is
          // invisible (zero terminal width) so the row still looks
          // blank while reliably occupying a rendered line.
          <Text>{"\u200B"}</Text>
        )
      ) : null}
      {visibleItems.map((item, offset) => {
        const index = start + offset;
        const focused = index === safeCursor;
        const prefix = focused ? "❯" : " ";
        const checkbox = multiselect ? (item.checked ? "[x] " : "[ ] ") : "";

        // Force each item to occupy exactly one physical line.
        // Ink's Text defaults to `wrap="wrap"`, which splits long rows
        // (label + hint) into multiple physical lines. MenuList windowing
        // assumes one rendered line per item; when a long row enters or
        // leaves the visible window, the row count shifts and the cursor
        // visually "disappears" because Ink's log-update over/under-erases.
        // `wrap="truncate"` collapses overflow to a single line with a `…`
        // indicator, keeping the rendered row count stable across navigation.
        // Note: the prop is `wrap` on the React component; the underlying
        // style key is `textWrap` — both refer to the same Ink behavior.
        return (
          <Text
            key={item.id ?? `${item.label}-${index}`}
            color={focused ? "cyan" : undefined}
            wrap="truncate"
          >
            {prefix} {checkbox}{item.label}{item.hint ? <Text color="yellow"> {item.hint}</Text> : null}
          </Text>
        );
      })}
      {isWindowing ? (
        bottomHasMore ? (
          <Text dimColor>…</Text>
        ) : (
          <Text>{"\u200B"}</Text>
        )
      ) : null}
    </Box>
  );
}
