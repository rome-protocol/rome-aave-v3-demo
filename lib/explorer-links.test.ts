import { describe, it, expect } from "vitest";
import { addressHref, txHref } from "./explorer-links";
import { bridgeUiUrl } from "./registry-config";
import hadrianChain from "./hadrian-chain.json";

const EVM = "https://via.example/tx/${hash}";
const SOL = "https://explorer.solana.com/tx/${sig}?cluster=devnet";

describe("explorer links", () => {
  it("tokens open the address page, transactions the tx page", () => {
    expect(addressHref(EVM, "0xabc")).toBe("https://via.example/address/0xabc");
    expect(txHref(EVM, "0xdef")).toBe("https://via.example/tx/0xdef");
  });

  it("handles the Solana ${sig} template", () => {
    expect(addressHref(SOL, "Mint1")).toBe("https://explorer.solana.com/address/Mint1?cluster=devnet");
    expect(txHref(SOL, "5sig")).toBe("https://explorer.solana.com/tx/5sig?cluster=devnet");
  });

  it("returns undefined without a template", () => {
    expect(addressHref("", "x")).toBeUndefined();
    expect(txHref("", "x")).toBeUndefined();
  });

  it("points the bridge at the bridge-api host", () => {
    expect(bridgeUiUrl(hadrianChain.chainId)).toBe("https://bridge-api.devnet.romeprotocol.xyz");
    expect(bridgeUiUrl(1)).toBe("");
  });
});
