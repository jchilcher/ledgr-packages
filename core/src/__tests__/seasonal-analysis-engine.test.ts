import { calculateSeasonalPatterns, buildSeasonalIndices, detectHolidaySpikes, predictMonthlySpending, calculateCategoryAverages } from '../engines/seasonal-analysis-engine'
import { Transaction, Category } from '../types'

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

describe('SeasonalAnalysisEngine', () => {
  describe('calculateSeasonalPatterns', () => {
    it('should calculate monthly averages per category', () => {
      const category = makeCategory({ id: 'cat-1', name: 'Groceries' })
      const now = new Date()

      const transactions = []
      for (let month = 0; month < 6; month++) {
        const monthDate = new Date(now.getFullYear(), now.getMonth() - month, 15)
        transactions.push(
          makeTransaction({
            categoryId: 'cat-1',
            date: monthDate,
            amount: -10000,
          })
        )
      }

      const patterns = calculateSeasonalPatterns(transactions, [category])
      expect(patterns.length).toBeGreaterThan(0)
      expect(patterns[0].categoryId).toBe('cat-1')
      expect(patterns[0].averageSpending).toBeGreaterThan(0)
    })

    it('should skip categories with insufficient months', () => {
      const category = makeCategory({ id: 'cat-1' })
      const now = new Date()

      const transactions = [
        makeTransaction({
          categoryId: 'cat-1',
          date: new Date(now.getFullYear(), now.getMonth(), 15),
          amount: -10000,
        }),
        makeTransaction({
          categoryId: 'cat-1',
          date: new Date(now.getFullYear(), now.getMonth() - 1, 15),
          amount: -10000,
        }),
      ]

      const patterns = calculateSeasonalPatterns(transactions, [category], 3)
      expect(patterns.length).toBe(0)
    })

    it('should calculate seasonal indices correctly', () => {
      const category = makeCategory({ id: 'cat-1' })
      const now = new Date()

      const transactions = [
        makeTransaction({
          categoryId: 'cat-1',
          date: new Date(now.getFullYear(), now.getMonth(), 15),
          amount: -20000,
        }),
        makeTransaction({
          categoryId: 'cat-1',
          date: new Date(now.getFullYear(), now.getMonth() - 1, 15),
          amount: -10000,
        }),
        makeTransaction({
          categoryId: 'cat-1',
          date: new Date(now.getFullYear(), now.getMonth() - 2, 15),
          amount: -10000,
        }),
      ]

      const patterns = calculateSeasonalPatterns(transactions, [category])
      expect(patterns.length).toBe(3)

      const highSpendingMonth = patterns.find(p => p.month === now.getMonth() + 1)
      expect(highSpendingMonth?.seasonalIndex).toBeGreaterThan(1.0)
    })

    it('should handle empty transactions', () => {
      const patterns = calculateSeasonalPatterns([], [])
      expect(patterns).toEqual([])
    })

    it('should only process expense transactions with categories', () => {
      const category = makeCategory({ id: 'cat-1' })
      const now = new Date()

      const transactions = [
        makeTransaction({
          categoryId: null,
          date: now,
          amount: -10000,
        }),
        makeTransaction({
          categoryId: 'cat-1',
          date: now,
          amount: 10000,
        }),
      ]

      const patterns = calculateSeasonalPatterns(transactions, [category])
      expect(patterns).toEqual([])
    })
  })

  describe('calculateCategoryAverages', () => {
    it('should calculate monthly averages for categories', () => {
      const now = new Date()

      const transactions = [
        makeTransaction({
          categoryId: 'cat-1',
          date: new Date(now.getFullYear(), now.getMonth(), 15),
          amount: -10000,
        }),
        makeTransaction({
          categoryId: 'cat-1',
          date: new Date(now.getFullYear(), now.getMonth() - 1, 15),
          amount: -20000,
        }),
      ]

      const averages = calculateCategoryAverages(transactions)
      expect(averages['cat-1']).toBe(15000)
    })

    it('should handle empty transactions', () => {
      const averages = calculateCategoryAverages([])
      expect(averages).toEqual({})
    })
  })

  describe('buildSeasonalIndices', () => {
    it('should create categoryId -> month -> index mapping', () => {
      const patterns = [
        {
          id: 'p1',
          categoryId: 'cat-1',
          year: 2026,
          month: 1,
          averageSpending: 10000,
          transactionCount: 5,
          seasonalIndex: 1.2,
          calculatedAt: new Date(),
        },
        {
          id: 'p2',
          categoryId: 'cat-1',
          year: 2026,
          month: 2,
          averageSpending: 8000,
          transactionCount: 4,
          seasonalIndex: 0.8,
          calculatedAt: new Date(),
        },
      ]

      const indices = buildSeasonalIndices(patterns)
      expect(indices['cat-1'][1]).toBe(1.2)
      expect(indices['cat-1'][2]).toBe(0.8)
    })

    it('should handle empty patterns', () => {
      const indices = buildSeasonalIndices([])
      expect(indices).toEqual({})
    })
  })

  describe('detectHolidaySpikes', () => {
    it('should detect months with 25% above average spending', () => {
      const category = makeCategory({ id: 'cat-1', name: 'Shopping' })

      const patterns = [
        {
          id: 'p1',
          categoryId: 'cat-1',
          year: 2026,
          month: 12,
          averageSpending: 15000,
          transactionCount: 10,
          seasonalIndex: 1.5,
          calculatedAt: new Date(),
        },
        {
          id: 'p2',
          categoryId: 'cat-1',
          year: 2026,
          month: 1,
          averageSpending: 10000,
          transactionCount: 5,
          seasonalIndex: 1.0,
          calculatedAt: new Date(),
        },
      ]

      const spikes = detectHolidaySpikes(patterns, [category])
      expect(spikes.length).toBe(1)
      expect(spikes[0].month).toBe(12)
      expect(spikes[0].spike).toBe(50)
    })

    it('should respect spike threshold parameter', () => {
      const category = makeCategory({ id: 'cat-1', name: 'Dining' })

      const patterns = [
        {
          id: 'p1',
          categoryId: 'cat-1',
          year: 2026,
          month: 11,
          averageSpending: 12000,
          transactionCount: 8,
          seasonalIndex: 1.2,
          calculatedAt: new Date(),
        },
      ]

      const lowThreshold = detectHolidaySpikes(patterns, [category], 0.1)
      const highThreshold = detectHolidaySpikes(patterns, [category], 0.5)

      expect(lowThreshold.length).toBeGreaterThanOrEqual(highThreshold.length)
    })

    it('should identify holiday-sensitive categories', () => {
      const category = makeCategory({ id: 'cat-1', name: 'Gifts' })

      const patterns = [
        {
          id: 'p1',
          categoryId: 'cat-1',
          year: 2026,
          month: 12,
          averageSpending: 20000,
          transactionCount: 15,
          seasonalIndex: 1.8,
          calculatedAt: new Date(),
        },
      ]

      const spikes = detectHolidaySpikes(patterns, [category])
      expect(spikes.length).toBe(1)
      expect(spikes[0].description).toContain('spike')
    })

    it('should sort spikes by magnitude', () => {
      const category = makeCategory({ id: 'cat-1', name: 'Shopping' })

      const patterns = [
        {
          id: 'p1',
          categoryId: 'cat-1',
          year: 2026,
          month: 12,
          averageSpending: 20000,
          transactionCount: 15,
          seasonalIndex: 1.5,
          calculatedAt: new Date(),
        },
        {
          id: 'p2',
          categoryId: 'cat-1',
          year: 2026,
          month: 11,
          averageSpending: 18000,
          transactionCount: 12,
          seasonalIndex: 1.3,
          calculatedAt: new Date(),
        },
      ]

      const spikes = detectHolidaySpikes(patterns, [category])
      expect(spikes.length).toBe(2)
      expect(spikes[0].spike).toBeGreaterThanOrEqual(spikes[1].spike)
    })
  })

  describe('predictMonthlySpending', () => {
    it('should multiply average by seasonal index', () => {
      const categoryAverage = 10000
      const seasonalIndices = {
        'cat-1': {
          12: 1.5,
        },
      }

      const prediction = predictMonthlySpending('cat-1', 12, categoryAverage, seasonalIndices)
      expect(prediction).toBe(15000)
    })

    it('should fall back to average when no index exists', () => {
      const categoryAverage = 10000
      const seasonalIndices = {}

      const prediction = predictMonthlySpending('cat-1', 12, categoryAverage, seasonalIndices)
      expect(prediction).toBe(10000)
    })

    it('should handle missing month in indices', () => {
      const categoryAverage = 10000
      const seasonalIndices = {
        'cat-1': {
          11: 1.3,
        },
      }

      const prediction = predictMonthlySpending('cat-1', 12, categoryAverage, seasonalIndices)
      expect(prediction).toBe(10000)
    })
  })
})
