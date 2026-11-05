import { describe, expect, it, vi } from "vitest";

import { premiumFraction, readFlashPremiumBps } from "./flash-premium";

const POOL = "0x81e7e7e4cBC2b5a55C2dE1d3dFCf87C0cF867520" as const;

describe("flash premium", () => {
  it("reads FLASHLOAN_PREMIUM_TOTAL from the pool (0 today)", async () => {
    const readContract = vi.fn().mockResolvedValue(0n);
    await expect(readFlashPremiumBps({ readContract }, POOL)).resolves.toBe(0);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: POOL, functionName: "FLASHLOAN_PREMIUM_TOTAL" }),
    );
  });

  it("follows the pool when governance raises it", async () => {
    const readContract = vi.fn().mockResolvedValue(9n);
    const bps = await readFlashPremiumBps({ readContract }, POOL);
    expect(bps).toBe(9);
    expect(premiumFraction(bps)).toBe(0.0009);
  });
});
