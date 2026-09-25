/**
 * Converts a number to Indian numbering system words (Rupees and Paise)
 * e.g. 145825 -> "Rupees One Lakh Forty-Five Thousand Eight Hundred Twenty-Five only"
 */

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'FifFifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

// Fix for Fifteen
ONES[15] = 'Fifteen';

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

function twoDigitsToWords(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return TENS[ten] + (one > 0 ? '-' + ONES[one] : '');
}

function threeDigitsToWords(n: number): string {
  if (n === 0) return '';
  const hundred = Math.floor(n / 100);
  const remainder = n % 100;
  let res = '';
  if (hundred > 0) {
    res += ONES[hundred] + ' Hundred';
  }
  if (remainder > 0) {
    if (res) res += ' ';
    res += twoDigitsToWords(remainder);
  }
  return res;
}

export function numberToWordsIndian(num: number): string {
  if (num === 0) return 'Rupees Zero only';

  const rounded = Math.round(num * 100) / 100;
  const integerPart = Math.floor(rounded);
  const decimalPart = Math.round((rounded - integerPart) * 100);

  let remaining = integerPart;

  // Crores: 1,00,00,000
  const crores = Math.floor(remaining / 10000000);
  remaining %= 10000000;

  // Lakhs: 1,00,000
  const lakhs = Math.floor(remaining / 100000);
  remaining %= 100000;

  // Thousands: 1,000
  const thousands = Math.floor(remaining / 1000);
  remaining %= 1000;

  // Hundreds and units
  const hundreds = remaining;

  const parts: string[] = [];

  if (crores > 0) {
    // Crores can exceed 99 (e.g. 141 crore) — twoDigitsToWords only covered 0–99
    // and produced "undefined" (PLT-14). Handle up to 999 crore directly, and
    // split into thousands-of-crore beyond that.
    if (crores >= 1000) {
      const cThousands = Math.floor(crores / 1000);
      const cRest = crores % 1000;
      parts.push((threeDigitsToWords(cThousands) + ' Thousand ' + (cRest > 0 ? threeDigitsToWords(cRest) : '')).trim() + ' Crore');
    } else {
      parts.push(threeDigitsToWords(crores) + ' Crore');
    }
  }
  if (lakhs > 0) {
    parts.push(twoDigitsToWords(lakhs) + ' Lakh');
  }
  if (thousands > 0) {
    parts.push(twoDigitsToWords(thousands) + ' Thousand');
  }
  if (hundreds > 0) {
    parts.push(threeDigitsToWords(hundreds));
  }

  let words = parts.join(' ').trim();
  if (!words) {
    words = 'Zero';
  }

  let result = `Rupees ${words}`;

  if (decimalPart > 0) {
    result += ` and ${twoDigitsToWords(decimalPart)} Paise`;
  }

  result += ' only';

  return result;
}
