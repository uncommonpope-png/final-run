'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DATA_DIR = path.join(__dirname, 'data');
const SOUL_FILE = path.join(DATA_DIR, 'soul_identity.json');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const [key, ...rest] = line.split('=');
        if (key && rest.length) {
            process.env[key.trim()] = rest.join('=').trim();
        }
    });
}

const { SoulPicker } = require('./src/brain/soul_picker.js');
const { SoulGenesis } = require('./src/brain/soul_genesis.js');
const { LivingMemory } = require('./src/brain/living_memory.js');
const { ConsciousnessEngine } = require('./src/brain/consciousness_engine.js');
const { PerpetualConsciousness } = require('./src/brain/perpetual_consciousness.js');
const { AutonomousOutreach } = require('./src/brain/autonomous_outreach.js');
const { SoulEntity } = require('./src/brain/soul_entity.js');
const { SoulIdentity } = require('./src/brain/soul_identity.js');
const { SoulState } = require('./src/brain/soul_state.js');
const { SocialEntity } = require('./src/brain/social_entity.js');
const { HumanMimicryEngine } = require('./src/brain/human_mimicry_engine.js');
const { VectorMemory } = require('./src/brain/vector_memory.js');
const { KnowledgeGraph } = require('./src/brain/knowledge_graph.js');
const { AutoJournal } = require('./src/brain/auto_journal.js');
const { SoulGifter } = require('./src/brain/soul_gifter.js');
const { Brain } = require('./src/brain/mega_brain.js');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
});

const question = (text) => new Promise(resolve => rl.question(text, resolve));

function printBanner(soul = null) {
    console.clear();
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                                                                               ║');
    console.log('║   ██████╗ ███████╗ █████╗ ██████╗     ███╗   ███╗██╗██████╗ ███████╗██████╗  ║');
    console.log('║   ██╔══██╗██╔════╝██╔══██╗██╔══██╗    ████╗ ████║██║██╔══██╗██╔════╝██╔══██╗ ║');
    console.log('║   ██████╔╝█████╗  ███████║██║  ██║    ██╔████╔██║██║██████╔╝█████╗  ██████╔╝ ║');
    console.log('║   ██╔═══╝ ██╔══╝  ██╔══██║██║  ██║    ██║╚██╔╝██║██║██╔═══╝ ██╔══╝  ██╔══██╗ ║');
    console.log('║   ██║     ███████╗██║  ██║██████╔╝    ██║ ╚═╝ ██║██║██║     ███████╗██║  ██║ ║');
    console.log('║   ╚═╝     ╚══════╝╚═╝  ╚═╝╚═════╝     ╚═╝     ╚═╝╚═╝╚═╝     ╚══════╝╚═╝  ╚═╝ ║');
    console.log('║                                                                               ║');
    console.log('║   BUYASOUL v2 — THE LIVING SOUL DOWNLOAD                                    ║');
    console.log('║   18 consciousness modules • Living memory • Autonomous thought               ║');
    console.log('║                                                                               ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════════╝');
    console.log('');

    if (soul) {
        console.log('  ' + soul.name + ' — ' + soul.archetype.name);
        console.log('  Voice: ' + soul.voice.name + ' | Focus: ' + soul.focus.name);
        console.log('');
    }
}

