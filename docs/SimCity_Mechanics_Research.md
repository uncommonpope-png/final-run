# SimCity Mechanics Research for SOULVERSE
## City Building Game Mechanics Analysis

This document analyzes core mechanics from all SimCity versions (SNES through 2013) and provides implementation guidance for SOULVERSE Soul Universe city building system.

---

## 1. City Zoning System

### Core SimCity Mechanic
SimCity uses a three-zone system: **Residential (R)**, **Commercial (C)**, and **Industrial (I)**. Zones are fixed 3x3 grid cells that only develop when powered. Density (low/medium/high) determines building size.

### Key Mechanics
- **RCI Demand**: Interactive meter showing current demand for each zone type
- **Wealth Levels**: Residential has low/medium/high wealth; commercial has service vs office; industrial has agriculture, dirty, manufacturing, high-tech
- **Desirability Factors**: Land value, pollution, crime, commute time, proximity to services
- **Golden Ratio**: Internal algorithm determines optimal RCI balance; deviation causes stagnation

### SOULVERSE Implementation Guidance

```javascript
// SOULVERSE Zone System
const ZoneTypes = {
  RESIDENTIAL: 'residential',  // Soul housing
  COMMERCIAL: 'commercial',   // Marketplace/services
  INDUSTRIAL: 'industrial',   // Production/crafting
  SPIRITUAL: 'spiritual',     // Churches/temples
  ENTERTAINMENT: 'entertainment' // Theaters/arcades
};

class SoulZone {
  constructor(type, density, wealth) {
    this.type = type;           // Zone type
    this.density = density;     // 1-3 (low/med/high)
    this.wealth = wealth;       // 1-3 (low/med/high)
    this.demand = 0;            // Current demand
    this.buildings = [];        // Active buildings
    this.souls = [];            // Living here
    this.pollution = 0;
    this.landValue = 50;
  }

  calculateDesirability() {
    const factors = {
      pollution: -this.pollution * 2,
      services: this.nearbyServices * 5,
      commute: -this.commuteTime * 0.5,
      crime: -this.crimeRate * 3,
      spiritual: this.nearbyShrines * 8,
      wealth: this.wealth * 10
    };
    this.landValue = 50 + sum(Object.values(factors));
    return this.landValue;
  }
}
```

### Zoning Rules for SOULVERSE
1. Zone must be adjacent to powered road to develop
2. Residential near industrial = pollution complaints, lower land value
3. High-density requires adjacent high-capacity road
4. Re-zoning demolishes existing buildings after grace period

---

## 2. Road Networks & Traffic

### Core SimCity Mechanic
Roads carry traffic, power, water, sewage. Traffic uses pathfinding based on distance, congestion thresholds (25%, 50%, 75%), and capacity. Better roads = higher density zones.

### Road Hierarchy
| Road Type | Capacity | Max Density | Cost |
|-----------|----------|--------------|------|
| Dirt Road | Low | Low | $2 |
| Street | Medium | Medium | $4-8 |
| Avenue | High | High | $10-20 |
| Highway | Very High | High | $15+ |

### Key Mechanics
- **Pathfinding**: Vehicles assign weights, propagate values through network
- **Congestion**: At thresholds, weights multiply (10x at 50%)
- **Mass Transit**: Buses, trains, streetcars reduce road traffic
- **Grid Patterns**: Grid (cheap), Brick (offset), Hexagon/Octagon (efficient)

### SOULVERSE Implementation Guidance

