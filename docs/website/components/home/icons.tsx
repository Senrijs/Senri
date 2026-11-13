// 404 のページで使うアイコン。飾りなので aria-hidden
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

export const ArrowIcon = (p: Props) => (
    <Icon strokeWidth={2.2} {...p}>
        <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
);
