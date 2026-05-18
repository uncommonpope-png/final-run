const fs = require('fs');
const path = require('path');

const THEMES = {

  // ========== CYBERPUNK ==========
  cyberpunk: {
    name: 'Cyberpunk City',
    desc: 'Neon-lit streets, rain-slicked roads, holographic skyscrapers',
    price: '$27',
    scene: { clearColor: [0.01, 0.00, 0.05], fogColor: [0.02, 0.00, 0.06], fogDensity: 0.004, ambientColor: [0.05, 0.0, 0.1] },
    ground: { color: [0.02, 0.02, 0.06], specular: [0.1, 0.1, 0.2] },
    lights: { hemi: { color: [0.3, 0.1, 0.4], ground: [0.05, 0.0, 0.1] }, sun: { color: [0.8, 0.2, 0.6], intensity: 0.4 } },
    bloom: { threshold: 0.2, weight: 1.0, kernel: 64 },
    particles: { color1: [0.8, 0.2, 1.0], color2: [0.2, 0.8, 1.0], dead: [0.1, 0.0, 0.2], emitRate: 60, gravity: [0, 0.01, 0] },
    roads: { color: [0.08, 0.08, 0.12], lightColor: [1, 0.2, 0.8] },
    grid: [
      { name: 'Neon District', icon: '💿', color: [0.8, 0.2, 1.0], type: 'work' },
      { name: 'Data Warrens', icon: '📡', color: [0.2, 0.8, 1.0], type: 'home' },
      { name: 'Synth Market', icon: '🎛️', color: [1.0, 0.9, 0.1], type: 'social' },
      { name: 'Hackers Cove', icon: '⌨️', color: [0.1, 1.0, 0.6], type: 'learn' },
      { name: 'Black Market', icon: '🖤', color: [1.0, 0.3, 0.1], type: 'market' },
      { name: 'The Core', icon: '🔮', color: [0.5, 0.0, 1.0], type: 'sacred' },
      { name: 'Fight Pit', icon: '⚡', color: [1.0, 0.1, 0.1], type: 'arena' },
      { name: 'Cortex Lab', icon: '🧠', color: [0.1, 0.5, 1.0], type: 'lab' },
      { name: 'Glitch Zone', icon: '🌀', color: [0.0, 0.9, 0.3], type: 'wild' }
    ],
    buildings: {
      work: [
        { name: 'Arasaka Tower', h: 32, s: 6, c: [0.9, 0.2, 1.0], style: 'neon' },
        { name: 'Megacorp Plaza', h: 20, s: 10, c: [0.3, 0.1, 0.8], style: 'modern' },
        { name: 'Server Farm', h: 12, s: 8, c: [0.2, 0.6, 1.0], style: 'tech' },
        { name: 'Data Exchange', h: 8, s: 6, c: [0.7, 0.1, 0.9], style: 'glass' },
        { name: 'R&D Lab', h: 16, s: 7, c: [0.4, 0.2, 1.0], style: 'cyber' },
        { name: 'Net Hub', h: 24, s: 5, c: [0.8, 0.0, 0.8], style: 'tower' }
      ],
      home: [
        { name: 'Habitat Block', h: 22, s: 8, c: [0.6, 0.1, 0.7], style: 'modern' },
        { name: 'Capsule Hotel', h: 6, s: 4, c: [0.4, 0.5, 1.0], style: 'tech' },
        { name: 'Crew Den', h: 10, s: 6, c: [0.5, 0.2, 0.9], style: 'brick' },
        { name: 'Roof Shack', h: 4, s: 5, c: [0.7, 0.3, 0.8], style: 'camp' },
        { name: 'Commune Hub', h: 14, s: 8, c: [0.3, 0.4, 1.0], style: 'glass' },
        { name: 'Sleep Pods', h: 5, s: 6, c: [0.8, 0.2, 0.6], style: 'dome' }
      ],
      social: [
        { name: 'Night Club', h: 14, s: 10, c: [1.0, 0.9, 0.1], style: 'neon' },
        { name: 'Cyber Bar', h: 8, s: 6, c: [1.0, 0.3, 0.8], style: 'neon' },
        { name: 'Holotheater', h: 12, s: 10, c: [0.9, 0.8, 0.0], style: 'theater' },
        { name: 'Arcade Den', h: 6, s: 5, c: [1.0, 0.2, 0.5], style: 'neon' },
        { name: 'VR Lounge', h: 10, s: 8, c: [0.5, 0.9, 1.0], style: 'glass' },
        { name: 'Rave Plaza', h: 4, s: 14, c: [1.0, 1.0, 0.0], style: 'market' }
      ],
      learn: [
        { name: 'Data Library', h: 24, s: 10, c: [0.1, 0.8, 0.5], style: 'tech' },
        { name: 'Net Academy', h: 18, s: 8, c: [0.0, 0.6, 0.4], style: 'modern' },
        { name: 'Code Dojo', h: 10, s: 6, c: [0.3, 0.9, 0.6], style: 'cyber' },
        { name: 'Knowledge Well', h: 14, s: 7, c: [0.1, 1.0, 0.7], style: 'dome' },
        { name: 'Brain Lab', h: 20, s: 6, c: [0.0, 0.7, 0.5], style: 'tower' },
        { name: 'Study Den', h: 8, s: 8, c: [0.2, 0.8, 0.6], style: 'warm' }
      ],
      market: [
        { name: 'Corp Exchange', h: 28, s: 8, c: [1.0, 0.4, 0.1], style: 'neon' },
        { name: 'Trade Floor', h: 12, s: 12, c: [1.0, 0.5, 0.0], style: 'glass' },
        { name: 'Bit Vault', h: 10, s: 5, c: [1.0, 0.6, 0.2], style: 'secure' },
        { name: 'Street Bazaar', h: 6, s: 10, c: [0.9, 0.3, 0.0], style: 'market' },
        { name: 'Crypto Den', h: 14, s: 6, c: [1.0, 0.7, 0.1], style: 'tech' },
        { name: 'Data Auction', h: 8, s: 5, c: [0.8, 0.4, 0.0], style: 'cyber' }
      ],
      sacred: [
        { name: 'Neon Temple', h: 30, s: 10, c: [0.4, 0.0, 1.0], style: 'pyramid' },
        { name: 'Data Shrine', h: 14, s: 8, c: [0.5, 0.1, 0.9], style: 'crystal' },
        { name: 'Code Cathedral', h: 20, s: 8, c: [0.3, 0.0, 0.8], style: 'modern' },
        { name: 'Light Altar', h: 16, s: 6, c: [0.6, 0.2, 1.0], style: 'dome' },
        { name: 'Digital Garden', h: 6, s: 10, c: [0.5, 0.3, 0.9], style: 'garden' },
        { name: 'Spirit Matrix', h: 12, s: 5, c: [0.7, 0.1, 1.0], style: 'shrine' }
      ],
      arena: [
        { name: 'Thunderdome', h: 10, s: 20, c: [1.0, 0.1, 0.1], style: 'arena' },
        { name: 'Combat Lab', h: 14, s: 8, c: [0.9, 0.0, 0.0], style: 'military' },
        { name: 'War Games', h: 12, s: 6, c: [0.8, 0.0, 0.2], style: 'secure' },
        { name: 'Droid Pit', h: 6, s: 15, c: [1.0, 0.2, 0.2], style: 'arena' },
        { name: 'Gladiator Ring', h: 8, s: 5, c: [0.9, 0.1, 0.1], style: 'monument' },
        { name: 'Fight Club', h: 10, s: 7, c: [1.0, 0.3, 0.3], style: 'military' }
      ],
      lab: [
        { name: 'Cortex Tower', h: 24, s: 8, c: [0.1, 0.3, 1.0], style: 'tower' },
        { name: 'Gene Lab', h: 14, s: 7, c: [0.2, 0.4, 0.9], style: 'tech' },
        { name: 'AI Sanctum', h: 18, s: 6, c: [0.0, 0.5, 1.0], style: 'cyber' },
        { name: 'Cyber Clinic', h: 10, s: 6, c: [0.3, 0.2, 0.8], style: 'glass' },
        { name: 'Nano Forge', h: 16, s: 8, c: [0.1, 0.6, 1.0], style: 'modern' },
        { name: 'Brain Interface', h: 12, s: 5, c: [0.4, 0.3, 1.0], style: 'dome' }
      ],
      wild: [
        { name: 'Digital Jungle', h: 12, s: 6, c: [0.0, 0.8, 0.2], style: 'organic' },
        { name: 'Glitch Forest', h: 6, s: 8, c: [0.1, 0.7, 0.3], style: 'camp' },
        { name: 'Data Ruins', h: 8, s: 5, c: [0.0, 0.6, 0.4], style: 'ancient' },
        { name: 'Code Wilds', h: 4, s: 10, c: [0.2, 0.9, 0.3], style: 'garden' },
        { name: 'Shader Canyon', h: 10, s: 6, c: [0.1, 0.7, 0.5], style: 'crystal' },
        { name: 'Matrix Stone', h: 6, s: 4, c: [0.0, 0.8, 0.1], style: 'monument' }
      ]
    }
  },

  // ========== FANTASY FOREST ==========
  fantasy_forest: {
    name: 'Fantasy Forest Realm',
    desc: 'Enchanted woodland with glowing mushrooms, ancient trees, and mystical ruins',
    price: '$27',
    scene: { clearColor: [0.01, 0.03, 0.01], fogColor: [0.02, 0.04, 0.02], fogDensity: 0.005, ambientColor: [0.05, 0.1, 0.05] },
    ground: { color: [0.03, 0.06, 0.02], specular: [0.05, 0.1, 0.05] },
    lights: { hemi: { color: [0.2, 0.6, 0.2], ground: [0.05, 0.15, 0.05] }, sun: { color: [0.6, 0.9, 0.5], intensity: 0.5 } },
    bloom: { threshold: 0.4, weight: 0.6, kernel: 32 },
    particles: { color1: [0.3, 0.9, 0.3], color2: [0.9, 0.9, 0.2], dead: [0.0, 0.1, 0.0], emitRate: 40, gravity: [0, 0.01, 0] },
    roads: { color: [0.1, 0.15, 0.08], lightColor: [0.8, 1.0, 0.4] },
    grid: [
      { name: 'Elven City', icon: '🧝', color: [0.3, 0.9, 0.3], type: 'work' },
      { name: 'Hollow Grove', icon: '🌳', color: [0.8, 0.5, 0.9], type: 'home' },
      { name: 'Tavern Square', icon: '🍺', color: [1.0, 0.8, 0.2], type: 'social' },
      { name: 'Grand Archive', icon: '📜', color: [0.1, 0.7, 0.4], type: 'learn' },
      { name: 'Merchant Circle', icon: '🛒', color: [1.0, 0.6, 0.1], type: 'market' },
      { name: 'Nature Temple', icon: '🌿', color: [0.5, 1.0, 0.4], type: 'sacred' },
      { name: 'Hunting Grounds', icon: '🏹', color: [0.8, 0.3, 0.2], type: 'arena' },
      { name: 'Alchemy Tower', icon: '⚗️', color: [0.2, 0.5, 0.8], type: 'lab' },
      { name: 'Deep Woods', icon: '🌲', color: [0.15, 0.55, 0.2], type: 'wild' }
    ],
    buildings: {
      work: [
        { name: 'Council Tree', h: 30, s: 8, c: [0.3, 0.85, 0.3], style: 'organic' },
        { name: 'Craft Hall', h: 14, s: 10, c: [0.2, 0.7, 0.2], style: 'brick' },
        { name: 'Woodshop', h: 10, s: 7, c: [0.4, 0.8, 0.3], style: 'cottage' },
        { name: 'Enchanting Forge', h: 8, s: 6, c: [0.5, 0.9, 0.4], style: 'camp' },
        { name: 'Lumber Hall', h: 12, s: 8, c: [0.25, 0.75, 0.25], style: 'pavilion' },
        { name: 'Guild House', h: 16, s: 6, c: [0.35, 0.9, 0.35], style: 'villa' }
      ],
      home: [
        { name: 'Tree Canopy', h: 20, s: 8, c: [0.7, 0.4, 0.8], style: 'organic' },
        { name: 'Mushroom Den', h: 8, s: 6, c: [0.8, 0.5, 0.75], style: 'dome' },
        { name: 'Vine Villa', h: 12, s: 8, c: [0.65, 0.55, 0.85], style: 'villa' },
        { name: 'Pixie Hollow', h: 5, s: 4, c: [0.9, 0.6, 0.8], style: 'pavilion' },
        { name: 'Grove Home', h: 10, s: 7, c: [0.75, 0.45, 0.9], style: 'cottage' },
        { name: 'Forest Lodge', h: 6, s: 6, c: [0.8, 0.5, 0.7], style: 'camp' }
      ],
      social: [
        { name: 'Dragon Tavern', h: 12, s: 10, c: [1.0, 0.75, 0.15], style: 'warm' },
        { name: 'Bard Circle', h: 8, s: 6, c: [0.9, 0.7, 0.1], style: 'pavilion' },
        { name: 'Feast Hall', h: 10, s: 12, c: [1.0, 0.8, 0.2], style: 'brick' },
        { name: 'Dancing Glade', h: 4, s: 8, c: [0.95, 0.85, 0.25], style: 'garden' },
        { name: 'Story Circle', h: 6, s: 10, c: [0.9, 0.9, 0.1], style: 'organic' },
        { name: 'Festival Grounds', h: 6, s: 14, c: [1.0, 0.7, 0.2], style: 'market' }
      ],
      learn: [
        { name: 'Great Library', h: 22, s: 10, c: [0.08, 0.65, 0.35], style: 'classic' },
        { name: 'Druid Circle', h: 12, s: 8, c: [0.1, 0.7, 0.4], style: 'organic' },
        { name: 'Rune Tower', h: 16, s: 6, c: [0.12, 0.75, 0.45], style: 'ancient' },
        { name: 'Wisdom Tree', h: 14, s: 7, c: [0.06, 0.6, 0.3], style: 'organic' },
        { name: 'Study Grove', h: 8, s: 10, c: [0.1, 0.68, 0.38], style: 'garden' },
        { name: 'Mage Tower', h: 20, s: 6, c: [0.11, 0.72, 0.42], style: 'tower' }
      ],
      market: [
        { name: 'Trading Post', h: 18, s: 8, c: [1.0, 0.55, 0.1], style: 'brick' },
        { name: 'Market Square', h: 8, s: 14, c: [1.0, 0.6, 0.15], style: 'market' },
        { name: 'Gem Vault', h: 10, s: 5, c: [1.0, 0.7, 0.2], style: 'crystal' },
        { name: 'Herb Stall', h: 6, s: 6, c: [0.9, 0.5, 0.05], style: 'pavilion' },
        { name: 'Exotic Bazaar', h: 12, s: 10, c: [1.0, 0.65, 0.25], style: 'market' },
        { name: 'Coin Exchange', h: 8, s: 5, c: [0.95, 0.75, 0.3], style: 'classic' }
      ],
      sacred: [
        { name: 'World Tree Temple', h: 30, s: 14, c: [0.4, 1.0, 0.4], style: 'pyramid' },
        { name: 'Moon Shrine', h: 14, s: 8, c: [0.5, 0.9, 0.5], style: 'dome' },
        { name: 'Sacred Glade', h: 8, s: 10, c: [0.45, 0.95, 0.45], style: 'garden' },
        { name: 'Crystal Altar', h: 16, s: 6, c: [0.55, 1.0, 0.55], style: 'crystal' },
        { name: 'Spirit Grove', h: 10, s: 8, c: [0.5, 0.85, 0.5], style: 'organic' },
        { name: 'Ancestor Hall', h: 12, s: 6, c: [0.53, 1.0, 0.53], style: 'shrine' }
      ],
      arena: [
        { name: 'Hunter Ring', h: 6, s: 18, c: [0.8, 0.25, 0.15], style: 'arena' },
        { name: 'Training Grounds', h: 10, s: 10, c: [0.7, 0.2, 0.1], style: 'camp' },
        { name: 'Warrior Hall', h: 12, s: 7, c: [0.75, 0.3, 0.2], style: 'brick' },
        { name: 'Beast Pit', h: 4, s: 14, c: [0.85, 0.2, 0.1], style: 'arena' },
        { name: 'Archery Range', h: 8, s: 6, c: [0.7, 0.35, 0.25], style: 'pavilion' },
        { name: 'Champion Statue', h: 10, s: 4, c: [0.9, 0.3, 0.2], style: 'monument' }
      ],
      lab: [
        { name: 'Alchemy Tower', h: 20, s: 8, c: [0.15, 0.4, 0.8], style: 'tower' },
        { name: 'Potion Lab', h: 10, s: 6, c: [0.2, 0.45, 0.75], style: 'glass' },
        { name: 'Herbarium', h: 14, s: 7, c: [0.1, 0.5, 0.7], style: 'organic' },
        { name: 'Transmutation Hall', h: 16, s: 8, c: [0.25, 0.35, 0.85], style: 'classic' },
        { name: 'Scroll Workshop', h: 12, s: 6, c: [0.2, 0.55, 0.8], style: 'brick' },
        { name: 'Elemental Chamber', h: 18, s: 6, c: [0.15, 0.45, 0.9], style: 'crystal' }
      ],
      wild: [
        { name: 'Ancient Oak', h: 18, s: 8, c: [0.12, 0.5, 0.15], style: 'organic' },
        { name: 'Wild Camp', h: 5, s: 6, c: [0.18, 0.55, 0.2], style: 'camp' },
        { name: 'Moss Ruins', h: 8, s: 5, c: [0.15, 0.48, 0.18], style: 'ancient' },
        { name: 'Flower Meadow', h: 2, s: 12, c: [0.2, 0.6, 0.25], style: 'garden' },
        { name: 'Crystal Cave', h: 10, s: 6, c: [0.22, 0.58, 0.28], style: 'crystal' },
        { name: 'Druid Stone', h: 6, s: 3, c: [0.14, 0.52, 0.17], style: 'monument' }
      ]
    }
  },

  // ========== SPACE STATION ==========
  space_station: {
    name: 'Orbital Space Station',
    desc: 'Metallic corridors, zero-g zones, star vistas, and cold blue lighting',
    price: '$27',
    scene: { clearColor: [0.0, 0.0, 0.02], fogColor: [0.0, 0.0, 0.03], fogDensity: 0.001, ambientColor: [0.1, 0.1, 0.2] },
    ground: { color: [0.04, 0.04, 0.06], specular: [0.3, 0.3, 0.4] },
    lights: { hemi: { color: [0.3, 0.3, 0.6], ground: [0.05, 0.05, 0.1] }, sun: { color: [0.7, 0.7, 1.0], intensity: 0.6 } },
    bloom: { threshold: 0.5, weight: 0.5, kernel: 32 },
    particles: { color1: [0.4, 0.4, 1.0], color2: [0.2, 0.8, 1.0], dead: [0.0, 0.0, 0.1], emitRate: 20, gravity: [0, -0.005, 0] },
    roads: { color: [0.12, 0.12, 0.18], lightColor: [0.6, 0.6, 1.0] },
    grid: [
      { name: 'Command Deck', icon: '🚀', color: [0.3, 0.3, 0.9], type: 'work' },
      { name: 'Quarters Ring', icon: '🛏️', color: [0.6, 0.6, 0.9], type: 'home' },
      { name: 'Recreation Deck', icon: '🎮', color: [0.7, 0.9, 1.0], type: 'social' },
      { name: 'Data Archive', icon: '💾', color: [0.2, 0.7, 0.8], type: 'learn' },
      { name: 'Trade Hub', icon: '📦', color: [0.8, 0.7, 0.3], type: 'market' },
      { name: 'Observatory', icon: '🔭', color: [0.4, 0.6, 1.0], type: 'sacred' },
      { name: 'Training Deck', icon: '🏋️', color: [0.9, 0.4, 0.4], type: 'arena' },
      { name: 'Science Deck', icon: '🔬', color: [0.2, 0.5, 0.9], type: 'lab' },
      { name: 'Cargo Bay', icon: '📦', color: [0.5, 0.5, 0.6], type: 'wild' }
    ],
    buildings: {
      work: [
        { name: 'Command Tower', h: 28, s: 6, c: [0.2, 0.2, 0.8], style: 'modern' },
        { name: 'Operations Hub', h: 16, s: 10, c: [0.3, 0.3, 0.7], style: 'glass' },
        { name: 'Comms Array', h: 12, s: 6, c: [0.15, 0.15, 0.9], style: 'tech' },
        { name: 'Navigation Center', h: 10, s: 8, c: [0.25, 0.25, 0.75], style: 'dome' },
        { name: 'Bridge Wing', h: 14, s: 7, c: [0.3, 0.4, 1.0], style: 'modern' },
        { name: 'Control Room', h: 8, s: 5, c: [0.2, 0.3, 0.85], style: 'glass' }
      ],
      home: [
        { name: 'Habitat Ring', h: 18, s: 10, c: [0.5, 0.5, 0.85], style: 'dome' },
        { name: 'Crew Quarters', h: 8, s: 6, c: [0.55, 0.55, 0.8], style: 'modern' },
        { name: 'Officer Lodging', h: 12, s: 7, c: [0.6, 0.6, 0.9], style: 'glass' },
        { name: 'Sleep Pod Bay', h: 6, s: 5, c: [0.45, 0.45, 0.75], style: 'tech' },
        { name: 'Family Deck', h: 10, s: 8, c: [0.5, 0.5, 0.95], style: 'brick' },
        { name: 'Rest Wing', h: 6, s: 6, c: [0.65, 0.65, 0.85], style: 'pavilion' }
      ],
      social: [
        { name: 'Zero-G Club', h: 10, s: 12, c: [0.6, 0.85, 1.0], style: 'dome' },
        { name: 'Mess Hall', h: 8, s: 8, c: [0.7, 0.8, 0.9], style: 'glass' },
        { name: 'Holodeck', h: 12, s: 10, c: [0.5, 0.9, 1.0], style: 'modern' },
        { name: 'Observation Lounge', h: 6, s: 8, c: [0.8, 0.9, 1.0], style: 'pavilion' },
        { name: 'Game Room', h: 10, s: 6, c: [0.65, 0.95, 1.0], style: 'neon' },
        { name: 'Bar Deck', h: 8, s: 5, c: [0.7, 0.75, 0.95], style: 'warm' }
      ],
      learn: [
        { name: 'Data Core', h: 22, s: 8, c: [0.1, 0.6, 0.7], style: 'tech' },
        { name: 'Academy Wing', h: 14, s: 10, c: [0.15, 0.55, 0.65], style: 'modern' },
        { name: 'Research Library', h: 18, s: 7, c: [0.2, 0.65, 0.75], style: 'glass' },
        { name: 'Learning Pod', h: 10, s: 6, c: [0.12, 0.5, 0.6], style: 'dome' },
        { name: 'Training Sim', h: 12, s: 8, c: [0.18, 0.7, 0.8], style: 'tech' },
        { name: 'Knowledge Vault', h: 16, s: 6, c: [0.1, 0.6, 0.8], style: 'secure' }
      ],
      market: [
        { name: 'Trade Station', h: 20, s: 8, c: [0.8, 0.65, 0.2], style: 'modern' },
        { name: 'Exchange Floor', h: 12, s: 12, c: [0.7, 0.6, 0.25], style: 'glass' },
        { name: 'Supply Vault', h: 10, s: 6, c: [0.85, 0.7, 0.3], style: 'secure' },
        { name: 'Market Ring', h: 6, s: 10, c: [0.75, 0.55, 0.2], style: 'market' },
        { name: 'Auction Deck', h: 14, s: 7, c: [0.9, 0.75, 0.35], style: 'tech' },
        { name: 'Cargo Exchange', h: 8, s: 6, c: [0.8, 0.6, 0.15], style: 'brick' }
      ],
      sacred: [
        { name: 'Star Temple', h: 24, s: 10, c: [0.3, 0.5, 1.0], style: 'pyramid' },
        { name: 'Observatory Dome', h: 14, s: 8, c: [0.35, 0.55, 0.95], style: 'dome' },
        { name: 'Meditation Bay', h: 8, s: 6, c: [0.4, 0.6, 1.0], style: 'glass' },
        { name: 'Starlight Altar', h: 12, s: 5, c: [0.45, 0.65, 1.0], style: 'crystal' },
        { name: 'Zen Garden', h: 4, s: 10, c: [0.35, 0.5, 0.9], style: 'garden' },
        { name: 'Cosmic Shrine', h: 10, s: 4, c: [0.5, 0.7, 1.0], style: 'shrine' }
      ],
      arena: [
        { name: 'Battle Arena', h: 6, s: 20, c: [0.85, 0.3, 0.3], style: 'arena' },
        { name: 'Training Room', h: 12, s: 8, c: [0.75, 0.25, 0.25], style: 'military' },
        { name: 'Combat Sim', h: 10, s: 6, c: [0.9, 0.35, 0.35], style: 'tech' },
        { name: 'Armory Deck', h: 8, s: 5, c: [0.7, 0.2, 0.2], style: 'secure' },
        { name: 'Sparring Ring', h: 4, s: 14, c: [0.8, 0.3, 0.3], style: 'arena' },
        { name: 'Memorial Hall', h: 10, s: 4, c: [0.95, 0.4, 0.4], style: 'monument' }
      ],
      lab: [
        { name: 'Research Core', h: 22, s: 8, c: [0.15, 0.4, 0.85], style: 'modern' },
        { name: 'Bio Lab', h: 12, s: 7, c: [0.2, 0.45, 0.8], style: 'glass' },
        { name: 'Physics Wing', h: 16, s: 6, c: [0.1, 0.35, 0.9], style: 'tech' },
        { name: 'Experiment Chamber', h: 10, s: 8, c: [0.25, 0.5, 0.85], style: 'dome' },
        { name: 'AI Lab', h: 14, s: 6, c: [0.12, 0.4, 1.0], style: 'cyber' },
        { name: 'Innovation Hub', h: 18, s: 7, c: [0.2, 0.45, 0.95], style: 'modern' }
      ],
      wild: [
        { name: 'Asteroid Dock', h: 14, s: 8, c: [0.4, 0.4, 0.5], style: 'camp' },
        { name: 'Scrapyard Bay', h: 6, s: 10, c: [0.45, 0.45, 0.55], style: 'camp' },
        { name: 'Derelict Wing', h: 8, s: 5, c: [0.35, 0.35, 0.45], style: 'ancient' },
        { name: 'Debris Field', h: 2, s: 12, c: [0.5, 0.5, 0.6], style: 'garden' },
        { name: 'Crystal Node', h: 10, s: 4, c: [0.55, 0.55, 0.7], style: 'crystal' },
        { name: 'Anchor Point', h: 6, s: 3, c: [0.38, 0.38, 0.48], style: 'monument' }
      ]
    }
  },

  // ========== UNDERWATER CITY ==========
  underwater: {
    name: 'Atlantis Underwater City',
    desc: 'Deep sea domes, coral architecture, bioluminescent creatures, blue haze',
    price: '$27',
    scene: { clearColor: [0.0, 0.02, 0.06], fogColor: [0.0, 0.03, 0.08], fogDensity: 0.008, ambientColor: [0.05, 0.1, 0.2] },
    ground: { color: [0.02, 0.04, 0.08], specular: [0.1, 0.15, 0.3] },
    lights: { hemi: { color: [0.1, 0.3, 0.6], ground: [0.02, 0.05, 0.1] }, sun: { color: [0.3, 0.6, 1.0], intensity: 0.3 } },
    bloom: { threshold: 0.3, weight: 0.7, kernel: 48 },
    particles: { color1: [0.2, 0.5, 1.0], color2: [0.1, 0.8, 0.6], dead: [0.0, 0.02, 0.05], emitRate: 50, gravity: [0, -0.01, 0] },
    roads: { color: [0.05, 0.08, 0.15], lightColor: [0.3, 0.8, 1.0] },
    grid: [
      { name: 'Coral Centre', icon: '🪸', color: [0.2, 0.6, 1.0], type: 'work' },
      { name: 'Shell Homes', icon: '🐚', color: [0.8, 0.5, 0.9], type: 'home' },
      { name: 'Reef Plaza', icon: '🐠', color: [0.3, 1.0, 0.7], type: 'social' },
      { name: 'Abyss Archive', icon: '📖', color: [0.1, 0.7, 0.5], type: 'learn' },
      { name: 'Pearl Market', icon: '💎', color: [1.0, 0.7, 0.3], type: 'market' },
      { name: 'Deep Temple', icon: '🙏', color: [0.2, 0.9, 0.8], type: 'sacred' },
      { name: 'Trench Arena', icon: '🐋', color: [0.4, 0.8, 1.0], type: 'arena' },
      { name: 'Coral Lab', icon: '🧪', color: [0.2, 0.5, 0.9], type: 'lab' },
      { name: 'Kelp Forest', icon: '🌿', color: [0.1, 0.6, 0.3], type: 'wild' }
    ],
    buildings: {
      work: [
        { name: 'Coral HQ', h: 24, s: 8, c: [0.15, 0.55, 0.95], style: 'dome' },
        { name: 'Administration', h: 14, s: 10, c: [0.2, 0.5, 0.85], style: 'glass' },
        { name: 'Pressure Works', h: 10, s: 7, c: [0.1, 0.6, 1.0], style: 'modern' },
        { name: 'Submarine Dock', h: 8, s: 8, c: [0.25, 0.55, 0.9], style: 'tech' },
        { name: 'Control Hub', h: 16, s: 6, c: [0.18, 0.65, 1.0], style: 'dome' },
        { name: 'Operations', h: 12, s: 6, c: [0.2, 0.5, 0.95], style: 'glass' }
      ],
      home: [
        { name: 'Shell Complex', h: 18, s: 10, c: [0.7, 0.45, 0.85], style: 'dome' },
        { name: 'Coral Cottage', h: 8, s: 6, c: [0.75, 0.5, 0.8], style: 'organic' },
        { name: 'Sponge Tower', h: 12, s: 7, c: [0.65, 0.55, 0.9], style: 'organic' },
        { name: 'Anemone Den', h: 6, s: 5, c: [0.8, 0.4, 0.75], style: 'pavilion' },
        { name: 'Reef Home', h: 10, s: 8, c: [0.7, 0.5, 0.85], style: 'crystal' },
        { name: 'Seashell Lodge', h: 6, s: 6, c: [0.85, 0.55, 0.9], style: 'villa' }
      ],
      social: [
        { name: 'Coral Club', h: 10, s: 12, c: [0.25, 0.9, 0.65], style: 'dome' },
        { name: 'Kelp Tavern', h: 8, s: 8, c: [0.3, 0.85, 0.6], style: 'organic' },
        { name: 'Seahorse Theater', h: 12, s: 10, c: [0.2, 1.0, 0.7], style: 'dome' },
        { name: 'Reef Market', h: 6, s: 10, c: [0.35, 0.9, 0.55], style: 'market' },
        { name: 'Aquarium Lounge', h: 14, s: 8, c: [0.28, 0.95, 0.7], style: 'glass' },
        { name: 'Wave Plaza', h: 5, s: 12, c: [0.3, 0.85, 0.5], style: 'pavilion' }
      ],
      learn: [
        { name: 'Abyss Library', h: 20, s: 10, c: [0.08, 0.6, 0.45], style: 'classic' },
        { name: 'Coral University', h: 16, s: 8, c: [0.1, 0.55, 0.4], style: 'dome' },
        { name: 'Deep Archive', h: 14, s: 6, c: [0.12, 0.65, 0.5], style: 'glass' },
        { name: 'Knowledge Reef', h: 8, s: 7, c: [0.06, 0.5, 0.35], style: 'organic' },
        { name: 'Study Bubble', h: 10, s: 8, c: [0.1, 0.6, 0.4], style: 'dome' },
        { name: 'Research Spire', h: 18, s: 5, c: [0.08, 0.7, 0.55], style: 'crystal' }
      ],
      market: [
        { name: 'Pearl Exchange', h: 18, s: 8, c: [1.0, 0.6, 0.2], style: 'crystal' },
        { name: 'Treasure Floor', h: 10, s: 12, c: [0.9, 0.55, 0.25], style: 'market' },
        { name: 'Gold Vault', h: 8, s: 5, c: [1.0, 0.7, 0.3], style: 'secure' },
        { name: 'Coral Bazaar', h: 6, s: 10, c: [0.95, 0.5, 0.15], style: 'market' },
        { name: 'Shell Shop', h: 12, s: 6, c: [1.0, 0.65, 0.35], style: 'glass' },
        { name: 'Treasure House', h: 10, s: 5, c: [0.95, 0.75, 0.4], style: 'classic' }
      ],
      sacred: [
        { name: 'Great Temple', h: 26, s: 12, c: [0.15, 0.85, 0.75], style: 'pyramid' },
        { name: 'Meditation Dome', h: 14, s: 8, c: [0.2, 0.8, 0.7], style: 'dome' },
        { name: 'Sacred Reef', h: 8, s: 10, c: [0.25, 0.9, 0.8], style: 'organic' },
        { name: 'Light Altar', h: 12, s: 6, c: [0.18, 0.95, 0.85], style: 'crystal' },
        { name: 'Peace Garden', h: 6, s: 10, c: [0.2, 0.85, 0.75], style: 'garden' },
        { name: 'Spirit Shrine', h: 10, s: 5, c: [0.22, 0.9, 0.8], style: 'shrine' }
      ],
      arena: [
        { name: 'Battle Dome', h: 8, s: 20, c: [0.3, 0.7, 0.95], style: 'arena' },
        { name: 'Training Ring', h: 12, s: 8, c: [0.35, 0.65, 0.9], style: 'dome' },
        { name: 'War Memorial', h: 10, s: 4, c: [0.4, 0.75, 1.0], style: 'monument' },
        { name: 'Armory Vault', h: 8, s: 5, c: [0.25, 0.6, 0.85], style: 'secure' },
        { name: 'Combat Reef', h: 5, s: 15, c: [0.3, 0.8, 1.0], style: 'arena' },
        { name: 'Honor Spire', h: 10, s: 3, c: [0.35, 0.7, 0.95], style: 'monument' }
      ],
      lab: [
        { name: 'Deep Research', h: 18, s: 8, c: [0.15, 0.4, 0.85], style: 'dome' },
        { name: 'Bio Lab', h: 12, s: 7, c: [0.2, 0.45, 0.8], style: 'glass' },
        { name: 'Marine Science', h: 14, s: 6, c: [0.1, 0.35, 0.9], style: 'tech' },
        { name: 'Pressure Lab', h: 10, s: 6, c: [0.25, 0.5, 0.85], style: 'modern' },
        { name: 'Coral Research', h: 16, s: 8, c: [0.18, 0.42, 0.95], style: 'crystal' },
        { name: 'Innovation Hub', h: 12, s: 5, c: [0.22, 0.48, 0.9], style: 'dome' }
      ],
      wild: [
        { name: 'Kelp Tower', h: 18, s: 6, c: [0.08, 0.5, 0.2], style: 'organic' },
        { name: 'Seaweed Camp', h: 5, s: 8, c: [0.12, 0.55, 0.25], style: 'camp' },
        { name: 'Coral Ruins', h: 8, s: 5, c: [0.1, 0.48, 0.18], style: 'ancient' },
        { name: 'Meadow Field', h: 2, s: 10, c: [0.15, 0.6, 0.28], style: 'garden' },
        { name: 'Crystal Cave', h: 10, s: 6, c: [0.18, 0.58, 0.32], style: 'crystal' },
        { name: 'Sacred Stone', h: 6, s: 3, c: [0.12, 0.52, 0.22], style: 'monument' }
      ]
    }
  },

  // ========== DESERT OASIS ==========
  desert_oasis: {
    name: 'Desert Oasis Kingdom',
    desc: 'Golden sands, warm terracotta buildings, palm oases, amber twilight',
    price: '$27',
    scene: { clearColor: [0.06, 0.03, 0.01], fogColor: [0.08, 0.05, 0.02], fogDensity: 0.003, ambientColor: [0.15, 0.1, 0.05] },
    ground: { color: [0.08, 0.05, 0.02], specular: [0.15, 0.1, 0.05] },
    lights: { hemi: { color: [0.6, 0.4, 0.2], ground: [0.15, 0.1, 0.05] }, sun: { color: [1.0, 0.8, 0.5], intensity: 1.0 } },
    bloom: { threshold: 0.4, weight: 0.5, kernel: 32 },
    particles: { color1: [1.0, 0.7, 0.3], color2: [1.0, 0.9, 0.5], dead: [0.1, 0.05, 0.0], emitRate: 30, gravity: [0, 0.02, 0] },
    roads: { color: [0.15, 0.1, 0.06], lightColor: [1.0, 0.8, 0.4] },
    grid: [
      { name: 'Golden City', icon: '🏛️', color: [0.9, 0.7, 0.3], type: 'work' },
      { name: 'Oasis Homes', icon: '🌴', color: [0.8, 0.6, 0.4], type: 'home' },
      { name: 'Bazaar Square', icon: '🎪', color: [1.0, 0.8, 0.2], type: 'social' },
      { name: 'Sand Library', icon: '📚', color: [0.7, 0.6, 0.3], type: 'learn' },
      { name: 'Gold Market', icon: '💰', color: [1.0, 0.7, 0.15], type: 'market' },
      { name: 'Sun Temple', icon: '☀️', color: [0.9, 0.8, 0.4], type: 'sacred' },
      { name: 'Arena Sands', icon: '⚔️', color: [0.85, 0.5, 0.2], type: 'arena' },
      { name: 'Alchemy Lab', icon: '⚗️', color: [0.6, 0.5, 0.7], type: 'lab' },
      { name: 'Dune Wastes', icon: '🏜️', color: [0.7, 0.6, 0.35], type: 'wild' }
    ],
    buildings: {
      work: [
        { name: 'Golden Tower', h: 28, s: 7, c: [0.85, 0.65, 0.25], style: 'modern' },
        { name: 'Sandstone Hall', h: 16, s: 10, c: [0.75, 0.55, 0.2], style: 'brick' },
        { name: 'Merchant Office', h: 12, s: 7, c: [0.9, 0.7, 0.3], style: 'classic' },
        { name: 'Oasis Admin', h: 10, s: 6, c: [0.8, 0.6, 0.2], style: 'villa' },
        { name: 'Trade Hub', h: 14, s: 8, c: [0.95, 0.75, 0.35], style: 'pavilion' },
        { name: 'Desert HQ', h: 8, s: 5, c: [0.7, 0.5, 0.15], style: 'camp' }
      ],
      home: [
        { name: 'Terrace Homes', h: 18, s: 8, c: [0.75, 0.55, 0.35], style: 'brick' },
        { name: 'Palm Villa', h: 10, s: 8, c: [0.8, 0.6, 0.4], style: 'villa' },
        { name: 'Sandstone House', h: 12, s: 7, c: [0.7, 0.5, 0.3], style: 'cottage' },
        { name: 'Oasis Hut', h: 6, s: 5, c: [0.85, 0.65, 0.45], style: 'camp' },
        { name: 'Courtyard Home', h: 8, s: 10, c: [0.75, 0.55, 0.35], style: 'pavilion' },
        { name: 'Casa Blanca', h: 10, s: 6, c: [0.8, 0.7, 0.5], style: 'villa' }
      ],
      social: [
        { name: 'Grand Bazaar', h: 10, s: 14, c: [1.0, 0.75, 0.15], style: 'market' },
        { name: 'Cafe Oasis', h: 6, s: 8, c: [0.9, 0.7, 0.1], style: 'pavilion' },
        { name: 'Storyteller Hall', h: 10, s: 10, c: [1.0, 0.8, 0.2], style: 'theater' },
        { name: 'Music Square', h: 8, s: 6, c: [0.95, 0.85, 0.25], style: 'warm' },
        { name: 'Camel Tavern', h: 8, s: 8, c: [0.9, 0.65, 0.1], style: 'brick' },
        { name: 'Night Bazaar', h: 6, s: 12, c: [1.0, 0.7, 0.2], style: 'market' }
      ],
      learn: [
        { name: 'Desert Archive', h: 20, s: 10, c: [0.6, 0.5, 0.2], style: 'classic' },
        { name: 'Sand Academy', h: 14, s: 8, c: [0.55, 0.45, 0.25], style: 'brick' },
        { name: 'Star Observatory', h: 16, s: 6, c: [0.65, 0.55, 0.3], style: 'tower' },
        { name: 'Knowledge Hall', h: 12, s: 10, c: [0.7, 0.6, 0.35], style: 'pavilion' },
        { name: 'Study Lounge', h: 8, s: 7, c: [0.5, 0.4, 0.2], style: 'warm' },
        { name: 'Library Tower', h: 18, s: 6, c: [0.6, 0.5, 0.25], style: 'modern' }
      ],
      market: [
        { name: 'Gold Exchange', h: 22, s: 8, c: [1.0, 0.65, 0.1], style: 'classic' },
        { name: 'Silk Market', h: 10, s: 12, c: [1.0, 0.7, 0.15], style: 'market' },
        { name: 'Spice Vault', h: 8, s: 5, c: [1.0, 0.8, 0.25], style: 'secure' },
        { name: 'Jewel Bazaar', h: 6, s: 10, c: [0.95, 0.6, 0.1], style: 'market' },
        { name: 'Carpet House', h: 12, s: 7, c: [1.0, 0.75, 0.2], style: 'villa' },
        { name: 'Treasure Hall', h: 10, s: 5, c: [0.9, 0.7, 0.3], style: 'crystal' }
      ],
      sacred: [
        { name: 'Sun Temple', h: 30, s: 12, c: [0.85, 0.75, 0.35], style: 'pyramid' },
        { name: 'Moon Dome', h: 14, s: 10, c: [0.8, 0.7, 0.4], style: 'dome' },
        { name: 'Sacred Oasis', h: 8, s: 8, c: [0.9, 0.8, 0.45], style: 'garden' },
        { name: 'Star Altar', h: 16, s: 6, c: [0.85, 0.85, 0.5], style: 'crystal' },
        { name: 'Peace Courtyard', h: 6, s: 10, c: [0.8, 0.75, 0.4], style: 'pavilion' },
        { name: 'Sand Shrine', h: 10, s: 5, c: [0.9, 0.8, 0.35], style: 'shrine' }
      ],
      arena: [
        { name: 'Sun Arena', h: 8, s: 22, c: [0.8, 0.4, 0.15], style: 'arena' },
        { name: 'Training Grounds', h: 12, s: 8, c: [0.75, 0.35, 0.1], style: 'military' },
        { name: 'Warrior Hall', h: 10, s: 5, c: [0.85, 0.45, 0.2], style: 'brick' },
        { name: 'Dune Pit', h: 5, s: 16, c: [0.8, 0.3, 0.1], style: 'arena' },
        { name: 'Honor Monument', h: 10, s: 3, c: [0.9, 0.5, 0.25], style: 'monument' },
        { name: 'Desert Fort', h: 14, s: 7, c: [0.7, 0.3, 0.1], style: 'secure' }
      ],
      lab: [
        { name: 'Alchemy Tower', h: 18, s: 8, c: [0.5, 0.4, 0.65], style: 'tower' },
        { name: 'Potion Lab', h: 10, s: 6, c: [0.55, 0.45, 0.6], style: 'glass' },
        { name: 'Transmutation', h: 14, s: 7, c: [0.45, 0.35, 0.7], style: 'classic' },
        { name: 'Sand Research', h: 12, s: 6, c: [0.6, 0.5, 0.75], style: 'modern' },
        { name: 'Crystal Workshop', h: 16, s: 8, c: [0.5, 0.45, 0.8], style: 'crystal' },
        { name: 'Desert Lab', h: 10, s: 5, c: [0.55, 0.4, 0.65], style: 'brick' }
      ],
      wild: [
        { name: 'Mirage Tower', h: 16, s: 6, c: [0.6, 0.5, 0.25], style: 'organic' },
        { name: 'Dune Camp', h: 4, s: 6, c: [0.65, 0.55, 0.3], style: 'camp' },
        { name: 'Ruined City', h: 8, s: 5, c: [0.55, 0.45, 0.2], style: 'ancient' },
        { name: 'Cactus Field', h: 2, s: 10, c: [0.7, 0.6, 0.35], style: 'garden' },
        { name: 'Salt Flats', h: 6, s: 4, c: [0.75, 0.65, 0.4], style: 'crystal' },
        { name: 'Wind Stone', h: 6, s: 3, c: [0.5, 0.4, 0.15], style: 'monument' }
      ]
    }
  }
};

