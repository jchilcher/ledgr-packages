export interface UserRow {
  id: string;
  name: string;
  color: string;
  isDefault: number;
  createdAt: number;
}

export interface AccountRow {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'credit';
  institution: string;
  balance: number;
  lastSynced: number | null;
  createdAt: number;
  // OFX Direct Connect fields
  ofxUrl: string | null;
  ofxOrg: string | null;
  ofxFid: string | null;
  ofxUsername: string | null;
  ofxAccountId: string | null;
  // Household ownership
  ownership: string | null;
  ownerId: string | null;
  isEncrypted: number | null;
}

export interface TransactionRow {
  id: string;
  accountId: string;
  date: number;
  description: string;
  amount: number;
  categoryId: string | null;
  isRecurring: number;
  importSource: 'file' | 'ofx';
  createdAt: number;
  fitId: string | null; // Financial Institution Transaction ID for dedup
  isInternalTransfer: number; // 0 = false, 1 = true
  notes: string | null;
  isHidden: number; // 0 = false, 1 = true
}

export interface CategoryRow {
  id: string;
  name: string;
  type: 'income' | 'expense';
  icon: string | null;
  color: string | null;
  isDefault: number;
  parentId: string | null;
}

export interface CategoryRuleRow {
  id: string;
  pattern: string;
  categoryId: string;
  priority: number;
  createdAt: number;
  // Enhanced automation conditions
  amountMin: number | null;
  amountMax: number | null;
  accountFilter: string | null;    // JSON array of account IDs
  directionFilter: string | null;  // 'income' | 'expense' | null
}

export interface AutomationRuleActionRow {
  id: string;
  ruleId: string;
  actionType: string;
  actionValue: string | null;
  createdAt: number;
}

export interface PaycheckAllocationRow {
  id: string;
  incomeStreamId: string;
  incomeDescription: string;
  allocationType: string;
  targetId: string;
  amount: number;
  createdAt: number;
}

export interface TagRow {
  id: string;
  name: string;
  color: string | null;
  createdAt: number;
}

export interface TransactionSplitRow {
  id: string;
  parentTransactionId: string;
  categoryId: string | null;
  amount: number;
  description: string | null;
  createdAt: number;
}

export interface BudgetGoalRow {
  id: string;
  categoryId: string;
  amount: number;
  period: string;
  rolloverEnabled: number;
  rolloverAmount: number;
  startDate: number;
  createdAt: number;
}

export interface SpendingAlertRow {
  id: string;
  categoryId: string;
  threshold: number;
  period: string;
  isActive: number;
  lastTriggered: number | null;
  createdAt: number;
}

export interface BillRow {
  id: string;
  name: string;
  amount: number;
  dueDay: number;
  frequency: string;
  categoryId: string | null;
  autopay: number;
  reminderDays: number;
  isActive: number;
  createdAt: number;
}

export interface BillPaymentRow {
  id: string;
  billId: string;
  dueDate: number;
  paidDate: number | null;
  amount: number;
  status: string;
  transactionId: string | null;
  createdAt: number;
}

export interface CategoryCorrectionRow {
  id: string;
  originalDescription: string;
  correctedCategoryId: string;
  pattern: string | null;
  confidence: number;
  usageCount: number;
  createdAt: number;
}

export interface AssetRow {
  id: string;
  name: string;
  type: string;
  value: number;
  lastUpdated: number;
  notes: string | null;
  createdAt: number;
}

export interface LiabilityRow {
  id: string;
  name: string;
  type: string;
  balance: number;
  interestRate: number | null;
  minimumPayment: number | null;
  lastUpdated: number;
  createdAt: number;
}

export interface NetWorthHistoryRow {
  id: string;
  date: number;
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  breakdown: string | null;
  createdAt: number;
}

export interface SavingsGoalRow {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: number | null;
  accountId: string | null;
  icon: string | null;
  color: string | null;
  isActive: number;
  ownerId: string | null;
  isEncrypted: number | null;
  createdAt: number;
}

export interface SavingsContributionRow {
  id: string;
  goalId: string;
  amount: number;
  transactionId: string | null;
  date: number;
  createdAt: number;
}

export interface InvestmentRow {
  id: string;
  accountId: string | null;
  name: string;
  ticker: string | null;
  type: string;
  shares: number;
  costBasis: number;
  currentPrice: number;
  lastUpdated: number;
  createdAt: number;
}

export interface InvestmentHistoryRow {
  id: string;
  investmentId: string;
  date: number;
  price: number;
  shares: number;
  value: number;
}

