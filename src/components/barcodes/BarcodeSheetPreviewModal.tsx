import React, { useState, useMemo } from 'react';
import {
  QueuedBarcodeItem,
  BarcodeSettings,
  LABEL_SIZE_PRESETS,
} from '../../types/barcode';
import { Code128Barcode } from '../../lib/code128';
import {
  X,
  Printer,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileCheck,
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  queue: QueuedBarcodeItem[];
  settings: BarcodeSettings;
  isDirectGenerate?: boolean;
}

export const BarcodeSheetPreviewModal: React.FC<Props> = ({
  isOpen,
  onClose,
  queue,
  settings,
}) => {
  const [currentPage, setCurrentPage] = useState(1);

  // Find active preset
  const preset = useMemo(() => {
    return (
      LABEL_SIZE_PRESETS.find((p) => p.id === settings.labelPresetId) ||
      LABEL_SIZE_PRESETS[0]
    );
  }, [settings.labelPresetId]);

  // Flatten the queue by label count
  const allLabels = useMemo(() => {
    const list: QueuedBarcodeItem[] = [];
    queue.forEach((item) => {
      for (let i = 0; i < item.noOfLabels; i++) {
        list.push(item);
      }
    });
    return list;
  }, [queue]);

  const totalPages = Math.max(1, Math.ceil(allLabels.length / preset.labelsPerPage));

  // Chunk labels into pages
  const pages = useMemo(() => {
    const p: QueuedBarcodeItem[][] = [];
    for (let i = 0; i < totalPages; i++) {
      const start = i * preset.labelsPerPage;
      p.push(allLabels.slice(start, start + preset.labelsPerPage));
    }
    return p;
  }, [allLabels, preset.labelsPerPage, totalPages]);

  // Reset to page 1 on open
  React.useEffect(() => {
    if (isOpen) {
      setCurrentPage(1);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  const activePageLabels = pages[currentPage - 1] || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto print:p-0 print:bg-white print:static print:inset-auto">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-6xl shadow-2xl overflow-hidden flex flex-col max-h-[96vh] print:max-h-none print:border-none print:shadow-none print:w-full print:rounded-none">
        {/* Top Control Bar (Hidden when printing) */}
        <div className="px-6 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700">
              <Eye className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  Label Sheet Print Preview
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                  {preset.name}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                {allLabels.length} labels total • {totalPages} A4 page{totalPages > 1 ? 's' : ''} required
              </p>
            </div>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-xl border border-slate-200 shadow-2xs">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="p-1 rounded text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent"
                title="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs font-bold px-2 text-slate-800 font-mono">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="p-1 rounded text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent"
                title="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print Sheet{totalPages > 1 ? 's' : ''}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Preview Stage (Hidden on print) */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-100 flex flex-col items-center print:hidden">
          {/* Virtual A4 Sheet Mockup */}
          <div
            className="bg-white shadow-xl rounded-sm border border-slate-300 p-4 transition-all"
            style={{
              width: '820px',
              minHeight: '1120px', // Standard A4 aspect ratio 210mm x 297mm
            }}
          >
            {/* Sheet Sub-Header Info */}
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-200 text-[10px] text-slate-400 font-mono">
              <span>MAJESTRONICZ ERP • BARCODE LABEL BATCH</span>
              <span>
                SHEET {currentPage} / {totalPages} • {preset.widthMm}×{preset.heightMm}mm ({preset.columns}×{preset.rows})
              </span>
            </div>

            {/* Label Grid */}
            <div
              className="grid gap-1.5"
              style={{
                gridTemplateColumns: `repeat(${preset.columns}, minmax(0, 1fr))`,
              }}
            >
              {Array.from({ length: preset.labelsPerPage }).map((_, idx) => {
                const label = activePageLabels[idx];
                if (!label) {
                  // Empty slot on page
                  return (
                    <div
                      key={`empty-${idx}`}
                      className={`h-20 rounded border border-dashed border-slate-200 flex items-center justify-center text-[10px] text-slate-300 ${
                        settings.showBorders ? 'opacity-40' : 'opacity-0'
                      }`}
                    >
                      Empty
                    </div>
                  );
                }

                return (
                  <div
                    key={`label-${idx}`}
                    className={`h-20 bg-white p-1 rounded flex flex-col justify-between items-center text-center select-none overflow-hidden ${
                      settings.showBorders
                        ? 'border border-slate-300'
                        : 'border border-slate-100'
                    }`}
                  >
                    {/* Header */}
                    <div className="w-full font-bold text-[8.5px] uppercase tracking-wider text-slate-900 truncate leading-tight">
                      {label.header || 'MAJESTRONICZ'}
                    </div>

                    {/* Barcode Graphic */}
                    <div className="w-full flex flex-col items-center my-0.5 px-0.5">
                      <Code128Barcode
                        value={label.itemCode}
                        height={24}
                        barColor="#000000"
                        showText={false}
                        className="w-full max-w-[130px]"
                      />
                      <span className="font-mono text-[7.5px] font-extrabold text-slate-900 tracking-wider">
                        {label.itemCode}
                      </span>
                    </div>

                    {/* Line Items — show every optional line the user entered */}
                    <div className="w-full text-[7.5px] leading-tight text-slate-700 space-y-0.2">
                      {label.line1 && <div className="font-bold truncate">{label.line1}</div>}
                      {label.line2 && <div className="truncate text-slate-500">{label.line2}</div>}
                      {label.line3 && <div className="truncate text-slate-500">{label.line3}</div>}
                      {label.line4 && <div className="truncate text-slate-400">{label.line4}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* PRINT-ONLY CONTAINER (Rendered during window.print()) */}
        <div className="hidden print:block w-full text-black bg-white">
          <style>{`
            @media print {
              @page {
                size: A4 portrait;
                margin: 8mm;
              }
              body {
                print-color-adjust: exact;
                -webkit-print-color-adjust: exact;
              }
              .barcode-print-page {
                page-break-after: always;
                break-after: page;
                height: 275mm;
                max-height: 275mm;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
              }
              .barcode-print-page:last-child {
                page-break-after: auto;
                break-after: auto;
              }
            }
          `}</style>

          {pages.map((pageLabels, pageIdx) => (
            <div
              key={`print-page-${pageIdx}`}
              className="barcode-print-page"
            >
              <div
                className="grid h-full"
                style={{
                  gridTemplateColumns: `repeat(${preset.columns}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${preset.rows}, minmax(0, 1fr))`,
                  gap: `${preset.gapXmm}mm`,
                }}
              >
                {Array.from({ length: preset.labelsPerPage }).map((_, slotIdx) => {
                  const label = pageLabels[slotIdx];
                  if (!label) {
                    return (
                      <div
                        key={`print-empty-${slotIdx}`}
                        style={{
                          border: settings.showBorders ? '0.5px dashed #ccc' : 'none',
                        }}
                      />
                    );
                  }

                  return (
                    <div
                      key={`print-label-${slotIdx}`}
                      className="flex flex-col justify-between items-center text-center p-1 box-border overflow-hidden"
                      style={{
                        border: settings.showBorders ? '0.5px solid #bbb' : 'none',
                        height: `${preset.heightMm}mm`,
                      }}
                    >
                      {/* Header */}
                      <div className="w-full font-bold text-[8px] uppercase tracking-wider text-black truncate leading-tight">
                        {label.header || 'MAJESTRONICZ'}
                      </div>

                      {/* Barcode Graphic */}
                      <div className="w-full flex flex-col items-center my-0.5">
                        <Code128Barcode
                          value={label.itemCode}
                          height={22}
                          barColor="#000000"
                          showText={false}
                          className="w-full max-w-[120px]"
                        />
                        <span className="font-mono text-[7px] font-bold text-black tracking-widest">
                          {label.itemCode}
                        </span>
                      </div>

                      {/* Text Lines — show every optional line the user entered */}
                      <div className="w-full text-[7px] leading-tight text-black space-y-0.2">
                        {label.line1 && <div className="font-bold truncate">{label.line1}</div>}
                        {label.line2 && <div className="truncate">{label.line2}</div>}
                        {label.line3 && <div className="truncate">{label.line3}</div>}
                        {label.line4 && <div className="truncate">{label.line4}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer Helper (Hidden on print) */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600 print:hidden">
          <div className="flex items-center gap-1.5 text-slate-500">
            <FileCheck className="h-4 w-4 text-emerald-600" />
            <span>
              Format: <strong>{preset.name}</strong> • Margins pre-calibrated for A4 sticker paper
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold transition-colors text-xs"
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
};
