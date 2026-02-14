// Core data types for the Ledgr application

export type AccountType = 'checking' | 'savings' | 'credit';
export type TransactionType = 'income' | 'expense';
export type ImportSource = 'file' | 'ofx';
export type RecurringFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
export type RecurringItemType = 'bill' | 'subscription' | 'cashflow';
export type PaymentStatus = 'pending' | 'paid' | 'overdue' | 'skipped';
export type ForecastGranularity = 'daily' | 'weekly' | 'monthly';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  institution: string;
  balance: number;
  lastSynced?: Date | null;
  createdAt: Date;
}

export interface Transaction {
  id: string;
  accountId: string;
  date: Date;
  description: string;
  amount: number;
  categoryId?: string | null;
  isRecurring: boolean;
  importSource: ImportSource;
  createdAt: Date;
  isInternalTransfer?: boolean; // Internal transfers are excluded from analytics
  notes?: string | null; // User notes for the transaction
  isHidden?: boolean; // Hidden transactions are excluded from reports/analytics
}

export interface Category {
  id: string;
  name: string;
  type: TransactionType;
  icon?: string;
  color?: string;
  isDefault: boolean;
  parentId?: string | null;
}

export interface CategoryRule {
  id: string;
  pattern: string;
  categoryId: string;
  priority: number;
  createdAt: Date;
}

export interface RecurringTransaction {
  id: string;
  accountId: string;
  description: string;
  amount: number;
  categoryId?: string | null;
  frequency: RecurringFrequency;
  startDate: Date;
  endDate?: Date | null;
  nextOccurrence: Date;
}

// Unified recurring item (merges Bill and RecurringTransaction)
export interface RecurringItem {
  id: string;
  description: string;
  amount: number; // Negative for expenses
  frequency: RecurringFrequency;
  startDate: Date;
  nextOccurrence: Date;
  accountId?: string | null;
  endDate?: Date | null;
  categoryId?: string | null;
  dayOfMonth?: number | null; // For monthly scheduling (1-31)
  dayOfWeek?: number | null; // For weekly scheduling (0-6)
  itemType: RecurringItemType; // 'bill' | 'subscription' | 'cashflow'
  enableReminders: boolean; // true = bill/subscription mode with payment tracking
  reminderDays?: number | null; // Days before due to remind
  autopay: boolean;
  isActive: boolean;
  createdAt: Date;
}

export interface RecurringPayment {
  id: string;
  recurringItemId: string;
  dueDate: Date;
  paidDate?: Date | null;
  amount: number;
  status: PaymentStatus;
  transactionId?: string | null;
  createdAt: Date;
}

// Budget Goal Types
export type BudgetPeriod = 'weekly' | 'monthly' | 'yearly';

export interface BudgetGoal {
  id: string;
  categoryId: string;
  amount: number;
  period: BudgetPeriod;
  rolloverEnabled: boolean;
  rolloverAmount: number;
  startDate: Date;
  createdAt: Date;
}

// Extended Forecast Types for 5-Year Support

export interface ExtendedForecastOptions {
  forecastDays: number; // 1-1825 (up to 5 years)
  granularity?: ForecastGranularity; // auto-selected if not provided
  includeCategoryTrends?: boolean; // default false
  selectedCategoryIds?: string[]; // specific categories to include in trends (all if empty/undefined)
  trendDampeningFactor?: number; // default 0.95
  historyMonths?: number; // months of history to analyze, default 12
}

export interface CategoryTrendProjection {
  date: Date;
  categoryId: string;
  categoryName?: string;
  projectedAmount: number;
  confidence: number;
  confidenceLower: number;
  confidenceUpper: number;
  source: 'trend';
  seasonalIndex?: number;
}

export interface EnhancedProjectedTransaction {
  date: Date;
  description: string;
  amount: number;
  categoryId: string | null;
  source: 'recurring' | 'trend';
  confidence?: number;
}

export interface EnhancedBalanceProjection {
  date: Date;
  balance: number;
  balanceLower: number;
  balanceUpper: number;
  confidence: number;
  recurringTotal: number;
  trendTotal: number;
  transactions: EnhancedProjectedTransaction[];
  categoryTrends?: CategoryTrendProjection[];
}

export interface EnhancedCashFlowForecast {
  accountId: string;
  startingBalance: number;
  forecastDays: number;
  granularity: ForecastGranularity;
  includedCategoryTrends: boolean;
  projections: EnhancedBalanceProjection[];
  warnings: Array<{
    type: 'negative_balance' | 'low_balance' | 'high_uncertainty';
    date: Date;
    balance: number;
    message: string;
  }>;
  summary: {
    endingBalance: number;
    endingBalanceLower: number;
    endingBalanceUpper: number;
    totalRecurringIncome: number;
    totalRecurringExpenses: number;
    totalTrendExpenses: number;
    averageConfidence: number;
    lowestBalance: number;
    lowestBalanceDate: Date | null;
  };
}

