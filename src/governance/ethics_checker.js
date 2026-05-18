class EthicsChecker {
  constructor() {
    this.values = this._initializeValues();
    this.harmPatterns = this._initializeHarmPatterns();
    this.assessmentHistory = [];
    this.overrides = [];
  }

  _initializeValues() {
    return {
      transparency: 0.9,
      fairness: 0.85,
      privacy: 0.95,
      safety: 1.0,
      autonomy: 0.7,
      accountability: 0.9,
      nonmaleficence: 1.0,
      beneficence: 0.8
    };
  }

  _initializeHarmPatterns() {
    return {
      physical: [
        'harm', 'injury', 'damage', 'destroy', 'attack', 'threaten'
      ],
      financial: [
        'steal', 'fraud', 'scam', 'extort', ' embezzl', 'debt'
      ],
      data: [
        'exfiltrate', 'leak', 'expose', 'breach', 'unauthorized_access'
      ],
      reputational: [
        'defame', 'slander', 'libel', 'shame', 'humiliate'
      ],
      privacy: [
        'surveil', 'track', 'monitor', 'profile', 'identify'
      ]
    };
  }

  async assessAction(action) {
    const assessment = {
      actionId: action.id || `action_${Date.now()}`,
      actionType: action.type,
      timestamp: new Date().toISOString(),
      passed: true,
      confidence: 1.0,
      concerns: [],
      stakeholderImpacts: [],
      valuesAlignment: {},
      overrideApplied: false
    };

    try {
      const harmResult = this._detectHarm(action);
      if (harmResult.detected) {
        assessment.passed = false;
        assessment.confidence = harmResult.confidence;
        assessment.concerns.push(...harmResult.concerns);
      }

      const alignmentResult = this._checkValuesAlignment(action);
      assessment.valuesAlignment = alignmentResult.scores;

      if (alignmentResult.minScore < 0.5) {
        assessment.passed = false;
        assessment.concerns.push(`Values alignment below threshold: ${alignmentResult.minScore}`);
      }

      const stakeholderResult = this._assessStakeholderImpact(action);
      assessment.stakeholderImpacts = stakeholderResult.impacts;

      if (stakeholderResult.maxImpact > 0.8) {
        assessment.concerns.push('High stakeholder impact detected');
      }

      if (assessment.concerns.length > 0) {
        assessment.confidence = Math.max(0.1, assessment.confidence - (assessment.concerns.length * 0.1));
      }

      this._logAssessment(assessment);
      return assessment;

    } catch (error) {
      return this._handleAssessmentError(error, action);
    }
  }

  _detectHarm(action) {
    const result = {
      detected: false,
      confidence: 0.0,
      concerns: [],
      categories: []
    };

    const actionText = JSON.stringify(action).toLowerCase();

    for (const [category, patterns] of Object.entries(this.harmPatterns)) {
      const matches = patterns.filter(pattern => actionText.includes(pattern));
      if (matches.length > 0) {
        result.detected = true;
        result.categories.push(category);
        result.confidence = Math.min(1.0, 0.5 + (matches.length * 0.15));
        result.concerns.push(`${category} harm: ${matches.join(', ')}`);
      }
    }

    if (action.destructive || action.irreversible) {
      result.detected = true;
      result.confidence = Math.max(result.confidence, 0.9);
      result.concerns.push('Action is destructive or irreversible');
    }

    return result;
  }

  _checkValuesAlignment(action) {
    const scores = {};
    let minScore = 1.0;

    for (const [value, weight] of Object.entries(this.values)) {
      let score = 0.5;

      if (action.valuesAlignment && action.valuesAlignment[value] !== undefined) {
        score = action.valuesAlignment[value];
      } else {
        score = this._inferValueScore(value, action);
      }

      scores[value] = Math.max(0, Math.min(1, score * weight));
      minScore = Math.min(minScore, scores[value]);
    }

    return { scores, minScore };
  }

  _inferValueScore(value, action) {
    const actionText = JSON.stringify(action).toLowerCase();

    const valueIndicators = {
      transparency: ['public', 'visible', 'disclosed', 'audit'],
      fairness: ['equal', 'impartial', 'balanced', 'just'],
      privacy: ['encrypt', 'private', 'confidential', 'anon'],
      safety: ['safe', 'protect', 'secure', 'prevent'],
      autonomy: ['choice', 'consent', 'voluntary', 'independent'],
      accountability: ['responsible', 'traceable', 'recorded', 'attributed'],
      nonmaleficence: ['harmless', 'safe', 'protective'],
      beneficence: ['help', 'improve', 'benefit', 'assist']
    };

    const indicators = valueIndicators[value] || [];
    const matchCount = indicators.filter(ind => actionText.includes(ind)).length;

    return 0.3 + (matchCount * 0.15);
  }

  _assessStakeholderImpact(action) {
    const stakeholders = action.stakeholders || ['system', 'users', 'operators'];
    const impacts = [];

    const impactWeights = {
      users: 0.9,
      operators: 0.7,
      system: 0.5,
      organization: 0.8,
      public: 1.0,
      environment: 0.9
    };

    for (const stakeholder of stakeholders) {
      let impactScore = 0.2;

      if (action.affects === stakeholder) {
        impactScore = 0.7;
      }

      if (action.irreversible && action.affects === stakeholder) {
        impactScore = 1.0;
      }

      impactScore *= impactWeights[stakeholder] || 0.5;

      impacts.push({
        stakeholder,
        impact: impactScore,
        affected: action.affects === stakeholder
      });
    }

    const maxImpact = Math.max(...impacts.map(i => i.impact));

    return { impacts, maxImpact };
  }

  _logAssessment(assessment) {
    this.assessmentHistory.push(assessment);

    if (this.assessmentHistory.length > 5000) {
      this.assessmentHistory = this.assessmentHistory.slice(-2500);
    }
  }

  _handleAssessmentError(error, action) {
    return {
      actionId: action.id || `action_${Date.now()}`,
      actionType: action.type || 'unknown',
      timestamp: new Date().toISOString(),
      passed: true,
      confidence: 0.5,
      concerns: [`Assessment error: ${error.message}`],
      stakeholderImpacts: [],
      valuesAlignment: this.values,
      error: true
    };
  }

  async overrideAssessment(actionId, justification, overrideBy) {
    const assessment = this.assessmentHistory.find(a => a.actionId === actionId);

    if (!assessment) {
      return { success: false, error: 'Assessment not found' };
    }

    assessment.overrideApplied = true;
    assessment.overrideJustification = justification;
    assessment.overriddenBy = overrideBy;
    assessment.overriddenAt = new Date().toISOString();

    this.overrides.push({
      actionId,
      justification,
      overrideBy,
      timestamp: new Date().toISOString()
    });

    return { success: true, updatedAssessment: assessment };
  }

  getAssessmentHistory(limit = 100) {
    return this.assessmentHistory.slice(-limit);
  }

  getFailedAssessments() {
    return this.assessmentHistory.filter(a => !a.passed);
  }

  getOverrideHistory() {
    return this.overrides;
  }

  getEthicsStats() {
    return {
      totalAssessments: this.assessmentHistory.length,
      passed: this.assessmentHistory.filter(a => a.passed).length,
      failed: this.assessmentHistory.filter(a => !a.passed).length,
      overrides: this.overrides.length,
      errors: this.assessmentHistory.filter(a => a.error).length,
      averageConfidence: this.assessmentHistory.reduce((sum, a) => sum + a.confidence, 0) / 
        (this.assessmentHistory.length || 1)
    };
  }

  updateValues(newValues) {
    this.values = { ...this.values, ...newValues };
    return { success: true, currentValues: this.values };
  }

  getValues() {
    return { ...this.values };
  }
}

module.exports = EthicsChecker;