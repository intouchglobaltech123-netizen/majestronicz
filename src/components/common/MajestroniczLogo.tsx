import React from 'react';
import { cn } from '../../lib/utils';

interface Props {
  collapsed?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'horizontal' | 'stacked' | 'emblem-only';
}

/**
 * Crisp, resolution-independent brand mark. Previously rendered from raster PNGs
 * with a baked (non-transparent) background, which looked pixelated when scaled
 * and showed a background box. This is pure inline SVG + text, so it stays sharp
 * at any size and on any background.
 */

const EMBLEM_PX: Record<NonNullable<Props['size']>, number> = { sm: 26, md: 32, lg: 40, xl: 48 };
const WORD_CLASS: Record<NonNullable<Props['size']>, string> = {
  sm: 'text-sm', md: 'text-base', lg: 'text-xl', xl: 'text-2xl',
};

const Emblem: React.FC<{ px: number; className?: string }> = ({ px, className }) => {
  // One gradient id per logo instance (V5): with several logos on a page (the
  // sidebar plus a printed document) a shared id made browser print draw dots.
  const gradId = `mz-grad-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
  <svg
    width={px}
    height={px}
    viewBox="0 0 48 48"
    fill="none"
    role="img"
    aria-label="Majestronicz"
    className={cn('shrink-0', className)}
  >
    <defs>
      <linearGradient id={gradId} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop stopColor="#b91c1c" />
        <stop offset="1" stopColor="#7f1120" />
      </linearGradient>
    </defs>
    <rect x="1" y="1" width="46" height="46" rx="12" fill={`url(#${gradId})`} />
    {/* Crown mark — "majestic" M */}
    <path
      d="M12 32h24l-2.2 5.2a2 2 0 0 1-1.85 1.25H16.05a2 2 0 0 1-1.85-1.25L12 32Z"
      fill="#fff"
      fillOpacity="0.95"
    />
    <path
      d="M11.5 30.5 9 15.7l7.4 6.1L24 11l7.6 10.8 7.4-6.1-2.5 14.8H11.5Z"
      fill="#fff"
    />
    <circle cx="24" cy="9" r="2.1" fill="#fde68a" />
    <circle cx="9" cy="14" r="1.6" fill="#fde68a" />
    <circle cx="39" cy="14" r="1.6" fill="#fde68a" />
  </svg>
  );
};

const Wordmark: React.FC<{ size: NonNullable<Props['size']> }> = ({ size }) => (
  <span className={cn('font-extrabold tracking-tight leading-none text-slate-900 whitespace-nowrap', WORD_CLASS[size])}>
    <span className="text-red-700">M</span>ajestronicz
  </span>
);

export const MajestroniczLogo: React.FC<Props> = ({
  collapsed = false,
  className,
  size = 'md',
  variant = 'horizontal',
}) => {
  const px = EMBLEM_PX[size];

  if (collapsed || variant === 'emblem-only') {
    return (
      <div className={cn('flex items-center justify-center', className)}>
        <Emblem px={px} className="transition-transform duration-200 hover:scale-105" />
      </div>
    );
  }

  if (variant === 'stacked') {
    const stackedPx = size === 'sm' ? 48 : size === 'lg' ? 72 : size === 'xl' ? 88 : 60;
    return (
      <div className={cn('flex flex-col items-center gap-2 select-none', className)}>
        <Emblem px={stackedPx} />
        <span className={cn('font-extrabold tracking-tight text-slate-900', size === 'xl' ? 'text-3xl' : 'text-2xl')}>
          <span className="text-red-700">M</span>ajestronicz
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-400">Retail ERP</span>
      </div>
    );
  }

  // Horizontal (default)
  return (
    <div className={cn('flex items-center gap-2.5 select-none min-w-0', className)}>
      <Emblem px={px} />
      <Wordmark size={size} />
    </div>
  );
};

export default MajestroniczLogo;