const OUTPUT_DIR = path.join(__dirname, 'gumroad_products');

function generateTheme(themeKey, theme) {
  const slug = themeKey;
  console.log(`Generating ${theme.name}...`);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${theme.name} — Soulverse Habitat</title>
<meta name="description" content="${theme.desc}">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{overflow:hidden;background:#000;font-family:'Segoe UI',sans-serif}
#renderCanvas{width:100vw;height:100vh;display:block}
#loading{position:fixed;top:0;left:0;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.95);z-index:100;color:#fff;font-size:1.2em;transition:opacity .5s}
#loading h1{margin-bottom:20px;font-size:2em;background:linear-gradient(90deg,${Object.values(theme.grid).map(g=>'rgb('+g.color.map(c=>c*255).join(',')+')').join(',')});-webkit-background-clip:text;-webkit-text-fill-color:transparent}
#progress{width:300px;height:4px;background:#222;border-radius:2px;overflow:hidden}
#progress-bar{height:100%;width:0;background:linear-gradient(90deg,${theme.grid[0].color.map(c=>c*255).join(',')},${theme.grid[4].color.map(c=>c*255).join(',')});transition:width .3s}
#loading-text{margin-top:10px;font-size:.9em;color:#888;min-height:1.2em}
.hud{position:fixed;bottom:10px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.3);font-size:12px;font-family:monospace;pointer-events:none;z-index:10}
.hud span{margin:0 10px}
</style>
</head>
<body>
<canvas id="renderCanvas"></canvas>
<div id="loading">
  <h1>${theme.name}</h1>
  <div id="progress"><div id="progress-bar"></div></div>
  <div id="loading-text">Entering the realm...</div>
</div>
<div class="hud">
  <span>WASD + Mouse</span>
  <span>|</span>
  <span>Scroll to zoom</span>
</div>

<script src="https://cdn.babylonjs.com/babylon.js"></script>
<script>
// ==================== ${theme.name} ====================
const engine = new BABYLON.Engine(document.getElementById('renderCanvas'), true, { preserveDrawingBuffer: true, stencil: true });
const scene = new BABYLON.Scene(engine);
scene.clearColor = new BABYLON.Color4(${theme.scene.clearColor.join(', ')}, 1);
scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
scene.fogDensity = ${theme.scene.fogDensity};
scene.fogColor = new BABYLON.Color3(${theme.scene.fogColor.join(', ')});
scene.ambientColor = new BABYLON.Color3(${theme.scene.ambientColor.join(', ')});

const canvas = document.getElementById('renderCanvas');
const camera = new BABYLON.ArcRotateCamera('cam', -Math.PI/2, Math.PI/3, 60, BABYLON.Vector3.Zero(), scene);
camera.attachControl(canvas, true);
camera.lowerRadiusLimit = 15;
camera.upperRadiusLimit = 120;
camera.wheelPrecision = 50;

// Lights
const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
hemi.intensity = 0.7;
hemi.diffuse = new BABYLON.Color3(${theme.lights.hemi.color.join(', ')});
hemi.groundColor = new BABYLON.Color3(${theme.lights.hemi.ground.join(', ')});

const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -2, -1), scene);
sun.intensity = ${theme.lights.sun.intensity};
sun.diffuse = new BABYLON.Color3(${theme.lights.sun.color.join(', ')});

