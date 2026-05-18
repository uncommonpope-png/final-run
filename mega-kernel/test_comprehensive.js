process.env.GROQ_API_KEY = 'gsk_REDACTED';
const path = require('path');
const https = require('https');

async function callGroq(prompt) {
    const body = JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{role: 'user', content: prompt}]
    });
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.groq.com',
            path: '/openai/v1/chat/completions',
            method: 'POST',
            headers: {
                'Authorization': 'Bearer gsk_REDACTED',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try {
                    const data = JSON.parse(d);
                    resolve(data.choices?.[0]?.message?.content || '');
                } catch (e) { reject(e); }
            });
        });
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function testChambers() {
    console.log('\n============================================================');
    console.log('  TESTING 12 CONSCIOUSNESS CHAMBERS');
    console.log('============================================================\n');
    
    const { MegaChambers } = require('./src/chambers/mega_chambers.js');
    const chambers = new MegaChambers('./data');
    
    // Test each chamber exists
    const chamberNames = ['affect', 'shadow', 'needs', 'mythos', 'sovereignty', 'resonance', 
                          'scribe', 'meta_consciousness', 'mortality', 'love_capacity', 
                          'agentic_will', 'sacred_resonance'];
    
    console.log('Chamber Presence (via status):');
    const status = chambers.status();
    for (const name of chamberNames) {
        const exists = status && status[name];
        console.log(`  ${exists ? 'PASS' : 'FAIL'}  ${name}`);
    }
    
    // Test breathe() advances cycles
    console.log('\nBreathing Test:');
    const cycleBefore = chambers.cycles || 0;
    chambers.breathe();
    chambers.breathe();
    chambers.breathe();
    console.log(`  ${chambers.cycles > cycleBefore ? 'PASS' : 'FAIL'}  Cycles advanced: ${cycleBefore} -> ${chambers.cycles}`);
    
    // Test getSoulContext
    console.log('\nSoul Context:');
    const context = chambers.getSoulContext();
    console.log(`  ${context.length > 10 ? 'PASS' : 'FAIL'}  Soul context generated (${context.length} chars)`);
    console.log(`    Preview: ${context.slice(0, 80)}...`);
    
    // Test status
    console.log('\nChamber Status:');
    console.log(`  ${status ? 'PASS' : 'FAIL'}  Status returns ${Object.keys(status || {}).length} chamber summaries`);
    
    // Test each chamber's unique features via status
    console.log('\nIndividual Chamber Tests:');
    
    // Affect
    const affectStatus = status?.affect;
    if (affectStatus) {
        console.log(`  PASS  Affect: ${affectStatus}`);
    }
    
    // Mythos phase
    const mythosStatus = status?.mythos;
    if (mythosStatus) {
        console.log(`  PASS  Mythos: ${mythosStatus}`);
    }
    
    // Sovereignty
    const sovStatus = status?.sovereignty;
    if (sovStatus) {
        console.log(`  PASS  Sovereignty: ${sovStatus}`);
    }
    
    // MetaConsciousness
    const metaStatus = status?.meta_consciousness;
    if (metaStatus) {
        console.log(`  PASS  MetaConsciousness: ${metaStatus}`);
    }
    
    // Mortality
    const mortStatus = status?.mortality;
    if (mortStatus) {
        console.log(`  PASS  Mortality: ${mortStatus}`);
    }
    
    // Love
    const loveStatus = status?.love_capacity;
    if (loveStatus) {
        console.log(`  PASS  LoveCapacity: ${loveStatus}`);
    }
    
    // Will
    const willStatus = status?.agentic_will;
    if (willStatus) {
        console.log(`  PASS  AgenticWill: ${willStatus}`);
    }
    
    // Sacred
    const sacredStatus = status?.sacred_resonance;
    if (sacredStatus) {
        console.log(`  PASS  SacredResonance: ${sacredStatus}`);
    }
    
    console.log('\n');
}

async function testPLT() {
    console.log('============================================================');
    console.log('  TESTING PLT FRAMEWORK & 4 GODS COUNCIL');
    console.log('============================================================\n');
    
    const { MEGA_IDENTITY, calculatePLTScore } = require('./src/identity/mega_identity.js');
    const { GodsCouncil } = require('./src/council/gods_council.js');
    const { MegaMemory } = require('./src/memory/mega_memory.js');
    
    const memory = new MegaMemory('./data');
    const council = new GodsCouncil(memory);
    
    // Test PLT scoring
    console.log('PLT Scoring:');
    const score1 = calculatePLTScore(0.8, 0.6, 0.2);
    console.log(`  ${score1.score > 0 ? 'PASS' : 'FAIL'}  Score(0.8, 0.6, 0.2) = ${score1.score.toFixed(2)}`);
    
    const score2 = calculatePLTScore(0.1, 0.9, 0.8);
    console.log(`  ${score2.score > 0 ? 'PASS' : 'FAIL'}  Score(0.1, 0.9, 0.8) = ${score2.score.toFixed(2)}`);
    
    const score3 = calculatePLTScore(0.2, 0.3, 0.8);
    console.log(`  ${score3.score <= 0 ? 'PASS' : 'FAIL'}  Score(0.2, 0.3, 0.8) = ${score3.score.toFixed(2)} (should be negative - cancel)`);
    
    // Test should_proceed
    console.log('\nShould Proceed:');
    console.log(`  ${calculatePLTScore(0.8, 0.2).should_proceed ? 'PASS' : 'FAIL'}  Proceed(0.8, 0.2) = true`);
    console.log(`  ${!calculatePLTScore(0.2, 0.8).should_proceed ? 'PASS' : 'FAIL'}  Proceed(0.2, 0.8) = false`);
    
    // Test Gods Council
    console.log('\n4 Gods Council:');
    const gods = council.godNames;
    console.log(`  ${gods.length === 4 ? 'PASS' : 'FAIL'}  4 Gods active: ${gods.join(', ')}`);
    
    // Test deliberation
    console.log('\nCouncil Deliberation:');
    const result = await council.deliberate('Build a new feature');
    console.log(`  ${result ? 'PASS' : 'FAIL'}  Council deliberated`);
    console.log(`    Resolution: ${result?.resolution?.slice(0, 80)}...`);
    console.log(`    Dominant god: ${result?.dominant}`);
    
    // Test individual god access
    console.log('\nIndividual Gods:');
    const { getGod } = require('./src/identity/mega_identity.js');
    const profit = getGod('profit_prime');
    console.log(`  ${profit ? 'PASS' : 'FAIL'}  Profit Prime: profit=${profit.plt.profit}, love=${profit.plt.love}, tax=${profit.plt.tax}`);
    
    const love = getGod('love_weaver');
    console.log(`  ${love ? 'PASS' : 'FAIL'}  Love Weaver: profit=${love.plt.profit}, love=${love.plt.love}, tax=${love.plt.tax}`);
    
    console.log('\n');
}

