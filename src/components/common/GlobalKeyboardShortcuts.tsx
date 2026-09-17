import React, { useEffect, useState } from 'react';
import { useErp, ActiveNavView } from '../../context/ErpContext';
import { BranchScope, VIEW_LABELS } from '../../types';
import { Keyboard, X, ArrowLeft, ArrowRight, CornerDownLeft } from 'lucide-react';

// Sidebar order — number keys jump to the Nth module the current role can open.
const NAV_ORDER: ActiveNavView[] = [
  'dashboard', 'items', 'customers', 'enquiries', 'pending-orders', 'challans',
  'inventory', 'invoices', 'barcodes', 'cash-register', 'purchases', 'hrm',
  'reports', 'ai-assistant', 'access',
];

/**
 * App-wide keyboard navigation. Press ? for the cheat-sheet.
 * - 1–9, 0 : jump to a module (in sidebar order, filtered by access)
 * - ← / →  : switch branch (CEO cycles All + every branch)
 * - ?      : toggle this help
 * - Esc    : close help
 * Ignored while typing in inputs / with modifier keys held.
 */
export const GlobalKeyboardShortcuts: React.FC = () => {
  const { setCurrentView, canAccessView, switchBranch, currentUser, currentBranch, accessibleBranches } = useErp();
  const [showHelp, setShowHelp] = useState(false);

  const visibleViews = NAV_ORDER.filter((v) => canAccessView(v));
  const branchCycle: BranchScope[] =
    currentUser.role === 'CEO' ? ['all', ...accessibleBranches.map((b) => b.id)] : accessibleBranches.map((b) => b.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

      if (e.key === 'Escape') { setShowHelp(false); return; }
      if (typing) return;

      if (e.key === '?') { e.preventDefault(); setShowHelp((s) => !s); return; }

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

      if (/^[0-9]$/.test(e.key)) {
        const idx = e.key === '0' ? 9 : parseInt(e.key, 10) - 1;
        const view = visibleViews[idx];
        if (view) { e.preventDefault(); setCurrentView(view); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visibleViews, branchCycle, currentBranch, currentUser.role]);

  if (!showHelp) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setShowHelp(false)}>
      <div className="w-full max-w-lg rounded-xl bg-white border border-slate-200 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700"><Keyboard className="h-4.5 w-4.5" /></div>
            <div>
              <h2 className="text-sm font-extrabold text-slate-900">Keyboard Shortcuts</h2>
              <p className="text-[11px] text-slate-500">Navigate faster without the mouse</p>
            </div>
          </div>
          <button onClick={() => setShowHelp(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Global keys */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <Row keys={[<ArrowLeft className="h-3.5 w-3.5" key="l" />, <ArrowRight className="h-3.5 w-3.5" key="r" />]} label="Switch branch" />
            <Row keys={['?']} label="Toggle this help" />
            <Row keys={['Esc']} label="Close popups" />
            <Row keys={[<CornerDownLeft className="h-3.5 w-3.5" key="e" />]} label="Confirm / open selected" />
          </div>

          {/* Numbered modules */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Jump to module</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {visibleViews.map((v, i) => (
                <div key={v} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
                  <kbd className="h-6 w-6 rounded-md bg-white border border-slate-300 shadow-2xs flex items-center justify-center text-xs font-bold text-slate-700">
                    {i === 9 ? '0' : i < 9 ? i + 1 : '·'}
                  </kbd>
                  <span className="text-xs font-semibold text-slate-700">{VIEW_LABELS[v] || v}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-2">Number keys 1–9 and 0 open the first ten modules above.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

const Row: React.FC<{ keys: React.ReactNode[]; label: string }> = ({ keys, label }) => (
  <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
    <span className="flex items-center gap-1">
      {keys.map((k, i) => (
        <kbd key={i} className="h-6 min-w-6 px-1.5 rounded-md bg-white border border-slate-300 shadow-2xs flex items-center justify-center text-xs font-bold text-slate-700">{k}</kbd>
      ))}
    </span>
    <span className="text-xs font-semibold text-slate-700">{label}</span>
  </div>
);
