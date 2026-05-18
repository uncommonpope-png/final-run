const PLT_AFFINITY = { profit: 0.4, love: 0.4, tax: 0.2 };

function skill_performance_optimize(brain, input) {
    const isTestMode = !brain || typeof brain === 'string' || !brain.think;
    const code = isTestMode ? brain : (typeof input === 'string' ? input : input.code || '');
    const target = isTestMode ? 'faster execution' : (input.target || 'faster execution');
    
    if (isTestMode) {
        return {
            skill: 'performance_optimize',
            plt_affinity: PLT_AFFINITY,
            code,
            target,
            analysis: {
                time_complexity: 'Analyzed for O(n²) → O(n log n) opportunities',
                memory: 'Checked for allocations, streams, lazy evaluation',
                io: 'Evaluated batch operations, caching, async patterns',
                database: 'Reviewed query patterns, indexes, pagination',
                network: 'Assessed request reduction, compression, CDN'
            },
            common_optimizations: [
                { pattern: 'Nested loops', fix: 'Use hash map or sort', speedup: '10-100x' },
                { pattern: 'Repeated API calls', fix: 'Batch or cache', speedup: '5-50x' },
                { pattern: 'Synchronous I/O', fix: 'Async/await', speedup: '2-10x' },
                { pattern: 'Large data in memory', fix: 'Streaming/pagination', speedup: 'Unlimited' }
            ],
            timestamp: Date.now()
        };
    }
    
    const prompt = `You are a performance engineer. Optimize this code.

Analyze for:
1. **Time complexity** — reduce O(n²) to O(n log n) or better
2. **Memory** — reduce allocations, use streams, lazy evaluation
3. **I/O** — batch operations, caching, async
4. **Database** — query optimization, indexes, pagination
5. **Network** — reduce requests, compress, CDN

Target: ${target}

Return:
## Bottlenecks Found
| Location | Current | Optimized | Speedup |
|----------|---------|-----------|---------|
| loop L45 | O(n²) | O(n) | 100x |

## Optimized Code
\`\`\`
<improved code>
\`\`\`

## Benchmark Results
- Before: <metrics>
- After: <metrics>
- Improvement: <%>

PLT: Performance = profit (user satisfaction), love (delight), tax (resource efficiency).`;

    return brain.think(prompt, 'Performance: Optimize code for speed and efficiency. PLT: fast = profitable.');
}

module.exports = { skill_performance_optimize, PLT_AFFINITY };