import React from 'react';
import { ActiveNavView } from '../../context/ErpContext';
import {
  LayoutDashboard,
  Boxes,
  Layers,
  Barcode,
  ShoppingBag,
  BarChart3,
  ShieldCheck,
  Contact,
  ShoppingCart,
  Truck,
  Receipt,
  ClipboardList,
  Wallet,
  Users,
  Clock,
  Download,
  Sparkles,
  Plus,
  FileText,
  RotateCcw,
  Save,
  History,
  Settings,
  Eye,
  Camera,
  CalendarCheck,
  DollarSign,
  TrendingUp,
  PieChart,
  ArrowRightLeft,
  Building2,
  UserPlus,
  FileSpreadsheet,
  Package,
  Award,
  Repeat,
  Briefcase,
  Store,
  ClipboardCheck,
  PackagePlus,
} from 'lucide-react';

export interface NavSubOption {
  id: string;
  label: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  tag?: 'Tab' | 'Action' | 'Filter' | 'Preset';
}

export interface NavItemSubConfig {
  id: ActiveNavView;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string; // Tailwind color name for styling
  primaryAction?: {
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  };
  subOptions: NavSubOption[];
}

export const NAV_SUB_CONFIG: Record<ActiveNavView, NavItemSubConfig> = {
  // Dashboard is a unified single screen — no secondary sidebar needed!
  dashboard: {
    id: 'dashboard',
    title: 'Dashboard',
    subtitle: 'Executive overview',
    icon: LayoutDashboard,
    accentColor: 'blue',
    subOptions: [],
  },
  items: {
    id: 'items',
    title: 'Items & Catalog',
    subtitle: 'Manage catalog & bundles',
    icon: Package,
    accentColor: 'blue',
    primaryAction: {
      id: 'add-product',
      label: 'Add Product',
      icon: Plus,
    },
    subOptions: [
      {
        id: 'products',
        label: 'Products Catalog',
        description: 'All SKUs, master pricing, barcodes',
        icon: Package,
        tag: 'Tab',
      },
      {
        id: 'combos',
        label: 'Combos & Bundles',
        description: 'Multi-item kit packages & pricing',
        icon: Layers,
        tag: 'Tab',
      },
    ],
  },
  invoices: {
    id: 'invoices',
    title: 'Sales & Billing',
    subtitle: 'Invoices, POS, quotes & returns',
    icon: Receipt,
    accentColor: 'blue',
    primaryAction: {
      id: 'new',
      label: 'Add Sale',
      icon: Plus,
    },
    subOptions: [
      {
        id: 'ledger',
        label: 'Sales Invoices',
        description: 'Tax invoices, receipts, payment tracking',
        icon: Receipt,
        tag: 'Tab',
      },
      {
        id: 'estimates',
        label: 'Quotations & Estimates',
        description: 'Customer price estimates & conversion',
        icon: FileText,
        tag: 'Tab',
      },
      {
        id: 'returns',
        label: 'Sales Returns',
        description: 'Credit notes & return processing',
        icon: RotateCcw,
        tag: 'Tab',
      },
      {
        id: 'draft-sales',
        label: 'Saved Sale Drafts',
        description: 'Locally saved invoice drafts',
        icon: Save,
        tag: 'Tab',
      },
      {
        id: 'draft-quotes',
        label: 'Saved Quote Drafts',
        description: 'Locally saved quotation drafts',
        icon: Save,
        tag: 'Tab',
      },
    ],
  },
  inventory: {
    id: 'inventory',
    title: 'Inventory',
    subtitle: 'Warehouse stock & transfers',
    icon: Boxes,
    accentColor: 'emerald',
    primaryAction: {
      id: 'transfer',
      label: 'Transfer Stock',
      icon: ArrowRightLeft,
    },
    subOptions: [
      {
        id: 'items',
        label: 'Regular Items Stock',
        description: 'Live physical quantities & alerts',
        icon: Package,
        tag: 'Tab',
      },
      {
        id: 'combos',
        label: 'Combos & Kits',
        description: 'Ready kit availability by branch',
        icon: Layers,
        tag: 'Tab',
      },
      {
        id: 'transfer-history',
        label: 'Transfer History',
        description: 'Inter-warehouse shipments log',
        icon: ArrowRightLeft,
        tag: 'Action',
      },
      {
        id: 'audit',
        label: 'Stock Audit Trail',
        description: 'Adjustments & reconciliation logs',
        icon: ClipboardCheck,
        tag: 'Action',
      },
    ],
  },
  purchases: {
    id: 'purchases',
    title: 'Purchases',
    subtitle: 'Supplier orders & inward stock',
    icon: ShoppingCart,
    accentColor: 'amber',
    primaryAction: {
      id: 'issue-po',
      label: 'Issue Purchase Order',
      icon: Plus,
    },
    subOptions: [
      {
        id: 'orders',
        label: 'Purchase Orders',
        description: 'Inward POs & delivery statuses',
        icon: ShoppingCart,
        tag: 'Tab',
      },
      {
        id: 'vendors',
        label: 'Suppliers Directory',
        description: 'Registered vendors & payables',
        icon: Building2,
        tag: 'Tab',
      },
    ],
  },
  hrm: {
    id: 'hrm',
    title: 'Staff & Attendance',
    subtitle: 'Staff attendance & payroll',
    icon: CalendarCheck,
    accentColor: 'rose',
    primaryAction: {
      id: 'kiosk',
      label: 'Punch Kiosk',
      icon: Camera,
    },
    subOptions: [
      {
        id: 'attendance',
        label: 'Staff Attendance',
        description: 'Daily check-ins & hours logged',
        icon: Clock,
        tag: 'Tab',
      },
      {
        id: 'payroll',
        label: 'Payroll Processing',
        description: 'Monthly wages & deductions',
        icon: DollarSign,
        tag: 'Tab',
      },
      {
        id: 'employees',
        label: 'Staff Directory',
        description: 'Employee profiles & contacts',
        icon: Users,
        tag: 'Tab',
      },
      {
        id: 'salary',
        label: 'Salary Structure',
        description: 'Base pay rules & allowances',
        icon: Briefcase,
        tag: 'Tab',
      },
    ],
  },
  reports: {
    id: 'reports',
    title: 'Reports & Statements',
    subtitle: 'Financial statements & GST',
    icon: BarChart3,
    accentColor: 'indigo',
    subOptions: [
      {
        id: 'sales',
        label: 'Sales Register',
        description: 'Revenue, mode split & ledger',
        icon: BarChart3,
        tag: 'Tab',
      },
      {
        id: 'pnl',
        label: 'Branch P&L Statement',
        description: 'Revenue, COGS & operating profit',
        icon: TrendingUp,
        tag: 'Tab',
      },
      {
        id: 'stock-valuation',
        label: 'Stock Valuation',
        description: 'Asset valuation at cost vs retail',
        icon: Boxes,
        tag: 'Tab',
      },
      {
        id: 'enquiry-conversion',
        label: 'Enquiry Conversion',
        description: 'Lead-to-invoice conversion rates',
        icon: PieChart,
        tag: 'Tab',
      },
      {
        id: 'purchase-orders',
        label: 'Purchase Orders Report',
        description: 'Procurement spend by vendor',
        icon: ShoppingBag,
        tag: 'Tab',
      },
      {
        id: 'gst',
        label: 'GST Filing (GSTR-1 & 3B)',
        description: 'HSN breakdown & tax liabilities',
        icon: FileSpreadsheet,
        tag: 'Tab',
      },
      {
        id: 'payroll',
        label: 'Payroll Summary',
        description: 'Monthly salary disbursements',
        icon: DollarSign,
        tag: 'Tab',
      },
    ],
  },
  customers: {
    id: 'customers',
    title: 'Customers',
    subtitle: 'Customer profiles & loyalty',
    icon: Users,
    accentColor: 'emerald',
    primaryAction: {
      id: 'new-customer',
      label: 'Add Customer',
      icon: UserPlus,
    },
    subOptions: [
      {
        id: 'directory',
        label: 'Customer Directory',
        description: 'Profiles, balances & history',
        icon: Users,
        tag: 'Tab',
      },
      {
        id: 'loyalty',
        label: 'Loyalty Program',
        description: 'Reward milestones & points',
        icon: Award,
        tag: 'Tab',
      },
    ],
  },
  parties: {
    id: 'parties',
    title: 'Parties & Customers',
    subtitle: 'Customers, suppliers & loyalty',
    icon: Contact,
    accentColor: 'indigo',
    primaryAction: {
      id: 'new-customer',
      label: 'Add Customer',
      icon: Plus,
    },
    subOptions: [
      {
        id: 'customers',
        label: 'Customers Directory',
        description: 'Customer profiles, dues & sales history',
        icon: Users,
        tag: 'Tab',
      },
      {
        id: 'suppliers',
        label: 'Suppliers Directory',
        description: 'Registered vendors & payables',
        icon: Building2,
        tag: 'Tab',
      },
      {
        id: 'all',
        label: 'All Parties Ledger',
        description: 'Unified receivables & payables',
        icon: Contact,
        tag: 'Tab',
      },
      {
        id: 'loyalty',
        label: 'Customer Loyalty Program',
        description: 'Reward milestones, tiers & rules',
        icon: Award,
        tag: 'Tab',
      },
    ],
  },
  challans: {
    id: 'challans',
    title: 'Delivery Challan',
    subtitle: 'Dispatch notes & delivery proof',
    icon: Truck,
    accentColor: 'sky',
    primaryAction: {
      id: 'new',
      label: 'Create Challan',
      icon: Plus,
    },
    subOptions: [
      {
        id: 'history',
        label: 'Challan History',
        description: 'View past dispatches & printouts',
        icon: History,
        tag: 'Tab',
      },
    ],
  },
  'cash-register': {
    id: 'cash-register',
    title: 'Daily Cash Register',
    subtitle: 'Daily drawer reconciliation',
    icon: Wallet,
    accentColor: 'teal',
    subOptions: [
      {
        id: 'register',
        label: 'Daily Cash Drawer',
        description: 'Opening, cash sales & expenses',
        icon: Wallet,
        tag: 'Tab',
      },
      {
        id: 'recurring',
        label: 'Recurring Expenses',
        description: 'Fixed monthly templates setup',
        icon: Repeat,
        tag: 'Tab',
      },
      {
        id: 'history',
        label: 'Register History',
        description: 'Past daily closing records',
        icon: History,
        tag: 'Action',
      },
    ],
  },
  enquiries: {
    id: 'enquiries',
    title: 'Enquiries',
    subtitle: 'Customer leads & pipeline',
    icon: ClipboardList,
    accentColor: 'violet',
    primaryAction: {
      id: 'new',
      label: 'New Enquiry',
      icon: Plus,
    },
    subOptions: [
      {
        id: 'all',
        label: 'All Enquiries',
        description: 'Active enquiries & follow-ups',
        icon: ClipboardList,
        tag: 'Tab',
      },
      {
        id: 'new-item-requests',
        label: 'New Item Requests',
        description: 'Customer requests for new catalog SKUs',
        icon: PackagePlus,
        tag: 'Tab',
      },
    ],
  },
  'pending-orders': {
    id: 'pending-orders',
    title: 'Pending Orders',
    subtitle: 'Order fulfillment pipeline',
    icon: Clock,
    accentColor: 'amber',
    subOptions: [],
  },
  access: {
    id: 'access',
    title: 'Access Control',
    subtitle: 'Permissions & staff PINs',
    icon: ShieldCheck,
    accentColor: 'amber',
    subOptions: [
      {
        id: 'roles',
        label: 'Role Permissions Matrix',
        description: 'Module access guards by role',
        icon: ShieldCheck,
        tag: 'Tab',
      },
      {
        id: 'staff',
        label: 'Staff Accounts & PINs',
        description: 'User logins & branch locks',
        icon: Users,
        tag: 'Tab',
      },
      {
        id: 'audit',
        label: 'Security Audit Log',
        description: 'Authentication & action logs',
        icon: History,
        tag: 'Tab',
      },
    ],
  },
  shopify: {
    id: 'shopify',
    title: 'Online Store',
    subtitle: 'Shopify sync & web orders',
    icon: Store,
    accentColor: 'emerald',
    primaryAction: {
      id: 'import-products',
      label: 'Import Products',
      icon: Download,
    },
    subOptions: [
      {
        id: 'orders',
        label: 'Store Orders & Sync',
        description: 'Recent Shopify orders & status',
        icon: Store,
        tag: 'Tab',
      },
    ],
  },
  barcodes: {
    id: 'barcodes',
    title: 'Barcode Printing',
    subtitle: 'Labels & multi-sheet printing',
    icon: Barcode,
    accentColor: 'slate',
    primaryAction: {
      id: 'preview',
      label: 'Sheet Print Preview',
      icon: Eye,
    },
    subOptions: [
      {
        id: 'generate',
        label: 'Barcode Generator',
        description: 'Add catalog items to print queue',
        icon: Barcode,
        tag: 'Tab',
      },
      {
        id: 'settings',
        label: 'Label Settings',
        description: 'Configure dimensions & margins',
        icon: Settings,
        tag: 'Action',
      },
    ],
  },
  'ai-assistant': {
    id: 'ai-assistant',
    title: 'AI Assistant',
    subtitle: 'Conversational assistant',
    icon: Sparkles,
    accentColor: 'fuchsia',
    subOptions: [],
  },
  estimates: {
    id: 'estimates',
    title: 'Quotations',
    subtitle: 'Sales quotation management',
    icon: FileText,
    accentColor: 'blue',
    primaryAction: {
      id: 'new-quote',
      label: 'New Quotation',
      icon: Plus,
    },
    subOptions: [
      {
        id: 'estimates',
        label: 'Quotations History',
        description: 'View & convert past estimates',
        icon: FileText,
        tag: 'Tab',
      },
    ],
  },
};