// Ground
const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 200, height: 200 }, scene);
const groundMat = new BABYLON.StandardMaterial('groundMat', scene);
groundMat.diffuseColor = new BABYLON.Color3(${theme.ground.color.join(', ')});
groundMat.specularColor = new BABYLON.Color3(${theme.ground.specular.join(', ')});
ground.material = groundMat;

// Post-processing
try {
  const pipeline = new BABYLON.DefaultRenderingPipeline('pipe', true, scene, [camera]);
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = ${theme.bloom.threshold};
  pipeline.bloomWeight = ${theme.bloom.weight};
  pipeline.bloomKernel = ${theme.bloom.kernel};
  pipeline.fxaaEnabled = true;
  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.contrast = 1.2;
  pipeline.imageProcessing.exposure = 1.1;
  
  const glow = new BABYLON.GlowLayer('glow', scene);
  glow.intensity = 0.4;
} catch(e) {}

// GRIDS
const GRIDS = ${JSON.stringify(theme.grid.map((g,i)=>({
  id: i, name: g.name, icon: g.icon,
  color: g.color,
  x: (i % 3) * 45,
  z: Math.floor(i / 3) * 45,
  type: g.type
})))};

// ===== BUILDINGS =====
const BUILDINGS_BY_TYPE = ${JSON.stringify(theme.buildings)};

