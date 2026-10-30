import React from 'react';
import { Code128Barcode } from '../../lib/code128';
import { LabelSizePreset, BarcodeSettings, labelTextScale } from '../../types/barcode';
import { Eye, Printer } from 'lucide-react';

interface Props {
  itemCode: string;
  itemName: string;
  header: string;
  line1: string;
  line2: string;
  line3: string;
  line4: string;
  preset: LabelSizePreset;
  printerType: string;
  fontSize?: BarcodeSettings['fontSize'];
}

export const BarcodePreviewCard: React.FC<Props> = ({
  itemCode,
  itemName,
  header,
  line1,
  line2,
  line3,
  line4,
  preset,
  printerType,
  fontSize,
}) => {
  // The preview sticker is drawn ~1.5× bigger than the physical label, so scale
  // the shared print text sizes up by the same factor for a faithful look.
  const base = labelTextScale(fontSize);
  const Z = 1.5;
  const tx = {
    header: base.header * Z,
    code: base.code * Z,
    name: base.name * Z,
    line: base.line * Z,
    lineSmall: base.lineSmall * Z,
  };
  const displayCode = itemCode.trim() || 'MZ-SAMPLE-01';
  const displayHeader = header.trim() || (itemName ? 'MAJESTRONICZ' : 'MAJESTRONICZ ENTERPRISES');
  const isDummy = !itemCode.trim();

  return (
    <div className="bg-white border border-slate-300 rounded-none p-6 shadow-xs flex flex-col h-full sticky top-6">
      {/* Card Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-none bg-red-50 border border-red-200 flex items-center justify-center text-red-700">
            <Eye className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Live Label Preview</h3>
            <p className="text-[11px] text-slate-500">Real-time sticker render</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-none bg-red-50 text-red-700 border border-red-200">
            {preset.widthMm} × {preset.heightMm} mm
          </span>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-none bg-slate-100 text-slate-700 border border-slate-300">
            {printerType === 'thermal' ? 'Thermal' : 'A4 Sheet'}
          </span>
        </div>
      </div>

      {/* Live Preview Sticker Stage */}
      <div className="flex-1 flex flex-col items-center justify-center py-8 px-4 bg-slate-50 rounded-none border border-dashed border-slate-300 mt-4 my-2">
        {isDummy && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-300 px-2.5 py-1 rounded-none mb-4 font-medium">
            <Eye className="h-3 w-3" />
            <span>Showing sample preview — pick an item to load code</span>
          </div>
        )}

        {/* Physical Sticker Container (Zoomed 1.8x for crisp readability) */}
        <div
          className="bg-white text-slate-950 rounded-md border border-slate-300 shadow-md p-3 flex flex-col items-center justify-center gap-1 relative select-none transition-all duration-150"
          style={{
            width: '240px',
            minHeight: '140px',
            boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.08), 0 2px 4px -1px rgba(0, 0, 0, 0.04)',
          }}
        >
          {/* Subtle Sticker Notch Indicator */}
          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-4 h-1 bg-slate-200 rounded-full" />

          {/* Label Header */}
          {displayHeader ? (
            <div
              className="w-full text-center font-extrabold tracking-wide text-slate-900 truncate uppercase border-b border-slate-100 pb-0.5"
              style={{ fontSize: `${tx.header}px` }}
            >
              {displayHeader}
            </div>
          ) : (
            <div className="h-2" />
          )}

          {/* Barcode SVG Vector + Code */}
          <div className="w-full my-1.5 px-0.5 flex flex-col items-center">
            <Code128Barcode
              value={displayCode}
              height={Math.max(40, Math.round(preset.heightMm * 1.2 * Z))}
              barColor="#000000"
              showText={false}
              className="w-full"
            />
            <span
              className="font-mono font-extrabold tracking-widest text-slate-900 mt-0.5"
              style={{ fontSize: `${tx.code}px` }}
            >
              {displayCode}
            </span>
          </div>

          {/* Label Lines (1 to 4) — product name biggest + bold */}
          <div className="w-full flex flex-col items-center text-center space-y-0.5 pt-1 border-t border-slate-100 font-semibold text-slate-800">
            {line1 ? (
              <div className="w-full truncate font-bold text-slate-900" style={{ fontSize: `${tx.name}px` }}>{line1}</div>
            ) : isDummy ? (
              <div className="w-full truncate font-bold text-slate-900" style={{ fontSize: `${tx.name}px` }}>SAMSUNG 55" ULTRA HD TV</div>
            ) : null}

            {line2 ? (
              <div className="w-full truncate font-semibold text-slate-700" style={{ fontSize: `${tx.line}px` }}>{line2}</div>
            ) : isDummy ? (
              <div className="w-full truncate font-semibold text-slate-700" style={{ fontSize: `${tx.line}px` }}>MRP: ₹42,990.00</div>
            ) : null}

            {line3 ? (
              <div className="w-full truncate text-slate-600" style={{ fontSize: `${tx.lineSmall}px` }}>{line3}</div>
            ) : null}

            {line4 ? (
              <div className="w-full truncate text-slate-500" style={{ fontSize: `${tx.lineSmall}px` }}>{line4}</div>
            ) : null}
          </div>
        </div>

        {/* Sticker Dimensions Tag */}
        <p className="text-[11px] text-slate-400 mt-4">
          Sticker scale: Zoomed preview (Physical target: {preset.widthMm}mm × {preset.heightMm}mm)
        </p>
      </div>

      {/* Footer Specs Helper */}
      <div className="mt-auto pt-3 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
        <div className="flex items-center gap-1">
          <Printer className="h-3.5 w-3.5 text-red-700" />
          <span>Symbology: <strong>Code 128 (Subset B)</strong></span>
        </div>
        <span>{preset.labelsPerPage === 1 ? `${preset.widthMm}×${preset.heightMm} mm roll` : `${preset.labelsPerPage} labels / A4 page`}</span>
      </div>
    </div>
  );
};
