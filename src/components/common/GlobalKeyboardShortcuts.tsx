import React, { useEffect, useState } from 'react';
import { useErp, ActiveNavView } from '../../context/ErpContext';
import { useThemeSettings } from '../../context/ThemeSettingsContext';
import { BranchScope } from '../../types';
import { Keyboard, X, Sliders, ExternalLink, Zap, Compass, Monitor } from 'lucide-react';
import { toast } from 'sonner';
import { getIsFullscreen, enterNativeFullscreen, exitNativeFullscreen } from '../../lib/utils';

// Sidebar order — number keys jump to the Nth module the current role can open.
const NAV_ORDER: ActiveNavView[] = [
  'dashboard', 'items', 'customers', 'enquiries', 'pending-orders', 'challans',
  'inventory', 'invoices', 'barcodes', 'cash-register', 'purchases', 'hrm',
  'reports', 'ai-assistant', 'access',
];

/**
 * App-wide keyboard navigation with user-customizable shortcuts.
 * - Custom shortcuts defined in ThemeSettingsContext (e.g. Ctrl+S, Ctrl+Q, Ctrl+D, Ctrl+K)
 * - Intercepts browser defaults (e.g. Ctrl+S save webpage dialog)
 * - 1–9, 0 : jump to a module (in sidebar order, filtered by access)
 * - ← / →  : switch branch (CEO cycles All + every branch)
 * - ?      : toggle this cheat sheet
 * - Esc    : close popups
 */
