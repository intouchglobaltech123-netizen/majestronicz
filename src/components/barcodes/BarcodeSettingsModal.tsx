import React from 'react';
import {
  LABEL_SIZE_PRESETS,
  BarcodeSettings,
} from '../../types/barcode';
import { X, Sliders, Printer, LayoutGrid, Check } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: BarcodeSettings;
  onSaveSettings: (newSettings: BarcodeSettings) => void;
}

export const BarcodeSettingsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
}) => {
  const [localSettings, setLocalSettings] = React.useState<BarcodeSettings>(settings);

  React.useEffect(() => {
    setLocalSettings(settings);
  }, [settings, isOpen]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings(localSettings);
    onClose();
  };

  const selectedPreset = LABEL_SIZE_PRESETS.find(
    (p) => p.id === localSettings.labelPresetId
  ) || LABEL_SIZE_PRESETS[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700">
              <Sliders className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Barcode Print Settings</h3>
              <p className="text-[11px] text-slate-500">
                Configure printer type, label size sheet, and styling
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 space-y-5">
          {/* Printer Type Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-2">
              Printer Hardware Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() =>
                  setLocalSettings({ ...localSettings, printerType: 'regular' })
                }
                className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition-all ${
                  localSettings.printerType === 'regular'
                    ? 'border-blue-600 bg-blue-50/50 ring-2 ring-blue-500/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <Printer className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <span>Regular Printer</span>
                    {localSettings.printerType === 'regular' && (
                      <Check className="h-3 w-3 text-blue-600" />
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Laser / Inkjet sheet printer (A4 sheets with peelable stickers)
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() =>
                  setLocalSettings({ ...localSettings, printerType: 'thermal' })
                }
                className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition-all ${
                  localSettings.printerType === 'thermal'
                    ? 'border-blue-600 bg-blue-50/50 ring-2 ring-blue-500/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <LayoutGrid className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <span>Thermal Printer</span>
                    {localSettings.printerType === 'thermal' && (
                      <Check className="h-3 w-3 text-blue-600" />
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Direct thermal / ribbon roll printer (TSC, Zebra, TVS, Citizen)
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* Label Size Dropdown */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Label Sheet Size & Layout
            </label>
            <select
              value={localSettings.labelPresetId}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, labelPresetId: e.target.value })
              }
              className="w-full text-xs font-medium bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            >
              {LABEL_SIZE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              {selectedPreset.description}
            </p>
          </div>

          {/* Preset Specifications Callout */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1.5">
            <div className="flex items-center justify-between text-slate-600 font-semibold">
              <span>Physical Dimensions:</span>
              <span className="font-bold text-slate-900">
                {selectedPreset.widthMm} mm × {selectedPreset.heightMm} mm
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span>Grid Layout:</span>
              <span className="font-semibold text-slate-800">
                {selectedPreset.columns} column{selectedPreset.columns > 1 ? 's' : ''} × {selectedPreset.rows} row{selectedPreset.rows > 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span>Capacity:</span>
              <span className="font-bold text-blue-700">
                {selectedPreset.labelsPerPage} labels per page
              </span>
            </div>
          </div>

          {/* Additional Options */}
          <div className="pt-2 border-t border-slate-100 space-y-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={localSettings.showBorders}
                onChange={(e) =>
                  setLocalSettings({ ...localSettings, showBorders: e.target.checked })
                }
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
              />
              <div>
                <span className="text-xs font-semibold text-slate-800 block">
                  Print Outline Cutting Borders
                </span>
                <span className="text-[10px] text-slate-400 block">
                  Recommended if printing on plain A4 paper to guide manual cutting. Uncheck for pre-die-cut label sheets.
                </span>
              </div>
            </label>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-xs"
            >
              Save Settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
