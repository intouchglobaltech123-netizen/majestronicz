import React, { useState } from 'react';
import { X, Calendar } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  orderNumber: string;
  itemName: string;
  currentDate?: string;
  onSave: (newDate: string) => void;
}

export const EditRestockDateModal: React.FC<Props> = ({
  isOpen,
  onClose,
  orderNumber,
  itemName,
  currentDate,
  onSave,
}) => {
  const [date, setDate] = useState(currentDate || '');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(date);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white border border-slate-300 rounded-none w-full max-w-md shadow-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-none bg-red-50 border border-red-200 flex items-center justify-center text-red-700">
              <Calendar className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Update Expected Restock Date</h3>
              <p className="text-[11px] text-slate-500 font-mono">
                <span className="text-red-700 font-bold">{orderNumber}</span> • {itemName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-none text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Expected Arrival Date
            </label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-none bg-white border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none focus:border-red-600"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Used to track waiting period countdowns and overdue restock alerts.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-300 rounded-none transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-none border border-red-700 transition-colors shadow-none cursor-pointer"
            >
              Save Restock Date
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
