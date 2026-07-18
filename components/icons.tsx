// Token logos + UI chrome icons. Token logos use the canonical
// underlying-asset brand (spec §11).

import type { FC, ReactNode } from "react";

interface IconSize { size?: number }

// ────────────── Token logos ──────────────

export const USDCIcon: FC<IconSize> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="16" fill="#2775CA" />
    <path d="M20.5 18.2c0-2.4-1.4-3.2-4.3-3.55-2.05-.27-2.46-.82-2.46-1.78 0-.96.69-1.57 2.05-1.57 1.23 0 1.92.41 2.26 1.44.07.21.27.34.48.34h1.1c.27 0 .48-.2.48-.48v-.07c-.27-1.5-1.5-2.66-3.07-2.8V8.13c0-.27-.2-.48-.55-.55h-1.03c-.27 0-.48.2-.55.55v1.51c-2.05.27-3.34 1.64-3.34 3.34 0 2.26 1.37 3.14 4.27 3.48 1.92.34 2.53.75 2.53 1.85 0 1.1-.96 1.85-2.26 1.85-1.78 0-2.4-.75-2.6-1.78-.07-.27-.27-.41-.48-.41h-1.17c-.27 0-.48.2-.48.48v.07c.27 1.71 1.37 2.94 3.62 3.27v1.57c0 .27.2.48.55.55h1.03c.27 0 .48-.2.55-.55v-1.57c2.05-.34 3.48-1.78 3.48-3.62z" fill="#fff"/>
    <path d="M12.65 24.34c-3.34-1.2-5.05-4.93-3.76-8.2.68-1.91 2.19-3.34 4.1-4.02.27-.14.41-.34.41-.69v-.96c0-.27-.14-.48-.41-.55-.07 0-.21 0-.27.07-4.1 1.3-6.36 5.67-5.05 9.77.82 2.6 2.74 4.52 5.05 5.33.27.14.55 0 .62-.27.07-.07.07-.14.07-.27v-.96c0-.21-.21-.34-.41-.48-.07-.07-.21-.07-.34 0zm6.84-14.4c-.27-.14-.55 0-.62.27-.07.07-.07.14-.07.27v.96c0 .21.2.41.41.55 3.34 1.23 5.05 4.93 3.76 8.2-.68 1.91-2.19 3.34-4.1 4.02-.27.14-.41.34-.41.69v.96c0 .27.14.48.41.55.07 0 .21 0 .27-.07 4.1-1.3 6.36-5.67 5.05-9.77-.82-2.66-2.81-4.58-5.05-5.39-.07 0-.21 0-.27.07-.07.07-.07.07-.07.14z" fill="#fff"/>
  </svg>
);

export const ETHIcon: FC<IconSize> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="16" fill="#627EEA" />
    <g fill="#fff" fillRule="nonzero">
      <path fillOpacity=".602" d="M16.498 4v8.87l7.497 3.35z" />
      <path d="M16.498 4 9 16.22l7.498-3.35z" />
      <path fillOpacity=".602" d="M16.498 21.968v6.027L24 17.616z" />
      <path d="M16.498 27.995v-6.028L9 17.616z" />
      <path fillOpacity=".2" d="m16.498 20.573 7.497-4.353-7.497-3.348z" />
      <path fillOpacity=".602" d="m9 16.22 7.498 4.353v-7.701z" />
    </g>
  </svg>
);

interface LetterMarkProps extends IconSize { letter: string; bg: string; fg?: string }

const LetterMark: FC<LetterMarkProps> = ({ letter, bg, fg = "#fff", size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="16" fill={bg} />
    <text x="16" y="20" textAnchor="middle" fontFamily="'system-ui', sans-serif" fontWeight="600" fontSize="11" letterSpacing="0.04em" fill={fg}>
      {letter}
    </text>
  </svg>
);

export const HEATIcon: FC<IconSize> = (p) => <LetterMark letter="HEAT" bg="#D9532A" {...p} />;
export const SALTIcon: FC<IconSize> = (p) => <LetterMark letter="SALT" bg="#7B8794" {...p} />;
export const MILKIcon: FC<IconSize> = (p) => <LetterMark letter="MILK" bg="#E8DCC4" fg="#3B2F1F" {...p} />;
export const OILIcon: FC<IconSize> = (p) => <LetterMark letter="OIL" bg="#2A3441" {...p} />;
export const WBTCIcon: FC<IconSize> = (p) => <LetterMark letter="BTC" bg="#F7931A" {...p} />;

export const SOLIcon: FC<IconSize> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="16" fill="#1a1a1a" />
    <defs>
      <linearGradient id="solg" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stopColor="#9945FF" />
        <stop offset="100%" stopColor="#14F195" />
      </linearGradient>
    </defs>
    <path d="M9 21.5l2.2-2.2h12.5l-2.2 2.2H9zm0-5.5l2.2-2.2h12.5L21.5 16H9zm0-5.5l2.2-2.2h12.5L21.5 10.5H9z" fill="url(#solg)" />
  </svg>
);

export const TOKEN_ICONS: Record<string, FC<IconSize>> = {
  USDC: USDCIcon,
  ETH: ETHIcon,
  WBTC: WBTCIcon,
  HEAT: HEATIcon,
  SALT: SALTIcon,
  MILK: MILKIcon,
  OIL: OILIcon,
  SOL: SOLIcon,
};

// Fallback for unknown symbols — used by AssetSymbol when icon key is
// missing from the TOKEN_ICONS map.
export const FallbackTokenIcon: FC<IconSize & { symbol: string }> = ({ symbol, size = 24 }) => (
  <LetterMark letter={symbol.slice(0, 4)} bg="#3F2A45" size={size} />
);

// ────────────── UI chrome icons (Lucide-derived) ──────────────

interface IconProps { size?: number; sw?: number; fill?: string; d: ReactNode }
const SvgIcon: FC<IconProps> = ({ d, size = 16, sw = 1.5, fill = "none" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    {d}
  </svg>
);

type ChromeIconProps = Omit<IconProps, "d">;

export const IconChevronDown: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<polyline points="6 9 12 15 18 9" />} />;
export const IconChevronRight: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<polyline points="9 6 15 12 9 18" />} />;
export const IconChevronLeft: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<polyline points="15 6 9 12 15 18" />} />;
export const IconClose: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>} />;
export const IconExternal: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></>} />;
export const IconCopy: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>} />;
export const IconCheck: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<polyline points="20 6 9 17 4 12" />} />;
export const IconWallet: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<><path d="M20 12V8H6a2 2 0 0 1 0-4h12v4" /><path d="M4 6v12a2 2 0 0 0 2 2h14v-4" /><circle cx="17" cy="14" r="1.5" /></>} />;
export const IconAlert: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>} />;
export const IconInfo: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>} />;
export const IconArrowDown: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></>} />;
export const IconArrowUp: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></>} />;
export const IconArrowURUp: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<><polyline points="17 11 21 7 17 3" /><path d="M21 7H8a4 4 0 0 0-4 4v10" /></>} />;
export const IconArrowURDown: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<><polyline points="17 13 21 17 17 21" /><path d="M21 17H8a4 4 0 0 1-4-4V3" /></>} />;
export const IconBolt: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />} fill="currentColor" sw={0} />;
export const IconBoom: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<polygon points="12 2 14 8 20 9 16 13 17 19 12 16 7 19 8 13 4 9 10 8 12 2" />} />;
export const IconSpark: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<path d="M12 2v6m0 8v6m10-10h-6m-8 0H2" />} />;
export const IconWarn: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>} />;
export const IconMenu: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></>} />;
export const IconRefresh: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></>} />;
