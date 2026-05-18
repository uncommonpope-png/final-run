class SelfOptimizer {
    constructor() {
        this.skillProfiles = new Map();
        this.performanceHistory = new Map();
        this.circuitBreakers = new Map();
        this.optimizationThreshold = 100;
        this.slowSkillThreshold = 200;
        this.memoryCompactionEnabled = true;
        this.maxMemoryUsage = 100 * 1024 * 1024;
        this.currentMemoryUsage = 0;
        this.failedSkillAttempts = new Map();
    }

    async profileSkill(skillName, executionTime, success, memoryUsed) {
        if (!this.skillProfiles.has(skillName)) {
            this.skillProfiles.set(skillName, {
                name: skillName,
                totalExecutions: 0,
                successfulExecutions: 0,
                failedExecutions: 0,
                totalTime: 0,
                avgTime: 0,
                minTime: Infinity,
                maxTime: 0,
                totalMemory: 0,
                avgMemory: 0,
                lastExecuted: null,
                history: []
            });
        }

        const profile = this.skillProfiles.get(skillName);
        
        profile.totalExecutions++;
        profile.totalTime += executionTime;
        profile.avgTime = profile.totalTime / profile.totalExecutions;
        profile.minTime = Math.min(profile.minTime, executionTime);
        profile.maxTime = Math.max(profile.maxTime, executionTime);
        profile.totalMemory += memoryUsed;
        profile.avgMemory = profile.totalMemory / profile.totalExecutions;
        profile.lastExecuted = Date.now();
        
        if (success) {
            profile.successfulExecutions++;
        } else {
            profile.failedExecutions++;
        }

        profile.history.push({
            timestamp: Date.now(),
            executionTime,
            success,
            memoryUsed
        });

        if (profile.history.length > 100) {
            profile.history.shift();
        }

        this.currentMemoryUsage += memoryUsed;
        await this.checkMemoryPressure();

        if (executionTime > this.slowSkillThreshold) {
            await this.markSlowSkill(skillName);
        }

        if (!success) {
            await this.recordFailure(skillName);
        } else {
            this.clearFailure(skillName);
        }
    }

    async checkMemoryPressure() {
        if (this.currentMemoryUsage > this.maxMemoryUsage && this.memoryCompactionEnabled) {
            await this.compactMemory();
        }
    }

    async compactMemory() {
        const startMemory = this.currentMemoryUsage;
        
        for (const [skillName, profile] of this.skillProfiles.entries()) {
            if (profile.history.length > 20) {
                profile.history = profile.history.slice(-20);
            }
        }

        this.performanceHistory.clear();
        
        let released = startMemory - this.currentMemoryUsage;
        console.log(`[SelfOptimizer] Memory compaction: released ${(released / 1024 / 1024).toFixed(2)}MB`);
        
        return { releasedBytes: released };
    }

    async markSlowSkill(skillName) {
        const profile = this.skillProfiles.get(skillName);
        if (!profile) return;

        const refactorCandidates = this.skillProfiles.get('refactorCandidates') || [];
        refactorCandidates.push({
            skillName,
            reason: 'slow_execution',
            avgTime: profile.avgTime,
            threshold: this.slowSkillThreshold
        });

        console.log(`[SelfOptimizer] Slow skill detected: ${skillName} (avg: ${profile.avgTime}ms)`);
    }

    async recordFailure(skillName) {
        const attempts = this.failedSkillAttempts.get(skillName) || 0;
        this.failedSkillAttempts.set(skillName, attempts + 1);

        if (attempts + 1 >= 5) {
            await this.tripCircuitBreaker(skillName);
        }
    }

    clearFailure(skillName) {
        this.failedSkillAttempts.set(skillName, 0);
    }

    async tripCircuitBreaker(skillName) {
        this.circuitBreakers.set(skillName, {
            state: 'open',
            failureCount: this.failedSkillAttempts.get(skillName),
            openedAt: Date.now(),
            resetTimeout: 60000
        });

        console.log(`[SelfOptimizer] Circuit breaker OPEN for ${skillName}`);
    }

    async checkCircuitBreaker(skillName) {
        const breaker = this.circuitBreakers.get(skillName);
        if (!breaker) return { allowed: true };

        if (breaker.state === 'open') {
            const timeSinceOpen = Date.now() - breaker.openedAt;
            
            if (timeSinceOpen >= breaker.resetTimeout) {
                breaker.state = 'half-open';
                console.log(`[SelfOptimizer] Circuit breaker HALF-OPEN for ${skillName}`);
                return { allowed: true, state: 'half-open' };
            }
            
            return { allowed: false, state: 'open', remainingTime: breaker.resetTimeout - timeSinceOpen };
        }

        return { allowed: true, state: 'closed' };
    }

    async resetCircuitBreaker(skillName) {
        this.circuitBreakers.delete(skillName);
        this.failedSkillAttempts.set(skillName, 0);
        console.log(`[SelfOptimizer] Circuit breaker RESET for ${skillName}`);
    }

    getSlowSkills(limit = 10) {
        return Array.from(this.skillProfiles.values())
            .filter(p => p.avgTime > this.slowSkillThreshold)
            .sort((a, b) => b.avgTime - a.avgTime)
            .slice(0, limit)
            .map(p => ({
                name: p.name,
                avgTime: Math.round(p.avgTime),
                executions: p.totalExecutions,
                successRate: ((p.successfulExecutions / p.totalExecutions) * 100).toFixed(2) + '%'
            }));
    }

    getFailingSkills(limit = 10) {
        return Array.from(this.skillProfiles.values())
            .filter(p => p.failedExecutions > 0)
            .map(p => ({
                name: p.name,
                failures: p.failedExecutions,
                total: p.totalExecutions,
                failureRate: ((p.failedExecutions / p.totalExecutions) * 100).toFixed(2) + '%'
            }))
            .sort((a, b) => b.failures - a.failures)
            .slice(0, limit);
    }

    getOptimizationRecommendations() {
        const recommendations = [];
        
        const slowSkills = this.getSlowSkills();
        for (const skill of slowSkills) {
            recommendations.push({
                type: 'performance',
                skill: skill.name,
                message: `Optimize ${skill.name}: avg ${skill.avgTime}ms execution time`,
                priority: skill.avgTime > 500 ? 'high' : 'medium'
            });
        }

        const failingSkills = this.getFailingSkills();
        for (const skill of failingSkills) {
            if (parseFloat(skill.failureRate) > 20) {
                recommendations.push({
                    type: 'reliability',
                    skill: skill.name,
                    message: `Fix ${skill.name}: ${skill.failureRate} failure rate`,
                    priority: 'high'
                });
            }
        }

        const breakers = Array.from(this.circuitBreakers.entries())
            .filter(([_, b]) => b.state === 'open');
        
        for (const [skillName, _] of breakers) {
            recommendations.push({
                type: 'circuit_breaker',
                skill: skillName,
                message: `Review ${skillName}: circuit breaker open`,
                priority: 'critical'
            });
        }

        return recommendations;
    }

    async autoRefactor(skillName) {
        const profile = this.skillProfiles.get(skillName);
        if (!profile) {
            return { success: false, error: 'Skill not found' };
        }

        const refactorPlan = {
            skillName,
            currentAvgTime: profile.avgTime,
            suggestedOptimizations: []
        };

        if (profile.avgTime > 500) {
            refactorPlan.suggestedOptimizations.push('Implement caching for repeated operations');
            refactorPlan.suggestedOptimizations.push('Reduce unnecessary computations');
        }

        if (profile.avgMemory > 1024 * 1024) {
            refactorPlan.suggestedOptimizations.push('Optimize memory usage with streaming/chunking');
        }

        console.log(`[SelfOptimizer] Refactor plan for ${skillName}:`, refactorPlan);
        
        return { success: true, plan: refactorPlan };
    }

    getSkillProfile(skillName) {
        return this.skillProfiles.get(skillName) || null;
    }

    getAllProfiles() {
        return Array.from(this.skillProfiles.values()).map(p => ({
            name: p.name,
            executions: p.totalExecutions,
            avgTime: Math.round(p.avgTime),
            successRate: p.totalExecutions > 0 
                ? ((p.successfulExecutions / p.totalExecutions) * 100).toFixed(2) + '%' 
                : 'N/A'
        }));
    }

    getOptimizerStats() {
        return {
            totalSkillsTracked: this.skillProfiles.size,
            currentMemoryUsage: (this.currentMemoryUsage / 1024 / 1024).toFixed(2) + 'MB',
            circuitBreakersOpen: Array.from(this.circuitBreakers.values()).filter(b => b.state === 'open').length,
            slowSkillsCount: this.getSlowSkills().length,
            failingSkillsCount: this.getFailingSkills().length,
            recommendationsCount: this.getOptimizationRecommendations().length
        };
    }
}

module.exports = { SelfOptimizer };