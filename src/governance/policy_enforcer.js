class PolicyEnforcer {
  constructor() {
    this.auditLog = [];
    this.policies = this._initializePolicies();
    this.degradationMode = false;
  }

  _initializePolicies() {
    return {
      forbiddenActions: [
        'system_shutdown',
        'credential_access',
        'data_exfiltration',
        'unauthorized_deployment',
        'destructive_command'
      ],
      restrictedCommands: [
        'rm -rf',
        'del /s /q',
        'format',
        'shutdown',
        'restart'
      ],
      requireApproval: [
        'deploy_production',
        'modify_permissions',
        'access_sensitive_data',
        'cost_generating_action'
      ],
      maxConcurrentOps: 5,
      blockTimeout: 30000
    };
  }

  async validateAction(action) {
    const decision = {
      action: action.type,
      timestamp: new Date().toISOString(),
      allowed: true,
      reason: 'Policy check passed',
      enforcementLevel: 'allow'
    };

    try {
      if (this.degradationMode) {
        decision.enforcementLevel = 'degraded';
        decision.reason = 'Operating in degraded mode - limited validation';
        this._logAudit(decision);
        return decision;
      }

      if (!action.type || typeof action.type !== 'string') {
        throw new Error('Invalid action type');
      }

      if (this.policies.forbiddenActions.includes(action.type)) {
        decision.allowed = false;
        decision.reason = `Action "${action.type}" is explicitly forbidden`;
        decision.enforcementLevel = 'block';
        this._logAudit(decision);
        return decision;
      }

      if (action.command && this._containsForbiddenCommand(action.command)) {
        decision.allowed = false;
        decision.reason = 'Command contains forbidden patterns';
        decision.enforcementLevel = 'block';
        this._logAudit(decision);
        return decision;
      }

      if (this.policies.requireApproval.includes(action.type)) {
        decision.allowed = false;
        decision.reason = `Action "${action.type}" requires approval`;
        decision.enforcementLevel = 'require_approval';
        this._logAudit(decision);
        return decision;
      }

      this._logAudit(decision);
      return decision;

    } catch (error) {
      return this._handlePolicyFailure(error, action);
    }
  }

  _containsForbiddenCommand(command) {
    return this.policies.restrictedCommands.some(
      pattern => command.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  _logAudit(decision) {
    this.auditLog.push({
      ...decision,
      loggedAt: new Date().toISOString()
    });

    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-5000);
    }
  }

  _handlePolicyFailure(error, action) {
    const decision = {
      action: action.type || 'unknown',
      timestamp: new Date().toISOString(),
      allowed: true,
      reason: `Policy engine error: ${error.message}. Allowing action as safety fallback.`,
      enforcementLevel: 'failopen',
      error: true
    };

    this.degradationMode = true;
    setTimeout(() => { this.degradationMode = false; }, this.policies.blockTimeout);

    this._logAudit(decision);
    return decision;
  }

  async approveAction(actionId, approver) {
    const auditEntry = this.auditLog.find(
      entry => entry.action === actionId && entry.enforcementLevel === 'require_approval'
    );

    if (auditEntry) {
      auditEntry.approved = true;
      auditEntry.approvedBy = approver;
      auditEntry.approvedAt = new Date().toISOString();
      auditEntry.allowed = true;
      auditEntry.reason = `Approved by ${approver}`;
      return { success: true, updatedDecision: auditEntry };
    }

    return { success: false, error: 'Action not found or not requiring approval' };
  }

  getAuditLog(limit = 100) {
    return this.auditLog.slice(-limit);
  }

  getAuditLogByAction(actionType) {
    return this.auditLog.filter(entry => entry.action === actionType);
  }

  getBlockedActions() {
    return this.auditLog.filter(entry => !entry.allowed);
  }

  clearAuditLog() {
    this.auditLog = [];
  }

  exportAuditLog() {
    return JSON.stringify(this.auditLog, null, 2);
  }

  getPolicyStats() {
    return {
      totalDecisions: this.auditLog.length,
      allowed: this.auditLog.filter(e => e.allowed).length,
      blocked: this.auditLog.filter(e => !e.allowed).length,
      requireApproval: this.auditLog.filter(e => e.enforcementLevel === 'require_approval').length,
      degradationEvents: this.auditLog.filter(e => e.enforcementLevel === 'degraded').length,
      errors: this.auditLog.filter(e => e.error).length
    };
  }
}

module.exports = PolicyEnforcer;