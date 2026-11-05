"use client";

// Shared low-level UI primitives. Inline-style components reading from
// the CSS-variable tokens defined in app/styles.css, re-pointed by app/aave-look.css — no Tailwind.

import {
  useState,
  type CSSProperties,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { fmt } from "@/lib/format";
import { NETWORK_LABEL, NETWORK_TAG } from "@/lib/brand";
import { Tip } from "@/components/Tip";
import {
  IconAlert,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconExternal,
  IconWallet,
} from "@/components/icons";
import { TokenIcon } from "@/components/TokenIcon";
import { useAssetIdentity } from "@/hooks/useAssetIdentity";

// ────────────── Eyebrow + Hairline ──────────────

export const Eyebrow = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div className="eyebrow" style={style}>{children}</div>
);

export const Hairline = ({ style }: { style?: CSSProperties }) => (
  <div className="hairline" style={style} />
);

// ────────────── Button ──────────────

type ButtonVariant = "primary" | "primaryAlt" | "secondary" | "ghost" | "danger" | "success";
type ButtonSize = "xs" | "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

export const Button = ({
  variant = "primary",
  size = "md",
  fullWidth,
  children,
  className,
  style: extraStyle,
  ...rest
}: ButtonProps) => {
  // Colour, edge and hover come from the Rome app look (.btn, .btn.ghost, .btn.block in globals.css and theme.css);
  // only size and layout are set here. The one loud primary is the full-width block button and the header Connect button.
  const base: CSSProperties = {
    fontFamily: "var(--font-sans)",
    fontWeight: 500,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: fullWidth ? "100%" : undefined,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
  const sizes: Record<ButtonSize, CSSProperties> = {
    xs: { padding: "4px 10px", fontSize: 12, height: 26 },
    sm: { padding: "6px 14px", fontSize: 13, height: 30 },
    md: { padding: "8px 18px", fontSize: 14, height: 36 },
    lg: { padding: "12px 22px", fontSize: 15, height: 46 },
  };
  const variants: Record<ButtonVariant, CSSProperties> = {
    primary:    {},
    primaryAlt: {},
    secondary:  {},
    ghost:      {},
    danger:     { color: "var(--down)", borderColor: "var(--down)" },
    success:    { color: "var(--up-text)", borderColor: "var(--up-line)", background: "linear-gradient(var(--up-dim), var(--up-dim)), var(--panel-2)" },
  };
  const secondary = variant === "secondary" || variant === "ghost" || variant === "danger" || variant === "success";
  const classes = [
    "btn",
    secondary ? "ghost" : "",
    fullWidth && !secondary ? "block" : "",
    className ?? "",
  ].filter(Boolean).join(" ");
  const style: CSSProperties = { ...base, ...sizes[size], ...variants[variant] };
  if (rest.disabled) style.opacity = 0.45;

  return (
    <button {...rest} className={classes} style={{ ...style, ...(extraStyle || {}) }}>
      {children}
    </button>
  );
};

// ────────────── AssetSymbol ──────────────

export const AssetSymbol = ({
  symbol,
  size = 22,
  showName = false,
  name,
}: {
  symbol: string;
  size?: number;
  showName?: boolean;
  name?: string;
}) => {
  // By mint, and by lane: a Solana wallet sees the Solana name ("SOL", "Solana"), anything else the wrapper's (hooks/useAssetIdentity.ts).
  const id = useAssetIdentity(symbol, name);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <TokenIcon symbol={id.symbol} mint={id.mint} size={size} />
      <span className="sym-label" style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.15, minWidth: 0 }}>
        <span style={{ fontWeight: 500, color: "inherit", letterSpacing: "-0.005em" }}>{id.symbol}</span>
        {showName && id.name ? <span style={{ fontSize: 11, color: "var(--fg2)" }}>{id.name}</span> : null}
      </span>
    </span>
  );
};

// ────────────── HealthFactorPill ──────────────
// Spec §7c — 4 tiers. Hidden when no debt (HF = ∞).

interface HFTierStyle {
  key: "safe" | "warn" | "risk" | "danger";
  label: string;
  color: string;
  bg: string;
}

