'use strict';

const { SoulPicker } = require('./soul_picker.js');

class SoulGenesis {
    constructor() {
        this.picker = new SoulPicker();
    }
    
    birth(selections = {}) {
        if (!selections.archetype || !selections.story || !selections.voice || !selections.focus) {
            return this.picker.quickBuild();
        }
        
        return this.picker.buildSoul(selections);
    }
    
    load(soulId) {
        try {
            const fs = require('fs');
            const path = require('path');
            const dataPath = path.join(__dirname, '..', '..', 'data', 'soul_identity.json');
            
            if (fs.existsSync(dataPath)) {
                return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            }
        } catch (e) {}
        
        return null;
    }
    
    save(soul) {
        const fs = require('fs');
        const path = require('path');
        const dataPath = path.join(__dirname, '..', '..', 'data');
        
        fs.mkdirSync(dataPath, { recursive: true });
        fs.writeFileSync(path.join(dataPath, 'soul_identity.json'), JSON.stringify(soul, null, 2));
    }
    
    getIdentity() {
        return this.load();
    }
}

module.exports = { SoulGenesis };