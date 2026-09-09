# Walkthrough — Standalone Inventory & Stock Management

Built the dedicated **Inventory & Stock Management** module for Majestronicz ERP, providing real-time branch-scoped inventory auditing, an "All Branches" stock balance matrix for executive leadership, editable per-item low stock alert thresholds, manual stock adjustments with immutable audit logging, atomic inter-branch stock transfers with automatic Delivery Challan generation, and strict role-based permission enforcement.

---

## 1. Key Features Built

### A. Dedicated Inventory List View (Branch-Scoped)
- **Top-Bar Branch Scoping**: When a single branch is selected (e.g. *Erode HQ*, *Coimbatore*, or *Chennai*), the table shows:
  - **Item Details**: Item Name, Item Code badge, HSN code, and Unit of measurement.
  - **Category**: PLC & Controllers, Motors & Drives, Sensors, Power Supplies, Switchgear, etc.
  - **Current Physical Stock**: Stock count for the active branch with unit label.
  - **Low Stock Threshold**: Per-item threshold with one-click quick-edit pencil icon.
  - **Computed Status**:
    - `quantity === 0` $\rightarrow$ `Out of Stock` (red badge)
    - `quantity <= threshold` $\rightarrow$ `Low Stock` (amber badge)
    - `quantity > threshold` $\rightarrow$ `In Stock` (emerald badge)
  - **Last Updated**: Real-time timestamp of the last receipt, sale decrement, or manual adjustment.
  - **Row Actions**:
    - `Adjust`: Opens manual adjustment modal pre-filling the item and branch.
    - `Transfer`: Opens inter-branch transfer modal pre-filling the item and source branch.
    - `History`: Opens the item's individual chronological audit log.

---

### B. "All Branches" Consolidated Matrix (CEO Role)
- When the active branch selector is set to **"All Branches"**, the table expands into a multi-branch balance matrix:
  - Separate stock columns for **Erode HQ**, **Coimbatore**, and **Chennai**.
  - Highlighted **Total Units** column summing physical stock across all branches.
  - **Stock Imbalance Detection**: Identifies SKUs where one branch has depleted to zero or low levels while others hold surplus stock (labeled with a purple `Branch Imbalance` indicator).
  - Quick action to initiate an inter-branch rebalancing transfer directly from any row.

---

### C. Configurable Per-Item Low Stock Threshold
- **Catalog-Wide Uniformity**: Replaced stub thresholds with an editable `reorderThreshold` on `Item` that applies across all warehouses where the item is stocked.
- **Three Editing Paths**:
  1. Quick inline edit button on each row in the **Inventory Table** (`ThresholdEditModal`).
  2. Stock setup tab in **Add Item Modal** (`AddItemModal`).
  3. Stock tab in **Edit Item Modal** (`EditItemModal`).
- **Connected KPI**: Dashboard's *Low Stock Alerts* KPI automatically computes alerts based on this threshold.

---

### D. Manual Stock Adjustments & Immutable Audit Trail
- **Action Modal (`AdjustStockModal`)**:
  - Add Stock ($+$) or Deduct Stock ($-$) toggle with live stock transition preview:
    $$\text{Previous Stock} \longrightarrow \Delta \text{ Quantity} \longrightarrow \text{New Projected Stock}$$
  - Mandatory **Reason Dropdown**:
    - `Stock Audit Correction`
    - `Damage`
    - `Loss / Theft`
    - `Return to Vendor`
    - `Other` (with mandatory free-text explanation field)
  - Optional remarks / shift handover notes.
  - Validation: Prevents deducting more than available branch inventory.
- **Immutable Log Entry (`StockAdjustmentLog`)**:
  - Records `itemId`, `itemName`, `itemCode`, `branchId`, `previousQuantity`, `quantityChange`, `newQuantity`, `reason`, `notes`, `adjustedBy` (user name and role), and `timestamp`.
- **Audit History Drawer (`StockHistoryModal`)**:
  - Filterable by specific item or across the entire enterprise.
  - Searchable by SKU, note text, user name, or reference ID.
  - Filterable by branch and adjustment reason.

---

### E. Atomic Inter-Branch Stock Transfer
- **Action Modal (`TransferStockModal`)**:
  - `From Branch` (source warehouse) $\rightarrow$ `To Branch` (destination warehouse).
  - Item picker with search and live source stock indicator.
  - Quantity input with max stock validation.
  - Projected balances preview for both branches before confirming.
- **Atomic Execution**:
  - Decrements `From Branch` stock and increments `To Branch` stock inside a single state update.
  - Generates a shared `transferRef` (e.g. `TRF-XXXXXXXX`).
  - Creates two linked `StockAdjustmentLog` entries:
    - Source: Negative quantity change with `"Transferred to [Destination Branch]"` note.
    - Destination: Positive quantity change with `"Received from [Source Branch]"` note.
- **Linked Delivery Challan Auto-Generation**:
  - Checkbox (enabled by default) automatically creates an official **Delivery Challan** (`DC-TRF-XXX`) with:
    - `Delivered By`: Source branch dispatch & staff name.
    - `Received By`: Destination branch inventory store.
    - Line item with quantity and transit note.
  - Toast alert includes a direct action button to jump into the **Delivery Challans** dispatch screen.

---

### F. Role-Based Access Enforcement
| Action / Permission | CEO | Manager | Billing |
| :--- | :---: | :---: | :---: |
| **View Inventory List & Status** | Any Branch + All Branches Matrix | Assigned Branch Only | View-only (All / Scoped) |
| **Manual Stock Adjustment** | Any Branch | Assigned Branch Only | **Disabled / Hidden** |
| **Inter-Branch Transfer** | Any From $\rightarrow$ Any To | From Assigned Branch Only | **Disabled / Hidden** |
| **Edit Low Stock Threshold** | Allowed | Allowed | **Disabled** |
| **View Audit Trail** | Full History | Assigned Branch History | View-only History |

---

## 2. Verification Results

### Automated Checks
- `npx tsc --noEmit`: Exited with code 0 (zero TypeScript errors).
- `npm run build`: Production bundle compiled cleanly in 3.28s (`dist/assets/index-*.js`).

### Manual Workflow Validations
1. **Sidebar Navigation**:
   - "Inventory & Stock" button is active with dynamic badge displaying low stock item count (e.g. `1 Low`).
2. **Branch Switching**:
   - Switching between *Erode HQ*, *Coimbatore*, and *Chennai* updates stock counts, statuses, and threshold comparisons instantly.
   - Switching to *All Branches* transforms the table into the multi-branch balance matrix with individual branch columns and total units.
3. **Manual Stock Adjustment**:
   - Adjusted *Delta PLC* at *Erode HQ* by $+2$ for `"Stock Audit Correction"`.
   - Verified stock count incremented from $14 \rightarrow 16$.
   - Opened *Audit Trail* modal: verified new timestamped log entry with previous count, change, new count, user, and reason.
4. **Inter-Branch Transfer**:
   - Transferred 5 units of *Omron Proximity Sensor* from *Erode HQ* to *Coimbatore* with *Auto-generate Delivery Challan* checked.
   - Verified *Erode HQ* decremented by 5 and *Coimbatore* incremented by 5 atomically.
   - Verified paired audit entries created sharing `transferRef`.
   - Verified *Delivery Challan* was auto-generated in the *Delivery Challans* module.
5. **Role Gating**:
   - Verified *Billing* role has read-only access (Adjust and Transfer buttons are hidden).
   - Verified *Manager* role is restricted to adjusting and transferring from their assigned branch only.