export interface ReceiptRow {
  id: string;
  transactionId: string | null;
  filePath: string;
  thumbnailPath: string | null;
  extractedData: string | null;
  uploadedAt: number;
  processedAt: number | null;
}

export interface InvestmentAccountRow {
  id: string;
  name: string;
  institution: string;
  account_type: string;
  owner_id: string | null;
  is_encrypted: number | null;
  created_at: number;
}

export interface HoldingRow {
  id: string;
  account_id: string;
  ticker: string;
  name: string;
  shares_owned: number;
  avg_cost_per_share: number;
  current_price: number;
  sector: string | null;
  last_price_update: number;
  created_at: number;
}

export interface CostBasisLotRow {
  id: string;
  holding_id: string;
  purchase_date: number;
  shares: number;
  cost_per_share: number;
  remaining_shares: number;
  created_at: number;
}

export interface InvestmentTransactionRow {
  id: string;
  holding_id: string;
  type: string;
  date: number;
  shares: number;
  price_per_share: number;
  total_amount: number;
  fees: number;
  split_ratio: string | null;
  notes: string | null;
  lot_id: string | null;
  created_at: number;
}

export interface InvestmentSettingsRow {
  id: string;
  concentration_threshold: number;
  default_sector_allocation: string;
  created_at: number;
  updated_at: number;
}

export interface RecurringItemRow {
  id: string;
  description: string;
  amount: number;
  frequency: string;
  startDate: number;
  nextOccurrence: number;
  accountId: string | null;
  endDate: number | null;
  categoryId: string | null;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  itemType: string;
  enableReminders: number;
  reminderDays: number | null;
  autopay: number;
  isActive: number;
  ownerId: string | null;
  isEncrypted: number | null;
  createdAt: number;
}

export interface RecurringPaymentRow {
  id: string;
  recurringItemId: string;
  dueDate: number;
  paidDate: number | null;
  amount: number;
  status: string;
  transactionId: string | null;
  createdAt: number;
}

export interface ManualAssetRow {
  id: string;
  name: string;
  category: string;
  custom_category: string | null;
  value: number;
  liquidity: string;
  notes: string | null;
  reminder_frequency: string | null;
  last_reminder_date: number | null;
  next_reminder_date: number | null;
  owner_id: string | null;
  is_encrypted: number | null;
  last_updated: number;
  created_at: number;
}

export interface ManualLiabilityRow {
  id: string;
  name: string;
  type: string;
  balance: number;
  interest_rate: number;
  monthly_payment: number;
  original_amount: number | null;
  start_date: number | null;
  term_months: number | null;
  payoff_date: number | null;
  total_interest: number | null;
  last_updated: number;
  notes: string | null;
  owner_id: string | null;
  is_encrypted: number | null;
  created_at: number;
}

export interface NetWorthSnapshotRow {
  id: string;
  date: number;
  bank_accounts_total: number;
  investment_accounts_total: number;
  manual_assets_total: number;
  total_assets: number;
  manual_liabilities_total: number;
  total_liabilities: number;
  net_worth: number;
  asset_breakdown: string;
  liability_breakdown: string;
  change_from_previous: number | null;
  change_percent_from_previous: number | null;
  created_at: number;
}

export interface AssetValueHistoryRow {
  id: string;
  asset_id: string;
  value: number;
  date: number;
  source: string;
  created_at: number;
}

export interface LiabilityValueHistoryRow {
  id: string;
  liability_id: string;
  balance: number;
  date: number;
  payment_amount: number | null;
  created_at: number;
}

export interface SavedReportRow {
  id: string;
  name: string;
  config: string;
  createdAt: number;
  lastAccessedAt: number;
}

export interface TransactionAttachmentRow {
  id: string;
  transactionId: string;
  filename: string;
  filePath: string;
  mimeType: string;
  fileSize: number;
  createdAt: number;
}

export interface UserKeyRow {
  userId: string;
  publicKey: string;
  encryptedPrivateKey: string;
  privateKeyIv: string;
  privateKeyTag: string;
  encryptionSalt: string;
  createdAt: number;
}

export interface DataEncryptionKeyRow {
  id: string;
  entityType: string;
  ownerId: string;
  wrappedDek: string;
  dekIv: string;
  dekTag: string;
  createdAt: number;
}

export interface DataShareRow {
  id: string;
  entityId: string;
  entityType: string;
  ownerId: string;
  recipientId: string;
  wrappedDek: string;
  permissions: string;
  createdAt: number;
}

export interface SharingDefaultRow {
  id: string;
  ownerId: string;
  recipientId: string;
  entityType: string;
  permissions: string;
  createdAt: number;
}
