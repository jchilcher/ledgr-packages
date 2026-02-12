// Core data types for the Ledgr application

export type AccountType = 'checking' | 'savings' | 'credit';
export type TransactionType = 'income' | 'expense';
export type ImportSource = 'file' | 'ofx';
export type RecurringFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
export type RecurringItemType = 'bill' | 'subscription' | 'cashflow';
export type PaymentStatus = 'pending' | 'paid' | 'overdue' | 'skipped';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  institution: string;
  balance: number;
  lastSynced?: Date | null;
  createdAt: Date;
  // OFX Direct Connect fields
  ofxUrl?: string | null;
  ofxOrg?: string | null;
  ofxFid?: string | null;
  ofxUsername?: string | null;
  ofxAccountId?: string | null;
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
  fitId?: string | null; // Financial Institution Transaction ID for dedup
  isInternalTransfer?: boolean; // Internal transfers are excluded from analytics
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

// Phase 1: Tags
export interface Tag {
  id: string;
  name: string;
  color?: string | null;
  createdAt: Date;
}

export interface TransactionTag {
  transactionId: string;
  tagId: string;
}

// Phase 1: Split Transactions
export interface TransactionSplit {
  id: string;
  parentTransactionId: string;
  categoryId?: string | null;
  amount: number;
  description?: string | null;
  createdAt: Date;
}

// Phase 2: Budget Goals
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

// Phase 2: Spending Alerts
export interface SpendingAlert {
  id: string;
  categoryId: string;
  threshold: number;
  period: BudgetPeriod;
  isActive: boolean;
  lastTriggered?: Date | null;
  createdAt: Date;
}

// Phase 3: Bills
export type BillFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
export type BillPaymentStatus = 'pending' | 'paid' | 'overdue' | 'skipped';

export interface Bill {
  id: string;
  name: string;
  amount: number;
  dueDay: number; // Day of month (1-31)
  frequency: BillFrequency;
  categoryId?: string | null;
  autopay: boolean;
  reminderDays: number;
  isActive: boolean;
  createdAt: Date;
}

export interface BillPayment {
  id: string;
  billId: string;
  dueDate: Date;
  paidDate?: Date | null;
  amount: number;
  status: BillPaymentStatus;
  transactionId?: string | null;
  createdAt: Date;
}

// Phase 3: Smart Categorization
export interface CategoryCorrection {
  id: string;
  originalDescription: string;
  correctedCategoryId: string;
  pattern?: string | null;
  confidence: number;
  usageCount: number;
  createdAt: Date;
}

// Phase 4: Net Worth (Legacy types - kept for migration)
export type LegacyAssetType = 'cash' | 'investment' | 'property' | 'vehicle' | 'other';
export type LegacyLiabilityType = 'mortgage' | 'auto_loan' | 'student_loan' | 'credit_card' | 'personal_loan' | 'other';

// Type aliases for backward compatibility
export type AssetType = LegacyAssetType;
export type LiabilityType = LegacyLiabilityType;

export interface Asset {
  id: string;
  name: string;
  type: LegacyAssetType;
  value: number;
  lastUpdated: Date;
  notes?: string | null;
  createdAt: Date;
}

export interface Liability {
  id: string;
  name: string;
  type: LegacyLiabilityType;
  balance: number;
  interestRate?: number | null;
  minimumPayment?: number | null;
  lastUpdated: Date;
  createdAt: Date;
}

export interface NetWorthHistory {
  id: string;
  date: Date;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  breakdown?: string | null; // JSON breakdown by type
  createdAt: Date;
}

// ==================== Phase 5: Net Worth Integration ====================

// Manual Asset Categories (preset + custom)
export type ManualAssetCategory = 'property' | 'vehicle' | 'valuables' | 'other' | 'custom';
export type AssetLiquidity = 'liquid' | 'illiquid';

export interface ManualAsset {
  id: string;
  name: string;
  category: ManualAssetCategory;
  customCategory?: string | null;  // When category is 'custom'
  value: number;                   // Value in cents
  liquidity: AssetLiquidity;
  notes?: string | null;
  // Reminder configuration
  reminderFrequency?: 'monthly' | 'quarterly' | 'yearly' | null;
  lastReminderDate?: Date | null;
  nextReminderDate?: Date | null;
  // Tracking
  lastUpdated: Date;
  createdAt: Date;
}

// Liability with full amortization details for payoff projections
export type ManualLiabilityType = 'mortgage' | 'auto_loan' | 'student_loan' | 'personal_loan' | 'credit_card' | 'other';

export interface ManualLiability {
  id: string;
  name: string;
  type: ManualLiabilityType;
  balance: number;                 // Current balance in cents
  // Amortization details
  interestRate: number;            // Annual rate as decimal (e.g., 0.065 for 6.5%)
  monthlyPayment: number;          // Monthly payment in cents
  originalAmount?: number | null;  // Original loan amount in cents
  startDate?: Date | null;         // Loan start date
  termMonths?: number | null;      // Original term in months
  // Computed fields (stored for efficiency)
  payoffDate?: Date | null;        // Projected payoff date
  totalInterest?: number | null;   // Total interest over remaining life
  // Tracking
  lastUpdated: Date;
  notes?: string | null;
  createdAt: Date;
}

