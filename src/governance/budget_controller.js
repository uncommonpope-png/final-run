class BudgetController {
  constructor(config = {}) {
    this.defaultBudget = config.defaultBudget || 10000;
    this.defaultWindowMs = config.defaultWindowMs || 3600000;
    
    this.skillBudgets = new Map();
    this.consumptionHistory = [];
    this.rateLimiters = new Map();
    
    this.exhaustionHandlers = [];
    this.currentBudgets = {};
  }

  initializeSkillBudget(skillName, budget, windowMs) {
    this.skillBudgets.set(skillName, {
      budget: budget || this.defaultBudget,
      windowMs: windowMs || this.defaultWindowMs,
      used: 0,
      resetAt: Date.now() + (windowMs || this.defaultWindowMs),
      requests: []
    });

    this.currentBudgets[skillName] = budget || this.defaultBudget;
  }

  setRateLimit(skillName, maxRequests, windowMs) {
    this.rateLimiters.set(skillName, {
      maxRequests: maxRequests || 100,
      windowMs: windowMs || 60000,
      currentCount: 0,
      windowStart: Date.now()
    });
  }

  async checkBudget(skillName, tokens = 1) {
    if (!this.skillBudgets.has(skillName)) {
      this.initializeSkillBudget(skillName);
    }

    const skillBudget = this.skillBudgets.get(skillName);
    const now = Date.now();

    if (now >= skillBudget.resetAt) {
      skillBudget.used = 0;
      skillBudget.resetAt = now + skillBudget.windowMs;
      skillBudget.requests = [];
    }

    const remaining = skillBudget.budget - skillBudget.used;
    const result = {
      allowed: remaining >= tokens,
      skill: skillName,
      requested: tokens,
      remaining: remaining,
      budget: skillBudget.budget,
      resetAt: skillBudget.resetAt,
      windowMs: skillBudget.windowMs
    };

    this._logConsumption(skillName, tokens, result.allowed);

    return result;
  }

  async consumeBudget(skillName, tokens = 1) {
    const checkResult = await this.checkBudget(skillName, tokens);

    if (!checkResult.allowed) {
      const exhaustionEvent = {
        skill: skillName,
        requested: tokens,
        remaining: checkResult.remaining,
        timestamp: new Date().toISOString(),
        type: 'budget_exhaustion'
      };

      this._handleExhaustion(exhaustionEvent);

      return {
        success: false,
        ...checkResult,
        reason: `Budget exhausted. Remaining: ${checkResult.remaining}, Reset at: ${new Date(checkResult.resetAt).toISOString()}`
      };
    }

    const skillBudget = this.skillBudgets.get(skillName);
    skillBudget.used += tokens;
    skillBudget.requests.push({
      tokens,
      timestamp: Date.now()
    });

    return {
      success: true,
      ...checkResult,
      newUsed: skillBudget.used
    };
  }

  async checkRateLimit(skillName) {
    if (!this.rateLimiters.has(skillName)) {
      this.setRateLimit(skillName);
    }

    const limiter = this.rateLimiters.get(skillName);
    const now = Date.now();

    if (now - limiter.windowStart >= limiter.windowMs) {
      limiter.currentCount = 0;
      limiter.windowStart = now;
    }

    const allowed = limiter.currentCount < limiter.maxRequests;
    const result = {
      allowed,
      skill: skillName,
      currentCount: limiter.currentCount,
      maxRequests: limiter.maxRequests,
      windowMs: limiter.windowMs,
      resetAt: limiter.windowStart + limiter.windowMs
    };

    if (allowed) {
      limiter.currentCount++;
    }

    return result;
  }

  async consumeWithRateLimit(skillName, tokens = 1) {
    const rateCheck = await this.checkRateLimit(skillName);
    if (!rateCheck.allowed) {
      return {
        success: false,
        reason: `Rate limit exceeded. Limit: ${rateCheck.maxRequests} per ${rateCheck.windowMs}ms`,
        rateLimit: rateCheck
      };
    }

    return this.consumeBudget(skillName, tokens);
  }

  _logConsumption(skillName, tokens, allowed) {
    this.consumptionHistory.push({
      skill: skillName,
      tokens,
      allowed,
      timestamp: new Date().toISOString()
    });

    if (this.consumptionHistory.length > 10000) {
      this.consumptionHistory = this.consumptionHistory.slice(-5000);
    }
  }

  _handleExhaustion(event) {
    for (const handler of this.exhaustionHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Exhaustion handler error:', error);
      }
    }
  }

  onBudgetExhaustion(handler) {
    this.exhaustionHandlers.push(handler);
  }

  getBudgetStatus(skillName) {
    if (!this.skillBudgets.has(skillName)) {
      return { initialized: false };
    }

    const budget = this.skillBudgets.get(skillName);
    return {
      initialized: true,
      budget: budget.budget,
      used: budget.used,
      remaining: budget.budget - budget.used,
      percentageUsed: ((budget.used / budget.budget) * 100).toFixed(2),
      resetAt: budget.resetAt,
      windowMs: budget.windowMs
    };
  }

  getAllBudgetStatus() {
    const status = {};
    for (const [skill, budget] of this.skillBudgets) {
      status[skill] = {
        budget: budget.budget,
        used: budget.used,
        remaining: budget.budget - budget.used,
        percentageUsed: ((budget.used / budget.budget) * 100).toFixed(2),
        resetAt: budget.resetAt
      };
    }
    return status;
  }

  getRateLimitStatus(skillName) {
    if (!this.rateLimiters.has(skillName)) {
      return { initialized: false };
    }

    const limiter = this.rateLimiters.get(skillName);
    return {
      initialized: true,
      currentCount: limiter.currentCount,
      maxRequests: limiter.maxRequests,
      remaining: limiter.maxRequests - limiter.currentCount,
      windowMs: limiter.windowMs,
      resetAt: limiter.windowStart + limiter.windowMs
    };
  }

  resetBudget(skillName) {
    if (this.skillBudgets.has(skillName)) {
      const budget = this.skillBudgets.get(skillName);
      budget.used = 0;
      budget.resetAt = Date.now() + budget.windowMs;
      budget.requests = [];
      return { success: true, skill: skillName };
    }
    return { success: false, error: 'Skill budget not found' };
  }

  resetRateLimit(skillName) {
    if (this.rateLimiters.has(skillName)) {
      const limiter = this.rateLimiters.get(skillName);
      limiter.currentCount = 0;
      limiter.windowStart = Date.now();
      return { success: true, skill: skillName };
    }
    return { success: false, error: 'Rate limiter not found' };
  }

  updateBudget(skillName, newBudget) {
    if (this.skillBudgets.has(skillName)) {
      const budget = this.skillBudgets.get(skillName);
      budget.budget = newBudget;
      this.currentBudgets[skillName] = newBudget;
      return { success: true, skill: skillName, newBudget };
    }
    return { success: false, error: 'Skill budget not found' };
  }

  getConsumptionHistory(skillName, limit = 100) {
    const history = skillName
      ? this.consumptionHistory.filter(c => c.skill === skillName)
      : this.consumptionHistory;

    return history.slice(-limit);
  }

  getConsumptionStats(skillName) {
    const history = skillName
      ? this.consumptionHistory.filter(c => c.skill === skillName)
      : this.consumptionHistory;

    const totalTokens = history.reduce((sum, c) => sum + c.tokens, 0);
    const allowedCount = history.filter(c => c.allowed).length;
    const blockedCount = history.filter(c => !c.allowed).length;

    return {
      totalRequests: history.length,
      totalTokens,
      allowed: allowedCount,
      blocked: blockedCount,
      blockRate: history.length > 0 ? (blockedCount / history.length * 100).toFixed(2) : 0
    };
  }

  getActiveSkills() {
    return Array.from(this.skillBudgets.keys());
  }

  clearConsumptionHistory() {
    this.consumptionHistory = [];
  }
}

module.exports = BudgetController;