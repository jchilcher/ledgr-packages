import { buildPeriodBreakdowns, detectCategoryShifts, calculateCategoryTrends } from '../engines/category-migration-engine'

function makeTransaction(overrides: any = {}): any {
  return {
    id: `tx-${Math.random().toString(36).slice(2)}`,
    date: new Date(),
    amount: -5000,
    categoryId: 'cat-1',
    type: 'expense' as const,
    ...overrides,
  }
}

function makeCategory(overrides: any = {}): any {
  return {
    id: `cat-${Math.random().toString(36).slice(2)}`,
    name: 'Test Category',
    ...overrides,
  }
}

describe('CategoryMigrationEngine', () => {
  describe('buildPeriodBreakdowns', () => {
    it('should group transactions into monthly periods', () => {
      const now = new Date()
      const categories = [makeCategory({ id: 'cat-1', name: 'Groceries' })]

      const transactions = []
      for (let i = 0; i < 3; i++) {
        transactions.push(
          makeTransaction({
            categoryId: 'cat-1',
            date: new Date(now.getFullYear(), now.getMonth() - i, 15),
            amount: -10000,
          })
        )
      }

      const periods = buildPeriodBreakdowns(transactions, categories, 6)

      expect(periods.length).toBeGreaterThan(0)
      expect(periods[0].categories.length).toBeGreaterThan(0)
    })

    it('should calculate category proportions within each period', () => {
      const now = new Date()
      const categories = [
        makeCategory({ id: 'cat-1', name: 'Groceries' }),
        makeCategory({ id: 'cat-2', name: 'Dining' }),
      ]

      const transactions = [
        makeTransaction({
          categoryId: 'cat-1',
          date: now,
          amount: -30000,
        }),
        makeTransaction({
          categoryId: 'cat-2',
          date: now,
          amount: -20000,
        }),
      ]

      const periods = buildPeriodBreakdowns(transactions, categories, 1)

      expect(periods.length).toBe(1)
      expect(periods[0].categories.length).toBe(2)

      const groceries = periods[0].categories.find(c => c.categoryId === 'cat-1')
      expect(groceries?.proportion).toBeCloseTo(60, 0)
    })

    it('should handle empty transactions', () => {
      const periods = buildPeriodBreakdowns([], [], 12)
      expect(periods).toEqual([])
    })
  })

  describe('detectCategoryShifts', () => {
    it('should detect proportional shifts >= threshold', () => {
      const periods = [
        {
          period: '2026-01',
          startDate: new Date(2026, 0, 1),
          endDate: new Date(2026, 0, 31),
          totalSpending: 100000,
          categories: [
            { categoryId: 'cat-1', categoryName: 'Groceries', amount: 30000, proportion: 30, transactionCount: 10 },
          ],
        },
        {
          period: '2026-02',
          startDate: new Date(2026, 1, 1),
          endDate: new Date(2026, 1, 28),
          totalSpending: 100000,
          categories: [
            { categoryId: 'cat-1', categoryName: 'Groceries', amount: 45000, proportion: 45, transactionCount: 15 },
          ],
        },
      ]

      const shifts = detectCategoryShifts(periods, 5)

      expect(shifts.length).toBe(1)
      expect(shifts[0].proportionChange).toBeCloseTo(15, 0)
      expect(shifts[0].direction).toBe('increasing')
    })

    it('should classify shift significance correctly', () => {
      const periods = [
        {
          period: '2026-01',
          startDate: new Date(2026, 0, 1),
          endDate: new Date(2026, 0, 31),
          totalSpending: 100000,
          categories: [
            { categoryId: 'cat-1', categoryName: 'Groceries', amount: 10000, proportion: 10, transactionCount: 5 },
          ],
        },
        {
          period: '2026-02',
          startDate: new Date(2026, 1, 1),
          endDate: new Date(2026, 1, 28),
          totalSpending: 100000,
          categories: [
            { categoryId: 'cat-1', categoryName: 'Groceries', amount: 30000, proportion: 30, transactionCount: 15 },
          ],
        },
      ]

      const shifts = detectCategoryShifts(periods, 5)

      expect(shifts[0].significance).toBe('significant')
    })

    it('should require at least 2 periods', () => {
      const periods = [
        {
          period: '2026-01',
          startDate: new Date(2026, 0, 1),
          endDate: new Date(2026, 0, 31),
          totalSpending: 100000,
          categories: [],
        },
      ]

      const shifts = detectCategoryShifts(periods)
      expect(shifts).toEqual([])
    })
  })

  describe('calculateCategoryTrends', () => {
    it('should calculate linear trend for categories', () => {
      const periods = []
      for (let i = 0; i < 6; i++) {
        periods.push({
          period: `2026-${String(i + 1).padStart(2, '0')}`,
          startDate: new Date(2026, i, 1),
          endDate: new Date(2026, i + 1, 0),
          totalSpending: 100000,
          categories: [
            {
              categoryId: 'cat-1',
              categoryName: 'Groceries',
              amount: 20000 + i * 2000,
              proportion: 20 + i * 2,
              transactionCount: 10,
            },
          ],
        })
      }

      const trends = calculateCategoryTrends(periods)

      expect(trends.length).toBe(1)
      expect(trends[0].trend).toBe('increasing')
    })

    it('should calculate volatility for categories', () => {
      const periods = []
      for (let i = 0; i < 6; i++) {
        periods.push({
          period: `2026-${String(i + 1).padStart(2, '0')}`,
          startDate: new Date(2026, i, 1),
          endDate: new Date(2026, i + 1, 0),
          totalSpending: 100000,
          categories: [
            {
              categoryId: 'cat-1',
              categoryName: 'Variable',
              amount: 20000 + (i % 2) * 10000,
              proportion: 20 + (i % 2) * 10,
              transactionCount: 10,
            },
          ],
        })
      }

      const trends = calculateCategoryTrends(periods)

      expect(trends[0].volatility).toBeGreaterThan(0)
    })

    it('should require at least 3 periods', () => {
      const periods = [
        {
          period: '2026-01',
          startDate: new Date(2026, 0, 1),
          endDate: new Date(2026, 0, 31),
          totalSpending: 100000,
          categories: [],
        },
        {
          period: '2026-02',
          startDate: new Date(2026, 1, 1),
          endDate: new Date(2026, 1, 28),
          totalSpending: 100000,
          categories: [],
        },
      ]

      const trends = calculateCategoryTrends(periods)
      expect(trends).toEqual([])
    })
  })
})
