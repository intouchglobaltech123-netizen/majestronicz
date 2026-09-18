import React from 'react';
import { cn } from '../../lib/utils';

interface Props {
  collapsed?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'horizontal' | 'stacked' | 'emblem-only';
  showBadge?: boolean;
}

export const MajestroniczLogo: React.FC<Props> = ({
  collapsed = false,
  className,
  size = 'md',
  variant = 'horizontal',
  showBadge = true,
}) => {
  // Collapsed sidebar mode: display emblem only
  if (collapsed || variant === 'emblem-only') {
    return (
      <div className={cn('flex items-center justify-center', className)}>
        <img
          src="/assets/majestronicz-emblem.png"
          alt="Majestronicz Emblem"
          className={cn(
            'object-contain drop-shadow-xs shrink-0',
            size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-11 w-11' : size === 'xl' ? 'h-14 w-14' : 'h-9 w-9'
          )}
        />
      </div>
    );
  }

  // Stacked mode (ideal for Login, splash, or centered headers)
  if (variant === 'stacked') {
    return (
      <div className={cn('flex flex-col items-center gap-2', className)}>
        <img
          src="/assets/majestronicz-logo.png"
          alt="Majestronicz"
          className={cn(
            'object-contain drop-shadow-sm',
            size === 'sm' ? 'h-14' : size === 'lg' ? 'h-24' : size === 'xl' ? 'h-32' : 'h-20'
          )}
        />
        {showBadge && (
          <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
            Enterprise ERP
          </span>
        )}
      </div>
    );
  }

  // Horizontal mode (default for TopBar, Sidebar, PDF documents, headers)
  return (
    <div className={cn('flex items-center gap-3 select-none', className)}>
      <img
        src="/assets/majestronicz-emblem.png"
        alt="Majestronicz Emblem"
        className={cn(
          'object-contain drop-shadow-xs shrink-0',
          size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-11 w-11' : size === 'xl' ? 'h-14 w-14' : 'h-9 w-9'
        )}
      />

      <div className="flex items-center gap-2 min-w-0">
        <img
          src="/assets/majestronicz-text.png"
          alt="Majestronicz"
          className={cn(
            'object-contain max-w-[140px] sm:max-w-[170px]',
            size === 'sm' ? 'h-3' : size === 'lg' ? 'h-5' : size === 'xl' ? 'h-6' : 'h-4'
          )}
        />
        {showBadge && (
          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
            ERP
          </span>
        )}
      </div>
    </div>
  );
};

export default MajestroniczLogo;