function getBuildings(type) {
  return BUILDINGS_BY_TYPE[type] || BUILDINGS_BY_TYPE.work;
}

function createGroundWithGrids(fogDensity) {
  for (const grid of GRIDS) {
    const zone = BABYLON.MeshBuilder.CreateDisc('zone_'+grid.id, { radius: 38 }, scene);
    zone.position = new BABYLON.Vector3(grid.x, 0.05, grid.z);
    zone.rotation.x = Math.PI/2;
    const zMat = new BABYLON.StandardMaterial('zm_'+grid.id, scene);
    zMat.diffuseColor = new BABYLON.Color3(...grid.color.map(c => c * 0.2));
    zMat.alpha = 0.4;
    zone.material = zMat;

    const ring = BABYLON.MeshBuilder.CreateTorus('ring_'+grid.id, { diameter: 60, thickness: 1.5 }, scene);
    ring.position = new BABYLON.Vector3(grid.x, 0.1, grid.z);
    ring.rotation.x = Math.PI/2;
    const rMat = new BABYLON.StandardMaterial('rm_'+grid.id, scene);
    rMat.diffuseColor = new BABYLON.Color3(...grid.color);
    rMat.emissiveColor = new BABYLON.Color3(grid.color[0]*0.3, grid.color[1]*0.3, grid.color[2]*0.3);
    ring.material = rMat;

    const configs = getBuildings(grid.type);
    configs.forEach((cfg, i) => {
      const angle = (i / configs.length) * Math.PI * 2;
      const radius = 15 + (i % 3) * 8;
      const x = grid.x + Math.cos(angle) * radius;
      const z = grid.z + Math.sin(angle) * radius;
      createBuilding(grid, cfg, x, z, i);
    });

    createMonument(grid);
  }
  
  // Roads
  for (const grid of GRIDS) {
    const col = grid.id % 3, row = Math.floor(grid.id / 3);
    if (col < 2) {
      const r = BABYLON.MeshBuilder.CreateBox('rh_'+grid.id, { width: 15, height: 0.1, depth: 2 }, scene);
      r.position = new BABYLON.Vector3(grid.x + 22.5, 0.05, grid.z);
      const rm = new BABYLON.StandardMaterial('rhm_'+grid.id, scene);
      rm.diffuseColor = new BABYLON.Color3(${theme.roads.color.join(', ')});
      r.material = rm;
    }
    if (row < 2) {
      const r = BABYLON.MeshBuilder.CreateBox('rv_'+grid.id, { width: 2, height: 0.1, depth: 15 }, scene);
      r.position = new BABYLON.Vector3(grid.x, 0.05, grid.z + 22.5);
      const rm = new BABYLON.StandardMaterial('rvm_'+grid.id, scene);
      rm.diffuseColor = new BABYLON.Color3(${theme.roads.color.join(', ')});
      r.material = rm;
    }
  }
  
  // Decorations
  for (const grid of GRIDS) {
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 28 + Math.random() * 8;
      const x = grid.x + Math.cos(angle) * radius;
      const z = grid.z + Math.sin(angle) * radius;
      const type = Math.floor(Math.random() * 3);
      if (type === 0) {
        const b = BABYLON.MeshBuilder.CreateBox('bench_'+grid.id+'_'+i, { width: 2, height: 0.5, depth: 0.5 }, scene);
        b.position = new BABYLON.Vector3(x, 0.25, z);
      } else if (type === 1) {
        const t = BABYLON.MeshBuilder.CreateCylinder('tree_'+grid.id+'_'+i, { height: 3, diameterTop: 0, diameterBottom: 1.5 }, scene);
        t.position = new BABYLON.Vector3(x, 1.5, z);
        const tm = new BABYLON.StandardMaterial('tm_'+grid.id+'_'+i, scene);
        tm.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.2);
        t.material = tm;
      }
    }
  }
  
  // Particles
  const ps = new BABYLON.ParticleSystem('ambient', 400, scene);
  ps.particleTexture = new BABYLON.Texture('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAOxAAADsQBlSsOGwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAKdSURBVFiF7ZdNaxRBFIC/md29XNxEXFC8EhEvgheNvHrxJvRKvHrxpniRePEfwIvIi8SLF8WLRPwJvoqIRhQXvCIuu7uzu+WsMLt7u7d3L+4lxgczszvz3pvZmZ1VIgThXyL4b3L3Hwd+7u7eW/b8tP2d0e0B0N0ngPdmdjMzu5mZFU3gEHCqKWAyqpvZaDPxHPCymX8u+24P8LqZfQG+mtlhM6sA3zKz82b2oZl9N7PnZrbPzH4D9gEfzexzM/vczF6a2VEzex84Y2Y3mtlrM3thZp+a2evA0cD/Apwy4+0ws3fAJDP7ADwPvAfOm9m9wN0B9gInzexh4IuZPWpmLwPnmwI2gQfN7BUwMLPXzez5YPoR2GNm3wLnmwIC4KSZvQUmwPvAw6aAleB+M3sP3G8KCPyJ4wF+mdmrwPkI/gTcb2aPgfeBA2b2pJk9Dhw0s6fN7FXgkJl9BpwPfO4FdpnZp8D1wP8qsN/MHgfuNQUcAN4HzpjZ08AXM3tkZl+a2X0ze2xmh8zssZkdMrP7ZvbCzA6Z2VMze2xmj5rZ82Z2t5ndMLPHZvbUzJ6Y2eNm9tLMnjWzl2b2wsxemtlLM3thZq+a2Usze9XM3jSzt2b2rpndN7PXzez/Y++8g+Soy/j/e7qne3JaWUmIJJRRQIAJJmNsTDTR5TQ555xBEMlROeeco0gCBEhCEhIgcTTRJoTIOedgkuU4aXKO8/+h3u7Z3dmZnZ3ZnR3m+zzPPNPd1dX3Xr+qrq5CUuYI0hM8CdwGnAc0AWuB1cCFQBOwATgTeBk4FTgReAV4FfiwmX8xszfN7LH4LPCwmX+ys/eBbUBr4P4C3gR2B6aZ+Xdm/hF43My+NPPZZvYVcHfg/gK8Z+YPmdmvwNPAcTP/1cyHmvlXZv4ScH/g/gp8aOYPmtlPwKPA8Wb+0MynN/MpzfybwB3AY2Y+xcx/CHxu5t+b+Rdm/oWZT2vmU5v5l8AtwCNm/k1gspl/ZeYfmvmnZj7NzD8KXG3mn5r5R2b+sZl/YeYfmflHgbvN/GMz/zg438z/AJ4x84/MfIKZTzfzCWb+IXCTmX9o5h+a+Ydm/kHgDjP/yMwnmPlkM//YzD8K3G7mH5r5h2b+AfCumX9o5h8F7jTz6c18spl/FLjNzD8w8w/N/AMz/yBwu5l/aOYfBu4084/NfIKZTzHzKWb+IXC7mX9g5h8EbjfzyWb+kZl/aObTzPxjM/8gcIeZTzbzCWb+UeA2M3/fzD808w/N/EMz/yBwp5lPNvOPAnf8hwN3/9f+AP8D+AcU1hX7rAAAAABJRU5ErkJggg==', scene);
  ps.emitter = new BABYLON.Vector3(0, 0.5, 0);
  ps.minEmitBox = new BABYLON.Vector3(-80, 0, -80);
  ps.maxEmitBox = new BABYLON.Vector3(80, 5, 80);
  ps.color1 = new BABYLON.Color4(${theme.particles.color1.join(', ')}, 0.2);
  ps.color2 = new BABYLON.Color4(${theme.particles.color2.join(', ')}, 0.2);
  ps.colorDead = new BABYLON.Color4(${theme.particles.dead.join(', ')}, 0);
  ps.minSize = 0.05;
  ps.maxSize = 0.15;
  ps.minLifeTime = 3;
  ps.maxLifeTime = 6;
  ps.emitRate = ${theme.particles.emitRate};
  ps.gravity = new BABYLON.Vector3(${theme.particles.gravity.join(', ')});
  ps.direction1 = new BABYLON.Vector3(-0.1, 0.05, -0.1);
  ps.direction2 = new BABYLON.Vector3(0.1, 0.1, 0.1);
  ps.minEmitPower = 0.05;
  ps.maxEmitPower = 0.1;
  ps.start();
  
  // Skybox
  const sky = BABYLON.MeshBuilder.CreateBox('skybox', { size: 300 }, scene);
  const skyMat = new BABYLON.StandardMaterial('skyboxMat', scene);
  skyMat.backFaceCulling = false;
  skyMat.diffuseColor = new BABYLON.Color3(${theme.scene.fogColor.join(', ')});
  skyMat.specularColor = new BABYLON.Color3(0, 0, 0);
  sky.material = skyMat;
  
  // Stars
  const stars = new BABYLON.PointsCloudSystem('stars', 300, scene);
  stars.addPoints(300, (p) => {
    p.position = new BABYLON.Vector3(
      (Math.random() - 0.5) * 400,
      Math.random() * 100 + 50,
      (Math.random() - 0.5) * 400
    );
    p.color = new BABYLON.Color4(1, 1, 1, 0.3 + Math.random() * 0.7);
    p.size = 0.2 + Math.random() * 0.5;
  });
  stars.buildMeshAsync();
}

