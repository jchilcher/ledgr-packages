import { calculateTrendDampening, calculateConfidenceDecay, selectGranularity } from '../engines/enhanced-forecast-engine'

describe('EnhancedForecastEngine', () => {
  describe('calculateTrendDampening', () => {
    it('should return dampening factor for 0.95 base', () => {
      const dampening = calculateTrendDampening(0, 0.95)
      expect(dampening).toBe(1)
    })

    it('should decay exponentially over time', () => {
      const month1 = calculateTrendDampening(1, 0.95)
      const month12 = calculateTrendDampening(12, 0.95)

      expect(month1).toBe(0.95)
      expect(month12).toBeLessThan(month1)
      expect(month12).toBeCloseTo(Math.pow(0.95, 12), 4)
    })

    it('should approach zero for distant future', () => {
      const month60 = calculateTrendDampening(60, 0.95)
      expect(month60).toBeLessThan(0.1)
    })
  })

  describe('calculateConfidenceDecay', () => {
    it('should start at base confidence for current month', () => {
      const confidence = calculateConfidenceDecay(0, 0.85)
      expect(confidence).toBe(0.85)
    })

    it('should decay with square root of time', () => {
      const base = 0.85
      const month3 = calculateConfidenceDecay(3, base)
      const month12 = calculateConfidenceDecay(12, base)

      expect(month3).toBeLessThan(base)
      expect(month12).toBeLessThan(month3)
    })

    it('should follow square root decay formula', () => {
      const monthsInFuture = 6
      const baseConfidence = 0.85
      const daysInFuture = monthsInFuture * 30

      const expected = baseConfidence / Math.sqrt(1 + daysInFuture / 90)
      const actual = calculateConfidenceDecay(monthsInFuture, baseConfidence)

      expect(actual).toBeCloseTo(expected, 4)
    })
  })

  describe('selectGranularity', () => {
    it('should return daily for <= 90 days', () => {
      expect(selectGranularity(30)).toBe('daily')
      expect(selectGranularity(90)).toBe('daily')
    })

    it('should return weekly for <= 365 days', () => {
      expect(selectGranularity(180)).toBe('weekly')
      expect(selectGranularity(365)).toBe('weekly')
    })

    it('should return monthly for > 365 days', () => {
      expect(selectGranularity(500)).toBe('monthly')
      expect(selectGranularity(1825)).toBe('monthly')
    })
  })
})
