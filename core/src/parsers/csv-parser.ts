export interface ParsedTransaction {
  date: Date;
  description: string;
  amount: number;
  category?: string;
  balance?: number;
}

export interface ParseResult {
  success: boolean;
  transactions: ParsedTransaction[];
  skipped: number;
  error?: string;
  detectedFormat?: string | null;
}

interface CSVRow {
  [key: string]: string;
}

// ==================== Fuzzy Column Matching Constants ====================

const DATE_COLUMNS = [
  'date',
  'transaction date',
  'trans date',
  'trans. date',
  'posting date',
  'post date',
  'posted date',
  'effective date',
  'value date',
];

const DESCRIPTION_COLUMNS = [
  'description',
  'memo',
  'narrative',
  'payee',
  'merchant',
  'transaction description',
  'details',
  'name',
  'merchant name',
];

const AMOUNT_COLUMNS = [
  'amount',
  'transaction amount',
  'amt',
  'value',
  'sum',
];

const DEBIT_COLUMNS = [
  'debit',
  'debit amount',
  'withdrawal',
  'money out',
  'withdrawals',
  'debits',
];

const CREDIT_COLUMNS = [
  'credit',
  'credit amount',
  'deposit',
  'money in',
  'deposits',
  'credits',
];

const CATEGORY_COLUMNS = [
  'category',
  'type',
  'transaction type',
  'merchant category',
];

const BALANCE_COLUMNS = [
  'balance',
  'running balance',
  'available balance',
  'ledger balance',
];

export type TransactionAmountType = 'single' | 'split';

export interface TransactionColumnMapping {
  date: string | null;
  description: string | null;
  amount: string | null;       // For single amount type
  debit: string | null;        // For split amount type
  credit: string | null;       // For split amount type
  category: string | null;     // Optional
  balance: string | null;      // Optional
  amountType: TransactionAmountType;
  headerRow?: number;          // 0-based index of header row (user override)
}

export interface CSVRawData {
  rawRows: string[][];              // Each row = array of cell values (up to maxRows)
  totalRows: number;                // Total non-empty lines in file
  detectedHeaderRow: number;        // 0-based index from findHeaderRow()
  detectedDelimiter: string;
  suggestedMapping: TransactionColumnMapping | null;
}

export interface CSVColumnInfo {
  columns: string[];
  sampleData: Record<string, string>[];
  suggestedMapping: TransactionColumnMapping | null;
}

// Bank-specific CSV formats (headerless)
interface BankFormat {
  name: string;
  detect: (firstLine: string, values: string[]) => boolean;
  mapToRow: (values: string[]) => CSVRow;
}

// Bank format type with header info for detection
interface BankFormatWithHeaders {
  name: string;
  hasHeaders: boolean;
  headerSignature?: string[];  // Expected header names (normalized)
  columnCount?: number;
  detect: (firstLine: string, values: string[]) => boolean;
  mapToRow: (values: string[]) => CSVRow;
  amountType?: TransactionAmountType;
}