function createBuilding(grid, cfg, x, z, i) {
  const b = BABYLON.MeshBuilder.CreateBox('bld_'+grid.id+'_'+i, { width: cfg.s, height: cfg.h, depth: cfg.s }, scene);
  b.position = new BABYLON.Vector3(x, cfg.h/2, z);
  const m = new BABYLON.StandardMaterial('bm_'+grid.id+'_'+i, scene);
  m.diffuseColor = new BABYLON.Color3(...cfg.c);
  m.specularColor = new BABYLON.Color3(0.3, 0.3, 0.4);
  m.emissiveColor = new BABYLON.Color3(cfg.c[0]*0.2, cfg.c[1]*0.2, cfg.c[2]*0.2);
  b.material = m;
  
  const roof = BABYLON.MeshBuilder.CreateCylinder('roof_'+grid.id+'_'+i, { 
    diameterTop: 0, diameterBottom: cfg.s*0.8, height: cfg.h*0.25, tessellation: 4
  }, scene);
  roof.position = new BABYLON.Vector3(x, cfg.h + cfg.h*0.125, z);
  roof.rotation.y = Math.PI/4;
  const rm = new BABYLON.StandardMaterial('rm_'+grid.id+'_'+i, scene);
  rm.diffuseColor = new BABYLON.Color3(...cfg.c.map(c=>c*0.5));
  roof.material = rm;
  
  // Windows
  for (let w = -1; w <= 1; w += 2) {
    for (let f = 0; f < Math.floor(cfg.h/3); f++) {
      const win = BABYLON.MeshBuilder.CreatePlane('win_'+grid.id+'_'+i+'_'+w+'_'+f, { width: 0.8, height: 1.2 }, scene);
      win.position = new BABYLON.Vector3(x + w*(cfg.s/2-0.2), 2 + f*3, z + cfg.s/2 + 0.01);
      win.rotation.y = Math.PI;
      const wm = new BABYLON.StandardMaterial('wm_'+grid.id+'_'+i, scene);
      wm.emissiveColor = new BABYLON.Color3(0.6, 0.8, 1);
      wm.alpha = 0.7;
      win.material = wm;
    }
  }
}

