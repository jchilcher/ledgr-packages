import { CategoryRule, Category } from '../types';

/**
 * Check if a description matches a pattern
 * Patterns can be:
 * - Simple substring match (case-insensitive)
 * - Regex pattern (if pattern starts and ends with /)
 */
export function matchesPattern(description: string, pattern: string): boolean {
  const lowerDescription = description.toLowerCase();

  // Check if pattern is a regex (starts and ends with /)
  if (pattern.startsWith('/') && pattern.endsWith('/')) {
    try {
      const regexPattern = pattern.slice(1, -1);
      const regex = new RegExp(regexPattern, 'i');
      return regex.test(description);
    } catch {
      // Invalid regex, fallback to substring match
      return lowerDescription.includes(pattern.toLowerCase());
    }
  }

  // Simple substring match
  return lowerDescription.includes(pattern.toLowerCase());
}

/**
 * Find the best matching category for a transaction description
 * Rules should be sorted by priority (descending)
 * @param description Transaction description to categorize
 * @param rules Category rules sorted by priority DESC
 * @returns Category ID or null if no match
 */
export function categorize(description: string, rules: CategoryRule[]): string | null {
  for (const rule of rules) {
    if (matchesPattern(description, rule.pattern)) {
      return rule.categoryId;
    }
  }
  return null;
}

/**
 * Extract a simple pattern from a transaction description
 * Removes numbers, special characters, and common suffixes
 */
