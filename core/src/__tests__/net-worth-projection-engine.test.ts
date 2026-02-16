import { analyzeNetWorthTrend, projectNetWorth, calculateMilestones } from '../engines/net-worth-projection-engine'

describe('NetWorthProjectionEngine', () => {
  describe('analyzeNetWorthTrend', () => {
    it('should calculate linear regression trend', () => {
      const history = []
      const now = new Date()

      for (let i = 0; i < 12; i++) {
        history.push({
          id: `h${i}`,
          date: new Date(now.getFullYear(), now.getMonth() - (11 - i), 1),
          totalAssets: 100000,
          totalLiabilities: 0,
          netWorth: 100000 + (i * 10000),
        })
      }

      const trend = analyzeNetWorthTrend(history)

      expect(trend.direction).toBe('increasing')
      expect(trend.monthlyGrowthAmount).toBeGreaterThan(0)
    })

    it('should return stable for insufficient data', () => {
      const trend = analyzeNetWorthTrend([])

      expect(trend.direction).toBe('stable')
      expect(trend.monthlyGrowthRate).toBe(0)
    })

    it('should detect declining trend', () => {
      const history = []
      const now = new Date()

      for (let i = 0; i < 12; i++) {
        history.push({
          id: `h${i}`,
          date: new Date(now.getFullYear(), now.getMonth() - (11 - i), 1),
          totalAssets: 100000,
          totalLiabilities: 0,
          netWorth: 100000 - (i * 10000),
        })
      }

      const trend = analyzeNetWorthTrend(history)

      expect(trend.direction).toBe('decreasing')
      expect(trend.monthlyGrowthRate).toBeLessThan(0)
    })
  })

  describe('projectNetWorth', () => {
    it('should project future net worth based on trend', () => {
      const trend = {
        direction: 'increasing' as const,
        monthlyGrowthRate: 5,
        monthlyGrowthAmount: 10000,
        annualizedGrowthRate: 60,
        volatility: 5000,
      }

      const projections = projectNetWorth(100000, trend, 12)

      expect(projections.length).toBe(12)
      expect(projections[11].projectedNetWorth).toBeGreaterThan(100000)
    })

    it('should include confidence intervals', () => {
      const trend = {
        direction: 'increasing' as const,
        monthlyGrowthRate: 5,
        monthlyGrowthAmount: 10000,
        annualizedGrowthRate: 60,
        volatility: 5000,
      }

      const projections = projectNetWorth(100000, trend, 12)

      expect(projections[0].confidenceLower).toBeLessThan(projections[0].projectedNetWorth)
      expect(projections[0].confidenceUpper).toBeGreaterThan(projections[0].projectedNetWorth)
    })
  })

  describe('calculateMilestones', () => {
    it('should mark milestones as achieved when reached', () => {
      const history = [
        {
          id: 'h1',
          date: new Date(),
          totalAssets: 100000,
          totalLiabilities: 0,
          netWorth: 100000,
        },
      ]

      const trend = {
        direction: 'increasing' as const,
        monthlyGrowthRate: 5,
        monthlyGrowthAmount: 5000,
        annualizedGrowthRate: 60,
        volatility: 2000,
      }

      const milestones = calculateMilestones(100000, trend, history)

      const milestone100k = milestones.find(m => m.amount === 100000)
      expect(milestone100k?.achieved).toBe(true)
    })

    it('should project dates for future milestones', () => {
      const history = [
        {
          id: 'h1',
          date: new Date(),
          totalAssets: 50000,
          totalLiabilities: 0,
          netWorth: 50000,
        },
      ]

      const trend = {
        direction: 'increasing' as const,
        monthlyGrowthRate: 5,
        monthlyGrowthAmount: 5000,
        annualizedGrowthRate: 60,
        volatility: 2000,
      }

      const milestones = calculateMilestones(50000, trend, history)

      const milestone100k = milestones.find(m => m.amount === 100000)
      expect(milestone100k?.achieved).toBe(false)
      expect(milestone100k?.projectedDate).not.toBeNull()
      expect(milestone100k?.monthsAway).toBeGreaterThan(0)
    })
  })
})
