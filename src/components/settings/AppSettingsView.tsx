import React, { useState } from 'react';
import { useThemeSettings, ErpTheme, ErpFontSize, ErpFontFamily, ShortcutConfig } from '../../context/ThemeSettingsContext';
import { useErp } from '../../context/ErpContext';
import {
  Palette,
  Keyboard,
  Check,
  RotateCcw,
  Type,
  Maximize,
  Sparkles,
  Sliders,
  AlertCircle,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';

export const AppSettingsView: React.FC = () => {
  const {
    theme,
    setTheme,
    fontSize,
    setFontSize,
    fontFamily,
    setFontFamily,
    shortcuts,
    updateShortcut,
    resetShortcuts,
    formatShortcut,
  } = useThemeSettings();

  const { setCurrentView, navigateToTab } = useErp();

  const [activeTab, setActiveTab] = useState<'appearance' | 'shortcuts'>('appearance');
  const [editingShortcut, setEditingShortcut] = useState<ShortcutConfig | null>(null);
  const [editKey, setEditKey] = useState<string>('');
  const [editCtrl, setEditCtrl] = useState<boolean>(false);
  const [editAlt, setEditAlt] = useState<boolean>(false);
  const [editShift, setEditShift] = useState<boolean>(false);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);

  // Theme definitions with preview swatches
  const THEME_OPTIONS: { id: ErpTheme; name: string; tag: string; description: string; primary: string; bg: string; border: string }[] = [
    {
      id: 'red',
      name: 'Crimson Red (Default)',
      tag: 'Accounting ERP',
      description: 'Clean slate canvas with high-visibility crimson red accents and solid tabular lines',
      primary: '#dc2626',
      bg: '#ffffff',
      border: '#cbd5e1',
    },
    {
      id: 'slate',
      name: 'Slate Accounting',
      tag: 'Monochrome Desktop',
      description: 'Classic Tally/Vyapar-style black & slate theme for maximum speed and contrast',
      primary: '#0f172a',
      bg: '#ffffff',
      border: '#94a3b8',
    },
    {
      id: 'navy',
      name: 'Navy Corporate',
      tag: 'Industrial Standard',
      description: 'Deep royal navy blue highlights for corporate and warehouse operations',
      primary: '#1e40af',
      bg: '#ffffff',
      border: '#cbd5e1',
    },
    {
      id: 'emerald',
      name: 'Emerald Financial',
      tag: 'Ledger & Cash Flow',
      description: 'Traditional accounting green palette optimized for billing desks and cash registers',
      primary: '#059669',
      bg: '#ffffff',
      border: '#cbd5e1',
    },
    {
      id: 'dark',
      name: 'Dark Slate (Night Shift)',
      tag: 'Low-Glare',
      description: 'Deep charcoal background with crisp high-contrast text for night shifts and low light',
      primary: '#ef4444',
      bg: '#0f172a',
      border: '#334155',
    },
  ];

  const FONT_OPTIONS: { id: ErpFontFamily; name: string; sample: string; desc: string }[] = [
    {
      id: 'plus-jakarta',
      name: 'Plus Jakarta Sans (Default)',
      sample: '123,456.78 · INV-2026',
      desc: 'Balanced, modern geometric sans font tailored for data-dense dashboards',
    },
    {
      id: 'inter',
      name: 'Inter',
      sample: '123,456.78 · INV-2026',
      desc: 'Industry-standard UI typography with exceptional legibility on counter displays',
    },
    {
      id: 'roboto',
      name: 'Roboto / Neutral UI',
      sample: '123,456.78 · INV-2026',
      desc: 'Classic enterprise standard with crisp vertical proportions',
    },
    {
      id: 'monospace',
      name: 'JetBrains Mono / Tabular',
      sample: '123,456.78 · INV-2026',
      desc: 'Fixed-width characters where every digit and decimal aligns strictly in columns',
    },
  ];

  const FONT_SIZES: { id: ErpFontSize; label: string; px: string; desc: string }[] = [
    { id: 'compact', label: 'Compact', px: '13px', desc: 'Highest density: fits 25% more items per invoice table' },
    { id: 'standard', label: 'Standard', px: '14px', desc: 'Default enterprise balance of comfort and density' },
    { id: 'large', label: 'Large', px: '15px', desc: 'Comfortable reading for large monitors' },
    { id: 'xlarge', label: 'Extra Large', px: '16px', desc: 'High visibility: ideal for billing touchscreens' },
  ];

  // Open shortcut edit modal
  const handleStartEditShortcut = (s: ShortcutConfig) => {
    setEditingShortcut(s);
    setEditKey(s.key);
    setEditCtrl(s.ctrl);
    setEditAlt(s.alt);
    setEditShift(s.shift);
    setConflictWarning(null);
  };

  // Check for conflict
  const checkConflict = (k: string, c: boolean, a: boolean, sh: boolean, currentId: string) => {
    const conflict = shortcuts.find(
      (s) =>
        s.id !== currentId &&
        s.key.toLowerCase() === k.toLowerCase() &&
        s.ctrl === c &&
        s.alt === a &&
        s.shift === sh
    );
    if (conflict) {
      setConflictWarning(`Shortcut already used by: "${conflict.name}"`);
    } else {
      setConflictWarning(null);
    }
  };

  const handleSaveShortcut = () => {
    if (!editingShortcut || !editKey.trim()) return;
    updateShortcut(editingShortcut.id, {
      key: editKey.trim().toLowerCase(),
      ctrl: editCtrl,
      alt: editAlt,
      shift: editShift,
    });
    toast.success(`Updated shortcut for ${editingShortcut.name}`);
    setEditingShortcut(null);
  };

  // Execute shortcut test
  const handleTestShortcut = (s: ShortcutConfig) => {
    if (s.id === 'open_sale') {
      navigateToTab('invoices', 'new');
      toast.success('Shortcut Executed: Opened New Sale');
    } else if (s.id === 'open_quote') {
      navigateToTab('invoices', 'new-quote');
      toast.success('Shortcut Executed: Opened Quotation');
    } else if (s.id === 'open_challan') {
      navigateToTab('invoices', 'challans');
      toast.success('Shortcut Executed: Opened Delivery Challans');
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
    } else {
      toast.info(`Shortcut test for ${s.name} ready`);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50 p-4 sm:p-6 text-slate-900">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white border border-slate-300 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-none">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-slate-100 border border-slate-300 flex items-center justify-center text-slate-800 shrink-0">
              <Sliders className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-extrabold uppercase tracking-wide text-slate-900">
                App Preferences & Customization
              </h1>
              <p className="text-xs text-slate-600">
                Customize appearance, theme colors, typography, and global keyboard shortcuts.
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 border border-slate-300 p-0.5 bg-slate-100 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('appearance')}
              className={cn(
                'px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5',
                activeTab === 'appearance'
                  ? 'bg-white text-red-700 shadow-xs border border-slate-300'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              <Palette className="h-3.5 w-3.5" />
              <span>Theme & Fonts</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('shortcuts')}
              className={cn(
                'px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5',
                activeTab === 'shortcuts'
                  ? 'bg-white text-red-700 shadow-xs border border-slate-300'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              <Keyboard className="h-3.5 w-3.5" />
              <span>Keyboard Shortcuts</span>
            </button>
          </div>
        </div>

        {/* TAB 1: APPEARANCE & TYPOGRAPHY */}
        {activeTab === 'appearance' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Controls (7 cols) */}
            <div className="lg:col-span-7 space-y-6">
              {/* Theme Selector */}
              <div className="bg-white border border-slate-300 p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Palette className="h-4 w-4 text-red-600" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      System Color Palette
                    </h2>
                  </div>
                  <span className="text-[11px] font-mono font-bold text-slate-500 uppercase">
                    Active: {theme}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {THEME_OPTIONS.map((opt) => {
                    const isSelected = theme === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setTheme(opt.id);
                          toast.success(`Switched theme to ${opt.name}`);
                        }}
                        className={cn(
                          'text-left p-3 border transition-all cursor-pointer relative flex flex-col justify-between gap-2',
                          isSelected
                            ? 'border-red-600 ring-2 ring-red-500/20 bg-red-50/30'
                            : 'border-slate-300 bg-white hover:bg-slate-50'
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-3.5 w-3.5 rounded-none border border-slate-400 shrink-0"
                              style={{ backgroundColor: opt.primary }}
                            />
                            <span className="text-xs font-bold text-slate-900">{opt.name}</span>
                          </div>
                          {isSelected && <Check className="h-4 w-4 text-red-600" />}
                        </div>
                        <p className="text-[11px] text-slate-500 line-clamp-2">{opt.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Font Family Selector */}
              <div className="bg-white border border-slate-300 p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Type className="h-4 w-4 text-red-600" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      Typography & Font Family
                    </h2>
                  </div>
                  <span className="text-[11px] font-mono font-bold text-slate-500 uppercase">
                    {fontFamily}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                  {FONT_OPTIONS.map((f) => {
                    const isSelected = fontFamily === f.id;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => {
                          setFontFamily(f.id);
                          toast.success(`Font family set to ${f.name}`);
                        }}
                        className={cn(
                          'p-3 border text-left transition-colors cursor-pointer flex flex-col gap-1',
                          isSelected
                            ? 'border-red-600 bg-red-50/40 text-red-900 font-bold'
                            : 'border-slate-300 bg-white hover:bg-slate-50 text-slate-800'
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold">{f.name}</span>
                          {isSelected && <Check className="h-3.5 w-3.5 text-red-600" />}
                        </div>
                        <span className="text-[11px] font-mono text-slate-600 bg-slate-100 px-1.5 py-0.5 border border-slate-200">
                          {f.sample}
                        </span>
                        <p className="text-[10px] text-slate-500 mt-0.5">{f.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Font Size & Density */}
              <div className="bg-white border border-slate-300 p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Maximize className="h-4 w-4 text-red-600" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      Display Scale & Font Size
                    </h2>
                  </div>
                  <span className="text-[11px] font-mono font-bold text-slate-500 uppercase">
                    {fontSize}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  {FONT_SIZES.map((sz) => {
                    const isSelected = fontSize === sz.id;
                    return (
                      <button
                        key={sz.id}
                        type="button"
                        onClick={() => {
                          setFontSize(sz.id);
                          toast.success(`Font size set to ${sz.label} (${sz.px})`);
                        }}
                        className={cn(
                          'p-2.5 border text-center transition-colors cursor-pointer flex flex-col items-center justify-center gap-1',
                          isSelected
                            ? 'border-red-600 bg-red-50 text-red-900 font-extrabold'
                            : 'border-slate-300 bg-white hover:bg-slate-50 text-slate-800'
                        )}
                      >
                        <span className="text-xs font-bold">{sz.label}</span>
                        <span className="font-mono text-[10px] px-1 bg-slate-100 border border-slate-200">
                          {sz.px}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right Column: Real-Time Live Preview (5 cols) */}
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-white border border-slate-300 p-4 space-y-3 sticky top-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    Live Interface Preview
                  </span>
                  <span className="text-[10px] font-mono text-emerald-600 font-bold uppercase">
                    Real-Time
                  </span>
                </div>

                {/* Sample ERP Invoice / Table Card */}
                <div className="border border-slate-300 p-3 bg-slate-50/60 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <div>
                      <span className="text-xs font-extrabold text-slate-900">TAX INVOICE</span>
                      <p className="text-[10px] font-mono text-slate-500">#INV-2026-0892</p>
                    </div>
                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-300 font-mono text-[10px] font-bold">
                      PAID IN FULL
                    </span>
                  </div>

                  <div className="text-xs space-y-1">
                    <div className="flex justify-between text-slate-600 text-[11px]">
                      <span>Customer:</span>
                      <span className="font-bold text-slate-900">Sri Krishna Automation</span>
                    </div>
                    <div className="flex justify-between text-slate-600 text-[11px]">
                      <span>GSTIN:</span>
                      <span className="font-mono text-slate-800">33AABCS1429B1Z8</span>
                    </div>
                  </div>

                  {/* Mini Table */}
                  <table className="w-full text-left text-[11px] border-collapse">
                    <thead>
                      <tr className="bg-slate-200/70 border-b border-slate-300 text-slate-700 font-bold">
                        <th className="py-1 px-1.5">Item</th>
                        <th className="py-1 px-1.5 text-right">Qty</th>
                        <th className="py-1 px-1.5 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      <tr>
                        <td className="py-1 px-1.5 font-medium">PLC Controller 24V</td>
                        <td className="py-1 px-1.5 text-right font-mono">2 NOS</td>
                        <td className="py-1 px-1.5 text-right font-mono font-bold">₹ 36,000.00</td>
                      </tr>
                      <tr>
                        <td className="py-1 px-1.5 font-medium">Proximity Sensor M12</td>
                        <td className="py-1 px-1.5 text-right font-mono">5 NOS</td>
                        <td className="py-1 px-1.5 text-right font-mono font-bold">₹ 12,500.00</td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Summary */}
                  <div className="border-t border-slate-200 pt-2 flex items-center justify-between font-mono">
                    <span className="text-xs font-bold text-slate-700">Total Net Amount:</span>
                    <span className="text-sm font-extrabold text-red-700">₹ 48,500.00</span>
                  </div>

                  {/* Action Button Preview */}
                  <div className="pt-1 flex gap-2">
                    <button
                      type="button"
                      className="flex-1 py-1.5 px-2 bg-red-600 text-white font-bold text-xs border border-red-700 flex items-center justify-center gap-1 cursor-default"
                    >
                      <span>+ Print Receipt</span>
                    </button>
                    <button
                      type="button"
                      className="py-1.5 px-3 bg-white text-slate-800 border border-slate-300 text-xs font-bold cursor-default"
                    >
                      Share PDF
                    </button>
                  </div>
                </div>

                <p className="text-[11px] text-slate-500 italic">
                  Changes automatically apply across all screens, modals, and print sheets.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: KEYBOARD SHORTCUTS */}
        {activeTab === 'shortcuts' && (
          <div className="space-y-4">
            <div className="bg-white border border-slate-300 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Customizable Keyboard Shortcuts
                  </h2>
                  <p className="text-xs text-slate-500">
                    Press these combinations anywhere to trigger immediate billing actions and navigation.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    resetShortcuts();
                    toast.success('Reset all shortcuts to default');
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 transition-colors cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Reset All Defaults</span>
                </button>
              </div>

              {/* Shortcuts Table */}
              <div className="border border-slate-300 overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold uppercase tracking-wider text-[11px]">
                      <th className="py-2.5 px-3">Action & Module</th>
                      <th className="py-2.5 px-3">Description</th>
                      <th className="py-2.5 px-3">Shortcut Key</th>
                      <th className="py-2.5 px-3 text-right">Customize</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {shortcuts.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-2.5 px-3 font-bold text-slate-900">
                          <span className="flex items-center gap-1.5">
                            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 bg-slate-100 border border-slate-300 text-slate-600 font-bold">
                              {s.category}
                            </span>
                            {s.name}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 text-xs">{s.description}</td>
                        <td className="py-2.5 px-3">
                          <kbd className="inline-flex items-center px-2 py-1 bg-slate-100 border border-slate-400 font-mono text-xs font-bold text-slate-800 shadow-2xs">
                            {formatShortcut(s)}
                          </kbd>
                        </td>
                        <td className="py-2.5 px-3 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() => handleTestShortcut(s)}
                            className="px-2 py-1 text-[11px] font-bold border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 cursor-pointer"
                          >
                            Test
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStartEditShortcut(s)}
                            className="px-2.5 py-1 text-[11px] font-bold bg-red-600 hover:bg-red-700 text-white border border-red-700 cursor-pointer"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* MODAL: EDIT SHORTCUT */}
        {editingShortcut && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4"
            onClick={() => setEditingShortcut(null)}
          >
            <div
              className="w-full max-w-md bg-white border border-slate-400 shadow-xl p-5 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                <div>
                  <h3 className="text-sm font-extrabold uppercase tracking-wide text-slate-900">
                    Customize Shortcut
                  </h3>
                  <p className="text-xs text-slate-500">{editingShortcut.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingShortcut(null)}
                  className="text-slate-400 hover:text-slate-600 font-bold"
                >
                  ✕
                </button>
              </div>

              {/* Modifiers check */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                  1. Choose Modifiers:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <label
                    className={cn(
                      'flex items-center justify-center gap-1.5 p-2 border text-xs font-bold cursor-pointer select-none',
                      editCtrl ? 'bg-red-50 border-red-600 text-red-900' : 'bg-white border-slate-300'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={editCtrl}
                      onChange={(e) => {
                        setEditCtrl(e.target.checked);
                        checkConflict(editKey, e.target.checked, editAlt, editShift, editingShortcut.id);
                      }}
                      className="rounded-none text-red-600"
                    />
                    <span>Ctrl / Cmd</span>
                  </label>

                  <label
                    className={cn(
                      'flex items-center justify-center gap-1.5 p-2 border text-xs font-bold cursor-pointer select-none',
                      editAlt ? 'bg-red-50 border-red-600 text-red-900' : 'bg-white border-slate-300'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={editAlt}
                      onChange={(e) => {
                        setEditAlt(e.target.checked);
                        checkConflict(editKey, editCtrl, e.target.checked, editShift, editingShortcut.id);
                      }}
                      className="rounded-none text-red-600"
                    />
                    <span>Alt / Option</span>
                  </label>

                  <label
                    className={cn(
                      'flex items-center justify-center gap-1.5 p-2 border text-xs font-bold cursor-pointer select-none',
                      editShift ? 'bg-red-50 border-red-600 text-red-900' : 'bg-white border-slate-300'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={editShift}
                      onChange={(e) => {
                        setEditShift(e.target.checked);
                        checkConflict(editKey, editCtrl, editAlt, e.target.checked, editingShortcut.id);
                      }}
                      className="rounded-none text-red-600"
                    />
                    <span>Shift</span>
                  </label>
                </div>
              </div>

              {/* Target Key input */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 block">
                  2. Enter Key:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={10}
                    value={editKey.toUpperCase()}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditKey(val);
                      checkConflict(val, editCtrl, editAlt, editShift, editingShortcut.id);
                    }}
                    onKeyDown={(e) => {
                      if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
                        e.preventDefault();
                        const keyName = e.key.length === 1 ? e.key.toUpperCase() : e.key;
                        setEditKey(keyName);
                        checkConflict(keyName, editCtrl, editAlt, editShift, editingShortcut.id);
                      }
                    }}
                    placeholder="Press a key (e.g. S, Q, 1)"
                    className="w-full px-3 py-2 border border-slate-300 text-sm font-mono font-bold uppercase focus:border-red-600 focus:outline-none"
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  You can type or press any key on your keyboard.
                </p>
              </div>

              {/* Conflict warning */}
              {conflictWarning && (
                <div className="p-2.5 bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>{conflictWarning}</span>
                </div>
              )}

              {/* Result Preview */}
              <div className="p-2.5 bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                <span className="text-slate-600 font-bold">New Combination:</span>
                <kbd className="px-2 py-1 bg-white border border-slate-300 font-mono font-bold text-slate-900">
                  {formatShortcut({
                    ...editingShortcut,
                    key: editKey || '?',
                    ctrl: editCtrl,
                    alt: editAlt,
                    shift: editShift,
                  })}
                </kbd>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingShortcut(null)}
                  className="flex-1 py-2 bg-white border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveShortcut}
                  disabled={!editKey.trim()}
                  className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold border border-red-700 cursor-pointer disabled:opacity-50"
                >
                  Save Shortcut
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AppSettingsView;
