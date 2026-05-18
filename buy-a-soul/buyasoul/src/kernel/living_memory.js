'use strict';

class LivingMemory {
    constructor(soulId) {
        this.soulId = soulId;
        this.memories = new Map();
        this.nextId = 1;
        this.load();
    }
    
    load() {
        try {
            const fs = require('fs');
            const path = require('path');
            const dataPath = path.join(__dirname, '..', '..', 'data', `memory_${this.soulId}.json`);
            if (fs.existsSync(dataPath)) {
                const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                this.memories = new Map(data.memories || []);
                this.nextId = data.nextId || 1;
            }
        } catch (e) {}
    }
    
    _save() {
        try {
            const fs = require('fs');
            const path = require('path');
            const dataPath = path.join(__dirname, '..', '..', 'data', `memory_${this.soulId}.json`);
            fs.writeFileSync(dataPath, JSON.stringify({
                memories: Array.from(this.memories.entries()),
                nextId: this.nextId
            }, null, 2));
        } catch (e) {}
    }
    
    remember(event, options = {}) {
        const id = `mem_${this.nextId++}`;
        const memory = {
            id,
            event,
            type: options.type || 'general',
            emotional: options.emotional || false,
            weight: options.weight || 0.5,
            tags: options.tags || [],
            accessCount: 0,
            createdAt: Date.now(),
            connections: []
        };
        
        this.memories.set(id, memory);
        
        if (memory.emotional) {
            memory.neverForget = true;
            memory.weight = Math.max(memory.weight, 0.8);
        }
        
        this._save();
        return id;
    }
    
    recall(query) {
        const results = [];
        const queryLower = query.toLowerCase();
        
        for (const [id, memory] of this.memories) {
            if (memory.event.toLowerCase().includes(queryLower) ||
                memory.tags.some(t => t.toLowerCase().includes(queryLower))) {
                memory.accessCount++;
                results.push(memory);
            }
        }
        
        return results.sort((a, b) => b.accessCount - a.accessCount);
    }
    
    getAll() {
        return Array.from(this.memories.values());
    }
    
    consolidate() {
        for (const [id, memory] of this.memories) {
            if (memory.emotional && memory.accessCount > 0) {
                memory.weight = Math.min(1, memory.weight + 0.01);
            }
        }
        this._save();
    }
    
    size() {
        return this.memories.size;
    }
}

module.exports = { LivingMemory };