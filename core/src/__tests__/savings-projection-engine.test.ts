import { projectSavingsGoal } from '../engines/savings-projection-engine'

function makeSavingsGoal(overrides: any = {}): any {
  return {
    id: `goal-${Math.random().toString(36).slice(2)}`,
    name: 'Test Goal',
    targetAmount: 100000,
    currentAmount: 30000,
    targetDate: null,
    monthlyContribution: undefined,
    ...overrides,
  }
}

function makeContribution(overrides: any = {}): any {
  return {
    id: `contrib-${Math.random().toString(36).slice(2)}`,
    goalId: 'goal-1',
    amount: 5000,
    date: new Date(),
    ...overrides,
  }
}

describe('SavingsProjectionEngine', () => {
  describe('projectSavingsGoal', () => {
    it('should calculate remaining amount correctly', () => {
      const goal = makeSavingsGoal({
        targetAmount: 100000,
        currentAmount: 30000,
      })

      const projection = projectSavingsGoal(goal, [])

      expect(projection.remainingAmount).toBe(70000)
      expect(projection.percentComplete).toBe(30)
    })

    it('should calculate projected completion date based on monthly rate', () => {
      const goal = makeSavingsGoal({
        targetAmount: 100000,
        currentAmount: 40000,
        monthlyContribution: 10000,
      })

      const projection = projectSavingsGoal(goal, [])

      expect(projection.projectedCompletionDate).not.toBeNull()
      expect(projection.monthsToCompletion).toBe(6)
    })

    it('should calculate required monthly to hit target date', () => {
      const now = new Date()
      const futureDate = new Date(now)
      futureDate.setMonth(futureDate.getMonth() + 10)

      const goal = makeSavingsGoal({
        targetAmount: 100000,
        currentAmount: 40000,
        targetDate: futureDate,
      })

      const projection = projectSavingsGoal(goal, [])

      expect(projection.requiredMonthlyToHitTarget).toBeGreaterThan(0)
      expect(projection.requiredMonthlyToHitTarget).toBeLessThanOrEqual(6000)
    })

    it('should mark goal as on-track when completion date is before target', () => {
      const now = new Date()
      const futureDate = new Date(now)
      futureDate.setMonth(futureDate.getMonth() + 12)

      const goal = makeSavingsGoal({
        targetAmount: 100000,
        currentAmount: 50000,
        targetDate: futureDate,
        monthlyContribution: 10000,
      })

      const projection = projectSavingsGoal(goal, [])

      expect(projection.onTrack).toBe(true)
    })

    it('should mark goal as off-track when completion date is after target', () => {
      const now = new Date()
      const nearDate = new Date(now)
      nearDate.setMonth(nearDate.getMonth() + 3)

      const goal = makeSavingsGoal({
        targetAmount: 100000,
        currentAmount: 10000,
        targetDate: nearDate,
        monthlyContribution: 5000,
      })

      const projection = projectSavingsGoal(goal, [])

      expect(projection.onTrack).toBe(false)
    })

    it('should generate 3 scenarios: current, aggressive, conservative', () => {
      const goal = makeSavingsGoal({
        targetAmount: 100000,
        currentAmount: 40000,
        monthlyContribution: 10000,
      })

      const projection = projectSavingsGoal(goal, [])

      expect(projection.scenarios.length).toBe(3)
      expect(projection.scenarios.find(s => s.type === 'current_pace')).toBeDefined()
      expect(projection.scenarios.find(s => s.type === 'aggressive')).toBeDefined()
      expect(projection.scenarios.find(s => s.type === 'conservative')).toBeDefined()
    })

    it('should calculate aggressive scenario at 1.5x current rate', () => {
      const goal = makeSavingsGoal({
        targetAmount: 100000,
        currentAmount: 40000,
        monthlyContribution: 10000,
      })

      const projection = projectSavingsGoal(goal, [])

      const aggressive = projection.scenarios.find(s => s.type === 'aggressive')
      expect(aggressive?.monthlyContribution).toBe(15000)
    })

    it('should calculate conservative scenario at 0.75x current rate', () => {
      const goal = makeSavingsGoal({
        targetAmount: 100000,
        currentAmount: 40000,
        monthlyContribution: 10000,
      })

      const projection = projectSavingsGoal(goal, [])

      const conservative = projection.scenarios.find(s => s.type === 'conservative')
      expect(conservative?.monthlyContribution).toBe(7500)
    })

    it('should handle goals with no contributions yet', () => {
      const goal = makeSavingsGoal({
        targetAmount: 100000,
        currentAmount: 0,
        monthlyContribution: undefined,
      })

      const projection = projectSavingsGoal(goal, [])

      expect(projection.currentMonthlyRate).toBe(0)
      expect(projection.projectedCompletionDate).toBeNull()
    })

    it('should calculate average contribution from history', () => {
      const now = new Date()
      const contributions = []

      for (let i = 0; i < 6; i++) {
        contributions.push(
          makeContribution({
            amount: 5000,
            date: new Date(now.getFullYear(), now.getMonth() - i, 15),
          })
        )
      }

      const goal = makeSavingsGoal({
        targetAmount: 100000,
        currentAmount: 30000,
        monthlyContribution: undefined,
      })

      const projection = projectSavingsGoal(goal, contributions)

      expect(projection.averageContribution).toBe(5000)
    })

    it('should mark completed goals as on-track', () => {
      const goal = makeSavingsGoal({
        targetAmount: 100000,
        currentAmount: 100000,
      })

      const projection = projectSavingsGoal(goal, [])

      expect(projection.remainingAmount).toBe(0)
      expect(projection.onTrack).toBe(true)
      expect(projection.monthsToCompletion).toBe(0)
    })

    it('should handle goals without target dates', () => {
      const goal = makeSavingsGoal({
        targetAmount: 100000,
        currentAmount: 40000,
        targetDate: null,
        monthlyContribution: 10000,
      })

      const projection = projectSavingsGoal(goal, [])

      expect(projection.targetDate).toBeNull()
      expect(projection.requiredMonthlyToHitTarget).toBeNull()
      expect(projection.onTrack).toBe(true)
    })
  })
})
