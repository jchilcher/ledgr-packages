import { getEmergencyStatus, getQuickWins, getSurvivalMode } from '../engines/recovery-plan-engine'

describe('RecoveryPlanEngine', () => {
  describe('getEmergencyStatus', () => {
    it('should determine emergency level based on days until negative', async () => {
      const mockDeps: any = {
        getCashFlowOptimization: async () => ({
          projections: [
            { date: new Date(), balance: 100000, inflows: 0, outflows: 0, items: [] },
            { date: new Date(Date.now() + 5 * 86400000), balance: -10000, inflows: 0, outflows: 0, items: [] },
          ],
          summary: {
            lowestProjectedBalance: -10000,
            lowestBalanceDate: new Date(Date.now() + 5 * 86400000),
          },
        }),
      }

      const status = await getEmergencyStatus(mockDeps)

      expect(status.level).toBe('critical')
      expect(status.daysUntilNegative).toBe(1)
    })

    it('should return none when balance stays positive', async () => {
      const mockDeps: any = {
        getCashFlowOptimization: async () => ({
          projections: [
            { date: new Date(), balance: 100000, inflows: 0, outflows: 0, items: [] },
            { date: new Date(Date.now() + 30 * 86400000), balance: 90000, inflows: 0, outflows: 0, items: [] },
          ],
          summary: {
            lowestProjectedBalance: 90000,
            lowestBalanceDate: null,
          },
        }),
      }

      const status = await getEmergencyStatus(mockDeps)

      expect(status.level).toBe('none')
      expect(status.daysUntilNegative).toBeNull()
    })

    it('should return warning level for 7-14 days', async () => {
      const mockDeps: any = {
        getCashFlowOptimization: async () => ({
          projections: Array.from({ length: 11 }, (_, i) => ({
            date: new Date(Date.now() + i * 86400000),
            balance: i < 10 ? 100000 - i * 11000 : -10000,
            inflows: 0,
            outflows: 0,
            items: [],
          })),
          summary: {
            lowestProjectedBalance: -10000,
            lowestBalanceDate: new Date(Date.now() + 10 * 86400000),
          },
        }),
      }

      const status = await getEmergencyStatus(mockDeps)

      expect(status.level).toBe('warning')
    })
  })

  describe('getSurvivalMode', () => {
    it('should separate essential from pausable expenses', async () => {
      const mockDeps: any = {
        getRecurringItems: async () => [
          { id: 'r1', description: 'Rent', amount: -100000, frequency: 'monthly', isActive: true, categoryId: 'c1' },
          { id: 'r2', description: 'Netflix', amount: -1500, frequency: 'monthly', isActive: true, categoryId: 'c2' },
        ],
        getCategories: async () => [
          { id: 'c1', name: 'Housing', type: 'expense' },
          { id: 'c2', name: 'Entertainment', type: 'expense' },
        ],
      }

      const result = await getSurvivalMode(mockDeps)

      expect(result.essentialExpenses.length).toBe(1)
      expect(result.pausableExpenses.length).toBe(1)
      expect(result.essentialExpenses[0].name).toBe('Rent')
      expect(result.pausableExpenses[0].name).toBe('Netflix')
    })

    it('should calculate total monthly amounts', async () => {
      const mockDeps: any = {
        getRecurringItems: async () => [
          { id: 'r1', description: 'Utilities', amount: -10000, frequency: 'monthly', isActive: true, categoryId: 'c1' },
          { id: 'r2', description: 'Subscription', amount: -2000, frequency: 'monthly', isActive: true, categoryId: 'c2' },
        ],
        getCategories: async () => [
          { id: 'c1', name: 'Utilities', type: 'expense' },
          { id: 'c2', name: 'Other', type: 'expense' },
        ],
      }

      const result = await getSurvivalMode(mockDeps)

      expect(result.totalEssentialMonthly).toBe(10000)
      expect(result.totalPausableMonthly).toBe(2000)
      expect(result.potentialSavingsIfAllPaused).toBe(2000)
    })
  })
})
