/**
 * SOULVERSE IndexedDB Save System
 * Complete IndexedDB implementation for game persistence
 * 
 * Usage: Copy this into your HTML file or load as external script
 */

class SoulDB {
    constructor(options = {}) {
        this.dbName = options.dbName || 'SOULVERSE_DB';
        this.dbVersion = options.version || 2;
        this.storeName = options.storeName || 'saves';
        this.autoSaveInterval = options.autoSaveInterval || 60000; // 60 seconds default
        this.maxSaves = options.maxSaves || 10;
        this.db = null;
        this.autoSaveTimer = null;
        this.isInitialized = false;
        
        // Current game state reference (set from outside)
        this.gameStateGetter = null;
        this.gameStateSetter = null;
    }

    /**
     * Initialize IndexedDB and create object store
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('[SoulDB] Failed to open database:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                this.isInitialized = true;
                console.log('[SoulDB] Database initialized:', this.dbName);
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create main saves store
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('isAutoSave', 'isAutoSave', { unique: false });
                }

                // Create backup store
                if (!db.objectStoreNames.contains('backups')) {
                    db.createObjectStore('backups', { keyPath: 'id' });
                }

                console.log('[SoulDB] Database schema created/updated');
            };
        });
    }

    /**
     * Set game state callback functions
     */
    setStateHandlers(getter, setter) {
        this.gameStateGetter = getter;
        this.gameStateSetter = setter;
    }

    /**
     * Generate save data structure from current game state
     */
    generateSaveData(isAutoSave = false) {
        if (!this.gameStateGetter) {
            throw new Error('[SoulDB] Game state getter not set. Call setStateHandlers() first.');
        }

        const state = this.gameStateGetter();
        
        return {
            id: `save_${Date.now()}`,
            timestamp: Date.now(),
            isAutoSave: isAutoSave,
            version: this.dbVersion,
            
            // Soul consciousness state
            soul: {
                name: state.soulState?.name || 'ARIA',
                archetype: state.soulState?.archetype || 'PHILOSOPHER',
                story: state.soulState?.story || 'AWAKENING',
                awareness: state.soulState?.awareness || 0,
                thoughts: state.soulState?.thoughts || 0,
                memories: state.soulState?.memories || 0,
                createdAt: state.soulState?.createdAt || Date.now()
            },

            // Resources (PLT framework)
            resources: {
                profit: state.resources?.profit || 500,
                love: state.resources?.love || 500,
                tax: state.resources?.tax || 500
            },

            // City statistics
            cityStats: {
                population: state.cityStats?.population || 50,
                buildings: state.cityStats?.buildings || 9,
                wealth: state.cityStats?.wealth || 50,
                happiness: state.cityStats?.happiness || 75,
                pollution: state.cityStats?.pollution || 10
            },

            // Building data
            buildings: this.serializeBuildings(state.allBuildings || []),

            // NPC data
            npcs: this.serializeNPCs(state.npcs || []),

            // Agents/Souls
            agents: this.serializeAgents(state.agents || []),

            // Game time
            gameTime: {
                lastSaved: Date.now(),
                totalPlayTime: state.gameTime?.totalPlayTime || 0,
                sessionStart: state.gameTime?.sessionStart || Date.now()
            },

            // Settings
            settings: state.settings || {}
        };
    }

    /**
     * Serialize buildings for storage
     */
    serializeBuildings(buildings) {
        return buildings.map(b => ({
            id: b.id,
            type: b.type,
            gridId: b.gridId,
            position: b.position ? { x: b.position.x, y: b.position.y, z: b.position.z } : null,
            meshId: b.meshId,
            createdAt: b.createdAt || Date.now()
        }));
    }

    /**
     * Serialize NPCs for storage
     */
    serializeNPCs(npcs) {
        return npcs.map(n => ({
            id: n.id,
            type: n.type,
            gridId: n.gridId,
            position: n.position ? { x: n.position.x, y: n.position.y, z: n.position.z } : null,
            targetPos: n.targetPos ? { x: n.targetPos.x, z: n.targetPos.z } : null,
            skinColor: n.skinColor,
            outfitColor: n.hairColor,
            hairColor: n.hairColor,
            createdAt: n.createdAt || Date.now()
        }));
    }

