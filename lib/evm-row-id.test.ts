import { describe, expect, it } from "vitest";
import { evmRowId } from "@/utils/wallet";

describe("evmRowId (the wallet list's row for a connector)", () => {
  it("maps an EIP-6963 MetaMask connector to the known MetaMask row", () => {
    expect(evmRowId({ id: "io.metamask", name: "MetaMask" })).toBe("evm-metamask");
  });
  it("maps the WalletConnect connector to its own known row", () => {
    expect(evmRowId({ id: "walletConnect", name: "WalletConnect" })).toBe("walletConnect");
  });
  it("keeps the connector's own id for a wallet the app does not know", () => {
    expect(evmRowId({ id: "com.example.unknown", name: "Zzyzx Wallet" })).toBe("com.example.unknown");
  });
});
