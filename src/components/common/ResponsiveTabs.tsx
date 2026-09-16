import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ResponsiveTabItem {
  id: string;
  label: string;
  count?: number;
}

interface Props {
  items: ResponsiveTabItem[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}

/**
 * Section sub-navigation that is a proper dropdown on mobile (no cramped
 * horizontal scrolling) and an underline tab row on >= sm. Keeps a single,
 * consistent, professional look across every module.
 */
export const ResponsiveTabs: React.FC<Props> = ({ items, activeId, onChange, className }) => {
  return (
    <div className={cn('border-b border-slate-200', className)}>
      {/* Mobile: dropdown selector */}
      <div className="sm:hidden pb-2">
        <div className="relative">
          <select
            value={activeId}
            onChange={(e) => onChange(e.target.value)}
            className="w-full appearance-none pl-3 pr-9 py-2.5 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-800 focus:outline-none focus:border-blue-500"
          >
            {items.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
                {typeof t.count === 'number' ? ` (${t.count})` : ''}
              </option>
            ))}
          </select>
          <ChevronDown className="h-4 w-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {/* Desktop / tablet: underline tab row */}
      <div className="hidden sm:flex items-center gap-5 overflow-x-auto">
        {items.map((t) => {
          const active = t.id === activeId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              className={cn(
                'pb-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-all whitespace-nowrap',
                active
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              )}
            >
              <span>{t.label}</span>
              {typeof t.count === 'number' && (
                <span
                  className={cn(
                    'text-[11px] px-2 py-0.5 rounded-full font-semibold',
                    active ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'
                  )}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
