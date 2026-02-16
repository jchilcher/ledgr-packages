import { SQLiteDriver } from './driver';
import type {
  Account,
  Transaction,
  Category,
  CategoryRule,
  RecurringTransaction,
  RecurringFrequency,
  RecurringItemType,
  RecurringItem,
  RecurringPayment,
  PaymentStatus,
  Tag,
  TransactionSplit,
  BudgetGoal,
  BudgetPeriod,
  SpendingAlert,
  Bill,
  BillFrequency,
  BillPayment,
  BillPaymentStatus,
  CategoryCorrection,
  Asset,
  AssetType,
  Liability,
  LiabilityType,
  NetWorthHistory,
  SavingsGoal,
  SavingsContribution,
  Investment,
  InvestmentType,
  InvestmentHistory,
  Receipt,
  InvestmentAccount,
  InvestmentAccountType,
  Holding,
  CostBasisLot,
  InvestmentTransaction,
  InvestmentTransactionType,
  InvestmentSettings,
  ManualAsset,
  ManualAssetCategory,
  AssetLiquidity,
  ManualLiability,
  ManualLiabilityType,
  NetWorthSnapshot,
  AssetValueHistory,
  LiabilityValueHistory,
  TransactionReimbursement,
  ReimbursementStatus,
  ReimbursementSummary,
  SavedReport,
  User,
  OwnershipType,
  TransactionAttachment,
  UserKeys,
  DataShare,
  SharingDefault,
  SharePermissions,
  EncryptableEntityType,
  SharingEntityType,
} from './types';
import {
  AccountRow, TransactionRow, CategoryRow, CategoryRuleRow, TagRow,
  TransactionSplitRow, BudgetGoalRow, SpendingAlertRow, BillRow,
  BillPaymentRow, CategoryCorrectionRow, AssetRow, LiabilityRow,
  NetWorthHistoryRow, SavingsGoalRow, SavingsContributionRow,
  InvestmentRow, InvestmentHistoryRow, ReceiptRow, InvestmentAccountRow,
  HoldingRow, CostBasisLotRow, InvestmentTransactionRow,
  InvestmentSettingsRow, RecurringItemRow, RecurringPaymentRow,
  ManualAssetRow, ManualLiabilityRow, NetWorthSnapshotRow,
  AssetValueHistoryRow, LiabilityValueHistoryRow,
  SavedReportRow, UserRow, TransactionAttachmentRow,
  UserKeyRow, DataEncryptionKeyRow, DataShareRow, SharingDefaultRow,
  AutomationRuleActionRow, PaycheckAllocationRow,
} from './row-types';
import { randomUUID } from 'crypto';

export const CURRENT_SCHEMA_VERSION = 2;

export class LedgrDatabase {
  protected driver: SQLiteDriver;

  constructor(driver: SQLiteDriver) {
    this.driver = driver;
    this.initializeTables();
    this.runMigrations();
  }

  private runMigrations(): void {
    // Add OFX columns to accounts table if they don't exist
    const accountColumns = this.driver.all<{ name: string }>("PRAGMA table_info(accounts)");
    const accountColumnNames = accountColumns.map(c => c.name);

    if (!accountColumnNames.includes('ofxUrl')) {
      this.driver.exec('ALTER TABLE accounts ADD COLUMN ofxUrl TEXT');
    }
    if (!accountColumnNames.includes('ofxOrg')) {
      this.driver.exec('ALTER TABLE accounts ADD COLUMN ofxOrg TEXT');
    }
    if (!accountColumnNames.includes('ofxFid')) {
      this.driver.exec('ALTER TABLE accounts ADD COLUMN ofxFid TEXT');
    }
    if (!accountColumnNames.includes('ofxUsername')) {
      this.driver.exec('ALTER TABLE accounts ADD COLUMN ofxUsername TEXT');
    }
    if (!accountColumnNames.includes('ofxAccountId')) {
      this.driver.exec('ALTER TABLE accounts ADD COLUMN ofxAccountId TEXT');
    }

    // Add household ownership columns to accounts table
    if (!accountColumnNames.includes('ownership')) {
      this.driver.exec("ALTER TABLE accounts ADD COLUMN ownership TEXT DEFAULT 'mine'");
    }
    if (!accountColumnNames.includes('ownerId')) {
      this.driver.exec('ALTER TABLE accounts ADD COLUMN ownerId TEXT');
    }

    // Add fitId column to transactions table if it doesn't exist
    const transactionColumns = this.driver.all<{ name: string }>("PRAGMA table_info(transactions)");
    const transactionColumnNames = transactionColumns.map(c => c.name);

    if (!transactionColumnNames.includes('fitId')) {
      this.driver.exec('ALTER TABLE transactions ADD COLUMN fitId TEXT');
      this.driver.exec('CREATE INDEX IF NOT EXISTS idx_transactions_fitId ON transactions(fitId)');
    }

    // Add notes column to transactions table if it doesn't exist
    if (!transactionColumnNames.includes('notes')) {
      this.driver.exec('ALTER TABLE transactions ADD COLUMN notes TEXT');
    }

    // Add isHidden column to transactions table if it doesn't exist
    if (!transactionColumnNames.includes('isHidden')) {
      this.driver.exec('ALTER TABLE transactions ADD COLUMN isHidden INTEGER DEFAULT 0');
    }

    // Add isInternalTransfer column to transactions table if it doesn't exist
    if (!transactionColumnNames.includes('isInternalTransfer')) {
      this.driver.exec('ALTER TABLE transactions ADD COLUMN isInternalTransfer INTEGER DEFAULT 0');

      // Auto-mark existing transfers based on category names
      this.driver.exec(`
        UPDATE transactions
        SET isInternalTransfer = 1
        WHERE categoryId IN (
          SELECT id FROM categories
          WHERE LOWER(name) IN ('transfer', 'transfers', 'savings', 'internal transfer')
        )
      `);
    }

    // Update importSource check constraint to include 'ofx'
    // Note: SQLite doesn't support modifying constraints, so we just ensure new inserts work

    // Migrate amounts from dollars to cents (one-time, v1.2.0 bug fix)
    this.migrateDollarsToCents();

    // Deduplicate categories (fixes legacy migration creating duplicates)
    this.deduplicateCategories();

    // Deduplicate category rules (fixes duplicate default rules)
    this.deduplicateRules();

    // Migrate to unified recurring_items table
    this.migrateToRecurringItems();

    // Add itemType column to recurring_items
    this.migrateRecurringItemType();

    // Clear corrupted net worth snapshots (v1.2.14 — pre-fix snapshots had 10,000x inflated investment values)
    this.clearCorruptedNetWorthSnapshots();

    // Auto-mark savings account transactions as internal transfers
    const savingsAccounts = this.driver.all<{ id: string }>(
      "SELECT id FROM accounts WHERE type = 'savings'"
    );
    if (savingsAccounts.length > 0) {
      const placeholders = savingsAccounts.map(() => '?').join(',');
      this.driver.run(`
        UPDATE transactions SET isInternalTransfer = 1
        WHERE accountId IN (${placeholders})
          AND (isInternalTransfer IS NULL OR isInternalTransfer = 0)
      `, savingsAccounts.map(a => a.id));
    }

    // Add ownerId columns to entity tables for per-user ownership
    this.migrateOwnershipColumns();

    // Migrate savings amounts from dollars to cents (missed in original migration)
    this.migrateSavingsToCents();

    // Add isEncrypted columns to entity tables
    this.migrateEncryptionColumns();

    // Add enhanced automation rule columns to category_rules
    this.migrateAutomationRuleColumns();
  }

  private migrateAutomationRuleColumns(): void {
    const columns = this.driver.all<{ name: string }>("PRAGMA table_info(category_rules)");
    const columnNames = columns.map(c => c.name);

    if (!columnNames.includes('amountMin')) {
      this.driver.exec('ALTER TABLE category_rules ADD COLUMN amountMin REAL');
    }
    if (!columnNames.includes('amountMax')) {
      this.driver.exec('ALTER TABLE category_rules ADD COLUMN amountMax REAL');
    }
    if (!columnNames.includes('accountFilter')) {
      this.driver.exec('ALTER TABLE category_rules ADD COLUMN accountFilter TEXT');
    }
    if (!columnNames.includes('directionFilter')) {
      this.driver.exec('ALTER TABLE category_rules ADD COLUMN directionFilter TEXT');
    }
  }

  private migrateDollarsToCents(): void {
    const version = this.driver.get<{ user_version: number }>('PRAGMA user_version')!.user_version;
    if (version >= 1) {
      return; // Already migrated
    }

    console.log('[DB Migration] Converting amounts from dollars to cents...');

    const migrations: [string, string][] = [
      ['transactions', 'UPDATE transactions SET amount = ROUND(amount * 100)'],
      ['accounts', 'UPDATE accounts SET balance = ROUND(balance * 100)'],
      ['recurring_items', 'UPDATE recurring_items SET amount = ROUND(amount * 100)'],
      ['transaction_splits', 'UPDATE transaction_splits SET amount = ROUND(amount * 100)'],
      ['bills', 'UPDATE bills SET amount = ROUND(amount * 100)'],
      ['bill_payments', 'UPDATE bill_payments SET amount = ROUND(amount * 100)'],
      ['budget_goals', 'UPDATE budget_goals SET amount = ROUND(amount * 100), rolloverAmount = ROUND(rolloverAmount * 100)'],
      ['spending_alerts', 'UPDATE spending_alerts SET threshold = ROUND(threshold * 100)'],
    ];

    for (const [table, sql] of migrations) {
      try {
        const result = this.driver.run(sql);
        if (result.changes > 0) {
          console.log(`[DB Migration] ${table}: ${result.changes} rows converted`);
        }
      } catch (err) {
        console.warn(`[DB Migration] Skipping ${table}: ${(err as Error).message}`);
      }
    }

    this.driver.exec('PRAGMA user_version = 1');
    console.log('[DB Migration] Dollar-to-cents conversion complete.');
  }

  private migrateSavingsToCents(): void {
    const version = this.driver.get<{ user_version: number }>('PRAGMA user_version')!.user_version;
    if (version >= 2) {
      return; // Already migrated
    }

    console.log('[DB Migration] Converting savings amounts from dollars to cents...');

    const migrations: [string, string][] = [
      ['savings_goals (targetAmount)', 'UPDATE savings_goals SET targetAmount = ROUND(targetAmount * 100)'],
      ['savings_goals (currentAmount, non-pinned)', 'UPDATE savings_goals SET currentAmount = ROUND(currentAmount * 100) WHERE accountId IS NULL'],
      ['savings_contributions', 'UPDATE savings_contributions SET amount = ROUND(amount * 100)'],
    ];

    for (const [label, sql] of migrations) {
      try {
        const result = this.driver.run(sql);
        if (result.changes > 0) {
          console.log(`[DB Migration] ${label}: ${result.changes} rows converted`);
        }
      } catch (err) {
        console.warn(`[DB Migration] Skipping ${label}: ${(err as Error).message}`);
      }
    }

    this.driver.exec('PRAGMA user_version = 2');
    console.log('[DB Migration] Savings dollar-to-cents conversion complete.');
  }

  private deduplicateCategories(): void {
    // Find duplicate category names (case-insensitive)
    const duplicates = this.driver.all<{ lname: string; cnt: number }>(`
      SELECT LOWER(name) as lname, COUNT(*) as cnt
      FROM categories
      GROUP BY LOWER(name)
      HAVING COUNT(*) > 1
    `);

    if (duplicates.length === 0) return;

    console.log(`[DB Migration] Found ${duplicates.length} duplicate category name(s), deduplicating...`);

    for (const dup of duplicates) {
      // Get all categories with this name
      const cats = this.driver.all<{ id: string }>(
        'SELECT id FROM categories WHERE LOWER(name) = ? ORDER BY rowid ASC',
        [dup.lname]
      );

      // For each category, count how many references it has
      let keepId: string | null = null;
      let maxRefs = -1;

      for (const cat of cats) {
        const txCount = this.driver.get<{ c: number }>(
          'SELECT COUNT(*) as c FROM transactions WHERE categoryId = ?',
          [cat.id]
        )!.c;
        const ruleCount = this.driver.get<{ c: number }>(
          'SELECT COUNT(*) as c FROM category_rules WHERE categoryId = ?',
          [cat.id]
        )!.c;
        const refs = txCount + ruleCount;

        if (refs > maxRefs) {
          maxRefs = refs;
          keepId = cat.id;
        }
      }

      // Reassign all references from duplicates to the kept category, then delete
      for (const cat of cats) {
        if (cat.id === keepId) continue;

        this.driver.run('UPDATE transactions SET categoryId = ? WHERE categoryId = ?', [keepId, cat.id]);
        this.driver.run('UPDATE category_rules SET categoryId = ? WHERE categoryId = ?', [keepId, cat.id]);
        this.driver.run('UPDATE budget_goals SET categoryId = ? WHERE categoryId = ?', [keepId, cat.id]);
        this.driver.run('UPDATE spending_alerts SET categoryId = ? WHERE categoryId = ?', [keepId, cat.id]);

        try {
          this.driver.run('UPDATE bills SET categoryId = ? WHERE categoryId = ?', [keepId, cat.id]);
        } catch { /* table may not exist */ }
        try {
          this.driver.run('UPDATE recurring_items SET categoryId = ? WHERE categoryId = ?', [keepId, cat.id]);
        } catch { /* table may not exist */ }
        try {
          this.driver.run('UPDATE transaction_splits SET categoryId = ? WHERE categoryId = ?', [keepId, cat.id]);
        } catch { /* table may not exist */ }

        this.driver.run('DELETE FROM categories WHERE id = ?', [cat.id]);
        console.log(`[DB Migration] Removed duplicate category ${cat.id} (kept ${keepId})`);
      }
    }

    console.log('[DB Migration] Category deduplication complete.');
  }

  private deduplicateRules(): void {
    const duplicates = this.driver.all<{ lpattern: string; cnt: number }>(`
      SELECT LOWER(pattern) as lpattern, COUNT(*) as cnt
      FROM category_rules
      GROUP BY LOWER(pattern)
      HAVING COUNT(*) > 1
    `);

    if (duplicates.length === 0) return;

    console.log(`[DB Migration] Found ${duplicates.length} duplicate rule pattern(s), deduplicating...`);

    for (const dup of duplicates) {
      const rules = this.driver.all<{ id: string; priority: number; createdAt: number }>(
        'SELECT id, priority, createdAt FROM category_rules WHERE LOWER(pattern) = ? ORDER BY priority DESC, createdAt DESC',
        [dup.lpattern]
      );

      // Keep the first one (highest priority, most recent createdAt)
      const keepId = rules[0].id;

      for (let i = 1; i < rules.length; i++) {
        this.driver.run('DELETE FROM category_rules WHERE id = ?', [rules[i].id]);
      }

      console.log(`[DB Migration] Removed ${rules.length - 1} duplicate rule(s) for pattern "${dup.lpattern}" (kept ${keepId})`);
    }

    console.log('[DB Migration] Rule deduplication complete.');
  }

  public migrateToRecurringItems(): void {
    console.log('[DB Migration] Checking recurring_items migration...');

    // Check if recurring_items table exists
    const tableExists = this.driver.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='recurring_items'"
    );

    if (!tableExists) {
      console.log('[DB Migration] recurring_items table does not exist, will create and migrate...');
    } else {
      // Check if migration is needed (table empty but old tables have data)
      const itemCount = this.driver.get<{ count: number }>('SELECT COUNT(*) as count FROM recurring_items')!;
      const oldRecurringCount = this.driver.get<{ count: number }>(
        "SELECT COUNT(*) as count FROM recurring_transactions WHERE id NOT IN (SELECT id FROM recurring_items)"
      )!;
      const oldBillsCount = this.driver.get<{ count: number }>(
        "SELECT COUNT(*) as count FROM bills WHERE id NOT IN (SELECT id FROM recurring_items)"
      )!;

      console.log(`[DB Migration] recurring_items: ${itemCount.count}, unmigrated recurring: ${oldRecurringCount.count}, unmigrated bills: ${oldBillsCount.count}`);

      if (oldRecurringCount.count === 0 && oldBillsCount.count === 0) {
        console.log('[DB Migration] No migration needed.');
        return; // Migration already done
      }
    }

    console.log('[DB Migration] Running migration...');

    // Create the unified recurring_items table
    this.driver.exec(`
      CREATE TABLE IF NOT EXISTS recurring_items (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        frequency TEXT NOT NULL CHECK(frequency IN ('daily','weekly','biweekly','monthly','quarterly','yearly')),
        startDate INTEGER NOT NULL,
        nextOccurrence INTEGER NOT NULL,
        accountId TEXT,
        endDate INTEGER,
        categoryId TEXT,
        dayOfMonth INTEGER,
        dayOfWeek INTEGER,
        enableReminders INTEGER NOT NULL DEFAULT 0,
        reminderDays INTEGER DEFAULT 3,
        autopay INTEGER NOT NULL DEFAULT 0,
        isActive INTEGER NOT NULL DEFAULT 1,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE SET NULL,
        FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_recurring_items_account ON recurring_items(accountId);
      CREATE INDEX IF NOT EXISTS idx_recurring_items_category ON recurring_items(categoryId);
      CREATE INDEX IF NOT EXISTS idx_recurring_items_next ON recurring_items(nextOccurrence);
    `);

    // Migrate recurring_transactions to recurring_items (enableReminders=false)
    const recurringTransactions = this.driver.all(
      'SELECT * FROM recurring_transactions WHERE id NOT IN (SELECT id FROM recurring_items)'
    );

