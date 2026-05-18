const fs = require('fs');
const path = require('path');

// Pollinations.ai — free image generation, no API key needed
const BASE = 'https://gen.pollinations.ai/image';

const PRODUCTS = [
  {
    name: 'BUYASOUL_v1',
    file: 'buyasoul-v1.png',
    prompt: `a futuristic glowing digital soul orb floating in cyberspace, neon purple and blue, ethereal energy particles, 3D render style, cinematic lighting, dark background, high quality`  
  },
  {
    name: 'Soulverse_3D_World',
    file: 'soulverse-3d-city.png',
    prompt: `bird's eye view of a futuristic 3D city with glowing neon buildings arranged in a grid, nine distinct districts each with different colors, cyberpunk aesthetic, digital art, vibrant, game engine render`  
  },
  {
    name: 'Cyberpunk_Habitat',
    file: 'cyberpunk-habitat.png',
    prompt: `cyberpunk city street at night with neon signs, rain-slicked pavement, holographic billboards, flying cars, purple and pink lighting, blade runner aesthetic, 3D render`  
  },
  {
    name: 'Fantasy_Forest_Habitat',
    file: 'fantasy-forest.png',
    prompt: `enchanted forest with giant glowing mushrooms, ancient trees with blue fireflies, mystical ruins, ethereal green and purple lighting, fantasy art style, 3D render`  
  },
  {
    name: 'Space_Station_Habitat',
    file: 'space-station.png',
    prompt: `orbital space station interior with large windows showing earth and stars, metallic corridors, blue holographic displays, zero gravity, sci-fi, 3D render`  
  },
  {
    name: 'Underwater_Habitat',
    file: 'underwater-city.png',
    prompt: `underwater city with glass domes, coral reef architecture, bioluminescent sea creatures swimming between buildings, deep blue water, sun rays piercing from above, 3D render`  
  },
  {
    name: 'Desert_Oasis_Habitat',
    file: 'desert-oasis.png',
    prompt: `golden desert city with terracotta buildings, palm trees, grand oasis in center, warm sunset lighting, arabian architecture, sand dunes in background, 3D render`  
  },
  {
    name: 'BUYASOUL_v2',
    file: 'buyasoul-v2.png',
    prompt: `ancient glowing book of consciousness floating in void, pages turning revealing light, golden and purple energy, mystical knowledge theme, 3D render, cinematic`  
  },
  {
    name: 'Mega_Kernel_SDK',
    file: 'mega-kernel-sdk.png',
    prompt: `complex neural network visualization with connected glowing nodes, digital brain, artificial intelligence concept, dark background with blue and gold circuitry, 3D render`  
  },
  {
    name: 'Bundle_Pack',
    file: 'bundle-pack.png',
    prompt: `collection of digital products floating in space: glowing orbs, 3D cities, neural networks, mystical books, bundle deal concept, neon lighting, 3D render, marketplace style`  
  }
];

const OUTPUT_DIR = path.join(__dirname, 'gumroad_products', 'images');

async function generateImage(product) {
  const url = `${BASE}/${encodeURIComponent(product.prompt)}?width=1024&height=1024&seed=${Math.floor(Math.random() * 99999)}`;
  
  console.log(`  Generating ${product.name}...`);
  
  try {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, { 
          signal: AbortSignal.timeout(60000),
          headers: { 'Accept': 'image/*' }
        });
        
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        
        const buffer = Buffer.from(await res.arrayBuffer());
        const filePath = path.join(OUTPUT_DIR, product.file);
        fs.writeFileSync(filePath, buffer);
        
        const sizeKB = Math.round(buffer.length / 1024);
        console.log(`    ✅ ${product.file} (${sizeKB}KB)`);
        return { success: true, path: filePath, sizeKB };
      } catch (attemptErr) {
        if (attempt < maxRetries) {
          const wait = attempt * 3000;
          console.log(`    ⚠️ Attempt ${attempt} failed, retrying in ${wait/1000}s... (${attemptErr.message})`);
          await new Promise(r => setTimeout(r, wait));
        } else {
          throw attemptErr;
        }
      }
    }
  } catch (e) {
    console.log(`    ❌ Failed after ${maxRetries} attempts: ${e.message}`);
    return { success: false, error: e.message };
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   GUMROAD IMAGE GENERATOR v1            ║');
  console.log('║   Pollinations.ai — Free, no API key     ║');
  console.log('╚══════════════════════════════════════════╝\n');

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const results = [];
  for (const product of PRODUCTS) {
    const result = await generateImage(product);
    results.push({ ...product, ...result });
    // Rate limiting - wait between requests
    if (PRODUCTS.indexOf(product) < PRODUCTS.length - 1) {
      console.log('  Waiting 2s between requests...\n');
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   GENERATION COMPLETE                   ║');
  console.log('╚══════════════════════════════════════════╝\n');
  
  const succeeded = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  if (succeeded.length > 0) {
    console.log('✅ Generated product images:');
    for (const r of succeeded) {
      console.log(`  • ${r.name} → ${path.relative(OUTPUT_DIR, r.path)}`);
    }
  }
  if (failed.length > 0) {
    console.log('\n❌ Failed:');
    for (const r of failed) {
      console.log(`  • ${r.name}: ${r.error}`);
    }
  }
  
  console.log(`\nTotal: ${succeeded.length}/${results.length} images generated`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log('\n💡 Tip: You can run this anytime to regenerate images');
}

main().catch(e => console.error('Fatal:', e.message));
