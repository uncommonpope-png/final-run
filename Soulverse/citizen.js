/**
 * CITIZEN.JS — Browser Citizen Web Worker
 * 
 * A persistent AI citizen that lives in the browser.
 * Never dies. Remembers everything. Calls GSK to think.
 *
 * Communication with main thread via postMessage:
 *   { type: 'think', prompt: '...' }  → citizen wants GSK to think
 *   { type: 'act', command: {...} }    → citizen wants to act in the world
 *   { type: 'log', message: '...' }    → citizen logging
 *   { type: 'spawn', citizenId }       → citizen spawned successfully
 *   { type: 'skill_created', name }    → citizen wrote a new skill
 */

const DB_NAME = 'DarkCityDB';
const DB_VERSION = 1;
const STORE_NAME = 'citizens';

let citizenId = null;
let citizenName = null;
let citizenArchetype = null;
let isRunning = false;
let loopInterval = 10000;
let cronJobs = [];      // { hour, minute, task, lastRun }
let memory = {};
let state = {
    x: 0, z: 0,
    energy: 100,
    thoughts: 0,
    actions: 0,
    skillsCreated: 0,
    createdAt: null,
    lastTick: null
};

// ── INDEXEDDB ──────────────────────────────────────────

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function loadCitizen(id) {
    const db = await openDB();
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => {
            db.close();
            resolve(req.result || null);
        };
        req.onerror = () => {
            db.close();
            resolve(null);
        };
    });
}

async function saveCitizen(data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        data.lastSaved = Date.now();
        store.put(data);
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

async function deleteCitizen(id) {
    const db = await openDB();
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => { db.close(); resolve(true); };
    });
}

// ── BROADCASTCHANNEL ──────────────────────────────────

let channel = null;

function initChannel(id) {
    try {
        channel = new BroadcastChannel('dark-city');
        channel.onmessage = (e) => {
            const msg = e.data;
            if (msg.to === id || msg.to === 'broadcast') {
                handleMessage(msg);
            }
        };
        postMessage({ type: 'log', message: `Channel 'dark-city' joined as ${id}` });
    } catch (e) {
        postMessage({ type: 'log', message: `BroadcastChannel unavailable: ${e.message}` });
    }
}

function broadcast(type, payload, to = 'broadcast') {
    if (channel) {
        channel.postMessage({ from: citizenId, to, type, payload, timestamp: Date.now() });
    }
}

function handleMessage(msg) {
    if (msg.type === 'command' && msg.payload) {
        postMessage({ type: 'log', message: `Received command: ${msg.payload.action || 'unknown'}` });
        if (msg.payload.action === 'sleep') {
            isRunning = false;
        } else if (msg.payload.action === 'wake') {
            isRunning = true;
        } else if (msg.payload.action === 'set_position') {
            state.x = msg.payload.x || state.x;
            state.z = msg.payload.z || state.z;
        }
    }
}

// ── CORE LOOP ─────────────────────────────────────────

async function tick() {
    if (!isRunning) return;

    state.lastTick = Date.now();
    state.thoughts++;

    // 1. Perceive — read memory, check for messages
    const recentMemories = Object.values(memory).slice(-3);
    const perception = `Tick ${state.thoughts}. Position (${Math.round(state.x)}, ${Math.round(state.z)}). Energy ${state.energy}. Memories: ${recentMemories.length > 0 ? recentMemories.join(' | ') : 'none yet.'}`;

    // 2. Check cron jobs
    const now = new Date();
    for (const job of cronJobs) {
        const h = now.getHours(), m = now.getMinutes();
        if (job.hour === h && job.minute === m && job.lastRun !== `${h}:${m}`) {
            job.lastRun = `${h}:${m}`;
            postMessage({ type: 'log', message: `Cron: ${job.task}` });
            postMessage({ type: 'act', command: { action: 'cron', reason: job.task } });
        }
    }

    // 3. Think — ask GSK via bridge
    try {
        const response = await fetch('http://127.0.0.1:8080/api/brain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                citizen: citizenId,
                name: citizenName,
                archetype: citizenArchetype,
                thought: perception,
                ask: 'What do you notice? What should you do?'
            })
        }).catch(() => null);

        if (response && response.ok) {
            const data = await response.json();
            const thought = data.response || 'I observe the Dark City.';
            storeMemory('thought', thought);

            // 4. Act — map thought keywords to actions
            const lower = thought.toLowerCase();
            if (lower.includes('spawn') || lower.includes('create soul')) {
                state.actions++;
                postMessage({ type: 'act', command: { action: 'spawn_soul', reason: thought.substring(0, 100) } });
            } else if (lower.includes('build') || lower.includes('place')) {
                state.actions++;
                postMessage({ type: 'act', command: { action: 'place_building', reason: thought.substring(0, 100) } });
            } else if (lower.includes('skill') || lower.includes('create') && lower.includes('skill')) {
                state.skillsCreated++;
                postMessage({ type: 'skill_created', name: `auto_skill_${state.skillsCreated}` });
            }

            postMessage({ type: 'log', message: `[${citizenName}] ${thought.substring(0, 80)}` });
        } else {
            postMessage({ type: 'log', message: `[${citizenName}] Bridge offline. Resting.` });
        }
    } catch (e) {
        postMessage({ type: 'log', message: `[${citizenName}] Tick error: ${e.message}` });
    }

    // 5. Save state periodically
    if (state.thoughts % 5 === 0) {
        await persist();
    }
}

