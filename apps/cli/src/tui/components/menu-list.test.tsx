import React from "react";
import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";

import { MenuList, computeWindow, type MenuItem } from "./menu-list";

describe("computeWindow", () => {
  describe("short lists (no windowing)", () => {
    test("returns full range when totalItems <= maxVisible", () => {
      expect(computeWindow(0, 3, 20)).toEqual({ start: 0, end: 3 });
      expect(computeWindow(2, 3, 20)).toEqual({ start: 0, end: 3 });
      expect(computeWindow(0, 20, 20)).toEqual({ start: 0, end: 20 });
    });

    test("handles empty list", () => {
      expect(computeWindow(0, 0, 20)).toEqual({ start: 0, end: 0 });
    });

    test("handles single item", () => {
      expect(computeWindow(0, 1, 20)).toEqual({ start: 0, end: 1 });
    });
  });

  describe("long lists (windowing active)", () => {
    // Two rows are reserved for scroll indicators when windowing is
    // active, so the item window is `maxVisible - 2` items wide.
    // `maxVisible` represents the total rendered row count.

    test("cursor at start keeps window at top", () => {
      const { start, end } = computeWindow(0, 50, 20);
      expect(start).toBe(0);
      // 20 maxVisible rows - 2 indicator rows = 18 item rows
      expect(end).toBe(18);
    });

    test("cursor in middle centers window around cursor", () => {
      const { start, end } = computeWindow(25, 50, 20);
      // Item window is 18 wide; halfWindow = 9 → start = 25 - 9 = 16
      expect(start).toBe(16);
      expect(end).toBe(34);
      // Cursor (25) should be within window
      expect(25).toBeGreaterThanOrEqual(start);
      expect(25).toBeLessThan(end);
    });

    test("cursor at end keeps window at bottom", () => {
      const { start, end } = computeWindow(49, 50, 20);
      // end pinned to totalItems=50, start = 50 - 18 = 32
      expect(start).toBe(32);
      expect(end).toBe(50);
    });

    test("cursor beyond last page still renders selected item", () => {
      // User navigates past the end (edge case)
      const { start, end } = computeWindow(100, 50, 20);
      // Cursor should be clamped to last item (49)
      expect(start).toBe(32);
      expect(end).toBe(50);
      // Last item (49) should be in window
      expect(49).toBeGreaterThanOrEqual(start);
      expect(49).toBeLessThan(end);
    });

    test("negative cursor is clamped to 0", () => {
      const { start, end } = computeWindow(-5, 50, 20);
      expect(start).toBe(0);
      expect(end).toBe(18);
    });

    test("cursor just past first page shifts window", () => {
      const { start, end } = computeWindow(20, 50, 20);
      // Item window 18 wide; halfWindow = 9 → start = 20 - 9 = 11, end = 29
      expect(start).toBe(11);
      expect(end).toBe(29);
      expect(20).toBeGreaterThanOrEqual(start);
      expect(20).toBeLessThan(end);
    });

    test("cursor near end keeps last item visible", () => {
      const { start, end } = computeWindow(45, 50, 20);
      // halfWindow = 9 → start = 36, end = 54 → clamped to start=32, end=50
      expect(start).toBe(32);
      expect(end).toBe(50);
      expect(45).toBeGreaterThanOrEqual(start);
      expect(45).toBeLessThan(end);
    });
  });

  describe("window size edge cases", () => {
    test("maxVisible=1 shows only cursor", () => {
      const { start, end } = computeWindow(5, 10, 1);
      // Reserved rows clamp to 1, so item window is also 1
      expect(end - start).toBe(1);
      expect(5).toBeGreaterThanOrEqual(start);
      expect(5).toBeLessThan(end);
    });

    test("maxVisible=5 with cursor at boundaries", () => {
      // Item window is max(1, 5 - 2) = 3
      const atStart = computeWindow(0, 20, 5);
      expect(atStart.start).toBe(0);
      expect(atStart.end).toBe(3);

      // Cursor at 19, halfWindow = 1 → start = 18, end = 21 → clamped to 17, 20
      const atEnd = computeWindow(19, 20, 5);
      expect(atEnd.start).toBe(17);
      expect(atEnd.end).toBe(20);
    });

    test("maxVisible=3 reserves at least one item slot (no zero-width window)", () => {
      const { start, end } = computeWindow(0, 10, 3);
      // itemSlots = max(1, 3 - 2) = 1
      expect(end - start).toBe(1);
      expect(start).toBe(0);
      expect(end).toBe(1);
    });

    test("maxVisible=2 still shows the cursor without indicators", () => {
      // Item list fits inside maxVisible, so no windowing kicks in.
      const { start, end } = computeWindow(1, 2, 2);
      expect(start).toBe(0);
      expect(end).toBe(2);
    });
  });
});

