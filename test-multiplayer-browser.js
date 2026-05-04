// Automated browser test for multiplayer car visibility
// This script uses Playwright to test if cars are visible to each other

import { chromium } from 'playwright';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testMultiplayerVisibility() {
  console.log('🚀 Starting multiplayer visibility test...\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // Create two browser contexts (like two separate users)
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();

    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    // Prevent pages from closing on errors
    hostPage.on('crash', () => console.error('🔴 HOST page crashed'));
    guestPage.on('crash', () => console.error('🟢 GUEST page crashed'));
    hostPage.on('pageerror', err => console.error('🔴 HOST error:', err.message));
    guestPage.on('pageerror', err => console.error('🟢 GUEST error:', err.message));

    // Enable console logging from both pages
    hostPage.on('console', msg => {
      const text = msg.text();
      if (text.includes('[HOST]') || text.includes('snapshot') || text.includes('opponent') || text.includes('guest vehicle')) {
        console.log(`🔴 HOST: ${text}`);
      }
    });

    guestPage.on('console', msg => {
      const text = msg.text();
      if (text.includes('[GUEST]') || text.includes('snapshot') || text.includes('opponent') || text.includes('Creating')) {
        console.log(`🟢 GUEST: ${text}`);
      }
    });

    console.log('📱 Opening host window...');
    await hostPage.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
    await sleep(3000);

    console.log('📱 Opening guest window...');
    await guestPage.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
    await sleep(3000);

    // Check if pages loaded correctly
    const hostTitle = await hostPage.title();
    const guestTitle = await guestPage.title();
    console.log('🔴 HOST page title:', hostTitle);
    console.log('🟢 GUEST page title:', guestTitle);

    // HOST: Create room
    console.log('\n🔴 HOST: Clicking Multiplayer button...');
    await hostPage.waitForSelector('text=Multiplayer', { timeout: 10000 });
    await hostPage.click('text=Multiplayer');
    await sleep(1000);

    console.log('🔴 HOST: Clicking Create Room button...');
    await hostPage.waitForSelector('text=Create Room', { timeout: 10000 });
    await hostPage.click('text=Create Room');
    await sleep(2000);

    // Get room code - try multiple selectors
    const roomCode = await hostPage.evaluate(() => {
      // Try different ways to find the room code
      let code = null;

      // Method 1: data attribute
      const codeElement = document.querySelector('[data-room-code]');
      if (codeElement) {
        code = codeElement.textContent;
      }

      // Method 2: look for text containing room code pattern
      if (!code) {
        const allText = document.body.innerText;
        const match = allText.match(/Room Code:\s*([A-Z0-9]{6})/i) || allText.match(/([A-Z0-9]{6})/);
        if (match) {
          code = match[1];
        }
      }

      return code;
    });

    if (!roomCode) {
      console.error('❌ Failed to get room code');
      return false;
    }

    console.log(`🔑 Room code: ${roomCode}`);

    // GUEST: Join room
    console.log('\n🟢 GUEST: Joining room...');
    await guestPage.click('text=Multiplayer');
    await sleep(500);
    await guestPage.click('text=Join Room');
    await sleep(500);
    await guestPage.fill('input[type="text"]', roomCode);
    await guestPage.click('text=Join');
    await sleep(2000);

    // HOST: Start race
    console.log('\n🔴 HOST: Starting race...');
    await hostPage.click('text=Start Race');
    await sleep(3000);

    console.log('\n⏳ Waiting for game to initialize...');
    await sleep(5000);

    // Check debug overlay on both pages
    console.log('\n🔍 Checking debug overlays...');

    const hostDebugInfo = await hostPage.evaluate(() => {
      const overlay = document.querySelector('div[style*="position: fixed"][style*="top: 10px"]');
      if (!overlay) return null;

      const text = overlay.textContent;
      const snapshotMatch = text.match(/Snapshots sent: (\d+)/);
      const guestCountMatch = text.match(/Guest vehicles: (\d+)/);

      return {
        found: true,
        snapshotsSent: snapshotMatch ? parseInt(snapshotMatch[1]) : 0,
        guestCount: guestCountMatch ? parseInt(guestCountMatch[1]) : 0,
        fullText: text
      };
    });

    const guestDebugInfo = await guestPage.evaluate(() => {
      const overlay = document.querySelector('div[style*="position: fixed"][style*="top: 10px"]');
      if (!overlay) return null;

      const text = overlay.textContent;
      const snapshotMatch = text.match(/Snapshots received: (\d+)/);
      const opponentMatch = text.match(/Opponent meshes: (\d+)/);

      return {
        found: true,
        snapshotsReceived: snapshotMatch ? parseInt(snapshotMatch[1]) : 0,
        opponentCount: opponentMatch ? parseInt(opponentMatch[1]) : 0,
        fullText: text
      };
    });

    console.log('\n📊 HOST Debug Info:', hostDebugInfo);
    console.log('📊 GUEST Debug Info:', guestDebugInfo);

    // Check scene objects
    console.log('\n🎨 Checking scene objects...');

    const hostSceneInfo = await hostPage.evaluate(() => {
      // Access Three.js scene through window
      const scene = window.__THREE_SCENE__;
      if (!scene) return { error: 'Scene not found' };

      const carMeshes = [];
      scene.traverse((obj) => {
        if (obj.name && obj.name.includes('car')) {
          carMeshes.push({
            name: obj.name,
            position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
            visible: obj.visible
          });
        }
      });

      return {
        totalChildren: scene.children.length,
        carMeshes: carMeshes.length,
        cars: carMeshes
      };
    });

    const guestSceneInfo = await guestPage.evaluate(() => {
      const scene = window.__THREE_SCENE__;
      if (!scene) return { error: 'Scene not found' };

      const carMeshes = [];
      scene.traverse((obj) => {
        if (obj.name && obj.name.includes('car')) {
          carMeshes.push({
            name: obj.name,
            position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
            visible: obj.visible
          });
        }
      });

      return {
        totalChildren: scene.children.length,
        carMeshes: carMeshes.length,
        cars: carMeshes
      };
    });

    console.log('🔴 HOST Scene:', hostSceneInfo);
    console.log('🟢 GUEST Scene:', guestSceneInfo);

    // Verify results
    console.log('\n✅ TEST RESULTS:');
    let allPassed = true;

    if (!hostDebugInfo || !hostDebugInfo.found) {
      console.log('❌ Host debug overlay not found');
      allPassed = false;
    } else if (hostDebugInfo.snapshotsSent === 0) {
      console.log('❌ Host is not sending snapshots');
      allPassed = false;
    } else if (hostDebugInfo.guestCount === 0) {
      console.log('❌ Host has no guest vehicles');
      allPassed = false;
    } else {
      console.log(`✅ Host: ${hostDebugInfo.snapshotsSent} snapshots sent, ${hostDebugInfo.guestCount} guest vehicles`);
    }

    if (!guestDebugInfo || !guestDebugInfo.found) {
      console.log('❌ Guest debug overlay not found');
      allPassed = false;
    } else if (guestDebugInfo.snapshotsReceived === 0) {
      console.log('❌ Guest is not receiving snapshots');
      allPassed = false;
    } else if (guestDebugInfo.opponentCount === 0) {
      console.log('❌ Guest has no opponent meshes');
      allPassed = false;
    } else {
      console.log(`✅ Guest: ${guestDebugInfo.snapshotsReceived} snapshots received, ${guestDebugInfo.opponentCount} opponent meshes`);
    }

    console.log('\n⏳ Keeping browsers open for 30 seconds for manual inspection...');
    await sleep(30000);

    return allPassed;

  } catch (error) {
    console.error('❌ Test failed with error:', error);
    return false;
  } finally {
    await browser.close();
  }
}

// Run the test
testMultiplayerVisibility()
  .then(success => {
    if (success) {
      console.log('\n✅ All tests passed!');
      process.exit(0);
    } else {
      console.log('\n❌ Some tests failed');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