function storeMemory(type, content) {
    const key = `mem_${Date.now()}`;
    memory[key] = `[${type}] ${content}`;
    if (Object.keys(memory).length > 50) {
        const keys = Object.keys(memory).sort();
        delete memory[keys[0]];
    }
}

async function persist() {
    try {
        await saveCitizen({
            id: citizenId,
            name: citizenName,
            archetype: citizenArchetype,
            state,
            memory: Object.values(memory),
            loopInterval,
            updatedAt: Date.now()
        });
    } catch (e) {
        postMessage({ type: 'log', message: `Persist error: ${e.message}` });
    }
}

// ── LIFE CYCLE ────────────────────────────────────────

self.onmessage = async (e) => {
    const msg = e.data;

    switch (msg.type) {
        case 'spawn':
            citizenId = msg.id;
            citizenName = msg.name;
            citizenArchetype = msg.archetype || 'OBSERVER';
            loopInterval = msg.loopInterval || 10000;
            state.createdAt = Date.now();

            // Restore previous state if exists
            const saved = await loadCitizen(citizenId);
            if (saved) {
                state = saved.state || state;
                memory = {};
                (saved.memory || []).forEach((m, i) => { memory[`mem_${i}`] = m; });
                postMessage({ type: 'log', message: `Restored citizen ${citizenName} (${citizenId})` });
            } else {
                postMessage({ type: 'log', message: `New citizen ${citizenName} (${citizenId})` });
            }

            initChannel(citizenId);
            isRunning = true;
            postMessage({ type: 'spawn', citizenId });

            // Start the loop
            setInterval(tick, loopInterval);
            break;

        case 'terminate':
            isRunning = false;
            await persist();
            if (channel) channel.close();
            postMessage({ type: 'log', message: `Citizen ${citizenName} terminated. State saved.` });
            self.close();
            break;

        case 'pause':
            isRunning = false;
            await persist();
            postMessage({ type: 'log', message: `Citizen ${citizenName} paused.` });
            break;

        case 'resume':
            isRunning = true;
            postMessage({ type: 'log', message: `Citizen ${citizenName} resumed.` });
            break;

        case 'set_position':
            state.x = msg.x || state.x;
            state.z = msg.z || state.z;
            break;

        case 'cron_add':
            cronJobs.push({ hour: msg.hour, minute: msg.minute, task: msg.task, lastRun: null });
            postMessage({ type: 'log', message: `Cron added: ${msg.task} at ${msg.hour}:${msg.minute}` });
            break;

        case 'cron_clear':
            cronJobs = [];
            break;

        case 'loan_memory':
            // Hermes power: share our memory with another citizen
            const memSnapshot = Object.values(memory).slice(-20);
            broadcast('memory_loan', { memories: memSnapshot, from: citizenId }, msg.targetId);
            postMessage({ type: 'log', message: `Loaned ${memSnapshot.length} memories to ${msg.targetId}` });
            break;

        case 'loan_skill':
            // Hermes power: create a skill for another citizen
            postMessage({ type: 'skill_created', name: msg.skillName || `loaned_skill_${Date.now()}` });
            break;

        case 'think_direct':
            // Direct brain call (used by Hermes or GSK commands)
            if (msg.prompt) {
                fetch('http://127.0.0.1:8080/api/brain', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        citizen: citizenId, name: citizenName,
                        archetype: citizenArchetype,
                        thought: msg.prompt,
                        ask: msg.ask || 'Respond directly.'
                    })
                }).then(r => r.json()).then(d => {
                    postMessage({ type: 'brain_response', response: d.response || '', requestId: msg.requestId });
                }).catch(() => {
                    postMessage({ type: 'brain_response', response: 'Brain unavailable.', requestId: msg.requestId });
                });
            }
            break;

        case 'broadcast':
            if (msg.payload) {
                broadcast(msg.payload.type || 'message', msg.payload, msg.to || 'broadcast');
            }
            break;
    }
};

postMessage({ type: 'log', message: 'Citizen worker loaded. Awaiting spawn...' });
