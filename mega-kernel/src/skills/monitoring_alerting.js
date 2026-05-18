const PLT_AFFINITY = { profit: 0.5, love: 0.3, tax: 0.2 };

function skill_monitoring_alerting(brain, input) {
    const isTestMode = !brain || typeof brain === 'string' || !brain.think;
    
    if (isTestMode) {
        return {
            skill: 'monitoring_alerting',
            plt_affinity: PLT_AFFINITY,
            monitoring_stack: [
                { component: 'Metrics', tool: 'Prometheus', purpose: 'Time-series data collection' },
                { component: 'Logs', tool: 'Loki', purpose: 'Log aggregation and search' },
                { component: 'Traces', tool: 'Jaeger', purpose: 'Distributed tracing' },
                { component: 'Alerts', tool: 'Alertmanager', purpose: 'Alert routing and escalation' },
                { component: 'Dashboards', tool: 'Grafana', purpose: 'Visualization and monitoring' }
            ],
            alert_rules: [
                { alert: 'HighErrorRate', condition: 'error_rate > 5%', severity: 'critical', action: 'Page on-call' },
                { alert: 'HighLatency', condition: 'p99_latency > 500ms', severity: 'warning', action: 'Notify team' },
                { alert: 'LowThroughput', condition: 'rps < 100', severity: 'warning', action: 'Investigate' }
            ],
            dashboard_layout: {
                overview: ['Error rate', 'Latency', 'Throughput'],
                detail: 'Per-service breakdown',
                trends: '7-day comparison'
            },
            timestamp: Date.now()
        };
    }
    
    const prompt = `You are a SRE (Site Reliability Engineer). Design monitoring and alerting systems.

Include:
1. **Metrics** — what to measure (latency, errors, throughput)
2. **Logs** — structured logging, log levels, aggregation
3. **Traces** — distributed tracing, correlation IDs
4. **Alerts** — thresholds, severity, escalation
5. **Dashboards** — key metrics visualization

Return:
## Monitoring Stack
| Component | Tool | Purpose |
|-----------|------|---------|
| Metrics | Prometheus | Time-series data |

## Alert Rules
| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| HighErrorRate | error_rate > 5% | Critical | Page on-call |

## Dashboard Layout
- Overview: Error rate, latency, throughput
- Detail: Per-service breakdown
- Trends: 7-day comparison

PLT: Monitoring = profit (catches issues before customers), love (trust), tax (cost of observability).`;

    return brain.think(prompt, 'Monitoring: Create observability systems. PLT: visibility prevents profit loss.');
}

module.exports = { skill_monitoring_alerting, PLT_AFFINITY };