export function extractPattern(description: string): string {
  let pattern = description.toLowerCase();

  // Remove common payment processor suffixes
  pattern = pattern.replace(/\s+#\d+$/, ''); // Remove "#12345"
  pattern = pattern.replace(/\s+\*\d+$/, ''); // Remove "*1234"
  pattern = pattern.replace(/\s+\d{4}$/, ''); // Remove "1234" (last 4 digits)

  // Remove extra whitespace
  pattern = pattern.trim();

  // Take the first meaningful word(s)
  const words = pattern.split(/\s+/);
  if (words.length > 0) {
    return words.slice(0, Math.min(2, words.length)).join(' ');
  }

  return pattern;
}

/**
 * Get default categorization rules for common merchants
 */
export function getDefaultRules(categories: Category[]): Omit<CategoryRule, 'id' | 'createdAt'>[] {
  const findCategory = (name: string) => categories.find(c => c.name === name)?.id;

  const groceriesId = findCategory('Groceries');
  const diningId = findCategory('Dining Out');
  const fuelId = findCategory('Fuel');
  const transportId = findCategory('Transportation');
  const entertainmentId = findCategory('Entertainment');
  const utilitiesId = findCategory('Utilities');
  const shoppingId = findCategory('Shopping');
  const subscriptionsId = findCategory('Subscriptions');
  const healthcareId = findCategory('Healthcare');
  const incomeId = findCategory('Income');
  const rentId = findCategory('Rent');
  const savingsId = findCategory('Savings');
  const transferId = findCategory('Transfer');

  const rules: Omit<CategoryRule, 'id' | 'createdAt'>[] = [];

  // Income patterns (high priority)
  if (incomeId) {
    rules.push(
      { pattern: 'direct deposit', categoryId: incomeId, priority: 80 },
      { pattern: 'payroll', categoryId: incomeId, priority: 80 },
      { pattern: 'salary', categoryId: incomeId, priority: 80 },
      { pattern: 'ach deposit', categoryId: incomeId, priority: 70 },
      { pattern: 'social security', categoryId: incomeId, priority: 80 },
      { pattern: 'pension', categoryId: incomeId, priority: 80 },
      { pattern: 'unemployment', categoryId: incomeId, priority: 80 },
      { pattern: 'venmo from', categoryId: incomeId, priority: 60 },
      { pattern: 'zelle from', categoryId: incomeId, priority: 60 },
      { pattern: 'cashapp from', categoryId: incomeId, priority: 60 },
    );
  }

  // Tax Refund
  const taxRefundId = findCategory('Tax Refund');
  if (taxRefundId) {
    rules.push(
      { pattern: 'tax refund', categoryId: taxRefundId, priority: 85 },
      { pattern: 'irs treas', categoryId: taxRefundId, priority: 85 },
      { pattern: 'state tax refund', categoryId: taxRefundId, priority: 85 },
      { pattern: 'federal tax', categoryId: taxRefundId, priority: 80 },
    );
  }

  // Reimbursement
  const reimbursementId = findCategory('Reimbursement');
  if (reimbursementId) {
    rules.push(
      { pattern: 'reimbursement', categoryId: reimbursementId, priority: 80 },
      { pattern: 'expense reimb', categoryId: reimbursementId, priority: 80 },
      { pattern: 'mileage reimb', categoryId: reimbursementId, priority: 80 },
      { pattern: 'travel reimb', categoryId: reimbursementId, priority: 80 },
    );
  }

  // Credit Card Payment
  const creditCardPaymentId = findCategory('Credit Card Payment');
  if (creditCardPaymentId) {
    rules.push(
      { pattern: 'credit card payment', categoryId: creditCardPaymentId, priority: 80 },
      { pattern: 'card payment', categoryId: creditCardPaymentId, priority: 70 },
      { pattern: 'chase card', categoryId: creditCardPaymentId, priority: 75 },
      { pattern: 'amex payment', categoryId: creditCardPaymentId, priority: 80 },
      { pattern: 'discover payment', categoryId: creditCardPaymentId, priority: 80 },
      { pattern: 'capital one payment', categoryId: creditCardPaymentId, priority: 80 },
      { pattern: 'citi card', categoryId: creditCardPaymentId, priority: 75 },
      { pattern: 'visa payment', categoryId: creditCardPaymentId, priority: 70 },
      { pattern: 'mastercard payment', categoryId: creditCardPaymentId, priority: 70 },
    );
  }

  // Groceries
  if (groceriesId) {
    rules.push(
      { pattern: 'walmart', categoryId: groceriesId, priority: 60 },
      { pattern: 'target', categoryId: groceriesId, priority: 60 },
      { pattern: 'kroger', categoryId: groceriesId, priority: 60 },
      { pattern: 'safeway', categoryId: groceriesId, priority: 60 },
      { pattern: 'whole foods', categoryId: groceriesId, priority: 60 },
      { pattern: 'trader joe', categoryId: groceriesId, priority: 60 },
      { pattern: 'costco', categoryId: groceriesId, priority: 60 },
      { pattern: "sam's club", categoryId: groceriesId, priority: 60 },
      { pattern: 'aldi', categoryId: groceriesId, priority: 60 },
      { pattern: 'publix', categoryId: groceriesId, priority: 60 },
      { pattern: 'wegmans', categoryId: groceriesId, priority: 60 },
      { pattern: 'h-e-b', categoryId: groceriesId, priority: 60 },
      { pattern: 'heb ', categoryId: groceriesId, priority: 60 },
      { pattern: 'food lion', categoryId: groceriesId, priority: 60 },
      { pattern: 'grocery', categoryId: groceriesId, priority: 50 },
      { pattern: 'supermarket', categoryId: groceriesId, priority: 50 },
    );
  }

  // Dining Out / Restaurants
  if (diningId) {
    rules.push(
      { pattern: 'starbucks', categoryId: diningId, priority: 60 },
      { pattern: 'mcdonalds', categoryId: diningId, priority: 60 },
      { pattern: "mcdonald's", categoryId: diningId, priority: 60 },
      { pattern: 'chipotle', categoryId: diningId, priority: 60 },
      { pattern: 'subway', categoryId: diningId, priority: 60 },
      { pattern: 'taco bell', categoryId: diningId, priority: 60 },
      { pattern: 'burger king', categoryId: diningId, priority: 60 },
      { pattern: 'chick-fil-a', categoryId: diningId, priority: 60 },
      { pattern: 'doordash', categoryId: diningId, priority: 65 },
      { pattern: 'grubhub', categoryId: diningId, priority: 65 },
      { pattern: 'uber eats', categoryId: diningId, priority: 65 },
      { pattern: 'restaurant', categoryId: diningId, priority: 50 },
      { pattern: 'cafe', categoryId: diningId, priority: 50 },
      { pattern: 'coffee', categoryId: diningId, priority: 45 },
      { pattern: 'pizza', categoryId: diningId, priority: 45 },
    );
  }

  // Fuel / Gas Stations
  if (fuelId) {
    rules.push(
      { pattern: 'shell', categoryId: fuelId, priority: 60 },
      { pattern: 'chevron', categoryId: fuelId, priority: 60 },
      { pattern: 'exxon', categoryId: fuelId, priority: 60 },
      { pattern: 'mobil', categoryId: fuelId, priority: 60 },
      { pattern: 'bp ', categoryId: fuelId, priority: 60 },
      { pattern: 'speedway', categoryId: fuelId, priority: 60 },
      { pattern: 'gas station', categoryId: fuelId, priority: 50 },
      { pattern: 'fuel', categoryId: fuelId, priority: 45 },
      { pattern: 'ev charging', categoryId: fuelId, priority: 60 },
      { pattern: 'chargepoint', categoryId: fuelId, priority: 60 },
    );
  }

  // Transportation
  if (transportId) {
    rules.push(
      { pattern: 'uber', categoryId: transportId, priority: 55 },
      { pattern: 'lyft', categoryId: transportId, priority: 60 },
      { pattern: 'taxi', categoryId: transportId, priority: 55 },
      { pattern: 'metro', categoryId: transportId, priority: 50 },
      { pattern: 'transit', categoryId: transportId, priority: 50 },
      { pattern: 'parking', categoryId: transportId, priority: 55 },
      { pattern: 'toll', categoryId: transportId, priority: 55 },
      { pattern: 'airline', categoryId: transportId, priority: 55 },
    );
  }

  // Subscriptions & Streaming
  if (subscriptionsId) {
    rules.push(
      { pattern: 'netflix', categoryId: subscriptionsId, priority: 70 },
      { pattern: 'spotify', categoryId: subscriptionsId, priority: 70 },
      { pattern: 'hulu', categoryId: subscriptionsId, priority: 70 },
      { pattern: 'disney+', categoryId: subscriptionsId, priority: 70 },
      { pattern: 'amazon prime', categoryId: subscriptionsId, priority: 70 },
      { pattern: 'apple tv', categoryId: subscriptionsId, priority: 70 },
      { pattern: 'apple music', categoryId: subscriptionsId, priority: 70 },
      { pattern: 'youtube premium', categoryId: subscriptionsId, priority: 70 },
    );
  }

  // Entertainment
  if (entertainmentId) {
    rules.push(
      { pattern: 'amc theatre', categoryId: entertainmentId, priority: 60 },
      { pattern: 'movie theater', categoryId: entertainmentId, priority: 55 },
      { pattern: 'ticketmaster', categoryId: entertainmentId, priority: 60 },
      { pattern: 'concert', categoryId: entertainmentId, priority: 50 },
      { pattern: 'steam', categoryId: entertainmentId, priority: 55 },
      { pattern: 'gamestop', categoryId: entertainmentId, priority: 60 },
    );
  }

  // Shopping
  if (shoppingId) {
    rules.push(
      { pattern: 'amazon', categoryId: shoppingId, priority: 55 },
      { pattern: 'amzn', categoryId: shoppingId, priority: 55 },
      { pattern: 'ebay', categoryId: shoppingId, priority: 55 },
      { pattern: 'best buy', categoryId: shoppingId, priority: 60 },
      { pattern: 'ikea', categoryId: shoppingId, priority: 60 },
    );
  }

  // Utilities
  if (utilitiesId) {
    rules.push(
      { pattern: 'electric', categoryId: utilitiesId, priority: 55 },
      { pattern: 'power company', categoryId: utilitiesId, priority: 60 },
      { pattern: 'water utility', categoryId: utilitiesId, priority: 60 },
      { pattern: 'at&t', categoryId: utilitiesId, priority: 60 },
      { pattern: 'verizon', categoryId: utilitiesId, priority: 60 },
      { pattern: 't-mobile', categoryId: utilitiesId, priority: 60 },
      { pattern: 'comcast', categoryId: utilitiesId, priority: 60 },
      { pattern: 'xfinity', categoryId: utilitiesId, priority: 60 },
      { pattern: 'internet', categoryId: utilitiesId, priority: 50 },
    );
  }

  // Healthcare
  if (healthcareId) {
    rules.push(
      { pattern: 'pharmacy', categoryId: healthcareId, priority: 55 },
      { pattern: 'hospital', categoryId: healthcareId, priority: 60 },
      { pattern: 'medical', categoryId: healthcareId, priority: 50 },
      { pattern: 'doctor', categoryId: healthcareId, priority: 50 },
      { pattern: 'dentist', categoryId: healthcareId, priority: 55 },
    );
  }

  // Rent/Housing
  if (rentId) {
    rules.push(
      { pattern: 'rent', categoryId: rentId, priority: 55 },
      { pattern: 'apartment', categoryId: rentId, priority: 50 },
      { pattern: 'mortgage', categoryId: rentId, priority: 65 },
    );
  }

  // Savings
  if (savingsId) {
    rules.push(
      { pattern: 'save as you go transfer', categoryId: savingsId, priority: 70 },
      { pattern: 'transfer to savings', categoryId: savingsId, priority: 70 },
      { pattern: 'savings transfer', categoryId: savingsId, priority: 70 },
    );
  }

  // Transfer
  if (transferId) {
    rules.push(
      { pattern: 'transfer from', categoryId: transferId, priority: 60 },
      { pattern: 'transfer to', categoryId: transferId, priority: 60 },
      { pattern: 'online transfer', categoryId: transferId, priority: 55 },
      { pattern: 'zelle', categoryId: transferId, priority: 50 },
      { pattern: 'venmo', categoryId: transferId, priority: 50 },
      { pattern: 'paypal', categoryId: transferId, priority: 50 },
    );
  }

  // Insurance
  const insuranceId = findCategory('Insurance');
  if (insuranceId) {
    rules.push(
      { pattern: 'insurance', categoryId: insuranceId, priority: 55 },
      { pattern: 'geico', categoryId: insuranceId, priority: 60 },
      { pattern: 'state farm', categoryId: insuranceId, priority: 60 },
      { pattern: 'allstate', categoryId: insuranceId, priority: 60 },
      { pattern: 'progressive', categoryId: insuranceId, priority: 60 },
      { pattern: 'liberty mutual', categoryId: insuranceId, priority: 60 },
      { pattern: 'usaa', categoryId: insuranceId, priority: 60 },
    );
  }

  // Education
  const educationId = findCategory('Education');
  if (educationId) {
    rules.push(
      { pattern: 'tuition', categoryId: educationId, priority: 60 },
      { pattern: 'university', categoryId: educationId, priority: 55 },
      { pattern: 'college', categoryId: educationId, priority: 55 },
      { pattern: 'school', categoryId: educationId, priority: 50 },
      { pattern: 'udemy', categoryId: educationId, priority: 60 },
      { pattern: 'coursera', categoryId: educationId, priority: 60 },
      { pattern: 'skillshare', categoryId: educationId, priority: 60 },
    );
  }

  // Childcare
  const childcareId = findCategory('Childcare');
  if (childcareId) {
    rules.push(
      { pattern: 'daycare', categoryId: childcareId, priority: 60 },
      { pattern: 'childcare', categoryId: childcareId, priority: 60 },
      { pattern: 'babysit', categoryId: childcareId, priority: 55 },
      { pattern: 'nanny', categoryId: childcareId, priority: 55 },
    );
  }

  // Pets
  const petsId = findCategory('Pets');
  if (petsId) {
    rules.push(
      { pattern: 'petco', categoryId: petsId, priority: 60 },
      { pattern: 'petsmart', categoryId: petsId, priority: 60 },
      { pattern: 'veterinar', categoryId: petsId, priority: 60 },
      { pattern: 'vet clinic', categoryId: petsId, priority: 60 },
      { pattern: 'pet food', categoryId: petsId, priority: 55 },
      { pattern: 'grooming', categoryId: petsId, priority: 50 },
    );
  }

  // Personal Care
  const personalCareId = findCategory('Personal Care');
  if (personalCareId) {
    rules.push(
      { pattern: 'salon', categoryId: personalCareId, priority: 55 },
      { pattern: 'barber', categoryId: personalCareId, priority: 60 },
      { pattern: 'spa', categoryId: personalCareId, priority: 55 },
      { pattern: 'sephora', categoryId: personalCareId, priority: 60 },
      { pattern: 'ulta', categoryId: personalCareId, priority: 60 },
      { pattern: 'nail', categoryId: personalCareId, priority: 50 },
    );
  }

  // Gifts
  const giftsId = findCategory('Gifts');
  if (giftsId) {
    rules.push(
      { pattern: 'hallmark', categoryId: giftsId, priority: 60 },
      { pattern: 'gift card', categoryId: giftsId, priority: 55 },
      { pattern: 'flowers', categoryId: giftsId, priority: 50 },
      { pattern: 'florist', categoryId: giftsId, priority: 55 },
      { pattern: '1-800-flowers', categoryId: giftsId, priority: 60 },
    );
  }

  // Charity
  const charityId = findCategory('Charity');
  if (charityId) {
    rules.push(
      { pattern: 'donation', categoryId: charityId, priority: 55 },
      { pattern: 'charity', categoryId: charityId, priority: 55 },
      { pattern: 'tithe', categoryId: charityId, priority: 60 },
      { pattern: 'church', categoryId: charityId, priority: 50 },
      { pattern: 'red cross', categoryId: charityId, priority: 60 },
      { pattern: 'united way', categoryId: charityId, priority: 60 },
      { pattern: 'gofundme', categoryId: charityId, priority: 55 },
    );
  }

  // Fitness
  const fitnessId = findCategory('Fitness');
  if (fitnessId) {
    rules.push(
      { pattern: 'planet fitness', categoryId: fitnessId, priority: 70 },
      { pattern: 'la fitness', categoryId: fitnessId, priority: 70 },
      { pattern: 'equinox', categoryId: fitnessId, priority: 70 },
      { pattern: 'orangetheory', categoryId: fitnessId, priority: 70 },
      { pattern: 'crossfit', categoryId: fitnessId, priority: 60 },
      { pattern: 'peloton', categoryId: fitnessId, priority: 70 },
      { pattern: 'yoga', categoryId: fitnessId, priority: 50 },
    );
  }

  // Home Improvement
  const homeImprovementId = findCategory('Home Improvement');
  if (homeImprovementId) {
    rules.push(
      { pattern: 'home depot', categoryId: homeImprovementId, priority: 65 },
      { pattern: "lowe's", categoryId: homeImprovementId, priority: 65 },
      { pattern: 'menards', categoryId: homeImprovementId, priority: 65 },
      { pattern: 'ace hardware', categoryId: homeImprovementId, priority: 60 },
      { pattern: 'harbor freight', categoryId: homeImprovementId, priority: 60 },
      { pattern: 'sherwin williams', categoryId: homeImprovementId, priority: 60 },
    );
  }

  // Clothing
  const clothingId = findCategory('Clothing');
  if (clothingId) {
    rules.push(
      { pattern: 'nordstrom', categoryId: clothingId, priority: 60 },
      { pattern: "macy's", categoryId: clothingId, priority: 60 },
      { pattern: 'gap', categoryId: clothingId, priority: 55 },
      { pattern: 'old navy', categoryId: clothingId, priority: 60 },
      { pattern: 'h&m', categoryId: clothingId, priority: 60 },
      { pattern: 'zara', categoryId: clothingId, priority: 60 },
      { pattern: 'nike', categoryId: clothingId, priority: 55 },
      { pattern: 'adidas', categoryId: clothingId, priority: 55 },
      { pattern: 'tj maxx', categoryId: clothingId, priority: 60 },
      { pattern: 'marshalls', categoryId: clothingId, priority: 60 },
      { pattern: 'ross', categoryId: clothingId, priority: 55 },
    );
  }

  return rules;
}

// Legacy class-based API for backward compatibility with desktop app
export class CategorizationEngine {
  private getCategoryRules: () => CategoryRule[];
  private getCategories: () => Category[];
  private updateTransaction?: (id: string, updates: { categoryId: string }) => void;
  private createCategoryRule?: (rule: Omit<CategoryRule, 'id' | 'createdAt'>) => CategoryRule;
  private getTransactions?: () => { id: string; description: string; categoryId?: string | null }[];

  constructor(dataSource: {
    getCategoryRules: () => CategoryRule[];
    getCategories: () => Category[];
    updateTransaction?: (id: string, updates: { categoryId: string }) => void;
    createCategoryRule?: (rule: Omit<CategoryRule, 'id' | 'createdAt'>) => CategoryRule;
    getTransactions?: () => { id: string; description: string; categoryId?: string | null }[];
  }) {
    this.getCategoryRules = dataSource.getCategoryRules;
    this.getCategories = dataSource.getCategories;
    this.updateTransaction = dataSource.updateTransaction;
    this.createCategoryRule = dataSource.createCategoryRule;
    this.getTransactions = dataSource.getTransactions;
  }

  categorize(description: string): string | null {
    const rules = this.getCategoryRules();
    return categorize(description, rules);
  }

  private matchesPattern(description: string, pattern: string): boolean {
    return matchesPattern(description, pattern);
  }

  applyRulesToTransactions(onlyUncategorized: boolean = false): { updated: number; total: number } {
    if (!this.updateTransaction || !this.getTransactions) {
      throw new Error('updateTransaction and getTransactions methods are required');
    }

    const transactions = this.getTransactions();
    const categories = this.getCategories();
    const uncategorizedCategory = categories.find(c => c.name.toLowerCase() === 'uncategorized');
    let updated = 0;

    for (const tx of transactions) {
      if (onlyUncategorized) {
        const hasCategory = tx.categoryId &&
          (!uncategorizedCategory || tx.categoryId !== uncategorizedCategory.id);
        if (hasCategory) continue;
      }

      const newCategoryId = this.categorize(tx.description);
      if (newCategoryId && newCategoryId !== tx.categoryId) {
        this.updateTransaction(tx.id, { categoryId: newCategoryId });
        updated++;
      }
    }

    return { updated, total: transactions.length };
  }

  createRuleFromTransaction(description: string, categoryId: string): CategoryRule {
    if (!this.createCategoryRule) {
      throw new Error('createCategoryRule method is required');
    }

    const pattern = extractPattern(description);
    const priority = 50;

    return this.createCategoryRule({
      pattern,
      categoryId,
      priority,
    });
  }

  getDefaultRules(): Omit<CategoryRule, 'id' | 'createdAt'>[] {
    return getDefaultRules(this.getCategories());
  }

  installDefaultRules(): void {
    if (!this.createCategoryRule) {
      throw new Error('createCategoryRule method is required');
    }

    const defaultRules = this.getDefaultRules();
    for (const rule of defaultRules) {
      this.createCategoryRule(rule);
    }
  }
}
