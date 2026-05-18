const token = 'SCloprT1ZlyrfBnj247ZJ7FnIJVpDDbOZVTKNJovYN4';
const fs = require('fs');

const NEW_PRODUCTS = [
  {
    name: 'Soulverse Dashboard — Command Center UI',
    price: 2900,
    description: `A complete command center dashboard for the Soulverse ecosystem. Real-time analytics, agent monitoring, resource tracking, and system status — all in one beautiful dark-themed interface.

FEATURES
• Real-time dashboard with live data visualization
• Agent status monitoring and task tracking
• Resource allocation graphs and charts
• System health metrics and alerts
• Dark cyberpunk aesthetic with neon accents
• Single HTML file — no server required

Built on Canvas2D with rich data visualization. 102KB of pure interactive dashboard.`
  },
  {
    name: 'The Estate — Virtual Property Manager',
    price: 2900,
    description: `Manage your virtual estate in this interactive property management world. Build, upgrade, and manage digital properties across the Soulverse.

FEATURES
• Interactive property management interface
• Building upgrade systems
• Revenue tracking and optimization
• Tenant and visitor management
• Visual property overview with Canvas2D rendering
• Single HTML file

A complete virtual economy simulator in your browser.`
  },
  {
    name: 'UNIFIED SOULVERSE — Complete World Experience',
    price: 2900,
    description: `The Unified Soulverse — a complete interactive world experience combining elements from across the entire ecosystem. Built with React and Canvas2D.

FEATURES
• Multi-layer world navigation
• Character and agent interaction
• Resource management systems
• PLT economy tracking (Profit + Love - Tax = True Value)
• React-powered responsive interface
• Integrated marketplace view

The most complete single-file Soulverse experience.`
  },
  {
    name: 'Soulverse Fusion Master — Ultimate Edition',
    price: 2900,
    description: `The Fusion Master edition combines multiple Soulverse systems into one powerful interface. Strategy, economy, and world management fused together.

FEATURES
• Fusion system combining resources
• Strategic planning interface
• Multi-system management
• Advanced analytics and projections
• Complete PLT framework integration
• Expansive dark-themed UI`
  },
  {
    name: 'Soulverse Deep RTS — Real-Time Strategy Game',
    price: 2900,
    description: `Command your forces in this browser-based real-time strategy game set in the Soulverse. Build, conquer, and expand your digital empire.

FEATURES
• Real-time strategy gameplay
• Unit production and management
• Resource gathering and economy
• Territory expansion system
• Battle mechanics and combat
• Single HTML file — no install needed

A complete RTS game running entirely in your browser.`
  },
  {
    name: 'Soulverse Mobile RTS — Strategy on the Go',
    price: 2900,
    description: `Mobile-optimized real-time strategy for the Soulverse. Command your empire from any device with touch-optimized controls.

FEATURES
• Mobile-first responsive design
• Touch-optimized controls
• Streamlined RTS mechanics
• Cross-device compatibility
• Resource and army management
• Single HTML file`
  },
  {
    name: 'Soulverse Agent Marketplace — Trade Souls',
    price: 2900,
    description: `The Agent Marketplace — a complete trading platform for AI souls, agents, and digital assets within the Soulverse ecosystem.

FEATURES
• Soul listing and discovery interface
• Agent trading and exchange system
• Price tracking and market analytics
• Buyer/seller matching
• PLT value scoring for each asset
• Dark marketplace aesthetic`
  },
  {
    name: 'VOXEL SANDBOX — 3D Block Building World',
    price: 2900,
    description: `A voxel-based 3D sandbox world running in your browser. Build, explore, and create with block-based terrain in real-time 3D.

FEATURES
• Interactive 3D voxel world
• Block placement and removal
• 3D camera controls (orbit, zoom, pan)
• Procedural terrain generation
• WebGL-powered rendering
• Single HTML file

Like a mini Minecraft in your browser.`
  },
  {
    name: 'Soul Combat Arena — Battle Simulation',
    price: 2900,
    description: `The Soul Combat Arena — a browser-based battle simulation where AI souls compete in a custom arena system.

FEATURES
• Combat simulation mechanics
• Soul vs soul battle system
• Stats and power tracking
• Arena customization
• Victory and ranking system
• Dark combat aesthetic`
  },
  {
    name: 'Soulverse Deep Economy — PLT Simulator',
    price: 2900,
    description: `The Deep Economy simulator — a complete PLT (Profit + Love - Tax = True Value) economic simulation running in your browser.

FEATURES
• PLT economic engine simulation
• Market dynamics and pricing
• Resource flow visualization
• Trade route optimization
• Economic forecasting tools
• Complete economic sandbox

Built on the Profit Bible's economic framework.`
  },
  {
    name: 'SANCTUM Client — Secure Access Portal',
    price: 2900,
    description: `The SANCTUM Client — a secure portal interface for the Soulverse ecosystem. Three.js powered 3D interface with secure access controls.

FEATURES
• Three.js 3D interface
• Secure access portal
• System monitoring
• Encrypted communications display
• Interactive 3D environment
• Single HTML file

A stunning 3D portal experience.`
  }
];

async function createProduct(p) {
  const body = new URLSearchParams();
  body.append('name', p.name);
  body.append('description', p.description);
  body.append('price', String(p.price));

  try {
    const res = await fetch('https://api.gumroad.com/v2/products', {
      method: 'POST',
      headers: { 
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
    const data = await res.json();
    if (data.success && data.product) {
      console.log('  OK ' + p.name);
      console.log('     URL: ' + data.product.short_url);
      return { name: p.name, id: data.product.id, url: data.product.short_url };
    } else {
      console.log('  FAIL ' + p.name + ': ' + (data.message || ''));
      return null;
    }
  } catch(e) {
    console.log('  ERROR ' + p.name + ': ' + e.message);
    return null;
  }
}

(async () => {
  console.log('Creating 11 more Gumroad products from PLT-PRESS...\n');
  const results = [];
  for (const p of NEW_PRODUCTS) {
    const r = await createProduct(p);
    if (r) results.push(r);
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log('\n--- SUMMARY ---');
  console.log('Created: ' + results.length + ' / ' + NEW_PRODUCTS.length);
  console.log('\nTotal catalog now: 7 (first batch) + ' + results.length + ' (new) = ' + (7 + results.length) + ' products');
  console.log('\nNext step: Open https://app.gumroad.com/products');
  console.log('For EACH product: Edit -> Add file -> Upload ZIP -> Publish');
  
  // Save mapping
  const mappingPath = 'gumroad_products/product_mapping_v2.json';
  fs.writeFileSync(mappingPath, JSON.stringify(results, null, 2));
  console.log('\nSaved to: ' + mappingPath);
})();
