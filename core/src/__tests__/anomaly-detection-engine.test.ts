import { detectAnomalies, detectUnusualAmounts, detectMissingRecurring, detectDuplicateCharges } from '../engines/anomaly-detection-engine'
import { Transaction, Category, RecurringItem } from '../types'

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `tx-${Math.random().toString(36).slice(2)}`,
    accountId: 'acc-1',
    date: new Date(),
    description: 'Test Transaction',
    amount: -5000,
    categoryId: null,
    isRecurring: false,
    importSource: 'file' as const,
    createdAt: new Date(),
    ...overrides,
  }
}

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: `cat-${Math.random().toString(36).slice(2)}`,
    name: 'Test Category',
    type: 'expense' as const,
    isDefault: false,
    ...overrides,
  }
}

function makeRecurringItem(overrides: Partial<RecurringItem> = {}): RecurringItem {
  return {
    id: `rec-${Math.random().toString(36).slice(2)}`,
    description: 'Test Recurring',
    amount: -10000,
    frequency: 'monthly' as const,
    startDate: new Date(),
    nextOccurrence: new Date(),
    itemType: 'bill' as const,
    enableReminders: true,
    autopay: false,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  }
}

describe('AnomalyDetectionEngine', () => {
  describe('detectUnusualAmounts', () => {
    it('should flag transactions with z-score above threshold', () => {
      const category = makeCategory({ id: 'cat-1', name: 'Groceries' })
      const now = new Date()

      const transactions = [
        ...Array.from({ length: 10 }, (_, i) => makeTransaction({
          date: new Date(now.getTime() - (60 - i) * 86400000),
          amount: -(4800 + Math.random() * 400),
          categoryId: 'cat-1',
        })),
        makeTransaction({
          date: new Date(now.getTime() - 86400000),
          amount: -25000,
          categoryId: 'cat-1',
        }),
      ]

      const anomalies = detectUnusualAmounts(transactions, [category])
      expect(anomalies.length).toBeGreaterThan(0)
      expect(anomalies[0].type).toBe('unusual_amount')
      expect(anomalies[0].severity).toBeDefined()
    })

    it('should not flag transactions with insufficient history', () => {
      const category = makeCategory({ id: 'cat-1' })
      const now = new Date()

      const transactions = [
        ...Array.from({ length: 3 }, (_, i) => makeTransaction({
          date: new Date(now.getTime() - (60 - i) * 86400000),
          amount: -5000,
          categoryId: 'cat-1',
        })),
        makeTransaction({
          date: new Date(now.getTime() - 86400000),
          amount: -20000,
          categoryId: 'cat-1',
        }),
      ]

      const anomalies = detectUnusualAmounts(transactions, [category])
      expect(anomalies.length).toBe(0)
    })

    it('should respect z-score threshold parameter', () => {
      const category = makeCategory({ id: 'cat-1' })
      const now = new Date()

      const transactions = [
        ...Array.from({ length: 10 }, (_, i) => makeTransaction({
          date: new Date(now.getTime() - (60 - i) * 86400000),
          amount: -5000,
          categoryId: 'cat-1',
        })),
        makeTransaction({
          date: new Date(now.getTime() - 86400000),
          amount: -15000,
          categoryId: 'cat-1',
        }),
      ]

      const lowThreshold = detectUnusualAmounts(transactions, [category], 1.0)
      const highThreshold = detectUnusualAmounts(transactions, [category], 5.0)

      expect(lowThreshold.length).toBeGreaterThanOrEqual(highThreshold.length)
    })

    it('should handle empty transactions', () => {
      const anomalies = detectUnusualAmounts([], [])
      expect(anomalies).toEqual([])
    })

    it('should skip transactions without categoryId', () => {
      const now = new Date()
      const transactions = [
        ...Array.from({ length: 10 }, (_, i) => makeTransaction({
          date: new Date(now.getTime() - (60 - i) * 86400000),
          amount: -5000,
          categoryId: null,
        })),
      ]

      const anomalies = detectUnusualAmounts(transactions, [])
      expect(anomalies).toEqual([])
    })

    it('should calculate z-scores correctly for high amounts', () => {
      const category = makeCategory({ id: 'cat-1', name: 'Dining' })
      const now = new Date()

      const transactions = [
        ...Array.from({ length: 10 }, (_, i) => makeTransaction({
          date: new Date(now.getTime() - (60 - i) * 86400000),
          amount: -5000,
          categoryId: 'cat-1',
        })),
        makeTransaction({
          date: new Date(now.getTime() - 86400000),
          amount: -20000,
          categoryId: 'cat-1',
        }),
      ]

      const anomalies = detectUnusualAmounts(transactions, [category])
      expect(anomalies.length).toBeGreaterThan(0)
      expect(anomalies[0].zScore).toBeGreaterThan(2.0)
      expect(anomalies[0].description).toContain('high')
    })

    it('should assign severity based on z-score magnitude', () => {
      const category = makeCategory({ id: 'cat-1' })
      const now = new Date()

      const transactions = [
        ...Array.from({ length: 10 }, (_, i) => makeTransaction({
          date: new Date(now.getTime() - (60 - i) * 86400000),
          amount: -1000,
          categoryId: 'cat-1',
        })),
        makeTransaction({
          date: new Date(now.getTime() - 86400000),
          amount: -50000,
          categoryId: 'cat-1',
        }),
      ]

      const anomalies = detectUnusualAmounts(transactions, [category])
      expect(anomalies.length).toBeGreaterThan(0)
      expect(['low', 'medium', 'high']).toContain(anomalies[0].severity)
    })
  })

  describe('detectMissingRecurring', () => {
    it('should flag recurring items past grace period without matching transaction', () => {
      const now = new Date()
      const pastDue = new Date(now.getTime() - 10 * 86400000)

      const recurringItem = makeRecurringItem({
        description: 'Netflix Subscription',
        nextOccurrence: pastDue,
        isActive: true,
      })

      const anomalies = detectMissingRecurring([], [recurringItem])
      expect(anomalies.length).toBe(1)
      expect(anomalies[0].type).toBe('missing_recurring')
      expect(anomalies[0].recurringItemId).toBe(recurringItem.id)
    })

    it('should not flag items within grace period', () => {
      const now = new Date()
      const recentDue = new Date(now.getTime() - 2 * 86400000)

      const recurringItem = makeRecurringItem({
        nextOccurrence: recentDue,
        isActive: true,
      })

      const anomalies = detectMissingRecurring([], [recurringItem], 5)
      expect(anomalies).toEqual([])
    })

    it('should not flag when matching transaction exists', () => {
      const now = new Date()
      const pastDue = new Date(now.getTime() - 10 * 86400000)

      const recurringItem = makeRecurringItem({
        description: 'Netflix Subscription',
        nextOccurrence: pastDue,
        isActive: true,
      })

      const matchingTx = makeTransaction({
        description: 'Netflix Subscription Payment',
        date: new Date(now.getTime() - 8 * 86400000),
      })

      const anomalies = detectMissingRecurring([matchingTx], [recurringItem])
      expect(anomalies).toEqual([])
    })

    it('should skip inactive recurring items', () => {
      const now = new Date()
      const pastDue = new Date(now.getTime() - 10 * 86400000)

      const recurringItem = makeRecurringItem({
        nextOccurrence: pastDue,
        isActive: false,
      })

      const anomalies = detectMissingRecurring([], [recurringItem])
      expect(anomalies).toEqual([])
    })

    it('should assign severity based on days past due', () => {
      const now = new Date()

      const items = [
        makeRecurringItem({
          id: 'rec-1',
          nextOccurrence: new Date(now.getTime() - 20 * 86400000),
          isActive: true,
        }),
        makeRecurringItem({
          id: 'rec-2',
          nextOccurrence: new Date(now.getTime() - 10 * 86400000),
          isActive: true,
        }),
        makeRecurringItem({
          id: 'rec-3',
          nextOccurrence: new Date(now.getTime() - 6 * 86400000),
          isActive: true,
        }),
      ]

      const anomalies = detectMissingRecurring([], items)
      expect(anomalies.length).toBe(3)

      const severities = anomalies.map(a => a.severity)
      expect(severities).toContain('high')
      expect(severities).toContain('medium')
      expect(severities).toContain('low')
    })
  })

  describe('detectDuplicateCharges', () => {
    it('should detect duplicate transactions with same amount and description', () => {
      const now = new Date()
      const transactions = [
        makeTransaction({
          description: 'Amazon Purchase',
          amount: -4999,
          date: new Date(now.getTime() - 5 * 86400000),
        }),
        makeTransaction({
          description: 'Amazon Purchase',
          amount: -4999,
          date: new Date(now.getTime() - 4 * 86400000),
        }),
      ]

      const anomalies = detectDuplicateCharges(transactions)
      expect(anomalies.length).toBe(1)
      expect(anomalies[0].type).toBe('duplicate_charge')
      expect(anomalies[0].relatedTransactionIds?.length).toBe(2)
    })

    it('should respect window days parameter', () => {
      const now = new Date()
      const transactions = [
        makeTransaction({
          description: 'Target',
          amount: -5000,
          date: new Date(now.getTime() - 10 * 86400000),
        }),
        makeTransaction({
          description: 'Target',
          amount: -5000,
          date: new Date(now.getTime() - 6 * 86400000),
        }),
      ]

      const shortWindow = detectDuplicateCharges(transactions, 1)
      const longWindow = detectDuplicateCharges(transactions, 10)

      expect(shortWindow.length).toBe(0)
      expect(longWindow.length).toBe(1)
    })

    it('should only check expense transactions', () => {
      const now = new Date()
      const transactions = [
        makeTransaction({
          description: 'Paycheck',
          amount: 100000,
          date: new Date(now.getTime() - 5 * 86400000),
        }),
        makeTransaction({
          description: 'Paycheck',
          amount: 100000,
          date: new Date(now.getTime() - 4 * 86400000),
        }),
      ]

      const anomalies = detectDuplicateCharges(transactions)
      expect(anomalies).toEqual([])
    })

    it('should assign higher severity for multiple duplicates', () => {
      const now = new Date()
      const transactions = [
        makeTransaction({
          description: 'Subscription',
          amount: -999,
          date: new Date(now.getTime() - 5 * 86400000),
        }),
        makeTransaction({
          description: 'Subscription',
          amount: -999,
          date: new Date(now.getTime() - 4 * 86400000),
        }),
        makeTransaction({
          description: 'Subscription',
          amount: -999,
          date: new Date(now.getTime() - 3 * 86400000),
        }),
      ]

      const anomalies = detectDuplicateCharges(transactions)
      expect(anomalies.length).toBe(1)
      expect(anomalies[0].severity).toBe('high')
    })

    it('should handle empty transactions', () => {
      const anomalies = detectDuplicateCharges([])
      expect(anomalies).toEqual([])
    })
  })

  describe('detectAnomalies', () => {
    it('should combine all anomaly types', () => {
      const category = makeCategory({ id: 'cat-1' })
      const now = new Date()

      const transactions = [
        ...Array.from({ length: 10 }, (_, i) => makeTransaction({
          date: new Date(now.getTime() - (60 - i) * 86400000),
          amount: -5000,
          categoryId: 'cat-1',
        })),
        makeTransaction({
          id: 'unusual',
          date: new Date(now.getTime() - 2 * 86400000),
          amount: -25000,
          categoryId: 'cat-1',
        }),
        makeTransaction({
          id: 'dup-1',
          description: 'Duplicate',
          amount: -3000,
          date: new Date(now.getTime() - 5 * 86400000),
        }),
        makeTransaction({
          id: 'dup-2',
          description: 'Duplicate',
          amount: -3000,
          date: new Date(now.getTime() - 4 * 86400000),
        }),
      ]

      const recurringItem = makeRecurringItem({
        nextOccurrence: new Date(now.getTime() - 10 * 86400000),
        isActive: true,
      })

      const result = detectAnomalies(transactions, [recurringItem], [category])

      expect(result.anomalies.length).toBeGreaterThan(0)
      expect(result.summary.totalAnomalies).toBe(result.anomalies.length)
      expect(result.summary.byType.unusual_amount).toBeGreaterThan(0)
      expect(result.summary.byType.missing_recurring).toBe(1)
      expect(result.summary.byType.duplicate_charge).toBe(1)
    })

    it('should sort anomalies by severity then date', () => {
      const category = makeCategory({ id: 'cat-1' })
      const now = new Date()

      const transactions = [
        ...Array.from({ length: 10 }, (_, i) => makeTransaction({
          date: new Date(now.getTime() - (60 - i) * 86400000),
          amount: -1000,
          categoryId: 'cat-1',
        })),
        makeTransaction({
          date: new Date(now.getTime() - 2 * 86400000),
          amount: -50000,
          categoryId: 'cat-1',
        }),
      ]

      const result = detectAnomalies(transactions, [], [category])

      if (result.anomalies.length > 1) {
        const severityOrder = { high: 0, medium: 1, low: 2 }
        for (let i = 0; i < result.anomalies.length - 1; i++) {
          const currentSev = severityOrder[result.anomalies[i].severity]
          const nextSev = severityOrder[result.anomalies[i + 1].severity]
          expect(currentSev).toBeLessThanOrEqual(nextSev)
        }
      }
    })

    it('should calculate summary counts correctly', () => {
      const result = detectAnomalies([], [], [])

      expect(result.summary.totalAnomalies).toBe(0)
      expect(result.summary.byType.unusual_amount).toBe(0)
      expect(result.summary.byType.missing_recurring).toBe(0)
      expect(result.summary.byType.duplicate_charge).toBe(0)
      expect(result.summary.bySeverity.low).toBe(0)
      expect(result.summary.bySeverity.medium).toBe(0)
      expect(result.summary.bySeverity.high).toBe(0)
    })
  })
})