const BANK_FORMATS: BankFormatWithHeaders[] = [
  {
    // Wells Fargo: "Date","Amount","*","","Description" (headerless)
    name: 'Wells Fargo',
    hasHeaders: false,
    detect: (_firstLine: string, values: string[]) => {
      if (values.length !== 5) return false;
      const datePattern = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
      if (!datePattern.test(values[0].replace(/"/g, ''))) return false;
      const amountPattern = /^-?\d+\.?\d*$/;
      if (!amountPattern.test(values[1].replace(/"/g, ''))) return false;
      if (values[2].replace(/"/g, '') === '*') return true;
      return false;
    },
    mapToRow: (values: string[]) => ({
      date: values[0].replace(/"/g, ''),
      amount: values[1].replace(/"/g, ''),
      description: values[4].replace(/"/g, ''),
    }),
    amountType: 'single',
  },
  {
    // Chase: "Transaction Date","Post Date","Description","Category","Type","Amount","Memo"
    name: 'Chase',
    hasHeaders: true,
    headerSignature: ['transaction date', 'post date', 'description', 'category', 'type', 'amount', 'memo'],
    detect: (firstLine: string, values: string[]) => {
      if (values.length !== 7) return false;
      const normalized = values.map(v => v.replace(/"/g, '').toLowerCase().trim());
      return normalized.includes('transaction date') &&
             normalized.includes('amount') &&
             normalized.includes('description');
    },
    mapToRow: (values: string[]) => ({
      date: values[0].replace(/"/g, ''),
      description: values[2].replace(/"/g, ''),
      category: values[3].replace(/"/g, ''),
      amount: values[5].replace(/"/g, ''),
    }),
    amountType: 'single',
  },
  {
    // Bank of America: "Date","Description","Debit","Credit" (split columns)
    name: 'Bank of America',
    hasHeaders: true,
    headerSignature: ['date', 'description', 'debit', 'credit'],
    detect: (firstLine: string, values: string[]) => {
      if (values.length < 4) return false;
      const normalized = values.map(v => v.replace(/"/g, '').toLowerCase().trim());
      return normalized.includes('date') &&
             normalized.includes('description') &&
             normalized.includes('debit') &&
             normalized.includes('credit');
    },
    mapToRow: (values: string[]) => {
      const debit = values[2]?.replace(/"/g, '').trim();
      const credit = values[3]?.replace(/"/g, '').trim();
      // Combine debit/credit into single amount (debit is negative)
      let amount = '0';
      if (debit && parseFloat(debit)) {
        amount = '-' + debit;
      } else if (credit && parseFloat(credit)) {
        amount = credit;
      }
      return {
        date: values[0].replace(/"/g, ''),
        description: values[1].replace(/"/g, ''),
        amount,
        debit,
        credit,
      };
    },
    amountType: 'split',
  },
  {
    // Capital One: "Transaction Date","Posted Date","Card No.","Description","Category","Debit","Credit"
    name: 'Capital One',
    hasHeaders: true,
    headerSignature: ['transaction date', 'posted date', 'card no.', 'description', 'category', 'debit', 'credit'],
    detect: (firstLine: string, values: string[]) => {
      if (values.length < 7) return false;
      const normalized = values.map(v => v.replace(/"/g, '').toLowerCase().trim());
      return normalized.includes('transaction date') &&
             normalized.includes('description') &&
             normalized.includes('debit') &&
             normalized.includes('credit') &&
             (normalized.includes('card no.') || normalized.includes('card no'));
    },
    mapToRow: (values: string[]) => {
      const debit = values[5]?.replace(/"/g, '').trim();
      const credit = values[6]?.replace(/"/g, '').trim();
      let amount = '0';
      if (debit && parseFloat(debit)) {
        amount = '-' + debit;
      } else if (credit && parseFloat(credit)) {
        amount = credit;
      }
      return {
        date: values[0].replace(/"/g, ''),
        description: values[3].replace(/"/g, ''),
        category: values[4].replace(/"/g, ''),
        amount,
        debit,
        credit,
      };
    },
    amountType: 'split',
  },
  {
    // Discover: "Trans. Date","Post Date","Description","Amount","Category"
    name: 'Discover',
    hasHeaders: true,
    headerSignature: ['trans. date', 'post date', 'description', 'amount', 'category'],
    detect: (firstLine: string, values: string[]) => {
      if (values.length < 5) return false;
      const normalized = values.map(v => v.replace(/"/g, '').toLowerCase().trim());
      return (normalized.includes('trans. date') || normalized.includes('trans date')) &&
             normalized.includes('description') &&
             normalized.includes('amount') &&
             normalized.includes('category');
    },
    mapToRow: (values: string[]) => ({
      date: values[0].replace(/"/g, ''),
      description: values[2].replace(/"/g, ''),
      amount: values[3].replace(/"/g, ''),
      category: values[4].replace(/"/g, ''),
    }),
    amountType: 'single',
  },
];

function parseCSVLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function detectDelimiter(content: string): string {
  const firstLine = content.split('\n')[0].replace(/\r/g, '');

  if (firstLine.includes('\t')) {
    return '\t';
  } else if (firstLine.includes(';')) {
    return ';';
  } else {
    return ',';
  }
}

function detectBankFormat(lines: string[], delimiter: string): BankFormatWithHeaders | null {
  if (lines.length === 0) return null;

  const firstLine = lines[0];
  const values = parseCSVLine(firstLine, delimiter);

  for (const format of BANK_FORMATS) {
    if (format.detect(firstLine, values)) {
      return format;
    }
  }

  return null;
}

/**
 * Find the actual header row index, skipping metadata lines.
 * Brokerage exports (like E*Trade) often have metadata lines like
 * "For Account:,#####9714" before the actual CSV headers.
 * Detects this by finding the first line whose column count matches
 * the most common column count among all lines (the data rows).
 */
function findHeaderRow(lines: string[], delimiter: string): number {
  if (lines.length < 2) return 0;

  const columnCounts = lines.map(line => parseCSVLine(line, delimiter).length);

  // Find the most common column count among lines with >2 columns
  const countFrequency = new Map<number, number>();
  for (const count of columnCounts) {
    if (count > 2) {
      countFrequency.set(count, (countFrequency.get(count) || 0) + 1);
    }
  }

  if (countFrequency.size === 0) return 0;

  let modeCount = 0;
  let modeFrequency = 0;
  for (const [count, freq] of countFrequency) {
    if (freq > modeFrequency) {
      modeCount = count;
      modeFrequency = freq;
    }
  }

  // The header row is the first line with the mode column count
  for (let i = 0; i < lines.length; i++) {
    if (columnCounts[i] === modeCount) {
      return i;
    }
  }

  return 0;
}

// ==================== Fuzzy Column Matching Functions ====================

/**
 * Case-insensitive fuzzy matching for column headers
 */
function fuzzyMatchColumn(header: string, columnNames: string[]): boolean {
  const normalized = header.toLowerCase().trim().replace(/[_-]/g, ' ');
  return columnNames.some(col => normalized === col || normalized.includes(col) || col.includes(normalized));
}

/**
 * Find the best matching column from available headers
 */
function findMatchingColumn(headers: string[], columnNames: string[]): string | null {
  for (const header of headers) {
    if (fuzzyMatchColumn(header, columnNames)) {
      return header;
    }
  }
  return null;
}

/**
 * Suggest transaction column mapping from CSV headers
 */
export function suggestTransactionMapping(headers: string[]): TransactionColumnMapping | null {
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim());

  const dateCol = findMatchingColumn(headers, DATE_COLUMNS);
  const descCol = findMatchingColumn(headers, DESCRIPTION_COLUMNS);
  const amountCol = findMatchingColumn(headers, AMOUNT_COLUMNS);
  const debitCol = findMatchingColumn(headers, DEBIT_COLUMNS);
  const creditCol = findMatchingColumn(headers, CREDIT_COLUMNS);
  const categoryCol = findMatchingColumn(headers, CATEGORY_COLUMNS);
  const balanceCol = findMatchingColumn(headers, BALANCE_COLUMNS);

  // Need at least date, description, and either amount or debit/credit
  if (!dateCol || !descCol) {
    return null;
  }

  const hasAmount = amountCol !== null;
  const hasSplitAmount = debitCol !== null && creditCol !== null;

  if (!hasAmount && !hasSplitAmount) {
    return null;
  }

  return {
    date: dateCol,
    description: descCol,
    amount: hasAmount ? amountCol : null,
    debit: hasSplitAmount ? debitCol : null,
    credit: hasSplitAmount ? creditCol : null,
    category: categoryCol,
    balance: balanceCol,
    amountType: hasSplitAmount && !hasAmount ? 'split' : 'single',
  };
}

/**
 * Get raw CSV rows for spreadsheet-style visual mapping.
 * Returns parsed cell arrays, detected header row, and suggested mapping.
 */
export function getCSVRawRows(content: string, maxRows = 50): CSVRawData | null {
  try {
    if (!content || content.trim().length === 0) {
      return null;
    }

    const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const delimiter = detectDelimiter(normalizedContent);
    const allLines = normalizedContent.split('\n').filter(line => line.trim().length > 0);

    if (allLines.length < 2) {
      return null;
    }

    const linesToParse = allLines.slice(0, maxRows);
    const rawRows = linesToParse.map(line => parseCSVLine(line, delimiter));
    const detectedHeaderRow = findHeaderRow(allLines, delimiter);

    // Build suggested mapping from the detected header row
    let suggestedMapping: TransactionColumnMapping | null = null;
    if (detectedHeaderRow < rawRows.length) {
      const headers = rawRows[detectedHeaderRow].map(h => h.replace(/"/g, '').trim());
      suggestedMapping = suggestTransactionMapping(headers);
    }

    return {
      rawRows,
      totalRows: allLines.length,
      detectedHeaderRow,
      detectedDelimiter: delimiter,
      suggestedMapping,
    };
  } catch {
    return null;
  }
}

/**
 * Get column info and sample data from CSV for manual mapping
 */
export function getCSVColumnInfo(content: string): CSVColumnInfo | null {
  try {
    if (!content || content.trim().length === 0) {
      return null;
    }

    const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const delimiter = detectDelimiter(normalizedContent);
    const lines = normalizedContent.split('\n').filter(line => line.trim().length > 0);

    if (lines.length < 2) {
      return null;
    }

    // Skip metadata lines (e.g. E*Trade's "For Account:,..." prefix)
    const headerRowIndex = findHeaderRow(lines, delimiter);

    const headers = parseCSVLine(lines[headerRowIndex], delimiter).map(h => h.replace(/"/g, '').trim());
    const sampleData: Record<string, string>[] = [];

    // Get up to 3 sample rows after the header
    for (let i = headerRowIndex + 1; i < Math.min(headerRowIndex + 4, lines.length); i++) {
      const values = parseCSVLine(lines[i], delimiter);
      const row: Record<string, string> = {};
      headers.forEach((header, idx) => {
        row[header] = (values[idx] || '').replace(/"/g, '').trim();
      });
      sampleData.push(row);
    }

    const suggestedMapping = suggestTransactionMapping(headers);

    return {
      columns: headers,
      sampleData,
      suggestedMapping,
    };
  } catch {
    return null;
  }
}

/**
 * Parse CSV content using explicit column mapping
 */
export function parseCSVWithMapping(
  content: string,
  mapping: TransactionColumnMapping,
  headerRowOverride?: number
): ParseResult {
  try {
    if (!content || content.trim().length === 0) {
      return {
        success: false,
        transactions: [],
        skipped: 0,
        error: 'Content is empty',
      };
    }

    if (!mapping.date || !mapping.description) {
      return {
        success: false,
        transactions: [],
        skipped: 0,
        error: 'Date and description columns are required',
      };
    }

    if (mapping.amountType === 'single' && !mapping.amount) {
      return {
        success: false,
        transactions: [],
        skipped: 0,
        error: 'Amount column is required for single amount type',
      };
    }

    if (mapping.amountType === 'split' && (!mapping.debit || !mapping.credit)) {
      return {
        success: false,
        transactions: [],
        skipped: 0,
        error: 'Debit and credit columns are required for split amount type',
      };
    }

    const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const delimiter = detectDelimiter(normalizedContent);
    const lines = normalizedContent.split('\n').filter(line => line.trim().length > 0);

    if (lines.length < 2) {
      return {
        success: false,
        transactions: [],
        skipped: 0,
        error: 'No data rows found',
      };
    }

    // Use override or detect header row (skip metadata lines)
    const headerRowIndex = headerRowOverride ?? mapping.headerRow ?? findHeaderRow(lines, delimiter);

    if (headerRowIndex >= lines.length - 1) {
      return {
        success: false,
        transactions: [],
        skipped: 0,
        error: 'No data rows found after header',
      };
    }

    const headers = parseCSVLine(lines[headerRowIndex], delimiter).map(h => h.replace(/"/g, '').trim());
    const transactions: ParsedTransaction[] = [];
    let skipped = 0;

    for (let i = headerRowIndex + 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i], delimiter);
      const row: Record<string, string> = {};
      headers.forEach((header, idx) => {
        row[header] = (values[idx] || '').replace(/"/g, '').trim();
      });

      // Parse date
      const dateStr = mapping.date ? row[mapping.date] : null;
      const date = dateStr ? parseDate(dateStr) : null;
      if (!date) {
        skipped++;
        continue;
      }

      // Parse description
      const description = mapping.description ? row[mapping.description]?.trim() : '';
      if (!description) {
        skipped++;
        continue;
      }

      // Parse amount
      let amount: number;
      if (mapping.amountType === 'split') {
        const debitStr = mapping.debit ? row[mapping.debit] : '';
        const creditStr = mapping.credit ? row[mapping.credit] : '';
        const debit = parseAmount(debitStr);
        const credit = parseAmount(creditStr);

        if (isNaN(debit) && isNaN(credit)) {
          skipped++;
          continue;
        }

        // Debit is negative (outflow), credit is positive (inflow)
        amount = (!isNaN(credit) && credit !== 0) ? credit : -Math.abs(debit);
      } else {
        const amountStr = mapping.amount ? row[mapping.amount] : '';
        amount = parseAmount(amountStr);
        if (isNaN(amount)) {
          skipped++;
          continue;
        }
      }

      const transaction: ParsedTransaction = {
        date,
        description,
        amount,
      };

      // Optional category
      if (mapping.category && row[mapping.category]) {
        transaction.category = row[mapping.category].trim();
      }

      // Optional balance
      if (mapping.balance && row[mapping.balance]) {
        const balance = parseAmount(row[mapping.balance]);
        if (!isNaN(balance)) {
          transaction.balance = balance;
        }
      }

      transactions.push(transaction);
    }

    return {
      success: true,
      transactions,
      skipped,
      detectedFormat: 'Manual Mapping',
    };
  } catch (error) {
    return {
      success: false,
      transactions: [],
      skipped: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  const trimmed = dateStr.trim();

  // Try standard ISO format (YYYY-MM-DD)
  let date = new Date(trimmed);
  if (!isNaN(date.getTime())) {
    return date;
  }

  // Try MM/DD/YYYY format
  const slashPattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const slashMatch = trimmed.match(slashPattern);
  if (slashMatch) {
    const [, month, day, year] = slashMatch;
    date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // Try DD-Mon-YYYY format (e.g., 15-Jan-2026)
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const dashMonthPattern = /^(\d{1,2})-([a-z]{3})-(\d{4})$/i;
  const dashMonthMatch = trimmed.match(dashMonthPattern);
  if (dashMonthMatch) {
    const [, day, monthStr, year] = dashMonthMatch;
    const monthIndex = monthNames.indexOf(monthStr.toLowerCase());
    if (monthIndex !== -1) {
      date = new Date(parseInt(year), monthIndex, parseInt(day));
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  }

  return null;
}

function parseAmount(amountStr: string): number {
  if (!amountStr) return NaN;

  // Remove currency symbols and whitespace
  const cleaned = amountStr.trim()
    .replace(/[$€£¥]/g, '')
    .replace(/,/g, '')
    .replace(/\s/g, '');

  return parseFloat(cleaned);
}

function parseTransaction(row: CSVRow): ParsedTransaction | null {
  try {
    // Parse date
    const date = parseDate(row.date);
    if (!date || isNaN(date.getTime())) {
      return null;
    }

    // Parse amount
    const amount = parseAmount(row.amount);
    if (isNaN(amount)) {
      return null;
    }

    // Parse description
    const description = row.description?.trim();
    if (!description) {
      return null;
    }

    const transaction: ParsedTransaction = {
      date,
      description,
      amount,
    };

    // Optional fields
    if (row.category) {
      transaction.category = row.category.trim();
    }

    if (row.balance) {
      const balance = parseAmount(row.balance);
      if (!isNaN(balance)) {
        transaction.balance = balance;
      }
    }

    return transaction;

  } catch {
    return null;
  }
}

function parseBankFormat(lines: string[], delimiter: string, format: BankFormatWithHeaders): ParseResult {
  const transactions: ParsedTransaction[] = [];
  let skipped = 0;

  // Skip header line if format has headers
  const startLine = format.hasHeaders ? 1 : 0;

  for (let i = startLine; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], delimiter);
    const row = format.mapToRow(values);
    const transaction = parseTransaction(row);

    if (transaction) {
      transactions.push(transaction);
    } else {
      skipped++;
    }
  }

  return {
    success: true,
    transactions,
    skipped,
    detectedFormat: format.name,
  };
}

/**
 * Parse CSV content string and extract transactions
 * @param content CSV file content as string
 * @returns ParseResult with transactions or error
 */
export function parseCSVContent(content: string): ParseResult {
  try {
    if (!content || content.trim().length === 0) {
      return {
        success: false,
        transactions: [],
        skipped: 0,
        error: 'Content is empty',
      };
    }

    // Normalize line endings (handle both CRLF and LF)
    const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Detect delimiter
    const delimiter = detectDelimiter(normalizedContent);

    // Parse CSV
    const lines = normalizedContent.split('\n').filter(line => line.trim().length > 0);

    if (lines.length === 0) {
      return {
        success: false,
        transactions: [],
        skipped: 0,
        error: 'Content is empty or has no data rows',
      };
    }

    // Detect if this is a bank-specific headerless format
    const bankFormat = detectBankFormat(lines, delimiter);

    if (bankFormat) {
      return parseBankFormat(lines, delimiter, bankFormat);
    }

    // Skip metadata lines (e.g. E*Trade's "For Account:,..." prefix)
    const headerRowIndex = findHeaderRow(lines, delimiter);

    // Standard CSV with headers
    if (headerRowIndex >= lines.length - 1) {
      return {
        success: false,
        transactions: [],
        skipped: 0,
        error: 'Content is empty or has no data rows',
      };
    }

    // Parse header (preserve original case for fuzzy matching)
    const rawHeaders = parseCSVLine(lines[headerRowIndex], delimiter).map(h => h.replace(/"/g, '').trim());
    const headers = rawHeaders.map(h => h.toLowerCase());

    // Try fuzzy matching first to find columns
    const mapping = suggestTransactionMapping(rawHeaders);

    if (mapping) {
      // Use fuzzy-matched columns
      return parseCSVWithMapping(content, mapping);
    }

    // Fall back to exact column names: date, description, amount
    const requiredColumns = ['date', 'description', 'amount'];
    const missingColumns = requiredColumns.filter(col => !headers.includes(col));

    if (missingColumns.length > 0) {
      return {
        success: false,
        transactions: [],
        skipped: 0,
        error: `Missing required columns: ${missingColumns.join(', ')}. Available columns: ${rawHeaders.join(', ')}`,
        detectedFormat: null,
      };
    }

    // Parse data rows
    const transactions: ParsedTransaction[] = [];
    let skipped = 0;

    for (let i = headerRowIndex + 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i], delimiter);

      // Create row object
      const row: CSVRow = {};
      headers.forEach((header, index) => {
        row[header] = (values[index] || '').replace(/"/g, '');
      });

      // Parse transaction
      const transaction = parseTransaction(row);

      if (transaction) {
        transactions.push(transaction);
      } else {
        skipped++;
      }
    }

    return {
      success: true,
      transactions,
      skipped,
      detectedFormat: 'Generic CSV',
    };

  } catch (error) {
    return {
      success: false,
      transactions: [],
      skipped: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Export utility functions for reuse
export { parseDate, parseAmount, parseCSVLine, detectDelimiter, findHeaderRow };

// Export available bank format names for UI display
export function getAvailableTransactionFormats(): Array<{ name: string; displayName: string }> {
  return BANK_FORMATS.map(f => ({
    name: f.name.toLowerCase().replace(/\s+/g, '_'),
    displayName: f.name,
  }));
}

// Export format display name helper
export function getTransactionFormatDisplayName(formatName: string | null): string {
  if (!formatName) return 'Unknown Format';
  const format = BANK_FORMATS.find(f => f.name.toLowerCase() === formatName.toLowerCase());
  return format ? format.name : formatName;
}
