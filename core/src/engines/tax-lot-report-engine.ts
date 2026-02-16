export interface TaxLotReportInput {
  realizedGains: Array<{
    transactionId: string;
    holdingId: string;
    ticker: string;
    sellDate: Date;
    shares: number;
    proceeds: number;
    costBasis: number;
    gain: number;
    gainPercent: number;
    holdingPeriodDays: number;
    isLongTerm: boolean;
  }>;
  investmentTransactions: Array<{
    id: string;
    holdingId: string;
    type: 'buy' | 'sell' | 'dividend' | 'stock_split' | 'drip';
    date: Date;
    shares: number;
    totalAmount: number;
  }>;
  holdings: Array<{
    id: string;
    ticker: string;
  }>;
  taxYear: number;
}

export interface TaxLotReportEntry {
  ticker: string;
  shares: number;
  purchaseDate: Date;
  sellDate: Date;
  proceeds: number;
  costBasis: number;
  gain: number;
  holdingPeriodDays: number;
  isLongTerm: boolean;
  hasWashSale: boolean;
}

export interface TaxLotGainGroup {
  totalProceeds: number;
  totalCostBasis: number;
  totalGain: number;
  entries: TaxLotReportEntry[];
}

export interface WashSaleFlag {
  sellTransactionId: string;
  repurchaseTransactionId: string;
  repurchaseDate: Date;
  disallowedLoss: number;
}

export interface TaxLotReport {
  taxYear: number;
  shortTermGains: TaxLotGainGroup;
  longTermGains: TaxLotGainGroup;
  totalDividends: number;
  washSaleFlags: WashSaleFlag[];
  summary: {
    netShortTermGain: number;
    netLongTermGain: number;
    totalDividends: number;
  };
}

function isSellInTaxYear(sellDate: Date, taxYear: number): boolean {
  return sellDate.getFullYear() === taxYear;
}

function isDividendInTaxYear(date: Date, taxYear: number): boolean {
  return date.getFullYear() === taxYear;
}

function getTickerFromHoldingId(
  holdingId: string,
  holdings: Array<{ id: string; ticker: string }>
): string | null {
  const holding = holdings.find(h => h.id === holdingId);
  return holding ? holding.ticker : null;
}

function isWithinWashSaleWindow(sellDate: Date, buyDate: Date): boolean {
  const diffMs = buyDate.getTime() - sellDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= -30 && diffDays <= 30;
}

export function generateTaxLotReport(input: TaxLotReportInput): TaxLotReport {
  const { realizedGains, investmentTransactions, holdings, taxYear } = input;

  const gainsInTaxYear = realizedGains.filter(g => isSellInTaxYear(g.sellDate, taxYear));

  const shortTermEntries: TaxLotReportEntry[] = [];
  const longTermEntries: TaxLotReportEntry[] = [];
  const washSaleFlags: WashSaleFlag[] = [];

  const entryMap = new Map<string, TaxLotReportEntry>();

  for (const gain of gainsInTaxYear) {
    const entry: TaxLotReportEntry = {
      ticker: gain.ticker,
      shares: gain.shares,
      purchaseDate: new Date(gain.sellDate.getTime() - gain.holdingPeriodDays * 24 * 60 * 60 * 1000),
      sellDate: gain.sellDate,
      proceeds: gain.proceeds,
      costBasis: gain.costBasis,
      gain: gain.gain,
      holdingPeriodDays: gain.holdingPeriodDays,
      isLongTerm: gain.isLongTerm,
      hasWashSale: false,
    };

    if (gain.isLongTerm) {
      longTermEntries.push(entry);
    } else {
      shortTermEntries.push(entry);
    }

    entryMap.set(gain.transactionId, entry);
  }

  for (const gain of gainsInTaxYear) {
    if (gain.gain >= 0) {
      continue;
    }

    const ticker = gain.ticker;

    const buyTransactions = investmentTransactions.filter(
      tx => tx.type === 'buy' && getTickerFromHoldingId(tx.holdingId, holdings) === ticker
    );

    for (const buyTx of buyTransactions) {
      if (isWithinWashSaleWindow(gain.sellDate, buyTx.date)) {
        washSaleFlags.push({
          sellTransactionId: gain.transactionId,
          repurchaseTransactionId: buyTx.id,
          repurchaseDate: buyTx.date,
          disallowedLoss: Math.abs(gain.gain),
        });

        const entry = entryMap.get(gain.transactionId);
        if (entry) {
          entry.hasWashSale = true;
        }

        break;
      }
    }
  }

  const dividendTransactions = investmentTransactions.filter(
    tx => tx.type === 'dividend' && isDividendInTaxYear(tx.date, taxYear)
  );
  const totalDividends = dividendTransactions.reduce((sum, tx) => sum + tx.totalAmount, 0);

  const shortTermGains: TaxLotGainGroup = {
    totalProceeds: shortTermEntries.reduce((sum, e) => sum + e.proceeds, 0),
    totalCostBasis: shortTermEntries.reduce((sum, e) => sum + e.costBasis, 0),
    totalGain: shortTermEntries.reduce((sum, e) => sum + e.gain, 0),
    entries: shortTermEntries,
  };

  const longTermGains: TaxLotGainGroup = {
    totalProceeds: longTermEntries.reduce((sum, e) => sum + e.proceeds, 0),
    totalCostBasis: longTermEntries.reduce((sum, e) => sum + e.costBasis, 0),
    totalGain: longTermEntries.reduce((sum, e) => sum + e.gain, 0),
    entries: longTermEntries,
  };

  return {
    taxYear,
    shortTermGains,
    longTermGains,
    totalDividends,
    washSaleFlags,
    summary: {
      netShortTermGain: shortTermGains.totalGain,
      netLongTermGain: longTermGains.totalGain,
      totalDividends,
    },
  };
}

export class TaxLotReportEngine {
  generate(input: TaxLotReportInput): TaxLotReport {
    return generateTaxLotReport(input);
  }
}
