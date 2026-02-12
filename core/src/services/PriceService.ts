import YahooFinance from 'yahoo-finance2';
import { backOff } from 'exponential-backoff';
import { PriceResult, PriceFetchProgress } from '../types';

const yahooFinance = new YahooFinance();

/**
 * PriceService - Fetches stock/ETF prices from Yahoo Finance with retry logic
 *
 * Features:
 * - Batch fetching with progress callbacks
 * - Exponential backoff retry with jitter for rate limit handling
 * - Symbol validation
 * - Price conversion to cents (integer storage)
 *
 * Note: This service should only be used in the main process (Electron) to avoid CORS issues.
 */
export class PriceService {
  private static readonly MAX_RETRIES = 3;
  private static readonly INITIAL_DELAY_MS = 1000;
  private static readonly MAX_DELAY_MS = 10000;
  private static readonly JITTER_FACTOR = 0.3;

  /**
   * Validates a ticker symbol format
   */
  private static validateSymbol(symbol: string): boolean {
    // Basic validation: 1-5 alphanumeric characters, optionally followed by dot and 1-3 chars
    // Examples: AAPL, BRK.B, GOOGL, VOO
    const symbolPattern = /^[A-Z0-9]{1,5}(\.[A-Z]{1,3})?$/i;
    return symbolPattern.test(symbol.trim());
  }

  /**
   * Converts dollar amount to cents (integer) with rounding
   */
  private static toCents(dollars: number): number {
    return Math.round(dollars * 100);
  }

  /**
   * Fetches price for a single ticker symbol with retry logic
   *
   * @param symbol Ticker symbol (e.g., "AAPL", "VOO")
   * @returns PriceResult with price in cents
   * @throws Error if symbol is invalid or fetch fails after retries
   */
  async fetchPrice(symbol: string): Promise<PriceResult> {
    const cleanSymbol = symbol.trim().toUpperCase();

    if (!PriceService.validateSymbol(cleanSymbol)) {
      throw new Error(`Invalid ticker symbol: ${symbol}`);
    }

    try {
      const quote = await backOff(
        async () => {
          const result = await yahooFinance.quote(cleanSymbol) as any;

          if (!result || result.regularMarketPrice === undefined) {
            throw new Error(`No price data available for ${cleanSymbol}`);
          }

          return result;
        },
        {
          numOfAttempts: PriceService.MAX_RETRIES,
          startingDelay: PriceService.INITIAL_DELAY_MS,
          maxDelay: PriceService.MAX_DELAY_MS,
          jitter: 'full',
          retry: (error: any, attemptNumber: number) => {
            // Retry on network errors, rate limiting (429), and server errors (5xx)
            const statusCode = error?.response?.status || error?.statusCode;
            const shouldRetry =
              !statusCode || // Network error
              statusCode === 429 || // Rate limited
              (statusCode >= 500 && statusCode < 600); // Server error

            if (shouldRetry && attemptNumber < PriceService.MAX_RETRIES) {
              console.log(`Retry ${attemptNumber}/${PriceService.MAX_RETRIES} for ${cleanSymbol}: ${error.message}`);
              return true;
            }

            return false;
          }
        }
      );

      const price = (quote.regularMarketPrice || 0) as number;
      const change = (quote.regularMarketChange || 0) as number;
      const changePercent = (quote.regularMarketChangePercent || 0) as number;
      const currency = (quote.currency || 'USD') as string;

      return {
        symbol: cleanSymbol,
        price: PriceService.toCents(price),
        change: PriceService.toCents(change),
        changePercent: changePercent,
        timestamp: Date.now(),
        currency: currency
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch price for ${cleanSymbol}: ${message}`);
    }
  }

  /**
   * Fetches prices for multiple symbols with progress updates
   *
   * @param symbols Array of ticker symbols
   * @param onProgress Optional callback for progress updates
   * @returns Array of PriceResults (same order as input symbols)
   *
   * Note: Continues fetching even if some symbols fail. Check progress.errors for failures.
   */
  async fetchPrices(
    symbols: string[],
    onProgress?: (progress: PriceFetchProgress) => void
  ): Promise<PriceResult[]> {
    const results: PriceResult[] = [];
    const errors: Array<{ symbol: string; error: string }> = [];
    let completed = 0;

    for (const symbol of symbols) {
      const cleanSymbol = symbol.trim().toUpperCase();

      try {
        const result = await this.fetchPrice(cleanSymbol);
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ symbol: cleanSymbol, error: message });

        // Still add a placeholder result with zero values to maintain array alignment
        results.push({
          symbol: cleanSymbol,
          price: 0,
          change: 0,
          changePercent: 0,
          timestamp: Date.now(),
          currency: 'USD'
        });
      }

      completed++;

      if (onProgress) {
        onProgress({
          completed,
          total: symbols.length,
          currentSymbol: cleanSymbol,
          errors
        });
      }

      // Small delay between requests to avoid rate limiting
      if (completed < symbols.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return results;
  }

  /**
   * Tests connectivity to Yahoo Finance API
   *
   * @returns true if API is reachable, false otherwise
   */
  async testConnection(): Promise<boolean> {
    try {
      // Test with a well-known symbol
      await this.fetchPrice('AAPL');
      return true;
    } catch (error) {
      console.error('Yahoo Finance connection test failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export const priceService = new PriceService();
