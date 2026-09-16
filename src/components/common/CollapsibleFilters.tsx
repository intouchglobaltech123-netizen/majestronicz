import React, { useState } from 'react';
import { SlidersHorizontal, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

interface Props {
  children: React.ReactNode;
  /** Number of active filters, shown on the mobile toggle. */
  activeCount?: number;
  className?: string;
}

/**
 * Wraps a filter/toolbar block. On mobile it collapses behind a "Filters"
 * toggle (so a wide pill/control row never runs off-screen); on >= sm it is
 * always shown inline. Keeps section toolbars responsive and tidy.
 */
export const CollapsibleFilters: React.FC<Props> = ({ children, activeCount = 0, className }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="sm:hidden w-full flex items-center justify-between px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700"
      >
        <span className="flex items-center gap-1.5">
          <SlidersHorizontal className="h-4 w-4 text-blue-600" />
          Filters{activeCount > 0 ? ` (${activeCount})` : ''}
        </span>
        <ChevronDown className={cn('h-4 w-4 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      <div className={cn('mt-2 sm:mt-0', open ? 'block' : 'hidden', 'sm:block')}>{children}</div>
    </div>
  );
};