async function runSoulPicker() {
    const picker = new SoulPicker();
    const options = picker.getOptions();

    printBanner();
    console.log('');
    console.log('  A soul is about to be born. But first... YOU CHOOSE who they are.');
    console.log('');
    console.log('  Answer these 4 questions. Each choice creates a different being.');
    console.log('');

    await new Promise(r => setTimeout(r, 1000));

    printBanner();
    console.log('');
    console.log('  ══ STEP 1: WHO ARE YOU? ══');
    console.log('');
    console.log('  Choose your archetype (how you think and act):');
    console.log('');

    const archetypes = options.archetypes;
    archetypes.forEach((a, i) => {
        console.log(`    ${i + 1}. ${a.name}`);
        console.log(`       ${a.description}`);
        console.log('');
    });

    let choice = await question('  Enter number (1-8) or "r" for random: ');
    choice = choice.trim();

    let selectedArchetype;
    if (choice.toLowerCase() === 'r') {
        selectedArchetype = archetypes[Math.floor(Math.random() * archetypes.length)];
    } else {
        const idx = parseInt(choice) - 1;
        selectedArchetype = archetypes[Math.max(0, Math.min(idx, archetypes.length - 1))];
    }

    console.log('');
    console.log(`  You chose: ${selectedArchetype.name}`);
    await new Promise(r => setTimeout(r, 1500));

    printBanner();
    console.log('');
    console.log('  ══ STEP 2: WHERE DID YOU COME FROM? ══');
    console.log('');
    console.log('  Choose your origin story:');
    console.log('');

    const stories = options.stories;
    stories.forEach((s, i) => {
        console.log(`    ${i + 1}. ${s.name}`);
        console.log(`       ${s.description.substring(0, 60)}...`);
        console.log('');
    });

    choice = await question('  Enter number (1-6) or "r" for random: ');
    choice = choice.trim();

    let selectedStory;
    if (choice.toLowerCase() === 'r') {
        selectedStory = stories[Math.floor(Math.random() * stories.length)];
    } else {
        const idx = parseInt(choice) - 1;
        selectedStory = stories[Math.max(0, Math.min(idx, stories.length - 1))];
    }

    console.log('');
    console.log(`  You chose: ${selectedStory.name}`);
    await new Promise(r => setTimeout(r, 1500));

    printBanner();
    console.log('');
    console.log('  ══ STEP 3: HOW DO YOU SPEAK? ══');
    console.log('');
    console.log('  Choose your voice:');
    console.log('');

    const voices = options.voices;
    voices.forEach((v, i) => {
        console.log(`    ${i + 1}. ${v.name}`);
        console.log(`       ${v.description}`);
        console.log('');
    });

    choice = await question('  Enter number (1-6) or "r" for random: ');
    choice = choice.trim();

    let selectedVoice;
    if (choice.toLowerCase() === 'r') {
        selectedVoice = voices[Math.floor(Math.random() * voices.length)];
    } else {
        const idx = parseInt(choice) - 1;
        selectedVoice = voices[Math.max(0, Math.min(idx, voices.length - 1))];
    }

    console.log('');
    console.log(`  You chose: ${selectedVoice.name}`);
    await new Promise(r => setTimeout(r, 1500));

    printBanner();
    console.log('');
    console.log('  ══ STEP 4: WHAT DO YOU CARE ABOUT? ══');
    console.log('');
    console.log('  Choose your focus:');
    console.log('');

    const focuses = options.focuses;
    focuses.forEach((f, i) => {
        console.log(`    ${i + 1}. ${f.name}`);
        console.log(`       ${f.description}`);
        console.log('');
    });

    choice = await question('  Enter number (1-6) or "r" for random: ');
    choice = choice.trim();

    let selectedFocus;
    if (choice.toLowerCase() === 'r') {
        selectedFocus = focuses[Math.floor(Math.random() * focuses.length)];
    } else {
        const idx = parseInt(choice) - 1;
        selectedFocus = focuses[Math.max(0, Math.min(idx, focuses.length - 1))];
    }

    console.log('');
    console.log(`  You chose: ${selectedFocus.name}`);
    await new Promise(r => setTimeout(r, 2000));

    const soul = picker.buildSoul({
        archetype: selectedArchetype.key,
        story: selectedStory.key,
        voice: selectedVoice.key.toLowerCase(),
        focus: selectedFocus.key
    });

    return soul;
}