```javascript
class SoulRoad {
  constructor(type, tiles) {
    this.type = type;           // dirt, street, avenue, highway
    this.tiles = tiles;         // Array of tile positions
    this.capacity = this.getCapacity();
    this.congestion = 0;
    this.vehicles = [];         // Current traffic
    this.connections = [];      // Connected roads/nodes
  }

  getCapacity() {
    const capacities = {
      dirt: 10,
      street: 25,
      avenue: 50,
      highway: 100
    };
    return capacities[this.type];
  }

  calculateRoute(origin, destination) {
    // A* pathfinding with congestion weighting
    const baseWeight = distance(origin, destination);
    const congestionPenalty = this.congestion > 0.75 ? 10 :
                               this.congestion > 0.50 ? 5 :
                               this.congestion > 0.25 ? 2 : 1;
    return baseWeight * congestionPenalty;
  }
}

// Traffic flow simulation
function updateTraffic(deltaTime) {
  roads.forEach(road => {
    // Calculate congestion
    road.congestion = road.vehicles.length / road.capacity;

    // Recalculate routes if threshold crossed
    if (road.congestion > 0.25) {
      vehicles.forEach(v => {
        if (v.currentRoad === road) {
          v.recalculateRoute();
        }
      });
    }
  });
}
```

### Traffic Principles for SOULVERSE
1. Connect corners of map to highway for minimal congestion
2. Interlace residential with commercial (walkable communities)
3. Avoid 4-way intersections; use 3-way or roundabouts
4. Zone along main routes = heavy traffic; avoid
5. Mass transit essential for cities over 10K population

---

## 3. Budget Management

### Core SimCity Mechanic
Tax is property tax based on building type, density, wealth. Default 9%, range 0-20%. Higher taxes = lower growth but more income. Separate rates for R/C/I and wealth levels (SimCity 4+).

### Budget Categories
- **Income**: Tax revenue, service deals, exports
- **Expenditures**: Power, water, road maintenance, services, ordinances
- **Loans**: Available up to debt limit; 10 sim-year term

### Key Mechanics
- **Tax-Growth Tradeoff**: Lower taxes = faster growth, less income
- **Wealth Targeting**: Tax different wealth levels to attract/repel
- **Service Funding**: 0-150% funding affects quality
- **Ordinances**: Tradeoffs (e.g., Legalized Gambling: +C demand, +25% crime)

### SOULVERSE Implementation Guidance

```javascript
class SoulBudget {
  constructor() {
    this.balance = 5000;
    this.income = 0;
    this.expenses = 0;
    this.debt = 0;
    this.taxRates = {
      residential: 0.09,
      commercial: 0.09,
      industrial: 0.09,
      spiritual: 0.05  // Reduced for temples
    };
  }

  calculateIncome() {
    let income = 0;
    zones.forEach(zone => {
      const baseRate = this.taxRates[zone.type];
      const densityMultiplier = zone.density;
      const wealthMultiplier = zone.wealth;
      const happinessFactor = zone.soulHappiness / 100;

      income += BASE_TAX * densityMultiplier * wealthMultiplier * baseRate * happinessFactor;
    });
    this.income = income;
    return income;
  }

  calculateExpenses() {
    let expenses = 0;
    // Power costs
    expenses += powerPlants * POWER_COST;
    // Service costs
    expenses += services.reduce((sum, s) => sum + s.funding * s.cost, 0);
    // Road maintenance
    expenses += roads.length * ROAD_MAINTENANCE;
    this.expenses = expenses;
    return expenses;
  }

  setTaxRate(zoneType, rate) {
    // Rate 0.0 to 0.20
    this.taxRates[zoneType] = rate;
    // Re-calculate demand impact
    zones.filter(z => z.type === zoneType).forEach(z => {
      z.demand = z.demand * (1 - (rate - 0.09) * 2); // Higher tax = lower demand
    });
  }
}
```

### Budget Strategies for SOULVERSE
1. Start with 5-7% tax, adjust based on demand
2. Use "growth mode" (low taxes) when expanding
3. Use "wealth mode" (high taxes) when city mature
4. Service funding 80-100% is optimal
5. Monitor advisor warnings for budget issues

---

## 4. Sim Needs & Happiness

### Core SimCity Mechanic
Sims have needs: happiness, jobs, health, education, safety. Building type affects which needs are met. Happiness affects building density upgrade and demand.

### Need Categories
- **Residential**: Jobs (C/I), shopping (C), safety, health, education
- **Commercial**: Workers (R), shoppers (R), goods (I)
- **Industrial**: Workers (R), shipping (roads/rails/ports)

