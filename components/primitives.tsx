"use client";

// Shared low-level UI primitives. Inline-style components reading from
// the CSS-variable tokens defined in public/styles.css — no Tailwind.

import {
  useState,
  type CSSProperties,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { fmt } from "@/lib/format";
import {
  IconAlert,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconExternal,
  IconWallet,
} from "@/components/icons";
import { TOKEN_ICONS, FallbackTokenIcon } from "@/components/icons";

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
  style: extraStyle,
  ...rest
}: ButtonProps) => {
  const base: CSSProperties = {
    fontFamily: "var(--font-sans)",
    fontWeight: 500,
    borderRadius: "var(--r-pill)",
    border: "1px solid transparent",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: fullWidth ? "100%" : undefined,
    transition:
      "background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out)",
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
    primary:    { background: "var(--rome-purple)", color: "var(--on-rome-purple)", border: "1px solid var(--rome-purple)" },
    primaryAlt: { background: "var(--rome-purple-hover)", color: "var(--on-rome-purple)", border: "1px solid var(--rome-purple-hover)" },
    secondary:  { background: "transparent", color: "var(--fg1)", border: "1px solid var(--border-default)" },
    ghost:      { background: "transparent", color: "var(--fg2)", border: "1px solid transparent" },
    danger:     { background: "transparent", color: "var(--hf-danger)", border: "1px solid rgba(226, 106, 106, 0.4)" },
    success:    { background: "rgba(92, 207, 166, 0.14)", color: "var(--hf-safe)", border: "1px solid rgba(92, 207, 166, 0.4)" },
  };
  const style: CSSProperties = { ...base, ...sizes[size], ...variants[variant] };
  if (rest.disabled) style.opacity = 0.45;

  return (
    <button
      {...rest}
      style={{ ...style, ...(extraStyle || {}) }}
      onMouseEnter={(e) => {
        if (rest.disabled) return;
        if (variant === "primary")   e.currentTarget.style.background = "var(--rome-purple-hover)";
        if (variant === "secondary") e.currentTarget.style.background = "var(--bg-surface-2)";
        if (variant === "ghost")     e.currentTarget.style.color = "var(--fg1)";
      }}
      onMouseLeave={(e) => {
        if (variant === "primary")   e.currentTarget.style.background = "var(--rome-purple)";
        if (variant === "secondary") e.currentTarget.style.background = "transparent";
        if (variant === "ghost")     e.currentTarget.style.color = "var(--fg2)";
      }}
    >
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
  const IconC = TOKEN_ICONS[symbol];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      {IconC ? <IconC size={size} /> : <FallbackTokenIcon symbol={symbol} size={size} />}
      <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.15, minWidth: 0 }}>
        <span style={{ fontWeight: 500, color: "inherit", letterSpacing: "-0.005em" }}>{symbol}</span>
        {showName && name ? <span style={{ fontSize: 11, color: "var(--fg2)" }}>{name}</span> : null}
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
}: {
  hf: number | null | undefined;
  size?: "sm" | "md";
  showLabel?: boolean;
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
      HF&nbsp;<span style={{ fontWeight: 600 }}>{fmt.hf(hf)}</span>
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
  <div style={{
    background: "var(--bg-surface-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--r-md)",
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
        <button onClick={onMax} disabled={disabled} style={{
          background: "var(--bg-surface-3)",
          border: "1px solid var(--border-default)",
          color: "var(--fg1)",
          borderRadius: "var(--r-pill)",
          fontSize: 11,
          padding: "4px 10px",
          fontFamily: "var(--font-mono)",
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
        <button onClick={handleCopy} title="Copy" style={{
          background: "transparent",
          border: "1px solid var(--border-default)",
          color: "var(--fg2)", padding: 6, borderRadius: 6,
          display: "inline-flex",
        }}>
          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
        </button>
        <a href={explorerHref || "#"} onClick={(e) => { if (!explorerHref) e.preventDefault(); }}
          target={explorerHref ? "_blank" : undefined} rel={explorerHref ? "noreferrer" : undefined}
          title={explorerLabel}
          style={{ color: "var(--fg2)", textDecoration: "none", border: "1px solid var(--border-default)", padding: 6, borderRadius: 6, display: "inline-flex" }}>
          <IconExternal size={12} />
        </a>
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
  const styles: Record<BannerVariant, { bg: string; border: string; color: string }> = {
    warn:   { bg: "rgba(232, 160, 78, 0.08)", border: "rgba(232, 160, 78, 0.32)", color: "var(--hf-warn)" },
    danger: { bg: "rgba(226, 106, 106, 0.08)", border: "rgba(226, 106, 106, 0.32)", color: "var(--hf-danger)" },
    info:   { bg: "rgba(197, 139, 198, 0.08)", border: "rgba(197, 139, 198, 0.32)", color: "var(--fg-brand)" },
  };
  const s = styles[variant];
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "12px 16px",
      background: s.bg,
      border: `1px solid ${s.border}`,
      borderRadius: "var(--r-md)",
      color: s.color,
      fontSize: 13,
    }}>
      <span style={{ display: "inline-flex" }}>{icon || <IconAlert size={16} />}</span>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Eyebrow>{label}</Eyebrow>
      <div className="mono tabular" style={{
        fontSize,
        fontFamily: emphasis === "serif" ? "var(--font-serif)" : "var(--font-mono)",
        fontWeight: emphasis === "serif" ? 400 : 500,
        color: color || "var(--fg1)",
        letterSpacing: "-0.01em",
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
  title = "Connect your wallet",
  body = "Connect to view your positions, supply, borrow, and manage your Aave V3 account on Rome.",
  onConnect,
}: {
  title?: string;
  body?: string;
  onConnect?: () => void;
}) => (
  <div style={{
    border: "1px dashed var(--border-default)",
    borderRadius: "var(--r-md)",
    padding: "48px 32px",
    textAlign: "center",
    background: "var(--bg-surface)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
  }}>
    <div style={{
      width: 56, height: 56, borderRadius: "var(--r-pill)",
      background: "rgba(197, 139, 198, 0.10)",
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

export const Tag = ({ children, tone = "neutral" }: { children: ReactNode; tone?: TagTone }) => {
  const tones: Record<TagTone, { color: string; border: string; bg: string }> = {
    neutral: { color: "var(--fg2)",       border: "var(--border-default)",    bg: "transparent" },
    brand:   { color: "var(--fg-brand)",  border: "var(--border-brand)",      bg: "rgba(197, 139, 198, 0.08)" },
    warn:    { color: "var(--hf-warn)",   border: "rgba(232, 160, 78, 0.4)",  bg: "rgba(232, 160, 78, 0.10)" },
    danger:  { color: "var(--hf-danger)", border: "rgba(226, 106, 106, 0.4)", bg: "rgba(226, 106, 106, 0.10)" },
    success: { color: "var(--hf-safe)",   border: "rgba(92, 207, 166, 0.4)",  bg: "rgba(92, 207, 166, 0.10)" },
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
      textTransform: "uppercase",
    }}>{children}</span>
  );
};

// ────────────── CollateralToggle ──────────────
// Switch pill used in the Supplies list to flip a reserve's `isCollateral`
// bit. Visual only in slice 3 — the actual setUserUseReserveAsCollateral
// wiring is slice 4 work (lives next to the action-modal hooks).

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
      background: on ? "var(--hf-safe)" : "var(--bg-surface-3)",
      border: `1px solid ${on ? "var(--hf-safe)" : "var(--border-default)"}`,
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
      background: on ? "#0E2C22" : "var(--fg2)",
      transition: "left var(--dur-fast) var(--ease-out)",
    }} />
  </button>
);