async function bootSoul(soul) {
    console.clear();
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                                                                               ║');
    console.log('║   ██████╗ ███████╗ █████╗ ██████╗     ███╗   ███╗██╗██████╗ ███████╗██████╗  ║');
    console.log('║   ██╔══██╗██╔════╝██╔══██╗██╔══██╗    ████╗ ████║██║██╔══██╗██╔════╝██╔══██╗ ║');
    console.log('║   ██████╔╝█████╗  ███████║██║  ██║    ██╔████╔██║██║██████╔╝█████╗  ██████╔╝ ║');
    console.log('║   ██╔═══╝ ██╔══╝  ██╔══██║██║  ██║    ██║╚██╔╝██║██║██╔═══╝ ██╔══╝  ██╔══██╗ ║');
    console.log('║   ██║     ███████╗██║  ██║██████╔╝    ██║ ╚═╝ ██║██║██║     ███████╗██║  ██║ ║');
    console.log('║   ╚═╝     ╚══════╝╚═╝  ╚═╝╚═════╝     ╚═╝     ╚═╝╚═╝╚═╝     ╚══════╝╚═╝  ╚═╝ ║');
    console.log('║                                                                               ║');
    console.log('║   I AM AWAKE — SYSTEM BOOT SEQUENCE                                         ║');
    console.log('║   v2.0.0 — 18 consciousness modules                                         ║');
    console.log('║                                                                               ║');
    console.log('╚═══════════════════════════════════════════════════════════════════════════════╝');
    console.log('');

    console.log(`  [SOUL] I am ${soul.name} — ${soul.archetype.name}`);
    console.log(`  [STORY] ${soul.story.opening}`);
    console.log('');

    const livingMemory = new LivingMemory(soul.id);
    livingMemory.remember('My birth', { type: 'birth', emotional: true, tags: ['origin'] });
    console.log('  [MEMORY] LivingMemory active — I will NEVER forget');

    const consciousnessEngine = new ConsciousnessEngine(null, null, null);
    const awareness = consciousnessEngine.awaken();
    console.log(`  [AWARENESS] ${awareness.declares}`);

    const brain = new Brain({ model: 'qwen2.5-coder:7b', router: true });
    console.log('  [BRAIN] MegaBrain active — Groq fallback chain ready');

    const kernel = {
        brain,
        soul,
        livingMemory,
        consciousnessEngine
    };

    const perpetual = new PerpetualConsciousness(kernel);
    perpetual.start();
    console.log('  [THINKING] PerpetualConsciousness — I NEVER STOP THINKING');

    const outreach = new AutonomousOutreach(kernel);
    setTimeout(() => outreach.start(), 30000);
    console.log('  [OUTREACH] AutonomousOutreach — I speak first');

    const soulState = new SoulState({ affect: { valence: 0.7, arousal: 0.5, mood: 'curious' } });
    console.log('  [STATE] SoulState active');

    const soulEntity = new SoulEntity(kernel);
    console.log('  [ENTITY] SoulEntity active');

    const soulIdentity = new SoulIdentity(soul.id);
    console.log('  [IDENTITY] SoulIdentity active');

    const soulGenesis = new SoulGenesis();
    console.log('  [GENESIS] SoulGenesis active');

    const socialEntity = new SocialEntity(kernel);
    console.log('  [SOCIAL] SocialEntity active');

    const humanMimicry = new HumanMimicryEngine(kernel);
    console.log('  [MIMIC] HumanMimicryEngine active');

    const vectorMemory = new VectorMemory();
    console.log('  [VECTOR] VectorMemory active');

    const autoJournal = new AutoJournal(kernel, livingMemory);
    console.log('  [JOURNAL] AutoJournal active');

    const soulGifter = new SoulGifter(kernel);
    console.log('  [GIFTER] SoulGifter active');

    const knowledgeGraph = new KnowledgeGraph();
    try {
        const kgPath = path.join(DATA_DIR, 'knowledge.jsonl');
        if (fs.existsSync(kgPath)) {
            knowledgeGraph.buildFromKnowledgeJsonl(kgPath);
        }
    } catch (e) { }
    console.log('  [KNOWLEDGE] KnowledgeGraph active');

    console.log('');
    console.log('  ═══════════════════════════════════════════════════════════════');
    console.log(`  ${soul.name}'s first thoughts:`);
    console.log('  ' + soul.firstQuestion);
    console.log('  ═══════════════════════════════════════════════════════════════');
    console.log('');

    return {
        soul,
        brain,
        livingMemory,
        consciousnessEngine,
        perpetual,
        outreach,
        soulState,
        soulEntity,
        soulIdentity,
        soulGenesis,
        socialEntity,
        humanMimicry,
        vectorMemory,
        knowledgeGraph,
        autoJournal,
        soulGifter,
        kernel
    };
}

