// Types
export * from './types';

// Utilities
export { excludeTransfers } from './utils';

// Engines
export {
  // Forecast Engine
  DataPoint,
  LinearRegressionResult,
  SpendingForecast,
  CategorySpendingForecast,
  calculateLinearRegression,
  forecastSpending,
  generateMultiPeriodForecasts,
  forecastCategorySpending,
  forecastAllCategories,
  ForecastEngine,
} from './engines/forecast-engine';

export {
  // CashFlow Engine
  ProjectedTransaction,
  CashFlowWarning,
  BalanceProjection,
  CashFlowForecast,
  calculateNextOccurrence,
  projectRecurringTransactions,
  forecastCashFlow,
  CashFlowEngine,
  // Enhanced CashFlow
  EnhancedCashFlowDependencies,
  projectRecurringItems,
  mergeRecurringAndTrends,
  forecastCashFlowEnhanced,
  EnhancedCashFlowEngine,
} from './engines/cashflow-engine';

export {
  // Enhanced Forecast Engine (Long-term with seasonal + trend)
  LongTermCategoryForecast,
  EnhancedForecastDependencies,
  calculateTrendDampening,
  calculateConfidenceDecay,
  getAnnualSeasonalIndices,
  calculateRecurringCategoryAmount,
  forecastCategorySpendingLongTerm,
  selectGranularity,
  forecastAllCategoriesLongTerm,
  EnhancedForecastEngine,
} from './engines/enhanced-forecast-engine';

export {
  // Categorization Engine
  matchesPattern,
  categorize,
  extractPattern,
  getDefaultRules,
  CategorizationEngine,
} from './engines/categorization-engine';

export {
  // Anomaly Detection Engine
  AnomalyType,
  AnomalySeverity,
  Anomaly,
  AnomalyDetectionResult,
  detectUnusualAmounts,
  detectMissingRecurring,
  detectDuplicateCharges,
  detectAnomalies,
  AnomalyDetectionEngine,
} from './engines/anomaly-detection-engine';

export {
  // Seasonal Analysis Engine
  SeasonalPattern,
  HolidaySpike,
  SeasonalAnalysisResult,
  calculateSeasonalPatterns,
  calculateCategoryAverages,
  buildSeasonalIndices,
  detectHolidaySpikes,
  getMonthName,
  predictMonthlySpending,
  analyzeSeasonalPatterns,
  SeasonalAnalysisEngine,
} from './engines/seasonal-analysis-engine';

export {
  // Income Analysis Engine
  IncomeFrequency,
  IncomeStream,
  IncomeAnalysisSummary,
  IncomeAnalysisResult,
  identifyIncomeStreams,
  analyzeIncome,
  calculateSmoothedIncome,
  IncomeAnalysisEngine,
} from './engines/income-analysis-engine';

export {
  // Spending Velocity Engine
  VelocityStatus,
  SpendingVelocity,
  SpendingVelocityReport,
  calculateCategoryVelocity,
  calculateSpendingVelocity,
  SpendingVelocityEngine,
} from './engines/spending-velocity-engine';

export {
  // Safe to Spend Engine
  SafeToSpendInput,
  SafeToSpendResult,
  SafeToSpendBreakdownBill,
  SafeToSpendBreakdownSavings,
  SafeToSpendBreakdownBudget,
  calculateSafeToSpend,
  SafeToSpendEngine,
} from './engines/safe-to-spend-engine';

export {
  // Comparison Engine
  SpendingComparison,
  ComparisonPeriod,
  ComparisonReport,
  generateComparisonReport,
  getBudgetAdherenceHistory,
  ComparisonEngine,
} from './engines/comparison-engine';

export {
  // Subscription Audit Engine
  Subscription,
  SubscriptionAuditReport,
  auditSubscriptions,
  SubscriptionAuditEngine,
} from './engines/subscription-audit-engine';

export {
  // Financial Health Engine
  FinancialHealthFactor,
  FinancialHealthScore,
  calculateFinancialHealth,
  FinancialHealthEngine,
} from './engines/financial-health-engine';

export {
  // Savings Projection Engine
  SavingsGoalData,
  SavingsContributionData,
  ScenarioType,
  SavingsScenario,
  SavingsProjection,
  SavingsProjectionReport,
  SavingsProjectionDependencies,
  projectSavingsGoal,
  generateSavingsProjections,
  SavingsProjectionEngine,
} from './engines/savings-projection-engine';

export {
  // Debt Payoff Engine
  DebtData,
  PayoffStrategy,
  MonthlyPayment,
  DebtPayoffPlan,
  PayoffStrategyResult,
  ExtraPaymentImpact,
  DebtPayoffReport,
  DebtPayoffDependencies,
  calculateMinimumPaymentSchedule,
  calculateStrategyPayoff,
  calculateExtraPaymentImpact,
  generateDebtPayoffReport,
  DebtPayoffEngine,
} from './engines/debt-payoff-engine';

