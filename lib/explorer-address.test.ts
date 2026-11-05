import { describe, expect, it } from "vitest";
import { DEFAULT_CHAIN_ID, evmExplorerAddressUrl, solanaExplorerAddressUrl } from "@/lib/registry-config";

describe("explorer address links (the account menu)", () => {
  it("links an EVM address on the chain's explorer, without a double slash", () => {
    const url = evmExplorerAddressUrl(DEFAULT_CHAIN_ID, "0xabc");
    expect(url).toMatch(/\/address\/0xabc$/);
    expect(url).not.toMatch(/[^:]\/\/address/);
  });

  it("links a Solana key on the anchored cluster", () => {
    const url = solanaExplorerAddressUrl(DEFAULT_CHAIN_ID, "KeyKeyKey");
    expect(url).toMatch(/\/address\/KeyKeyKey\?cluster=/);
  });

  it("returns nothing for a chain that is not in the registry", () => {
    expect(evmExplorerAddressUrl(1, "0xabc")).toBeUndefined();
    expect(solanaExplorerAddressUrl(1, "KeyKeyKey")).toBeUndefined();
  });
});
