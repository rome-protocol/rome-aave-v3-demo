import { describe, expect, it } from "vitest";
import { fmtShare } from "./format";
import { boxesOverlap, irLayout, type IrBox } from "./ir-labels";

const sets = [
  { name: "live", uOpt: 0.8, slope1: 0.04, slope2: 0.75 },
  { name: "stable", uOpt: 0.9, slope1: 0.065, slope2: 0.6 },
];

describe("rate chart labels", () => {
  for (const s of sets) {
    it(`no overlaps for u = 0..1 (${s.name})`, () => {
      for (let i = 0; i <= 100; i++) {
        const cur = i / 100;
        const L = irLayout({ cur, ...s }, `Current · ${fmtShare(cur * 100)}`, `U_opt = ${Math.round(s.uOpt * 100)}%`);
        const boxes: Record<string, IrBox> = { cur: L.current.box, kink: L.kink.box, title: L.title };
        L.dots.forEach((d, j) => (boxes[`dot${j}`] = d));
        const names = Object.keys(boxes);
        for (let a = 0; a < names.length; a++) {
          for (let b = a + 1; b < names.length; b++) {
            if (names[a].startsWith("dot") && names[b].startsWith("dot")) continue;
            expect(boxesOverlap(boxes[names[a]], boxes[names[b]]), `${names[a]} vs ${names[b]} at u=${cur}`).toBe(false);
          }
        }
        expect(L.placed, `a placement exists at u=${cur}`).toBe(true);
        // The plotted curve never runs through either label.
        expect(L.clearOfCurve(L.current.box), `curve vs current at u=${cur}`).toBe(true);
        expect(L.clearOfCurve(L.kink.box), `curve vs kink at u=${cur}`).toBe(true);
        // Never below the plot floor (206); the x-axis ticks start below it.
        expect(L.current.box.y1).toBeLessThanOrEqual(206);
        expect(L.kink.box.y1).toBeLessThanOrEqual(206);
        expect(L.current.box.x0).toBeGreaterThanOrEqual(50);
        expect(L.current.box.x1).toBeLessThanOrEqual(704);
      }
    });
  }
});
