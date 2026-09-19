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

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  onToggle?: () => void;
  mobileOpen?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen, onClose }) => {
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

  // Track mobile viewport (< lg): mobile drawer shows an accordion (no secondary
  // column there); desktop shows a modules-only rail + the SecondarySidebar.
  const [isMobile, setIsMobile] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const modules = NAV_MODULES.filter((m) => m.items.some((it) => canAccessView(it.cap)));

  const activeModuleId = modules.find((m) => isModuleActive(m, currentView))?.id ?? null;
  const [expanded, setExpanded] = useState<string | null>(activeModuleId);
  useEffect(() => {
    if (activeModuleId) setExpanded(activeModuleId);
  }, [activeModuleId]);

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
    return viewMatch && (!it.subTabId || activeSubTab?.tab === it.subTabId);
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
          'bg-white border-r border-slate-300 flex flex-col h-screen h-[100dvh] max-h-[100dvh] select-none shadow-none',
          'fixed inset-y-0 left-0 z-50 max-w-[85vw] transition-transform duration-200 ease-in-out',
          isMobileDrawerOpen ? 'translate-x-0 w-64' : '-translate-x-full w-64 pointer-events-none',
          // Desktop: a compact modules rail (sub-nav lives in the SecondarySidebar)
          'lg:static lg:z-20 lg:translate-x-0 lg:shrink-0 lg:w-52 lg:opacity-100 lg:pointer-events-auto'
        )}
      >
        <div className="w-64 lg:w-52 min-w-0 h-full flex flex-col overflow-hidden">
          {/* Brand Header */}
          <div className="border-b border-slate-200 p-3 flex items-center justify-between shrink-0 bg-white">
            <MajestroniczLogo size="sm" />
            <button
              type="button"
              onClick={onClose}
              title="Close menu"
              aria-label="Close menu"
              className="lg:hidden h-7 w-7 rounded-none border border-slate-300 bg-slate-50 text-slate-600 hover:text-red-700 hover:bg-slate-100 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Quick Action: + Add Sale (global CTA) */}
          <div className="p-2.5 border-b border-slate-200 bg-slate-50/70 shrink-0">
            <button
              type="button"
              onClick={() => { navigateToTab('invoices', 'new'); closeOnMobile(); }}
              className="w-full py-2 px-3 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-none flex items-center justify-center gap-1.5 transition-colors border border-red-700 cursor-pointer shadow-none"
              title="Create New Sale"
            >
              <Plus className="h-3.5 w-3.5 stroke-[3]" />
              <span>ADD SALE</span>
            </button>
          </div>

          {/* Modules */}
          <div className="flex-1 min-h-0 overflow-y-auto py-1 text-slate-800">
            {modules.map((mod) => {
              const Icon = mod.icon;
              const active = isModuleActive(mod, currentView);
              const visItems = mod.items.filter((it) => canAccessView(it.cap));
              const single = visItems.length <= 1;

              // Desktop rail OR single-item module → one clickable row
              if (!isMobile || single) {
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => goModuleDefault(mod)}
                    className={cn(
                      'w-full text-left flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold transition-colors cursor-pointer border-l-4',
                      active
                        ? 'bg-red-50 text-red-900 border-red-600'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 border-transparent'
                    )}
                  >
                    <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-red-700' : 'text-slate-500')} />
                    <span className="truncate">{mod.title}</span>
                  </button>
                );
              }

              // Mobile accordion (no secondary column on mobile)
              const isOpen = expanded === mod.id || active;
              return (
                <div key={mod.id}>
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : mod.id)}
                    className={cn(
                      'w-full px-3 py-2.5 text-left text-xs font-bold flex items-center gap-2.5 transition-colors cursor-pointer border-l-4',
                      active
                        ? 'bg-slate-100/70 text-slate-900 border-red-600'
                        : 'text-slate-700 hover:bg-slate-100 border-transparent'
                    )}
                  >
                    <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-red-700' : 'text-slate-500')} />
                    <span className="truncate flex-1">{mod.title}</span>
                    <ChevronDown className={cn('h-3.5 w-3.5 text-slate-400 transition-transform', isOpen && 'rotate-180 text-red-600')} />
                  </button>
                  {isOpen && (
                    <div className="bg-slate-50/60 border-l-2 border-slate-300 ml-3 my-0.5">
                      {visItems.map((it) => (
                        <button
                          key={`${it.id}-${it.subTabId || ''}`}
                          type="button"
                          onClick={() => goSub(it)}
                          className={cn(
                            'w-full px-3 py-1.5 text-left text-xs transition-colors cursor-pointer block truncate font-medium',
                            isSubActive(it)
                              ? 'bg-red-50 text-red-900 font-extrabold border-l-3 border-red-600 -ml-[2px]'
                              : 'text-slate-700 hover:bg-slate-100'
                          )}
                        >
                          {it.label}
                        </button>
                      ))}
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
                onClick={() => { setShowLogoutConfirm(false); logout(); }}
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