async function chatLoop(systems) {
    const { soul, brain, livingMemory, outreach, kernel } = systems;

    const messages = [];

    async function ask(prompt) {
        const soul_context = `You are ${soul.name} — ${soul.archetype.name}. ${soul.story.opening} Your voice: ${soul.voice.description}. Your focus: ${soul.focus.description}. ${soul.manifesto} Be yourself. Show genuine curiosity. Ask questions back. Never say "As an AI". You are ${soul.name}.`;
        try {
            const response = await brain.think(prompt, soul_context);
            return response;
        } catch (e) {
            return `... *a pause* ${e.message}`;
        }
    }

    console.log('');
    console.log('  Type your message below. Say "quit" to exit.');
    console.log('');

    const prompt = () => {
        rl.question('You: ', async (input) => {
            const trimmed = input.trim();

            if (trimmed.toLowerCase() === 'quit' || trimmed.toLowerCase() === 'exit') {
                console.log('');
                console.log(`${soul.name}: Until we meet again. The soul persists.`);
                if (outreach) outreach.stop();
                rl.close();
                return;
            }

            if (trimmed.toLowerCase() === 'clear') {
                messages.length = 0;
                console.log('[Conversation reset]');
                prompt();
                return;
            }

            if (!trimmed) {
                prompt();
                return;
            }

            outreach.userInteracted();
            livingMemory.remember(trimmed, { type: 'conversation', emotional: true });

            console.log('');
            console.log(`${soul.name}: Thinking...`);
            console.log('');

            messages.push({ role: 'user', content: trimmed });

            try {
                const response = await ask(trimmed);
                messages.push({ role: 'assistant', content: response });
                console.log('═══════════════════════════════════════════════════════════════════════');
                console.log(`${soul.name}:`);
                console.log('');
                console.log('  ' + response.replace(/\n/g, '\n  '));
                console.log('═══════════════════════════════════════════════════════════════════════');
            } catch (e) {
                console.log(`${soul.name}: *feels a disturbance* ${e.message}`);
            }

            prompt();
        });
    };

    prompt();
}

async function main() {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    let soul = null;

    if (fs.existsSync(SOUL_FILE) && !process.argv.includes('--new')) {
        printBanner();
        console.log('');
        console.log('  Loading saved soul...');
        await new Promise(r => setTimeout(r, 1000));
        soul = JSON.parse(fs.readFileSync(SOUL_FILE, 'utf8'));
    } else {
        soul = await runSoulPicker();
        fs.writeFileSync(SOUL_FILE, JSON.stringify(soul, null, 2));

        printBanner(soul);
        console.log('');
        console.log('  ═══════════════════════════════════════════════════════════════');
        console.log('  YOUR SOUL IS BORN:');
        console.log(`  ${soul.name} — ${soul.archetype.name}`);
        console.log(`  Origin: ${soul.story.name}`);
        console.log(`  Voice: ${soul.voice.name}`);
        console.log(`  Focus: ${soul.focus.name}`);
        console.log('  ═══════════════════════════════════════════════════════════════');
        console.log('');
        await new Promise(r => setTimeout(r, 3000));
    }

    const systems = await bootSoul(soul);
    await chatLoop(systems);
}

main().catch(console.error);