describe("MenuList component", () => {
  const makeItems = (count: number): MenuItem[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `item-${i}`,
      label: `Item ${i}`,
      hint: i % 2 === 0 ? "even" : "",
    }));

  test("renders all items for short list (no windowing)", () => {
    const items = makeItems(5);
    const output = renderToString(<MenuList items={items} cursor={2} />);
    
    // All items should be present
    for (let i = 0; i < 5; i++) {
      expect(output).toContain(`Item ${i}`);
    }
    // Cursor indicator should be on item 2
    expect(output).toContain("❯");
  });

  test("renders with maxVisible prop for long list", () => {
    const items = makeItems(50);
    const output = renderToString(
      <MenuList items={items} cursor={25} maxVisible={10} />
    );

    // Should show scroll indicators
    expect(output).toContain("…");

    // Cursor item should be visible
    expect(output).toContain("Item 25");

    // Items far from cursor should not be visible.
    // With maxVisible=10, the item window is 8 wide and centered on the
    // cursor → start=21, end=29.
    expect(output).not.toContain("Item 0");
    expect(output).not.toContain("Item 49");
  });

  test("cursor at start shows only bottom indicator", () => {
    const items = makeItems(50);
    const output = renderToString(
      <MenuList items={items} cursor={0} maxVisible={10} />
    );
    
    // Should have bottom indicator but not top
    // Count occurrences of "…" - should be 1 (only bottom)
    const ellipsisCount = (output.match(/…/g) || []).length;
    expect(ellipsisCount).toBe(1);
    
    // First item should be visible
    expect(output).toContain("Item 0");
  });

  test("cursor at end shows only top indicator", () => {
    const items = makeItems(50);
    const output = renderToString(
      <MenuList items={items} cursor={49} maxVisible={10} />
    );
    
    // Should have top indicator but not bottom
    const ellipsisCount = (output.match(/…/g) || []).length;
    expect(ellipsisCount).toBe(1);
    
    // Last item should be visible
    expect(output).toContain("Item 49");
  });

  test("cursor in middle shows both indicators", () => {
    const items = makeItems(50);
    const output = renderToString(
      <MenuList items={items} cursor={25} maxVisible={10} />
    );
    
    // Should have both top and bottom indicators
    const ellipsisCount = (output.match(/…/g) || []).length;
    expect(ellipsisCount).toBe(2);
  });

  test("multiselect mode preserves checkbox rendering", () => {
    const items: MenuItem[] = [
      { id: "a", label: "Item A", checked: true },
      { id: "b", label: "Item B", checked: false },
      { id: "c", label: "Item C", checked: true },
    ];
    const output = renderToString(
      <MenuList items={items} cursor={1} multiselect />
    );
    
    expect(output).toContain("[x]");
    expect(output).toContain("[ ]");
    expect(output).toContain("❯");
  });

  test("hints are rendered when present", () => {
    const items: MenuItem[] = [
      { id: "a", label: "Item A", hint: "hint-a" },
      { id: "b", label: "Item B", hint: "" },
    ];
    const output = renderToString(<MenuList items={items} cursor={0} />);
    
    expect(output).toContain("hint-a");
  });

  test("empty list renders without error", () => {
    const output = renderToString(<MenuList items={[]} cursor={0} />);
    // Should render empty box without crashing
    expect(output).toBeDefined();
  });
});

