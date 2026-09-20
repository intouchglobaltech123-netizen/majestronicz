import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type ErpTheme = 'red' | 'slate' | 'navy' | 'emerald' | 'dark';
export type ErpFontSize = 'compact' | 'standard' | 'large' | 'xlarge';
export type ErpFontFamily = 'plus-jakarta' | 'inter' | 'roboto' | 'monospace';

export interface ShortcutConfig {
  id: string;
  name: string;
  description: string;
  category: 'Actions' | 'Navigation' | 'System';
  key: string; // e.g. 's', 'q', 'd', 'k', '1', 'f11'
  ctrl: boolean; // Ctrl on Windows/Linux, Cmd/Ctrl on macOS
  alt: boolean;
  shift: boolean;
}

export const DEFAULT_SHORTCUTS: ShortcutConfig[] = [
  {
    id: 'open_sale',
    name: 'New Sale (+ ADD SALE)',
    description: 'Open the billing screen to create a new sale invoice',
    category: 'Actions',
    key: 's',
    ctrl: true,
    alt: false,
    shift: false,
  },
  {
    id: 'open_quote',
    name: 'New Quotation / Estimate',
    description: 'Open the quotation builder tab',
    category: 'Actions',
    key: 'q',
    ctrl: true,
    alt: false,
    shift: false,
  },
  {
    id: 'open_challan',
    name: 'New Delivery Challan',
    description: 'Open the delivery challan builder tab',
    category: 'Actions',
    key: 'd',
    ctrl: true,
    alt: false,
    shift: false,
  },
  {
    id: 'open_search',
    name: 'Global Search (Spotlight)',
    description: 'Focus the quick search box in the header',
    category: 'Actions',
    key: 'k',
    ctrl: true,
    alt: false,
    shift: false,
  },
  {
    id: 'nav_dashboard',
    name: 'Go to Dashboard',
    description: 'Jump to the main management dashboard',
    category: 'Navigation',
    key: '1',
    ctrl: false,
    alt: true,
    shift: false,
  },
  {
    id: 'nav_sales',
    name: 'Go to Sales & Invoices',
    description: 'Jump to sales register and invoices view',
    category: 'Navigation',
    key: '2',
    ctrl: false,
    alt: true,
    shift: false,
  },
  {
    id: 'nav_parties',
    name: 'Go to Parties / Customers',
    description: 'Jump to customer and vendor directory',
    category: 'Navigation',
    key: '3',
    ctrl: false,
    alt: true,
    shift: false,
  },
  {
    id: 'nav_items',
    name: 'Go to Items & Stock',
    description: 'Jump to item catalog and inventory',
    category: 'Navigation',
    key: '4',
    ctrl: false,
    alt: true,
    shift: false,
  },
  {
    id: 'nav_cash',
    name: 'Go to Daily Cash Register',
    description: 'Jump to cash register and expense tracking',
    category: 'Navigation',
    key: '5',
    ctrl: false,
    alt: true,
    shift: false,
  },
  {
    id: 'nav_reports',
    name: 'Go to Reports',
    description: 'Jump to business and tax reports',
    category: 'Navigation',
    key: '6',
    ctrl: false,
    alt: true,
    shift: false,
  },
  {
    id: 'toggle_fullscreen',
    name: 'Toggle Full Screen',
    description: 'Expand to or exit full screen mode',
    category: 'System',
    key: 'F11',
    ctrl: false,
    alt: false,
    shift: false,
  },
  {
    id: 'open_help',
    name: 'Keyboard Cheat Sheet',
    description: 'Show dialog of all active keyboard shortcuts',
    category: 'System',
    key: '?',
    ctrl: false,
    alt: false,
    shift: false,
  },
];

interface ThemeSettingsContextType {
  theme: ErpTheme;
  setTheme: (theme: ErpTheme) => void;
  fontSize: ErpFontSize;
  setFontSize: (size: ErpFontSize) => void;
  fontFamily: ErpFontFamily;
  setFontFamily: (font: ErpFontFamily) => void;
  shortcuts: ShortcutConfig[];
  updateShortcut: (id: string, updates: Partial<Pick<ShortcutConfig, 'key' | 'ctrl' | 'alt' | 'shift'>>) => void;
  resetShortcuts: () => void;
  formatShortcut: (s: ShortcutConfig) => string;
}

