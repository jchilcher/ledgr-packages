import { buildPaycheckView, buildAllPaycheckViews, validatePaycheckAllocations } from '../engines/paycheck-budget-engine'

describe('PaycheckBudgetEngine', () => {
  describe('buildPaycheckView', () => {
    it('should build view for single income stream', () => {
      const input = {
        incomeStreams: [
          { id: 's1', description: 'Paycheck', averageAmount: 300000, frequency: 'biweekly' },
        ],
        allocations: [
          {
            id: 'a1',
            incomeStreamId: 's1',
            incomeDescription: 'Paycheck',
            allocationType: 'recurring_item' as const,
            targetId: 'r1',
            amount: 100000,
            createdAt: new Date(),
          },
        ],
        targets: {
          recurringItems: [{ id: 'r1', description: 'Rent' }],
          budgetCategories: [],
          savingsGoals: [],
        },
      }

      const view = buildPaycheckView(input, 's1')

      expect(view).not.toBeNull()
      expect(view?.totalAllocated).toBe(100000)
      expect(view?.unallocated).toBe(200000)
    })

    it('should return null for non-existent stream', () => {
      const input = {
        incomeStreams: [],
        allocations: [],
        targets: {
          recurringItems: [],
          budgetCategories: [],
          savingsGoals: [],
        },
      }

      const view = buildPaycheckView(input, 'nonexistent')

      expect(view).toBeNull()
    })

    it('should resolve target names for allocations', () => {
      const input = {
        incomeStreams: [
          { id: 's1', description: 'Paycheck', averageAmount: 300000, frequency: 'biweekly' },
        ],
        allocations: [
          {
            id: 'a1',
            incomeStreamId: 's1',
            incomeDescription: 'Paycheck',
            allocationType: 'budget_category' as const,
            targetId: 'c1',
            amount: 50000,
            createdAt: new Date(),
          },
        ],
        targets: {
          recurringItems: [],
          budgetCategories: [{ id: 'c1', name: 'Groceries' }],
          savingsGoals: [],
        },
      }

      const view = buildPaycheckView(input, 's1')

      expect(view?.allocations[0].targetName).toBe('Groceries')
    })
  })

  describe('buildAllPaycheckViews', () => {
    it('should build views for all income streams', () => {
      const input = {
        incomeStreams: [
          { id: 's1', description: 'Job 1', averageAmount: 300000, frequency: 'biweekly' },
          { id: 's2', description: 'Job 2', averageAmount: 100000, frequency: 'weekly' },
        ],
        allocations: [],
        targets: {
          recurringItems: [],
          budgetCategories: [],
          savingsGoals: [],
        },
      }

      const views = buildAllPaycheckViews(input)

      expect(views.length).toBe(2)
    })
  })

  describe('validatePaycheckAllocations', () => {
    it('should validate total allocations do not exceed income', () => {
      const input = {
        incomeStreams: [
          { id: 's1', description: 'Paycheck', averageAmount: 100000, frequency: 'biweekly' },
        ],
        allocations: [
          {
            id: 'a1',
            incomeStreamId: 's1',
            incomeDescription: 'Paycheck',
            allocationType: 'recurring_item' as const,
            targetId: 'r1',
            amount: 150000,
            createdAt: new Date(),
          },
        ],
        targets: {
          recurringItems: [{ id: 'r1', description: 'Rent' }],
          budgetCategories: [],
          savingsGoals: [],
        },
      }

      const result = validatePaycheckAllocations(input, 's1')

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should validate target exists', () => {
      const input = {
        incomeStreams: [
          { id: 's1', description: 'Paycheck', averageAmount: 300000, frequency: 'biweekly' },
        ],
        allocations: [
          {
            id: 'a1',
            incomeStreamId: 's1',
            incomeDescription: 'Paycheck',
            allocationType: 'recurring_item' as const,
            targetId: 'nonexistent',
            amount: 50000,
            createdAt: new Date(),
          },
        ],
        targets: {
          recurringItems: [],
          budgetCategories: [],
          savingsGoals: [],
        },
      }

      const result = validatePaycheckAllocations(input, 's1')

      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('not found'))).toBe(true)
    })

    it('should pass validation when allocations are valid', () => {
      const input = {
        incomeStreams: [
          { id: 's1', description: 'Paycheck', averageAmount: 300000, frequency: 'biweekly' },
        ],
        allocations: [
          {
            id: 'a1',
            incomeStreamId: 's1',
            incomeDescription: 'Paycheck',
            allocationType: 'recurring_item' as const,
            targetId: 'r1',
            amount: 100000,
            createdAt: new Date(),
          },
        ],
        targets: {
          recurringItems: [{ id: 'r1', description: 'Rent' }],
          budgetCategories: [],
          savingsGoals: [],
        },
      }

      const result = validatePaycheckAllocations(input, 's1')

      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })
  })
})
