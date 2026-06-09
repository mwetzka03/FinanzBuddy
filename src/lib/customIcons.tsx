import { forwardRef, type ReactNode } from 'react';
import type { LucideIcon, LucideProps } from 'lucide-react';

function makeIcon(
  paths: ReactNode,
  viewBox = '0 0 24 24',
): LucideIcon {
  const Icon = forwardRef<SVGSVGElement, LucideProps>(
    ({ color = 'currentColor', size = 24, strokeWidth = 2, ...props }, ref) => (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox={viewBox}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        {paths}
      </svg>
    ),
  );
  Icon.displayName = 'CustomIcon';
  return Icon as LucideIcon;
}

export const CigaretteIcon = makeIcon(
  <>
    <path d="M18 14H2v3h16v-3Z" />
    <path d="M22 14v3" />
    <path d="M7 14v3" />
    <path d="M11 14v3" />
    <path d="M15 14v3" />
    <path d="M20 9c-1.2 1.2-1.8 2.4-1.2 4" />
    <path d="M22 6c-1.5 1.8-2.2 3.4-1.3 5.5" />
    <path d="M18 4c-1 1.3-1.5 2.5-0.8 4" />
  </>,
);

export const TentIcon = makeIcon(
  <>
    <path d="M3.5 21 12 3l8.5 18" />
    <path d="M7.5 21h9" />
    <path d="M12 3v18" />
  </>,
);

export const BeerIcon = makeIcon(
  <>
    <path d="M7 9v10a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V9" />
    <path d="M6 22h12" />
    <path d="M17 11h1.8a2.2 2.2 0 0 1 2.2 2.2v3.6a2.2 2.2 0 0 1-2.2 2.2H17" />
    <path d="M9 12v8" />
    <path d="M12 12v8" />
    <path d="M15 12v8" />
    <path d="M6.5 9c0-2.2 2.2-4.5 5.5-4.5S17.5 6.8 17.5 9" />
    <path d="M5.5 7.5c1.2-1.5 3.2-2.5 6.5-2.5" />
    <circle cx="9" cy="6.5" r="0.55" fill="currentColor" stroke="none" />
    <circle cx="12" cy="5.5" r="0.45" fill="currentColor" stroke="none" />
    <circle cx="15" cy="6.8" r="0.5" fill="currentColor" stroke="none" />
  </>,
);
