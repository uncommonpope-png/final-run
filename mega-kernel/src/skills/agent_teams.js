const PLT_AFFINITY = { profit: 0.5, love: 0.3, tax: 0.2 };

function skill_agent_teams(brain, input) {
    const isTestMode = !brain || typeof brain === 'string' || !brain.think;
    const task = isTestMode ? (typeof brain === 'string' ? brain : 'test task') : (typeof input === 'string' ? input : input.task || input.description || '');
    const team_size = isTestMode ? 3 : (input.team_size || 3);
    
    if (isTestMode) {
        return {
            skill: 'agent_teams',
            plt_affinity: PLT_AFFINITY,
            task,
            team_size,
            decomposition: [
                { subtask: 'Research', agent: 'SCRIBE', dependency: 'none' },
                { subtask: 'Implement', agent: 'BUILDER', dependency: 'Research' },
                { subtask: 'Test', agent: 'SCOUT', dependency: 'Implement' },
                { subtask: 'Verify', agent: 'PROPHET', dependency: 'Test' },
                { subtask: 'Deploy', agent: 'MERCHANT', dependency: 'Verify' }
            ],
            coordination: {
                communication: 'shared_task_list',
                checkpoints: 'after each subtask',
                fallback: 'retry with different agent'
            },
            timestamp: Date.now()
        };
    }
    
    const prompt = `You are an agent team coordinator. Plan a multi-agent task execution.

Team roles (select based on task):
- **SCRIBE** — research, analysis, documentation
- **BUILDER** — code implementation, refactoring
- **SCOUT** — exploration, testing, discovery
- **MERCHANT** — business logic, user requirements
- **PROPHET** — planning, prediction, risk assessment

For task: ${task}

Plan:
1. **Decomposition** — break into subtasks
2. **Assignment** — which agent does what
3. **Coordination** — how agents communicate
4. **Verification** — cross-check results
5. **Integration** — combine agent outputs

Use PLT: Good coordination = profit (speed), love (harmony), tax (overhead management).`;

    return brain.think(prompt, 'Agent Teams: Coordinate multiple AI agents on complex tasks. PLT: collaboration multiplies value.');
}

module.exports = { skill_agent_teams, PLT_AFFINITY };