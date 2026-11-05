// Search of the token picker: a typed word matches a token's symbol, name or address; a pasted address is told apart from a word.

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** True for a string that has the shape of a Solana address (base58, 32 to 44 characters). */
export function looksLikeAddress(text) {
  return ADDRESS.test(String(text ?? "").trim());
}

/** True for a text that was meant as an address: no spaces and at least 32 characters (the read then says whether it is a real one). */
export function looksPasted(text) {
  const t = String(text ?? "").trim();
  return t.length >= 32 && !/\s/.test(t);
}

/** The tokens whose symbol, name or address contains the typed text (case does not matter); every token for an empty box. Order is kept. */
export function filterTokens(tokens, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return tokens;
  return tokens.filter((t) => t.symbol.toLowerCase().includes(q) || (t.name ?? "").toLowerCase().includes(q) || t.mint.toLowerCase() === q || (q.length >= 4 && t.mint.toLowerCase().startsWith(q)));
}
