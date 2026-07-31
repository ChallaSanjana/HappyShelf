import { describe, test, expect } from 'vitest';
import { splitCsvLine, parseCsv, normalizeRows, parseImportFile } from '../csvImport';

describe('splitCsvLine', () => {
  test('splits a plain line', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  test('keeps commas inside quoted fields', () => {
    expect(splitCsvLine('"Rice, basmati",Grains')).toEqual(['Rice, basmati', 'Grains']);
  });

  test('unescapes doubled quotes', () => {
    expect(splitCsvLine('"He said ""hi""",x')).toEqual(['He said "hi"', 'x']);
  });

  test('preserves empty trailing fields', () => {
    expect(splitCsvLine('a,,c,')).toEqual(['a', '', 'c', '']);
  });

  test('trims surrounding whitespace', () => {
    expect(splitCsvLine(' a , b ')).toEqual(['a', 'b']);
  });
});

describe('parseCsv', () => {
  test('maps rows onto lower-cased headers', () => {
    const rows = parseCsv('Name,Quantity\nRice,10');
    expect(rows).toEqual([{ name: 'Rice', quantity: '10' }]);
  });

  test('ignores blank lines', () => {
    expect(parseCsv('Name\nRice\n\n\nBeans')).toHaveLength(2);
  });

  test('handles CRLF line endings', () => {
    expect(parseCsv('Name,Qty\r\nRice,5\r\n')).toEqual([{ name: 'Rice', qty: '5' }]);
  });

  test('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });

  test('fills missing trailing columns rather than dropping them', () => {
    expect(parseCsv('name,category,qty\nRice')).toEqual([{ name: 'Rice', category: '', qty: '' }]);
  });
});

describe('normalizeRows', () => {
  const goodRow = { name: 'Rice', category: 'Grains', quantity: '10', daily_usage: '2', unit: 'kg' };

  test('maps a well-formed row to an item payload', () => {
    const { items, errors } = normalizeRows([goodRow]);
    expect(errors).toEqual([]);
    expect(items[0]).toMatchObject({
      name: 'Rice',
      category: 'Grains',
      quantity: 10,
      daily_usage: 2,
      unit: 'kg',
    });
  });

  test('accepts alternative header spellings', () => {
    const { items } = normalizeRows([
      { item: 'Beans', cat: 'Pulses', qty: '4', 'daily usage': '1', units: 'kg' },
    ]);
    expect(items[0]).toMatchObject({ name: 'Beans', category: 'Pulses', quantity: 4, daily_usage: 1 });
  });

  test('defaults a missing category', () => {
    const { items } = normalizeRows([{ ...goodRow, category: '' }]);
    expect(items[0].category).toBe('Uncategorized');
  });

  test('falls back to pcs for an unknown unit rather than failing the row', () => {
    const { items, errors } = normalizeRows([{ ...goodRow, unit: 'furlongs' }]);
    expect(errors).toEqual([]);
    expect(items[0].unit).toBe('pcs');
  });

  test('rejects a row with no name', () => {
    const { items, errors } = normalizeRows([{ ...goodRow, name: '' }]);
    expect(items).toHaveLength(0);
    expect(errors[0].error).toMatch(/Missing item name/);
  });

  test('rejects a non-numeric quantity', () => {
    const { errors } = normalizeRows([{ ...goodRow, quantity: 'ten' }]);
    expect(errors[0].error).toMatch(/Quantity/);
  });

  test('rejects a zero quantity', () => {
    const { errors } = normalizeRows([{ ...goodRow, quantity: '0' }]);
    expect(errors).toHaveLength(1);
  });

  test('rejects an unparseable expiry date', () => {
    const { errors } = normalizeRows([{ ...goodRow, expiry_date: 'next tuesday' }]);
    expect(errors[0].error).toMatch(/Unrecognised expiry date/);
  });

  test('reports row numbers that match the spreadsheet', () => {
    // Row 1 is the header, so the first data row is row 2.
    const { errors } = normalizeRows([goodRow, { ...goodRow, name: '' }]);
    expect(errors[0].row).toBe(3);
  });

  test('imports good rows alongside bad ones', () => {
    const { items, errors } = normalizeRows([goodRow, { ...goodRow, name: '' }, goodRow]);
    expect(items).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });

  test('drops a min_stock_level above the quantity instead of failing the row', () => {
    // The server rejects that combination; the item itself is still fine.
    const { items, errors } = normalizeRows([{ ...goodRow, min_stock_level: '999' }]);
    expect(errors).toEqual([]);
    expect(items[0].min_stock_level).toBeNull();
  });

  test('keeps a valid min_stock_level', () => {
    const { items } = normalizeRows([{ ...goodRow, min_stock_level: '5' }]);
    expect(items[0].min_stock_level).toBe(5);
  });

  test('reads cost from any of its accepted spellings', () => {
    const { items } = normalizeRows([{ ...goodRow, price: '60' }]);
    expect(items[0].cost_per_unit).toBe(60);
  });
});

describe('parseImportFile', () => {
  test('parses CSV by extension', () => {
    const { items } = parseImportFile('name,quantity,daily_usage\nRice,10,2', 'stock.csv');
    expect(items).toHaveLength(1);
  });

  test('parses a bare JSON array', () => {
    const json = JSON.stringify([{ name: 'Rice', quantity: 10, daily_usage: 2 }]);
    const { items } = parseImportFile(json, 'stock.json');
    expect(items[0].name).toBe('Rice');
  });

  test('parses a JSON object wrapping an items array', () => {
    const json = JSON.stringify({ items: [{ name: 'Rice', quantity: 10, daily_usage: 2 }] });
    const { items } = parseImportFile(json, 'stock.json');
    expect(items).toHaveLength(1);
  });

  test('reports malformed JSON without throwing', () => {
    const { items, errors } = parseImportFile('{ not json', 'stock.json');
    expect(items).toEqual([]);
    expect(errors[0].error).toMatch(/not valid JSON/);
  });

  test('rejects JSON that is neither an array nor an items object', () => {
    const { errors } = parseImportFile(JSON.stringify({ foo: 'bar' }), 'stock.json');
    expect(errors[0].error).toMatch(/Expected a JSON array/);
  });

  test('dispatches on MIME type when the extension is missing', () => {
    const json = JSON.stringify([{ name: 'Rice', quantity: 10, daily_usage: 2 }]);
    const { items } = parseImportFile(json, 'download', 'application/json');
    expect(items).toHaveLength(1);
  });
});
