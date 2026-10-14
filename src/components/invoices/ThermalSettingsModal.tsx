import React, { useState } from 'react';
import { X, Printer, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  ThermalWidth, getThermalWidth, setThermalWidth,
  isThermalAutoPrintOn, setThermalAutoPrint, printThermalReceipt,
} from '../../lib/thermalReceipt';
import { Invoice, CompanyProfile } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  company: CompanyProfile;
  /** A recent bill to use for the test print, if any. */
  sampleInvoice?: Invoice | null;
}

/** Per-device thermal printer settings: paper width + auto-print, with a test. */
export const ThermalSettingsModal: React.FC<Props> = ({ open, onClose, company, sampleInvoice }) => {
  const [width, setWidth] = useState<ThermalWidth>(getThermalWidth());
  const [auto, setAuto] = useState<boolean>(isThermalAutoPrintOn());

  if (!open) return null;

  const save = () => { setThermalWidth(width); setThermalAutoPrint(auto); onClose(); };

  const testPrint = () => {
    setThermalWidth(width); // apply the chosen width for the test
    const demo: Invoice = sampleInvoice || ({
      id: 'test', invoiceNumber: 'TEST-001', branchId: 'erode-hq',
      date: new Date().toLocaleDateString('en-IN'), time: new Date().toLocaleTimeString('en-IN'),
      customerName: 'Test Customer', customerPhone: '', transactionType: 'Cash',
      items: [
        { id: '1', itemName: 'Sample Item A', unit: 'PCS', quantity: 2, unitPrice: 120, discountType: '%', discountValue: 0, discountAmount: 0, taxRate: 18, taxableAmount: 240, cgstAmount: 21.6, sgstAmount: 21.6, totalTax: 43.2, totalAmount: 283.2, itemHSN: '' },
        { id: '2', itemName: 'Sample Item B', unit: 'PCS', quantity: 1, unitPrice: 90, discountType: '%', discountValue: 0, discountAmount: 0, taxRate: 18, taxableAmount: 90, cgstAmount: 8.1, sgstAmount: 8.1, totalTax: 16.2, totalAmount: 106.2, itemHSN: '' },
      ],
      subtotal: 330, totalTax: 59.4, roundOff: 0.4, roundOffEnabled: true, grandTotal: 390,
      paymentMode: 'Cash', balanceDue: 0,
    } as unknown as Invoice);
    printThermalReceipt(demo, company, width);
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h3 className="text-sm font-bold text-slate-900 inline-flex items-center gap-2"><Printer className="h-4 w-4 text-blue-600" /> Thermal printer settings</h3>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          {/* Paper width */}
          <div>
            <p className="text-xs font-bold text-slate-700 mb-1.5">Paper width</p>
            <div className="grid grid-cols-2 gap-2">
              {([80, 58] as ThermalWidth[]).map((w) => (
                <button
                  key={w}
                  onClick={() => setWidth(w)}
                  className={cn('px-3 py-2.5 rounded-lg border text-left transition-colors', width === w ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50')}
                >
                  <div className="text-sm font-extrabold">{w}mm</div>
                  <div className={cn('text-[10px] font-semibold', width === w ? 'text-slate-200' : 'text-slate-400')}>{w === 80 ? 'Department store' : 'Small roll'}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Auto print */}
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className="text-xs font-bold text-slate-700">Auto-print after saving a bill</span>
            <button
              onClick={() => setAuto((a) => !a)}
              className={cn('w-11 h-6 rounded-full transition-colors relative shrink-0', auto ? 'bg-emerald-500' : 'bg-slate-300')}
            >
              <span className={cn('absolute top-0.5 h-5 w-5 bg-white rounded-full transition-all', auto ? 'left-[22px]' : 'left-0.5')} />
            </button>
          </label>

          <p className="text-[11px] text-slate-400">Settings are saved on this device. Set the thermal printer as the default printer in the browser/OS for one-tap printing.</p>

          <div className="flex items-center gap-2 pt-1">
            <button onClick={testPrint} className="flex-1 px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 inline-flex items-center justify-center gap-1.5">
              <Printer className="h-3.5 w-3.5" /> Test print
            </button>
            <button onClick={save} className="flex-1 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 inline-flex items-center justify-center gap-1.5">
              <Check className="h-3.5 w-3.5" /> Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ThermalSettingsModal;
