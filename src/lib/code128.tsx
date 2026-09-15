import React, { useMemo } from 'react';

// Code 128 character widths patterns (bar, space, bar, space, bar, space)
// 0 to 102 are standard characters, 103=StartA, 104=StartB, 105=StartC, 106=Stop (7 elements)
const CODE128_PATTERNS: string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', // 00-09
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', // 10-19
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', // 20-29
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', // 30-39
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', // 40-49
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', // 50-59
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', // 60-69
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', // 70-79
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', // 80-89
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', // 90-99
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'                                 // 100-106
];

export interface BarcodeBar {
  x: number;
  width: number;
}

export interface BarcodeResult {
  bars: BarcodeBar[];
  totalWidth: number;
  encodedValue: string;
}

/**
 * Encodes an alphanumeric string into Code 128 (Subset B) vector bars.
 */
export function encodeCode128B(text: string, quietZone: number = 10): BarcodeResult {
  const safeText = text.trim() || 'SAMPLE';
  
  // Calculate character codes for Code 128 Subset B (ASCII 32 to 126)
  const patternIndices: number[] = [104]; // 104 = Start Code B
  let checkSum = 104;

  for (let i = 0; i < safeText.length; i++) {
    const code = safeText.charCodeAt(i);
    // Code 128B maps ASCII 32-126 to pattern indices 0-94
    let charVal = code - 32;
    if (charVal < 0 || charVal > 95) {
      charVal = 0; // Fallback to space for unsupported chars
    }
    patternIndices.push(charVal);
    checkSum += charVal * (i + 1);
  }

  // Modulo 103 checksum
  const checkDigit = checkSum % 103;
  patternIndices.push(checkDigit);
  patternIndices.push(106); // Stop Code

  // Convert pattern codes to bars and spaces
  const bars: BarcodeBar[] = [];
  let currentX = quietZone;

  for (const patternIndex of patternIndices) {
    const pattern = CODE128_PATTERNS[patternIndex];
    if (!pattern) continue;

    for (let p = 0; p < pattern.length; p++) {
      const moduleWidth = parseInt(pattern[p], 10);
      const isBar = p % 2 === 0; // Alternates: Bar, Space, Bar, Space...

      if (isBar) {
        bars.push({
          x: currentX,
          width: moduleWidth,
        });
      }
      currentX += moduleWidth;
    }
  }

  const totalWidth = currentX + quietZone;

  return {
    bars,
    totalWidth,
    encodedValue: safeText,
  };
}

interface Code128BarcodeProps {
  value: string;
  height?: number;
  barColor?: string;
  showText?: boolean;
  className?: string;
}

export const Code128Barcode: React.FC<Code128BarcodeProps> = ({
  value,
  height = 40,
  barColor = '#000000',
  showText = false,
  className = '',
}) => {
  const barcode = useMemo(() => encodeCode128B(value, 6), [value]);

  return (
    <div className={`flex flex-col items-center select-none ${className}`}>
      <svg
        viewBox={`0 0 ${barcode.totalWidth} ${height}`}
        className="w-full h-auto max-h-full overflow-visible"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {barcode.bars.map((bar, index) => (
          <rect
            key={index}
            x={bar.x}
            y={0}
            width={bar.width}
            height={height}
            fill={barColor}
            shapeRendering="crispEdges"
          />
        ))}
      </svg>
      {showText && (
        <span className="font-mono text-[11px] font-bold tracking-wider text-slate-800 mt-0.5">
          {barcode.encodedValue}
        </span>
      )}
    </div>
  );
};
