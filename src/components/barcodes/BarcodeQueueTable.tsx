import React from 'react';
import { QueuedBarcodeItem } from '../../types/barcode';
import { Trash2, ShoppingCart } from 'lucide-react';

interface Props {
  queue: QueuedBarcodeItem[];
  onRemoveItem: (id: string) => void;
  onUpdateQuantity: (id: string, delta: number) => void;
  onClearQueue: () => void;
}

export const BarcodeQueueTable: React.FC<Props> = ({
  queue,
  onRemoveItem,
  onUpdateQuantity,
  onClearQueue,
}) => {
  const totalLabels = queue.reduce((sum, item) => sum + item.noOfLabels, 0);

  return (
    <div className="bg-white border border-slate-300 rounded-none overflow-hidden shadow-xs">
      {/* Table Header Controls */}
      <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-none bg-red-50 border border-red-200 flex items-center justify-center text-red-700">
            <ShoppingCart className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Queued Items for Printing</h3>
            <p className="text-[11px] text-slate-500">
              {queue.length} {queue.length === 1 ? 'Item' : 'Items'} queued •{' '}
              <strong className="text-slate-900 font-bold">{totalLabels} total labels</strong>
            </p>
          </div>
        </div>

        {queue.length > 0 && (
          <button
            type="button"
            onClick={onClearQueue}
            className="text-xs text-rose-700 hover:text-rose-800 hover:bg-rose-50 px-2.5 py-1 rounded-none border border-rose-300 font-semibold transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Trash2 className="h-3 w-3" />
            <span>Clear Queue</span>
          </button>
        )}
      </div>

      {/* Table Content */}
      {queue.length === 0 ? (
        <div className="py-12 px-4 text-center">
          <div className="h-12 w-12 rounded-none bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 mx-auto mb-2">
            <ShoppingCart className="h-6 w-6" />
          </div>
          <h4 className="text-xs font-bold text-slate-700">Print Queue is Empty</h4>
          <p className="text-[11px] text-slate-400 max-w-sm mx-auto mt-1">
            Pick an item above, set the number of copies, and click "Add for Barcode" to prepare labels for printing.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto max-h-[380px]">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-xs border-b border-slate-200 text-slate-600 uppercase text-[10px] font-bold tracking-wider">
              <tr>
                <th className="py-3 px-4">Item Name</th>
                <th className="py-3 px-3 text-center w-28">No. of Labels</th>
                <th className="py-3 px-3">Header</th>
                <th className="py-3 px-3">Line 1</th>
                <th className="py-3 px-3">Line 2</th>
                <th className="py-3 px-3">Line 3</th>
                <th className="py-3 px-3">Line 4</th>
                <th className="py-3 px-3 text-center w-16">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {queue.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                  {/* Item Name & Code */}
                  <td className="py-2.5 px-4">
                    <div className="font-bold text-slate-900 truncate max-w-[160px]">
                      {item.itemName}
                    </div>
                    <div className="font-mono text-[10px] text-slate-500">
                      {item.itemCode}
                    </div>
                  </td>

                  {/* Quantity Stepper */}
                  <td className="py-2.5 px-3">
                    <div className="flex items-center justify-center border border-slate-300 rounded-none overflow-hidden bg-white">
                      <button
                        type="button"
                        onClick={() => onUpdateQuantity(item.id, -1)}
                        className="px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold border-r border-slate-300 text-xs cursor-pointer"
                      >
                        -
                      </button>
                      <span className="w-10 text-center font-bold font-mono text-xs text-slate-900">
                        {item.noOfLabels}
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateQuantity(item.id, 1)}
                        className="px-2 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold border-l border-slate-300 text-xs cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </td>

                  {/* Header */}
                  <td className="py-2.5 px-3 text-slate-700 text-[11px] truncate max-w-[100px]">
                    {item.header || <span className="text-slate-300 italic">-</span>}
                  </td>

                  {/* Line 1 */}
                  <td className="py-2.5 px-3 text-slate-700 text-[11px] truncate max-w-[110px]">
                    {item.line1 || <span className="text-slate-300 italic">-</span>}
                  </td>

                  {/* Line 2 */}
                  <td className="py-2.5 px-3 text-slate-600 text-[11px] truncate max-w-[110px]">
                    {item.line2 || <span className="text-slate-300 italic">-</span>}
                  </td>

                  {/* Line 3 */}
                  <td className="py-2.5 px-3 text-slate-500 text-[10px] truncate max-w-[100px]">
                    {item.line3 || <span className="text-slate-300 italic">-</span>}
                  </td>

                  {/* Line 4 */}
                  <td className="py-2.5 px-3 text-slate-500 text-[10px] truncate max-w-[100px]">
                    {item.line4 || <span className="text-slate-300 italic">-</span>}
                  </td>

                  {/* Remove Action */}
                  <td className="py-2.5 px-3 text-center">
                    <button
                      type="button"
                      onClick={() => onRemoveItem(item.id)}
                      className="p-1.5 rounded-none text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      title="Remove from queue"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
