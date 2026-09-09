# Majestronicz ERP

Modern industrial automation & electronics enterprise resource planning system with static master catalog pricing and per-branch physical stock tracking.

## Tech Stack
- **Framework**: React 19 + TypeScript + Vite
- **Styling**: Bright & Clean Light Theme (Tailwind CSS v4 + Plus Jakarta Sans + Lucide React icons + Sonner toasts)
- **State & Persistence**: React Context + localStorage (`STORAGE_KEY = "majestronicz_erp_v1_demo"`)
- **Brand Palette**: Charcoal/Near-Black (Majestronicz "M" mark) + Professional Blue accents on clean white/off-white canvas

## Core Architecture
- **Master Item Catalog**: Each item has **ONE static master price set** (`salePrice`, `salePriceTaxMode`, `wholesalePrice`, `minWholesaleQty`, `purchasePrice`, `gstTaxSlab`), shared across all branches and editable only via Item Master.
- **Per-Branch Stock Tracking (`BranchStock`)**: Physical stock counts (`itemId`, `branchId`, `quantity`) are tracked independently per branch warehouse. The top-bar branch selector switches the **Active Stock Location**.
- **Sales Invoice Billing Rule (Upcoming Module Prep)**: When an invoice line item price is edited at billing time, it writes ONLY to `InvoiceLineItem.overriddenPrice`, and **never** mutates the master `Item.salePrice`.

## Branches (Stock Locations)
1. **Erode HQ** (`erode-hq`): Central Warehouse & Hub
2. **Coimbatore** (`coimbatore`): Industrial & Robotics Center
3. **Chennai** (`chennai`): Metro Regional Outlet

## Role-Based Access Control (PIN Authentication)
- **CEO** (PIN `1111`): Master catalog & pricing control, full stock management across all branches.
- **Manager** (PIN `2222`): Master catalog & pricing control, stock management for assigned branch.
- **Billing** (PIN `3333`): Read-only view on Item Master.

## Getting Started
```bash
# Install dependencies
npm install

# Start local development server
npm run dev

# Build for production
npm run build
```