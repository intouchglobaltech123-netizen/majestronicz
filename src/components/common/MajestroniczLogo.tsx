import React from 'react';
import { cn } from '../../lib/utils';

interface Props {
  collapsed?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'horizontal' | 'stacked' | 'emblem-only';
}

export const MajestroniczLogo: React.FC<Props> = ({
  collapsed = false,
  className,
  size = 'md',
  variant = 'horizontal',
}) => {
  // Collapsed sidebar mode: display emblem only, perfectly centered
  if (collapsed || variant === 'emblem-only') {
    return (
      <div className={cn('flex items-center justify-center', className)}>
        <img
          src="/assets/majestronicz-emblem.png"
          alt="Majestronicz"
          className={cn(
            'object-contain drop-shadow-xs shrink-0 transition-transform duration-200 hover:scale-105',
            size === 'sm' ? 'h-6 w-6' : size === 'lg' ? 'h-10 w-10' : size === 'xl' ? 'h-12 w-12' : 'h-8 w-8'
          )}
        />
      </div>
    );
  }

  // Stacked mode (for Login, splash, or centered headers)
  if (variant === 'stacked') {
    return (
      <div className={cn('flex flex-col items-center gap-1.5 select-none', className)}>
        <img
          src="/assets/majestronicz-logo.png"
          alt="Majestronicz"
          className={cn(
            'object-contain drop-shadow-sm',
            size === 'sm' ? 'h-16' : size === 'lg' ? 'h-24' : size === 'xl' ? 'h-32' : 'h-20'
          )}
        />
      </div>
    );
  }

  // Horizontal mode (default for Sidebar, TopBar, Invoices, PDF prints)
  return (
    <div className={cn('flex items-center gap-2.5 select-none min-w-0', className)}>
      <img
        src="/assets/majestronicz-emblem.png"
        alt="Majestronicz Emblem"
        className={cn(
          'object-contain drop-shadow-xs shrink-0',
          size === 'sm' ? 'h-7 w-7' : size === 'lg' ? 'h-10 w-10' : size === 'xl' ? 'h-12 w-12' : 'h-8 w-8'
        )}
      />

      <img
        src="/assets/majestronicz-text.png"
        alt="Majestronicz"
        className={cn(
          'object-contain shrink-0 max-w-[130px] sm:max-w-[155px]',
          size === 'sm' ? 'h-3' : size === 'lg' ? 'h-5' : size === 'xl' ? 'h-6' : 'h-3.5'
        )}
      />
    </div>
  );
};

export default MajestroniczLogo;