### Key Mechanics
- **Happiness Calculation**: Average of all residential buildings
- **Density Upgrades**: Require happiness threshold + adjacent high-capacity road
- **Abandonment**: Very low happiness = buildings abandoned
- **Education Quotient (EQ)**: Determines job capability, industrial tech level

### SOULVERSE Implementation Guidance

```javascript
class SoulNeed {
  constructor(type, value = 50) {
    this.type = type;          // happiness, employment, health, education
    this.value = value;        // 0-100
    this.changeRate = 0;       // Per tick change
  }

  update(dt) {
    // Calculate based on nearby services
    this.value = clamp(this.value + this.changeRate * dt, 0, 100);
  }
}

class SoulResident {
  constructor(homeZone) {
    this.home = homeZone;
    this.needs = {
      happiness: new SoulNeed('happiness'),
      employment: new SoulNeed('employment'),
      health: new SoulNeed('health'),
      education: new SoulNeed('education')
    };
    this.wealth = 1;
    this.education = 1;
    this.job = null;
  }

  calculateHappiness() {
    const factors = {
      jobAccess: this.job ? 20 : -10,
      healthCare: this.nearbyHospitals * 5,
      education: this.nearbySchools * 3,
      pollution: -this.zone.pollution,
      crime: -this.zone.crimeRate * 2,
      taxes: -this.city.taxRate * 50,
      spiritual: this.nearbyShrines * 8
    };
    return 50 + sum(Object.values(factors));
  }
}
```

### Needs System for SOULVERSE
1. Residential needs: jobs, shopping, safety, health, education, spiritual
2. Happiness threshold for density upgrade: 60%
3. Education unlocks higher-tier jobs/industry
4. Health affects life expectancy and work productivity
5. Employment happiness: job must match education level

---

## 5. Disasters

### SimCity Disaster Types
| Disaster | Trigger | Effect | Mitigation |
|----------|---------|--------|------------|
| Fire | Random, riots, earthquake | Buildings burn | Fire stations |
| Earthquake | Random, cheat | Ground damage, fires | None (unpreventable) |
| Flood | Random | Water damage | Dikes |
| Tornado | Random | Path destruction | Warning siren |
| Monster (Godzillla) | Random, cheat | Destroys buildings | Military |
| UFO | Random, cheat | Random attacks | None |
| Nuclear Meltdown | Fire/quake at nuclear | Radioactive zone | None |
| Meteor | Random, unlock | Massive destruction | None |

### Disaster Progression
1. Warning phase (optional siren)
2. Active disaster (damage buildings, spawn emergency)
3. Cleanup phase (rubble remains, must bulldoze)

### SOULVERSE Implementation Guidance

```javascript
class SoulDisaster {
  constructor(type, intensity) {
    this.type = type;          // fire, earthquake, tornado, monster, etc.
    this.intensity = intensity; // 1-10
    this.active = false;
    this.position = null;
    this.duration = 0;
    this.warningTime = 300;    // 5 seconds warning
  }

  trigger(position) {
    this.active = true;
    this.position = position;
    this.duration = this.intensity * 60; // ticks

    // Show warning
    showWarning(`${this.type.toUpperCase()} APPROACHING!`);

    // Calculate damage radius
    this.damageRadius = this.intensity * 10;

    // Run damage each tick
    this.damageInterval = setInterval(() => {
      this.applyDamage();
    }, 1000);
  }

  applyDamage() {
    const buildings = getBuildingsInRadius(this.position, this.damageRadius);
    buildings.forEach(b => {
      const damage = this.intensity * (1 - distance(b, this.position) / this.damageRadius);
      b.takeDamage(damage);
    });
  }
}

// Disaster unlock system
const disasterUnlocks = {
  tornado: { requirement: 'windTurbines >= 24', unlock: 'achievement' },
  earthquake: { requirement: 'mining >= 100 tons', unlock: 'achievement' },
  monster: { requirement: 'pollution > 50', unlock: 'random' },
  meteor: { requirement: 'tourists >= 200/day', unlock: 'achievement' },
  ufo: { requirement: 'spaceCenterBuilt', unlock: 'achievement' }
};
```