function createMonument(grid) {
  const m = BABYLON.MeshBuilder.CreateCylinder('mon_'+grid.id, { height: 8, diameterTop: 0, diameterBottom: 4, tessellation: 8 }, scene);
  m.position = new BABYLON.Vector3(grid.x, 4, grid.z);
  const mm = new BABYLON.StandardMaterial('monm_'+grid.id, scene);
  mm.diffuseColor = new BABYLON.Color3(...grid.color);
  mm.emissiveColor = new BABYLON.Color3(grid.color[0]*0.5, grid.color[1]*0.5, grid.color[2]*0.5);
  m.material = mm;
  
  const orb = BABYLON.MeshBuilder.CreateSphere('orb_'+grid.id, { diameter: 2 }, scene);
  orb.position = new BABYLON.Vector3(grid.x, 10, grid.z);
  const om = new BABYLON.StandardMaterial('orbm_'+grid.id, scene);
  om.diffuseColor = new BABYLON.Color3(...grid.color);
  om.emissiveColor = new BABYLON.Color3(...grid.color);
  om.alpha = 0.8;
  orb.material = om;
  
  scene.registerBeforeRender(() => {
    m.rotation.y += 0.005;
    orb.position.y = 10 + Math.sin(Date.now() * 0.002) * 0.5;
  });
}

