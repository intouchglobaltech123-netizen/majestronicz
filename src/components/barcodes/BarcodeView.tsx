import React, { useState, useMemo, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import {
  QueuedBarcodeItem,
  BarcodeSettings,
  LABEL_SIZE_PRESETS,
} from '../../types/barcode';
import { BarcodeForm } from './BarcodeForm';
import { BarcodePreviewCard } from './BarcodePreviewCard';
import { BarcodeQueueTable } from './BarcodeQueueTable';
import { BarcodeSettingsModal } from './BarcodeSettingsModal';
import { BarcodeSheetPreviewModal } from './BarcodeSheetPreviewModal';
import {
  Barcode,
  Settings,
  Eye,
  Printer,
  FileSpreadsheet,
  Building,
  Layers,
} from 'lucide-react';
import { toast } from 'sonner';

export const BarcodeView: React.FC = () => {
  const { isAllBranches, currentBranchData, activeSubTab } = useErp();

  // Settings State
  const [settings, setSettings] = useState<BarcodeSettings>({
    printerType: 'regular',
    labelPresetId: '38x21', // 65 labels per A4 sheet (5x13) - Default
    showBorders: false,
    fontSize: 'medium',
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Synchronize modal triggers when triggered from secondary navbar flyout
  useEffect(() => {
    if (activeSubTab?.view === 'barcodes') {
      const tab = activeSubTab.tab;
      if (tab === 'settings') {
        setIsSettingsOpen(true);
      } else if (tab === 'preview') {
        setIsPreviewModalOpen(true);
      }
    }
  }, [activeSubTab]);

  // Form State (Lifted so BarcodePreviewCard can reactively render live preview)
  const [itemCode, setItemCode] = useState('');
  const [itemName, setItemName] = useState('');
  const [header, setHeader] = useState('MAJESTRONICZ');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [line3, setLine3] = useState('');
  const [line4, setLine4] = useState('');

  // Print queue starts empty; staff add real catalog items via the search above.
  const [queue, setQueue] = useState<QueuedBarcodeItem[]>([]);

  // Modals
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);

  // Current Label Preset
  const activePreset = useMemo(() => {
    return (
      LABEL_SIZE_PRESETS.find((p) => p.id === settings.labelPresetId) ||
      LABEL_SIZE_PRESETS[0]
    );
  }, [settings.labelPresetId]);

  // Total Labels & Page Calculation Helper
  const totalLabels = useMemo(() => {
    return queue.reduce((sum, it) => sum + it.noOfLabels, 0);
  }, [queue]);

  const requiredPages = useMemo(() => {
    if (totalLabels === 0) return 0;
    return Math.ceil(totalLabels / activePreset.labelsPerPage);
  }, [totalLabels, activePreset.labelsPerPage]);

  // Queue Handlers
  const handleAddToQueue = (newItem: QueuedBarcodeItem) => {
    setQueue((prev) => {
      // Check if same item & code is already in queue
      const existingIdx = prev.findIndex((it) => it.itemCode === newItem.itemCode);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx].noOfLabels += newItem.noOfLabels;
        return updated;
      }
      return [newItem, ...prev];
    });
  };

  const handleRemoveFromQueue = (id: string) => {
    setQueue((prev) => prev.filter((it) => it.id !== id));
    toast.success('Removed item from print queue');
  };

  const handleUpdateQuantity = (id: string, delta: number) => {
    setQueue((prev) =>
      prev.map((it) => {
        if (it.id === id) {
          const updated = Math.max(1, it.noOfLabels + delta);
          return { ...it, noOfLabels: updated };
        }
        return it;
      })
    );
  };

  const handleClearQueue = () => {
    setQueue([]);
    toast.info('Print queue cleared');
  };

  const handleOpenPreview = () => {
    if (queue.length === 0) {
      toast.error('Queue is empty. Please add items to preview label sheets.');
      return;
    }
    setIsPreviewModalOpen(true);
  };

  const handleGeneratePrint = () => {
    if (queue.length === 0) {
      toast.error('Queue is empty. Please add items before generating print.');
      return;
    }
    setIsPreviewModalOpen(true);
    // Give modal a microtask to mount before triggering window print
    setTimeout(() => {
      window.print();
    }, 300);
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 w-full">
      {/* Top Header Banner */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="h-12 w-12 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
            <Barcode className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
                Barcode
              </h1>
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                Code 128 Standard
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              Print retail price stickers and product barcodes.
            </p>
          </div>
        </div>

        {/* Right Header Badges & Settings Gear */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
            {isAllBranches ? (
              <Layers className="h-3.5 w-3.5 text-blue-600" />
            ) : (
              <Building className="h-3.5 w-3.5 text-emerald-600" />
            )}
            <span className="font-semibold text-slate-800">
              {isAllBranches ? 'All Branches' : currentBranchData?.name}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 shadow-xs transition-colors flex items-center gap-1.5 text-xs font-semibold"
            title="Printer and label size settings"
          >
            <Settings className="h-4 w-4 text-slate-500" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        </div>
      </div>

      {/* Main Two-Panel Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT PANEL: Form (Top) + Queue Table (Bottom) (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {/* Top Form */}
          <BarcodeForm
            onAddToQueue={handleAddToQueue}
            itemCode={itemCode}
            setItemCode={setItemCode}
            itemName={itemName}
            setItemName={setItemName}
            header={header}
            setHeader={setHeader}
            line1={line1}
            setLine1={setLine1}
            line2={line2}
            setLine2={setLine2}
            line3={line3}
            setLine3={setLine3}
            line4={line4}
            setLine4={setLine4}
          />

          {/* Queue Table */}
          <BarcodeQueueTable
            queue={queue}
            onRemoveItem={handleRemoveFromQueue}
            onUpdateQuantity={handleUpdateQuantity}
            onClearQueue={handleClearQueue}
          />

          {/* Helper Line & Generate Action Footer */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-50/80 via-white to-slate-50 border border-blue-200/80 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shrink-0 shadow-xs">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-bold text-slate-900">
                    Print Sheet Calculation
                  </h4>
                  <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-blue-100 text-blue-800">
                    {activePreset.name.split('(')[0].trim()}
                  </span>
                </div>
                {/* PROMPT SPECIFIC HELPER LINE */}
                <p className="text-xs text-slate-600 mt-0.5 font-medium">
                  {totalLabels === 0 ? (
                    'Queue is currently empty. Add items above to calculate required pages.'
                  ) : (
                    <>
                      You will need{' '}
                      <strong className="text-blue-700 font-extrabold text-sm">
                        {requiredPages} page{requiredPages === 1 ? '' : 's'}
                      </strong>{' '}
                      (A4 size) for printing ({totalLabels} label{totalLabels === 1 ? '' : 's'} @ {activePreset.labelsPerPage} labels/sheet)
                    </>
                  )}
                </p>
              </div>
            </div>

            {/* Preview and Generate Buttons */}
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={handleOpenPreview}
                disabled={queue.length === 0}
                className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Eye className="h-4 w-4 text-slate-500" />
                <span>Preview</span>
              </button>

              <button
                type="button"
                onClick={handleGeneratePrint}
                disabled={queue.length === 0}
                className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Printer className="h-4 w-4" />
                <span>Generate</span>
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Live Preview Sticker Card (4 cols) */}
        <div className="lg:col-span-4">
          <BarcodePreviewCard
            itemCode={itemCode}
            itemName={itemName}
            header={header}
            line1={line1}
            line2={line2}
            line3={line3}
            line4={line4}
            preset={activePreset}
            printerType={settings.printerType}
          />
        </div>
      </div>

      {/* Settings Modal */}
      <BarcodeSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSaveSettings={(newSettings) => {
          setSettings(newSettings);
          toast.success('Barcode settings updated');
        }}
      />

      {/* Print Sheet Preview & Generate Modal */}
      <BarcodeSheetPreviewModal
        isOpen={isPreviewModalOpen}
        onClose={() => setIsPreviewModalOpen(false)}
        queue={queue}
        settings={settings}
      />
    </div>
  );
};
