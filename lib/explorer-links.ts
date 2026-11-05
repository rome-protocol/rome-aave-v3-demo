// Explorer links built from the chain's tx templates (`…/tx/${hash}` for the
// EVM explorer, `…/tx/${sig}?cluster=…` for Solana).

/** The tx page for a hash / signature. */
export function txHref(template: string, id: string): string | undefined {
  if (!template) return undefined;
  return template.replace("${hash}", id).replace("${sig}", id);
}

/** The address page (a token contract, an aToken, a Solana mint). */
export function addressHref(template: string, address: string): string | undefined {
  if (!template) return undefined;
  const swapped = template.replace(/\/tx\/\$\{(hash|sig)\}/, `/address/${address}`);
  return swapped === template ? `${template.replace(/\/$/, "")}/address/${address}` : swapped;
}
