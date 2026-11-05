import { describe, it, expect, afterEach, vi } from "vitest";
import { createAutoConnectOnce, readStoredSolanaWallet } from "./solanaAutoConnect";

describe("createAutoConnectOnce", () => {
  it("reconnects the stored wallet once on load", async () => {
    const gate = createAutoConnectOnce("Phantom");
    expect(await gate({ name: "Phantom" })).toBe(true);
    expect(await gate({ name: "Phantom" })).toBe(false);
  });

  it("never auto-connects a wallet picked by a click (different from the stored one)", async () => {
    const gate = createAutoConnectOnce("Phantom");
    expect(await gate({ name: "Solflare" })).toBe(false);
    // the stored wallet is still allowed afterwards
    expect(await gate({ name: "Phantom" })).toBe(true);
  });

  it("never auto-connects when nothing was stored (first click is a user connect)", async () => {
    const gate = createAutoConnectOnce(null);
    expect(await gate({ name: "Phantom" })).toBe(false);
  });
});

describe("readStoredSolanaWallet", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stub = (value: string | null | Error) =>
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          if (value instanceof Error) throw value;
          return value;
        },
      },
    });

  it("reads the JSON-encoded name", () => {
    stub('"Phantom"');
    expect(readStoredSolanaWallet()).toBe("Phantom");
  });

  it("returns null for missing, malformed or blocked storage", () => {
    stub(null);
    expect(readStoredSolanaWallet()).toBeNull();
    stub("not json");
    expect(readStoredSolanaWallet()).toBeNull();
    stub(new Error("blocked"));
    expect(readStoredSolanaWallet()).toBeNull();
  });
});