const ThemeSettingsContext = createContext<ThemeSettingsContextType | undefined>(undefined);

const THEME_STORAGE_KEY = 'majestronicz_theme_settings';
const SHORTCUTS_STORAGE_KEY = 'majestronicz_custom_shortcuts';

export const ThemeSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ErpTheme>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.theme) return parsed.theme;
      }
    } catch {}
    return 'red';
  });

  const [fontSize, setFontSizeState] = useState<ErpFontSize>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.fontSize) return parsed.fontSize;
      }
    } catch {}
    return 'standard';
  });

  const [fontFamily, setFontFamilyState] = useState<ErpFontFamily>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.fontFamily) return parsed.fontFamily;
      }
    } catch {}
    return 'plus-jakarta';
  });

  const [shortcuts, setShortcuts] = useState<ShortcutConfig[]>(() => {
    try {
      const saved = localStorage.getItem(SHORTCUTS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Merge with defaults in case new shortcuts were introduced
          return DEFAULT_SHORTCUTS.map((def) => {
            const match = parsed.find((p: any) => p.id === def.id);
            return match ? { ...def, ...match } : def;
          });
        }
      }
    } catch {}
    return DEFAULT_SHORTCUTS;
  });

  // Apply theme, font size, and font family to DOM
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const body = document.body;

    // Font Family Map
    const fontFamilies: Record<ErpFontFamily, string> = {
      'plus-jakarta': "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      'inter': "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      'roboto': "'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
      'monospace': "'JetBrains Mono', 'Courier New', Courier, monospace",
    };

    // Font Size Map
    const fontSizes: Record<ErpFontSize, string> = {
      compact: '13px',
      standard: '14px',
      large: '15px',
      xlarge: '16px',
    };

    const chosenFont = fontFamilies[fontFamily] || fontFamilies['plus-jakarta'];
    const chosenSize = fontSizes[fontSize] || fontSizes.standard;

    root.style.setProperty('--erp-font-family', chosenFont);
    root.style.setProperty('--erp-font-size', chosenSize);
    root.setAttribute('data-theme', theme);

    body.style.fontFamily = chosenFont;
    body.style.fontSize = chosenSize;

    // Save preferences
    try {
      localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify({ theme, fontSize, fontFamily })
      );
    } catch {}
  }, [theme, fontSize, fontFamily]);

  const setTheme = useCallback((t: ErpTheme) => {
    setThemeState(t);
  }, []);

  const setFontSize = useCallback((s: ErpFontSize) => {
    setFontSizeState(s);
  }, []);

  const setFontFamily = useCallback((f: ErpFontFamily) => {
    setFontFamilyState(f);
  }, []);

  const updateShortcut = useCallback(
    (id: string, updates: Partial<Pick<ShortcutConfig, 'key' | 'ctrl' | 'alt' | 'shift'>>) => {
      setShortcuts((prev) => {
        const next = prev.map((s) => (s.id === id ? { ...s, ...updates } : s));
        try {
          localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    []
  );

  const resetShortcuts = useCallback(() => {
    setShortcuts(DEFAULT_SHORTCUTS);
    try {
      localStorage.removeItem(SHORTCUTS_STORAGE_KEY);
    } catch {}
  }, []);

  const formatShortcut = useCallback((s: ShortcutConfig): string => {
    const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    const parts: string[] = [];
    if (s.ctrl) parts.push(isMac ? 'Cmd' : 'Ctrl');
    if (s.alt) parts.push(isMac ? 'Option' : 'Alt');
    if (s.shift) parts.push('Shift');
    parts.push(s.key.toUpperCase());
    return parts.join(' + ');
  }, []);

  return (
    <ThemeSettingsContext.Provider
      value={{
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
      }}
    >
      {children}
    </ThemeSettingsContext.Provider>
  );
};

export const useThemeSettings = () => {
  const context = useContext(ThemeSettingsContext);
  if (!context) {
    throw new Error('useThemeSettings must be used within a ThemeSettingsProvider');
  }
  return context;
};

