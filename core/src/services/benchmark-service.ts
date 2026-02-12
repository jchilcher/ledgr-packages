import YahooFinance from 'yahoo-finance2';
import { backOff } from 'exponential-backoff';

const yahooFinance = new YahooFinance();

export interface BenchmarkReturn {
  symbol: string;
  name: string;
  startDate: Date;
  endDate: Date;
  startPrice: number;      // Price in cents
  endPrice: number;        // Price in cents
  totalReturn: number;     // Return as decimal (0.10 = 10%)
  annualizedReturn: number;
}

export interface BenchmarkServiceConfig {
  maxRetries?: number;
  maxDelay?: number;
}

const DEFAULT_CONFIG: Required<BenchmarkServiceConfig> = {
  maxRetries: 3,
  maxDelay: 5000,
};

// S&P 500 ETF (SPY) is more reliable than ^GSPC index
const SP500_SYMBOL = 'SPY';
const SP500_NAME = 'S&P 500 (SPY)';

export class BenchmarkService {
  private config: Required<BenchmarkServiceConfig>;

  constructor(config: BenchmarkServiceConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Fetch S&P 500 return for a given period.
   */
  async fetchSP500Return(startDate: Date, endDate: Date): Promise<BenchmarkReturn> {
    return this.fetchBenchmarkReturn(SP500_SYMBOL, SP500_NAME, startDate, endDate);
  }

  /**
   * Fetch return for any benchmark symbol.
   */
  async fetchBenchmarkReturn(
    symbol: string,
    name: string,
    startDate: Date,
    endDate: Date
  ): Promise<BenchmarkReturn> {
    return backOff(
      async () => {
        // Fetch historical data
        const historical = await yahooFinance.chart(symbol, {
          period1: startDate,
          period2: endDate,
          interval: '1d',
        }) as any;

        if (!historical?.quotes || historical.quotes.length < 2) {
          throw new Error(`Insufficient data for ${symbol}`);
        }

        const quotes = (historical.quotes as Array<{ close?: number | null }>).filter(
          (q: { close?: number | null }) => q.close !== null && q.close !== undefined
        );

        if (quotes.length < 2) {
          throw new Error(`Insufficient valid quotes for ${symbol}`);
        }

        const firstQuote = quotes[0];
        const lastQuote = quotes[quotes.length - 1];

        const startPrice = Math.round((firstQuote.close ?? 0) * 100);
        const endPrice = Math.round((lastQuote.close ?? 0) * 100);

        // Calculate total return
        const totalReturn = startPrice > 0 ? (endPrice - startPrice) / startPrice : 0;

        // Calculate annualized return
        const daysDiff = Math.max(1,
          (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        const yearsHeld = daysDiff / 365;
        const annualizedReturn = yearsHeld > 0
          ? Math.pow(1 + totalReturn, 1 / yearsHeld) - 1
          : totalReturn;

        return {
          symbol,
          name,
          startDate,
          endDate,
          startPrice,
          endPrice,
          totalReturn,
          annualizedReturn,
        };
      },
      {
        numOfAttempts: this.config.maxRetries,
        maxDelay: this.config.maxDelay,
        startingDelay: 1000,
        timeMultiple: 2,
        jitter: 'full',
      }
    );
  }

  /**
   * Get benchmark return with caching support.
   * Cache key is based on symbol and date range (rounded to day).
   */
  getCacheKey(symbol: string, startDate: Date, endDate: Date): string {
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];
    return `benchmark:${symbol}:${startStr}:${endStr}`;
  }
}