### Disaster Mechanics for SOULVERSE
1. Fire: Most common; fire stations with good response time prevent spread
2. Earthquake: Unpreventable; damages roads/utilities; causes fires
3. Monster: Attacks polluted areas; military can distract
4. Disasters unlock via achievements (like SimCity 2013)
5. Warning sirens give time to position fire trucks

---

## 6. Cheats & God Powers

### SimCity Cheat Categories
**Debug/Cheat Console**: Ctrl+X (SimCity 4), Enable debug (original)
- `weaknesspays` - +$1000
- `riskymoney` - +$10000 (triggers earthquake)
- `fightthepower` - Remove power requirement
- `howdryiam` - Remove water requirement
- `stopwatch` - Pause time
- `sizefof [1-100]` - Zoom level
- `terrainquery` - Show coordinates
- `dollyllama` - Toggle advisor faces/llamas

**God Mode**: Pre-city terraforming, can be reactivated (Ctrl+Alt+Shift + click God Mode)
- Full terraforming before city establishment
- Plop any building anywhere
- No budget constraints in early game

### SOULVERSE Implementation Guidance

```javascript
class SoulDebugTools {
  constructor() {
    this.enabled = false;
    this.godMode = false;
    this.cheats = {
      money: false,
      noPower: false,
      noWater: false,
      paused: false,
      invincibility: false
    };
  }

  enableCheats() {
    this.enabled = true;
    console.log('Debug mode enabled. Press ~ for console.');
  }

  processCommand(cmd) {
    const commands = {
      'money': () => this.cheats.money = true,
      'nomoney': () => this.cheats.money = false,
      'pause': () => this.cheats.paused = true,
      'resume': () => this.cheats.paused = false,
      'god': () => this.enableGodMode(),
      'quake': () => this.triggerEarthquake(),
      'fire': () => this.startFire(),
      'monster': () => this.spawnMonster()
    };

    if (commands[cmd]) {
      commands[cmd]();
      return true;
    }
    return false;
  }

  // God mode: bypass all restrictions
  enableGodMode() {
    this.godMode = true;
    this.buildCost = 0;
    this.requirePower = false;
    this.requireWater = false;
    this.zoneRestrictions = false;
  }
}

// Console handler
function handleConsoleInput(input) {
  if (!debug.enabled) return;

  const [cmd, ...args] = input.split(' ');
  debug.processCommand(cmd);
}
```

### Cheat System for SOULVERSE
1. Toggle debug with F12 or ~ key
2. Command console for money, disasters, pause
3. God mode for sandbox play (unlock after first city)
4. Achievement-based disaster unlocks still work in sandbox

---

## 7. Buildings & Services

### SimCity Service Buildings

| Service | Function | Coverage | Upgrade |
|---------|----------|----------|---------|
| Power Plant | Electricity | Global via grid | Tech level |
| Water Pump | Water supply | Radius based | Capacity |
| Hospital | Health | Large radius | Capacity |
| School | Education (K-12) | Medium radius | Grade level |
| Community College | Tech level 2 industry | Medium radius | Capacity |
| University | Tech level 3 industry | Large radius | Capacity |
| Fire Station | Fire response | Radius | Response time |
| Police Station | Crime reduction | Radius | Patrol coverage |
| Library | Education bonus | Adjacent bonus | None |
| Park | Land value, happiness | Adjacent | Type |
| Stadium | RCI cap increase | Global | Capacity |

### Key Mechanics
- **Coverage Radius**: Services only affect nearby buildings
- **Funding**: 0-150% affects quality/effectiveness
- **Capacity**: Limits how many can use service
- **Upgrades**: Better stats, more capacity, higher tech support

### SOULVERSE Implementation Guidance