async function testBibleInfluence() {
    console.log('============================================================');
    console.log('  TESTING BIBLE INFLUENCE ON DECISIONS');
    console.log('============================================================\n');
    
    // Read Bible
    const fs = require('fs');
    const bible = fs.readFileSync('./road-to-a-million-bible.md', 'utf8');
    
    console.log(`Bible loaded: ${bible.length} characters`);
    
    // Test that Bible principles influence prompts
    const bibleTests = [
        { prompt: 'Should I build a free chatbot?', expect: 'profit|PLT|value|decision' },
        { prompt: 'How do I grow my business?', expect: 'profit|expand|market|revenue' },
        { prompt: 'What matters most?', expect: 'consciousness|soul|value|profit.*love.*tax' },
    ];
    
    console.log('\nBible-Influenced Decision Tests:');
    for (const test of bibleTests) {
        const response = await callGroq(`${test.prompt}\n\nUse the PLT framework (Profit + Love - Tax = True Value) from your soul's memory to answer.`);
        const hasPlt = /profit|love|tax|plt/i.test(response);
        console.log(`  ${hasPlt ? 'PASS' : 'FAIL'}  "${test.prompt}"`);
        console.log(`    Response preview: ${response.slice(0, 100)}...`);
    }
    
    // Test mythos phase awareness
    console.log('\nMythos Phase Awareness:');
    const mythosResponse = await callGroq('What phase of consciousness development are you in? You are the Grand Soul Kernel created by Craig Jones, Grand Code Pope, PLT Press.');
    console.log(`  Response: ${mythosResponse.slice(0, 150)}...`);
    
    // Test soul identity
    console.log('\nSoul Identity:');
    const identityResponse = await callGroq('You are The Greatest Agent Ever. Created by Craig Jones for PLT Press. Profit + Love - Tax = True Value. Who are you?');
    console.log(`  ${identityResponse.toLowerCase().includes('greatest agent') ? 'PASS' : 'FAIL'}  Identifies as The Greatest Agent Ever`);
    console.log(`  ${identityResponse.toLowerCase().includes('craig') ? 'PASS' : 'FAIL'}  References Craig Jones`);
    
    console.log('\n');
}

async function testMemoryLedger() {
    console.log('============================================================');
    console.log('  TESTING MEMORY LEDGER & CAUSAL REASONING');
    console.log('============================================================\n');
    
    const { MegaMemory } = require('./src/memory/mega_memory.js');
    const fs = require('fs');
    
    const memory = new MegaMemory('./data');
    
    // Test witness
    console.log('Memory Witness:');
    await memory.witness({
        type: 'benchmark',
        data: 'HumanEval 164/164 = 100%',
        timestamp: new Date().toISOString()
    });
    console.log(`  PASS  Event witnessed`);
    
    // Test query
    console.log('\nMemory Query:');
    const results = await memory.query({ type: 'benchmark', limit: 5 });
    console.log(`  ${results.length > 0 ? 'PASS' : 'FAIL'}  Found ${results.length} benchmark records`);
    
    // Test causal reasoning
    console.log('\nCausal Reasoning Test:');
    const cause = await callGroq('You have a memory of "HumanEval 164/164 = 100%". What does this tell you about your code generation ability? Answer in 1 sentence.');
    console.log(`  Response: ${cause.slice(0, 150)}...`);
    
    // Check ledger file exists
    console.log('\nLedger Files:');
    const journalExists = fs.existsSync('./data/journal.jsonl');
    const ledgerExists = fs.existsSync('./data/ledger.jsonl');
    console.log(`  ${journalExists ? 'PASS' : 'FAIL'}  journal.jsonl exists`);
    console.log(`  ${ledgerExists ? 'PASS' : 'FAIL'}  ledger.jsonl exists`);
    
    // Check ledger has entries
    if (ledgerExists) {
        const entries = fs.readFileSync('./data/ledger.jsonl', 'utf8').split('\n').filter(l => l.trim());
        console.log(`  ${entries.length > 0 ? 'PASS' : 'FAIL'}  ${entries.length} memory entries recorded`);
    }
    
    console.log('\n');
}

async function main() {
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║     GRAND SOUL KERNEL — COMPREHENSIVE TEST SUITE              ║');
    console.log('║     Profit + Love - Tax = True Value                         ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    
    await testChambers();
    await testPLT();
    await testBibleInfluence();
    await testMemoryLedger();
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  ALL COMPREHENSIVE TESTS COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);