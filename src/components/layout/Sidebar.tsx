import React, { useState, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import {
  ChevronDown,
  Plus,
  LogOut,
  PanelLeftClose,
  Building2,
  ShieldCheck,
  Lock,
} from 'lucide-react';
import { MajestroniczLogo } from '../common/MajestroniczLogo';
import { cn } from '../../lib/utils';
import { NAV_MODULES, isModuleActive, NavModule, NavSub } from './navConfig';

const ACTION_COLOR: Record<string, string> = {
  red: 'bg-red-600 hover:bg-red-700 text-white border-red-700',
  slate: 'bg-slate-800 hover:bg-slate-900 text-white border-slate-900',
  emerald: 'bg-emerald-700 hover:bg-emerald-800 text-white border-emerald-800',
};

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  onToggle?: () => void;
  onToggleCollapse?: () => void;
  isCollapsed?: boolean;
  mobileOpen?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  mobileOpen,
  onClose,
  onToggleCollapse,
  isCollapsed = false,
}) => {
  const {
    currentUser,
    currentView,
    setCurrentView,
    canAccessView,
    activeSubTab,
    navigateToTab,
    logout,
  } = useErp();

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const isMobileDrawerOpen = Boolean(mobileOpen);

  const modules = NAV_MODULES.filter((m) => m.items.some((it) => canAccessView(it.cap)));
  const activeModuleId = modules.find((m) => isModuleActive(m, currentView))?.id ?? null;

  // Accordion expanded state persisted across refresh
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('majestronicz_sidebar_expanded');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed === 'object' && parsed !== null) return parsed;
      }
    } catch {}
    return activeModuleId ? { [activeModuleId]: true } : { sales: true, items: true };
  });

  // Keep the active module expanded whenever active view changes
  useEffect(() => {
    if (activeModuleId) {
      setExpandedModules((prev) => {
        if (prev[activeModuleId]) return prev;
        const next = { ...prev, [activeModuleId]: true };
        try {
          localStorage.setItem('majestronicz_sidebar_expanded', JSON.stringify(next));
        } catch {}
        return next;
      });
    }
  }, [activeModuleId]);

  const toggleModule = (moduleId: string) => {
    setExpandedModules((prev) => {
      const next = { ...prev, [moduleId]: !prev[moduleId] };
      try {
        localStorage.setItem('majestronicz_sidebar_expanded', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const closeOnMobile = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) onClose?.();
  };

  const goSub = (it: NavSub) => {
    if (it.subTabId) navigateToTab(it.id, it.subTabId);
    else setCurrentView(it.id);
    closeOnMobile();
  };

  const goModuleDefault = (mod: NavModule) => {
    const first = mod.items.find((it) => canAccessView(it.cap));
    if (first) goSub(first);
  };

  const isSubActive = (it: NavSub): boolean => {
    const viewMatch = currentView === it.id || (it.id === 'parties' && currentView === 'customers');
    if (!viewMatch) return false;
    if (it.id === 'settings') {
      const currentTab = activeSubTab?.tab || 'appearance';
      return it.subTabId ? it.subTabId === currentTab : currentTab === 'appearance';
    }
    return !it.subTabId || activeSubTab?.tab === it.subTabId;
  };

  const RoleIcon =
    currentUser.role === 'CEO' ? ShieldCheck : currentUser.role === 'Manager' ? Building2 : Lock;

  return (
    <>
      {isMobileDrawerOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-40 lg:hidden transition-opacity duration-200"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'bg-white flex flex-col h-screen h-[100dvh] max-h-[100dvh] select-none shadow-none transition-all duration-200 ease-in-out',
          'fixed inset-y-0 left-0 z-50 max-w-[85vw]',
          isMobileDrawerOpen ? 'translate-x-0 w-64 border-r border-slate-300' : '-translate-x-full w-64 pointer-events-none',
          // Desktop: collapsible navigation
          'lg:static lg:z-20 lg:translate-x-0 lg:shrink-0',
          isCollapsed
            ? 'lg:w-0 lg:border-r-0 lg:overflow-hidden lg:opacity-0 lg:pointer-events-none'
            : 'lg:w-56 lg:border-r lg:border-slate-300 lg:overflow-hidden lg:opacity-100 lg:pointer-events-auto'
        )}
      >
        <div className="w-64 lg:w-56 min-w-[14rem] h-full flex flex-col overflow-hidden">
          {/* Brand Header */}
          <div className="border-b border-slate-200 p-3 flex items-center justify-between shrink-0 bg-white">
            <MajestroniczLogo size="sm" />
            <button
              type="button"
              onClick={onToggleCollapse || onClose}
              title="Minimize navigation menu (Ctrl+B)"
              aria-label="Minimize navigation menu"
              className="h-7 w-7 rounded-none border border-slate-300 bg-slate-50 text-slate-600 hover:text-red-700 hover:bg-slate-100 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Modules List with Inline Collapsible Accordions */}
          <div className="flex-1 min-h-0 overflow-y-auto py-1 text-slate-800 divide-y divide-slate-100">
            {modules.map((mod) => {
              const Icon = mod.icon;
              const active = isModuleActive(mod, currentView);
              const visItems = mod.items.filter((it) => canAccessView(it.cap));
              const single = visItems.length <= 1;

              // Single-item module → one clickable row
              if (single) {
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => goModuleDefault(mod)}
                    className={cn(
                      'w-full text-left flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold transition-colors cursor-pointer border-l-4',
                      active
                        ? 'bg-red-50 text-red-900 border-red-600 font-extrabold'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 border-transparent'
                    )}
                  >
                    <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-red-700' : 'text-slate-500')} />
                    <span className="truncate">{mod.title}</span>
                  </button>
                );
              }

              // Multi-item module → clean inline collapsible accordion
              const isOpen = Boolean(expandedModules[mod.id]);

              return (
                <div key={mod.id} className="py-0.5">
                  <button
                    type="button"
                    onClick={() => toggleModule(mod.id)}
                    className={cn(
                      'w-full px-3 py-2 text-left text-xs font-bold flex items-center gap-2.5 transition-colors cursor-pointer border-l-4 select-none',
                      active
                        ? 'bg-slate-100/80 text-slate-900 border-red-600 font-extrabold'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 border-transparent'
                    )}
                  >
                    <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-red-700' : 'text-slate-500')} />
                    <span className="truncate flex-1">{mod.title}</span>
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 text-slate-400 transition-transform duration-200 shrink-0',
                        isOpen && 'rotate-180 text-red-600'
                      )}
                    />
                  </button>

                  {/* Sub-Items List (Inline, Tactile, No Hover Popups) */}
                  {isOpen && (
                    <div className="bg-slate-50/70 border-l-2 border-slate-300 ml-4 pl-1 my-0.5 space-y-0.5 py-1">
                      {/* Optional Primary Actions for the module (e.g. + New Quote, + Challan) */}
                      {mod.primaryActions && mod.primaryActions.length > 0 && (
                        <div className="grid grid-cols-2 gap-1 px-2 pb-1 border-b border-slate-200/80 mb-1">
                          {mod.primaryActions.map((a) => (
                            <button
                              key={a.subTabId}
                              type="button"
                              onClick={() => {
                                const actionView = mod.items[0]?.id ?? currentView;
                                navigateToTab(actionView, a.subTabId);
                                closeOnMobile();
                              }}
                              className={cn(
                                'w-full flex items-center justify-center gap-1 py-1 px-1.5 rounded-none text-[10px] font-bold border transition-colors cursor-pointer',
                                ACTION_COLOR[a.color || 'slate']
                              )}
                            >
                              <Plus className="h-2.5 w-2.5 stroke-[3]" />
                              <span className="truncate">{a.label.replace(/^\+\s*/, '')}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {visItems.map((it) => {
                        const subActive = isSubActive(it);
                        return (
                          <button
                            key={`${it.id}-${it.subTabId || ''}`}
                            type="button"
                            onClick={() => goSub(it)}
                            className={cn(
                              'w-full px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer block truncate font-medium',
                              subActive
                                ? 'bg-red-50 text-red-900 font-extrabold border-l-2 border-red-600 -ml-[2px]'
                                : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                            )}
                          >
                            {it.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* User Footer with Sign Out */}
          <div className="shrink-0 border-t border-slate-200 bg-slate-50 mt-auto sticky bottom-0 z-10 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="h-7 w-7 rounded-none bg-white border border-slate-300 flex items-center justify-center shrink-0 text-slate-700">
                  <RoleIcon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-900 truncate leading-tight">{currentUser.name}</p>
                  <p className="text-[10px] text-slate-500 font-semibold truncate leading-tight">{currentUser.role}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(true)}
                title="Sign out"
                aria-label="Sign out"
                className="h-7 px-2 rounded-none border border-slate-300 bg-white hover:bg-rose-50 text-slate-600 hover:text-rose-700 flex items-center gap-1 text-[11px] font-bold transition-colors cursor-pointer shrink-0"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Exit</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setShowLogoutConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-none bg-white border border-slate-400 shadow-lg p-5 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide">Sign out of ERP?</h2>
            <p className="text-xs text-slate-600 mt-1">You will need to enter your PIN to log back in.</p>
            <div className="flex items-center gap-2 mt-4">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-2 rounded-none border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLogoutConfirm(false);
                  logout();
                }}
                className="flex-1 py-2 rounded-none bg-red-600 hover:bg-red-700 text-white text-xs font-bold border border-red-700 cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Sidebar;