export {
  // Net Worth Projection Engine
  NetWorthHistoryData,
  NetWorthMilestone,
  NetWorthProjectionPoint,
  NetWorthTrend,
  NetWorthProjection,
  NetWorthProjectionDependencies,
  analyzeNetWorthTrend,
  projectNetWorth,
  calculateMilestones,
  generateNetWorthProjection,
  NetWorthProjectionEngine,
} from './engines/net-worth-projection-engine';

export {
  // Category Migration Engine
  CategoryProportion,
  PeriodCategoryBreakdown,
  CategoryShift,
  CategoryTrend,
  CategoryMigrationReport,
  CategoryMigrationDependencies,
  buildPeriodBreakdowns,
  detectCategoryShifts,
  calculateCategoryTrends,
  analyzeCategoryMigration,
  CategoryMigrationEngine,
} from './engines/category-migration-engine';

export {
  // Cash Flow Optimization Engine
  CashFlowProjectionPoint,
  LowBalanceWindow,
  BillCluster,
  DueDateRecommendation,
  TransferRecommendation,
  CashFlowOptimizationReport,
  CashFlowOptimizationDependencies,
  projectCashFlow,
  identifyLowBalanceWindows,
  analyzeBillClusters,
  generateDueDateRecommendations,
  generateTransferRecommendations,
  optimizeCashFlow,
  CashFlowOptimizationEngine,
} from './engines/cashflow-optimization-engine';

export {
  // Age of Money Engine
  AgeOfMoneyInput,
  AgeOfMoneyResult,
  calculateAgeOfMoney,
  AgeOfMoneyEngine,
} from './engines/age-of-money-engine';

export {
  // Tax Lot Report Engine
  TaxLotReportInput,
  TaxLotReportEntry,
  TaxLotGainGroup,
  WashSaleFlag,
  TaxLotReport,
  generateTaxLotReport,
  TaxLotReportEngine,
} from './engines/tax-lot-report-engine';

// Parsers
export {
  ParsedTransaction,
  ParseResult,
  parseCSVContent,
  parseDate,
  parseAmount,
  parseCSVLine,
  detectDelimiter,
  // Transaction import enhancements
  TransactionColumnMapping,
  TransactionAmountType,
  CSVColumnInfo,
  CSVRawData,
  suggestTransactionMapping,
  getCSVColumnInfo,
  getCSVRawRows,
  parseCSVWithMapping,
  getAvailableTransactionFormats,
  getTransactionFormatDisplayName,
  findHeaderRow,
} from './parsers/csv-parser';

export {
  parseOFXContent,
  parseOFXDate,
} from './parsers/ofx-parser';

export {
  // Budget Suggestion Engine
  SuggestionType,
  SuggestionReason,
  BudgetSuggestion,
  BudgetSuggestionOptions,
  BudgetSuggestionDependencies,
  suggestNewBudget,
  suggestBudgetAdjustment,
  generateAllSuggestions,
  BudgetSuggestionEngine,
} from './engines/budget-suggestion-engine';

export {
  // Recovery Plan Engine
  QuickWinType,
  QuickWinUrgency,
  EmergencyLevel,
  QuickWin,
  ScenarioModification,
  ScenarioResult,
  EmergencyStatus,
  PausableExpense,
  SurvivalModeResult,
  RecoveryPlanReport,
  RecoveryPlanDependencies,
  getEmergencyStatus,
  getQuickWins,
  getSurvivalMode,
  simulateScenario,
  generateRecoveryPlan,
  RecoveryPlanEngine,
} from './engines/recovery-plan-engine';

// Services
export {
  // Price Service (Phase 2 - v1.1)
  PriceService,
  priceService,
} from './services/PriceService';

// Performance Engine (Phase 4 - v1.1)
export {
  PerformanceEngine,
  type HoldingData,
  type SellTransaction,
  type PortfolioSnapshot
} from './engines/performance-engine';

// Benchmark Service (Phase 4 - v1.1)
export {
  BenchmarkService,
  type BenchmarkReturn,
  type BenchmarkServiceConfig
} from './services/benchmark-service';

// Net Worth Service (Phase 5 - v1.1)
export {
  NetWorthService,
  netWorthService,
} from './services/NetWorthService';

export {
  // Paycheck Budget Engine
  PaycheckAllocationType,
  PaycheckAllocationData,
  PaycheckBudgetViewInput,
  PaycheckAllocation,
  PaycheckBudgetView,
  PaycheckValidationResult,
  buildPaycheckView,
  buildAllPaycheckViews,
  validatePaycheckAllocations,
  PaycheckBudgetEngine,
} from './engines/paycheck-budget-engine';
