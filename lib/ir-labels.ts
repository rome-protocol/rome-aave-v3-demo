// Geometry and label placement for the rate chart (viewBox units). The
// "Current" and "U_opt" labels sit above their dots, never below the plot
// floor, past the plot edges, over each other or over the plotted curve. The
// curve only rises, so the U_opt label goes left of the kink line, where the
// curve is lower than the label.

export const IR = { W: 720, H: 252, padL: 50, padR: 16, padT: 32, padB: 46 } as const;
const innerW = IR.W - IR.padL - IR.padR;
const innerH = IR.H - IR.padT - IR.padB;
const FONT_CUR = 11;
const FONT_KINK = 10;
const CHAR_W = 0.6; // mono width per char, in em

export type Anchor = "start" | "end";
export type IrBox = { x0: number; x1: number; y0: number; y1: number };
export type IrLabel = { x: number; y: number; anchor: Anchor; box: IrBox };

export function textBox(x: number, y: number, anchor: Anchor, text: string, fs: number): IrBox {
  const w = text.length * fs * CHAR_W;
  const x0 = anchor === "start" ? x : x - w;
  return { x0, x1: x0 + w, y0: y - fs * 0.8, y1: y + fs * 0.2 };
}

export function boxesOverlap(a: IrBox, b: IrBox): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

const inPlot = (b: IrBox) =>
  b.x0 >= IR.padL && b.x1 <= IR.W - IR.padR && b.y1 <= IR.padT + innerH && b.y0 >= 14;

export const CURVE_CLEARANCE = 3;

export function irLayout(
  p: { cur: number; uOpt: number; slope1: number; slope2: number },
  curText: string,
  kinkText: string,
) {
  const maxRate = p.slope1 + p.slope2 + 0.04;
  const rateAt = (u: number) =>
    u <= p.uOpt ? (u / p.uOpt) * p.slope1 : p.slope1 + ((u - p.uOpt) / (1 - p.uOpt)) * p.slope2;
  const xOf = (u: number) => IR.padL + u * innerW;
  const yOf = (u: number) => IR.padT + innerH - (rateAt(u) / maxRate) * innerH;
  const curX = xOf(p.cur), curY = yOf(p.cur);
  const kinkX = xOf(p.uOpt), kinkY = yOf(p.uOpt);

  // Each label's options: above its dot, on the allowed sides, then higher up.
  const opts = (x: number, y: number, text: string, fs: number, sides: Anchor[]): IrLabel[] => {
    const out: IrLabel[] = [];
    for (const dy of [-10, -24, -38]) {
      for (const anchor of sides) {
        const lx = anchor === "start" ? x + 8 : x - 8;
        out.push({ x: lx, y: y + dy, anchor, box: textBox(lx, y + dy, anchor, text, fs) });
      }
    }
    return out;
  };
  // Current goes away from the kink when it can; U_opt only goes left of its line.
  const curSides: Anchor[] = p.cur > p.uOpt ? ["start", "end"] : ["end", "start"];
  const curOpts = opts(curX, curY, curText, FONT_CUR, curSides);
  const kinkOpts = opts(kinkX, kinkY, kinkText, FONT_KINK, ["end"]);
  const curve: Array<[number, number]> = [];
  for (let i = 0; i <= 200; i++) curve.push([xOf(i / 200), yOf(i / 200)]);
  const clearOfCurve = (b: IrBox) =>
    !curve.some(([x, y]) =>
      x >= b.x0 - CURVE_CLEARANCE && x <= b.x1 + CURVE_CLEARANCE &&
      y >= b.y0 - CURVE_CLEARANCE && y <= b.y1 + CURVE_CLEARANCE);
  const dots = [
    { x0: curX - 5, x1: curX + 5, y0: curY - 5, y1: curY + 5 },
    { x0: kinkX - 3, x1: kinkX + 3, y0: kinkY - 3, y1: kinkY + 3 },
  ];
  const title = textBox(12, 12, "start", "BORROW APY", 10);
  const ok = (c: IrLabel, k: IrLabel) =>
    inPlot(c.box) && inPlot(k.box) && clearOfCurve(c.box) && clearOfCurve(k.box) && !boxesOverlap(c.box, k.box) &&
    ![c.box, k.box].some((b) => boxesOverlap(b, title) || dots.some((d) => boxesOverlap(b, d)));
  let best: [IrLabel, IrLabel] | null = null;
  outer: for (const c of curOpts) for (const k of kinkOpts) if (ok(c, k)) { best = [c, k]; break outer; }
  const [current, kink] = best ?? [curOpts[0], kinkOpts[0]];
  return { maxRate, rateAt, xOf, yOf, curX, curY, kinkX, kinkY, current, kink, dots, title, curve, clearOfCurve, placed: best !== null };
}