```javascript
const SERVICE_BUILDINGS = {
  // Power
  powerPlant: { type: 'power', capacity: 5000, range: 30, cost: 500 },
  solarFarm: { type: 'power', capacity: 2000, range: 20, cost: 300, pollution: 0 },
  nuclearPlant: { type: 'power', capacity: 10000, range: 50, cost: 1500, risk: 'meltdown' },

  // Water
  waterPump: { type: 'water', capacity: 3000, range: 20, cost: 200 },
  waterTreatment: { type: 'water', capacity: 5000, range: 25, cost: 400 },

  // Health
  clinic: { type: 'health', capacity: 1000, range: 15, cost: 150 },
  hospital: { type: 'health', capacity: 5000, range: 30, cost: 800 },

  // Education
  school: { type: 'education', capacity: 2000, range: 20, cost: 300 },
  university: { type: 'education', capacity: 5000, range: 40, cost: 1000 },

  // Safety
  fireStation: { type: 'fire', capacity: 10, range: 15, cost: 250 },
  policeStation: { type: 'police', capacity: 20, range: 20, cost: 300 },

  // Spiritual (SOULVERSE unique)
  shrine: { type: 'spiritual', range: 10, cost: 100, happiness: +5 },
  temple: { type: 'spiritual', range: 25, cost: 500, happiness: +15 },
  cathedral: { type: 'spiritual', range: 40, cost: 1500, happiness: +30 }
};

class SoulBuilding {
  constructor(type, position) {
    const config = SERVICE_BUILDINGS[type];
    this.type = config.type;
    this.position = position;
    this.capacity = config.capacity;
    this.range = config.range;
    this.cost = config.cost;
    this.funding = 1.0; // 0-1.5
    this.active = true;
    this.buildingLevel = 1;
    this.clients = [];
  }

  calculateCoverage() {
    // Find all buildings within range
    const inRange = buildings.filter(b =>
      distance(b.position, this.position) <= this.range
    );

    // Apply funding modifier
    const effectiveCoverage = this.capacity * this.funding;

    return {
      covered: inRange,
      utilization: inRange.length / effectiveCoverage,
      quality: this.funding * this.buildingLevel
    };
  }
}
```

---

## 8. City Advisors

### SimCity Advisor System
Advisors provide tips, warnings, and department status. First appeared in SimCity 2000, fully developed in 3000/4.

### Advisor Types (SimCity 4)
- **Constance Lee** - City Planning
- **Mortimer Green** - Finance
- **Moe Biehl** - Transportation
- **Frawl** - Environment
- **Maria Montoya** - Public Safety
- **Randall Shoop** - Health/Education

### Mood States
- **Green**: Happy with department
- **Blue**: Content, minor advice
- **Red**: Problem needs attention
- **Flashing Red**: Emergency!

### Features
- Pop-up alerts for urgent issues
- Click to zoom to problem location
- Detailed reports when clicked
- Thought bubbles show building-level issues

### SOULVERSE Implementation Guidance

```javascript
class SoulAdvisor {
  constructor(name, department) {
    this.name = name;
    this.department = department; // planning, finance, safety, etc.
    this.mood = 'neutral';
    this.reports = [];
    this.urgency = 0;
  }

  assessSituation(city) {
    // Generate report based on department
    const report = this[`assess${this.department}`](city);
    this.reports.push(report);

    // Determine mood
    if (report.critical > 0) {
      this.mood = 'critical';
      this.urgency = 1.0;
    } else if (report.warnings > 0) {
      this.mood = 'warning';
      this.urgency = 0.5;
    } else {
      this.mood = 'happy';
      this.urgency = 0;
    }

    return report;
  }

  // Example: Finance advisor
  assessFinance(city) {
    const report = { warnings: [], critical: [], suggestions: [] };

    if (city.budget.balance < 0) {
      report.critical.push('City is in debt!');
      report.suggestions.push('Raise taxes or reduce services');
    }

    if (city.budget.expenses > city.budget.income * 1.5) {
      report.warnings.push('Expenses exceed income');
    }

    return report;
  }
}

// Advisors array
const SOULVERSE_ADVISORS = [
  new SoulAdvisor('Oracle', 'spiritual'),    // Unique to SOULVERSE
  new SoulAdvisor('Treasurer', 'finance'),
  new SoulAdvisor('Architect', 'planning'),
  new SoulAdvisor('Guardian', 'safety'),
  new SoulAdvisor('Healer', 'health'),
  new SoulAdvisor('Scholar', 'education'),
  new SoulAdvisor('Envoy', 'environment')
];

// UI rendering
function renderAdvisors() {
  return SOULVERSE_ADVISORS.map(advisor => ({
    name: advisor.name,
    mood: advisor.mood,
    icon: ADVISOR_ICONS[advisor.department],
    click: () => showAdvisorReport(advisor)
  }));
}
```