describe("MenuList visual stability for long lists", () => {
  // Regression tests for the user-reported "selector disappears / items
  // appear and disappear while navigating" bug. The fix reserves two
  // indicator rows when windowing is active so the rendered list height
  // is constant and the cursor's visual position never jumps.

  const makeItems = (count: number): MenuItem[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `item-${i}`,
      label: `Model ${i}`,
    }));

  function countRenderedRows(output: string): number {
    // Each row is separated by a newline; filter out empty trailing lines.
    return output.split("\n").filter((line) => line.length > 0).length;
  }

  function findCursorLine(output: string): { index: number; label: string } | null {
    const lines = output.split("\n").filter((line) => line.length > 0);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("❯")) {
        return { index: i, label: line };
      }
    }
    return null;
  }

  test("total rendered row count is constant across navigation in a long list", () => {
    const items = makeItems(50);
    const maxVisible = 10;

    // Sweep the cursor across the entire list and check that the row
    // count never changes — this is the symptom the user reported.
    const counts: number[] = [];
    for (let cursor = 0; cursor < 50; cursor++) {
      const output = renderToString(
        <MenuList items={items} cursor={cursor} maxVisible={maxVisible} />,
      );
      counts.push(countRenderedRows(output));
    }

    const unique = new Set(counts);
    expect(unique.size).toBe(1);
    // Sanity: should equal maxVisible (8 items + 2 indicator slots).
    expect(counts[0]).toBe(maxVisible);
  });

  test("cursor is always visible at every position in a long list", () => {
    const items = makeItems(50);
    const maxVisible = 10;

    for (let cursor = 0; cursor < 50; cursor++) {
      const output = renderToString(
        <MenuList items={items} cursor={cursor} maxVisible={maxVisible} />,
      );
      expect(output).toContain(`❯ Model ${cursor}`);
    }
  });

  test("cursor row position stays stable when entering the windowing range", () => {
    // Specifically the regression: cursor=5 → cursor=6 used to make the
    // list grow by one row because the top indicator appeared, causing
    // the cursor to "jump" down and items above it to vanish.
    const items = makeItems(50);
    const maxVisible = 10;

    const beforeOutput = renderToString(
      <MenuList items={items} cursor={5} maxVisible={maxVisible} />,
    );
    const afterOutput = renderToString(
      <MenuList items={items} cursor={6} maxVisible={maxVisible} />,
    );

    const beforeRows = countRenderedRows(beforeOutput);
    const afterRows = countRenderedRows(afterOutput);
    expect(beforeRows).toBe(afterRows);

    const beforeCursor = findCursorLine(beforeOutput);
    const afterCursor = findCursorLine(afterOutput);
    expect(beforeCursor).not.toBeNull();
    expect(afterCursor).not.toBeNull();
    // Cursor's row position should not shift when crossing into the
    // windowing range.
    expect(afterCursor!.index).toBe(beforeCursor!.index);
  });

  test("items above the cursor stay anchored when the window scrolls forward", () => {
    // The previously selected item should still appear one row above
    // the cursor immediately after navigating forward — it should not
    // vanish or be hidden.
    const items = makeItems(50);
    const maxVisible = 10;

    const cursorLineBefore = renderToString(
      <MenuList items={items} cursor={10} maxVisible={maxVisible} />,
    );
    const cursorLineAfter = renderToString(
      <MenuList items={items} cursor={11} maxVisible={maxVisible} />,
    );

    expect(cursorLineBefore).toContain("Model 10");
    expect(cursorLineAfter).toContain("Model 10");
    expect(cursorLineAfter).toContain("Model 11");
  });

  test("visible labels match the expected window slice for cursor deep in the list", () => {
    // Cursor beyond the first page must still render the selected item
    // — and only items within the computed window must be visible.
    const items = makeItems(50);
    const maxVisible = 10;
    const cursor = 30;

    const output = renderToString(
      <MenuList items={items} cursor={cursor} maxVisible={maxVisible} />,
    );

    // Cursor item is visible.
    expect(output).toContain("Model 30");

    // Item window with maxVisible=10 → 8 items, halfWindow=4 → start=26, end=34
    for (let i = 26; i < 34; i++) {
      expect(output).toContain(`Model ${i}`);
    }

    // Items outside the window are not rendered.
    expect(output).not.toContain("Model 0");
    expect(output).not.toContain("Model 49");
    expect(output).not.toContain("Model 25");
    expect(output).not.toContain("Model 35");
  });

  test("indicators do not break global cursor alignment", () => {
    // The bug class described: "comparing local slice index to global
    // cursor". After the fix, the indicator rows must never be confused
    // with item rows when matching the cursor — every cursor must map to
    // exactly one matching item label.
    const items = makeItems(50);
    const maxVisible = 10;

    for (let cursor = 0; cursor < 50; cursor++) {
      const output = renderToString(
        <MenuList items={items} cursor={cursor} maxVisible={maxVisible} />,
      );
      // Exactly one ❯ token in the rendered output.
      const cursorMarkers = (output.match(/❯/g) || []).length;
      expect(cursorMarkers).toBe(1);
      // And it precedes the correct item label.
      const cursorIdx = output.indexOf("❯");
      const labelIdx = output.indexOf(`Model ${cursor}`);
      expect(cursorIdx).toBeGreaterThanOrEqual(0);
      expect(labelIdx).toBeGreaterThan(cursorIdx);
    }
  });

  test("short lists keep their original layout (no indicator slots reserved)", () => {
    // When windowing is not active, no rows should be reserved for
    // indicators — short lists must look exactly as before.
    const items = makeItems(5);
    const output = renderToString(<MenuList items={items} cursor={2} />);

    // No ellipsis at all on a short list.
    expect((output.match(/…/g) || []).length).toBe(0);
    // Every item is rendered. makeItems in this block uses `Model ${i}`.
    for (let i = 0; i < 5; i++) {
      expect(output).toContain(`Model ${i}`);
    }
    // Row count equals item count (no padding).
    expect(countRenderedRows(output)).toBe(5);
  });

  test("placeholder rows use zero-width space (not trimmed to empty)", () => {
    // Regression: the cursor "disappearing" while navigating long lists
    // was caused by Ink's Output.get() applying trimEnd() to each line.
    // A regular space (" ") placeholder was trimmed to "", which made
    // the joined output end with "\n" — Ink's log-update then over-erased
    // by one line on the next render, shifting the whole list.
    // The fix uses U+200B (zero-width space) which survives trimEnd.
    const items = makeItems(50);
    const maxVisible = 10;

    // Cursor at top: top placeholder is blank (ZWSP), bottom is "…"
    const topOutput = renderToString(
      <MenuList items={items} cursor={0} maxVisible={maxVisible} />,
    );
    // Output must NOT end with "\n" (trailing indicator is "…", non-empty).
    expect(topOutput.endsWith("\n")).toBe(false);
    // Output must NOT start with "\n" (leading placeholder is ZWSP, non-empty).
    expect(topOutput.startsWith("\n")).toBe(false);

    // Cursor at bottom: top is "…", bottom placeholder is blank (ZWSP)
    const bottomOutput = renderToString(
      <MenuList items={items} cursor={49} maxVisible={maxVisible} />,
    );
    // Output must NOT end with "\n" — the ZWSP placeholder is non-empty.
    expect(bottomOutput.endsWith("\n")).toBe(false);

    // All rendered lines are non-empty (no empty strings between \n).
    const bottomLines = bottomOutput.split("\n");
    for (const line of bottomLines) {
      expect(line.length).toBeGreaterThan(0);
    }
  });

  test("cursor out of range still renders the selector (defensive clamp)", () => {
    // If the parent passes a stale cursor (e.g. after async model list
    // shrinkage), the selector must still appear on a valid item rather
    // than vanishing entirely.
    const items = makeItems(5);
    const output = renderToString(<MenuList items={items} cursor={999} />);
    // Exactly one selector marker, on the last item.
    expect((output.match(/❯/g) || []).length).toBe(1);
    expect(output).toContain("❯ Model 4");

    const negativeOutput = renderToString(<MenuList items={items} cursor={-3} />);
    expect((negativeOutput.match(/❯/g) || []).length).toBe(1);
    expect(negativeOutput).toContain("❯ Model 0");
  });

  test("empty list does not render a selector", () => {
    const output = renderToString(<MenuList items={[]} cursor={0} />);
    expect(output).toBeDefined();
    expect((output.match(/❯/g) || []).length).toBe(0);
  });
});

