import { describe, it, expect, vi } from "vitest";
import { apiError } from "./api-error";

describe("apiError", () => {
  it("returns a short message and code without RPC url, params or versions", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error('HTTP request failed. URL: https://hadrian.example/ Request body: {"method":"eth_getLogs"} Version: viem@2.0.0');
    const res = apiError("/api/history", err);
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.code).toBe("upstream_error");
    expect(JSON.stringify(body)).not.toMatch(/https?:|eth_getLogs|viem/);
  });
  it("maps rate-limit errors to upstream_busy", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = apiError("/api/history", new Error("Request exceeds defined limit: too many concurrent log queries"));
    expect((await res.json()).code).toBe("upstream_busy");
    expect(res.status).toBe(503);
  });
});
