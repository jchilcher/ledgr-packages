import { projectCashFlow, identifyLowBalanceWindows, analyzeBillClusters, generateDueDateRecommendations } from '../engines/cashflow-optimization-engine'

function makeRecurringItem(overrides: any = {}): any {
  return {
    id: `rec-${Math.random().toString(36).slice(2)}`,
    name: 'Test Item',
    amount: -10000,
    frequency: 'monthly' as const,
    nextDueDate: new Date(),
    isActive: true,
    type: 'expense' as const,
    ...overrides,
  }
}

describe('CashFlowOptimizationEngine', () => {
  describe('projectCashFlow', () => {
    it('should project daily cash flow from recurring items', () => {
      const items = [
        makeRecurringItem({
          amount: -10000,
          frequency: 'monthly',
          nextDueDate: new Date(Date.now() + 5 * 86400000),
        }),
      ]

      const projections = projectCashFlow(items, 100000, 30)

      expect(projections.length).toBe(31)
      expect(projections[0].balance).toBe(100000)
    })

    it('should update balance based on income and expenses', () => {
      const items = [
        makeRecurringItem({
          type: 'income',
          amount: 50000,
          frequency: 'monthly',
          nextDueDate: new Date(Date.now() + 5 * 86400000),
        }),
        makeRecurringItem({
          type: 'expense',
          amount: -30000,
          frequency: 'monthly',
          nextDueDate: new Date(Date.now() + 10 * 86400000),
        }),
      ]

      const projections = projectCashFlow(items, 100000, 30)

      const afterIncome = projections.find((_, i) => i >= 5 && projections[i].inflows > 0)
      expect(afterIncome).toBeDefined()
    })

    it('should handle empty recurring items', () => {
      const projections = projectCashFlow([], 100000, 30)

      expect(projections.length).toBe(31)
      expect(projections.every(p => p.balance === 100000)).toBe(true)
    })
  })

  describe('identifyLowBalanceWindows', () => {
    it('should identify windows below warning threshold', () => {
      const projections = []
      for (let i = 0; i <= 30; i++) {
        projections.push({
          date: new Date(Date.now() + i * 86400000),
          balance: i >= 10 && i <= 15 ? 30000 : 100000,
          inflows: 0,
          outflows: 0,
          items: [],
        })
      }

      const windows = identifyLowBalanceWindows(projections, 50000, 10000)

      expect(windows.length).toBe(1)
      expect(windows[0].daysAtRisk).toBe(6)
    })

    it('should classify severity correctly', () => {
      const projections = [
        {
          date: new Date(),
          balance: 5000,
          inflows: 0,
          outflows: 0,
          items: [],
        },
      ]

      const windows = identifyLowBalanceWindows(projections, 50000, 10000)

      expect(windows[0].severity).toBe('critical')
    })

    it('should handle no low balance periods', () => {
      const projections = [
        {
          date: new Date(),
          balance: 100000,
          inflows: 0,
          outflows: 0,
          items: [],
        },
      ]

      const windows = identifyLowBalanceWindows(projections, 50000, 10000)

      expect(windows).toEqual([])
    })
  })

  describe('analyzeBillClusters', () => {
    it('should group bills into weekly ranges', () => {
      const items = [
        makeRecurringItem({ dayOfMonth: 5, amount: -10000 }),
        makeRecurringItem({ dayOfMonth: 15, amount: -20000 }),
        makeRecurringItem({ dayOfMonth: 25, amount: -15000 }),
      ]

      const clusters = analyzeBillClusters(items)

      expect(clusters.length).toBeGreaterThan(0)
      expect(clusters.every(c => c.totalAmount > 0)).toBe(true)
    })

    it('should calculate percentage of monthly bills', () => {
      const items = [
        makeRecurringItem({ dayOfMonth: 1, amount: -20000 }),
        makeRecurringItem({ dayOfMonth: 15, amount: -10000 }),
      ]

      const clusters = analyzeBillClusters(items)

      const firstWeekCluster = clusters.find(c => c.dayRange[0] === 1)
      expect(firstWeekCluster?.percentOfMonthlyBills).toBeCloseTo(66.67, 0)
    })

    it('should handle items without dayOfMonth', () => {
      const items = [
        makeRecurringItem({ dayOfMonth: undefined }),
      ]

      const clusters = analyzeBillClusters(items)

      expect(clusters).toEqual([])
    })
  })

  describe('generateDueDateRecommendations', () => {
    it('should recommend moving bills away from low balance periods', () => {
      const items = [
        makeRecurringItem({
          id: 'rec-1',
          name: 'Rent',
          dayOfMonth: 5,
          amount: -100000,
        }),
      ]

      const projections = []
      for (let i = 0; i <= 30; i++) {
        projections.push({
          date: new Date(Date.now() + i * 86400000),
          balance: i === 5 ? 20000 : 100000,
          inflows: 0,
          outflows: 0,
          items: i === 5 ? [{ name: 'Rent', amount: 100000, type: 'expense' as const }] : [],
        })
      }

      const windows = [
        {
          startDate: new Date(Date.now() + 5 * 86400000),
          endDate: new Date(Date.now() + 5 * 86400000),
          lowestBalance: 20000,
          lowestDate: new Date(Date.now() + 5 * 86400000),
          daysAtRisk: 1,
          severity: 'warning' as const,
          triggeringItems: ['Rent'],
        },
      ]

      const recommendations = generateDueDateRecommendations(items, projections, windows)

      expect(recommendations.length).toBeGreaterThan(0)
    })

    it('should handle empty low balance windows', () => {
      const recommendations = generateDueDateRecommendations([], [], [])

      expect(recommendations).toEqual([])
    })
  })
})