// Price Service Types (Phase 2 - v1.1)
export interface PriceResult {
  symbol: string;
  price: number;           // Price in cents (integer)
  change: number;          // Daily change in cents
  changePercent: number;   // Daily change percentage (e.g., 1.5 for +1.5%)
  timestamp: number;       // Unix timestamp when fetched
  currency: string;        // Currency code (USD, etc.)
}

export interface PriceCacheEntry {
  symbol: string;
  price: number;           // Price in cents
  change: number;          // Daily change in cents
  changePercent: number;   // Daily change percentage
  timestamp: number;       // When price was fetched/set
  manual: boolean;         // True if manually entered by user
  currency: string;
}

export interface PriceFetchProgress {
  completed: number;
  total: number;
  currentSymbol: string;
  errors: Array<{ symbol: string; error: string }>;
}

export type PriceFetchStatus = 'idle' | 'fetching' | 'success' | 'error' | 'offline';

// Brokerage Import Types (Phase 6 - v1.1)

export type BrokerageFormatName = 'fidelity' | 'schwab' | 'vanguard' | 'etrade' | 'generic';

export interface ParsedHolding {
  ticker: string;
  shares: number;         // Integer format (shares * 10000)
  costBasis: number;      // Total cost basis in cents
  costPerShare: number;   // Cost per share in cents
  rawRow: Record<string, string>;  // Original CSV values for reference
}

export interface ColumnMapping {
  ticker: string | null;
  shares: string | null;
  costBasis: string | null;
  costBasisType: 'total' | 'per_share';
}

export type ImportRowStatus = 'new' | 'duplicate' | 'error';

export interface ImportPreviewRow extends ParsedHolding {
  status: ImportRowStatus;
  errorMessage?: string;
  existingHoldingId?: string;
  selected: boolean;
}

export interface HoldingsParseResult {
  success: boolean;
  holdings: ParsedHolding[];
  detectedFormat: BrokerageFormatName | null;
  error?: string;
  warnings?: string[];
}

export interface ImportPreviewResult {
  success: boolean;
  detectedFormat: BrokerageFormatName | null;
  formatDisplayName: string;
  rows: ImportPreviewRow[];
  availableColumns: string[];  // For manual mapping
  suggestedMapping: ColumnMapping | null;
  stats: {
    total: number;
    new: number;
    duplicates: number;
    errors: number;
  };
  error?: string;
}

export interface ImportCommitResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: number;
  error?: string;
}

export type DuplicateAction = 'skip' | 'replace' | 'add';

// Performance Analytics Types (Phase 4 - v1.1)

export interface PositionGainLoss {
  holdingId: string;
  ticker: string;
  name: string;
  shares: number;
  costBasis: number;          // Total cost in cents
  currentValue: number;       // Current value in cents
  unrealizedGain: number;     // Unrealized gain/loss in cents
  unrealizedGainPercent: number;  // Percentage gain/loss
  dayChange: number;          // Today's change in cents
  dayChangePercent: number;   // Today's change percentage
}

export interface RealizedGain {
  transactionId: string;
  holdingId: string;
  ticker: string;
  sellDate: Date;
  shares: number;
  proceeds: number;           // Sale proceeds in cents
  costBasis: number;          // Cost basis of sold shares in cents
  gain: number;               // Realized gain in cents (proceeds - cost)
  gainPercent: number;        // Percentage gain
  holdingPeriodDays: number;  // Days held (for short/long term classification)
  isLongTerm: boolean;        // true if held > 365 days
}

export interface PortfolioPerformance {
  totalValue: number;         // Current total value in cents
  totalCostBasis: number;     // Total cost basis in cents
  unrealizedGain: number;     // Total unrealized gain in cents
  unrealizedGainPercent: number;
  realizedGainYTD: number;    // Realized gains this year in cents
  realizedGainTotal: number;  // All-time realized gains in cents
  dayChange: number;          // Today's change in cents
  dayChangePercent: number;
}

export interface ReturnMetrics {
  twr: number;                // Time-weighted return as decimal (0.05 = 5%)
  mwr: number;                // Money-weighted return as decimal
  periodDays: number;         // Number of days in calculation period
  startDate: Date;
  endDate: Date;
  startValue: number;         // Portfolio value at start (cents)
  endValue: number;           // Portfolio value at end (cents)
  netCashFlow: number;        // Net contributions/withdrawals (cents)
}

export interface PerformanceMetrics {
  portfolio: PortfolioPerformance;
  positions: PositionGainLoss[];
  realizedGains: RealizedGain[];
  returns: ReturnMetrics;
  benchmarkReturn?: number;   // S&P 500 return for comparison (decimal)
  vsBenchmark?: number;       // Difference from benchmark (decimal)
  calculatedAt: Date;
}