export function hfTierStyle(hf: number | null | undefined): HFTierStyle | null {
  if (hf === Infinity || hf == null) return null;
  if (hf < 1)   return { key: "danger", label: "Liquidatable", color: "var(--hf-danger)", bg: "var(--hf-danger-bg)" };
  if (hf < 1.5) return { key: "risk",   label: "At risk",      color: "var(--hf-risk)",   bg: "var(--hf-risk-bg)" };
  if (hf < 2)   return { key: "warn",   label: "Warning",      color: "var(--hf-warn)",   bg: "var(--hf-warn-bg)" };
  return        { key: "safe",   label: "Safe",         color: "var(--hf-safe)",   bg: "var(--hf-safe-bg)" };
}

export const HealthFactorPill = ({
  hf,
  size = "md",
  showLabel = true,
  dp = 2,
}: {
  hf: number | null | undefined;
  size?: "sm" | "md";
  showLabel?: boolean;
  dp?: number;
}) => {
  const tier = hfTierStyle(hf);
  if (!tier) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: size === "sm" ? "2px 10px" : "4px 12px",
        borderRadius: "var(--r-pill)",
        border: "1px solid var(--border-default)",
        background: "transparent",
        fontFamily: "var(--font-mono)",
        fontSize: size === "sm" ? 11 : 13,
        color: "var(--fg2)",
      }}>
        <span style={{ width: 6, height: 6, borderRadius: 6, background: "var(--fg3)" }} />
        HF&nbsp;<span style={{ color: "var(--fg1)", fontWeight: 500 }}>∞</span>
      </span>
    );
  }
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: size === "sm" ? "2px 10px" : "4px 12px",
      borderRadius: "var(--r-pill)",
      border: `1px solid ${tier.color}`,
      background: tier.bg,
      fontFamily: "var(--font-mono)",
      fontSize: size === "sm" ? 11 : 13,
      color: tier.color,
      fontVariantNumeric: "tabular-nums",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 6, background: tier.color }} />
      <span className="hf-word">HF&nbsp;</span><span style={{ fontWeight: 600 }}>{fmt.hf(hf, dp)}</span>
      {showLabel ? (
        <span style={{ opacity: 0.85, marginLeft: 4, fontFamily: "var(--font-sans)", fontSize: size === "sm" ? 10 : 11 }}>
          {tier.label}
        </span>
      ) : null}
    </span>
  );
};

// ────────────── AmountInput ──────────────