// Net worth snapshot for historical tracking
export interface NetWorthSnapshot {
  id: string;
  date: Date;
  // Component values (all in cents)
  bankAccountsTotal: number;
  investmentAccountsTotal: number;
  manualAssetsTotal: number;
  totalAssets: number;
  manualLiabilitiesTotal: number;
  totalLiabilities: number;
  netWorth: number;
  // Breakdown by category (JSON serialized)
  assetBreakdown: string;          // { bankAccounts: [...], investments: [...], manualAssets: [...] }
  liabilityBreakdown: string;      // { liabilities: [...] }
  // Change tracking
  changeFromPrevious?: number | null;  // Change in cents from previous snapshot
  changePercentFromPrevious?: number | null;
  createdAt: Date;
}

// Asset value history for tracking manual asset changes over time
export interface AssetValueHistory {
  id: string;
  assetId: string;
  value: number;                   // Value in cents
  date: Date;
  source: 'manual' | 'reminder';   // How was this update created
  createdAt: Date;
}

// Liability value history for tracking payments over time
export interface LiabilityValueHistory {
  id: string;
  liabilityId: string;
  balance: number;                 // Balance in cents
  date: Date;
  paymentAmount?: number | null;   // Payment made in cents
  createdAt: Date;
}

// Phase 4: Savings Goals
export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate?: Date | null;
  accountId?: string | null;
  icon?: string | null;
  color?: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface SavingsContribution {
  id: string;
  goalId: string;
  amount: number;
  transactionId?: string | null;
  date: Date;
  createdAt: Date;
}

// Savings Goal Alerts & Reporting
export interface SavingsGoalAlert {
  goalId: string;
  goalName: string;
  type: 'milestone' | 'deadline_warning' | 'completed' | 'at_risk';
  message: string;
  color: string | null;
  progress: number;
  severity: 'info' | 'warning' | 'success';
}

export interface SavingsGrowthPoint {
  date: string;
  cumulativeAmount: number;
}

export interface SavingsMonthlyContribution {
  month: string;
  total: number;
  count: number;
}

// Phase 5: Investments
export type InvestmentType = 'stock' | 'etf' | 'mutual_fund' | 'bond' | 'crypto' | 'other';

export interface Investment {
  id: string;
  accountId?: string | null;
  name: string;
  ticker?: string | null;
  type: InvestmentType;
  shares: number;
  costBasis: number;
  currentPrice: number;
  lastUpdated: Date;
  createdAt: Date;
}

export interface InvestmentHistory {
  id: string;
  investmentId: string;
  date: Date;
  price: number;
  shares: number;
  value: number;
}

// Investment Account Types (Phase 1 v1.1)
export type InvestmentAccountType = 'taxable' | 'traditional_ira' | 'roth_ira' | '401k' | 'hsa';

export interface InvestmentAccount {
  id: string;
  name: string;
  institution: string;
  accountType: InvestmentAccountType;
  createdAt: Date;
}

export interface Holding {
  id: string;
  accountId: string;
  ticker: string;
  name: string;
  sharesOwned: number;      // Total shares (sum of lots)
  avgCostPerShare: number;  // Weighted average cost basis (cents)
  currentPrice: number;     // Manual price until Phase 2 (cents)
  sector?: string | null;
  lastPriceUpdate: Date;
  createdAt: Date;
}

export interface CostBasisLot {
  id: string;
  holdingId: string;
  purchaseDate: Date;
  shares: number;           // Original shares purchased (x10000 for precision)
  costPerShare: number;     // Cost per share at purchase (cents)
  remainingShares: number;  // Shares not yet sold (x10000 for precision)
  createdAt: Date;
}

// Phase 6: Receipts
export interface Receipt {
  id: string;
  transactionId?: string | null;
  filePath: string;
  thumbnailPath?: string | null;
  extractedData?: string | null; // JSON from OCR
  uploadedAt: Date;
  processedAt?: Date | null;
}

// Investment Transaction Types (Phase 3 v1.1)
export type InvestmentTransactionType = 'buy' | 'sell' | 'dividend' | 'stock_split' | 'drip';

export interface InvestmentTransaction {
  id: string;
  holdingId: string;        // References the holding (investment) this transaction affects
  type: InvestmentTransactionType;
  date: Date;
  shares: number;           // Number of shares (x10000 for precision, negative for sells)
  pricePerShare: number;    // Price per share in cents (for buy/sell/drip)
  totalAmount: number;      // Total transaction amount in cents (price * shares + fees for buy, price * shares - fees for sell)
  fees: number;             // Transaction fees in cents
  splitRatio?: string | null;  // For stock splits: "2:1" means 2 new shares for each 1 old share
  notes?: string | null;
  lotId?: string | null;    // Reference to cost basis lot created/affected
  createdAt: Date;
}

// User setting for concentration warning threshold
export interface InvestmentSettings {
  id: string;
  concentrationThreshold: number;  // Percentage (e.g., 25 for 25%)
  defaultSectorAllocation: string; // JSON mapping of sectors
  createdAt: Date;
  updatedAt: Date;
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