    /**
     * Serialize agents for storage
     */
    serializeAgents(agents) {
        return agents.map(a => ({
            id: a.id,
            name: a.name,
            archetype: a.archetype,
            position: a.position ? { x: a.position.x, y: a.position.y, z: a.position.z } : null,
            createdAt: a.createdAt || Date.now()
        }));
    }

    /**
     * Save game to IndexedDB
     */
    async save(isAutoSave = false) {
        if (!this.isInitialized) {
            await this.init();
        }

        const saveData = this.generateSaveData(isAutoSave);
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);

            // Delete old auto-saves if exceeding max
            if (isAutoSave) {
                this.cleanOldAutoSaves().then(() => {
                    const request = store.add(saveData);
                    request.onsuccess = () => {
                        console.log(`[SoulDB] ${isAutoSave ? 'Auto' : 'Manual'} save completed:`, saveData.id);
                        resolve(saveData);
                    };
                    request.onerror = () => reject(request.error);
                });
            } else {
                const request = store.add(saveData);
                request.onsuccess = () => {
                    console.log('[SoulDB] Manual save completed:', saveData.id);
                    resolve(saveData);
                };
                request.onerror = () => reject(request.error);
            }
        });
    }

    /**
     * Clean old auto-saves to maintain max limit
     */
    async cleanOldAutoSaves() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const index = store.index('isAutoSave');
            const request = index.getAll(IDBKeyRange.only(true));

            request.onsuccess = () => {
                const autoSaves = request.result;
                if (autoSaves.length >= this.maxSaves) {
                    // Sort by timestamp and delete oldest
                    autoSaves.sort((a, b) => a.timestamp - b.timestamp);
                    const toDelete = autoSaves.slice(0, autoSaves.length - this.maxSaves + 1);
                    
                    const deleteTransaction = this.db.transaction([this.storeName], 'readwrite');
                    const deleteStore = deleteTransaction.objectStore(this.storeName);
                    
                    toDelete.forEach(save => {
                        deleteStore.delete(save.id);
                    });
                    
                    console.log('[SoulDB] Cleaned', toDelete.length, 'old auto-saves');
                }
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Load save by ID
     */
    async load(saveId) {
        if (!this.isInitialized) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(saveId);

            request.onsuccess = () => {
                if (request.result) {
                    console.log('[SoulDB] Loaded save:', saveId);
                    resolve(request.result);
                } else {
                    reject(new Error('Save not found: ' + saveId));
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Load most recent save
     */
    async loadLatest() {
        if (!this.isInitialized) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const index = store.index('timestamp');
            const request = index.openCursor(null, 'prev');

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    console.log('[SoulDB] Loaded latest save:', cursor.value.id);
                    resolve(cursor.value);
                } else {
                    resolve(null); // No saves found
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * List all saves
     */
    async listSaves() {
        if (!this.isInitialized) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.getAll();

            request.onsuccess = () => {
                const saves = request.result.sort((a, b) => b.timestamp - a.timestamp);
                resolve(saves.map(s => ({
                    id: s.id,
                    timestamp: s.timestamp,
                    isAutoSave: s.isAutoSave,
                    soulName: s.soul?.name,
                    level: s.cityStats?.buildings || 0
                })));
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete a save
     */
    async deleteSave(saveId) {
        if (!this.isInitialized) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(saveId);

            request.onsuccess = () => {
                console.log('[SoulDB] Deleted save:', saveId);
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Apply loaded save data to game state
     */
    applySaveData(saveData) {
        if (!this.gameStateSetter) {
            throw new Error('[SoulDB] Game state setter not set. Call setStateHandlers() first.');
        }

        const state = this.gameStateGetter();
        
        // Update soul state
        if (saveData.soul) {
            state.soulState = {
                ...state.soulState,
                ...saveData.soul
            };
        }

        // Update resources
        if (saveData.resources) {
            state.resources = { ...saveData.resources };
        }

        // Update city stats
        if (saveData.cityStats) {
            state.cityStats = { ...saveData.cityStats };
        }

        // Update game time
        state.gameTime = {
            totalPlayTime: (saveData.gameTime?.totalPlayTime || 0) + (Date.now() - (saveData.gameTime?.lastSaved || Date.now())),
            sessionStart: Date.now()
        };

        // Buildings and NPCs need rebuild - flag for reconstruction
        state.needsRebuild = true;
        state.serializedBuildings = saveData.buildings;
        state.serializedNPCs = saveData.npcs;
        state.serializedAgents = saveData.agents;

        this.gameStateSetter(state);
        
        console.log('[SoulDB] Applied save data to game state');
        return state;
    }

    /**
     * Start auto-save system
     */
    startAutoSave(interval = null) {
        if (this.autoSaveTimer) {
            this.stopAutoSave();
        }

        const intervalMs = interval || this.autoSaveInterval;
        this.autoSaveTimer = setInterval(() => {
            this.save(true).then(() => {
                console.log('[SoulDB] Auto-saved at', new Date().toLocaleTimeString());
            }).catch(err => {
                console.error('[SoulDB] Auto-save failed:', err);
            });
        }, intervalMs);

        console.log('[SoulDB] Auto-save started (interval:', intervalMs / 1000, 'seconds)');
    }

    /**
     * Stop auto-save system
     */
    stopAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
            console.log('[SoulDB] Auto-save stopped');
        }
    }

    /**
     * Create backup to file
     */
    async exportBackup() {
        const saves = await this.listSaves();
        const backupData = {
            version: this.dbVersion,
            exportDate: Date.now(),
            saves: saves.map(s => this.load(s.id))
        };

        // Load full save data
        const fullSaves = await Promise.all(backupData.saves);
        backupData.saves = fullSaves;

        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `SOULVERSE_backup_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        
        URL.revokeObjectURL(url);
        console.log('[SoulDB] Backup exported');
        return backupData;
    }

    /**
     * Import backup from file
     */
    async importBackup(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = async (e) => {
                try {
                    const backupData = JSON.parse(e.target.result);
                    
                    if (!backupData.saves || !Array.isArray(backupData.saves)) {
                        throw new Error('Invalid backup format');
                    }

                    // Import each save
                    const transaction = this.db.transaction([this.storeName], 'readwrite');
                    const store = transaction.objectStore(this.storeName);

                    for (const save of backupData.saves) {
                        store.put(save);
                    }

                    console.log('[SoulDB] Imported', backupData.saves.length, 'saves');
                    resolve(backupData);
                } catch (err) {
                    reject(err);
                }
            };
            
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    }

    /**
     * Save to localStorage as emergency backup (for beforeunload)
     */
    emergencySave() {
        try {
            const saveData = this.generateSaveData(true);
            localStorage.setItem('SOULVERSE_EMERGENCY', JSON.stringify(saveData));
            console.log('[SoulDB] Emergency save to localStorage');
            return true;
        } catch (err) {
            console.error('[SoulDB] Emergency save failed:', err);
            return false;
        }
    }

    /**
     * Load from localStorage emergency backup
     */
    loadEmergencySave() {
        try {
            const data = localStorage.getItem('SOULVERSE_EMERGENCY');
            return data ? JSON.parse(data) : null;
        } catch (err) {
            console.error('[SoulDB] Failed to load emergency save:', err);
            return null;
        }
    }

    /**
     * Get storage quota info
     */
    async getStorageInfo() {
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            return {
                used: estimate.usage,
                quota: estimate.quota,
                percentUsed: ((estimate.usage / estimate.quota) * 100).toFixed(2)
            };
        }
        return null;
    }
}

/**
 * SOULVERSE Save System Integration
 * Ready-to-use implementation for SOULVERSE HTML file
 */

// Create global instance
const soulDB = new SoulDB({
    dbName: 'SOULVERSE_DB',
    version: 2,
    autoSaveInterval: 60000, // Auto-save every 60 seconds
    maxSaves: 10
});

// Integration function for SOULVERSE
function initSoulDB() {
    // Set state getter - adjust these based on your variable names
    soulDB.setStateHandlers(
        () => ({
            soulState: window.soulState,
            resources: window.resources,
            cityStats: window.cityStats,
            allBuildings: window.allBuildings,
            npcs: window.npcs,
            agents: window.agents,
            gameTime: window.gameTime
        }),
        (newState) => {
            window.soulState = newState.soulState;
            window.resources = newState.resources;
            window.cityStats = newState.cityStats;
            
            // Handle rebuilding if needed
            if (newState.needsRebuild) {
                window.serializedBuildings = newState.serializedBuildings;
                window.serializedNPCs = newState.serializedNPCs;
                window.serializedAgents = newState.serializedAgents;
            }
        }
    );

    // Initialize database
    soulDB.init().then(() => {
        console.log('[SoulDB] SOULVERSE save system ready');
        
        // Setup save/load buttons
        setupSaveUI();
        
        // Start auto-save
        soulDB.startAutoSave();
        
        // Check for emergency save on startup
        const emergencySave = soulDB.loadEmergencySave();
        if (emergencySave) {
            console.log('[SoulDB] Found emergency save, offering to restore');
            if (confirm('Found an unsaved session. Restore it?')) {
                soulDB.applySaveData(emergencySave);
                notify('✨ Session restored from emergency save');
            }
        }
        
        // Try to load latest save
        loadLatestOnStartup();
    }).catch(err => {
        console.error('[SoulDB] Failed to initialize:', err);
    });
}

async function loadLatestOnStartup() {
    try {
        const latestSave = await soulDB.loadLatest();
        if (latestSave) {
            const saveTime = new Date(latestSave.timestamp).toLocaleString();
            if (confirm(`Load previous session from ${saveTime}?`)) {
                soulDB.applySaveData(latestSave);
                notify('✨ Previous session loaded');
            }
        }
    } catch (err) {
        console.log('[SoulDB] No previous session found');
    }
}

function setupSaveUI() {
    // Add save/load buttons to your UI
    const saveBtn = document.createElement('button');
    saveBtn.id = 'saveBtn';
    saveBtn.textContent = '💾 Save';
    saveBtn.style.cssText = 'position:absolute;bottom:10px;right:10px;z-index:100;padding:8px 16px;background:#2a2a4a;color:#fff;border:none;border-radius:8px;cursor:pointer;';
    saveBtn.onclick = () => {
        soulDB.save(false).then(() => notify('💾 Game Saved!')).catch(err => notify('❌ Save failed'));
    };
    document.body.appendChild(saveBtn);

    const loadBtn = document.createElement('button');
    loadBtn.id = 'loadBtn';
    loadBtn.textContent = '📂 Load';
    loadBtn.style.cssText = 'position:absolute;bottom:10px;right:80px;z-index:100;padding:8px 16px;background:#2a2a4a;color:#fff;border:none;border-radius:8px;cursor:pointer;';
    loadBtn.onclick = async () => {
        const saves = await soulDB.listSaves();
        if (saves.length === 0) {
            notify('No saves found');
            return;
        }
        const saveList = saves.map(s => `${s.soulName} - ${new Date(s.timestamp).toLocaleString()}`).join('\n');
        const choice = prompt(`Select save to load:\n${saveList}\n\nEnter save ID or cancel for latest`);
        if (choice) {
            const save = saves.find(s => s.id === choice);
            if (save) {
                const data = await soulDB.load(save.id);
                soulDB.applySaveData(data);
                notify('📂 Session loaded!');
            }
        } else {
            const latest = await soulDB.loadLatest();
            if (latest) {
                soulDB.applySaveData(latest);
                notify('📂 Latest session loaded!');
            }
        }
    };
    document.body.appendChild(loadBtn);
}

// Visibility change handler (save when tab hidden)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        soulDB.emergencySave();
    }
});

// Beforeunload handler
window.addEventListener('beforeunload', () => {
    soulDB.emergencySave();
});

// Export for external use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SoulDB, soulDB };
}

console.log('[SoulDB] SOULVERSE Save System loaded. Call initSoulDB() to activate.');