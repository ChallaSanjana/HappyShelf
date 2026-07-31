import type { NewInventoryItem, InventoryItem } from '../services/api';

/**
 * Parsing and normalisation for the CSV/JSON inventory import.
 *
 * Extracted from Dashboard.tsx, where it was ~150 lines inlined in the
 * middle of a 1400-line component and therefore untestable. The rules here
 * (which header spellings map to which field, what makes a row unusable)
 * are the kind of thing that only shows up as a bug against a real
 * spreadsheet, so they belong somewhere they can be exercised directly.
 */

export interface ParsedRowError {
  row: number;
  name: string | null;
  error: string;
}

export interface ParseResult {
  items: NewInventoryItem[];
  errors: ParsedRowError[];
}

const VALID_UNITS: InventoryItem['unit'][] = [
  'pcs', 'kg', 'g', 'L', 'ml', 'packs', 'bottles', 'boxes', 'other',
];

/** Splits one CSV line, honouring quoted fields and doubled quotes. */
export function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map((value) => value.trim());
}

/** Parses CSV text into row objects keyed by lower-cased header. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];

  // Normalise headers so "Quantity", "quantity" and " Quantity " all match.
  const headers = splitCsvLine(lines[0]).map((header) => header.trim().toLowerCase());

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    return row;
  });
}

/** Picks the first present string value among several accepted header names. */
function pickString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

function pickNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (value === undefined || value === null || String(value).trim() === '') continue;
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

/** Lower-cases and trims every key so JSON imports match CSV headers. */
function normalizeKeys(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  Object.entries(row).forEach(([key, value]) => {
    normalized[key.trim().toLowerCase()] = value;
  });
  return normalized;
}

function isValidDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * Turns raw parsed rows into item payloads, collecting per-row problems
 * rather than aborting the whole import on the first bad line.
 */
export function normalizeRows(rows: Record<string, unknown>[]): ParseResult {
  const items: NewInventoryItem[] = [];
  const errors: ParsedRowError[] = [];

  rows.forEach((rawRow, index) => {
    // 1-based, and counting the header line, so the number matches what the
    // user sees in their spreadsheet editor.
    const rowNumber = index + 2;
    const row = normalizeKeys(rawRow);

    const name = pickString(row, ['name', 'item', 'product']);
    if (!name) {
      errors.push({ row: rowNumber, name: null, error: 'Missing item name' });
      return;
    }

    const quantity = pickNumber(row, ['quantity', 'qty', 'stock']);
    if (quantity === null || quantity <= 0) {
      errors.push({ row: rowNumber, name, error: 'Quantity must be a number greater than 0' });
      return;
    }

    const dailyUsage = pickNumber(row, ['daily_usage', 'dailyusage', 'daily usage', 'usage']);
    if (dailyUsage === null || dailyUsage <= 0) {
      errors.push({ row: rowNumber, name, error: 'Daily usage must be a number greater than 0' });
      return;
    }

    const expiryDate = pickString(row, ['expiry_date', 'expiry', 'expirydate', 'expiry date']);
    if (expiryDate && !isValidDate(expiryDate)) {
      errors.push({ row: rowNumber, name, error: `Unrecognised expiry date "${expiryDate}"; expected YYYY-MM-DD` });
      return;
    }

    const purchaseDate = pickString(row, ['purchase_date', 'purchasedate', 'purchase date']);
    if (purchaseDate && !isValidDate(purchaseDate)) {
      errors.push({ row: rowNumber, name, error: `Unrecognised purchase date "${purchaseDate}"; expected YYYY-MM-DD` });
      return;
    }

    const rawUnit = pickString(row, ['unit', 'units']);
    // An unrecognised unit falls back to 'pcs' rather than failing the row —
    // the unit is incidental to getting the item into the inventory at all.
    const unit = (VALID_UNITS as string[]).includes(rawUnit ?? '')
      ? (rawUnit as InventoryItem['unit'])
      : 'pcs';

    const minStockLevel = pickNumber(row, ['min_stock_level', 'minstocklevel', 'min stock level', 'minimum']);
    const costPerUnit = pickNumber(row, ['cost_per_unit', 'costperunit', 'cost per unit', 'price', 'cost']);

    items.push({
      name,
      category: pickString(row, ['category', 'cat']) ?? 'Uncategorized',
      quantity,
      daily_usage: dailyUsage,
      expiry_date: expiryDate,
      unit,
      purchase_date: purchaseDate,
      // The server rejects a minimum above the quantity, so drop an
      // out-of-range value instead of failing an otherwise good row.
      min_stock_level: minStockLevel !== null && minStockLevel <= quantity ? minStockLevel : null,
      storage_location: pickString(row, ['storage_location', 'storagelocation', 'storage location', 'location']),
      cost_per_unit: costPerUnit !== null && costPerUnit >= 0 ? costPerUnit : null,
    });
  });

  return { items, errors };
}

/** Parses a whole import file, dispatching on its extension/MIME type. */
export function parseImportFile(text: string, fileName: string, mimeType = ''): ParseResult {
  const isJson = mimeType === 'application/json' || fileName.toLowerCase().endsWith('.json');

  if (isJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { items: [], errors: [{ row: 0, name: null, error: 'File is not valid JSON' }] };
    }

    const rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : null;

    if (!rows) {
      return {
        items: [],
        errors: [{ row: 0, name: null, error: 'Expected a JSON array, or an object with an "items" array' }],
      };
    }

    return normalizeRows(rows as Record<string, unknown>[]);
  }

  return normalizeRows(parseCsv(text));
}
