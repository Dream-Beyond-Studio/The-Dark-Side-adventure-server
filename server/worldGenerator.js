const { CHUNK_SIZE, MAP_HEIGHT, SEA_LEVEL } = require('./serverConfig');

function pseudoRandom(x, y) {
    let n = x * 331 + y * 439; n = Math.sin(n) * 12345.6789;
    return n - Math.floor(n);
}

function getTerrainHeight(worldX, dimension = 'earth') {
    if (dimension === 'moon') {
        return Math.floor(80 + Math.sin(worldX * 0.1) * 4 + Math.sin(worldX * 0.02) * 8);
    }
    let h = 30 + Math.sin(worldX * 0.1) * 8 + Math.sin(worldX * 0.05) * 12 + 5;
    const oceanNoise = Math.sin(worldX * 0.02);
    if (oceanNoise > 0.4) h += (oceanNoise - 0.4) * 50;
    return Math.floor(h);
}

function isCave(x, y) {
    const val = Math.sin(x / 15) * Math.cos(y / 15) + Math.sin((x + y) / 30) * 0.5;
    const depthFactor = Math.min(1, Math.max(0, (y - 30) / 70));
    const threshold = 0.65 - (depthFactor * 0.25);
    return val > threshold;
}

function createTree(chunkData, localX, groundY, worldX) {
    const hRand = pseudoRandom(worldX, groundY);
    const treeHeight = Math.floor(hRand * 3) + 4;

    for (let i = 1; i <= treeHeight; i++) {
        const trunkY = groundY - i;
        if (trunkY >= 0 && trunkY < MAP_HEIGHT) chunkData[trunkY][localX] = 3;
    }

    const topY = groundY - treeHeight;
    for (let ly = topY - 2; ly <= topY + 1; ly++) {
        for (let lx = localX - 2; lx <= localX + 2; lx++) {
            const dx = Math.abs(lx - localX);
            const dy = ly - topY;
            if (dx === 2 && dy === -2) continue;
            if (dx === 2 && dy === 1) continue;
            if (lx >= 0 && lx < CHUNK_SIZE && ly >= 0 && ly < MAP_HEIGHT) {
                if (chunkData[ly][lx] !== 3) chunkData[ly][lx] = 4;
            }
        }
    }
}

function spawnVein(chunkData, centerX, centerY, oreID, worldX) {
    const positions = [{x:0,y:0}, {x:1,y:0}, {x:-1,y:0}, {x:0,y:1}, {x:0,y:-1}];
    for (let pos of positions) {
        if (pseudoRandom(worldX + pos.x, centerY + pos.y) > 0.3) {
            const tx = centerX + pos.x;
            const ty = centerY + pos.y;
            if (tx >= 0 && tx < CHUNK_SIZE && ty >= 0 && ty < MAP_HEIGHT) {
                if (chunkData[ty][tx] === 5) chunkData[ty][tx] = oreID;
            }
        }
    }
}

function generateChunkData(chunkX, dimension = 'earth') {
    const chunkData = [];
    for (let y = 0; y < MAP_HEIGHT; y++) chunkData[y] = new Array(CHUNK_SIZE).fill(0);

    const isMoon = dimension === 'moon';

    for (let x = 0; x < CHUNK_SIZE; x++) {
        const worldX = chunkX * CHUNK_SIZE + x;
        const surfaceY = getTerrainHeight(worldX, dimension);

        for (let y = 0; y < MAP_HEIGHT; y++) {
            if (y >= MAP_HEIGHT - 3) { chunkData[y][x] = 99; continue; }

            if (isMoon) {
                if (y < surfaceY) chunkData[y][x] = 0;
                else chunkData[y][x] = 5; 
                continue;
            }

            const cave = isCave(worldX, y);

            if (y < surfaceY) {
                if (y >= SEA_LEVEL) chunkData[y][x] = 12; else chunkData[y][x] = 0;
            }
            else if (y === surfaceY) {
                 if (y >= SEA_LEVEL) chunkData[y][x] = 2;
                 else {
                     if (cave) { chunkData[y][x] = 0; }
                     else { chunkData[y][x] = 1; }
                 }
            }
            else {
                if (cave) {
                    if (y > 105) chunkData[y][x] = 12; else chunkData[y][x] = 0;
                }
                else {
                    chunkData[y][x] = (y < surfaceY + 8) ? 2 : 5;
                }
            }
        }
    }

    if (!isMoon) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
            const worldX = chunkX * CHUNK_SIZE + x;
            const surfaceY = getTerrainHeight(worldX, 'earth');

            if (chunkData[surfaceY] && chunkData[surfaceY][x] === 1) {
                if (x >= 3 && x <= CHUNK_SIZE - 4 && pseudoRandom(worldX, surfaceY) < 0.08) {
                    createTree(chunkData, x, surfaceY, worldX);
                }
            }

            for (let y = 0; y < MAP_HEIGHT; y++) {
                if (chunkData[y][x] === 5) {
                    const rand = pseudoRandom(worldX, y);
                    if (rand < 0.05) {
                        let oreID = 6;
                        if (y > 60 && rand < 0.004) oreID = 9;
                        else if (y > 50 && rand < 0.01) oreID = 8;
                        else if (y > 40 && rand < 0.02) oreID = 7;
                        spawnVein(chunkData, x, y, oreID, worldX);
                    }
                }
            }
        }
    }

    return chunkData;
}

module.exports = { generateChunkData, getTerrainHeight };