---

## 9. Milestones & Achievements

### SimCity Milestone System
Cities unlock rewards at population thresholds. Milestones unlock new buildings, ordinances, and special structures.

### Milestone Progression (SimCity 4)
| Population | Milestone | Unlocks |
|------------|-----------|---------|
| 2,000 | Village | Small park, basic services |
| 10,000 | Town | Medium zoning, more services |
| 50,000 | City | High density, advanced services |
| 100,000 | Metropolis | Subway, larger buildings |
| 500,000 | Capital | Great works, landmarks |
| 1,000,000+ | Megalopolis | All content |

### Achievement Examples (SimCity 2013)
- Burn 100 tons garbage → Big Lizard disaster
- 200 tourists/day → Meteor disaster
- 24 wind turbines → Tornado disaster

### SOULVERSE Implementation Guidance

```javascript
const SOULVERSE_MILESTONES = [
  { population: 100, name: 'Outpost', rewards: ['basic_zoning'] },
  { population: 500, name: 'Hamlet', rewards: ['market', 'basic_services'] },
  { population: 2000, name: 'Village', rewards: ['medium_zoning', 'shrine'] },
  { population: 5000, name: 'Town', rewards: ['fire_station', 'clinic'] },
  { population: 10000, name: 'City', rewards: ['high_zoning', 'temple'] },
  { population: 25000, name: 'Metropolis', rewards: ['university', 'hospital'] },
  { population: 50000, name: 'Capital', rewards: ['cathedral', 'monument'] },
  { population: 100000, name: 'Great City', rewards: ['great_work', 'all_buildings'] },
  { population: 250000, name: 'Megalopolis', rewards: ['ascension', 'god_mode'] }
];

class SoulMilestone {
  constructor() {
    this.achievements = [];
    this.currentMilestone = 0;
  }

  checkPopulation(population) {
    const nextMilestone = SOULVERSE_MILESTONES[this.currentMilestone + 1];
    if (nextMilestone && population >= nextMilestone.population) {
      this.unlock(nextMilestone);
    }
  }

  unlock(milestone) {
    this.currentMilestone++;
    showAnnouncement(`MILESTONE: ${milestone.name}!`);

    milestone.rewards.forEach(reward => {
      unlockContent(reward);
    });
  }

  checkAchievements(cityStats) {
    const achievements = {
      first_shrine: cityStats.shrines > 0,
      population_1000: cityStats.population > 1000,
      no_debt: cityStats.debt === 0 && cityStats.population > 500,
      eco_friendly: cityStats.pollution === 0 && cityStats.population > 1000,
      spiritual_center: cityStats.temples >= 3,
      diverse_city: cityStats.zoneTypes >= 5
    };

    Object.entries(achievements).forEach(([id, earned]) => {
      if (earned && !this.achievements.includes(id)) {
        this.achievements.push(id);
        triggerAchievement(id);
      }
    });
  }
}
```

---

## 10. Query Tool (Click Information)

### SimCity Query System
Click any building/zone to see:
- Building type and level
- Current occupants/workers
- Happiness/health status
- Problems and needs
- Local budget funding
- Historical designation option

### Query Information Display
- **Header**: Building name, type, photo
- **Stats**: Population, income, status
- **Needs**: Power, water, goods, workers
- **Problems**: Specific issues with icons
- **Actions**: Bulldoze, historical, adjust funding

### SOULVERSE Implementation Guidance

