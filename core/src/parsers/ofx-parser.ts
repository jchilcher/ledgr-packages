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
}

interface OFXTransaction {
  trntype?: string;
  dtposted?: string;
  trnamt?: string;
  fitid?: string;
  name?: string;
  memo?: string;
}

function parseSGMLTransaction(content: string): OFXTransaction {
  const transaction: OFXTransaction = {};

  // Parse each field - SGML format is <TAG>value (no closing tag)
  const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);

  for (const line of lines) {
    if (line.startsWith('<TRNTYPE>')) {
      transaction.trntype = line.replace('<TRNTYPE>', '').trim();
    } else if (line.startsWith('<DTPOSTED>')) {
      transaction.dtposted = line.replace('<DTPOSTED>', '').trim();
    } else if (line.startsWith('<TRNAMT>')) {
      transaction.trnamt = line.replace('<TRNAMT>', '').trim();
    } else if (line.startsWith('<FITID>')) {
      transaction.fitid = line.replace('<FITID>', '').trim();
    } else if (line.startsWith('<NAME>')) {
      transaction.name = line.replace('<NAME>', '').trim();
    } else if (line.startsWith('<MEMO>')) {
      transaction.memo = line.replace('<MEMO>', '').trim();
    }
  }

  return transaction;
}

function parseOFXSGML(content: string): OFXTransaction[] {
  const transactions: OFXTransaction[] = [];

  // Normalize line endings
  const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Remove OFX header lines (everything before <OFX>)
  const ofxStartIndex = normalizedContent.indexOf('<OFX>');
  if (ofxStartIndex === -1) {
    return transactions;
  }

  const ofxContent = normalizedContent.substring(ofxStartIndex);

  // Extract all STMTTRN blocks (bank or credit card)
  const tranListPattern = /<(?:BANKTRANLIST|CCTRANLIST)>([\s\S]*?)<\/(?:BANKTRANLIST|CCTRANLIST)>/gi;
  const tranListMatches = ofxContent.matchAll(tranListPattern);

  for (const listMatch of tranListMatches) {
    const listContent = listMatch[1];

    // Extract individual transactions
    const stmtTrnPattern = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
    const stmtTrnMatches = listContent.matchAll(stmtTrnPattern);

    for (const trnMatch of stmtTrnMatches) {
      const trnContent = trnMatch[1];
      const transaction = parseSGMLTransaction(trnContent);
      transactions.push(transaction);
    }
  }

  return transactions;
}

function extractXMLTag(content: string, tagName: string): string | undefined {
  const pattern = new RegExp(`<${tagName}>(.*?)</${tagName}>`, 'i');
  const match = content.match(pattern);
  return match ? match[1].trim() : undefined;
}

function parseXMLTransaction(content: string): OFXTransaction {
  const transaction: OFXTransaction = {};

  // Parse XML tags with proper opening/closing tags
  transaction.trntype = extractXMLTag(content, 'TRNTYPE');
  transaction.dtposted = extractXMLTag(content, 'DTPOSTED');
  transaction.trnamt = extractXMLTag(content, 'TRNAMT');
  transaction.fitid = extractXMLTag(content, 'FITID');
  transaction.name = extractXMLTag(content, 'NAME');
  transaction.memo = extractXMLTag(content, 'MEMO');

  return transaction;
}

function parseOFXXML(content: string): OFXTransaction[] {
  const transactions: OFXTransaction[] = [];

  // Normalize line endings
  const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Extract all STMTTRN blocks
  const tranListPattern = /<(?:BANKTRANLIST|CCTRANLIST)>([\s\S]*?)<\/(?:BANKTRANLIST|CCTRANLIST)>/gi;
  const tranListMatches = normalizedContent.matchAll(tranListPattern);

  for (const listMatch of tranListMatches) {
    const listContent = listMatch[1];

    // Extract individual transactions
    const stmtTrnPattern = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
    const stmtTrnMatches = listContent.matchAll(stmtTrnPattern);

    for (const trnMatch of stmtTrnMatches) {
      const trnContent = trnMatch[1];
      const transaction = parseXMLTransaction(trnContent);
      transactions.push(transaction);
    }
  }

  return transactions;
}

function parseOFXDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  // OFX date format: YYYYMMDDHHMMSS or YYYYMMDD
  const yearStr = dateStr.substring(0, 4);
  const monthStr = dateStr.substring(4, 6);
  const dayStr = dateStr.substring(6, 8);

  const year = parseInt(yearStr);
  const month = parseInt(monthStr);
  const day = parseInt(dayStr);

  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    return null;
  }

  // JavaScript Date months are 0-indexed
  const date = new Date(year, month - 1, day);

  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function convertOFXTransaction(ofxTrx: OFXTransaction): ParsedTransaction | null {
  try {
    // Validate required fields
    if (!ofxTrx.dtposted || !ofxTrx.trnamt || !ofxTrx.name) {
      return null;
    }

    // Parse date
    const date = parseOFXDate(ofxTrx.dtposted);
    if (!date) {
      return null;
    }

    // Parse amount
    const amount = parseFloat(ofxTrx.trnamt);
    if (isNaN(amount)) {
      return null;
    }

    // Build description (combine name and memo if both exist)
    let description = ofxTrx.name;
    if (ofxTrx.memo && ofxTrx.memo !== ofxTrx.name) {
      description = `${ofxTrx.name} - ${ofxTrx.memo}`;
    }

    return {
      date,
      description,
      amount,
    };

  } catch {
    return null;
  }
}

/**
 * Parse OFX content string and extract transactions
 * @param content OFX file content as string
 * @returns ParseResult with transactions or error
 */
export function parseOFXContent(content: string): ParseResult {
  try {
    if (!content || content.trim().length === 0) {
      return {
        success: false,
        transactions: [],
        skipped: 0,
        error: 'Content is empty',
      };
    }

    // Detect if it's XML (OFX v2) or SGML (OFX v1)
    const isXML = content.trim().startsWith('<?xml');

    let ofxTransactions: OFXTransaction[];

    if (isXML) {
      ofxTransactions = parseOFXXML(content);
    } else {
      ofxTransactions = parseOFXSGML(content);
    }

    if (ofxTransactions.length === 0) {
      return {
        success: false,
        transactions: [],
        skipped: 0,
        error: 'No transactions found in OFX content',
      };
    }

    // Convert OFX transactions to ParsedTransaction format
    const transactions: ParsedTransaction[] = [];
    let skipped = 0;

    for (const ofxTrx of ofxTransactions) {
      const transaction = convertOFXTransaction(ofxTrx);
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

// Export utility functions
export { parseOFXDate };