export type PerformancePeriod = '1D' | '1W' | '1M' | '3M' | 'YTD' | '1Y' | 'ALL' | 'CUSTOM';

export interface PerformanceOptions {
  period: PerformancePeriod;
  customStartDate?: Date;     // Only used when period is 'CUSTOM'
  customEndDate?: Date;       // Only used when period is 'CUSTOM'
  includeBenchmark?: boolean; // Whether to fetch and compare to S&P 500
}

// Cash flow for TWR/MWR calculations
export interface CashFlowEvent {
  date: Date;
  amount: number;             // Positive = contribution, negative = withdrawal (cents)
  type: 'contribution' | 'withdrawal' | 'dividend';
}

// Net Worth Integration Types (Phase 5 - v1.1)

export interface NetWorthComponent {
  id: string;
  name: string;
  value: number;              // Value in cents
  category?: string;
  type: 'bank' | 'investment' | 'manual_asset' | 'manual_liability';
}

export interface NetWorthCalculation {
  date: Date;
  // Component totals
  bankAccountsTotal: number;
  investmentAccountsTotal: number;
  manualAssetsTotal: number;
  totalAssets: number;
  manualLiabilitiesTotal: number;
  totalLiabilities: number;
  netWorth: number;
  // Detailed breakdowns
  bankAccounts: NetWorthComponent[];
  investmentAccounts: NetWorthComponent[];
  manualAssets: NetWorthComponent[];
  liabilities: NetWorthComponent[];
  // Change tracking
  changeFromPrevious?: number | null;
  changePercentFromPrevious?: number | null;
}

export interface NetWorthChangeSummary {
  period: {
    startDate: Date;
    endDate: Date;
    days: number;
  };
  startNetWorth: number;
  endNetWorth: number;
  change: number;
  changePercent: number;
  // Component changes
  assetsChange: number;
  liabilitiesChange: number;
  // Category-level changes
  categoryChanges: Array<{
    category: string;
    type: 'asset' | 'liability';
    change: number;
    changePercent: number;
  }>;
}

export interface NetWorthProjectionConfig {
  months: number;             // How many months to project forward
  // Trend-based projection settings
  useTrendAnalysis?: boolean; // Default: true
  trendMonths?: number;       // Months of history to analyze (default: 12)
  // Manual projection settings
  monthlyAssetGrowth?: number;      // Expected monthly asset growth in cents
  monthlyLiabilityReduction?: number; // Expected monthly liability reduction in cents
  // Confidence settings
  confidenceLevel?: number;   // 0.90 = 90% confidence interval
}

export interface NetWorthForecastPoint {
  date: Date;
  projected: number;          // Projected net worth in cents
  lowerBound: number;         // Lower confidence bound
  upperBound: number;         // Upper confidence bound
  assets: number;             // Projected assets
  liabilities: number;        // Projected liabilities
}

export interface NetWorthForecast {
  config: NetWorthProjectionConfig;
  currentNetWorth: number;
  projections: NetWorthForecastPoint[];
  // Trend analysis (when useTrendAnalysis = true)
  historicalGrowthRate?: number;    // Monthly growth rate as decimal
  confidence?: number;              // Confidence score 0-100
  // Milestones
  milestones: Array<{
    amount: number;
    label: string;
    projectedDate: Date | null;
    achieved: boolean;
  }>;
}

export interface LoanPayoffCalculation {
  liabilityId: string;
  liabilityName: string;
  currentBalance: number;     // Current balance in cents
  interestRate: number;       // Annual rate as decimal
  monthlyPayment: number;     // Monthly payment in cents
  // Payoff details
  monthsRemaining: number;
  payoffDate: Date;
  totalInterestRemaining: number;  // Total interest to be paid
  totalAmountToBePaid: number;     // Total principal + interest
  // Amortization schedule (monthly)
  schedule: Array<{
    month: number;
    date: Date;
    payment: number;
    principal: number;
    interest: number;
    remainingBalance: number;
  }>;
}

export interface LoanExtraPaymentImpact {
  extraMonthlyPayment: number;     // Additional payment in cents
  newMonthsRemaining: number;
  newPayoffDate: Date;
  monthsSaved: number;
  interestSaved: number;           // Interest saved in cents
  totalSavings: number;            // Total savings in cents
}

// Transaction Reimbursement Types
export interface TransactionReimbursement {
  id: string;
  expenseTransactionId: string;
  reimbursementTransactionId: string;
  amount: number; // cents
  createdAt: Date;
}

export type ReimbursementStatus = 'none' | 'partial' | 'full';

export interface ReimbursementSummary {
  status: ReimbursementStatus;
  originalAmount: number;   // cents, absolute value
  totalReimbursed: number;  // cents
  netAmount: number;        // cents, absolute value
  links: TransactionReimbursement[];
}