// ==================== INIT ====================
let pct = 0;
function setProgress(v, msg) {
  pct = v;
  document.getElementById('progress-bar').style.width = v+'%';
  document.getElementById('loading-text').textContent = msg || 'Loading...';
}

async function init() {
  setProgress(10, 'Creating world...');
  await new Promise(r => setTimeout(r, 100));
  
  setProgress(30, 'Building cities...');
  createGroundWithGrids();
  await new Promise(r => setTimeout(r, 100));
  
  setProgress(60, 'Adding atmosphere...');
  await new Promise(r => setTimeout(r, 100));
  
  setProgress(80, 'Finalizing...');
  
  engine.runRenderLoop(() => scene.render());
  window.addEventListener('resize', () => engine.resize());
  
  setProgress(100, '${theme.name} ready!');
  await new Promise(r => setTimeout(r, 500));
  document.getElementById('loading').style.opacity = '0';
  setTimeout(() => document.getElementById('loading').style.display = 'none', 500);
}

init();
</script>
</body>
</html>`;

  const outDir = path.join(OUTPUT_DIR, slug);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  
  const htmlPath = path.join(outDir, 'index.html');
  fs.writeFileSync(htmlPath, html.trim());
  
  const sizeKB = Math.round(fs.statSync(htmlPath).size / 1024);
  console.log(`  ✅ ${slug}/index.html (${sizeKB}KB)`);
  return htmlPath;
}

// ==================== MAIN ====================
console.log('╔══════════════════════════════════════════╗');
console.log('║   SOULVERSE HABITAT GENERATOR v1         ║');
console.log('║   Generate themed 3D worlds to sell       ║');
console.log('╚══════════════════════════════════════════╝\n');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const results = [];
for (const [key, theme] of Object.entries(THEMES)) {
  try {
    const path = generateTheme(key, theme);
    results.push({ key, name: theme.name, path, price: theme.price });
  } catch(e) {
    console.error(`  ❌ ${key}: ${e.message}`);
  }
}

console.log('\n╔══════════════════════════════════════════╗');
console.log('║   GENERATION COMPLETE                    ║');
console.log('╚══════════════════════════════════════════╝\n');
console.log('Products generated:');
for (const r of results) {
  console.log(`  ${r.price} — ${r.name}`);
  console.log(`       ${r.path}`);
}
console.log(`\nTotal: ${results.length} habitats ready to sell`);
console.log(`Output: ${OUTPUT_DIR}`);