export const AmountInput = ({
  value,
  onChange,
  suffix,
  onMax,
  balanceLabel,
  balanceValue,
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  onMax?: () => void;
  balanceLabel?: string;
  balanceValue?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) => (
  <div className="amount-row" style={{
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  }}>
    <div style={{
      display: "flex", justifyContent: "space-between",
      fontSize: 11, color: "var(--fg2)",
      fontFamily: "var(--font-mono)",
      letterSpacing: "0.06em", textTransform: "uppercase",
    }}>
      <span>Amount</span>
      {balanceLabel ? (
        <span>
          {balanceLabel}{" "}
          <span className="mono tabular" style={{ color: "var(--fg1)" }}>{balanceValue}</span>
        </span>
      ) : null}
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        placeholder="0.00"
        autoFocus={autoFocus}
        disabled={disabled}
        style={{
          flex: 1, minWidth: 0,
          background: "transparent",
          border: "none", outline: "none",
          color: "var(--fg1)",
          fontFamily: "var(--font-mono)",
          fontSize: 28, fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
          padding: 0,
        }}
      />
      {suffix ? (
        <span style={{ color: "var(--fg2)", fontSize: 15, fontFamily: "var(--font-sans)" }}>{suffix}</span>
      ) : null}
      {onMax ? (
        <button onClick={onMax} disabled={disabled} className="chip" style={{
          fontSize: 11,
          padding: "4px 10px",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}>Max</button>
      ) : null}
    </div>
  </div>
);

// ────────────── AddressRow ──────────────

export const AddressRow = ({
  label,
  address,
  explorerLabel = "Explorer",
  explorerHref,
}: {
  label: string;
  address: string;
  explorerLabel?: string;
  explorerHref?: string;
}) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 0",
      borderBottom: "1px solid var(--border-subtle)",
      gap: 16,
    }}>
      <span style={{ color: "var(--fg2)", fontSize: 13 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="mono" style={{ color: "var(--fg1)", fontSize: 12, letterSpacing: "0.02em" }}>
          {fmt.addr(address, 8, 6)}
        </span>
        <Tip text={copied ? "Copied" : "Copy"} align="end">
          <button onClick={handleCopy} aria-label="Copy" style={{
            background: "transparent",
            border: "1px solid var(--border-default)",
            color: "var(--fg2)", padding: 6, borderRadius: 6,
            display: "inline-flex",
          }}>
            {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
          </button>
        </Tip>
        <Tip text={explorerLabel} align="end">
          <a href={explorerHref || "#"} onClick={(e) => { if (!explorerHref) e.preventDefault(); }}
            target={explorerHref ? "_blank" : undefined} rel={explorerHref ? "noreferrer" : undefined}
            aria-label={explorerLabel}
            style={{ color: "var(--fg2)", textDecoration: "none", border: "1px solid var(--border-default)", padding: 6, borderRadius: 6, display: "inline-flex" }}>
            <IconExternal size={12} />
          </a>
        </Tip>
      </div>
    </div>
  );
};

// ────────────── Transaction details panel ──────────────

export interface SolanaSig {
  label: string;
  status: "confirmed" | "submitted" | "failed" | string;
  sig: string;
}

export const SigRow = ({ sig, index, total }: { sig: SolanaSig; index: number; total: number }) => {
  const dotColor =
    sig.status === "confirmed" ? "var(--hf-safe)" :
    sig.status === "failed"    ? "var(--hf-danger)" :
    sig.status === "submitted" ? "var(--hf-warn)" :
    "var(--fg3)";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "20px 1fr auto", alignItems: "center", gap: 10, padding: "6px 14px", fontSize: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        {index > 0 ? <div style={{ width: 1, height: 6, background: "var(--border-default)" }} /> : <div style={{ height: 6 }} />}
        <div style={{ width: 8, height: 8, borderRadius: 8, background: dotColor }} />
        {index < total - 1 ? <div style={{ width: 1, height: 6, background: "var(--border-default)" }} /> : <div style={{ height: 6 }} />}
      </div>
      <span style={{ color: "var(--fg1)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{sig.label}</span>
      <a href="#" onClick={(e) => e.preventDefault()} style={{
        color: "var(--fg2)", fontFamily: "var(--font-mono)", fontSize: 11,
        textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4,
      }}>
        {sig.sig} <IconExternal size={10} />
      </a>
    </div>
  );
};

// ────────────── Banner ──────────────

type BannerVariant = "warn" | "danger" | "info";

export const Banner = ({
  variant = "warn",
  icon,
  children,
  action,
}: {
  variant?: BannerVariant;
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) => {
  // The message box of the Rome app look: .note (an inset well), .note.err for an error, .note.warn for a warning.
  const cls: Record<BannerVariant, string> = { warn: "note warn", danger: "note err", info: "note" };
  const iconColor: Record<BannerVariant, string> = { warn: "var(--warn)", danger: "var(--down)", info: "var(--bridge)" };
  return (
    <div className={cls[variant]} style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "12px 16px",
      fontSize: 13,
    }}>
      <span style={{ display: "inline-flex", color: iconColor[variant] }}>{icon || <IconAlert size={16} />}</span>
      <div style={{ flex: 1, color: "var(--fg1)" }}>{children}</div>
      {action ? <div>{action}</div> : null}
    </div>
  );
};

// ────────────── Stat ──────────────

export const Stat = ({
  label,
  value,
  sublabel,
  size = "md",
  emphasis = "regular",
  color,
}: {
  label: ReactNode;
  value: ReactNode;
  sublabel?: ReactNode;
  size?: "sm" | "md" | "lg";
  emphasis?: "regular" | "serif";
  color?: string;
}) => {
  const fontSize = size === "lg" ? 36 : size === "sm" ? 18 : 26;
  return (
    <div className="stat" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Eyebrow>{label}</Eyebrow>
      {/* The figure is the Rome look's headline numeral (.stat .v: Untitled Sans Bold); the serif variant keeps its own face. */}
      <div className="v tabular" style={{
        fontSize,
        ...(emphasis === "serif" ? { fontFamily: "var(--font-serif)", fontWeight: 400, letterSpacing: "-0.01em" } : {}),
        color: color || "var(--fg1)",
        lineHeight: 1.05,
      }}>
        {value}
      </div>
      {sublabel ? <div style={{ color: "var(--fg2)", fontSize: 12 }}>{sublabel}</div> : null}
    </div>
  );
};

// ────────────── SectionTitle ──────────────

export const SectionTitle = ({ children, right }: { children: ReactNode; right?: ReactNode }) => (
  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "0 0 16px" }}>
    <h2 style={{
      margin: 0,
      fontFamily: "var(--font-serif)",
      fontWeight: 400,
      fontSize: 24,
      letterSpacing: "-0.01em",
      color: "var(--fg1)",
    }}>
      {children}
    </h2>
    {right ? <div>{right}</div> : null}
  </div>
);