    const insertSql = `
      INSERT OR IGNORE INTO recurring_items (id, description, amount, frequency, startDate, nextOccurrence, accountId, endDate, categoryId, dayOfMonth, dayOfWeek, enableReminders, reminderDays, autopay, isActive, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const rt of recurringTransactions) {
      const r = rt as {
        id: string;
        accountId: string;
        description: string;
        amount: number;
        categoryId: string | null;
        frequency: string;
        startDate: number;
        endDate: number | null;
        nextOccurrence: number;
      };
      // Extract day of month from start date for monthly items
      const startDate = new Date(r.startDate);
      const dayOfMonth = r.frequency === 'monthly' ? startDate.getDate() : null;
      const dayOfWeek = r.frequency === 'weekly' ? startDate.getDay() : null;

      this.driver.run(insertSql, [
        r.id,
        r.description,
        r.amount,
        r.frequency,
        r.startDate,
        r.nextOccurrence,
        r.accountId,
        r.endDate,
        r.categoryId,
        dayOfMonth,
        dayOfWeek,
        0, // enableReminders = false
        null, // reminderDays
        0, // autopay = false
        1, // isActive = true
        r.startDate // Use startDate as createdAt
      ]);
    }

    // Migrate bills to recurring_items (enableReminders=true, amount negated)
    const bills = this.driver.all(
      'SELECT * FROM bills WHERE id NOT IN (SELECT id FROM recurring_items)'
    );

    for (const b of bills) {
      const bill = b as {
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
      };

      // Calculate start date and next occurrence based on due day
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth(), bill.dueDay);
      const nextOccurrence = startDate.getTime() < now.getTime()
        ? new Date(now.getFullYear(), now.getMonth() + 1, bill.dueDay).getTime()
        : startDate.getTime();

      this.driver.run(insertSql, [
        bill.id,
        bill.name,
        -Math.abs(bill.amount), // Negate amount for expenses
        bill.frequency,
        bill.createdAt,
        nextOccurrence,
        null, // Bills had no accountId
        null, // endDate
        bill.categoryId,
        bill.dueDay, // dayOfMonth
        null, // dayOfWeek
        1, // enableReminders = true (was a bill)
        bill.reminderDays,
        bill.autopay,
        bill.isActive,
        bill.createdAt
      ]);
    }

    console.log(`[DB Migration] Migrated ${recurringTransactions.length} recurring transactions and ${bills.length} bills to recurring_items`);

    // Add recurringItemId to bill_payments and rename
    const paymentsTableInfo = this.driver.all<{ name: string }>("PRAGMA table_info(bill_payments)");
    const paymentsColumnNames = paymentsTableInfo.map(c => c.name);

    if (!paymentsColumnNames.includes('recurringItemId')) {
      this.driver.exec(`
        ALTER TABLE bill_payments ADD COLUMN recurringItemId TEXT;
        UPDATE bill_payments SET recurringItemId = billId;
      `);
    }

    // Create recurring_payments view/table for the new API
    this.driver.exec(`
      CREATE TABLE IF NOT EXISTS recurring_payments (
        id TEXT PRIMARY KEY,
        recurringItemId TEXT NOT NULL,
        dueDate INTEGER NOT NULL,
        paidDate INTEGER,
        amount REAL NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'paid', 'overdue', 'skipped')),
        transactionId TEXT,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (recurringItemId) REFERENCES recurring_items(id) ON DELETE CASCADE,
        FOREIGN KEY (transactionId) REFERENCES transactions(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_recurring_payments_item ON recurring_payments(recurringItemId);
      CREATE INDEX IF NOT EXISTS idx_recurring_payments_due ON recurring_payments(dueDate);

      -- Migrate existing bill_payments to recurring_payments
      INSERT OR IGNORE INTO recurring_payments (id, recurringItemId, dueDate, paidDate, amount, status, transactionId, createdAt)
      SELECT id, billId, dueDate, paidDate, amount, status, transactionId, createdAt
      FROM bill_payments;
    `);

    // Transaction reimbursement linking table
    this.driver.exec(`
      CREATE TABLE IF NOT EXISTS transaction_reimbursements (
        id TEXT PRIMARY KEY,
        expenseTransactionId TEXT NOT NULL,
        reimbursementTransactionId TEXT NOT NULL,
        amount REAL NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (expenseTransactionId) REFERENCES transactions(id) ON DELETE CASCADE,
        FOREIGN KEY (reimbursementTransactionId) REFERENCES transactions(id) ON DELETE CASCADE,
        UNIQUE(expenseTransactionId, reimbursementTransactionId)
      );
      CREATE INDEX IF NOT EXISTS idx_reimbursements_expense ON transaction_reimbursements(expenseTransactionId);
      CREATE INDEX IF NOT EXISTS idx_reimbursements_income ON transaction_reimbursements(reimbursementTransactionId);
    `);
  }

  private migrateRecurringItemType(): void {
    // Add itemType column to recurring_items if it doesn't exist
    const columns = this.driver.all<{ name: string }>("PRAGMA table_info(recurring_items)");
    const columnNames = columns.map(c => c.name);

    if (!columnNames.includes('itemType')) {
      console.log('[DB Migration] Adding itemType column to recurring_items...');
      this.driver.exec(`
        ALTER TABLE recurring_items ADD COLUMN itemType TEXT DEFAULT 'cashflow';
        UPDATE recurring_items SET itemType = 'bill' WHERE enableReminders = 1;
      `);
      console.log('[DB Migration] itemType column added and backfilled.');
    }
  }

  private migrateOwnershipColumns(): void {
    // Add ownerId to recurring_items (camelCase table)
    const riCols = this.driver.all<{ name: string }>("PRAGMA table_info(recurring_items)");
    if (!riCols.map(c => c.name).includes('ownerId')) {
      console.log('[DB Migration] Adding ownerId column to recurring_items...');
      this.driver.exec('ALTER TABLE recurring_items ADD COLUMN ownerId TEXT');
    }

    // Add owner_id to manual_assets (snake_case table)
    const maCols = this.driver.all<{ name: string }>("PRAGMA table_info(manual_assets)");
    if (!maCols.map(c => c.name).includes('owner_id')) {
      console.log('[DB Migration] Adding owner_id column to manual_assets...');
      this.driver.exec('ALTER TABLE manual_assets ADD COLUMN owner_id TEXT');
    }

    // Add owner_id to manual_liabilities (snake_case table)
    const mlCols = this.driver.all<{ name: string }>("PRAGMA table_info(manual_liabilities)");
    if (!mlCols.map(c => c.name).includes('owner_id')) {
      console.log('[DB Migration] Adding owner_id column to manual_liabilities...');
      this.driver.exec('ALTER TABLE manual_liabilities ADD COLUMN owner_id TEXT');
    }

    // Add ownerId to savings_goals (camelCase table)
    const sgCols = this.driver.all<{ name: string }>("PRAGMA table_info(savings_goals)");
    if (!sgCols.map(c => c.name).includes('ownerId')) {
      console.log('[DB Migration] Adding ownerId column to savings_goals...');
      this.driver.exec('ALTER TABLE savings_goals ADD COLUMN ownerId TEXT');
    }

    // Add owner_id to investment_accounts (snake_case table)
    const iaCols = this.driver.all<{ name: string }>("PRAGMA table_info(investment_accounts)");
    if (!iaCols.map(c => c.name).includes('owner_id')) {
      console.log('[DB Migration] Adding owner_id column to investment_accounts...');
      this.driver.exec('ALTER TABLE investment_accounts ADD COLUMN owner_id TEXT');
    }

    // Backfill accounts.ownerId from legacy ownership field
    this.backfillAccountOwnership();
  }

  private backfillAccountOwnership(): void {
    // Only backfill if there are accounts with ownership set but no ownerId
    const needsBackfill = this.driver.get<{ c: number }>(
      "SELECT COUNT(*) as c FROM accounts WHERE ownership IS NOT NULL AND ownership != 'shared' AND ownerId IS NULL"
    );
    if (!needsBackfill || needsBackfill.c === 0) return;

    const users = this.driver.all<{ id: string; isDefault: number }>('SELECT id, isDefault FROM users ORDER BY isDefault DESC');
    if (users.length === 0) return;

    const defaultUser = users.find(u => u.isDefault === 1) ?? users[0];
    const otherUser = users.length >= 2 ? users.find(u => u.id !== defaultUser.id) : null;

    console.log('[DB Migration] Backfilling accounts.ownerId from legacy ownership field...');

    // mine -> defaultUser
    this.driver.run(
      "UPDATE accounts SET ownerId = ? WHERE ownership = 'mine' AND ownerId IS NULL",
      [defaultUser.id]
    );

    // partner -> otherUser (if exactly 2 users)
    if (otherUser) {
      this.driver.run(
        "UPDATE accounts SET ownerId = ? WHERE ownership = 'partner' AND ownerId IS NULL",
        [otherUser.id]
      );
    }

    // shared -> NULL (already NULL, nothing to do)
    console.log('[DB Migration] Account ownership backfill complete.');
  }

  private clearCorruptedNetWorthSnapshots(): void {
    const already = this.getSetting('migration_clear_nw_snapshots', '');
    if (already === 'done') return;

    console.log('[DB Migration] Clearing corrupted net worth snapshots (pre-v1.2.12 inflated investment values)...');
    try {
      const s1 = this.driver.run('DELETE FROM net_worth_snapshots');
      console.log(`[DB Migration] Deleted ${s1.changes} rows from net_worth_snapshots`);
    } catch (err) {
      console.warn(`[DB Migration] Skipping net_worth_snapshots: ${(err as Error).message}`);
    }
    try {
      const s2 = this.driver.run('DELETE FROM net_worth_history');
      console.log(`[DB Migration] Deleted ${s2.changes} rows from net_worth_history`);
    } catch (err) {
      console.warn(`[DB Migration] Skipping net_worth_history: ${(err as Error).message}`);
    }
    this.setSetting('migration_clear_nw_snapshots', 'done');
    console.log('[DB Migration] Corrupted net worth snapshot cleanup complete.');
  }

  private migrateEncryptionColumns(): void {
    // camelCase tables: accounts, recurring_items, savings_goals
    const camelCaseTables = ['accounts', 'recurring_items', 'savings_goals'];
    for (const table of camelCaseTables) {
      const cols = this.driver.all<{ name: string }>(`PRAGMA table_info(${table})`);
      if (!cols.map(c => c.name).includes('isEncrypted')) {
        this.driver.exec(`ALTER TABLE ${table} ADD COLUMN isEncrypted INTEGER DEFAULT 0`);
      }
    }

    // snake_case tables: manual_assets, manual_liabilities, investment_accounts
    const snakeCaseTables = ['manual_assets', 'manual_liabilities', 'investment_accounts'];
    for (const table of snakeCaseTables) {
      const cols = this.driver.all<{ name: string }>(`PRAGMA table_info(${table})`);
      if (!cols.map(c => c.name).includes('is_encrypted')) {
        this.driver.exec(`ALTER TABLE ${table} ADD COLUMN is_encrypted INTEGER DEFAULT 0`);
      }
    }
  }

  private initializeTables(): void {
    // Create users table (household support)
    this.driver.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#3b82f6',
        isDefault INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL
      );
    `);

    // Insert default user if users table is empty
    const userCount = this.driver.get<{ count: number }>('SELECT COUNT(*) as count FROM users');
    if (userCount && userCount.count === 0) {
      this.driver.run(
        'INSERT INTO users (id, name, color, isDefault, createdAt) VALUES (?, ?, ?, ?, ?)',
        [randomUUID(), 'Me', '#3b82f6', 1, Date.now()]
      );
    }

    // Create tables (without indexes that depend on migrated columns)
    this.driver.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('checking', 'savings', 'credit')),
        institution TEXT NOT NULL,
        balance REAL NOT NULL DEFAULT 0,
        lastSynced INTEGER,
        createdAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        accountId TEXT NOT NULL,
        date INTEGER NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        categoryId TEXT,
        isRecurring INTEGER NOT NULL DEFAULT 0,
        importSource TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
        icon TEXT,
        color TEXT,
        isDefault INTEGER NOT NULL DEFAULT 0,
        parentId TEXT,
        FOREIGN KEY (parentId) REFERENCES categories(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS category_rules (
        id TEXT PRIMARY KEY,
        pattern TEXT NOT NULL,
        categoryId TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS recurring_transactions (
        id TEXT PRIMARY KEY,
        accountId TEXT NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        categoryId TEXT,
        frequency TEXT NOT NULL CHECK(frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
        startDate INTEGER NOT NULL,
        endDate INTEGER,
        nextOccurrence INTEGER NOT NULL,
        FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(accountId);
      CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
      CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(categoryId);

      -- Phase 1: Tags
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT,
        createdAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transaction_tags (
        transactionId TEXT NOT NULL,
        tagId TEXT NOT NULL,
        PRIMARY KEY (transactionId, tagId),
        FOREIGN KEY (transactionId) REFERENCES transactions(id) ON DELETE CASCADE,
        FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
      );

      -- Phase 1: Split Transactions
      CREATE TABLE IF NOT EXISTS transaction_splits (
        id TEXT PRIMARY KEY,
        parentTransactionId TEXT NOT NULL,
        categoryId TEXT,
        amount REAL NOT NULL,
        description TEXT,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (parentTransactionId) REFERENCES transactions(id) ON DELETE CASCADE,
        FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE SET NULL
      );

      -- Phase 2: Budget Goals
      CREATE TABLE IF NOT EXISTS budget_goals (
        id TEXT PRIMARY KEY,
        categoryId TEXT NOT NULL,
        amount REAL NOT NULL,
        period TEXT NOT NULL CHECK(period IN ('weekly', 'monthly', 'yearly')),
        rolloverEnabled INTEGER DEFAULT 0,
        rolloverAmount REAL DEFAULT 0,
        startDate INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE CASCADE
      );

      -- Phase 2: Spending Alerts
      CREATE TABLE IF NOT EXISTS spending_alerts (
        id TEXT PRIMARY KEY,
        categoryId TEXT NOT NULL,
        threshold REAL NOT NULL,
        period TEXT NOT NULL CHECK(period IN ('weekly', 'monthly', 'yearly')),
        isActive INTEGER DEFAULT 1,
        lastTriggered INTEGER,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE CASCADE
      );

      -- Phase 3: Bills
      CREATE TABLE IF NOT EXISTS bills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        dueDay INTEGER NOT NULL,
        frequency TEXT NOT NULL CHECK(frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
        categoryId TEXT,
        autopay INTEGER DEFAULT 0,
        reminderDays INTEGER DEFAULT 3,
        isActive INTEGER DEFAULT 1,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS bill_payments (
        id TEXT PRIMARY KEY,
        billId TEXT NOT NULL,
        dueDate INTEGER NOT NULL,
        paidDate INTEGER,
        amount REAL NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'paid', 'overdue', 'skipped')),
        transactionId TEXT,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (billId) REFERENCES bills(id) ON DELETE CASCADE,
        FOREIGN KEY (transactionId) REFERENCES transactions(id) ON DELETE SET NULL
      );

      -- Phase 3: Smart Categorization
      CREATE TABLE IF NOT EXISTS category_corrections (
        id TEXT PRIMARY KEY,
        originalDescription TEXT NOT NULL,
        correctedCategoryId TEXT NOT NULL,
        pattern TEXT,
        confidence REAL DEFAULT 1.0,
        usageCount INTEGER DEFAULT 1,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (correctedCategoryId) REFERENCES categories(id) ON DELETE CASCADE
      );

      -- Phase 4: Net Worth
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('cash', 'investment', 'property', 'vehicle', 'other')),
        value REAL NOT NULL,
        lastUpdated INTEGER NOT NULL,
        notes TEXT,
        createdAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS liabilities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('mortgage', 'auto_loan', 'student_loan', 'credit_card', 'personal_loan', 'other')),
        balance REAL NOT NULL,
        interestRate REAL,
        minimumPayment REAL,
        lastUpdated INTEGER NOT NULL,
        createdAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS net_worth_history (
        id TEXT PRIMARY KEY,
        date INTEGER NOT NULL,
        totalAssets REAL NOT NULL,
        totalLiabilities REAL NOT NULL,
        netWorth REAL NOT NULL,
        breakdown TEXT,
        createdAt INTEGER NOT NULL
      );

      -- Phase 4: Savings Goals
      CREATE TABLE IF NOT EXISTS savings_goals (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        targetAmount REAL NOT NULL,
        currentAmount REAL DEFAULT 0,
        targetDate INTEGER,
        accountId TEXT,
        icon TEXT,
        color TEXT,
        isActive INTEGER DEFAULT 1,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS savings_contributions (
        id TEXT PRIMARY KEY,
        goalId TEXT NOT NULL,
        amount REAL NOT NULL,
        transactionId TEXT,
        date INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (goalId) REFERENCES savings_goals(id) ON DELETE CASCADE,
        FOREIGN KEY (transactionId) REFERENCES transactions(id) ON DELETE SET NULL
      );

      -- Phase 5: Investments
      CREATE TABLE IF NOT EXISTS investments (
        id TEXT PRIMARY KEY,
        accountId TEXT,
        name TEXT NOT NULL,
        ticker TEXT,
        type TEXT NOT NULL CHECK(type IN ('stock', 'etf', 'mutual_fund', 'bond', 'crypto', 'other')),
        shares REAL NOT NULL,
        costBasis REAL NOT NULL,
        currentPrice REAL NOT NULL,
        lastUpdated INTEGER NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS investment_history (
        id TEXT PRIMARY KEY,
        investmentId TEXT NOT NULL,
        date INTEGER NOT NULL,
        price REAL NOT NULL,
        shares REAL NOT NULL,
        value REAL NOT NULL,
        FOREIGN KEY (investmentId) REFERENCES investments(id) ON DELETE CASCADE
      );

      -- Phase 6: Receipts
      CREATE TABLE IF NOT EXISTS receipts (
        id TEXT PRIMARY KEY,
        transactionId TEXT,
        filePath TEXT NOT NULL,
        thumbnailPath TEXT,
        extractedData TEXT,
        uploadedAt INTEGER NOT NULL,
        processedAt INTEGER,
        FOREIGN KEY (transactionId) REFERENCES transactions(id) ON DELETE SET NULL
      );

      -- v1.1: Investment Tracking
      CREATE TABLE IF NOT EXISTS investment_accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        institution TEXT NOT NULL,
        account_type TEXT NOT NULL CHECK(account_type IN ('taxable', 'traditional_ira', 'roth_ira', '401k', 'hsa')),
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS holdings (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        ticker TEXT NOT NULL,
        name TEXT NOT NULL,
        shares_owned INTEGER NOT NULL DEFAULT 0,
        avg_cost_per_share INTEGER NOT NULL DEFAULT 0,
        current_price INTEGER NOT NULL DEFAULT 0,
        sector TEXT,
        last_price_update INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (account_id) REFERENCES investment_accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS cost_basis_lots (
        id TEXT PRIMARY KEY,
        holding_id TEXT NOT NULL,
        purchase_date INTEGER NOT NULL,
        shares INTEGER NOT NULL,
        cost_per_share INTEGER NOT NULL,
        remaining_shares INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (holding_id) REFERENCES holdings(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_holdings_account ON holdings(account_id);
      CREATE INDEX IF NOT EXISTS idx_lots_holding ON cost_basis_lots(holding_id);
      CREATE INDEX IF NOT EXISTS idx_lots_purchase_date ON cost_basis_lots(purchase_date);

      -- Investment Transactions (Phase 3 v1.1)
      CREATE TABLE IF NOT EXISTS investment_transactions (
        id TEXT PRIMARY KEY,
        holding_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('buy', 'sell', 'dividend', 'stock_split', 'drip')),
        date INTEGER NOT NULL,
        shares INTEGER NOT NULL,
        price_per_share INTEGER NOT NULL DEFAULT 0,
        total_amount INTEGER NOT NULL,
        fees INTEGER NOT NULL DEFAULT 0,
        split_ratio TEXT,
        notes TEXT,
        lot_id TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (holding_id) REFERENCES holdings(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS investment_settings (
        id TEXT PRIMARY KEY,
        concentration_threshold INTEGER NOT NULL DEFAULT 25,
        default_sector_allocation TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_inv_tx_holding ON investment_transactions(holding_id);
      CREATE INDEX IF NOT EXISTS idx_inv_tx_date ON investment_transactions(date);
      CREATE INDEX IF NOT EXISTS idx_inv_tx_type ON investment_transactions(type);

      -- Phase 7: Prediction & Reporting

      -- Seasonal patterns for spending analysis
      CREATE TABLE IF NOT EXISTS seasonal_patterns (
        id TEXT PRIMARY KEY,
        categoryId TEXT NOT NULL,
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        averageSpending REAL NOT NULL,
        transactionCount INTEGER NOT NULL,
        seasonalIndex REAL NOT NULL,
        calculatedAt INTEGER NOT NULL,
        FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE CASCADE,
        UNIQUE(categoryId, year, month)
      );

      -- Financial health score history
      CREATE TABLE IF NOT EXISTS financial_health_history (
        id TEXT PRIMARY KEY,
        date INTEGER NOT NULL,
        overallScore REAL NOT NULL,
        factorScores TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );

      -- Bill preferences for cash flow optimization
      CREATE TABLE IF NOT EXISTS bill_preferences (
        id TEXT PRIMARY KEY,
        recurringItemId TEXT NOT NULL,
        preferredDueDay INTEGER,
        notes TEXT,
        FOREIGN KEY (recurringItemId) REFERENCES recurring_items(id) ON DELETE CASCADE
      );

      -- Phase 5: Net Worth Integration (v1.1)
      CREATE TABLE IF NOT EXISTS manual_assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('property', 'vehicle', 'valuables', 'other', 'custom')),
        custom_category TEXT,
        value INTEGER NOT NULL DEFAULT 0,
        liquidity TEXT NOT NULL CHECK(liquidity IN ('liquid', 'illiquid')),
        notes TEXT,
        reminder_frequency TEXT CHECK(reminder_frequency IN ('monthly', 'quarterly', 'yearly')),
        last_reminder_date INTEGER,
        next_reminder_date INTEGER,
        last_updated INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS manual_liabilities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('mortgage', 'auto_loan', 'student_loan', 'personal_loan', 'credit_card', 'other')),
        balance INTEGER NOT NULL DEFAULT 0,
        interest_rate REAL NOT NULL DEFAULT 0,
        monthly_payment INTEGER NOT NULL DEFAULT 0,
        original_amount INTEGER,
        start_date INTEGER,
        term_months INTEGER,
        payoff_date INTEGER,
        total_interest INTEGER,
        last_updated INTEGER NOT NULL,
        notes TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS net_worth_snapshots (
        id TEXT PRIMARY KEY,
        date INTEGER NOT NULL,
        bank_accounts_total INTEGER NOT NULL DEFAULT 0,
        investment_accounts_total INTEGER NOT NULL DEFAULT 0,
        manual_assets_total INTEGER NOT NULL DEFAULT 0,
        total_assets INTEGER NOT NULL DEFAULT 0,
        manual_liabilities_total INTEGER NOT NULL DEFAULT 0,
        total_liabilities INTEGER NOT NULL DEFAULT 0,
        net_worth INTEGER NOT NULL DEFAULT 0,
        asset_breakdown TEXT NOT NULL DEFAULT '{}',
        liability_breakdown TEXT NOT NULL DEFAULT '{}',
        change_from_previous INTEGER,
        change_percent_from_previous REAL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS asset_value_history (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        value INTEGER NOT NULL,
        date INTEGER NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('manual', 'reminder')),
        created_at INTEGER NOT NULL,
        FOREIGN KEY (asset_id) REFERENCES manual_assets(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS liability_value_history (
        id TEXT PRIMARY KEY,
        liability_id TEXT NOT NULL,
        balance INTEGER NOT NULL,
        date INTEGER NOT NULL,
        payment_amount INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (liability_id) REFERENCES manual_liabilities(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_date ON net_worth_snapshots(date);
      CREATE INDEX IF NOT EXISTS idx_asset_history_asset ON asset_value_history(asset_id);
      CREATE INDEX IF NOT EXISTS idx_asset_history_date ON asset_value_history(date);
      CREATE INDEX IF NOT EXISTS idx_liability_history_liability ON liability_value_history(liability_id);
      CREATE INDEX IF NOT EXISTS idx_liability_history_date ON liability_value_history(date);

      -- Reimbursement linking
      CREATE TABLE IF NOT EXISTS transaction_reimbursements (
        id TEXT PRIMARY KEY,
        expenseTransactionId TEXT NOT NULL,
        reimbursementTransactionId TEXT NOT NULL,
        amount REAL NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (expenseTransactionId) REFERENCES transactions(id) ON DELETE CASCADE,
        FOREIGN KEY (reimbursementTransactionId) REFERENCES transactions(id) ON DELETE CASCADE,
        UNIQUE(expenseTransactionId, reimbursementTransactionId)
      );

      CREATE INDEX IF NOT EXISTS idx_reimbursements_expense ON transaction_reimbursements(expenseTransactionId);
      CREATE INDEX IF NOT EXISTS idx_reimbursements_income ON transaction_reimbursements(reimbursementTransactionId);

      -- Saved Reports
      CREATE TABLE IF NOT EXISTS saved_reports (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        config TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        lastAccessedAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_saved_reports_lastAccessed ON saved_reports(lastAccessedAt);

      -- Phase 8: Transaction Attachments
      CREATE TABLE IF NOT EXISTS transaction_attachments (
        id TEXT PRIMARY KEY,
        transactionId TEXT NOT NULL,
        filename TEXT NOT NULL,
        filePath TEXT NOT NULL,
        mimeType TEXT NOT NULL,
        fileSize INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (transactionId) REFERENCES transactions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_attachments_transaction ON transaction_attachments(transactionId);

      -- Encryption: User key pairs
      CREATE TABLE IF NOT EXISTS user_keys (
        userId TEXT PRIMARY KEY,
        publicKey TEXT NOT NULL,
        encryptedPrivateKey TEXT NOT NULL,
        privateKeyIv TEXT NOT NULL,
        privateKeyTag TEXT NOT NULL,
        encryptionSalt TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      );

      -- Encryption: Data encryption keys (per entity)
      CREATE TABLE IF NOT EXISTS data_encryption_keys (
        id TEXT NOT NULL,
        entityType TEXT NOT NULL,
        ownerId TEXT NOT NULL,
        wrappedDek TEXT NOT NULL,
        dekIv TEXT NOT NULL,
        dekTag TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        PRIMARY KEY (id, entityType)
      );

      -- Encryption: Data shares (shared access to encrypted entities)
      CREATE TABLE IF NOT EXISTS data_shares (
        id TEXT PRIMARY KEY,
        entityId TEXT NOT NULL,
        entityType TEXT NOT NULL,
        ownerId TEXT NOT NULL,
        recipientId TEXT NOT NULL,
        wrappedDek TEXT NOT NULL,
        permissions TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_data_shares_entity ON data_shares(entityId, entityType);
      CREATE INDEX IF NOT EXISTS idx_data_shares_recipient ON data_shares(recipientId);
      CREATE INDEX IF NOT EXISTS idx_data_shares_owner ON data_shares(ownerId);

      -- Encryption: Sharing defaults (auto-share rules)
      CREATE TABLE IF NOT EXISTS sharing_defaults (
        id TEXT PRIMARY KEY,
        ownerId TEXT NOT NULL,
        recipientId TEXT NOT NULL,
        entityType TEXT NOT NULL,
        permissions TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        UNIQUE(ownerId, recipientId, entityType)
      );

      -- Enhanced Automation Rule Actions
      CREATE TABLE IF NOT EXISTS automation_rule_actions (
        id TEXT PRIMARY KEY,
        ruleId TEXT NOT NULL REFERENCES category_rules(id) ON DELETE CASCADE,
        actionType TEXT NOT NULL CHECK(actionType IN ('assign_category','add_tag','hide_from_reports','mark_transfer')),
        actionValue TEXT,
        createdAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_automation_actions_rule ON automation_rule_actions(ruleId);

      -- Paycheck-Based Budgeting
      CREATE TABLE IF NOT EXISTS paycheck_allocations (
        id TEXT PRIMARY KEY,
        incomeStreamId TEXT NOT NULL,
        incomeDescription TEXT NOT NULL,
        allocationType TEXT NOT NULL CHECK(allocationType IN ('recurring_item','budget_category','savings_goal')),
        targetId TEXT NOT NULL,
        amount INTEGER NOT NULL,
        createdAt INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_paycheck_alloc_stream ON paycheck_allocations(incomeStreamId);

      -- Additional indexes for performance
      CREATE INDEX IF NOT EXISTS idx_transaction_tags_transaction ON transaction_tags(transactionId);
      CREATE INDEX IF NOT EXISTS idx_transaction_tags_tag ON transaction_tags(tagId);
      CREATE INDEX IF NOT EXISTS idx_transaction_splits_parent ON transaction_splits(parentTransactionId);
      CREATE INDEX IF NOT EXISTS idx_budget_goals_category ON budget_goals(categoryId);
      CREATE INDEX IF NOT EXISTS idx_spending_alerts_category ON spending_alerts(categoryId);
      CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON bill_payments(billId);
      CREATE INDEX IF NOT EXISTS idx_savings_contributions_goal ON savings_contributions(goalId);
      CREATE INDEX IF NOT EXISTS idx_investment_history_investment ON investment_history(investmentId);
      CREATE INDEX IF NOT EXISTS idx_receipts_transaction ON receipts(transactionId);
      CREATE INDEX IF NOT EXISTS idx_seasonal_patterns_category ON seasonal_patterns(categoryId);
      CREATE INDEX IF NOT EXISTS idx_financial_health_history_date ON financial_health_history(date);
    `);

    // Insert default categories if they don't exist
    this.insertDefaultCategories();
  }

  private insertDefaultCategories(): void {
    const existingCategories = this.driver.get<{ count: number }>('SELECT COUNT(*) as count FROM categories');

    if (existingCategories!.count === 0) {
      const defaultCategories = [
        // Income categories
        { name: 'Income', type: 'income', icon: '💰', color: '#4CAF50', isDefault: 1 },
        { name: 'Salary', type: 'income', icon: '💼', color: '#8BC34A', isDefault: 1 },
        { name: 'Freelance', type: 'income', icon: '📝', color: '#66BB6A', isDefault: 1 },
        { name: 'Investments', type: 'income', icon: '📈', color: '#00BCD4', isDefault: 1 },
        { name: 'Refunds', type: 'income', icon: '↩️', color: '#009688', isDefault: 1 },
        { name: 'Tax Refund', type: 'income', icon: '📋', color: '#43A047', isDefault: 1 },
        { name: 'Reimbursement', type: 'income', icon: '💵', color: '#26A69A', isDefault: 1 },
        { name: 'Other Income', type: 'income', icon: '💵', color: '#607D8B', isDefault: 1 },

        // Expense categories
        { name: 'Groceries', type: 'expense', icon: '🛒', color: '#FF9800', isDefault: 1 },
        { name: 'Dining Out', type: 'expense', icon: '🍽️', color: '#FF5722', isDefault: 1 },
        { name: 'Rent', type: 'expense', icon: '🏠', color: '#9C27B0', isDefault: 1 },
        { name: 'Utilities', type: 'expense', icon: '💡', color: '#673AB7', isDefault: 1 },
        { name: 'Fuel', type: 'expense', icon: '⛽', color: '#795548', isDefault: 1 },
        { name: 'Transportation', type: 'expense', icon: '🚗', color: '#3F51B5', isDefault: 1 },
        { name: 'Healthcare', type: 'expense', icon: '⚕️', color: '#E91E63', isDefault: 1 },
        { name: 'Entertainment', type: 'expense', icon: '🎬', color: '#9C27B0', isDefault: 1 },
        { name: 'Shopping', type: 'expense', icon: '🛍️', color: '#F44336', isDefault: 1 },
        { name: 'Subscriptions', type: 'expense', icon: '📱', color: '#00BCD4', isDefault: 1 },
        
        // Travel/Special categories
        { name: 'Vacation', type: 'expense', icon: '✈️', color: '#00BCD4', isDefault: 1 },
        { name: 'Holidays', type: 'expense', icon: '🎄', color: '#E91E63', isDefault: 1 },

        // Personal categories
        { name: 'Insurance', type: 'expense', icon: '🛡️', color: '#5C6BC0', isDefault: 1 },
        { name: 'Education', type: 'expense', icon: '📚', color: '#7E57C2', isDefault: 1 },
        { name: 'Childcare', type: 'expense', icon: '👶', color: '#EC407A', isDefault: 1 },
        { name: 'Pets', type: 'expense', icon: '🐕', color: '#8D6E63', isDefault: 1 },
        { name: 'Personal Care', type: 'expense', icon: '💇', color: '#AB47BC', isDefault: 1 },
        { name: 'Gifts', type: 'expense', icon: '🎁', color: '#EF5350', isDefault: 1 },
        { name: 'Charity', type: 'expense', icon: '❤️', color: '#E91E63', isDefault: 1 },
        { name: 'Fitness', type: 'expense', icon: '🏋️', color: '#66BB6A', isDefault: 1 },
        { name: 'Home Improvement', type: 'expense', icon: '🔧', color: '#FF7043', isDefault: 1 },
        { name: 'Clothing', type: 'expense', icon: '👔', color: '#42A5F5', isDefault: 1 },

        // Transfer/Savings categories (treated as expense for accounting)
        { name: 'Savings', type: 'expense', icon: '🏦', color: '#2196F3', isDefault: 1 },
        { name: 'Transfer', type: 'expense', icon: '🔄', color: '#607D8B', isDefault: 1 },
        { name: 'Credit Card Payment', type: 'expense', icon: '💳', color: '#5E35B1', isDefault: 1 },

        // Uncategorized
        { name: 'Uncategorized', type: 'expense', icon: '❓', color: '#9E9E9E', isDefault: 1 },
      ];

      for (const cat of defaultCategories) {
        this.driver.run(`
          INSERT INTO categories (id, name, type, icon, color, isDefault, parentId)
          VALUES (?, ?, ?, ?, ?, ?, NULL)
        `, [randomUUID(), cat.name, cat.type, cat.icon, cat.color, cat.isDefault]);
      }
    }
  }

  // User operations (household support)
  getUsers(): User[] {
    const rows = this.driver.all<UserRow>('SELECT * FROM users ORDER BY isDefault DESC, createdAt ASC');
    return rows.map(this.mapUser);
  }

  getUserById(id: string): User | null {
    const row = this.driver.get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
    return row ? this.mapUser(row) : null;
  }

  getDefaultUser(): User {
    const row = this.driver.get<UserRow>('SELECT * FROM users WHERE isDefault = 1');
    if (row) return this.mapUser(row);
    const fallback = this.driver.get<UserRow>('SELECT * FROM users ORDER BY createdAt ASC LIMIT 1');
    return this.mapUser(fallback!);
  }

  createUser(name: string, color: string): User {
    const id = randomUUID();
    const createdAt = Date.now();
    this.driver.run(
      'INSERT INTO users (id, name, color, isDefault, createdAt) VALUES (?, ?, ?, ?, ?)',
      [id, name, color, 0, createdAt]
    );
    return this.getUserById(id)!;
  }

  updateUser(id: string, updates: Partial<Omit<User, 'id' | 'createdAt'>>): User | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.color !== undefined) {
      fields.push('color = ?');
      values.push(updates.color);
    }
    if (updates.isDefault !== undefined) {
      if (updates.isDefault) {
        this.driver.run('UPDATE users SET isDefault = 0');
      }
      fields.push('isDefault = ?');
      values.push(updates.isDefault ? 1 : 0);
    }

    if (fields.length === 0) return this.getUserById(id);

    values.push(id);
    this.driver.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    return this.getUserById(id);
  }

  deleteUser(id: string): boolean {
    const user = this.getUserById(id);
    if (!user || user.isDefault) return false;

    // Cascade-delete encryption data
    this.driver.run('DELETE FROM user_keys WHERE userId = ?', [id]);
    this.driver.run('DELETE FROM data_encryption_keys WHERE ownerId = ?', [id]);
    this.driver.run('DELETE FROM data_shares WHERE ownerId = ? OR recipientId = ?', [id, id]);
    this.driver.run('DELETE FROM sharing_defaults WHERE ownerId = ? OR recipientId = ?', [id, id]);

    const result = this.driver.run('DELETE FROM users WHERE id = ? AND isDefault = 0', [id]);
    return result.changes > 0;
  }

  private mapUser(row: UserRow): User {
    return {
      id: row.id,
      name: row.name,
      color: row.color,
      isDefault: row.isDefault === 1,
      createdAt: new Date(row.createdAt),
    };
  }

  // Account operations
  createAccount(account: Omit<Account, 'id' | 'createdAt'>): Account {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO accounts (id, name, type, institution, balance, lastSynced, createdAt, ofxUrl, ofxOrg, ofxFid, ofxUsername, ofxAccountId, ownership, ownerId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      account.name,
      account.type,
      account.institution,
      account.balance,
      account.lastSynced ? account.lastSynced.getTime() : null,
      createdAt,
      account.ofxUrl ?? null,
      account.ofxOrg ?? null,
      account.ofxFid ?? null,
      account.ofxUsername ?? null,
      account.ofxAccountId ?? null,
      account.ownership ?? 'mine',
      account.ownerId ?? null
    ]);

    return this.getAccountById(id)!;
  }

  getAccounts(): Account[] {
    const rows = this.driver.all('SELECT * FROM accounts ORDER BY createdAt DESC');
    return rows.map(this.mapAccount);
  }

  getAccountById(id: string): Account | null {
    const row = this.driver.get('SELECT * FROM accounts WHERE id = ?', [id]);
    return row ? this.mapAccount(row) : null;
  }

  updateAccount(id: string, updates: Partial<Omit<Account, 'id' | 'createdAt'>>): Account | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      values.push(updates.type);
    }
    if (updates.institution !== undefined) {
      fields.push('institution = ?');
      values.push(updates.institution);
    }
    if (updates.balance !== undefined) {
      fields.push('balance = ?');
      values.push(updates.balance);
    }
    if (updates.lastSynced !== undefined) {
      fields.push('lastSynced = ?');
      values.push(updates.lastSynced ? updates.lastSynced.getTime() : null);
    }
    if (updates.ofxUrl !== undefined) {
      fields.push('ofxUrl = ?');
      values.push(updates.ofxUrl);
    }
    if (updates.ofxOrg !== undefined) {
      fields.push('ofxOrg = ?');
      values.push(updates.ofxOrg);
    }
    if (updates.ofxFid !== undefined) {
      fields.push('ofxFid = ?');
      values.push(updates.ofxFid);
    }
    if (updates.ofxUsername !== undefined) {
      fields.push('ofxUsername = ?');
      values.push(updates.ofxUsername);
    }
    if (updates.ofxAccountId !== undefined) {
      fields.push('ofxAccountId = ?');
      values.push(updates.ofxAccountId);
    }
    if (updates.ownership !== undefined) {
      fields.push('ownership = ?');
      values.push(updates.ownership);
    }
    if (updates.ownerId !== undefined) {
      fields.push('ownerId = ?');
      values.push(updates.ownerId);
    }

    if (fields.length === 0) return this.getAccountById(id);

    values.push(id);
    this.driver.run(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getAccountById(id);
  }

  deleteAccount(id: string): boolean {
    const result = this.driver.run('DELETE FROM accounts WHERE id = ?', [id]);
    return result.changes > 0;
  }

  // Transaction operations
  createTransaction(transaction: Omit<Transaction, 'id' | 'createdAt'>): Transaction {
    const id = randomUUID();
    const createdAt = Date.now();

    // Force isInternalTransfer for savings accounts
    const account = this.getAccountById(transaction.accountId);
    const isSavingsAccount = account?.type === 'savings';
    const isInternalTransfer = isSavingsAccount || (transaction.isInternalTransfer ?? false);

    this.driver.run(`
      INSERT INTO transactions (id, accountId, date, description, amount, categoryId, isRecurring, importSource, createdAt, fitId, isInternalTransfer)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id,
      transaction.accountId,
      transaction.date.getTime(),
      transaction.description,
      transaction.amount,
      transaction.categoryId ?? null,
      transaction.isRecurring ? 1 : 0,
      transaction.importSource,
      createdAt,
      transaction.fitId ?? null,
      isInternalTransfer ? 1 : 0]);

    // Auto-create contribution for pinned savings goals
    // Note: balance sync is handled at the IPC layer (encryption-aware)
    if (isSavingsAccount) {
      const goal = this.getSavingsGoalByAccountId(transaction.accountId);
      if (goal) {
        this.createContributionFromTransaction(goal.id, id);
      }
    }

    return this.getTransactionById(id)!;
  }

  getTransactionByFitId(fitId: string): Transaction | null {
    const row = this.driver.get('SELECT * FROM transactions WHERE fitId = ?', [fitId]);
    return row ? this.mapTransaction(row) : null;
  }

  getTransactions(): Transaction[] {
    const rows = this.driver.all('SELECT * FROM transactions ORDER BY date DESC');
    return rows.map(this.mapTransaction);
  }

  getTransactionsByAccount(accountId: string): Transaction[] {
    const rows = this.driver.all('SELECT * FROM transactions WHERE accountId = ? ORDER BY date DESC', [accountId]);
    return rows.map(this.mapTransaction);
  }

  getTransactionById(id: string): Transaction | null {
    const row = this.driver.get('SELECT * FROM transactions WHERE id = ?', [id]);
    return row ? this.mapTransaction(row) : null;
  }

  updateTransaction(id: string, updates: Partial<Omit<Transaction, 'id' | 'createdAt'>>): Transaction | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.accountId !== undefined) {
      fields.push('accountId = ?');
      values.push(updates.accountId);
    }
    if (updates.date !== undefined) {
      fields.push('date = ?');
      values.push(updates.date.getTime());
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.amount !== undefined) {
      fields.push('amount = ?');
      values.push(updates.amount);
    }
    if (updates.categoryId !== undefined) {
      fields.push('categoryId = ?');
      values.push(updates.categoryId);
    }
    if (updates.isRecurring !== undefined) {
      fields.push('isRecurring = ?');
      values.push(updates.isRecurring ? 1 : 0);
    }
    if (updates.importSource !== undefined) {
      fields.push('importSource = ?');
      values.push(updates.importSource);
    }
    if (updates.isInternalTransfer !== undefined) {
      fields.push('isInternalTransfer = ?');
      values.push(updates.isInternalTransfer ? 1 : 0);
    }
    if (updates.notes !== undefined) {
      fields.push('notes = ?');
      values.push(updates.notes);
    }
    if (updates.isHidden !== undefined) {
      fields.push('isHidden = ?');
      values.push(updates.isHidden ? 1 : 0);
    }

    if (fields.length === 0) return this.getTransactionById(id);

    values.push(id);
    this.driver.run(`UPDATE transactions SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getTransactionById(id);
  }

  deleteTransaction(id: string): boolean {
    const result = this.driver.run('DELETE FROM transactions WHERE id = ?', [id]);
    return result.changes > 0;
  }

  bulkDeleteTransactions(ids: string[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const result = this.driver.run(
      `DELETE FROM transactions WHERE id IN (${placeholders})`
    , ids);
    return result.changes;
  }

  bulkUpdateCategoryByIds(ids: string[], categoryId: string | null): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const result = this.driver.run(
      `UPDATE transactions SET categoryId = ? WHERE id IN (${placeholders})`
    , [categoryId, ...ids]);
    return result.changes;
  }

  /**
   * Update the category for all transactions matching a pattern
   * Optionally creates a categorization rule for future imports
   * @param pattern - The regex/LIKE pattern to match (e.g., "amazon" matches any description containing "amazon")
   * @param categoryId - The category to assign
   * @param createRule - Whether to create a rule for future imports
   */
  bulkUpdateCategoryByPattern(
    pattern: string,
    categoryId: string,
    createRule: boolean = false,
    filterCategoryId: string | null = null // null = all, 'uncategorized' = only uncategorized, or specific categoryId
  ): { updated: number; ruleCreated: boolean } {
    // Use LIKE for pattern matching (% is wildcard)
    // Wrap pattern with % to match anywhere in description
    const likePattern = `%${pattern.toLowerCase()}%`;
    
    let result;
    if (filterCategoryId === 'uncategorized') {
      // Only update transactions without a category or with 'Uncategorized'
      const uncategorizedCat = this.driver.get<{ id: string }>(
        "SELECT id FROM categories WHERE LOWER(name) = 'uncategorized'"
      );

      if (uncategorizedCat) {
        result = this.driver.run(
          'UPDATE transactions SET categoryId = ? WHERE LOWER(description) LIKE ? AND (categoryId IS NULL OR categoryId = ?)'
        , [categoryId, likePattern, uncategorizedCat.id]);
      } else {
        result = this.driver.run(
          'UPDATE transactions SET categoryId = ? WHERE LOWER(description) LIKE ? AND categoryId IS NULL'
        , [categoryId, likePattern]);
      }
    } else if (filterCategoryId) {
      // Only update transactions with a specific current category
      result = this.driver.run(
        'UPDATE transactions SET categoryId = ? WHERE LOWER(description) LIKE ? AND categoryId = ?'
      , [categoryId, likePattern, filterCategoryId]);
    } else {
      // Update all matching transactions
      result = this.driver.run(
        'UPDATE transactions SET categoryId = ? WHERE LOWER(description) LIKE ?'
      , [categoryId, likePattern]);
    }

    let ruleCreated = false;

    // Optionally create a categorization rule
    if (createRule && pattern.trim()) {
      // Check if a rule for this pattern already exists
      const existingRule = this.driver.get(
        'SELECT * FROM category_rules WHERE LOWER(pattern) = LOWER(?)'
      , [pattern.toLowerCase()]);

      if (!existingRule) {
        this.createCategoryRule({
          pattern: pattern.toLowerCase(),
          categoryId,
          priority: 60, // Medium-high priority for user-created rules
        });
        ruleCreated = true;
      }
    }

    return { updated: result.changes, ruleCreated };
  }

  /**
   * Get the count of transactions matching a pattern
   * @param pattern - The pattern to match (matches anywhere in description)
   * @param filterCategoryId - Optional filter: null = all, 'uncategorized' = only uncategorized, or specific categoryId
   */
  getTransactionCountByPattern(pattern: string, filterCategoryId: string | null = null): number {
    const likePattern = `%${pattern.toLowerCase()}%`;

    if (filterCategoryId === 'uncategorized') {
      const uncategorizedCat = this.driver.get<{ id: string }>(
        "SELECT id FROM categories WHERE LOWER(name) = 'uncategorized'"
      );

      if (uncategorizedCat) {
        const result = this.driver.get<{ count: number }>(
          'SELECT COUNT(*) as count FROM transactions WHERE LOWER(description) LIKE ? AND (categoryId IS NULL OR categoryId = ?)'
        , [likePattern, uncategorizedCat.id]);
        return result!.count;
      } else {
        const result = this.driver.get<{ count: number }>(
          'SELECT COUNT(*) as count FROM transactions WHERE LOWER(description) LIKE ? AND categoryId IS NULL'
        , [likePattern]);
        return result!.count;
      }
    } else if (filterCategoryId) {
      const result = this.driver.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM transactions WHERE LOWER(description) LIKE ? AND categoryId = ?'
      , [likePattern, filterCategoryId]);
      return result!.count;
    } else {
      const result = this.driver.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM transactions WHERE LOWER(description) LIKE ?'
      , [likePattern]);
      return result!.count;
    }
  }

  /**
   * Get sample transactions matching a pattern (for preview)
   * @param pattern - The pattern to match
   * @param limit - Max number of samples to return
   * @param filterCategoryId - Optional filter: null = all, 'uncategorized' = only uncategorized, or specific categoryId
   */
  getTransactionSamplesByPattern(pattern: string, limit: number = 5, filterCategoryId: string | null = null): Transaction[] {
    const likePattern = `%${pattern.toLowerCase()}%`;

    let rows;
    if (filterCategoryId === 'uncategorized') {
      const uncategorizedCat = this.driver.get<{ id: string }>(
        "SELECT id FROM categories WHERE LOWER(name) = 'uncategorized'"
      );

      if (uncategorizedCat) {
        rows = this.driver.all(
          'SELECT * FROM transactions WHERE LOWER(description) LIKE ? AND (categoryId IS NULL OR categoryId = ?) ORDER BY date DESC LIMIT ?'
        , [likePattern, uncategorizedCat.id, limit]);
      } else {
        rows = this.driver.all(
          'SELECT * FROM transactions WHERE LOWER(description) LIKE ? AND categoryId IS NULL ORDER BY date DESC LIMIT ?'
        , [likePattern, limit]);
      }
    } else if (filterCategoryId) {
      rows = this.driver.all(
        'SELECT * FROM transactions WHERE LOWER(description) LIKE ? AND categoryId = ? ORDER BY date DESC LIMIT ?'
      , [likePattern, filterCategoryId, limit]);
    } else {
      rows = this.driver.all(
        'SELECT * FROM transactions WHERE LOWER(description) LIKE ? ORDER BY date DESC LIMIT ?'
      , [likePattern, limit]);
    }
    return rows.map((row) => this.mapTransaction(row));
  }

  // Category operations
  createCategory(category: Omit<Category, 'id'>): Category {
    const id = randomUUID();

    this.driver.run(`
      INSERT INTO categories (id, name, type, icon, color, isDefault, parentId)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id,
      category.name,
      category.type,
      category.icon ?? null,
      category.color ?? null,
      category.isDefault ? 1 : 0,
      category.parentId ?? null]);

    return this.getCategoryById(id)!;
  }

  /**
   * Add missing default categories to an existing database.
   * This is useful for existing users when new categories are added.
   */
  addMissingDefaultCategories(): { added: string[] } {
    const defaultCategories = [
      // Income categories
      { name: 'Income', type: 'income', icon: '💰', color: '#4CAF50', isDefault: true },
      { name: 'Salary', type: 'income', icon: '💼', color: '#8BC34A', isDefault: true },
      { name: 'Freelance', type: 'income', icon: '📝', color: '#66BB6A', isDefault: true },
      { name: 'Investments', type: 'income', icon: '📈', color: '#00BCD4', isDefault: true },
      { name: 'Refunds', type: 'income', icon: '↩️', color: '#009688', isDefault: true },
      { name: 'Tax Refund', type: 'income', icon: '📋', color: '#43A047', isDefault: true },
      { name: 'Reimbursement', type: 'income', icon: '💵', color: '#26A69A', isDefault: true },
      { name: 'Other Income', type: 'income', icon: '💵', color: '#607D8B', isDefault: true },

      // Expense categories
      { name: 'Groceries', type: 'expense', icon: '🛒', color: '#FF9800', isDefault: true },
      { name: 'Dining Out', type: 'expense', icon: '🍽️', color: '#FF5722', isDefault: true },
      { name: 'Rent', type: 'expense', icon: '🏠', color: '#9C27B0', isDefault: true },
      { name: 'Utilities', type: 'expense', icon: '💡', color: '#673AB7', isDefault: true },
      { name: 'Fuel', type: 'expense', icon: '⛽', color: '#795548', isDefault: true },
      { name: 'Transportation', type: 'expense', icon: '🚗', color: '#3F51B5', isDefault: true },
      { name: 'Healthcare', type: 'expense', icon: '⚕️', color: '#E91E63', isDefault: true },
      { name: 'Entertainment', type: 'expense', icon: '🎬', color: '#9C27B0', isDefault: true },
      { name: 'Shopping', type: 'expense', icon: '🛍️', color: '#F44336', isDefault: true },
      { name: 'Subscriptions', type: 'expense', icon: '📱', color: '#00BCD4', isDefault: true },

      // Travel/Special categories
      { name: 'Vacation', type: 'expense', icon: '✈️', color: '#00BCD4', isDefault: true },
      { name: 'Holidays', type: 'expense', icon: '🎄', color: '#E91E63', isDefault: true },

      // Personal categories
      { name: 'Insurance', type: 'expense', icon: '🛡️', color: '#5C6BC0', isDefault: true },
      { name: 'Education', type: 'expense', icon: '📚', color: '#7E57C2', isDefault: true },
      { name: 'Childcare', type: 'expense', icon: '👶', color: '#EC407A', isDefault: true },
      { name: 'Pets', type: 'expense', icon: '🐕', color: '#8D6E63', isDefault: true },
      { name: 'Personal Care', type: 'expense', icon: '💇', color: '#AB47BC', isDefault: true },
      { name: 'Gifts', type: 'expense', icon: '🎁', color: '#EF5350', isDefault: true },
      { name: 'Charity', type: 'expense', icon: '❤️', color: '#E91E63', isDefault: true },
      { name: 'Fitness', type: 'expense', icon: '🏋️', color: '#66BB6A', isDefault: true },
      { name: 'Home Improvement', type: 'expense', icon: '🔧', color: '#FF7043', isDefault: true },
      { name: 'Clothing', type: 'expense', icon: '👔', color: '#42A5F5', isDefault: true },

      // Transfer/Savings categories
      { name: 'Savings', type: 'expense', icon: '🏦', color: '#2196F3', isDefault: true },
      { name: 'Transfer', type: 'expense', icon: '🔄', color: '#607D8B', isDefault: true },
      { name: 'Credit Card Payment', type: 'expense', icon: '💳', color: '#5E35B1', isDefault: true },

      // Uncategorized
      { name: 'Uncategorized', type: 'expense', icon: '❓', color: '#9E9E9E', isDefault: true },
    ];

    const existingCategories = this.getCategories();
    const existingNames = new Set(existingCategories.map(c => c.name.toLowerCase()));
    const added: string[] = [];

    for (const cat of defaultCategories) {
      if (!existingNames.has(cat.name.toLowerCase())) {
        this.createCategory({
          name: cat.name,
          type: cat.type as 'income' | 'expense',
          icon: cat.icon,
          color: cat.color,
          isDefault: cat.isDefault,
          parentId: null,
        });
        added.push(cat.name);
      }
    }

    return { added };
  }

  getCategories(): Category[] {
    const rows = this.driver.all('SELECT * FROM categories ORDER BY isDefault DESC, name ASC');
    return rows.map(this.mapCategory);
  }

  getCategoryById(id: string): Category | null {
    const row = this.driver.get('SELECT * FROM categories WHERE id = ?', [id]);
    return row ? this.mapCategory(row) : null;
  }

  updateCategory(id: string, updates: Partial<Omit<Category, 'id'>>): Category | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      values.push(updates.type);
    }
    if (updates.icon !== undefined) {
      fields.push('icon = ?');
      values.push(updates.icon);
    }
    if (updates.color !== undefined) {
      fields.push('color = ?');
      values.push(updates.color);
    }
    if (updates.isDefault !== undefined) {
      fields.push('isDefault = ?');
      values.push(updates.isDefault ? 1 : 0);
    }
    if (updates.parentId !== undefined) {
      fields.push('parentId = ?');
      values.push(updates.parentId);
    }

    if (fields.length === 0) return this.getCategoryById(id);

    values.push(id);
    this.driver.run(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getCategoryById(id);
  }

  deleteCategory(id: string): boolean {
    const result = this.driver.run('DELETE FROM categories WHERE id = ?', [id]);
    return result.changes > 0;
  }

  // Helper methods to map database rows to TypeScript objects
  private mapAccount(row: unknown): Account {
    const r = row as AccountRow;
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      institution: r.institution,
      balance: r.balance,
      lastSynced: r.lastSynced ? new Date(r.lastSynced) : null,
      createdAt: new Date(r.createdAt),
      ofxUrl: r.ofxUrl,
      ofxOrg: r.ofxOrg,
      ofxFid: r.ofxFid,
      ofxUsername: r.ofxUsername,
      ofxAccountId: r.ofxAccountId,
      ownership: (r.ownership as OwnershipType) || 'mine',
      ownerId: r.ownerId,
      isEncrypted: r.isEncrypted === 1,
    };
  }

  private mapTransaction(row: unknown): Transaction {
    const r = row as TransactionRow;
    return {
      id: r.id,
      accountId: r.accountId,
      date: new Date(r.date),
      description: r.description,
      amount: r.amount,
      categoryId: r.categoryId,
      isRecurring: r.isRecurring === 1,
      importSource: r.importSource,
      createdAt: new Date(r.createdAt),
      fitId: r.fitId,
      isInternalTransfer: r.isInternalTransfer === 1,
      notes: r.notes || null,
      isHidden: r.isHidden === 1,
    };
  }

  // Category Rules CRUD operations
  createCategoryRule(rule: Omit<CategoryRule, 'id' | 'createdAt'>): CategoryRule {
    // Check for existing rule with same pattern (case-insensitive)
    const existing = this.driver.get<{ id: string; priority: number }>(
      'SELECT id, priority FROM category_rules WHERE LOWER(pattern) = LOWER(?)'
    , [rule.pattern]);

    if (existing) {
      // Upsert: update categoryId and keep the higher priority
      this.driver.run(
        'UPDATE category_rules SET categoryId = ?, priority = MAX(priority, ?) WHERE id = ?'
      , [rule.categoryId, rule.priority, existing.id]);
      return this.getCategoryRuleById(existing.id)!;
    }

    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO category_rules (id, pattern, categoryId, priority, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `, [id,
      rule.pattern,
      rule.categoryId,
      rule.priority,
      createdAt]);

    return this.getCategoryRuleById(id)!;
  }

  getCategoryRules(): CategoryRule[] {
    const rows = this.driver.all('SELECT * FROM category_rules ORDER BY priority DESC');
    return rows.map(this.mapCategoryRule);
  }

  getCategoryRuleById(id: string): CategoryRule | null {
    const row = this.driver.get('SELECT * FROM category_rules WHERE id = ?', [id]);
    return row ? this.mapCategoryRule(row) : null;
  }

  updateCategoryRule(id: string, updates: Partial<Omit<CategoryRule, 'id' | 'createdAt'>>): CategoryRule | null {
    // If pattern is changing, check for conflicts with other rules
    if (updates.pattern !== undefined) {
      const conflict = this.driver.get<{ id: string }>(
        'SELECT id FROM category_rules WHERE LOWER(pattern) = LOWER(?) AND id != ?'
      , [updates.pattern, id]);

      if (conflict) {
        // Merge: delete the conflicting rule, then proceed with update
        this.driver.run('DELETE FROM category_rules WHERE id = ?', [conflict.id]);
      }
    }

    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.pattern !== undefined) {
      fields.push('pattern = ?');
      values.push(updates.pattern);
    }
    if (updates.categoryId !== undefined) {
      fields.push('categoryId = ?');
      values.push(updates.categoryId);
    }
    if (updates.priority !== undefined) {
      fields.push('priority = ?');
      values.push(updates.priority);
    }

    if (fields.length === 0) {
      return this.getCategoryRuleById(id);
    }

    values.push(id);
    const query = `UPDATE category_rules SET ${fields.join(', ')} WHERE id = ?`;
    this.driver.run(query, values);

    return this.getCategoryRuleById(id);
  }

  deleteCategoryRule(id: string): boolean {
    const result = this.driver.run('DELETE FROM category_rules WHERE id = ?', [id]);
    return result.changes > 0;
  }

  private mapCategory(row: unknown): Category {
    const r = row as CategoryRow;
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      icon: r.icon ?? undefined,
      color: r.color ?? undefined,
      isDefault: r.isDefault === 1,
      parentId: r.parentId,
    };
  }

  private mapCategoryRule(row: unknown): CategoryRule {
    const r = row as CategoryRuleRow;
    return {
      id: r.id,
      pattern: r.pattern,
      categoryId: r.categoryId,
      priority: r.priority,
      createdAt: new Date(r.createdAt),
    };
  }

  // Analytics methods
  getSpendingByCategory(startDate?: Date, endDate?: Date): Array<{ categoryId: string; categoryName: string; total: number; count: number; color: string }> {
    let query = `
      SELECT
        c.id as categoryId,
        c.name as categoryName,
        c.color as color,
        SUM(t.amount + COALESCE((SELECT SUM(tr.amount) FROM transaction_reimbursements tr WHERE tr.expenseTransactionId = t.id), 0)) as total,
        COUNT(t.id) as count
      FROM transactions t
      LEFT JOIN categories c ON t.categoryId = c.id
      WHERE t.amount < 0
        AND (t.isInternalTransfer IS NULL OR t.isInternalTransfer = 0)
        AND (t.isHidden IS NULL OR t.isHidden = 0)
        AND t.id NOT IN (SELECT reimbursementTransactionId FROM transaction_reimbursements)
        AND c.id NOT IN (
          SELECT id FROM categories
          WHERE LOWER(name) IN ('transfer', 'transfers', 'savings', 'internal transfer')
        )
    `;

    const params: number[] = [];

    if (startDate) {
      query += ' AND t.date >= ?';
      params.push(startDate.getTime());
    }

    if (endDate) {
      query += ' AND t.date <= ?';
      params.push(endDate.getTime());
    }

    query += ' GROUP BY c.id, c.name, c.color ORDER BY total ASC';

    const rows = this.driver.all<{
      categoryId: string;
      categoryName: string;
      color: string;
      total: number;
      count: number;
    }>(query, params);

    return rows.map(row => ({
      categoryId: row.categoryId || 'uncategorized',
      categoryName: row.categoryName || 'Uncategorized',
      total: Math.abs(row.total), // Convert to positive for display
      count: row.count,
      color: row.color || '#999999',
    }));
  }

  getIncomeVsExpensesOverTime(
    grouping: 'day' | 'week' | 'month' | 'year',
    startDate?: Date,
    endDate?: Date
  ): Array<{ period: string; income: number; expenses: number; net: number }> {
    // Build the query with proper date grouping
    let dateFormat: string;
    switch (grouping) {
      case 'day':
        dateFormat = '%Y-%m-%d';
        break;
      case 'week':
        // ISO week format: year-week (e.g., 2026-W01)
        dateFormat = '%Y-W%W';
        break;
      case 'month':
        dateFormat = '%Y-%m';
        break;
      case 'year':
        dateFormat = '%Y';
        break;
    }

    let query = `
      SELECT
        strftime('${dateFormat}', datetime(date / 1000, 'unixepoch')) as period,
        SUM(CASE WHEN amount > 0 AND id NOT IN (SELECT reimbursementTransactionId FROM transaction_reimbursements) THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN amount < 0 THEN ABS(amount) + COALESCE((SELECT SUM(tr.amount) FROM transaction_reimbursements tr WHERE tr.expenseTransactionId = transactions.id), 0) * -1 ELSE 0 END) as expenses,
        SUM(CASE
          WHEN amount > 0 AND id NOT IN (SELECT reimbursementTransactionId FROM transaction_reimbursements) THEN amount
          WHEN amount < 0 THEN amount + COALESCE((SELECT SUM(tr.amount) FROM transaction_reimbursements tr WHERE tr.expenseTransactionId = transactions.id), 0)
          ELSE 0
        END) as net
      FROM transactions
      WHERE (isInternalTransfer IS NULL OR isInternalTransfer = 0)
        AND (isHidden IS NULL OR isHidden = 0)
    `;

    const params: number[] = [];

    if (startDate) {
      query += ' AND date >= ?';
      params.push(startDate.getTime());
    }

    if (endDate) {
      query += ' AND date <= ?';
      params.push(endDate.getTime());
    }

    query += ' GROUP BY period ORDER BY period ASC';

    const rows = this.driver.all<{
      period: string;
      income: number;
      expenses: number;
      net: number;
    }>(query, params);

    return rows.map(row => ({
      period: row.period,
      income: row.income || 0,
      expenses: row.expenses || 0,
      net: row.net || 0,
    }));
  }

  getCategoryTrendsOverTime(
    categoryIds: string[],
    grouping: 'day' | 'week' | 'month' | 'year',
    startDate?: Date,
    endDate?: Date
  ): Array<{
    categoryId: string;
    categoryName: string;
    period: string;
    total: number;
    count: number;
    average: number;
    color: string;
  }> {
    if (categoryIds.length === 0) {
      return [];
    }

    // Build WHERE clause for category IDs
    const categoryPlaceholders = categoryIds.map(() => '?').join(',');

    // Build date filtering
    const conditions = [`t.categoryId IN (${categoryPlaceholders})`];
    const params: (string | number)[] = [...categoryIds];

    if (startDate) {
      conditions.push('t.date >= ?');
      params.push(startDate.getTime());
    }

    if (endDate) {
      conditions.push('t.date <= ?');
      params.push(endDate.getTime());
    }

    // Create SQL based on grouping
    let periodFormat: string;
    switch (grouping) {
      case 'day':
        periodFormat = "strftime('%Y-%m-%d', t.date / 1000, 'unixepoch')";
        break;
      case 'week':
        periodFormat = "strftime('%Y-W%W', t.date / 1000, 'unixepoch')";
        break;
      case 'month':
        periodFormat = "strftime('%Y-%m', t.date / 1000, 'unixepoch')";
        break;
      case 'year':
        periodFormat = "strftime('%Y', t.date / 1000, 'unixepoch')";
        break;
    }

    const query = `
      SELECT
        t.categoryId,
        c.name as categoryName,
        ${periodFormat} as period,
        SUM(ABS(t.amount) - COALESCE((SELECT SUM(tr.amount) FROM transaction_reimbursements tr WHERE tr.expenseTransactionId = t.id), 0)) as total,
        COUNT(*) as count,
        AVG(ABS(t.amount) - COALESCE((SELECT SUM(tr.amount) FROM transaction_reimbursements tr WHERE tr.expenseTransactionId = t.id), 0)) as average,
        c.color
      FROM transactions t
      INNER JOIN categories c ON t.categoryId = c.id
      WHERE ${conditions.join(' AND ')} AND t.amount < 0 AND (t.isInternalTransfer IS NULL OR t.isInternalTransfer = 0)
        AND (t.isHidden IS NULL OR t.isHidden = 0)
        AND t.id NOT IN (SELECT reimbursementTransactionId FROM transaction_reimbursements)
      GROUP BY t.categoryId, period
      ORDER BY period ASC, t.categoryId
    `;

    interface TrendRow {
      categoryId: string;
      categoryName: string;
      period: string;
      total: number;
      count: number;
      average: number;
      color: string;
    }

    const rows = this.driver.all<TrendRow>(query, params);

    return rows.map(row => ({
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      period: row.period,
      total: row.total,
      count: row.count,
      average: row.average,
      color: row.color || '#888888',
    }));
  }

  // RecurringTransaction operations
  createRecurringTransaction(recurringTx: Omit<RecurringTransaction, 'id'>): RecurringTransaction {
    const id = randomUUID();
    this.driver.run(`
      INSERT INTO recurring_transactions (
        id, accountId, description, amount, categoryId, frequency,
        startDate, endDate, nextOccurrence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      recurringTx.accountId,
      recurringTx.description,
      recurringTx.amount,
      recurringTx.categoryId || null,
      recurringTx.frequency,
      recurringTx.startDate.getTime(),
      recurringTx.endDate ? recurringTx.endDate.getTime() : null,
      recurringTx.nextOccurrence.getTime()
    ]);

    return {
      id,
      ...recurringTx,
    };
  }

  getRecurringTransactions(): RecurringTransaction[] {
    const rows = this.driver.all<RecurringTransactionRow>('SELECT * FROM recurring_transactions');
    interface RecurringTransactionRow {
      id: string;
      accountId: string;
      description: string;
      amount: number;
      categoryId: string | null;
      frequency: string;
      startDate: number;
      endDate: number | null;
      nextOccurrence: number;
    }
    return (rows as RecurringTransactionRow[]).map(row => ({
      id: row.id,
      accountId: row.accountId,
      description: row.description,
      amount: row.amount,
      categoryId: row.categoryId,
      frequency: row.frequency as RecurringFrequency,
      startDate: new Date(row.startDate),
      endDate: row.endDate ? new Date(row.endDate) : null,
      nextOccurrence: new Date(row.nextOccurrence),
    }));
  }

  getRecurringTransactionsByAccount(accountId: string): RecurringTransaction[] {
    interface RecurringTransactionRow {
      id: string;
      accountId: string;
      description: string;
      amount: number;
      categoryId: string | null;
      frequency: string;
      startDate: number;
      endDate: number | null;
      nextOccurrence: number;
    }
    const rows = this.driver.all<RecurringTransactionRow>(
      'SELECT * FROM recurring_transactions WHERE accountId = ?', [accountId]
    );
    return rows.map(row => ({
      id: row.id,
      accountId: row.accountId,
      description: row.description,
      amount: row.amount,
      categoryId: row.categoryId,
      frequency: row.frequency as RecurringFrequency,
      startDate: new Date(row.startDate),
      endDate: row.endDate ? new Date(row.endDate) : null,
      nextOccurrence: new Date(row.nextOccurrence),
    }));
  }

  getRecurringTransactionById(id: string): RecurringTransaction | null {
    interface RecurringTransactionRow {
      id: string;
      accountId: string;
      description: string;
      amount: number;
      categoryId: string | null;
      frequency: string;
      startDate: number;
      endDate: number | null;
      nextOccurrence: number;
    }
    const row = this.driver.get<RecurringTransactionRow>(
      'SELECT * FROM recurring_transactions WHERE id = ?', [id]
    );
    if (!row) return null;
    const r = row;
    return {
      id: r.id,
      accountId: r.accountId,
      description: r.description,
      amount: r.amount,
      categoryId: r.categoryId,
      frequency: r.frequency as RecurringFrequency,
      startDate: new Date(r.startDate),
      endDate: r.endDate ? new Date(r.endDate) : null,
      nextOccurrence: new Date(r.nextOccurrence),
    };
  }

  updateRecurringTransaction(
    id: string,
    updates: Partial<Omit<RecurringTransaction, 'id'>>
  ): void {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.amount !== undefined) {
      fields.push('amount = ?');
      values.push(updates.amount);
    }
    if (updates.categoryId !== undefined) {
      fields.push('categoryId = ?');
      values.push(updates.categoryId || null);
    }
    if (updates.frequency !== undefined) {
      fields.push('frequency = ?');
      values.push(updates.frequency);
    }
    if (updates.startDate !== undefined) {
      fields.push('startDate = ?');
      values.push(updates.startDate.getTime());
    }
    if (updates.endDate !== undefined) {
      fields.push('endDate = ?');
      values.push(updates.endDate ? updates.endDate.getTime() : null);
    }
    if (updates.nextOccurrence !== undefined) {
      fields.push('nextOccurrence = ?');
      values.push(updates.nextOccurrence.getTime());
    }

    if (fields.length > 0) {
      values.push(id);
      this.driver.run(`
        UPDATE recurring_transactions
        SET ${fields.join(', ')}
        WHERE id = ?
      `, values);
    }
  }

  deleteRecurringTransaction(id: string): void {
    this.driver.run('DELETE FROM recurring_transactions WHERE id = ?', [id]);
  }

  // ==================== Phase 1: Tags ====================
  createTag(tag: Omit<Tag, 'id' | 'createdAt'>): Tag {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO tags (id, name, color, createdAt)
      VALUES (?, ?, ?, ?)
    `, [id, tag.name, tag.color ?? null, createdAt]);

    return this.getTagById(id)!;
  }

  getTags(): Tag[] {
    const rows = this.driver.all('SELECT * FROM tags ORDER BY name ASC');
    return rows.map(this.mapTag);
  }

  getTagById(id: string): Tag | null {
    const row = this.driver.get('SELECT * FROM tags WHERE id = ?', [id]);
    return row ? this.mapTag(row) : null;
  }

  updateTag(id: string, updates: Partial<Omit<Tag, 'id' | 'createdAt'>>): Tag | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.color !== undefined) {
      fields.push('color = ?');
      values.push(updates.color);
    }

    if (fields.length === 0) return this.getTagById(id);

    values.push(id);
    this.driver.run(`UPDATE tags SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getTagById(id);
  }

  deleteTag(id: string): boolean {
    const result = this.driver.run('DELETE FROM tags WHERE id = ?', [id]);
    return result.changes > 0;
  }

  private mapTag(row: unknown): Tag {
    const r = row as TagRow;
    return {
      id: r.id,
      name: r.name,
      color: r.color,
      createdAt: new Date(r.createdAt),
    };
  }

  // Transaction Tags
  addTagToTransaction(transactionId: string, tagId: string): void {
    this.driver.run(`
      INSERT OR IGNORE INTO transaction_tags (transactionId, tagId)
      VALUES (?, ?)
    `, [transactionId, tagId]);
  }

  removeTagFromTransaction(transactionId: string, tagId: string): void {
    this.driver.run('DELETE FROM transaction_tags WHERE transactionId = ? AND tagId = ?', [transactionId, tagId]);
  }

  getTagsForTransaction(transactionId: string): Tag[] {
    const rows = this.driver.all(`
      SELECT t.* FROM tags t
      INNER JOIN transaction_tags tt ON t.id = tt.tagId
      WHERE tt.transactionId = ?
      ORDER BY t.name ASC
    `, [transactionId]);
    return rows.map(this.mapTag);
  }

  getTransactionsByTag(tagId: string): Transaction[] {
    const rows = this.driver.all(`
      SELECT t.* FROM transactions t
      INNER JOIN transaction_tags tt ON t.id = tt.transactionId
      WHERE tt.tagId = ?
      ORDER BY t.date DESC
    `, [tagId]);
    return rows.map(this.mapTransaction);
  }

  setTransactionTags(transactionId: string, tagIds: string[]): void {
    // Remove all existing tags
    this.driver.run('DELETE FROM transaction_tags WHERE transactionId = ?', [transactionId]);
    // Add new tags
    for (const tagId of tagIds) {
      this.driver.run('INSERT INTO transaction_tags (transactionId, tagId) VALUES (?, ?)', [transactionId, tagId]);
    }
  }

  // ==================== Phase 1: Split Transactions ====================
  createTransactionSplit(split: Omit<TransactionSplit, 'id' | 'createdAt'>): TransactionSplit {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO transaction_splits (id, parentTransactionId, categoryId, amount, description, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, split.parentTransactionId, split.categoryId ?? null, split.amount, split.description ?? null, createdAt]);

    return this.getTransactionSplitById(id)!;
  }

  getTransactionSplits(parentTransactionId: string): TransactionSplit[] {
    const rows = this.driver.all('SELECT * FROM transaction_splits WHERE parentTransactionId = ? ORDER BY createdAt ASC', [parentTransactionId]);
    return rows.map(this.mapTransactionSplit);
  }

  getTransactionSplitById(id: string): TransactionSplit | null {
    const row = this.driver.get('SELECT * FROM transaction_splits WHERE id = ?', [id]);
    return row ? this.mapTransactionSplit(row) : null;
  }

  updateTransactionSplit(id: string, updates: Partial<Omit<TransactionSplit, 'id' | 'createdAt' | 'parentTransactionId'>>): TransactionSplit | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.categoryId !== undefined) {
      fields.push('categoryId = ?');
      values.push(updates.categoryId);
    }
    if (updates.amount !== undefined) {
      fields.push('amount = ?');
      values.push(updates.amount);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }

    if (fields.length === 0) return this.getTransactionSplitById(id);

    values.push(id);
    this.driver.run(`UPDATE transaction_splits SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getTransactionSplitById(id);
  }

  deleteTransactionSplit(id: string): boolean {
    const result = this.driver.run('DELETE FROM transaction_splits WHERE id = ?', [id]);
    return result.changes > 0;
  }

  deleteAllTransactionSplits(parentTransactionId: string): number {
    const result = this.driver.run('DELETE FROM transaction_splits WHERE parentTransactionId = ?', [parentTransactionId]);
    return result.changes;
  }

  getTransactionIdsWithSplits(): string[] {
    const rows = this.driver.all<{ parentTransactionId: string }>('SELECT DISTINCT parentTransactionId FROM transaction_splits');
    return rows.map(r => r.parentTransactionId);
  }

  getTransactionSplitsByIds(ids: string[]): TransactionSplit[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const rows = this.driver.all(`SELECT * FROM transaction_splits WHERE parentTransactionId IN (${placeholders}) ORDER BY parentTransactionId, createdAt ASC`, ids);
    return rows.map(this.mapTransactionSplit);
  }

  private mapTransactionSplit(row: unknown): TransactionSplit {
    const r = row as TransactionSplitRow;
    return {
      id: r.id,
      parentTransactionId: r.parentTransactionId,
      categoryId: r.categoryId,
      amount: r.amount,
      description: r.description,
      createdAt: new Date(r.createdAt),
    };
  }

  // ==================== Phase 1: Search ====================
  searchTransactions(query: string, options?: {
    accountId?: string;
    categoryId?: string;
    startDate?: Date;
    endDate?: Date;
    minAmount?: number;
    maxAmount?: number;
    tagIds?: string[];
    limit?: number;
    offset?: number;
  }): Transaction[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Full-text search on description
    if (query && query.trim()) {
      conditions.push('LOWER(description) LIKE ?');
      params.push(`%${query.toLowerCase()}%`);
    }

    if (options?.accountId) {
      conditions.push('accountId = ?');
      params.push(options.accountId);
    }

    if (options?.categoryId) {
      conditions.push('categoryId = ?');
      params.push(options.categoryId);
    }

    if (options?.startDate) {
      conditions.push('date >= ?');
      params.push(options.startDate.getTime());
    }

    if (options?.endDate) {
      conditions.push('date <= ?');
      params.push(options.endDate.getTime());
    }

    if (options?.minAmount !== undefined) {
      conditions.push('ABS(amount) >= ?');
      params.push(options.minAmount);
    }

    if (options?.maxAmount !== undefined) {
      conditions.push('ABS(amount) <= ?');
      params.push(options.maxAmount);
    }

    let sql = 'SELECT * FROM transactions';

    if (options?.tagIds && options.tagIds.length > 0) {
      sql = `SELECT DISTINCT t.* FROM transactions t
             INNER JOIN transaction_tags tt ON t.id = tt.transactionId
             WHERE tt.tagId IN (${options.tagIds.map(() => '?').join(',')})`;
      params.unshift(...options.tagIds);
      if (conditions.length > 0) {
        sql += ' AND ' + conditions.join(' AND ');
      }
    } else if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY date DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options?.offset) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }

    const rows = this.driver.all(sql, params);
    return rows.map((row) => this.mapTransaction(row));
  }

  // ==================== Phase 2: Budget Goals ====================
  createBudgetGoal(goal: Omit<BudgetGoal, 'id' | 'createdAt'>): BudgetGoal {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO budget_goals (id, categoryId, amount, period, rolloverEnabled, rolloverAmount, startDate, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id,
      goal.categoryId,
      goal.amount,
      goal.period,
      goal.rolloverEnabled ? 1 : 0,
      goal.rolloverAmount,
      goal.startDate.getTime(),
      createdAt]);

    return this.getBudgetGoalById(id)!;
  }

  getBudgetGoals(): BudgetGoal[] {
    const rows = this.driver.all('SELECT * FROM budget_goals ORDER BY createdAt DESC');
    return rows.map(this.mapBudgetGoal);
  }

  getBudgetGoalById(id: string): BudgetGoal | null {
    const row = this.driver.get('SELECT * FROM budget_goals WHERE id = ?', [id]);
    return row ? this.mapBudgetGoal(row) : null;
  }

  getBudgetGoalByCategory(categoryId: string): BudgetGoal | null {
    const row = this.driver.get('SELECT * FROM budget_goals WHERE categoryId = ?', [categoryId]);
    return row ? this.mapBudgetGoal(row) : null;
  }

  updateBudgetGoal(id: string, updates: Partial<Omit<BudgetGoal, 'id' | 'createdAt'>>): BudgetGoal | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.categoryId !== undefined) {
      fields.push('categoryId = ?');
      values.push(updates.categoryId);
    }
    if (updates.amount !== undefined) {
      fields.push('amount = ?');
      values.push(updates.amount);
    }
    if (updates.period !== undefined) {
      fields.push('period = ?');
      values.push(updates.period);
    }
    if (updates.rolloverEnabled !== undefined) {
      fields.push('rolloverEnabled = ?');
      values.push(updates.rolloverEnabled ? 1 : 0);
    }
    if (updates.rolloverAmount !== undefined) {
      fields.push('rolloverAmount = ?');
      values.push(updates.rolloverAmount);
    }
    if (updates.startDate !== undefined) {
      fields.push('startDate = ?');
      values.push(updates.startDate.getTime());
    }

    if (fields.length === 0) return this.getBudgetGoalById(id);

    values.push(id);
    this.driver.run(`UPDATE budget_goals SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getBudgetGoalById(id);
  }

  deleteBudgetGoal(id: string): boolean {
    const result = this.driver.run('DELETE FROM budget_goals WHERE id = ?', [id]);
    return result.changes > 0;
  }

  private mapBudgetGoal(row: unknown): BudgetGoal {
    const r = row as BudgetGoalRow;
    return {
      id: r.id,
      categoryId: r.categoryId,
      amount: r.amount,
      period: r.period as BudgetPeriod,
      rolloverEnabled: r.rolloverEnabled === 1,
      rolloverAmount: r.rolloverAmount,
      startDate: new Date(r.startDate),
      createdAt: new Date(r.createdAt),
    };
  }

  // ==================== Phase 2: Spending Alerts ====================
  createSpendingAlert(alert: Omit<SpendingAlert, 'id' | 'createdAt'>): SpendingAlert {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO spending_alerts (id, categoryId, threshold, period, isActive, lastTriggered, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id,
      alert.categoryId,
      alert.threshold,
      alert.period,
      alert.isActive ? 1 : 0,
      alert.lastTriggered ? alert.lastTriggered.getTime() : null,
      createdAt]);

    return this.getSpendingAlertById(id)!;
  }

  getSpendingAlerts(): SpendingAlert[] {
    const rows = this.driver.all('SELECT * FROM spending_alerts ORDER BY createdAt DESC');
    return rows.map(this.mapSpendingAlert);
  }

  getSpendingAlertById(id: string): SpendingAlert | null {
    const row = this.driver.get('SELECT * FROM spending_alerts WHERE id = ?', [id]);
    return row ? this.mapSpendingAlert(row) : null;
  }

  getActiveSpendingAlerts(): SpendingAlert[] {
    const rows = this.driver.all('SELECT * FROM spending_alerts WHERE isActive = 1');
    return rows.map(this.mapSpendingAlert);
  }

  updateSpendingAlert(id: string, updates: Partial<Omit<SpendingAlert, 'id' | 'createdAt'>>): SpendingAlert | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.categoryId !== undefined) {
      fields.push('categoryId = ?');
      values.push(updates.categoryId);
    }
    if (updates.threshold !== undefined) {
      fields.push('threshold = ?');
      values.push(updates.threshold);
    }
    if (updates.period !== undefined) {
      fields.push('period = ?');
      values.push(updates.period);
    }
    if (updates.isActive !== undefined) {
      fields.push('isActive = ?');
      values.push(updates.isActive ? 1 : 0);
    }
    if (updates.lastTriggered !== undefined) {
      fields.push('lastTriggered = ?');
      values.push(updates.lastTriggered ? updates.lastTriggered.getTime() : null);
    }

    if (fields.length === 0) return this.getSpendingAlertById(id);

    values.push(id);
    this.driver.run(`UPDATE spending_alerts SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getSpendingAlertById(id);
  }

  deleteSpendingAlert(id: string): boolean {
    const result = this.driver.run('DELETE FROM spending_alerts WHERE id = ?', [id]);
    return result.changes > 0;
  }

  private mapSpendingAlert(row: unknown): SpendingAlert {
    const r = row as SpendingAlertRow;
    return {
      id: r.id,
      categoryId: r.categoryId,
      threshold: r.threshold,
      period: r.period as BudgetPeriod,
      isActive: r.isActive === 1,
      lastTriggered: r.lastTriggered ? new Date(r.lastTriggered) : null,
      createdAt: new Date(r.createdAt),
    };
  }

  // ==================== Phase 3: Bills ====================
  createBill(bill: Omit<Bill, 'id' | 'createdAt'>): Bill {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO bills (id, name, amount, dueDay, frequency, categoryId, autopay, reminderDays, isActive, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id,
      bill.name,
      bill.amount,
      bill.dueDay,
      bill.frequency,
      bill.categoryId ?? null,
      bill.autopay ? 1 : 0,
      bill.reminderDays,
      bill.isActive ? 1 : 0,
      createdAt]);

    return this.getBillById(id)!;
  }

  getBills(): Bill[] {
    const rows = this.driver.all('SELECT * FROM bills ORDER BY dueDay ASC');
    return rows.map(this.mapBill);
  }

  getActiveBills(): Bill[] {
    const rows = this.driver.all('SELECT * FROM bills WHERE isActive = 1 ORDER BY dueDay ASC');
    return rows.map(this.mapBill);
  }

  getBillById(id: string): Bill | null {
    const row = this.driver.get('SELECT * FROM bills WHERE id = ?', [id]);
    return row ? this.mapBill(row) : null;
  }

  updateBill(id: string, updates: Partial<Omit<Bill, 'id' | 'createdAt'>>): Bill | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.amount !== undefined) {
      fields.push('amount = ?');
      values.push(updates.amount);
    }
    if (updates.dueDay !== undefined) {
      fields.push('dueDay = ?');
      values.push(updates.dueDay);
    }
    if (updates.frequency !== undefined) {
      fields.push('frequency = ?');
      values.push(updates.frequency);
    }
    if (updates.categoryId !== undefined) {
      fields.push('categoryId = ?');
      values.push(updates.categoryId);
    }
    if (updates.autopay !== undefined) {
      fields.push('autopay = ?');
      values.push(updates.autopay ? 1 : 0);
    }
    if (updates.reminderDays !== undefined) {
      fields.push('reminderDays = ?');
      values.push(updates.reminderDays);
    }
    if (updates.isActive !== undefined) {
      fields.push('isActive = ?');
      values.push(updates.isActive ? 1 : 0);
    }

    if (fields.length === 0) return this.getBillById(id);

    values.push(id);
    this.driver.run(`UPDATE bills SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getBillById(id);
  }

  deleteBill(id: string): boolean {
    const result = this.driver.run('DELETE FROM bills WHERE id = ?', [id]);
    return result.changes > 0;
  }

  private mapBill(row: unknown): Bill {
    const r = row as BillRow;
    return {
      id: r.id,
      name: r.name,
      amount: r.amount,
      dueDay: r.dueDay,
      frequency: r.frequency as BillFrequency,
      categoryId: r.categoryId,
      autopay: r.autopay === 1,
      reminderDays: r.reminderDays,
      isActive: r.isActive === 1,
      createdAt: new Date(r.createdAt),
    };
  }

  // Bill Payments
  createBillPayment(payment: Omit<BillPayment, 'id' | 'createdAt'>): BillPayment {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO bill_payments (id, billId, dueDate, paidDate, amount, status, transactionId, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id,
      payment.billId,
      payment.dueDate.getTime(),
      payment.paidDate ? payment.paidDate.getTime() : null,
      payment.amount,
      payment.status,
      payment.transactionId ?? null,
      createdAt]);

    return this.getBillPaymentById(id)!;
  }

  getBillPayments(billId: string): BillPayment[] {
    const rows = this.driver.all('SELECT * FROM bill_payments WHERE billId = ? ORDER BY dueDate DESC', [billId]);
    return rows.map(this.mapBillPayment);
  }

  getBillPaymentById(id: string): BillPayment | null {
    const row = this.driver.get('SELECT * FROM bill_payments WHERE id = ?', [id]);
    return row ? this.mapBillPayment(row) : null;
  }

  getUpcomingBillPayments(days: number = 30): BillPayment[] {
    const now = Date.now();
    const endDate = now + days * 24 * 60 * 60 * 1000;
    const rows = this.driver.all(`
      SELECT * FROM bill_payments
      WHERE dueDate >= ? AND dueDate <= ? AND status IN ('pending', 'overdue')
      ORDER BY dueDate ASC
    `, [now, endDate]);
    return rows.map(this.mapBillPayment);
  }

  updateBillPayment(id: string, updates: Partial<Omit<BillPayment, 'id' | 'createdAt' | 'billId'>>): BillPayment | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.dueDate !== undefined) {
      fields.push('dueDate = ?');
      values.push(updates.dueDate.getTime());
    }
    if (updates.paidDate !== undefined) {
      fields.push('paidDate = ?');
      values.push(updates.paidDate ? updates.paidDate.getTime() : null);
    }
    if (updates.amount !== undefined) {
      fields.push('amount = ?');
      values.push(updates.amount);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.transactionId !== undefined) {
      fields.push('transactionId = ?');
      values.push(updates.transactionId);
    }

    if (fields.length === 0) return this.getBillPaymentById(id);

    values.push(id);
    this.driver.run(`UPDATE bill_payments SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getBillPaymentById(id);
  }

  deleteBillPayment(id: string): boolean {
    const result = this.driver.run('DELETE FROM bill_payments WHERE id = ?', [id]);
    return result.changes > 0;
  }

  private mapBillPayment(row: unknown): BillPayment {
    const r = row as BillPaymentRow;
    return {
      id: r.id,
      billId: r.billId,
      dueDate: new Date(r.dueDate),
      paidDate: r.paidDate ? new Date(r.paidDate) : null,
      amount: r.amount,
      status: r.status as BillPaymentStatus,
      transactionId: r.transactionId,
      createdAt: new Date(r.createdAt),
    };
  }

  // ==================== Phase 3: Category Corrections ====================
  createCategoryCorrection(correction: Omit<CategoryCorrection, 'id' | 'createdAt'>): CategoryCorrection {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO category_corrections (id, originalDescription, correctedCategoryId, pattern, confidence, usageCount, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id,
      correction.originalDescription,
      correction.correctedCategoryId,
      correction.pattern ?? null,
      correction.confidence,
      correction.usageCount,
      createdAt]);

    return this.getCategoryCorrectionById(id)!;
  }

  getCategoryCorrections(): CategoryCorrection[] {
    const rows = this.driver.all('SELECT * FROM category_corrections ORDER BY usageCount DESC');
    return rows.map(this.mapCategoryCorrection);
  }

  getCategoryCorrectionById(id: string): CategoryCorrection | null {
    const row = this.driver.get('SELECT * FROM category_corrections WHERE id = ?', [id]);
    return row ? this.mapCategoryCorrection(row) : null;
  }

  findCategoryCorrection(description: string): CategoryCorrection | null {
    // First try exact match
    const exactRow = this.driver.get('SELECT * FROM category_corrections WHERE LOWER(originalDescription) = LOWER(?)', [description]);
    if (exactRow) return this.mapCategoryCorrection(exactRow);

    // Then try pattern match
    const corrections = this.getCategoryCorrections();
    const lowerDesc = description.toLowerCase();
    for (const correction of corrections) {
      if (correction.pattern) {
        try {
          const regex = new RegExp(correction.pattern, 'i');
          if (regex.test(lowerDesc)) {
            return correction;
          }
        } catch {
          // Invalid regex, try as substring
          if (lowerDesc.includes(correction.pattern.toLowerCase())) {
            return correction;
          }
        }
      }
    }
    return null;
  }

  incrementCategoryCorrectionUsage(id: string): void {
    this.driver.run('UPDATE category_corrections SET usageCount = usageCount + 1 WHERE id = ?', [id]);
  }

  updateCategoryCorrection(id: string, updates: Partial<Omit<CategoryCorrection, 'id' | 'createdAt'>>): CategoryCorrection | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.originalDescription !== undefined) {
      fields.push('originalDescription = ?');
      values.push(updates.originalDescription);
    }
    if (updates.correctedCategoryId !== undefined) {
      fields.push('correctedCategoryId = ?');
      values.push(updates.correctedCategoryId);
    }
    if (updates.pattern !== undefined) {
      fields.push('pattern = ?');
      values.push(updates.pattern);
    }
    if (updates.confidence !== undefined) {
      fields.push('confidence = ?');
      values.push(updates.confidence);
    }
    if (updates.usageCount !== undefined) {
      fields.push('usageCount = ?');
      values.push(updates.usageCount);
    }

    if (fields.length === 0) return this.getCategoryCorrectionById(id);

    values.push(id);
    this.driver.run(`UPDATE category_corrections SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getCategoryCorrectionById(id);
  }

  deleteCategoryCorrection(id: string): boolean {
    const result = this.driver.run('DELETE FROM category_corrections WHERE id = ?', [id]);
    return result.changes > 0;
  }

  private mapCategoryCorrection(row: unknown): CategoryCorrection {
    const r = row as CategoryCorrectionRow;
    return {
      id: r.id,
      originalDescription: r.originalDescription,
      correctedCategoryId: r.correctedCategoryId,
      pattern: r.pattern,
      confidence: r.confidence,
      usageCount: r.usageCount,
      createdAt: new Date(r.createdAt),
    };
  }

  // ==================== Phase 4: Assets ====================
  createAsset(asset: Omit<Asset, 'id' | 'createdAt'>): Asset {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO assets (id, name, type, value, lastUpdated, notes, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id, asset.name, asset.type, asset.value, asset.lastUpdated.getTime(), asset.notes ?? null, createdAt]);

    return this.getAssetById(id)!;
  }

  getAssets(): Asset[] {
    const rows = this.driver.all('SELECT * FROM assets ORDER BY value DESC');
    return rows.map(this.mapAsset);
  }

  getAssetById(id: string): Asset | null {
    const row = this.driver.get('SELECT * FROM assets WHERE id = ?', [id]);
    return row ? this.mapAsset(row) : null;
  }

  updateAsset(id: string, updates: Partial<Omit<Asset, 'id' | 'createdAt'>>): Asset | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      values.push(updates.type);
    }
    if (updates.value !== undefined) {
      fields.push('value = ?');
      values.push(updates.value);
    }
    if (updates.lastUpdated !== undefined) {
      fields.push('lastUpdated = ?');
      values.push(updates.lastUpdated.getTime());
    }
    if (updates.notes !== undefined) {
      fields.push('notes = ?');
      values.push(updates.notes);
    }

    if (fields.length === 0) return this.getAssetById(id);

    values.push(id);
    this.driver.run(`UPDATE assets SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getAssetById(id);
  }

  deleteAsset(id: string): boolean {
    const result = this.driver.run('DELETE FROM assets WHERE id = ?', [id]);
    return result.changes > 0;
  }

  getTotalAssets(): number {
    const result = this.driver.get<{ total: number }>('SELECT COALESCE(SUM(value), 0) as total FROM assets');
    return result!.total;
  }

  private mapAsset(row: unknown): Asset {
    const r = row as AssetRow;
    return {
      id: r.id,
      name: r.name,
      type: r.type as AssetType,
      value: r.value,
      lastUpdated: new Date(r.lastUpdated),
      notes: r.notes,
      createdAt: new Date(r.createdAt),
    };
  }

  // ==================== Phase 4: Liabilities ====================
  createLiability(liability: Omit<Liability, 'id' | 'createdAt'>): Liability {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO liabilities (id, name, type, balance, interestRate, minimumPayment, lastUpdated, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id,
      liability.name,
      liability.type,
      liability.balance,
      liability.interestRate ?? null,
      liability.minimumPayment ?? null,
      liability.lastUpdated.getTime(),
      createdAt]);

    return this.getLiabilityById(id)!;
  }

  getLiabilities(): Liability[] {
    const rows = this.driver.all('SELECT * FROM liabilities ORDER BY balance DESC');
    return rows.map(this.mapLiability);
  }

  getLiabilityById(id: string): Liability | null {
    const row = this.driver.get('SELECT * FROM liabilities WHERE id = ?', [id]);
    return row ? this.mapLiability(row) : null;
  }

  updateLiability(id: string, updates: Partial<Omit<Liability, 'id' | 'createdAt'>>): Liability | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      values.push(updates.type);
    }
    if (updates.balance !== undefined) {
      fields.push('balance = ?');
      values.push(updates.balance);
    }
    if (updates.interestRate !== undefined) {
      fields.push('interestRate = ?');
      values.push(updates.interestRate);
    }
    if (updates.minimumPayment !== undefined) {
      fields.push('minimumPayment = ?');
      values.push(updates.minimumPayment);
    }
    if (updates.lastUpdated !== undefined) {
      fields.push('lastUpdated = ?');
      values.push(updates.lastUpdated.getTime());
    }

    if (fields.length === 0) return this.getLiabilityById(id);

    values.push(id);
    this.driver.run(`UPDATE liabilities SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getLiabilityById(id);
  }

  deleteLiability(id: string): boolean {
    const result = this.driver.run('DELETE FROM liabilities WHERE id = ?', [id]);
    return result.changes > 0;
  }

  getTotalLiabilities(): number {
    const result = this.driver.get<{ total: number }>('SELECT COALESCE(SUM(balance), 0) as total FROM liabilities');
    return result!.total;
  }

  private mapLiability(row: unknown): Liability {
    const r = row as LiabilityRow;
    return {
      id: r.id,
      name: r.name,
      type: r.type as LiabilityType,
      balance: r.balance,
      interestRate: r.interestRate,
      minimumPayment: r.minimumPayment,
      lastUpdated: new Date(r.lastUpdated),
      createdAt: new Date(r.createdAt),
    };
  }

  // ==================== Phase 4: Net Worth History (Legacy) ====================
  createNetWorthHistory(): NetWorthHistory {
    const id = randomUUID();
    const now = Date.now();
    const totalAssets = this.getTotalAssets();
    const totalLiabilities = this.getTotalLiabilities();
    const netWorth = totalAssets - totalLiabilities;

    // Create breakdown by type
    const assetsByType = this.driver.all<{ type: string; total: number }>('SELECT type, SUM(value) as total FROM assets GROUP BY type');
    const liabilitiesByType = this.driver.all<{ type: string; total: number }>('SELECT type, SUM(balance) as total FROM liabilities GROUP BY type');
    const breakdown = JSON.stringify({ assets: assetsByType, liabilities: liabilitiesByType });

    this.driver.run(`
      INSERT INTO net_worth_history (id, date, totalAssets, totalLiabilities, netWorth, breakdown, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id, now, totalAssets, totalLiabilities, netWorth, breakdown, now]);

    return this.getNetWorthHistoryById(id)!;
  }

  getNetWorthHistory(limit?: number): NetWorthHistory[] {
    let sql = 'SELECT * FROM net_worth_history ORDER BY date DESC';
    if (limit) {
      sql += ' LIMIT ?';
      const rows = this.driver.all(sql, [limit]);
      return rows.map(this.mapNetWorthHistory);
    }
    const rows = this.driver.all(sql);
    return rows.map(this.mapNetWorthHistory);
  }

  getNetWorthHistoryById(id: string): NetWorthHistory | null {
    const row = this.driver.get('SELECT * FROM net_worth_history WHERE id = ?', [id]);
    return row ? this.mapNetWorthHistory(row) : null;
  }

  private mapNetWorthHistory(row: unknown): NetWorthHistory {
    const r = row as NetWorthHistoryRow;
    return {
      id: r.id,
      date: new Date(r.date),
      totalAssets: r.totalAssets,
      totalLiabilities: r.totalLiabilities,
      netWorth: r.netWorth,
      breakdown: r.breakdown,
      createdAt: new Date(r.createdAt),
    };
  }

  // ==================== Phase 4: Savings Goals ====================
  createSavingsGoal(goal: Omit<SavingsGoal, 'id' | 'createdAt'>): SavingsGoal {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO savings_goals (id, name, targetAmount, currentAmount, targetDate, accountId, icon, color, isActive, ownerId, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id,
      goal.name,
      goal.targetAmount,
      goal.currentAmount,
      goal.targetDate ? goal.targetDate.getTime() : null,
      goal.accountId ?? null,
      goal.icon ?? null,
      goal.color ?? null,
      goal.isActive ? 1 : 0,
      goal.ownerId ?? null,
      createdAt]);

    return this.getSavingsGoalById(id)!;
  }

  getSavingsGoals(): SavingsGoal[] {
    const rows = this.driver.all('SELECT * FROM savings_goals ORDER BY createdAt DESC');
    return rows.map(this.mapSavingsGoal);
  }

  getActiveSavingsGoals(): SavingsGoal[] {
    const rows = this.driver.all('SELECT * FROM savings_goals WHERE isActive = 1 ORDER BY createdAt DESC');
    return rows.map(this.mapSavingsGoal);
  }

  getSavingsGoalById(id: string): SavingsGoal | null {
    const row = this.driver.get('SELECT * FROM savings_goals WHERE id = ?', [id]);
    return row ? this.mapSavingsGoal(row) : null;
  }

  updateSavingsGoal(id: string, updates: Partial<Omit<SavingsGoal, 'id' | 'createdAt'>>): SavingsGoal | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.targetAmount !== undefined) {
      fields.push('targetAmount = ?');
      values.push(updates.targetAmount);
    }
    if (updates.currentAmount !== undefined) {
      fields.push('currentAmount = ?');
      values.push(updates.currentAmount);
    }
    if (updates.targetDate !== undefined) {
      fields.push('targetDate = ?');
      values.push(updates.targetDate ? updates.targetDate.getTime() : null);
    }
    if (updates.accountId !== undefined) {
      fields.push('accountId = ?');
      values.push(updates.accountId);
    }
    if (updates.icon !== undefined) {
      fields.push('icon = ?');
      values.push(updates.icon);
    }
    if (updates.color !== undefined) {
      fields.push('color = ?');
      values.push(updates.color);
    }
    if (updates.isActive !== undefined) {
      fields.push('isActive = ?');
      values.push(updates.isActive ? 1 : 0);
    }
    if (updates.ownerId !== undefined) {
      fields.push('ownerId = ?');
      values.push(updates.ownerId);
    }

    if (fields.length === 0) return this.getSavingsGoalById(id);

    values.push(id);
    this.driver.run(`UPDATE savings_goals SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getSavingsGoalById(id);
  }

  deleteSavingsGoal(id: string): boolean {
    const result = this.driver.run('DELETE FROM savings_goals WHERE id = ?', [id]);
    return result.changes > 0;
  }

  private mapSavingsGoal(row: unknown): SavingsGoal {
    const r = row as SavingsGoalRow;
    return {
      id: r.id,
      name: r.name,
      targetAmount: r.targetAmount,
      currentAmount: r.currentAmount,
      targetDate: r.targetDate ? new Date(r.targetDate) : null,
      accountId: r.accountId,
      icon: r.icon,
      color: r.color,
      isActive: r.isActive === 1,
      ownerId: r.ownerId ?? null,
      isEncrypted: r.isEncrypted === 1,
      createdAt: new Date(r.createdAt),
    };
  }

  // Savings Contributions
  createSavingsContribution(contribution: Omit<SavingsContribution, 'id' | 'createdAt'>): SavingsContribution {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO savings_contributions (id, goalId, amount, transactionId, date, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id,
      contribution.goalId,
      contribution.amount,
      contribution.transactionId ?? null,
      contribution.date.getTime(),
      createdAt]);

    // Only update currentAmount for NON-pinned goals (pinned goals are balance-driven)
    const goal = this.getSavingsGoalById(contribution.goalId);
    if (goal && !goal.accountId) {
      this.updateSavingsGoal(contribution.goalId, {
        currentAmount: goal.currentAmount + contribution.amount,
      });
    }

    return this.getSavingsContributionById(id)!;
  }

  getSavingsContributions(goalId: string): SavingsContribution[] {
    const rows = this.driver.all('SELECT * FROM savings_contributions WHERE goalId = ? ORDER BY date DESC', [goalId]);
    return rows.map(this.mapSavingsContribution);
  }

  getSavingsContributionById(id: string): SavingsContribution | null {
    const row = this.driver.get('SELECT * FROM savings_contributions WHERE id = ?', [id]);
    return row ? this.mapSavingsContribution(row) : null;
  }

  deleteSavingsContribution(id: string): boolean {
    const contribution = this.getSavingsContributionById(id);
    if (contribution) {
      // Only update currentAmount for NON-pinned goals (pinned goals are balance-driven)
      const goal = this.getSavingsGoalById(contribution.goalId);
      if (goal && !goal.accountId) {
        this.updateSavingsGoal(contribution.goalId, {
          currentAmount: goal.currentAmount - contribution.amount,
        });
      }
    }
    const result = this.driver.run('DELETE FROM savings_contributions WHERE id = ?', [id]);
    return result.changes > 0;
  }

  getSavingsGoalByAccountId(accountId: string): SavingsGoal | null {
    const row = this.driver.get(
      'SELECT * FROM savings_goals WHERE accountId = ? AND isActive = 1 LIMIT 1'
    , [accountId]);
    return row ? this.mapSavingsGoal(row) : null;
  }

  syncSavingsGoalWithAccount(goalId: string): void {
    const goal = this.getSavingsGoalById(goalId);
    if (!goal || !goal.accountId) return;

    const account = this.getAccountById(goal.accountId);
    if (!account) return;

    this.updateSavingsGoal(goalId, { currentAmount: account.balance });
  }

  syncAllPinnedSavingsGoals(): void {
    const pinnedGoals = this.driver.all<unknown[]>(
      'SELECT * FROM savings_goals WHERE accountId IS NOT NULL AND isActive = 1'
    );

    for (const row of pinnedGoals) {
      const goal = this.mapSavingsGoal(row);
      if (goal.accountId) {
        this.syncSavingsGoalWithAccount(goal.id);
      }
    }
  }

  createContributionsFromAccountTransactions(goalId: string, accountId: string): void {
    const transactions = this.driver.all<unknown[]>(
      'SELECT * FROM transactions WHERE accountId = ? ORDER BY date ASC'
    , [accountId]);

    for (const row of transactions) {
      const txn = this.mapTransaction(row);
      this.createContributionFromTransaction(goalId, txn.id);
    }
  }

  createContributionFromTransaction(goalId: string, transactionId: string): void {
    // Dedupe: skip if contribution already exists for this transaction
    const existing = this.driver.get(
      'SELECT id FROM savings_contributions WHERE goalId = ? AND transactionId = ?'
    , [goalId, transactionId]);
    if (existing) return;

    const txn = this.getTransactionById(transactionId);
    if (!txn) return;

    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO savings_contributions (id, goalId, amount, transactionId, date, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id,
      goalId,
      txn.amount,
      transactionId,
      txn.date.getTime(),
      createdAt]);
  }

  getSavingsGrowthData(goalId: string): { date: string; cumulativeAmount: number }[] {
    const rows = this.driver.all<{ dateStr: string; cumulativeAmount: number }>(`
      SELECT
        date(date / 1000, 'unixepoch') as dateStr,
        SUM(amount) OVER (ORDER BY date) as cumulativeAmount
      FROM savings_contributions
      WHERE goalId = ?
      ORDER BY date ASC
    `, [goalId]);

    return rows.map(r => ({
      date: r.dateStr,
      cumulativeAmount: r.cumulativeAmount,
    }));
  }

  getMonthlyContributionSummary(goalId: string): { month: string; total: number; count: number }[] {
    const rows = this.driver.all<{ month: string; total: number; count: number }>(`
      SELECT
        strftime('%Y-%m', date / 1000, 'unixepoch') as month,
        SUM(amount) as total,
        COUNT(*) as count
      FROM savings_contributions
      WHERE goalId = ?
      GROUP BY month
      ORDER BY month ASC
    `, [goalId]);

    return rows;
  }

  private mapSavingsContribution(row: unknown): SavingsContribution {
    const r = row as SavingsContributionRow;
    return {
      id: r.id,
      goalId: r.goalId,
      amount: r.amount,
      transactionId: r.transactionId,
      date: new Date(r.date),
      createdAt: new Date(r.createdAt),
    };
  }

  // ==================== Phase 5: Investments ====================
  createInvestment(investment: Omit<Investment, 'id' | 'createdAt'>): Investment {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO investments (id, accountId, name, ticker, type, shares, costBasis, currentPrice, lastUpdated, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id,
      investment.accountId ?? null,
      investment.name,
      investment.ticker ?? null,
      investment.type,
      investment.shares,
      investment.costBasis,
      investment.currentPrice,
      investment.lastUpdated.getTime(),
      createdAt]);

    return this.getInvestmentById(id)!;
  }

  getInvestments(): Investment[] {
    const rows = this.driver.all('SELECT * FROM investments ORDER BY name ASC');
    return rows.map(this.mapInvestment);
  }

  getInvestmentById(id: string): Investment | null {
    const row = this.driver.get('SELECT * FROM investments WHERE id = ?', [id]);
    return row ? this.mapInvestment(row) : null;
  }

  updateInvestment(id: string, updates: Partial<Omit<Investment, 'id' | 'createdAt'>>): Investment | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.accountId !== undefined) {
      fields.push('accountId = ?');
      values.push(updates.accountId);
    }
    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.ticker !== undefined) {
      fields.push('ticker = ?');
      values.push(updates.ticker);
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      values.push(updates.type);
    }
    if (updates.shares !== undefined) {
      fields.push('shares = ?');
      values.push(updates.shares);
    }
    if (updates.costBasis !== undefined) {
      fields.push('costBasis = ?');
      values.push(updates.costBasis);
    }
    if (updates.currentPrice !== undefined) {
      fields.push('currentPrice = ?');
      values.push(updates.currentPrice);
    }
    if (updates.lastUpdated !== undefined) {
      fields.push('lastUpdated = ?');
      values.push(updates.lastUpdated.getTime());
    }

    if (fields.length === 0) return this.getInvestmentById(id);

    values.push(id);
    this.driver.run(`UPDATE investments SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getInvestmentById(id);
  }

  deleteInvestment(id: string): boolean {
    const result = this.driver.run('DELETE FROM investments WHERE id = ?', [id]);
    return result.changes > 0;
  }

  getTotalInvestmentValue(): number {
    const result = this.driver.get<{ total: number }>('SELECT COALESCE(SUM(shares * currentPrice), 0) as total FROM investments');
    return result!.total;
  }

  private mapInvestment(row: unknown): Investment {
    const r = row as InvestmentRow;
    return {
      id: r.id,
      accountId: r.accountId,
      name: r.name,
      ticker: r.ticker,
      type: r.type as InvestmentType,
      shares: r.shares,
      costBasis: r.costBasis,
      currentPrice: r.currentPrice,
      lastUpdated: new Date(r.lastUpdated),
      createdAt: new Date(r.createdAt),
    };
  }

  // Investment History
  createInvestmentHistory(history: Omit<InvestmentHistory, 'id'>): InvestmentHistory {
    const id = randomUUID();

    this.driver.run(`
      INSERT INTO investment_history (id, investmentId, date, price, shares, value)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, history.investmentId, history.date.getTime(), history.price, history.shares, history.value]);

    return this.getInvestmentHistoryById(id)!;
  }

  getInvestmentHistory(investmentId: string): InvestmentHistory[] {
    const rows = this.driver.all('SELECT * FROM investment_history WHERE investmentId = ? ORDER BY date DESC', [investmentId]);
    return rows.map(this.mapInvestmentHistory);
  }

  getInvestmentHistoryById(id: string): InvestmentHistory | null {
    const row = this.driver.get('SELECT * FROM investment_history WHERE id = ?', [id]);
    return row ? this.mapInvestmentHistory(row) : null;
  }

  private mapInvestmentHistory(row: unknown): InvestmentHistory {
    const r = row as InvestmentHistoryRow;
    return {
      id: r.id,
      investmentId: r.investmentId,
      date: new Date(r.date),
      price: r.price,
      shares: r.shares,
      value: r.value,
    };
  }

  // ==================== Phase 6: Receipts ====================
  createReceipt(receipt: Omit<Receipt, 'id'>): Receipt {
    const id = randomUUID();

    this.driver.run(`
      INSERT INTO receipts (id, transactionId, filePath, thumbnailPath, extractedData, uploadedAt, processedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id,
      receipt.transactionId ?? null,
      receipt.filePath,
      receipt.thumbnailPath ?? null,
      receipt.extractedData ?? null,
      receipt.uploadedAt.getTime(),
      receipt.processedAt ? receipt.processedAt.getTime() : null]);

    return this.getReceiptById(id)!;
  }

  getReceipts(): Receipt[] {
    const rows = this.driver.all('SELECT * FROM receipts ORDER BY uploadedAt DESC');
    return rows.map(this.mapReceipt);
  }

  getReceiptById(id: string): Receipt | null {
    const row = this.driver.get('SELECT * FROM receipts WHERE id = ?', [id]);
    return row ? this.mapReceipt(row) : null;
  }

  getReceiptByTransaction(transactionId: string): Receipt | null {
    const row = this.driver.get('SELECT * FROM receipts WHERE transactionId = ?', [transactionId]);
    return row ? this.mapReceipt(row) : null;
  }

  updateReceipt(id: string, updates: Partial<Omit<Receipt, 'id'>>): Receipt | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.transactionId !== undefined) {
      fields.push('transactionId = ?');
      values.push(updates.transactionId);
    }
    if (updates.filePath !== undefined) {
      fields.push('filePath = ?');
      values.push(updates.filePath);
    }
    if (updates.thumbnailPath !== undefined) {
      fields.push('thumbnailPath = ?');
      values.push(updates.thumbnailPath);
    }
    if (updates.extractedData !== undefined) {
      fields.push('extractedData = ?');
      values.push(updates.extractedData);
    }
    if (updates.uploadedAt !== undefined) {
      fields.push('uploadedAt = ?');
      values.push(updates.uploadedAt.getTime());
    }
    if (updates.processedAt !== undefined) {
      fields.push('processedAt = ?');
      values.push(updates.processedAt ? updates.processedAt.getTime() : null);
    }

    if (fields.length === 0) return this.getReceiptById(id);

    values.push(id);
    this.driver.run(`UPDATE receipts SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getReceiptById(id);
  }

  deleteReceipt(id: string): boolean {
    const result = this.driver.run('DELETE FROM receipts WHERE id = ?', [id]);
    return result.changes > 0;
  }

  private mapReceipt(row: unknown): Receipt {
    const r = row as ReceiptRow;
    return {
      id: r.id,
      transactionId: r.transactionId,
      filePath: r.filePath,
      thumbnailPath: r.thumbnailPath,
      extractedData: r.extractedData,
      uploadedAt: new Date(r.uploadedAt),
      processedAt: r.processedAt ? new Date(r.processedAt) : null,
    };
  }

  // ==================== Transaction Attachments ====================

  getAttachmentsByTransaction(transactionId: string): TransactionAttachment[] {
    const rows = this.driver.all(
      'SELECT * FROM transaction_attachments WHERE transactionId = ? ORDER BY createdAt DESC',
      [transactionId]
    );
    return rows.map(this.mapAttachment);
  }

  getAttachmentById(id: string): TransactionAttachment | null {
    const row = this.driver.get('SELECT * FROM transaction_attachments WHERE id = ?', [id]);
    return row ? this.mapAttachment(row) : null;
  }

  createAttachment(data: { transactionId: string; filename: string; filePath: string; mimeType: string; fileSize: number }): TransactionAttachment {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO transaction_attachments (id, transactionId, filename, filePath, mimeType, fileSize, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id, data.transactionId, data.filename, data.filePath, data.mimeType, data.fileSize, createdAt]);

    return this.getAttachmentById(id)!;
  }

  deleteAttachment(id: string): boolean {
    const result = this.driver.run('DELETE FROM transaction_attachments WHERE id = ?', [id]);
    return result.changes > 0;
  }

  getAttachmentCount(transactionId: string): number {
    const row = this.driver.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM transaction_attachments WHERE transactionId = ?',
      [transactionId]
    );
    return row ? row.count : 0;
  }

  getAttachmentCountsByTransactionIds(transactionIds: string[]): Record<string, number> {
    if (transactionIds.length === 0) return {};
    const placeholders = transactionIds.map(() => '?').join(',');
    const rows = this.driver.all<{ transactionId: string; count: number }>(
      `SELECT transactionId, COUNT(*) as count FROM transaction_attachments WHERE transactionId IN (${placeholders}) GROUP BY transactionId`,
      transactionIds
    );
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.transactionId] = row.count;
    }
    return result;
  }

  private mapAttachment(row: unknown): TransactionAttachment {
    const r = row as TransactionAttachmentRow;
    return {
      id: r.id,
      transactionId: r.transactionId,
      filename: r.filename,
      filePath: r.filePath,
      mimeType: r.mimeType,
      fileSize: r.fileSize,
      createdAt: new Date(r.createdAt),
    };
  }

  // ==================== Unified Recurring Items ====================
  createRecurringItem(item: Omit<RecurringItem, 'id' | 'createdAt'>): RecurringItem {
    const id = randomUUID();
    const createdAt = Date.now();

    // Derive enableReminders from itemType: bill and subscription both enable reminders
    const enableReminders = (item.itemType === 'bill' || item.itemType === 'subscription') ? 1 : (item.enableReminders ? 1 : 0);

    this.driver.run(`
      INSERT INTO recurring_items (id, description, amount, frequency, startDate, nextOccurrence, accountId, endDate, categoryId, dayOfMonth, dayOfWeek, itemType, enableReminders, reminderDays, autopay, isActive, ownerId, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id,
      item.description,
      item.amount,
      item.frequency,
      item.startDate.getTime(),
      item.nextOccurrence.getTime(),
      item.accountId ?? null,
      item.endDate ? item.endDate.getTime() : null,
      item.categoryId ?? null,
      item.dayOfMonth ?? null,
      item.dayOfWeek ?? null,
      item.itemType || 'cashflow',
      enableReminders,
      item.reminderDays ?? null,
      item.autopay ? 1 : 0,
      item.isActive ? 1 : 0,
      item.ownerId ?? null,
      createdAt]);

    return this.getRecurringItemById(id)!;
  }

  getRecurringItems(): RecurringItem[] {
    const rows = this.driver.all('SELECT * FROM recurring_items ORDER BY nextOccurrence ASC');
    return rows.map(this.mapRecurringItem);
  }

  getActiveRecurringItems(): RecurringItem[] {
    const rows = this.driver.all('SELECT * FROM recurring_items WHERE isActive = 1 ORDER BY nextOccurrence ASC');
    return rows.map(this.mapRecurringItem);
  }

  getRecurringItemById(id: string): RecurringItem | null {
    const row = this.driver.get('SELECT * FROM recurring_items WHERE id = ?', [id]);
    return row ? this.mapRecurringItem(row) : null;
  }

  getRecurringItemsByAccount(accountId: string): RecurringItem[] {
    const rows = this.driver.all('SELECT * FROM recurring_items WHERE accountId = ? ORDER BY nextOccurrence ASC', [accountId]);
    return rows.map(this.mapRecurringItem);
  }

  updateRecurringItem(id: string, updates: Partial<Omit<RecurringItem, 'id' | 'createdAt'>>): RecurringItem | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.amount !== undefined) {
      fields.push('amount = ?');
      values.push(updates.amount);
    }
    if (updates.frequency !== undefined) {
      fields.push('frequency = ?');
      values.push(updates.frequency);
    }
    if (updates.startDate !== undefined) {
      fields.push('startDate = ?');
      values.push(updates.startDate.getTime());
    }
    if (updates.nextOccurrence !== undefined) {
      fields.push('nextOccurrence = ?');
      values.push(updates.nextOccurrence.getTime());
    }
    if (updates.accountId !== undefined) {
      fields.push('accountId = ?');
      values.push(updates.accountId);
    }
    if (updates.endDate !== undefined) {
      fields.push('endDate = ?');
      values.push(updates.endDate ? updates.endDate.getTime() : null);
    }
    if (updates.categoryId !== undefined) {
      fields.push('categoryId = ?');
      values.push(updates.categoryId);
    }
    if (updates.dayOfMonth !== undefined) {
      fields.push('dayOfMonth = ?');
      values.push(updates.dayOfMonth);
    }
    if (updates.dayOfWeek !== undefined) {
      fields.push('dayOfWeek = ?');
      values.push(updates.dayOfWeek);
    }
    if (updates.itemType !== undefined) {
      fields.push('itemType = ?');
      values.push(updates.itemType);
      // Sync enableReminders with itemType
      fields.push('enableReminders = ?');
      values.push((updates.itemType === 'bill' || updates.itemType === 'subscription') ? 1 : 0);
    } else if (updates.enableReminders !== undefined) {
      fields.push('enableReminders = ?');
      values.push(updates.enableReminders ? 1 : 0);
    }
    if (updates.reminderDays !== undefined) {
      fields.push('reminderDays = ?');
      values.push(updates.reminderDays);
    }
    if (updates.autopay !== undefined) {
      fields.push('autopay = ?');
      values.push(updates.autopay ? 1 : 0);
    }
    if (updates.isActive !== undefined) {
      fields.push('isActive = ?');
      values.push(updates.isActive ? 1 : 0);
    }
    if (updates.ownerId !== undefined) {
      fields.push('ownerId = ?');
      values.push(updates.ownerId);
    }

    if (fields.length === 0) return this.getRecurringItemById(id);

    values.push(id);
    this.driver.run(`UPDATE recurring_items SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getRecurringItemById(id);
  }

  deleteRecurringItem(id: string): boolean {
    const result = this.driver.run('DELETE FROM recurring_items WHERE id = ?', [id]);
    return result.changes > 0;
  }

  private mapRecurringItem(row: unknown): RecurringItem {
    const r = row as RecurringItemRow;
    return {
      id: r.id,
      description: r.description,
      amount: r.amount,
      frequency: r.frequency as RecurringFrequency,
      startDate: new Date(r.startDate),
      nextOccurrence: new Date(r.nextOccurrence),
      accountId: r.accountId,
      endDate: r.endDate ? new Date(r.endDate) : null,
      categoryId: r.categoryId,
      dayOfMonth: r.dayOfMonth,
      dayOfWeek: r.dayOfWeek,
      itemType: (r.itemType as RecurringItemType) || (r.enableReminders === 1 ? 'bill' : 'cashflow'),
      enableReminders: r.enableReminders === 1,
      reminderDays: r.reminderDays,
      autopay: r.autopay === 1,
      isActive: r.isActive === 1,
      ownerId: r.ownerId ?? null,
      isEncrypted: r.isEncrypted === 1,
      createdAt: new Date(r.createdAt),
    };
  }

  // Recurring Payments
  createRecurringPayment(payment: Omit<RecurringPayment, 'id' | 'createdAt'>): RecurringPayment {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO recurring_payments (id, recurringItemId, dueDate, paidDate, amount, status, transactionId, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id,
      payment.recurringItemId,
      payment.dueDate.getTime(),
      payment.paidDate ? payment.paidDate.getTime() : null,
      payment.amount,
      payment.status,
      payment.transactionId ?? null,
      createdAt]);

    return this.getRecurringPaymentById(id)!;
  }

  getRecurringPayments(recurringItemId: string): RecurringPayment[] {
    const rows = this.driver.all('SELECT * FROM recurring_payments WHERE recurringItemId = ? ORDER BY dueDate DESC', [recurringItemId]);
    return rows.map(this.mapRecurringPayment);
  }

  getRecurringPaymentById(id: string): RecurringPayment | null {
    const row = this.driver.get('SELECT * FROM recurring_payments WHERE id = ?', [id]);
    return row ? this.mapRecurringPayment(row) : null;
  }

  getUpcomingRecurringPayments(days: number = 30): RecurringPayment[] {
    const now = Date.now();
    const endDate = now + days * 24 * 60 * 60 * 1000;
    const rows = this.driver.all(`
      SELECT * FROM recurring_payments
      WHERE dueDate >= ? AND dueDate <= ? AND status IN ('pending', 'overdue')
      ORDER BY dueDate ASC
    `, [now, endDate]);
    return rows.map(this.mapRecurringPayment);
  }

  getRecurringPaymentsByDateRange(startDate: string, endDate: string): Array<RecurringPayment & { description: string; itemType: RecurringItemType; itemAmount: number }> {
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    const rows = this.driver.all(`
      SELECT rp.*, ri.description, ri.itemType, ri.amount AS itemAmount
      FROM recurring_payments rp
      JOIN recurring_items ri ON rp.recurringItemId = ri.id
      WHERE rp.dueDate >= ? AND rp.dueDate <= ?
      ORDER BY rp.dueDate ASC
    `, [start, end]);
    return (rows as Array<RecurringPaymentRow & { description: string; itemType: string; itemAmount: number }>).map(r => ({
      id: r.id,
      recurringItemId: r.recurringItemId,
      dueDate: new Date(r.dueDate),
      paidDate: r.paidDate ? new Date(r.paidDate) : null,
      amount: r.amount,
      status: r.status as PaymentStatus,
      transactionId: r.transactionId,
      createdAt: new Date(r.createdAt),
      description: r.description,
      itemType: r.itemType as RecurringItemType,
      itemAmount: r.itemAmount,
    }));
  }

  updateRecurringPayment(id: string, updates: Partial<Omit<RecurringPayment, 'id' | 'createdAt' | 'recurringItemId'>>): RecurringPayment | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.dueDate !== undefined) {
      fields.push('dueDate = ?');
      values.push(updates.dueDate.getTime());
    }
    if (updates.paidDate !== undefined) {
      fields.push('paidDate = ?');
      values.push(updates.paidDate ? updates.paidDate.getTime() : null);
    }
    if (updates.amount !== undefined) {
      fields.push('amount = ?');
      values.push(updates.amount);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.transactionId !== undefined) {
      fields.push('transactionId = ?');
      values.push(updates.transactionId);
    }

    if (fields.length === 0) return this.getRecurringPaymentById(id);

    values.push(id);
    this.driver.run(`UPDATE recurring_payments SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getRecurringPaymentById(id);
  }

  deleteRecurringPayment(id: string): boolean {
    const result = this.driver.run('DELETE FROM recurring_payments WHERE id = ?', [id]);
    return result.changes > 0;
  }

  private mapRecurringPayment(row: unknown): RecurringPayment {
    const r = row as RecurringPaymentRow;
    return {
      id: r.id,
      recurringItemId: r.recurringItemId,
      dueDate: new Date(r.dueDate),
      paidDate: r.paidDate ? new Date(r.paidDate) : null,
      amount: r.amount,
      status: r.status as PaymentStatus,
      transactionId: r.transactionId,
      createdAt: new Date(r.createdAt),
    };
  }

  // ==================== Phase 7: Prediction & Reporting ====================

  // Seasonal Patterns
  getSeasonalPatterns(categoryId?: string): Array<{
    id: string;
    categoryId: string;
    year: number;
    month: number;
    averageSpending: number;
    transactionCount: number;
    seasonalIndex: number;
    calculatedAt: Date;
  }> {
    const sql = categoryId
      ? 'SELECT * FROM seasonal_patterns WHERE categoryId = ? ORDER BY year DESC, month ASC'
      : 'SELECT * FROM seasonal_patterns ORDER BY categoryId, year DESC, month ASC';
    const rows = categoryId
      ? this.driver.all(sql, [categoryId])
      : this.driver.all(sql);

    return (rows as Array<{
      id: string;
      categoryId: string;
      year: number;
      month: number;
      averageSpending: number;
      transactionCount: number;
      seasonalIndex: number;
      calculatedAt: number;
    }>).map(r => ({
      id: r.id,
      categoryId: r.categoryId,
      year: r.year,
      month: r.month,
      averageSpending: r.averageSpending,
      transactionCount: r.transactionCount,
      seasonalIndex: r.seasonalIndex,
      calculatedAt: new Date(r.calculatedAt),
    }));
  }

  upsertSeasonalPattern(pattern: {
    categoryId: string;
    year: number;
    month: number;
    averageSpending: number;
    transactionCount: number;
    seasonalIndex: number;
  }): void {
    const id = randomUUID();
    const calculatedAt = Date.now();

    this.driver.run(`
      INSERT INTO seasonal_patterns (id, categoryId, year, month, averageSpending, transactionCount, seasonalIndex, calculatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(categoryId, year, month) DO UPDATE SET
        averageSpending = excluded.averageSpending,
        transactionCount = excluded.transactionCount,
        seasonalIndex = excluded.seasonalIndex,
        calculatedAt = excluded.calculatedAt
    `, [id,
      pattern.categoryId,
      pattern.year,
      pattern.month,
      pattern.averageSpending,
      pattern.transactionCount,
      pattern.seasonalIndex,
      calculatedAt]);
  }

  clearSeasonalPatterns(categoryId?: string): number {
    if (categoryId) {
      const result = this.driver.run('DELETE FROM seasonal_patterns WHERE categoryId = ?', [categoryId]);
      return result.changes;
    }
    const result = this.driver.run('DELETE FROM seasonal_patterns');
    return result.changes;
  }

  // Financial Health History
  getFinancialHealthHistory(limit?: number): Array<{
    id: string;
    date: Date;
    overallScore: number;
    factorScores: string;
    createdAt: Date;
  }> {
    const sql = limit
      ? 'SELECT * FROM financial_health_history ORDER BY date DESC LIMIT ?'
      : 'SELECT * FROM financial_health_history ORDER BY date DESC';
    const rows = limit
      ? this.driver.all(sql, [limit])
      : this.driver.all(sql);

    return (rows as Array<{
      id: string;
      date: number;
      overallScore: number;
      factorScores: string;
      createdAt: number;
    }>).map(r => ({
      id: r.id,
      date: new Date(r.date),
      overallScore: r.overallScore,
      factorScores: r.factorScores,
      createdAt: new Date(r.createdAt),
    }));
  }

  createFinancialHealthSnapshot(data: {
    overallScore: number;
    factorScores: string;
  }): { id: string; date: Date; overallScore: number; factorScores: string; createdAt: Date } {
    const id = randomUUID();
    const now = Date.now();

    this.driver.run(`
      INSERT INTO financial_health_history (id, date, overallScore, factorScores, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `, [id, now, data.overallScore, data.factorScores, now]);

    return {
      id,
      date: new Date(now),
      overallScore: data.overallScore,
      factorScores: data.factorScores,
      createdAt: new Date(now),
    };
  }

  getLatestFinancialHealthScore(): { id: string; date: Date; overallScore: number; factorScores: string; createdAt: Date } | null {
    const row = this.driver.get(
      'SELECT * FROM financial_health_history ORDER BY date DESC LIMIT 1'
    );

    if (!row) return null;

    const r = row as {
      id: string;
      date: number;
      overallScore: number;
      factorScores: string;
      createdAt: number;
    };

    return {
      id: r.id,
      date: new Date(r.date),
      overallScore: r.overallScore,
      factorScores: r.factorScores,
      createdAt: new Date(r.createdAt),
    };
  }

  // Bill Preferences
  getBillPreferences(): Array<{
    id: string;
    recurringItemId: string;
    preferredDueDay: number | null;
    notes: string | null;
  }> {
    const rows = this.driver.all('SELECT * FROM bill_preferences');
    return rows as Array<{
      id: string;
      recurringItemId: string;
      preferredDueDay: number | null;
      notes: string | null;
    }>;
  }

  getBillPreferenceByRecurringItem(recurringItemId: string): {
    id: string;
    recurringItemId: string;
    preferredDueDay: number | null;
    notes: string | null;
  } | null {
    const row = this.driver.get(
      'SELECT * FROM bill_preferences WHERE recurringItemId = ?'
    , [recurringItemId]);

    if (!row) return null;

    return row as {
      id: string;
      recurringItemId: string;
      preferredDueDay: number | null;
      notes: string | null;
    };
  }

  upsertBillPreference(data: {
    recurringItemId: string;
    preferredDueDay?: number | null;
    notes?: string | null;
  }): { id: string; recurringItemId: string; preferredDueDay: number | null; notes: string | null } {
    const existing = this.getBillPreferenceByRecurringItem(data.recurringItemId);

    if (existing) {
      this.driver.run(`
        UPDATE bill_preferences
        SET preferredDueDay = COALESCE(?, preferredDueDay),
            notes = COALESCE(?, notes)
        WHERE recurringItemId = ?
      `, [data.preferredDueDay, data.notes, data.recurringItemId]);

      return this.getBillPreferenceByRecurringItem(data.recurringItemId)!;
    }

    const id = randomUUID();
    this.driver.run(`
      INSERT INTO bill_preferences (id, recurringItemId, preferredDueDay, notes)
      VALUES (?, ?, ?, ?)
    `, [id, data.recurringItemId, data.preferredDueDay ?? null, data.notes ?? null]);

    return {
      id,
      recurringItemId: data.recurringItemId,
      preferredDueDay: data.preferredDueDay ?? null,
      notes: data.notes ?? null,
    };
  }

  deleteBillPreference(recurringItemId: string): boolean {
    const result = this.driver.run(
      'DELETE FROM bill_preferences WHERE recurringItemId = ?'
    , [recurringItemId]);
    return result.changes > 0;
  }

  // ==================== Investment Account CRUD (v1.1) ====================

  getInvestmentAccounts(): InvestmentAccount[] {
    const rows = this.driver.all('SELECT * FROM investment_accounts ORDER BY created_at DESC');
    return rows.map(this.mapInvestmentAccount);
  }

  getInvestmentAccountById(id: string): InvestmentAccount | null {
    const row = this.driver.get('SELECT * FROM investment_accounts WHERE id = ?', [id]);
    return row ? this.mapInvestmentAccount(row) : null;
  }

  createInvestmentAccount(account: Omit<InvestmentAccount, 'id' | 'createdAt'>): InvestmentAccount {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO investment_accounts (id, name, institution, account_type, owner_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id,
      account.name,
      account.institution,
      account.accountType,
      account.ownerId ?? null,
      createdAt]);

    return this.getInvestmentAccountById(id)!;
  }

  updateInvestmentAccount(id: string, updates: Partial<Omit<InvestmentAccount, 'id' | 'createdAt'>>): InvestmentAccount | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.institution !== undefined) {
      fields.push('institution = ?');
      values.push(updates.institution);
    }
    if (updates.accountType !== undefined) {
      fields.push('account_type = ?');
      values.push(updates.accountType);
    }
    if (updates.ownerId !== undefined) {
      fields.push('owner_id = ?');
      values.push(updates.ownerId);
    }

    if (fields.length === 0) return this.getInvestmentAccountById(id);

    values.push(id);
    this.driver.run(`UPDATE investment_accounts SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getInvestmentAccountById(id);
  }

  deleteInvestmentAccount(id: string): boolean {
    const result = this.driver.run('DELETE FROM investment_accounts WHERE id = ?', [id]);
    return result.changes > 0;
  }

  private mapInvestmentAccount(row: unknown): InvestmentAccount {
    const r = row as InvestmentAccountRow;
    return {
      id: r.id,
      name: r.name,
      institution: r.institution,
      accountType: r.account_type as InvestmentAccountType,
      ownerId: r.owner_id ?? null,
      isEncrypted: r.is_encrypted === 1,
      createdAt: new Date(r.created_at),
    };
  }

  // ==================== Holding CRUD (v1.1) ====================

  getHoldings(): Holding[] {
    const rows = this.driver.all('SELECT * FROM holdings ORDER BY created_at DESC');
    return rows.map(this.mapHolding);
  }

  getHoldingsByAccount(accountId: string): Holding[] {
    const rows = this.driver.all('SELECT * FROM holdings WHERE account_id = ? ORDER BY ticker ASC', [accountId]);
    return rows.map(this.mapHolding);
  }

  getHoldingById(id: string): Holding | null {
    const row = this.driver.get('SELECT * FROM holdings WHERE id = ?', [id]);
    return row ? this.mapHolding(row) : null;
  }

  createHolding(holding: Omit<Holding, 'id' | 'createdAt' | 'sharesOwned' | 'avgCostPerShare'>): Holding {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO holdings (id, account_id, ticker, name, shares_owned, avg_cost_per_share, current_price, sector, last_price_update, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id,
      holding.accountId,
      holding.ticker,
      holding.name,
      0, // shares_owned starts at 0, updated when lots are added
      0, // avg_cost_per_share starts at 0, updated when lots are added
      holding.currentPrice,
      holding.sector ?? null,
      holding.lastPriceUpdate.getTime(),
      createdAt]);

    return this.getHoldingById(id)!;
  }

  updateHolding(id: string, updates: Partial<Omit<Holding, 'id' | 'createdAt' | 'sharesOwned' | 'avgCostPerShare'>>): Holding | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.accountId !== undefined) {
      fields.push('account_id = ?');
      values.push(updates.accountId);
    }
    if (updates.ticker !== undefined) {
      fields.push('ticker = ?');
      values.push(updates.ticker);
    }
    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.currentPrice !== undefined) {
      fields.push('current_price = ?');
      values.push(updates.currentPrice);
    }
    if (updates.sector !== undefined) {
      fields.push('sector = ?');
      values.push(updates.sector);
    }
    if (updates.lastPriceUpdate !== undefined) {
      fields.push('last_price_update = ?');
      values.push(updates.lastPriceUpdate.getTime());
    }

    if (fields.length === 0) return this.getHoldingById(id);

    values.push(id);
    this.driver.run(`UPDATE holdings SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getHoldingById(id);
  }

  deleteHolding(id: string): boolean {
    const result = this.driver.run('DELETE FROM holdings WHERE id = ?', [id]);
    return result.changes > 0;
  }

  bulkDeleteHoldings(ids: string[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const result = this.driver.run(
      `DELETE FROM holdings WHERE id IN (${placeholders})`
    , ids);
    return result.changes;
  }

  recalculateHoldingAggregates(holdingId: string): void {
    // Get all lots for this holding
    const lots = this.getLotsByHolding(holdingId);

    if (lots.length === 0) {
      // No lots, set to 0
      this.driver.run(`
        UPDATE holdings
        SET shares_owned = 0, avg_cost_per_share = 0
        WHERE id = ?
      `, [holdingId]);
      return;
    }

    // Calculate total shares (sum of remaining shares)
    const totalShares = lots.reduce((sum, lot) => sum + lot.remainingShares, 0);

    // Calculate weighted average cost per share
    let weightedCostSum = 0;
    for (const lot of lots) {
      weightedCostSum += (lot.remainingShares * lot.costPerShare);
    }
    const avgCostPerShare = totalShares > 0 ? Math.round(weightedCostSum / totalShares) : 0;

    this.driver.run(`
      UPDATE holdings
      SET shares_owned = ?, avg_cost_per_share = ?
      WHERE id = ?
    `, [totalShares, avgCostPerShare, holdingId]);
  }

  private mapHolding(row: unknown): Holding {
    const r = row as HoldingRow;
    return {
      id: r.id,
      accountId: r.account_id,
      ticker: r.ticker,
      name: r.name,
      sharesOwned: r.shares_owned,
      avgCostPerShare: r.avg_cost_per_share,
      currentPrice: r.current_price,
      sector: r.sector,
      lastPriceUpdate: new Date(r.last_price_update),
      createdAt: new Date(r.created_at),
    };
  }

  // ==================== Cost Basis Lot CRUD (v1.1) ====================

  getLotsByHolding(holdingId: string): CostBasisLot[] {
    const rows = this.driver.all('SELECT * FROM cost_basis_lots WHERE holding_id = ? ORDER BY purchase_date ASC', [holdingId]);
    return rows.map(this.mapCostBasisLot);
  }

  getLotById(id: string): CostBasisLot | null {
    const row = this.driver.get('SELECT * FROM cost_basis_lots WHERE id = ?', [id]);
    return row ? this.mapCostBasisLot(row) : null;
  }

  createLot(lot: Omit<CostBasisLot, 'id' | 'createdAt'>): CostBasisLot {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO cost_basis_lots (id, holding_id, purchase_date, shares, cost_per_share, remaining_shares, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id,
      lot.holdingId,
      lot.purchaseDate.getTime(),
      lot.shares,
      lot.costPerShare,
      lot.remainingShares,
      createdAt]);

    // Recalculate holding aggregates
    this.recalculateHoldingAggregates(lot.holdingId);

    return this.getLotById(id)!;
  }

  updateLot(id: string, updates: Partial<Omit<CostBasisLot, 'id' | 'createdAt' | 'holdingId'>>): CostBasisLot | null {
    const lot = this.getLotById(id);
    if (!lot) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.purchaseDate !== undefined) {
      fields.push('purchase_date = ?');
      values.push(updates.purchaseDate.getTime());
    }
    if (updates.shares !== undefined) {
      fields.push('shares = ?');
      values.push(updates.shares);
    }
    if (updates.costPerShare !== undefined) {
      fields.push('cost_per_share = ?');
      values.push(updates.costPerShare);
    }
    if (updates.remainingShares !== undefined) {
      fields.push('remaining_shares = ?');
      values.push(updates.remainingShares);
    }

    if (fields.length === 0) return lot;

    values.push(id);
    this.driver.run(`UPDATE cost_basis_lots SET ${fields.join(', ')} WHERE id = ?`, values);

    // Recalculate holding aggregates
    this.recalculateHoldingAggregates(lot.holdingId);

    return this.getLotById(id);
  }

  deleteLot(id: string): boolean {
    const lot = this.getLotById(id);
    if (!lot) return false;

    const holdingId = lot.holdingId;
    const result = this.driver.run('DELETE FROM cost_basis_lots WHERE id = ?', [id]);

    if (result.changes > 0) {
      // Recalculate holding aggregates
      this.recalculateHoldingAggregates(holdingId);
      return true;
    }

    return false;
  }

  private mapCostBasisLot(row: unknown): CostBasisLot {
    const r = row as CostBasisLotRow;
    return {
      id: r.id,
      holdingId: r.holding_id,
      purchaseDate: new Date(r.purchase_date),
      shares: r.shares,
      costPerShare: r.cost_per_share,
      remainingShares: r.remaining_shares,
      createdAt: new Date(r.created_at),
    };
  }

  // ==================== Investment Transactions (Phase 3 v1.1) ====================

  getInvestmentTransactions(): InvestmentTransaction[] {
    const rows = this.driver.all('SELECT * FROM investment_transactions ORDER BY date DESC');
    return rows.map(row => this.mapInvestmentTransaction(row));
  }

  getInvestmentTransactionsByHolding(holdingId: string): InvestmentTransaction[] {
    const rows = this.driver.all(
      'SELECT * FROM investment_transactions WHERE holding_id = ? ORDER BY date DESC'
    , [holdingId]);
    return rows.map(row => this.mapInvestmentTransaction(row));
  }

  getInvestmentTransactionById(id: string): InvestmentTransaction | null {
    const row = this.driver.get('SELECT * FROM investment_transactions WHERE id = ?', [id]);
    return row ? this.mapInvestmentTransaction(row) : null;
  }

  createInvestmentTransaction(
    tx: Omit<InvestmentTransaction, 'id' | 'createdAt' | 'lotId'>
  ): InvestmentTransaction {
    const id = randomUUID();
    const createdAt = Date.now();
    let lotId: string | null = null;

    // Apply transaction effects based on type
    switch (tx.type) {
      case 'buy':
        lotId = this.applyBuyTransaction(tx, id);
        break;
      case 'sell':
        this.applySellTransaction(tx);
        break;
      case 'drip':
        lotId = this.applyDripTransaction(tx, id);
        break;
      case 'stock_split':
        this.applyStockSplit(tx);
        break;
      case 'dividend':
        // Dividend transactions don't affect share count
        break;
    }

    const dateTimestamp = tx.date instanceof Date ? tx.date.getTime() : tx.date;

    this.driver.run(`
      INSERT INTO investment_transactions (
        id, holding_id, type, date, shares, price_per_share, total_amount,
        fees, split_ratio, notes, lot_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id,
      tx.holdingId,
      tx.type,
      dateTimestamp,
      tx.shares,
      tx.pricePerShare,
      tx.totalAmount,
      tx.fees,
      tx.splitRatio || null,
      tx.notes || null,
      lotId,
      createdAt]);

    return this.getInvestmentTransactionById(id)!;
  }

  updateInvestmentTransaction(
    id: string,
    updates: Partial<Omit<InvestmentTransaction, 'id' | 'createdAt'>>
  ): InvestmentTransaction | null {
    const existing = this.getInvestmentTransactionById(id);
    if (!existing) return null;

    // Note: Updating transactions is complex because it may need to reverse
    // and reapply effects. For simplicity, we only allow updating non-affecting fields.
    const setClauses: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.date !== undefined) {
      setClauses.push('date = ?');
      values.push(updates.date instanceof Date ? updates.date.getTime() : updates.date);
    }
    if (updates.notes !== undefined) {
      setClauses.push('notes = ?');
      values.push(updates.notes || null);
    }
    if (updates.fees !== undefined) {
      setClauses.push('fees = ?');
      values.push(updates.fees);
    }

    if (setClauses.length === 0) return existing;

    values.push(id);
    this.driver.run(`UPDATE investment_transactions SET ${setClauses.join(', ')} WHERE id = ?`, values);

    return this.getInvestmentTransactionById(id);
  }

  deleteInvestmentTransaction(id: string): boolean {
    const tx = this.getInvestmentTransactionById(id);
    if (!tx) return false;

    // Reverse the transaction effects
    switch (tx.type) {
      case 'buy':
        this.reverseBuyTransaction(tx);
        break;
      case 'sell':
        this.reverseSellTransaction(tx);
        break;
      case 'drip':
        this.reverseDripTransaction(tx);
        break;
      case 'stock_split':
        this.reverseStockSplit(tx);
        break;
      case 'dividend':
        // Nothing to reverse
        break;
    }

    const result = this.driver.run('DELETE FROM investment_transactions WHERE id = ?', [id]);
    return result.changes > 0;
  }

  // Helper: Apply buy transaction - creates a new lot
  private applyBuyTransaction(
    tx: Omit<InvestmentTransaction, 'id' | 'createdAt' | 'lotId'>,
    _txId: string
  ): string {
    const lotId = randomUUID();
    const dateTimestamp = tx.date instanceof Date ? tx.date.getTime() : tx.date;

    // Create new cost basis lot
    this.driver.run(`
      INSERT INTO cost_basis_lots (id, holding_id, purchase_date, shares, cost_per_share, remaining_shares, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [lotId,
      tx.holdingId,
      dateTimestamp,
      tx.shares,
      tx.pricePerShare,
      tx.shares,
      Date.now()]);

    // Recalculate holding aggregates
    this.recalculateHoldingAggregates(tx.holdingId);

    return lotId;
  }

  // Helper: Apply sell transaction - reduces lots using FIFO
  private applySellTransaction(tx: Omit<InvestmentTransaction, 'id' | 'createdAt' | 'lotId'>): void {
    let sharesToSell = Math.abs(tx.shares);

    // Get lots ordered by purchase date (FIFO)
    const lots = this.driver.all<CostBasisLotRow>(`
      SELECT * FROM cost_basis_lots
      WHERE holding_id = ? AND remaining_shares > 0
      ORDER BY purchase_date ASC
    `, [tx.holdingId]);

    for (const lot of lots) {
      if (sharesToSell <= 0) break;

      const sharesToDeduct = Math.min(lot.remaining_shares, sharesToSell);
      const newRemaining = lot.remaining_shares - sharesToDeduct;

      this.driver.run('UPDATE cost_basis_lots SET remaining_shares = ? WHERE id = ?', [newRemaining, lot.id]);

      sharesToSell -= sharesToDeduct;
    }

    // Recalculate holding aggregates
    this.recalculateHoldingAggregates(tx.holdingId);
  }

  // Helper: Apply DRIP transaction - creates a new lot from reinvested dividends
  private applyDripTransaction(
    tx: Omit<InvestmentTransaction, 'id' | 'createdAt' | 'lotId'>,
    txId: string
  ): string {
    // DRIP is essentially a buy with the dividend amount
    return this.applyBuyTransaction(tx, txId);
  }

  // Helper: Apply stock split - adjusts all lots and holding
  private applyStockSplit(tx: Omit<InvestmentTransaction, 'id' | 'createdAt' | 'lotId'>): void {
    if (!tx.splitRatio) return;

    const [fromStr, toStr] = tx.splitRatio.split(':');
    const fromShares = parseInt(fromStr, 10);
    const toShares = parseInt(toStr, 10);

    if (fromShares <= 0 || toShares <= 0) return;

    const multiplier = toShares / fromShares;

    // Get all lots for this holding
    const lots = this.driver.all<CostBasisLotRow>('SELECT * FROM cost_basis_lots WHERE holding_id = ?', [tx.holdingId]);

    for (const lot of lots) {
      const newShares = Math.round(lot.shares * multiplier);
      const newRemaining = Math.round(lot.remaining_shares * multiplier);
      const newCostPerShare = Math.round(lot.cost_per_share / multiplier);

      this.driver.run(`
        UPDATE cost_basis_lots
        SET shares = ?, remaining_shares = ?, cost_per_share = ?
        WHERE id = ?
      `, [newShares, newRemaining, newCostPerShare, lot.id]);
    }

    // Recalculate holding aggregates
    this.recalculateHoldingAggregates(tx.holdingId);
  }

  // Helper: Reverse buy transaction
  private reverseBuyTransaction(tx: InvestmentTransaction): void {
    if (tx.lotId) {
      this.driver.run('DELETE FROM cost_basis_lots WHERE id = ?', [tx.lotId]);
      this.recalculateHoldingAggregates(tx.holdingId);
    }
  }

  // Helper: Reverse sell transaction - restore shares to lots (simplified)
  private reverseSellTransaction(tx: InvestmentTransaction): void {
    // This is a simplified reversal - in production you'd track which lots were affected
    // For now, create a new lot with the sold shares
    const lotId = randomUUID();
    const dateTimestamp = tx.date instanceof Date ? tx.date.getTime() : tx.date;

    this.driver.run(`
      INSERT INTO cost_basis_lots (id, holding_id, purchase_date, shares, cost_per_share, remaining_shares, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [lotId,
      tx.holdingId,
      dateTimestamp,
      Math.abs(tx.shares),
      tx.pricePerShare,
      Math.abs(tx.shares),
      Date.now()]);

    this.recalculateHoldingAggregates(tx.holdingId);
  }

  // Helper: Reverse DRIP transaction
  private reverseDripTransaction(tx: InvestmentTransaction): void {
    this.reverseBuyTransaction(tx);
  }

  // Helper: Reverse stock split
  private reverseStockSplit(tx: InvestmentTransaction): void {
    if (!tx.splitRatio) return;

    const [fromStr, toStr] = tx.splitRatio.split(':');
    const fromShares = parseInt(fromStr, 10);
    const toShares = parseInt(toStr, 10);

    if (fromShares <= 0 || toShares <= 0) return;

    // Reverse multiplier
    const multiplier = fromShares / toShares;

    const reverseLots = this.driver.all<CostBasisLotRow>('SELECT * FROM cost_basis_lots WHERE holding_id = ?', [tx.holdingId]);

    for (const lot of reverseLots) {
      const newShares = Math.round(lot.shares * multiplier);
      const newRemaining = Math.round(lot.remaining_shares * multiplier);
      const newCostPerShare = Math.round(lot.cost_per_share / multiplier);

      this.driver.run(`
        UPDATE cost_basis_lots
        SET shares = ?, remaining_shares = ?, cost_per_share = ?
        WHERE id = ?
      `, [newShares, newRemaining, newCostPerShare, lot.id]);
    }

    this.recalculateHoldingAggregates(tx.holdingId);
  }

  // Helper: Calculate investment totals from lots
  calculateInvestmentTotals(holdingId: string): { shares: number; avgCost: number } {
    const lots = this.driver.get<{ total_shares: number | null; total_cost: number | null }>(`
      SELECT SUM(remaining_shares) as total_shares,
             SUM(remaining_shares * cost_per_share) as total_cost
      FROM cost_basis_lots
      WHERE holding_id = ? AND remaining_shares > 0
    `, [holdingId]);

    const totalShares = lots!.total_shares || 0;
    const totalCost = lots!.total_cost || 0;
    const avgCost = totalShares > 0 ? Math.round(totalCost / totalShares) : 0;

    return { shares: totalShares, avgCost };
  }

  private mapInvestmentTransaction(row: unknown): InvestmentTransaction {
    const r = row as InvestmentTransactionRow;
    return {
      id: r.id,
      holdingId: r.holding_id,
      type: r.type as InvestmentTransactionType,
      date: new Date(r.date),
      shares: r.shares,
      pricePerShare: r.price_per_share,
      totalAmount: r.total_amount,
      fees: r.fees,
      splitRatio: r.split_ratio,
      notes: r.notes,
      lotId: r.lot_id,
      createdAt: new Date(r.created_at),
    };
  }

  // ==================== Investment Settings ====================

  getInvestmentSettings(): InvestmentSettings | null {
    const row = this.driver.get('SELECT * FROM investment_settings LIMIT 1');
    return row ? this.mapInvestmentSettings(row) : null;
  }

  createOrUpdateInvestmentSettings(
    updates: Partial<InvestmentSettings>
  ): InvestmentSettings {
    const existing = this.getInvestmentSettings();
    const now = Date.now();

    if (existing) {
      const setClauses: string[] = [];
      const values: (string | number)[] = [];

      if (updates.concentrationThreshold !== undefined) {
        setClauses.push('concentration_threshold = ?');
        values.push(updates.concentrationThreshold);
      }
      if (updates.defaultSectorAllocation !== undefined) {
        setClauses.push('default_sector_allocation = ?');
        values.push(updates.defaultSectorAllocation);
      }
      setClauses.push('updated_at = ?');
      values.push(now);
      values.push(existing.id);

      this.driver.run(`UPDATE investment_settings SET ${setClauses.join(', ')} WHERE id = ?`, values);
      return this.getInvestmentSettings()!;
    } else {
      const id = randomUUID();
      this.driver.run(`
        INSERT INTO investment_settings (id, concentration_threshold, default_sector_allocation, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `, [id,
        updates.concentrationThreshold ?? 25,
        updates.defaultSectorAllocation ?? '{}',
        now,
        now]);
      return this.getInvestmentSettings()!;
    }
  }

  private mapInvestmentSettings(row: unknown): InvestmentSettings {
    const r = row as InvestmentSettingsRow;
    return {
      id: r.id,
      concentrationThreshold: r.concentration_threshold,
      defaultSectorAllocation: r.default_sector_allocation,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    };
  }

  // ==================== Performance Analytics (Phase 4) ====================

  /**
   * Get all sell transactions for performance calculations.
   */
  getSellTransactions(): Array<{
    id: string;
    holdingId: string;
    ticker: string;
    date: number;
    shares: number;
    pricePerShare: number;
    fees: number;
    costBasis: number;
    purchaseDate: number;
  }> {
    interface SellTxRow {
      id: string;
      holding_id: string;
      ticker: string;
      date: number;
      shares: number;
      price_per_share: number;
      fees: number | null;
      cost_basis: number;
      purchase_date: number;
    }
    const rows = this.driver.all<SellTxRow>(`
      SELECT
        t.id,
        t.holding_id,
        h.ticker,
        t.date,
        t.shares,
        t.price_per_share,
        t.fees,
        COALESCE(l.cost_per_share * ABS(t.shares), 0) as cost_basis,
        COALESCE(l.purchase_date, t.date) as purchase_date
      FROM investment_transactions t
      JOIN holdings h ON t.holding_id = h.id
      LEFT JOIN cost_basis_lots l ON t.lot_id = l.id
      WHERE t.type = 'sell'
      ORDER BY t.date DESC
    `);
    return rows.map(row => ({
      id: row.id,
      holdingId: row.holding_id,
      ticker: row.ticker,
      date: row.date,
      shares: row.shares,
      pricePerShare: row.price_per_share,
      fees: row.fees ?? 0,
      costBasis: row.cost_basis,
      purchaseDate: row.purchase_date,
    }));
  }

  /**
   * Get sell transactions within a date range.
   */
  getSellTransactionsByDateRange(
    startDate: Date,
    endDate: Date
  ): Array<{
    id: string;
    holdingId: string;
    ticker: string;
    date: number;
    shares: number;
    pricePerShare: number;
    fees: number;
    costBasis: number;
    purchaseDate: number;
  }> {
    interface SellTxRow {
      id: string;
      holding_id: string;
      ticker: string;
      date: number;
      shares: number;
      price_per_share: number;
      fees: number | null;
      cost_basis: number;
      purchase_date: number;
    }
    const rows = this.driver.all<SellTxRow>(`
      SELECT
        t.id,
        t.holding_id,
        h.ticker,
        t.date,
        t.shares,
        t.price_per_share,
        t.fees,
        COALESCE(l.cost_per_share * ABS(t.shares), 0) as cost_basis,
        COALESCE(l.purchase_date, t.date) as purchase_date
      FROM investment_transactions t
      JOIN holdings h ON t.holding_id = h.id
      LEFT JOIN cost_basis_lots l ON t.lot_id = l.id
      WHERE t.type = 'sell'
        AND t.date >= ?
        AND t.date <= ?
      ORDER BY t.date DESC
    `, [startDate.getTime(), endDate.getTime()]);
    return rows.map(row => ({
      id: row.id,
      holdingId: row.holding_id,
      ticker: row.ticker,
      date: row.date,
      shares: row.shares,
      pricePerShare: row.price_per_share,
      fees: row.fees ?? 0,
      costBasis: row.cost_basis,
      purchaseDate: row.purchase_date,
    }));
  }

  /**
   * Get investment cash flow events (contributions and withdrawals).
   * Currently we don't have a dedicated cash flow table, so this returns dividend transactions
   * as they represent income events. In the future, this can be expanded to track
   * account-level contributions and withdrawals.
   */
  getInvestmentCashFlows(): Array<{
    id: string;
    date: number;
    amount: number;
    type: string;
  }> {
    interface CashFlowRow {
      id: string;
      date: number;
      amount: number;
      type: string;
    }
    // Return dividend transactions as cash flow events
    const rows = this.driver.all<CashFlowRow>(`
      SELECT
        id,
        date,
        CASE
          WHEN type = 'dividend' THEN price_per_share
          ELSE 0
        END as amount,
        'dividend' as type
      FROM investment_transactions
      WHERE type = 'dividend'
      ORDER BY date ASC
    `);
    return rows.map(row => ({
      id: row.id,
      date: row.date,
      amount: row.amount,
      type: row.type,
    }));
  }

  // ==================== App Settings ====================

  /**
   * Get a setting value.
   */
  getSetting(key: string, defaultValue: string): string {
    // Check if app_settings table exists
    const tableCheck = this.driver.get<{ name: string }>(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'
    `);

    if (!tableCheck) {
      // Create table if it doesn't exist
      this.driver.run(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
      return defaultValue;
    }

    const row = this.driver.get<{ value: string }>(`
      SELECT value FROM app_settings WHERE key = ?
    `, [key]);

    return row?.value ?? defaultValue;
  }

  /**
   * Set a setting value.
   */
  setSetting(key: string, value: string): void {
    // Ensure table exists
    this.driver.run(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    this.driver.run(`
      INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)
    `, [key, value]);
  }

  // ==================== Phase 5: Net Worth Integration ====================

  // Manual Assets CRUD
  getManualAssets(): ManualAsset[] {
    const rows = this.driver.all('SELECT * FROM manual_assets ORDER BY value DESC');
    return rows.map(this.mapManualAsset);
  }

  getManualAssetById(id: string): ManualAsset | null {
    const row = this.driver.get('SELECT * FROM manual_assets WHERE id = ?', [id]);
    return row ? this.mapManualAsset(row) : null;
  }

  createManualAsset(asset: Omit<ManualAsset, 'id' | 'createdAt' | 'lastUpdated'>): ManualAsset {
    const id = randomUUID();
    const now = Date.now();

    this.driver.run(`
      INSERT INTO manual_assets (
        id, name, category, custom_category, value, liquidity, notes,
        reminder_frequency, last_reminder_date, next_reminder_date,
        owner_id, last_updated, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id,
      asset.name,
      asset.category,
      asset.customCategory ?? null,
      asset.value,
      asset.liquidity,
      asset.notes ?? null,
      asset.reminderFrequency ?? null,
      asset.lastReminderDate ? asset.lastReminderDate.getTime() : null,
      asset.nextReminderDate ? asset.nextReminderDate.getTime() : null,
      asset.ownerId ?? null,
      now,
      now]);

    return this.getManualAssetById(id)!;
  }

  updateManualAsset(id: string, updates: Partial<Omit<ManualAsset, 'id' | 'createdAt'>>): ManualAsset | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.category !== undefined) {
      fields.push('category = ?');
      values.push(updates.category);
    }
    if (updates.customCategory !== undefined) {
      fields.push('custom_category = ?');
      values.push(updates.customCategory);
    }
    if (updates.value !== undefined) {
      fields.push('value = ?');
      values.push(updates.value);
    }
    if (updates.liquidity !== undefined) {
      fields.push('liquidity = ?');
      values.push(updates.liquidity);
    }
    if (updates.notes !== undefined) {
      fields.push('notes = ?');
      values.push(updates.notes);
    }
    if (updates.reminderFrequency !== undefined) {
      fields.push('reminder_frequency = ?');
      values.push(updates.reminderFrequency);
    }
    if (updates.lastReminderDate !== undefined) {
      fields.push('last_reminder_date = ?');
      values.push(updates.lastReminderDate ? updates.lastReminderDate.getTime() : null);
    }
    if (updates.nextReminderDate !== undefined) {
      fields.push('next_reminder_date = ?');
      values.push(updates.nextReminderDate ? updates.nextReminderDate.getTime() : null);
    }
    if (updates.lastUpdated !== undefined) {
      fields.push('last_updated = ?');
      values.push(updates.lastUpdated.getTime());
    }
    if (updates.ownerId !== undefined) {
      fields.push('owner_id = ?');
      values.push(updates.ownerId);
    }

    if (fields.length === 0) return this.getManualAssetById(id);

    // Always update last_updated timestamp
    if (!updates.lastUpdated) {
      fields.push('last_updated = ?');
      values.push(Date.now());
    }

    values.push(id);
    this.driver.run(`UPDATE manual_assets SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getManualAssetById(id);
  }

  deleteManualAsset(id: string): boolean {
    const result = this.driver.run('DELETE FROM manual_assets WHERE id = ?', [id]);
    return result.changes > 0;
  }

  getAssetsWithDueReminders(): ManualAsset[] {
    const now = Date.now();
    const rows = this.driver.all(`
      SELECT * FROM manual_assets
      WHERE reminder_frequency IS NOT NULL
        AND next_reminder_date IS NOT NULL
        AND next_reminder_date <= ?
      ORDER BY next_reminder_date ASC
    `, [now]);
    return rows.map(this.mapManualAsset);
  }

  private mapManualAsset(row: unknown): ManualAsset {
    const r = row as ManualAssetRow;
    return {
      id: r.id,
      name: r.name,
      category: r.category as ManualAssetCategory,
      customCategory: r.custom_category,
      value: r.value,
      liquidity: r.liquidity as AssetLiquidity,
      notes: r.notes,
      reminderFrequency: r.reminder_frequency as 'monthly' | 'quarterly' | 'yearly' | null,
      lastReminderDate: r.last_reminder_date ? new Date(r.last_reminder_date) : null,
      nextReminderDate: r.next_reminder_date ? new Date(r.next_reminder_date) : null,
      ownerId: r.owner_id ?? null,
      isEncrypted: r.is_encrypted === 1,
      lastUpdated: new Date(r.last_updated),
      createdAt: new Date(r.created_at),
    };
  }

  // Manual Liabilities CRUD
  getManualLiabilities(): ManualLiability[] {
    const rows = this.driver.all('SELECT * FROM manual_liabilities ORDER BY balance DESC');
    return rows.map(this.mapManualLiability);
  }

  getManualLiabilityById(id: string): ManualLiability | null {
    const row = this.driver.get('SELECT * FROM manual_liabilities WHERE id = ?', [id]);
    return row ? this.mapManualLiability(row) : null;
  }

  createManualLiability(liability: Omit<ManualLiability, 'id' | 'createdAt' | 'lastUpdated'>): ManualLiability {
    const id = randomUUID();
    const now = Date.now();

    this.driver.run(`
      INSERT INTO manual_liabilities (
        id, name, type, balance, interest_rate, monthly_payment,
        original_amount, start_date, term_months, payoff_date, total_interest,
        last_updated, notes, owner_id, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id,
      liability.name,
      liability.type,
      liability.balance,
      liability.interestRate,
      liability.monthlyPayment,
      liability.originalAmount ?? null,
      liability.startDate ? liability.startDate.getTime() : null,
      liability.termMonths ?? null,
      liability.payoffDate ? liability.payoffDate.getTime() : null,
      liability.totalInterest ?? null,
      now,
      liability.notes ?? null,
      liability.ownerId ?? null,
      now]);

    return this.getManualLiabilityById(id)!;
  }

  updateManualLiability(id: string, updates: Partial<Omit<ManualLiability, 'id' | 'createdAt'>>): ManualLiability | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      values.push(updates.type);
    }
    if (updates.balance !== undefined) {
      fields.push('balance = ?');
      values.push(updates.balance);
    }
    if (updates.interestRate !== undefined) {
      fields.push('interest_rate = ?');
      values.push(updates.interestRate);
    }
    if (updates.monthlyPayment !== undefined) {
      fields.push('monthly_payment = ?');
      values.push(updates.monthlyPayment);
    }
    if (updates.originalAmount !== undefined) {
      fields.push('original_amount = ?');
      values.push(updates.originalAmount);
    }
    if (updates.startDate !== undefined) {
      fields.push('start_date = ?');
      values.push(updates.startDate ? updates.startDate.getTime() : null);
    }
    if (updates.termMonths !== undefined) {
      fields.push('term_months = ?');
      values.push(updates.termMonths);
    }
    if (updates.payoffDate !== undefined) {
      fields.push('payoff_date = ?');
      values.push(updates.payoffDate ? updates.payoffDate.getTime() : null);
    }
    if (updates.totalInterest !== undefined) {
      fields.push('total_interest = ?');
      values.push(updates.totalInterest);
    }
    if (updates.notes !== undefined) {
      fields.push('notes = ?');
      values.push(updates.notes);
    }
    if (updates.lastUpdated !== undefined) {
      fields.push('last_updated = ?');
      values.push(updates.lastUpdated.getTime());
    }
    if (updates.ownerId !== undefined) {
      fields.push('owner_id = ?');
      values.push(updates.ownerId);
    }

    if (fields.length === 0) return this.getManualLiabilityById(id);

    // Always update last_updated timestamp
    if (!updates.lastUpdated) {
      fields.push('last_updated = ?');
      values.push(Date.now());
    }

    values.push(id);
    this.driver.run(`UPDATE manual_liabilities SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getManualLiabilityById(id);
  }

  deleteManualLiability(id: string): boolean {
    const result = this.driver.run('DELETE FROM manual_liabilities WHERE id = ?', [id]);
    return result.changes > 0;
  }

  private mapManualLiability(row: unknown): ManualLiability {
    const r = row as ManualLiabilityRow;
    return {
      id: r.id,
      name: r.name,
      type: r.type as ManualLiabilityType,
      balance: r.balance,
      interestRate: r.interest_rate,
      monthlyPayment: r.monthly_payment,
      originalAmount: r.original_amount,
      startDate: r.start_date ? new Date(r.start_date) : null,
      termMonths: r.term_months,
      payoffDate: r.payoff_date ? new Date(r.payoff_date) : null,
      totalInterest: r.total_interest,
      ownerId: r.owner_id ?? null,
      isEncrypted: r.is_encrypted === 1,
      lastUpdated: new Date(r.last_updated),
      notes: r.notes,
      createdAt: new Date(r.created_at),
    };
  }

  // Net Worth Snapshots
  getNetWorthSnapshots(limit?: number): NetWorthSnapshot[] {
    const query = limit
      ? `SELECT * FROM net_worth_snapshots ORDER BY date DESC LIMIT ${limit}`
      : 'SELECT * FROM net_worth_snapshots ORDER BY date DESC';
    const rows = this.driver.all(query);
    return rows.map(this.mapNetWorthSnapshot);
  }

  getNetWorthSnapshotsByDateRange(startDate: number, endDate: number): NetWorthSnapshot[] {
    const rows = this.driver.all(`
      SELECT * FROM net_worth_snapshots
      WHERE date >= ? AND date <= ?
      ORDER BY date ASC
    `, [startDate, endDate]);
    return rows.map(this.mapNetWorthSnapshot);
  }

  getLatestNetWorthSnapshot(): NetWorthSnapshot | null {
    const row = this.driver.get('SELECT * FROM net_worth_snapshots ORDER BY date DESC LIMIT 1');
    return row ? this.mapNetWorthSnapshot(row) : null;
  }

  createNetWorthSnapshot(snapshot: Omit<NetWorthSnapshot, 'id' | 'createdAt'>): NetWorthSnapshot {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO net_worth_snapshots (
        id, date, bank_accounts_total, investment_accounts_total, manual_assets_total,
        total_assets, manual_liabilities_total, total_liabilities, net_worth,
        asset_breakdown, liability_breakdown, change_from_previous, change_percent_from_previous,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id,
      snapshot.date.getTime(),
      snapshot.bankAccountsTotal,
      snapshot.investmentAccountsTotal,
      snapshot.manualAssetsTotal,
      snapshot.totalAssets,
      snapshot.manualLiabilitiesTotal,
      snapshot.totalLiabilities,
      snapshot.netWorth,
      snapshot.assetBreakdown,
      snapshot.liabilityBreakdown,
      snapshot.changeFromPrevious ?? null,
      snapshot.changePercentFromPrevious ?? null,
      createdAt]);

    return this.getNetWorthSnapshotById(id)!;
  }

  private getNetWorthSnapshotById(id: string): NetWorthSnapshot | null {
    const row = this.driver.get('SELECT * FROM net_worth_snapshots WHERE id = ?', [id]);
    return row ? this.mapNetWorthSnapshot(row) : null;
  }

  private mapNetWorthSnapshot(row: unknown): NetWorthSnapshot {
    const r = row as NetWorthSnapshotRow;
    return {
      id: r.id,
      date: new Date(r.date),
      bankAccountsTotal: r.bank_accounts_total,
      investmentAccountsTotal: r.investment_accounts_total,
      manualAssetsTotal: r.manual_assets_total,
      totalAssets: r.total_assets,
      manualLiabilitiesTotal: r.manual_liabilities_total,
      totalLiabilities: r.total_liabilities,
      netWorth: r.net_worth,
      assetBreakdown: r.asset_breakdown,
      liabilityBreakdown: r.liability_breakdown,
      changeFromPrevious: r.change_from_previous,
      changePercentFromPrevious: r.change_percent_from_previous,
      createdAt: new Date(r.created_at),
    };
  }

  // Asset Value History
  getAssetValueHistory(assetId: string): AssetValueHistory[] {
    const rows = this.driver.all(`
      SELECT * FROM asset_value_history
      WHERE asset_id = ?
      ORDER BY date DESC
    `, [assetId]);
    return rows.map(this.mapAssetValueHistory);
  }

  createAssetValueHistory(history: Omit<AssetValueHistory, 'id' | 'createdAt'>): AssetValueHistory {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO asset_value_history (id, asset_id, value, date, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id,
      history.assetId,
      history.value,
      history.date.getTime(),
      history.source,
      createdAt]);

    return this.getAssetValueHistoryById(id)!;
  }

  private getAssetValueHistoryById(id: string): AssetValueHistory | null {
    const row = this.driver.get('SELECT * FROM asset_value_history WHERE id = ?', [id]);
    return row ? this.mapAssetValueHistory(row) : null;
  }

  private mapAssetValueHistory(row: unknown): AssetValueHistory {
    const r = row as AssetValueHistoryRow;
    return {
      id: r.id,
      assetId: r.asset_id,
      value: r.value,
      date: new Date(r.date),
      source: r.source as 'manual' | 'reminder',
      createdAt: new Date(r.created_at),
    };
  }

  // Liability Value History
  getLiabilityValueHistory(liabilityId: string): LiabilityValueHistory[] {
    const rows = this.driver.all(`
      SELECT * FROM liability_value_history
      WHERE liability_id = ?
      ORDER BY date DESC
    `, [liabilityId]);
    return rows.map(this.mapLiabilityValueHistory);
  }

  createLiabilityValueHistory(history: Omit<LiabilityValueHistory, 'id' | 'createdAt'>): LiabilityValueHistory {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO liability_value_history (id, liability_id, balance, date, payment_amount, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id,
      history.liabilityId,
      history.balance,
      history.date.getTime(),
      history.paymentAmount ?? null,
      createdAt]);

    return this.getLiabilityValueHistoryById(id)!;
  }

  private getLiabilityValueHistoryById(id: string): LiabilityValueHistory | null {
    const row = this.driver.get('SELECT * FROM liability_value_history WHERE id = ?', [id]);
    return row ? this.mapLiabilityValueHistory(row) : null;
  }

  private mapLiabilityValueHistory(row: unknown): LiabilityValueHistory {
    const r = row as LiabilityValueHistoryRow;
    return {
      id: r.id,
      liabilityId: r.liability_id,
      balance: r.balance,
      date: new Date(r.date),
      paymentAmount: r.payment_amount,
      createdAt: new Date(r.created_at),
    };
  }

  // ==================== Transaction Reimbursement Methods ====================

  createReimbursementLink(data: {
    expenseTransactionId: string;
    reimbursementTransactionId: string;
    amount: number;
  }): TransactionReimbursement {
    const id = randomUUID();
    const now = Date.now();

    // Wrap in transaction for atomicity
    this.driver.transaction(() => {
      // Validate expense exists and is negative (expense)
      const expense = this.driver.get<{ id: string; amount: number; categoryId: string | null }>(
        'SELECT id, amount, categoryId FROM transactions WHERE id = ?', [data.expenseTransactionId]
      );
      if (!expense) throw new Error('Expense transaction not found');
      if (expense.amount >= 0) throw new Error('Target transaction is not an expense');

      // Validate income exists and is positive
      const income = this.driver.get<{ id: string; amount: number }>(
        'SELECT id, amount FROM transactions WHERE id = ?', [data.reimbursementTransactionId]
      );
      if (!income) throw new Error('Reimbursement transaction not found');
      if (income.amount <= 0) throw new Error('Reimbursement transaction must have positive amount');

      // Validate total reimbursement doesn't exceed expense
      const existingTotal = this.driver.get<{ total: number }>(
        'SELECT COALESCE(SUM(amount), 0) as total FROM transaction_reimbursements WHERE expenseTransactionId = ?',
        [data.expenseTransactionId]
      );

      const expenseAbs = Math.abs(expense.amount);
      if (existingTotal!.total + data.amount > expenseAbs) {
        throw new Error(`Reimbursement total would exceed expense amount. Remaining: ${expenseAbs - existingTotal!.total}`);
      }

      // Validate total from this income doesn't exceed its amount
      const incomeLinkedTotal = this.driver.get<{ total: number }>(
        'SELECT COALESCE(SUM(amount), 0) as total FROM transaction_reimbursements WHERE reimbursementTransactionId = ?',
        [data.reimbursementTransactionId]
      );

      if (incomeLinkedTotal!.total + data.amount > income.amount) {
        throw new Error(`Linked total would exceed income amount. Remaining: ${income.amount - incomeLinkedTotal!.total}`);
      }

      // Insert the link
      this.driver.run(`
        INSERT INTO transaction_reimbursements (id, expenseTransactionId, reimbursementTransactionId, amount, createdAt)
        VALUES (?, ?, ?, ?, ?)
      `, [id, data.expenseTransactionId, data.reimbursementTransactionId, data.amount, now]);

      // Update income transaction's categoryId to match expense
      if (expense.categoryId) {
        this.driver.run('UPDATE transactions SET categoryId = ? WHERE id = ?', [expense.categoryId, data.reimbursementTransactionId]);
      }
    });

    return {
      id,
      expenseTransactionId: data.expenseTransactionId,
      reimbursementTransactionId: data.reimbursementTransactionId,
      amount: data.amount,
      createdAt: new Date(now),
    };
  }

  deleteReimbursementLink(id: string): boolean {
    const result = this.driver.run('DELETE FROM transaction_reimbursements WHERE id = ?', [id]);
    return result.changes > 0;
  }

  getReimbursementsForExpense(expenseId: string): TransactionReimbursement[] {
    const rows = this.driver.all<{ id: string; expenseTransactionId: string; reimbursementTransactionId: string; amount: number; createdAt: number }>(
      'SELECT * FROM transaction_reimbursements WHERE expenseTransactionId = ?',
      [expenseId]
    );

    return rows.map(r => ({
      id: r.id,
      expenseTransactionId: r.expenseTransactionId,
      reimbursementTransactionId: r.reimbursementTransactionId,
      amount: r.amount,
      createdAt: new Date(r.createdAt),
    }));
  }

  getReimbursementsForIncome(incomeId: string): TransactionReimbursement[] {
    const rows = this.driver.all<{ id: string; expenseTransactionId: string; reimbursementTransactionId: string; amount: number; createdAt: number }>(
      'SELECT * FROM transaction_reimbursements WHERE reimbursementTransactionId = ?',
      [incomeId]
    );

    return rows.map(r => ({
      id: r.id,
      expenseTransactionId: r.expenseTransactionId,
      reimbursementTransactionId: r.reimbursementTransactionId,
      amount: r.amount,
      createdAt: new Date(r.createdAt),
    }));
  }

  getAllReimbursementLinks(): TransactionReimbursement[] {
    const rows = this.driver.all<{ id: string; expenseTransactionId: string; reimbursementTransactionId: string; amount: number; createdAt: number }>(
      'SELECT * FROM transaction_reimbursements'
    );

    return rows.map(r => ({
      id: r.id,
      expenseTransactionId: r.expenseTransactionId,
      reimbursementTransactionId: r.reimbursementTransactionId,
      amount: r.amount,
      createdAt: new Date(r.createdAt),
    }));
  }

  validateReimbursementAmount(expenseId: string, amount: number, excludeLinkId?: string): { valid: boolean; remaining: number } {
    const expense = this.driver.get<{ amount: number }>('SELECT amount FROM transactions WHERE id = ?', [expenseId]);
    if (!expense) return { valid: false, remaining: 0 };

    const expenseAbs = Math.abs(expense.amount);
    let query = 'SELECT COALESCE(SUM(amount), 0) as total FROM transaction_reimbursements WHERE expenseTransactionId = ?';
    const params: (string | number)[] = [expenseId];

    if (excludeLinkId) {
      query += ' AND id != ?';
      params.push(excludeLinkId);
    }

    const result = this.driver.get<{ total: number }>(query, params);
    const remaining = expenseAbs - result!.total;

    return {
      valid: amount <= remaining,
      remaining,
    };
  }

  getReimbursementSummary(transactionId: string): ReimbursementSummary {
    const tx = this.driver.get<{ amount: number }>('SELECT amount FROM transactions WHERE id = ?', [transactionId]);
    if (!tx) {
      return { status: 'none' as ReimbursementStatus, originalAmount: 0, totalReimbursed: 0, netAmount: 0, links: [] };
    }

    const links = this.getReimbursementsForExpense(transactionId);
    const totalReimbursed = links.reduce((sum, l) => sum + l.amount, 0);
    const originalAmount = Math.abs(tx.amount);
    const netAmount = originalAmount - totalReimbursed;

    let status: ReimbursementStatus = 'none';
    if (totalReimbursed > 0 && totalReimbursed < originalAmount) {
      status = 'partial';
    } else if (totalReimbursed >= originalAmount) {
      status = 'full';
    }

    return { status, originalAmount, totalReimbursed, netAmount, links };
  }

  getCandidateReimbursementTransactions(expenseId: string): Transaction[] {
    // Get the expense to know its date for proximity sorting
    const expense = this.driver.get<{ date: number }>('SELECT date FROM transactions WHERE id = ?', [expenseId]);
    if (!expense) return [];

    // Income transactions that are not internal transfers, ordered by date proximity to expense
    const rows = this.driver.all<unknown>(`
      SELECT t.*
      FROM transactions t
      WHERE t.amount > 0
        AND (t.isInternalTransfer IS NULL OR t.isInternalTransfer = 0)
        AND t.id NOT IN (
          SELECT reimbursementTransactionId FROM transaction_reimbursements
          WHERE expenseTransactionId = ?
        )
      ORDER BY ABS(t.date - ?) ASC
      LIMIT 100
    `, [expenseId, expense.date]);

    return rows.map((row: unknown) => this.mapTransaction(row));
  }

  // ==================== Saved Reports ====================

  getSavedReports(): SavedReport[] {
    const rows = this.driver.all('SELECT * FROM saved_reports ORDER BY name ASC');
    return rows.map(this.mapSavedReport);
  }

  getSavedReportById(id: string): SavedReport | null {
    const row = this.driver.get('SELECT * FROM saved_reports WHERE id = ?', [id]);
    return row ? this.mapSavedReport(row) : null;
  }

  createSavedReport(name: string, config: string): SavedReport {
    const id = randomUUID();
    const now = Date.now();

    this.driver.run(`
      INSERT INTO saved_reports (id, name, config, createdAt, lastAccessedAt)
      VALUES (?, ?, ?, ?, ?)
    `, [id, name, config, now, now]);

    return this.getSavedReportById(id)!;
  }

  updateSavedReport(id: string, updates: Partial<{ name: string; config: string; lastAccessedAt: number }>): SavedReport | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.config !== undefined) {
      fields.push('config = ?');
      values.push(updates.config);
    }
    if (updates.lastAccessedAt !== undefined) {
      fields.push('lastAccessedAt = ?');
      values.push(updates.lastAccessedAt);
    }

    if (fields.length === 0) return this.getSavedReportById(id);

    values.push(id);
    this.driver.run(`UPDATE saved_reports SET ${fields.join(', ')} WHERE id = ?`, values);

    return this.getSavedReportById(id);
  }

  deleteSavedReport(id: string): boolean {
    const result = this.driver.run('DELETE FROM saved_reports WHERE id = ?', [id]);
    return result.changes > 0;
  }

  getRecentReports(limit: number = 5): SavedReport[] {
    const rows = this.driver.all('SELECT * FROM saved_reports ORDER BY lastAccessedAt DESC LIMIT ?', [limit]);
    return rows.map(this.mapSavedReport);
  }

  private mapSavedReport(row: unknown): SavedReport {
    const r = row as SavedReportRow;
    return {
      id: r.id,
      name: r.name,
      config: r.config,
      createdAt: new Date(r.createdAt),
      lastAccessedAt: new Date(r.lastAccessedAt),
    };
  }

  // ==================== User Keys CRUD ====================

  getUserKeys(userId: string): UserKeys | null {
    const row = this.driver.get<UserKeyRow>('SELECT * FROM user_keys WHERE userId = ?', [userId]);
    return row ? this.mapUserKeys(row) : null;
  }

  setUserKeys(keys: UserKeys): void {
    this.driver.run(`
      INSERT OR REPLACE INTO user_keys (userId, publicKey, encryptedPrivateKey, privateKeyIv, privateKeyTag, encryptionSalt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      keys.userId,
      keys.publicKey,
      keys.encryptedPrivateKey,
      keys.privateKeyIv,
      keys.privateKeyTag,
      keys.encryptionSalt,
      keys.createdAt.getTime(),
    ]);
  }

  private mapUserKeys(row: UserKeyRow): UserKeys {
    return {
      userId: row.userId,
      publicKey: row.publicKey,
      encryptedPrivateKey: row.encryptedPrivateKey,
      privateKeyIv: row.privateKeyIv,
      privateKeyTag: row.privateKeyTag,
      encryptionSalt: row.encryptionSalt,
      createdAt: new Date(row.createdAt),
    };
  }

  // ==================== Data Encryption Keys CRUD ====================

  getDEK(id: string, entityType: EncryptableEntityType): { id: string; entityType: string; ownerId: string; wrappedDek: string; dekIv: string; dekTag: string; createdAt: Date } | null {
    const row = this.driver.get<DataEncryptionKeyRow>(
      'SELECT * FROM data_encryption_keys WHERE id = ? AND entityType = ?',
      [id, entityType]
    );
    if (!row) return null;
    return {
      id: row.id,
      entityType: row.entityType,
      ownerId: row.ownerId,
      wrappedDek: row.wrappedDek,
      dekIv: row.dekIv,
      dekTag: row.dekTag,
      createdAt: new Date(row.createdAt),
    };
  }

  setDEK(dek: { id: string; entityType: EncryptableEntityType; ownerId: string; wrappedDek: string; dekIv: string; dekTag: string }): void {
    this.driver.run(`
      INSERT OR REPLACE INTO data_encryption_keys (id, entityType, ownerId, wrappedDek, dekIv, dekTag, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [dek.id, dek.entityType, dek.ownerId, dek.wrappedDek, dek.dekIv, dek.dekTag, Date.now()]);
  }

  updateDEK(id: string, entityType: EncryptableEntityType, updates: { wrappedDek: string; dekIv: string; dekTag: string }): boolean {
    const result = this.driver.run(
      'UPDATE data_encryption_keys SET wrappedDek = ?, dekIv = ?, dekTag = ? WHERE id = ? AND entityType = ?',
      [updates.wrappedDek, updates.dekIv, updates.dekTag, id, entityType]
    );
    return result.changes > 0;
  }

  deleteDEKsByOwner(ownerId: string): number {
    const result = this.driver.run('DELETE FROM data_encryption_keys WHERE ownerId = ?', [ownerId]);
    return result.changes;
  }

  // ==================== Data Shares CRUD ====================

  getSharesForEntity(entityId: string, entityType: EncryptableEntityType): DataShare[] {
    const rows = this.driver.all<DataShareRow>(
      'SELECT * FROM data_shares WHERE entityId = ? AND entityType = ? ORDER BY createdAt DESC',
      [entityId, entityType]
    );
    return rows.map(this.mapDataShare);
  }

  getSharesForRecipient(recipientId: string): DataShare[] {
    const rows = this.driver.all<DataShareRow>(
      'SELECT * FROM data_shares WHERE recipientId = ? ORDER BY createdAt DESC',
      [recipientId]
    );
    return rows.map(this.mapDataShare);
  }

  createShare(share: Omit<DataShare, 'id' | 'createdAt'>): DataShare {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT INTO data_shares (id, entityId, entityType, ownerId, recipientId, wrappedDek, permissions, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      share.entityId,
      share.entityType,
      share.ownerId,
      share.recipientId,
      share.wrappedDek,
      JSON.stringify(share.permissions),
      createdAt,
    ]);

    return {
      id,
      entityId: share.entityId,
      entityType: share.entityType,
      ownerId: share.ownerId,
      recipientId: share.recipientId,
      wrappedDek: share.wrappedDek,
      permissions: share.permissions,
      createdAt: new Date(createdAt),
    };
  }

  deleteShare(id: string): boolean {
    const result = this.driver.run('DELETE FROM data_shares WHERE id = ?', [id]);
    return result.changes > 0;
  }

  updateSharePermissions(id: string, permissions: SharePermissions): boolean {
    const result = this.driver.run(
      'UPDATE data_shares SET permissions = ? WHERE id = ?',
      [JSON.stringify(permissions), id]
    );
    return result.changes > 0;
  }

  private mapDataShare(row: DataShareRow): DataShare {
    return {
      id: row.id,
      entityId: row.entityId,
      entityType: row.entityType as EncryptableEntityType,
      ownerId: row.ownerId,
      recipientId: row.recipientId,
      wrappedDek: row.wrappedDek,
      permissions: JSON.parse(row.permissions) as SharePermissions,
      createdAt: new Date(row.createdAt),
    };
  }

  // ==================== Sharing Defaults CRUD ====================

  getSharingDefaults(ownerId: string, entityType?: EncryptableEntityType): SharingDefault[] {
    if (entityType) {
      const rows = this.driver.all<SharingDefaultRow>(
        'SELECT * FROM sharing_defaults WHERE ownerId = ? AND (entityType = ? OR entityType = ?) ORDER BY createdAt DESC',
        [ownerId, entityType, 'all']
      );
      return rows.map(this.mapSharingDefault);
    }
    const rows = this.driver.all<SharingDefaultRow>(
      'SELECT * FROM sharing_defaults WHERE ownerId = ? ORDER BY createdAt DESC',
      [ownerId]
    );
    return rows.map(this.mapSharingDefault);
  }

  setSharingDefault(sd: Omit<SharingDefault, 'id' | 'createdAt'>): SharingDefault {
    const id = randomUUID();
    const createdAt = Date.now();

    this.driver.run(`
      INSERT OR REPLACE INTO sharing_defaults (id, ownerId, recipientId, entityType, permissions, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, sd.ownerId, sd.recipientId, sd.entityType, JSON.stringify(sd.permissions), createdAt]);

    return {
      id,
      ownerId: sd.ownerId,
      recipientId: sd.recipientId,
      entityType: sd.entityType,
      permissions: sd.permissions,
      createdAt: new Date(createdAt),
    };
  }

  updateSharingDefault(id: string, updates: { entityType?: SharingEntityType; permissions?: SharePermissions }): boolean {
    const parts: string[] = [];
    const params: (string)[] = [];
    if (updates.entityType !== undefined) {
      parts.push('entityType = ?');
      params.push(updates.entityType);
    }
    if (updates.permissions !== undefined) {
      parts.push('permissions = ?');
      params.push(JSON.stringify(updates.permissions));
    }
    if (parts.length === 0) return false;
    params.push(id);
    const result = this.driver.run(
      `UPDATE sharing_defaults SET ${parts.join(', ')} WHERE id = ?`,
      params
    );
    return result.changes > 0;
  }

  deleteSharingDefault(id: string): boolean {
    const result = this.driver.run('DELETE FROM sharing_defaults WHERE id = ?', [id]);
    return result.changes > 0;
  }

  private mapSharingDefault(row: SharingDefaultRow): SharingDefault {
    return {
      id: row.id,
      ownerId: row.ownerId,
      recipientId: row.recipientId,
      entityType: row.entityType as SharingEntityType,
      permissions: JSON.parse(row.permissions) as SharePermissions,
      createdAt: new Date(row.createdAt),
    };
  }

  // ==================== Enhanced Automation Rule Actions ====================

  getActionsForRule(ruleId: string): AutomationRuleActionRow[] {
    return this.driver.all<AutomationRuleActionRow>(
      'SELECT * FROM automation_rule_actions WHERE ruleId = ? ORDER BY createdAt ASC',
      [ruleId]
    );
  }

  createAutomationAction(action: { ruleId: string; actionType: string; actionValue: string | null }): AutomationRuleActionRow {
    const id = randomUUID();
    const now = Date.now();
    this.driver.run(
      'INSERT INTO automation_rule_actions (id, ruleId, actionType, actionValue, createdAt) VALUES (?, ?, ?, ?, ?)',
      [id, action.ruleId, action.actionType, action.actionValue, now]
    );
    return { id, ruleId: action.ruleId, actionType: action.actionType, actionValue: action.actionValue, createdAt: now };
  }

  deleteAutomationAction(id: string): boolean {
    const result = this.driver.run('DELETE FROM automation_rule_actions WHERE id = ?', [id]);
    return result.changes > 0;
  }

  updateRuleConditions(id: string, conditions: {
    amountMin?: number | null;
    amountMax?: number | null;
    accountFilter?: string[] | null;
    directionFilter?: string | null;
  }): boolean {
    const fields: string[] = [];
    const params: (string | number | null)[] = [];

    if (conditions.amountMin !== undefined) {
      fields.push('amountMin = ?');
      params.push(conditions.amountMin);
    }
    if (conditions.amountMax !== undefined) {
      fields.push('amountMax = ?');
      params.push(conditions.amountMax);
    }
    if (conditions.accountFilter !== undefined) {
      fields.push('accountFilter = ?');
      params.push(conditions.accountFilter ? JSON.stringify(conditions.accountFilter) : null);
    }
    if (conditions.directionFilter !== undefined) {
      fields.push('directionFilter = ?');
      params.push(conditions.directionFilter);
    }

    if (fields.length === 0) return false;
    params.push(id);
    const result = this.driver.run(
      `UPDATE category_rules SET ${fields.join(', ')} WHERE id = ?`,
      params
    );
    return result.changes > 0;
  }

  // ==================== Paycheck Allocations ====================

  getAllPaycheckAllocations(): PaycheckAllocationRow[] {
    return this.driver.all<PaycheckAllocationRow>(
      'SELECT * FROM paycheck_allocations ORDER BY createdAt ASC'
    );
  }

  getPaycheckAllocationsByStream(incomeStreamId: string): PaycheckAllocationRow[] {
    return this.driver.all<PaycheckAllocationRow>(
      'SELECT * FROM paycheck_allocations WHERE incomeStreamId = ? ORDER BY createdAt ASC',
      [incomeStreamId]
    );
  }

  createPaycheckAllocation(allocation: {
    incomeStreamId: string;
    incomeDescription: string;
    allocationType: string;
    targetId: string;
    amount: number;
  }): PaycheckAllocationRow {
    const id = randomUUID();
    const now = Date.now();
    this.driver.run(
      'INSERT INTO paycheck_allocations (id, incomeStreamId, incomeDescription, allocationType, targetId, amount, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, allocation.incomeStreamId, allocation.incomeDescription, allocation.allocationType, allocation.targetId, allocation.amount, now]
    );
    return {
      id,
      incomeStreamId: allocation.incomeStreamId,
      incomeDescription: allocation.incomeDescription,
      allocationType: allocation.allocationType,
      targetId: allocation.targetId,
      amount: allocation.amount,
      createdAt: now,
    };
  }

  updatePaycheckAllocation(id: string, updates: { amount?: number }): PaycheckAllocationRow | null {
    if (updates.amount === undefined) return null;
    this.driver.run('UPDATE paycheck_allocations SET amount = ? WHERE id = ?', [updates.amount, id]);
    const row = this.driver.get<PaycheckAllocationRow>('SELECT * FROM paycheck_allocations WHERE id = ?', [id]);
    return row || null;
  }

  deletePaycheckAllocation(id: string): boolean {
    const result = this.driver.run('DELETE FROM paycheck_allocations WHERE id = ?', [id]);
    return result.changes > 0;
  }

  close(): void {
    this.driver.close();
  }
}
