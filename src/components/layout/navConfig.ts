import React from 'react';
import { ActiveNavView } from '../../context/ErpContext';
import {
  LayoutDashboard,
  Users,
  Boxes,
  Receipt,
  ShoppingBag,
  Wallet,
  BarChart3,
  Settings,
  ClipboardList,
  CalendarCheck,
  Sparkles,
} from 'lucide-react';

/**
 * Single source of truth for the two-level navigation: the primary rail renders
 * the modules; the secondary sidebar renders the active module's sub-sections and
 * primary actions. Both consume this so nothing is defined twice.
 *
 * Sub-section ids (id + subTabId) intentionally match what each view already
 * responds to via `navigateToTab` / `activeSubTab`, so navigation behaves exactly
 * as it does today.
 */
export interface NavSub {
  id: ActiveNavView;
  subTabId?: string;
  label: string;
  cap: ActiveNavView; // permission view used for canAccessView()
}

export interface NavAction {
  label: string;
  subTabId: string;
  color?: 'red' | 'slate' | 'emerald';
}

export interface NavModule {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  primaryActions?: NavAction[];
  items: NavSub[];
}

export const NAV_MODULES: NavModule[] = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    icon: LayoutDashboard,
    items: [{ id: 'dashboard', label: 'Dashboard', cap: 'dashboard' }],
  },
  {
    id: 'ai-assistant',
    title: 'AI Assistant',
    icon: Sparkles,
    items: [{ id: 'ai-assistant', label: 'AI Assistant', cap: 'ai-assistant' }],
  },
  {
    id: 'sales',
    title: 'Sales',
    icon: Receipt,
    primaryActions: [
      { label: '+ New Sale', subTabId: 'new', color: 'red' },
      { label: '+ New Quote', subTabId: 'new-quote', color: 'slate' },
    ],
    items: [
      { id: 'invoices', subTabId: 'ledger', label: 'Sale Invoices', cap: 'invoices' },
      { id: 'estimates', subTabId: 'estimates', label: 'Quotations / Estimates', cap: 'invoices' },
      { id: 'invoices', subTabId: 'challans', label: 'Delivery Challans', cap: 'challans' },
      { id: 'invoices', subTabId: 'returns', label: 'Sale Returns', cap: 'invoices' },
      { id: 'invoices', subTabId: 'draft-sales', label: 'Saved Sale Drafts', cap: 'invoices' },
      { id: 'invoices', subTabId: 'draft-quotes', label: 'Saved Quote Drafts', cap: 'invoices' },
      { id: 'enquiries', label: 'Enquiries', cap: 'enquiries' },
    ],
  },
  {
    id: 'enquiries',
    title: 'Enquiries',
    icon: ClipboardList,
    items: [
      { id: 'enquiries', subTabId: 'all', label: 'All Enquiries', cap: 'enquiries' },
      { id: 'enquiries', subTabId: 'new-item-requests', label: 'New Item Requests', cap: 'enquiries' },
      { id: 'pending-orders', label: 'Pending Orders', cap: 'pending-orders' },
    ],
  },
  {
    id: 'parties',
    title: 'Parties',
    icon: Users,
    items: [
      { id: 'parties', subTabId: 'customers', label: 'Customers', cap: 'parties' },
      { id: 'parties', subTabId: 'suppliers', label: 'Suppliers', cap: 'parties' },
      { id: 'parties', subTabId: 'all', label: 'All Parties', cap: 'parties' },
      { id: 'parties', subTabId: 'loyalty', label: 'Loyalty Program', cap: 'parties' },
    ],
  },
  {
    id: 'items',
    title: 'Items & Stock',
    icon: Boxes,
    items: [
      { id: 'items', subTabId: 'products', label: 'Item Catalog', cap: 'items' },
      { id: 'items', subTabId: 'combos', label: 'Combos & Bundles', cap: 'items' },
      { id: 'inventory', subTabId: 'items', label: 'Stock Inventory', cap: 'inventory' },
      { id: 'inventory', subTabId: 'transfer-history', label: 'Transfer History', cap: 'inventory' },
      { id: 'inventory', subTabId: 'audit', label: 'Stock Audit Trail', cap: 'inventory' },
      { id: 'barcodes', label: 'Barcode Generator', cap: 'barcodes' },
    ],
  },
  {
    id: 'purchases',
    title: 'Purchases',
    icon: ShoppingBag,
    items: [
      { id: 'purchases', subTabId: 'orders', label: 'Purchase Orders', cap: 'purchases' },
    ],
  },
  {
    id: 'cash-bank',
    title: 'Cash & Bank',
    icon: Wallet,
    items: [
      { id: 'cash-register', subTabId: 'register', label: 'Daily Cash Register', cap: 'cash-register' },
      { id: 'cash-register', subTabId: 'recurring', label: 'Recurring Expenses', cap: 'cash-register' },
      { id: 'cash-register', subTabId: 'history', label: 'Register History', cap: 'cash-register' },
    ],
  },
  {
    id: 'reports',
    title: 'Reports',
    icon: BarChart3,
    items: [
      { id: 'reports', subTabId: 'sales', label: 'Sales Register', cap: 'reports' },
      { id: 'reports', subTabId: 'pnl', label: 'Profit & Loss Statement', cap: 'reports' },
      { id: 'reports', subTabId: 'stock-valuation', label: 'Stock Valuation', cap: 'reports' },
      { id: 'reports', subTabId: 'enquiry-conversion', label: 'Enquiry Conversion', cap: 'reports' },
      { id: 'reports', subTabId: 'purchase-orders', label: 'PO Procurement', cap: 'reports' },
      { id: 'reports', subTabId: 'gst', label: 'GST Filing (GSTR-1 & 3B)', cap: 'reports' },
      { id: 'reports', subTabId: 'itc', label: 'Input Tax Credit', cap: 'reports' },
      // These three were reachable only on mobile — the desktop tab strip is
      // lg:hidden, so without a sidebar entry they couldn't be opened at all on a
      // desktop screen (RPT2-7).
      { id: 'reports', subTabId: 'expenses', label: 'Expense Report', cap: 'reports' },
      { id: 'reports', subTabId: 'payments', label: 'Payments Log', cap: 'reports' },
      { id: 'reports', subTabId: 'audit', label: 'Audit Trail', cap: 'reports' },
      { id: 'reports', subTabId: 'payroll', label: 'Payroll Summary', cap: 'reports' },
    ],
  },
  {
    id: 'staff',
    title: 'Staff & Payroll',
    icon: CalendarCheck,
    items: [
      { id: 'hrm', subTabId: 'attendance', label: 'Attendance', cap: 'hrm' },
      { id: 'hrm', subTabId: 'payroll', label: 'Payroll', cap: 'hrm' },
      { id: 'hrm', subTabId: 'employees', label: 'Staff Directory', cap: 'hrm' },
      { id: 'hrm', subTabId: 'salary', label: 'Salary Structure', cap: 'hrm' },
    ],
  },
  // NOTE: "Online Store" (shopify) moved to the top bar — it is no longer a left-nav
  // module (avoids duplicating the entry in two places). The ShopifyView still renders
  // when currentView === 'shopify' and keeps its own internal sub-tabs.
  {
    id: 'settings',
    title: 'Settings',
    icon: Settings,
    items: [
      { id: 'settings', subTabId: 'appearance', label: 'Themes & Typography', cap: 'settings' },
      { id: 'settings', subTabId: 'shortcuts', label: 'Keyboard Shortcuts', cap: 'settings' },
      { id: 'access', label: 'Access Control', cap: 'access' },
    ],
  },
];

/** Is a module the active one, given the current view? */
export const isModuleActive = (mod: NavModule, currentView: ActiveNavView): boolean =>
  mod.items.some((it) => it.id === currentView || (it.id === 'parties' && currentView === 'customers'));
