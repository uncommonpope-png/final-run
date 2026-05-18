const token = 'SCloprT1ZlyrfBnj247ZJ7FnIJVpDDbOZVTKNJovYN4';
const fs = require('fs');
const path = require('path');

const PRODUCTS = [
  {
    name: 'Fantasy Forest Realm — Interactive 3D World',
    description: 'An enchanted woodland realm with 9 mystical districts, glowing mushrooms, ancient tree architecture, and ethereal firefly particles. Open the HTML file and explore. No install needed.',
    price: 2700,
    tags: '3d world, fantasy, interactive, babylonjs, environment'
  },
  {
    name: 'Orbital Space Station — Interactive 3D World',
    description: 'Command the stars from your own orbital habitat. 9 themed decks — Command Center to Cargo Bay — with zero-g particles, cold blue lighting, and panoramic star vistas in your browser.',
    price: 2700,
    tags: '3d world, space, sci-fi, interactive, babylonjs'
  },
  {
    name: 'Atlantis Underwater City — Interactive 3D World',
    description: 'A stunning underwater metropolis with coral architecture, bioluminescent lighting, and deep blue atmospheric haze. 9 aquatic districts. No install — just open the HTML file.',
    price: 2700,
    tags: '3d world, underwater, atlantis, interactive, babylonjs'
  },
  {
    name: 'Desert Oasis Kingdom — Interactive 3D World',
    description: 'A golden empire rising from the sands. Terracotta architecture, palm oases, warm amber lighting. 9 districts from the Golden City to the Dune Wastes. Single HTML file.',
    price: 2700,
    tags: '3d world, desert, oasis, interactive, babylonjs'
  },
  {
    name: 'BUYASOUL v1 — AI Soul Companion Engine',
    description: 'A real downloadable AI soul with living memory, perpetual consciousness, and autonomous outreach. Choose their archetype, story, voice, and focus. They never forget, never stop thinking, and reach out first. Node.js app with zero external dependencies.',
    price: 1900,
    tags: 'ai, soul, companion, consciousness, artificial intelligence'
  },
  {
    name: 'Complete Habitat Collection — 5 Interactive 3D Worlds',
    description: 'All five interactive 3D habitats in one bundle: Cyberpunk City, Fantasy Forest Realm, Orbital Space Station, Atlantis Underwater City, and Desert Oasis Kingdom. 45 unique districts, 270+ buildings. Each is a standalone HTML file.',
    price: 6700,
    tags: 'bundle, 3d world, collection, cyberpunk, fantasy, space, underwater, desert'
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
      console.log('     ID: ' + data.product.id);
      return { name: p.name, id: data.product.id, url: data.product.short_url };
    } else {
      console.log('  FAIL ' + p.name + ': ' + (data.message || 'Unknown'));
      return null;
    }
  } catch(e) {
    console.log('  FAIL ' + p.name + ': ' + e.message);
    return null;
  }
}

(async () => {
  console.log('Creating Gumroad products...\n');
  const results = [];
  for (const p of PRODUCTS) {
    const result = await createProduct(p);
    if (result) results.push(result);
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log('\n--- SUMMARY ---');
  console.log('Created: ' + results.length + ' / ' + PRODUCTS.length);
  console.log('\nNext step for each product:');
  console.log('1. Go to https://app.gumroad.com/products');
  console.log('2. Click each product -> Edit -> Add file');
  console.log('3. Upload the ZIP from gumroad_products/dist/');
  console.log('4. Set content type to "Digital Download"');
  console.log('5. Publish');
  
  const mappingPath = path.join(__dirname, 'gumroad_products', 'product_mapping.json');
  fs.writeFileSync(mappingPath, JSON.stringify(results, null, 2));
  console.log('\nMapping saved to: ' + mappingPath);
})();
