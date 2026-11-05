import { describe, expect, it } from "vitest";
import { feedAgeLabel, feedAgeMs } from "./feed-age";

describe("feed age", () => {
  const t = Date.parse("2026-11-05T12:00:00Z");
  it("is the server's age plus the time since the answer arrived, never negative, null when missing or bad", () => {
    expect(feedAgeMs(10, t, t)).toBe(10_000);
    expect(feedAgeMs(10, t, t + 4_000)).toBe(14_000);
    expect(feedAgeMs(10, t, t - 5_000)).toBe(10_000); // a clock that stepped back
    expect(feedAgeMs(undefined, t, t)).toBeNull();
    expect(feedAgeMs(Number.NaN, t, t)).toBeNull();
    expect(feedAgeMs(5, 0, t)).toBeNull(); // nothing received yet
  });
  it("labels seconds, then minutes", () => {
    expect(feedAgeLabel(4_200)).toBe("4s ago");
    expect(feedAgeLabel(59_999)).toBe("59s ago");
    expect(feedAgeLabel(125_000)).toBe("2m ago");
  });
});
