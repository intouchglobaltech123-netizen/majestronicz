import React from 'react';
import { useErp } from '../../context/ErpContext';
import { NAV_MODULES, isModuleActive, NavSub } from './navConfig';
import { cn } from '../../lib/utils';
import { Plus } from 'lucide-react';

/**
 * Second navigation column (desktop only), immediately right of the primary rail.
 * Shows the active module's sub-sections + primary actions. This is the ONLY place
 * sub-navigation lives now — the in-page tab strips are removed.
 */
export const SecondarySidebar: React.FC = () => {
  const { currentView, activeSubTab, navigateToTab, setCurrentView, canAccessView } = useErp();

  const module = NAV_MODULES.find((m) => isModuleActive(m, currentView));
  if (!module) return null;

  const visibleItems = module.items.filter((it) => canAccessView(it.cap));
  // Dashboard (and any single self-titled module) has no real sub-nav.
  if (visibleItems.length <= 1 && !module.primaryActions) return null;

  const actionView = module.items[0]?.id ?? currentView;

  const isSubActive = (it: NavSub): boolean => {
    const viewMatch = currentView === it.id || (it.id === 'parties' && currentView === 'customers');
    return viewMatch && (!it.subTabId || activeSubTab?.tab === it.subTabId);
  };

  const handleSub = (it: NavSub) => {
    if (it.subTabId) navigateToTab(it.id, it.subTabId);
    else setCurrentView(it.id);
  };

  const actionColor: Record<string, string> = {
    red: 'bg-red-600 hover:bg-red-700 text-white border-red-700',
    slate: 'bg-slate-800 hover:bg-slate-900 text-white border-slate-900',
    emerald: 'bg-emerald-700 hover:bg-emerald-800 text-white border-emerald-800',
  };

  return (
    <aside className="hidden lg:flex w-48 shrink-0 flex-col border-r border-slate-300 bg-slate-50/70 h-full overflow-hidden">
      {/* Module title */}
      <div className="px-3 py-2.5 border-b border-slate-200 shrink-0">
        <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
          {module.title}
        </h2>
      </div>

      {/* Primary actions */}
      {module.primaryActions && module.primaryActions.length > 0 && (
        <div className="p-2 border-b border-slate-200 space-y-1 shrink-0">
          {module.primaryActions.map((a) => (
            <button
              key={a.subTabId}
              type="button"
              onClick={() => navigateToTab(actionView, a.subTabId)}
              className={cn(
                'w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-none text-[11px] font-bold border transition-colors cursor-pointer',
                actionColor[a.color || 'slate']
              )}
            >
              <Plus className="h-3 w-3 stroke-[3]" />
              <span>{a.label.replace(/^\+\s*/, '')}</span>
            </button>
          ))}
        </div>
      )}

      {/* Sub-sections */}
      <div className="flex-1 overflow-y-auto py-1">
        {visibleItems.map((it) => (
          <button
            key={`${it.id}-${it.subTabId || ''}`}
            type="button"
            onClick={() => handleSub(it)}
            className={cn(
              'w-full text-left px-3 py-2 text-xs transition-colors cursor-pointer block truncate border-l-4',
              isSubActive(it)
                ? 'bg-red-50 text-red-900 font-extrabold border-red-600'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 border-transparent font-medium'
            )}
          >
            {it.label}
          </button>
        ))}
      </div>
    </aside>
  );
};

export default SecondarySidebar;