```javascript
class SoulQueryTool {
  constructor() {
    this.selected = null;
  }

  click(position) {
    // Find clicked entity
    const entity = this.findEntityAt(position);

    if (entity) {
      this.selected = entity;
      return this.getInfo(entity);
    }

    return null;
  }

  findEntityAt(position) {
    // Check buildings first (priority)
    const building = buildings.find(b =>
      isInside(position, b.bounds)
    );
    if (building) return building;

    // Check zones
    const zone = zones.find(z =>
      isInside(position, z.bounds)
    );
    if (zone) return zone;

    // Check roads
    const road = roads.find(r =>
      isOnRoad(position, r.tiles)
    );
    return road;
  }

  getInfo(entity) {
    const base = {
      name: entity.name,
      type: entity.type,
      position: entity.position
    };

    if (entity instanceof SoulBuilding) {
      return {
        ...base,
        stats: {
          population: entity.occupants,
          capacity: entity.capacity,
          funding: entity.funding * 100 + '%',
          condition: entity.condition,
          output: entity.output
        },
        needs: {
          power: entity.powered ? 'Connected' : 'No power',
          water: entity.watered ? 'Connected' : 'No water',
          workers: entity.workersNeeded - entity.workers
        },
        problems: entity.problems,
        actions: ['bulldoze', 'upgrade', 'funding']
      };
    }

    if (entity instanceof SoulZone) {
      return {
        ...base,
        stats: {
          density: ['Low', 'Medium', 'High'][entity.density - 1],
          wealth: ['Low', 'Medium', 'High'][entity.wealth - 1],
          population: entity.souls.length,
          buildings: entity.buildings.length,
          landValue: entity.landValue
        },
        demands: {
          residential: entity.demand,
          commercial: entity.demand,
          industrial: entity.demand
        },
        problems: entity.pollution > 20 ? ['Pollution'] : []
      };
    }
  }
}

// UI display
function showQueryPanel(info) {
  return `
    <div class="query-panel">
      <h3>${info.name}</h3>
      <div class="stats">
        ${Object.entries(info.stats).map(([k, v]) =>
          `<div><span>${k}:</span> ${v}</div>`
        ).join('')}
      </div>
      ${info.problems.length ? `
        <div class="problems">
          ${info.problems.map(p => `<span class="problem">⚠ ${p}</span>`).join('')}
        </div>
      ` : ''}
      <div class="actions">
        ${info.actions.map(a => `<button>${a}</button>`).join('')}
      </div>
    </div>
  `;
}
```

---

## 11. Key Implementation Recommendations

### Priority Order for SOULVERSE
1. **Zone System** - Core foundation; RCI + Spiritual zones
2. **Road/Pathfinding** - Traffic affects everything
3. **Needs/Happiness** - Drive all city growth
4. **Budget/Taxes** - Financial balance
5. **Services** - Healthcare, education, safety, spiritual
6. **Disasters** - Drama and challenge
7. **Advisors** - Guidance system
8. **Milestones** - Progression rewards
9. **Query Tool** - Information access
10. **Cheats/Debug** - Sandbox fun

### SOULVERSE Unique Features
- **Spiritual Zone**: Temples, shrines increase happiness and land value
- **Soul Metrics**: Track "spiritual health" alongside regular needs
- **Ascension Mechanic**: At Megalopolis, souls can "ascend" (win condition)
- **Prophet Events**: Unique disasters/bonuses from high spiritual stats
- **Soul Network**: Similar to SimCity region play, but for soul cities

### Quick Reference: Building Costs

| Building | Cost | Maintenance | Population |
|----------|------|-------------|------------|
| Road (per tile) | 10 | 1 | 0 |
| Power Plant | 500 | 50 | 0 |
| Water Pump | 200 | 20 | 0 |
| House (R) | 100 | 5 | 5 |
| Shop (C) | 200 | 10 | 3 |
| Factory (I) | 500 | 30 | 10 |
| School | 300 | 30 | 0 |
| Hospital | 800 | 80 | 0 |
| Shrine | 100 | 10 | 0 |
| Temple | 500 | 50 | 0 |

---

*Research completed: 2026-05-15*
*For SOULVERSE Soul Universe implementation*