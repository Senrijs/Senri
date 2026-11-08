// トップページで使うアイコン(モックの SVG をそのまま部品にしたもの)。どれも飾りなので aria-hidden
import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...rest }: Props) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            {...rest}
        >
            {children}
        </svg>
    );
}

export const SearchIcon = (p: Props) => (
    <Icon strokeWidth={2.2} {...p}>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
    </Icon>
);
export const SunIcon = (p: Props) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Icon>
);
export const MoonIcon = (p: Props) => (
    <Icon {...p}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </Icon>
);
export const MenuIcon = (p: Props) => (
    <Icon size={18} {...p}>
        <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
);
export const CloseIcon = (p: Props) => (
    <Icon size={18} {...p}>
        <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
);
export const CopyIcon = (p: Props) => (
    <Icon {...p}>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a1 1 0 0 1 1-1h10" />
    </Icon>
);
export const StarIcon = (p: Props) => (
    <Icon size={14} fill="currentColor" stroke="none" {...p}>
        <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
    </Icon>
);
export const DownloadIcon = (p: Props) => (
    <Icon size={14} strokeWidth={2.2} {...p}>
        <path d="M12 4v12M6 11l6 6 6-6M5 20h14" />
    </Icon>
);
export const WarnIcon = (p: Props) => (
    <Icon size={14} {...p}>
        <path d="M12 3l9 16H3z" />
        <path d="M12 10v4M12 17h.01" />
    </Icon>
);
export const GlobeIcon = (p: Props) => (
    <Icon strokeWidth={1.6} {...p}>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </Icon>
);
export const PulseIcon = (p: Props) => (
    <Icon strokeWidth={1.6} {...p}>
        <path d="M3 12h4l3-8 4 16 3-8h4" />
    </Icon>
);
export const ListIcon = (p: Props) => (
    <Icon strokeWidth={1.6} {...p}>
        <path d="M4 7h16M4 12h16M4 17h10" />
    </Icon>
);
export const ChevronIcon = ({ dir = "right", ...p }: Props & { dir?: "left" | "right" }) => (
    <Icon {...p}>
        <path d={dir === "right" ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
    </Icon>
);
export const ArrowIcon = (p: Props) => (
    <Icon strokeWidth={2.2} {...p}>
        <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
);
export const PauseIcon = (p: Props) => (
    <Icon size={14} {...p}>
        <path d="M9 5v14M15 5v14" />
    </Icon>
);
export const PlayIcon = (p: Props) => (
    <Icon size={14} {...p}>
        <path d="M7 5l12 7-12 7z" />
    </Icon>
);