// ────────────── Container ──────────────

export const Container = ({
  children,
  max = 1280,
  style,
}: {
  children: ReactNode;
  max?: number;
  style?: CSSProperties;
}) => (
  <div style={{ maxWidth: max, margin: "0 auto", padding: "0 24px", width: "100%", ...style }}>
    {children}
  </div>
);

// ────────────── WalletPrompt ──────────────

export const WalletPrompt = ({
  title = "Wallet not connected",
  body = "Connect to see your positions.",
  onConnect,
}: {
  title?: string;
  body?: string;
  onConnect?: () => void;
}) => (
  <div className="card" style={{
    padding: "48px 32px",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
  }}>
    <div style={{
      width: 56, height: 56, borderRadius: "var(--r-pill)",
      background: "color-mix(in srgb, var(--bridge) 12%, transparent)",
      border: "1px solid var(--border-brand)",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "var(--fg-brand)",
    }}>
      <IconWallet size={22} />
    </div>
    <div style={{ fontFamily: "var(--font-serif)", fontSize: 22, color: "var(--fg1)" }}>{title}</div>
    <div style={{ fontSize: 14, color: "var(--fg2)", maxWidth: 420 }}>{body}</div>
    <Button variant="primary" onClick={onConnect}>Connect wallet</Button>
  </div>
);

// ────────────── Tag ──────────────

type TagTone = "neutral" | "brand" | "warn" | "danger" | "success";

export const Tag = ({ children, tone = "neutral", keepCase = false }: { children: ReactNode; tone?: TagTone; keepCase?: boolean }) => {
  const tones: Record<TagTone, { color: string; border: string; bg: string }> = {
    neutral: { color: "var(--fg2)",       border: "var(--border-default)",    bg: "transparent" },
    brand:   { color: "var(--bridge)",    border: "color-mix(in srgb, var(--bridge) 40%, transparent)", bg: "color-mix(in srgb, var(--bridge) 10%, transparent)" },
    warn:    { color: "var(--warn)",      border: "color-mix(in srgb, var(--warn) 45%, transparent)",   bg: "color-mix(in srgb, var(--warn) 10%, transparent)" },
    danger:  { color: "var(--down)",      border: "color-mix(in srgb, var(--down) 45%, transparent)",   bg: "color-mix(in srgb, var(--down) 10%, transparent)" },
    success: { color: "var(--up-text)",   border: "var(--up-line)",                                     bg: "var(--up-dim)" },
  };
  const s = tones[tone];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px",
      borderRadius: "var(--r-pill)",
      border: `1px solid ${s.border}`,
      background: s.bg,
      color: s.color,
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      letterSpacing: "0.06em",
      textTransform: keepCase ? "none" : "uppercase",
    }}>{children}</span>
  );
};

// ────────────── NetworkLabel ──────────────
// The network as a user reads it: "Solana · via Rome" and a small Testnet tag (lib/brand.ts). Never the registry's chain name or id.

export const NetworkLabel = ({ tag = true }: { tag?: boolean }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap", textTransform: "none", letterSpacing: "normal" }}>
    <span>{NETWORK_LABEL}</span>
    {tag ? <Tag keepCase>{NETWORK_TAG}</Tag> : null}
  </span>
);

// ────────────── CollateralToggle ──────────────
// Switch pill used in the Supplies list to flip a reserve's `isCollateral`
// bit. The caller sends Pool.setUserUseReserveAsCollateral (useAaveCollateral).

export const CollateralToggle = ({
  on,
  disabled,
  onClick,
}: {
  on: boolean;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-pressed={on}
    style={{
      width: 32, height: 18, borderRadius: "var(--r-pill)",
      background: on ? "var(--up)" : "var(--panel-3)",
      border: `1px solid ${on ? "var(--up)" : "var(--btn2-edge, var(--border-default))"}`,
      position: "relative",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.4 : 1,
      padding: 0,
    }}
  >
    <span style={{
      position: "absolute",
      top: 1, left: on ? 15 : 1,
      width: 14, height: 14, borderRadius: 14,
      background: on ? "var(--ground)" : "var(--muted)",
      transition: "left var(--dur-fast) var(--ease-out)",
    }} />
  </button>
);
