// UI chrome icons. Token logos come from the token service by mint (components/TokenIcon.tsx); ETH and SOL here are the header's network marks.

import type { FC, ReactNode } from "react";

interface IconSize { size?: number }

// ────────────── Network marks ──────────────

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

// ────────────── UI chrome icons (Lucide-derived) ──────────────

interface IconProps { size?: number; sw?: number; fill?: string; className?: string; d: ReactNode }
const SvgIcon: FC<IconProps> = ({ d, size = 16, sw = 1.5, fill = "none", className }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
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
export const IconChange: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<><path d="M4 7h13l-3-3" /><path d="M20 17H7l3 3" /></>} />;
export const IconDisconnect: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" /><path d="m10 17-5-5 5-5" /><path d="M5 12h11" /></>} />;
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

// Theme choice (the Rome DEX's Sun, Monitor and Moon)
export const IconSun: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>} />;
export const IconMoon: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />} />;
export const IconMonitor: FC<ChromeIconProps> = (p) => <SvgIcon {...p} d={<><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>} />;