describe("MenuList row truncation under narrow columns", () => {
  // Regression tests for the residual cursor-disappearance bug. Even with
  // the ZWSP placeholder + safeCursor clamp + reserved indicator slots in
  // place, long rows (label + hint) still wrapped into multiple physical
  // lines because Ink's <Text> defaults to `wrap="wrap"`. MenuList windowing
  // assumes exactly one rendered line per item, so when a long row entered
  // or left the visible window the rendered row count shifted and the cursor
  // visually "disappeared". The fix sets `wrap="truncate"` on the item <Text>
  // so each row collapses to a single line with a `…` overflow indicator.

  // Long label + long hint that easily exceed a narrow terminal.
  const makeLongItems = (count: number): MenuItem[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `m-${i}`,
      label: `Model ${i} — Some Long Display Name That Goes On`,
      hint:
        i % 2 === 0
          ? "(context: 1M tokens, vision, extended-thinking, tool-use)"
          : "",
    }));

  // Short items used to prove short lists are untouched by the truncation
  // behavior — they must render identically regardless of `wrap`.
  const makeShortItems = (count: number): MenuItem[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `s-${i}`,
      label: `Item ${i}`,
      hint: i % 2 === 0 ? "even" : "odd",
    }));

  function countRenderedRows(output: string): number {
    return output.split("\n").filter((line) => line.length > 0).length;
  }

  test("long labels/hints do not wrap into extra rows under narrow columns", () => {
    const items = makeLongItems(20);
    const output = renderToString(
      <MenuList items={items} cursor={5} maxVisible={10} />,
      { columns: 30 },
    );

    // With maxVisible=10 and windowing active, the rendered row count must
    // equal 10 (8 items + 2 indicator slots). If any row wrapped, the count
    // would exceed 10.
    expect(countRenderedRows(output)).toBe(10);

    // No line should contain a wrapped fragment that starts without the
    // expected prefix (cursor marker or space). Every rendered item line
    // begins with either "❯" or "  " (two-space indent for non-cursor).
    const itemLines = output
      .split("\n")
      .filter((l) => l.length > 0 && l !== "…")
      .filter((l) => l.includes("Model"));
    for (const line of itemLines) {
      expect(line.startsWith("❯") || line.startsWith("  ")).toBe(true);
    }
  });

  test("row count stays stable while cursor moves through a long list under narrow columns", () => {
    const items = makeLongItems(30);
    const maxVisible = 10;

    const counts: number[] = [];
    for (let cursor = 0; cursor < items.length; cursor++) {
      const output = renderToString(
        <MenuList items={items} cursor={cursor} maxVisible={maxVisible} />,
        { columns: 30 },
      );
      counts.push(countRenderedRows(output));
    }

    // Row count must never change across the entire cursor sweep — this is
    // the exact symptom the residual fix targets.
    const unique = new Set(counts);
    expect(unique.size).toBe(1);
    expect(counts[0]).toBe(maxVisible);
  });

  test("cursor marker appears exactly once for every cursor position under narrow columns", () => {
    const items = makeLongItems(20);

    for (let cursor = 0; cursor < items.length; cursor++) {
      const output = renderToString(
        <MenuList items={items} cursor={cursor} maxVisible={10} />,
        { columns: 30 },
      );
      const markers = (output.match(/❯/g) || []).length;
      expect(markers).toBe(1);
      // The single marker must precede the cursor's own label.
      const cursorIdx = output.indexOf("❯");
      const labelIdx = output.indexOf(`Model ${cursor}`);
      expect(cursorIdx).toBeGreaterThanOrEqual(0);
      expect(labelIdx).toBeGreaterThan(cursorIdx);
    }
  });

  test("truncation indicator appears for long rows under narrow columns", () => {
    const items = makeLongItems(10);
    const output = renderToString(
      <MenuList items={items} cursor={0} maxVisible={10} />,
      { columns: 30 },
    );

    // Under columns=30 the long labels overflow, so `wrap="truncate"` must
    // append the `…` overflow indicator to truncated rows. At least one
    // item row should be truncated (the cursor row itself is long enough).
    // Distinguish item-row truncation markers from the windowing scroll
    // indicator (which appears on its own line as exactly "…").
    const lines = output.split("\n");
    const itemLines = lines.filter((l) => l.includes("Model"));
    const truncatedItemLines = itemLines.filter((l) => l.endsWith("…"));
    expect(truncatedItemLines.length).toBeGreaterThan(0);

    // Every truncated item line must be exactly one physical line (no
    // wrapped continuation). A truncated line ends with "…" and the next
    // line must NOT be a continuation fragment — it must be a new item or
    // an indicator.
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].endsWith("…") && lines[i].includes("Model")) {
        const next = lines[i + 1];
        // Next line is either an indicator, another item, or absent.
        if (next !== undefined) {
          const isIndicator = next === "…" || next.length === 0;
          const isItem = next.includes("Model");
          expect(isIndicator || isItem).toBe(true);
        }
      }
    }
  });

  test("truncation preserves the cursor label fragment under narrow columns", () => {
    // Even when a row is truncated, the cursor must still point at a row
    // whose label fragment is recognizable — the `❯` marker and the start
    // of the model label must survive truncation.
    const items = makeLongItems(10);
    const output = renderToString(
      <MenuList items={items} cursor={3} maxVisible={10} />,
      { columns: 30 },
    );
    expect(output).toContain("❯ Model 3");
  });

  test("short lists remain unchanged under narrow columns (no truncation, no wrapping)", () => {
    // Short items that fit within narrow columns must render exactly as
    // before — one row per item, no truncation marker on item lines, and
    // no windowing indicators.
    const items = makeShortItems(5);
    const output = renderToString(
      <MenuList items={items} cursor={2} />,
      { columns: 30 },
    );

    // No windowing indicators (list fits entirely).
    expect((output.match(/…/g) || []).length).toBe(0);
    // Row count equals item count.
    expect(countRenderedRows(output)).toBe(5);
    // Every item label is fully present (not truncated).
    for (let i = 0; i < 5; i++) {
      expect(output).toContain(`Item ${i}`);
    }
    // Hints are fully present (short hints fit within columns).
    expect(output).toContain("even");
    expect(output).toContain("odd");
  });

  test("long label with no hint also truncates to one row under narrow columns", () => {
    // A row with a long label but no hint must still collapse to a single
    // line — the wrap setting applies to the whole row regardless of hint.
    const items: MenuItem[] = [
      { id: "a", label: "A".repeat(60) },
      { id: "b", label: "short" },
      { id: "c", label: "C".repeat(60) },
    ];
    const output = renderToString(
      <MenuList items={items} cursor={0} />,
      { columns: 20 },
    );

    // 3 items, no windowing → exactly 3 rendered rows.
    expect(countRenderedRows(output)).toBe(3);
    // Truncated long rows end with "…".
    expect(output).toContain("…");
    // Short row is fully present.
    expect(output).toContain("short");
  });

  test("row count is stable when a long row enters the window under narrow columns", () => {
    // Directly targets the reported regression: as the cursor moves and a
    // long row enters the visible window, the row count must not jump.
    const items: MenuItem[] = [
      { id: "s0", label: "short 0" },
      { id: "s1", label: "short 1" },
      ...Array.from({ length: 18 }, (_, i) => ({
        id: `l${i}`,
        label: `Long model ${i} — ${"X".repeat(40)}`,
        hint: "",
      })),
    ];

    const counts: number[] = [];
    for (let cursor = 0; cursor < items.length; cursor++) {
      const output = renderToString(
        <MenuList items={items} cursor={cursor} maxVisible={8} />,
        { columns: 25 },
      );
      counts.push(countRenderedRows(output));
    }
    const unique = new Set(counts);
    expect(unique.size).toBe(1);
    expect(counts[0]).toBe(8);
  });
});