export const GlobalKeyboardShortcuts: React.FC = () => {
  const {
    setCurrentView,
    canAccessView,
    switchBranch,
    currentUser,
    currentBranch,
    accessibleBranches,
    navigateToTab,
  } = useErp();

  const { shortcuts, formatShortcut } = useThemeSettings();
  const [showHelp, setShowHelp] = useState(false);

  const visibleViews = NAV_ORDER.filter((v) => canAccessView(v));
  const branchCycle: BranchScope[] =
    currentUser.role === 'CEO' ? ['all', ...accessibleBranches.map((b) => b.id)] : accessibleBranches.map((b) => b.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const isTyping = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

      const isCtrlPressed = e.ctrlKey || e.metaKey;
      const isAltPressed = e.altKey;
      const isShiftPressed = e.shiftKey;
      const eventKeyLower = e.key.toLowerCase();

      // Check user-configured shortcuts
      for (const s of shortcuts) {
        const targetKeyLower = s.key.toLowerCase();
        const matchesCtrl = s.ctrl ? isCtrlPressed : !isCtrlPressed;
        const matchesAlt = s.alt ? isAltPressed : !isAltPressed;
        const matchesShift = s.shift ? isShiftPressed : !isShiftPressed;

        let matchesKey = false;
        if (targetKeyLower === 'f11') {
          matchesKey = eventKeyLower === 'f11';
        } else if (targetKeyLower === '?') {
          matchesKey = e.key === '?';
        } else {
          matchesKey = eventKeyLower === targetKeyLower;
        }

        if (matchesCtrl && matchesAlt && matchesShift && matchesKey) {
          // If shortcut is a plain key (no Ctrl/Alt), ignore while typing in inputs
          if (isTyping && !s.ctrl && !s.alt) {
            return;
          }

          e.preventDefault();
          e.stopPropagation();

          // Dispatch action
          if (s.id === 'open_sale') {
            navigateToTab('invoices', 'new');
            toast.success('Shortcut: New Sale opened', { duration: 1500 });
          } else if (s.id === 'open_quote') {
            navigateToTab('invoices', 'new-quote');
            toast.success('Shortcut: Quotation opened', { duration: 1500 });
          } else if (s.id === 'open_challan') {
            navigateToTab('invoices', 'new-challan');
            toast.success('Shortcut: Delivery Challan opened', { duration: 1500 });
          } else if (s.id === 'open_search') {
            const searchInput = document.getElementById('global-search-input') as HTMLInputElement | null;
            if (searchInput) {
              searchInput.focus();
              searchInput.select();
            }
          } else if (s.id === 'nav_dashboard') {
            setCurrentView('dashboard');
          } else if (s.id === 'nav_sales') {
            setCurrentView('invoices');
          } else if (s.id === 'nav_parties') {
            setCurrentView('parties');
          } else if (s.id === 'nav_items') {
            setCurrentView('items');
          } else if (s.id === 'nav_cash') {
            setCurrentView('cash-register');
          } else if (s.id === 'nav_reports') {
            setCurrentView('reports');
          } else if (s.id === 'toggle_fullscreen') {
            if (getIsFullscreen()) {
              exitNativeFullscreen();
            } else {
              enterNativeFullscreen();
            }
          } else if (s.id === 'open_help') {
            setShowHelp((prev) => !prev);
          }
          return;
        }
      }

      // Close cheat sheet on Escape
      if (e.key === 'Escape') {
        setShowHelp(false);
        return;
      }

      // Ignore remaining plain navigation shortcuts if user is typing or holding modifiers
      if (isTyping || isCtrlPressed || isAltPressed) return;

      // Fallback cheat sheet toggle on '?'
      if (e.key === '?') {
        e.preventDefault();
        setShowHelp((s) => !s);
        return;
      }

      // Arrow navigation to switch branch
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (branchCycle.length <= 1) return;
        e.preventDefault();
        const idx = Math.max(0, branchCycle.indexOf(currentBranch));
        const next = e.key === 'ArrowRight'
          ? branchCycle[(idx + 1) % branchCycle.length]
          : branchCycle[(idx - 1 + branchCycle.length) % branchCycle.length];
        switchBranch(next);
        return;
      }

      // Module jump by number 1-9, 0
      if (/^[0-9]$/.test(e.key)) {
        const idx = e.key === '0' ? 9 : parseInt(e.key, 10) - 1;
        const view = visibleViews[idx];
        if (view) {
          e.preventDefault();
          setCurrentView(view);
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcuts, visibleViews, branchCycle, currentBranch, currentUser.role, navigateToTab, setCurrentView, switchBranch]);

  if (!showHelp) return null;

  const actionShortcuts = shortcuts.filter((s) => s.category === 'Actions');
  const navShortcuts = shortcuts.filter((s) => s.category === 'Navigation');
  const sysShortcuts = shortcuts.filter((s) => s.category === 'System');

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
      onClick={() => setShowHelp(false)}
    >
      <div
        className="w-full max-w-2xl bg-white border border-slate-300 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-300 bg-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 bg-red-50 border border-red-200 flex items-center justify-center text-red-600">
              <Keyboard className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold uppercase tracking-wide text-slate-900">
                Active Keyboard Shortcuts
              </h2>
              <p className="text-[11px] text-slate-600">
                Fast keyboard navigation configured for your workflow
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setShowHelp(false);
                navigateToTab('settings', 'shortcuts');
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 transition-colors cursor-pointer"
            >
              <Sliders className="h-3 w-3 text-red-600" />
              <span>Customize</span>
            </button>

            <button
              type="button"
              onClick={() => setShowHelp(false)}
              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors cursor-pointer"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Shortcuts Body */}
        <div className="p-5 space-y-5 max-h-[72vh] overflow-y-auto divide-y divide-slate-200">
          {/* Action Shortcuts */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-red-700">
              <Zap className="h-3.5 w-3.5" />
              <span>ERP Billing & Actions</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {actionShortcuts.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between p-2 bg-slate-50 border border-slate-200"
                >
                  <span className="text-xs font-bold text-slate-800">{s.name}</span>
                  <kbd className="px-2 py-0.5 font-mono text-xs font-extrabold bg-white border border-slate-300 text-red-700 shadow-2xs">
                    {formatShortcut(s)}
                  </kbd>
                </div>
              ))}
            </div>
          </div>

          {/* Navigation Shortcuts */}
          <div className="pt-4 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-700">
              <Compass className="h-3.5 w-3.5" />
              <span>Section Navigation</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {navShortcuts.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between p-2 bg-slate-50 border border-slate-200"
                >
                  <span className="text-xs font-medium text-slate-800">{s.name}</span>
                  <kbd className="px-2 py-0.5 font-mono text-xs font-extrabold bg-white border border-slate-300 text-slate-800 shadow-2xs">
                    {formatShortcut(s)}
                  </kbd>
                </div>
              ))}
            </div>
          </div>

          {/* System & Global keys */}
          <div className="pt-4 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-700">
              <Monitor className="h-3.5 w-3.5" />
              <span>System & Quick Keys</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {sysShortcuts.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between p-2 bg-slate-50 border border-slate-200"
                >
                  <span className="text-xs font-medium text-slate-800">{s.name}</span>
                  <kbd className="px-2 py-0.5 font-mono text-xs font-extrabold bg-white border border-slate-300 text-slate-800 shadow-2xs">
                    {formatShortcut(s)}
                  </kbd>
                </div>
              ))}
              <div className="flex items-center justify-between p-2 bg-slate-50 border border-slate-200">
                <span className="text-xs font-medium text-slate-800">Switch Branch</span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 font-mono text-xs font-extrabold bg-white border border-slate-300 text-slate-800 shadow-2xs">←</kbd>
                  <kbd className="px-1.5 py-0.5 font-mono text-xs font-extrabold bg-white border border-slate-300 text-slate-800 shadow-2xs">→</kbd>
                </span>
              </div>
              <div className="flex items-center justify-between p-2 bg-slate-50 border border-slate-200">
                <span className="text-xs font-medium text-slate-800">Close Dialog / Esc</span>
                <kbd className="px-2 py-0.5 font-mono text-xs font-extrabold bg-white border border-slate-300 text-slate-800 shadow-2xs">
                  Esc
                </kbd>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-300 flex items-center justify-between text-xs text-slate-600">
          <span>All shortcuts can be remapped in <strong>App Preferences & Themes</strong></span>
          <button
            type="button"
            onClick={() => {
              setShowHelp(false);
              navigateToTab('settings', 'shortcuts');
            }}
            className="text-red-600 font-bold hover:underline inline-flex items-center gap-1 cursor-pointer"
          >
            <span>Open Settings</span>
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
};

