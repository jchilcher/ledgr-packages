import { identifyIncomeStreams, analyzeIncome, calculateSmoothedIncome } from '../engines/income-analysis-engine'
import { Transaction } from '../types'

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

describe('IncomeAnalysisEngine', () => {
  describe('identifyIncomeStreams', () => {
    it('should group income by normalized description', () => {
      const now = new Date()
      const transactions = [
        makeTransaction({
          description: 'Paycheck ABC Corp #123',
          amount: 300000,
          date: new Date(now.getTime() - 60 * 86400000),
        }),
        makeTransaction({
          description: 'Paycheck ABC Corp #124',
          amount: 305000,
          date: new Date(now.getTime() - 30 * 86400000),
        }),
        makeTransaction({
          description: 'Paycheck ABC Corp #125',
          amount: 295000,
          date: now,
        }),
      ]

      const streams = identifyIncomeStreams(transactions)
      expect(streams.length).toBe(1)
      expect(streams[0].occurrences).toBe(3)
      expect(streams[0].averageAmount).toBeCloseTo(300000, -2)
    })

    it('should determine frequency correctly for weekly income', () => {
      const now = new Date()
      const transactions = []
      for (let i = 0; i < 5; i++) {
        transactions.push(
          makeTransaction({
            description: 'Weekly Paycheck',
            amount: 100000,
            date: new Date(now.getTime() - i * 7 * 86400000),
          })
        )
      }

      const streams = identifyIncomeStreams(transactions)
      expect(streams.length).toBe(1)
      expect(streams[0].frequency).toBe('weekly')
    })

    it('should determine frequency correctly for biweekly income', () => {
      const now = new Date()
      const transactions = []
      for (let i = 0; i < 4; i++) {
        transactions.push(
          makeTransaction({
            description: 'Biweekly Paycheck',
            amount: 200000,
            date: new Date(now.getTime() - i * 14 * 86400000),
          })
        )
      }

      const streams = identifyIncomeStreams(transactions)
      expect(streams.length).toBe(1)
      expect(streams[0].frequency).toBe('biweekly')
    })

    it('should determine frequency correctly for monthly income', () => {
      const now = new Date()
      const transactions = []
      for (let i = 0; i < 6; i++) {
        transactions.push(
          makeTransaction({
            description: 'Monthly Salary',
            amount: 500000,
            date: new Date(now.getFullYear(), now.getMonth() - i, 15),
          })
        )
      }

      const streams = identifyIncomeStreams(transactions)
      expect(streams.length).toBe(1)
      expect(streams[0].frequency).toBe('monthly')
    })

    it('should skip income sources with insufficient occurrences', () => {
      const now = new Date()
      const transactions = [
        makeTransaction({
          description: 'One Time Bonus',
          amount: 50000,
          date: now,
        }),
      ]

      const streams = identifyIncomeStreams(transactions, { minOccurrences: 2 })
      expect(streams).toEqual([])
    })

    it('should calculate reliability score based on consistency', () => {
      const now = new Date()
      const consistentTransactions = []
      for (let i = 0; i < 6; i++) {
        consistentTransactions.push(
          makeTransaction({
            description: 'Consistent Paycheck',
            amount: 300000,
            date: new Date(now.getFullYear(), now.getMonth() - i, 15),
          })
        )
      }

      const streams = identifyIncomeStreams(consistentTransactions)
      expect(streams.length).toBe(1)
      expect(streams[0].reliabilityScore).toBeGreaterThan(80)
    })

    it('should handle empty transactions', () => {
      const streams = identifyIncomeStreams([])
      expect(streams).toEqual([])
    })

    it('should only process positive amounts', () => {
      const now = new Date()
      const transactions = [
        makeTransaction({
          description: 'Expense',
          amount: -10000,
          date: now,
        }),
        makeTransaction({
          description: 'Expense',
          amount: -10000,
          date: new Date(now.getTime() - 30 * 86400000),
        }),
      ]

      const streams = identifyIncomeStreams(transactions)
      expect(streams).toEqual([])
    })

    it('should sort streams by average amount', () => {
      const now = new Date()
      const transactions = [
        makeTransaction({
          description: 'Large Income',
          amount: 500000,
          date: now,
        }),
        makeTransaction({
          description: 'Large Income',
          amount: 500000,
          date: new Date(now.getTime() - 30 * 86400000),
        }),
        makeTransaction({
          description: 'Small Income',
          amount: 10000,
          date: now,
        }),
        makeTransaction({
          description: 'Small Income',
          amount: 10000,
          date: new Date(now.getTime() - 30 * 86400000),
        }),
      ]

      const streams = identifyIncomeStreams(transactions)
      expect(streams.length).toBe(2)
      expect(streams[0].averageAmount).toBeGreaterThan(streams[1].averageAmount)
    })
  })

  describe('analyzeIncome', () => {
    it('should provide full analysis with stability and diversification scores', () => {
      const now = new Date()
      const transactions = []
      for (let i = 0; i < 6; i++) {
        transactions.push(
          makeTransaction({
            description: 'Primary Job',
            amount: 400000,
            date: new Date(now.getFullYear(), now.getMonth() - i, 15),
          })
        )
        transactions.push(
          makeTransaction({
            description: 'Side Gig',
            amount: 50000,
            date: new Date(now.getFullYear(), now.getMonth() - i, 20),
          })
        )
      }

      const result = analyzeIncome(transactions)
      expect(result.streams.length).toBe(2)
      expect(result.summary.totalMonthlyIncome).toBeGreaterThan(0)
      expect(result.summary.totalAnnualIncome).toBe(result.summary.totalMonthlyIncome * 12)
      expect(result.summary.incomeStabilityScore).toBeGreaterThanOrEqual(0)
      expect(result.summary.diversificationScore).toBeGreaterThanOrEqual(0)
      expect(result.recommendations.length).toBeGreaterThan(0)
    })

    it('should identify primary income stream', () => {
      const now = new Date()
      const transactions = []
      for (let i = 0; i < 6; i++) {
        transactions.push(
          makeTransaction({
            description: 'Large Paycheck',
            amount: 500000,
            date: new Date(now.getFullYear(), now.getMonth() - i, 15),
          })
        )
        transactions.push(
          makeTransaction({
            description: 'Small Gig',
            amount: 10000,
            date: new Date(now.getFullYear(), now.getMonth() - i, 20),
          })
        )
      }

      const result = analyzeIncome(transactions)
      expect(result.summary.primaryIncomeStream).toBeDefined()
      expect(result.summary.primaryIncomeStream?.averageAmount).toBe(500000)
    })

    it('should calculate diversification score for single income source', () => {
      const now = new Date()
      const transactions = []
      for (let i = 0; i < 6; i++) {
        transactions.push(
          makeTransaction({
            description: 'Only Job',
            amount: 400000,
            date: new Date(now.getFullYear(), now.getMonth() - i, 15),
          })
        )
      }

      const result = analyzeIncome(transactions)
      expect(result.summary.diversificationScore).toBe(20)
    })

    it('should recommend emergency fund for low stability', () => {
      const now = new Date()
      const transactions = []
      for (let i = 0; i < 6; i++) {
        const amount = 100000 + Math.random() * 200000
        transactions.push(
          makeTransaction({
            description: 'Variable Income',
            amount,
            date: new Date(now.getFullYear(), now.getMonth() - i, 15),
          })
        )
      }

      const result = analyzeIncome(transactions)
      if (result.summary.incomeStabilityScore < 50) {
        expect(result.recommendations.some(r => r.includes('emergency fund'))).toBe(true)
      }
    })
  })

  describe('calculateSmoothedIncome', () => {
    it('should calculate moving average of income', () => {
      const now = new Date()
      const transactions = []
      for (let i = 0; i < 12; i++) {
        transactions.push(
          makeTransaction({
            description: 'Income',
            amount: 100000 + i * 10000,
            date: new Date(now.getFullYear(), now.getMonth() - i, 15),
          })
        )
      }

      const smoothed = calculateSmoothedIncome(transactions, 3)
      expect(smoothed.length).toBeGreaterThan(0)
      expect(smoothed[0].actual).toBeGreaterThan(0)
      expect(smoothed[0].smoothed).toBeGreaterThan(0)
    })

    it('should handle empty transactions', () => {
      const smoothed = calculateSmoothedIncome([])
      expect(smoothed).toEqual([])
    })

    it('should smooth out income variability', () => {
      const now = new Date()
      const transactions = [
        makeTransaction({
          description: 'Income',
          amount: 200000,
          date: new Date(now.getFullYear(), now.getMonth(), 15),
        }),
        makeTransaction({
          description: 'Income',
          amount: 100000,
          date: new Date(now.getFullYear(), now.getMonth() - 1, 15),
        }),
        makeTransaction({
          description: 'Income',
          amount: 150000,
          date: new Date(now.getFullYear(), now.getMonth() - 2, 15),
        }),
      ]

      const smoothed = calculateSmoothedIncome(transactions, 3)
      expect(smoothed.length).toBe(3)

      const lastMonth = smoothed[smoothed.length - 1]
      expect(lastMonth.smoothed).toBeLessThan(Math.max(200000, 100000, 150000))
      expect(lastMonth.smoothed).toBeGreaterThan(Math.min(200000, 100000, 150000))
    })
  })
})
