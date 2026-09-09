/**
 * Item Code Auto-Generation Utility
 * Format: [2-letter Category prefix]-[2-letter Subcategory prefix]-[4-digit sequential number]
 * e.g. "RL-1C-0007", "PL-CP-0001", "RE-SS-0001"
 */

/**
 * Extracts 2-letter base from any name.
 * Takes the first 2 alphanumeric characters, uppercase.
 */
export function extractBasePrefix(name: string): string {
  if (!name || !name.trim()) return 'XX';
  const cleaned = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (cleaned.length >= 2) {
    return cleaned.slice(0, 2);
  } else if (cleaned.length === 1) {
    return (cleaned + 'X').toUpperCase();
  }
  return 'XX';
}

/**
 * Resolves a unique prefix for a category or subcategory with collision handling.
 * If base prefix is already assigned to this exact name, returns it.
 * If assigned to a DIFFERENT name, appends a number to disambiguate: e.g. "RE" -> "RE2", "RE3"...
 */
export function resolvePrefix(
  name: string,
  existingRegistry: Record<string, string> = {}
): { prefix: string; updatedRegistry: Record<string, string> } {
  const trimmed = name.trim();
  if (!trimmed) {
    return { prefix: 'XX', updatedRegistry: existingRegistry };
  }

  // If this exact name already has an assigned prefix, return it
  if (existingRegistry[trimmed]) {
    return { prefix: existingRegistry[trimmed], updatedRegistry: existingRegistry };
  }

  const base = extractBasePrefix(trimmed);
  // Find all prefixes assigned to OTHER names
  const usedPrefixes = new Set<string>();
  Object.entries(existingRegistry).forEach(([n, p]) => {
    if (n.toLowerCase() !== trimmed.toLowerCase()) {
      usedPrefixes.add(p);
    }
  });

  let resolved = base;
  if (usedPrefixes.has(resolved)) {
    let counter = 2;
    while (usedPrefixes.has(`${base}${counter}`)) {
      counter++;
    }
    resolved = `${base}${counter}`;
  }

  const updatedRegistry = {
    ...existingRegistry,
    [trimmed]: resolved,
  };

  return { prefix: resolved, updatedRegistry };
}

/**
 * Calculates the next sequential 4-digit number for a specific prefix combination.
 * Sequential number increments per unique prefix combination, not globally across all items.
 */
export function getNextSequenceNumber(
  catPrefix: string,
  subPrefix: string,
  existingItemCodes: string[] = []
): string {
  const prefix = `${catPrefix}-${subPrefix}-`;
  let maxNum = 0;

  existingItemCodes.forEach((code) => {
    if (code && typeof code === 'string' && code.startsWith(prefix)) {
      const suffix = code.slice(prefix.length);
      const parsed = parseInt(suffix, 10);
      if (!isNaN(parsed) && parsed > maxNum) {
        maxNum = parsed;
      }
    }
  });

  const nextNum = maxNum + 1;
  return String(nextNum).padStart(4, '0');
}

/**
 * Generates full item code: [catPrefix]-[subPrefix]-[sequence]
 */
export function generateFullItemCode(
  category: string,
  subcategory: string,
  categoryPrefixMap: Record<string, string> = {},
  subcategoryPrefixMap: Record<string, string> = {},
  existingItemCodes: string[] = []
): {
  code: string;
  categoryPrefix: string;
  subcategoryPrefix: string;
  updatedCategoryMap: Record<string, string>;
  updatedSubcategoryMap: Record<string, string>;
} {
  const catRes = resolvePrefix(category, categoryPrefixMap);
  const subRes = resolvePrefix(subcategory || 'General', subcategoryPrefixMap);
  const seq = getNextSequenceNumber(catRes.prefix, subRes.prefix, existingItemCodes);
  const code = `${catRes.prefix}-${subRes.prefix}-${seq}`;

  return {
    code,
    categoryPrefix: catRes.prefix,
    subcategoryPrefix: subRes.prefix,
    updatedCategoryMap: catRes.updatedRegistry,
    updatedSubcategoryMap: subRes.updatedRegistry,
  };
}
