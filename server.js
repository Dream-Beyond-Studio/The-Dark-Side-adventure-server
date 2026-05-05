const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const path = require('path');
const readline = require('readline');

const { TILE_SIZE, CHUNK_SIZE, MAP_HEIGHT, DAY_DURATION, MOBS_CONFIG } = require('./server/serverConfig');
const { log, savePlayer, loadPlayer, saveAllPlayers } = require('./server/database');
const { generateChunkData, getTerrainHeight } = require('./server/worldGenerator');
const { applyPhysics, getTile } = require('./server/physics');

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let mobs = {};
let mobIdCounter = 0;
let gameTime = 4000;
let daysPassed = 0;

let wormholeTimer = 0;
let isWormholeActive = false;

let dimensions = {
    earth: { chunks: {}, worldChanges: {}, chunkQueue: new Set() },
    moon: { chunks: {}, worldChanges: {}, chunkQueue: new Set() }
};

let isUfoEventTriggered = false;
let eventAliensAlive = 0;
let ufoDoorUnlocked = false;
let moonUfoBuilt = false;

function ensureChunkExists(gridX, dim) {
    const chunkX = Math.floor(gridX / CHUNK_SIZE);
    if (!dimensions[dim].chunks[chunkX]) {
        const chunkData = generateChunkData(chunkX, dim);
        dimensions[dim].chunks[chunkX] = chunkData;
        io.emit('newChunk', { chunkX: chunkX, data: chunkData, dimension: dim });
    }
}

function getSurfaceGridY(gridX, dim) {
    ensureChunkExists(gridX, dim);
    for (let y = 0; y < MAP_HEIGHT; y++) {
        const t = getTile(gridX, y, dimensions[dim].chunks, dimensions[dim].worldChanges);
        if (t !== 0 && t !== 3 && t !== 4 && t !== 12 && t !== 99 && t !== undefined) {
            return y - 1;
        }
    }
    return 40;
}

function getSafeSpawnY(spawnX, entityWidth, dim = 'earth') {
    const gridX = Math.floor(spawnX / TILE_SIZE);
    const rightGridX = Math.floor((spawnX + entityWidth) / TILE_SIZE);
    let gridY = getTerrainHeight(gridX, dim);
    
    function isTileSolid(gx, gy) {
        const t = getTile(gx, gy, dimensions[dim].chunks, dimensions[dim].worldChanges);
        return !(t === 0 || t === 3 || t === 4 || t === 12 || t === 15 || t === 99);
    }

    while (gridY > 0 && (
        isTileSolid(gridX, gridY) || 
        isTileSolid(gridX, gridY - 1) ||
        isTileSolid(rightGridX, gridY) || 
        isTileSolid(rightGridX, gridY - 1)
    )) {
        gridY--;
    }
    return gridY * TILE_SIZE;
}

function takeDamage(playerId, amount) {
    let p = players[playerId];
    if (!p || p.isDead) return;

    p.hp -= amount;
    p.regenCooldown = 300;
    io.emit('damageText', { x: p.x + p.width/2, y: p.y - 10, dmg: amount, dimension: p.dimension });

    if (p.hp <= 0) {
        p.hp = 0;
        p.isDead = true;
        io.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: `${p.nick} zginął.` });
    }
}

function hasLineOfSight(entity1, entity2, chunks, worldChanges) {
    const x1 = entity1.x + entity1.width / 2;
    const y1 = entity1.y + entity1.height / 2;
    const x2 = entity2.x + entity2.width / 2;
    const y2 = entity2.y + entity2.height / 2;
    
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.ceil(dist / (TILE_SIZE / 2));
    
    for (let i = 0; i <= steps; i++) {
        const currentX = x1 + (x2 - x1) * (i / steps);
        const currentY = y1 + (y2 - y1) * (i / steps);
        const gridX = Math.floor(currentX / TILE_SIZE);
        const gridY = Math.floor(currentY / TILE_SIZE);
        const tile = getTile(gridX, gridY, chunks, worldChanges);
        
        if (tile !== 0 && tile !== 3 && tile !== 4 && tile !== 12 && tile !== 14 && tile !== 15 && tile !== 99) {
            return false;
        }
    }
    return true;
}

function spawnUfoStructure(gridX, gridY, dim) {
    for (let dx = -6; dx <= 6; dx++) {
        for (let dy = 2; dy >= -6; dy--) {
            dimensions[dim].worldChanges[`${gridX + dx},${gridY + dy}`] = 0;
            io.emit('blockUpdate', { x: gridX + dx, y: gridY + dy, type: 0, dimension: dim });
        }
    }

    const blocks = [
        {dx: 0, dy: 0, t: 14}, {dx: 0, dy: -1, t: 14}, 
        {dx: -2, dy: 0, t: 13}, {dx: 2, dy: 0, t: 13}, 
        {dx: -3, dy: -1, t: 13}, {dx: -2, dy: -1, t: 13}, {dx: -1, dy: -1, t: 13}, {dx: 1, dy: -1, t: 13}, {dx: 2, dy: -1, t: 13}, {dx: 3, dy: -1, t: 13},
        {dx: -5, dy: -2, t: 13}, {dx: -4, dy: -2, t: 13}, {dx: -3, dy: -2, t: 9}, {dx: -2, dy: -2, t: 13}, {dx: -1, dy: -2, t: 13}, {dx: 0, dy: -2, t: 13}, {dx: 1, dy: -2, t: 13}, {dx: 2, dy: -2, t: 13}, {dx: 3, dy: -2, t: 9}, {dx: 4, dy: -2, t: 13}, {dx: 5, dy: -2, t: 13},
        {dx: -3, dy: -3, t: 13}, {dx: -2, dy: -3, t: 13}, {dx: -1, dy: -3, t: 13}, {dx: 0, dy: -3, t: 13}, {dx: 1, dy: -3, t: 13}, {dx: 2, dy: -3, t: 13}, {dx: 3, dy: -3, t: 13},
        {dx: -1, dy: -4, t: 13}, {dx: 0, dy: -4, t: 13}, {dx: 1, dy: -4, t: 13}
    ];

    for (let b of blocks) {
        dimensions[dim].worldChanges[`${gridX + b.dx},${gridY + b.dy}`] = b.t;
        io.emit('blockUpdate', { x: gridX + b.dx, y: gridY + b.dy, type: b.t, dimension: dim });
    }
}

function triggerUfoEvent() {
    const playerIds = Object.keys(players).filter(id => players[id].dimension === 'earth');
    if (playerIds.length === 0) return;
    
    isUfoEventTriggered = true;
    const p = players[playerIds[Math.floor(Math.random() * playerIds.length)]];
    const spawnDirection = Math.random() < 0.5 ? -1 : 1;
    const spawnGridX = Math.floor(p.x / TILE_SIZE) + (spawnDirection * 15);
    const gridY = getSurfaceGridY(spawnGridX, 'earth');

    io.emit('chatMessage', { id: 'SYSTEM', nick: 'STORY', text: 'Czujniki wykryły potężną anomalię wchodzącą w atmosferę planety!' });
    io.emit('ufoCrash', { x: spawnGridX * TILE_SIZE, y: gridY * TILE_SIZE });

    setTimeout(() => {
        spawnUfoStructure(spawnGridX, gridY, 'earth');

        eventAliensAlive = 3;
        const offsets = [-200, 200, 280];
        
        for (let i = 0; i < 3; i++) {
            const id = mobIdCounter++;
            mobs[id] = {
                id: id, type: 'alien', dimension: 'earth',
                x: (spawnGridX * TILE_SIZE) + offsets[i], y: (gridY - 2) * TILE_SIZE,
                width: MOBS_CONFIG['alien'].width, height: MOBS_CONFIG['alien'].height,
                velX: 0, velY: 0, grounded: false, inWater: false, facingRight: true, timer: 0,
                hp: MOBS_CONFIG['alien'].maxHp, maxHp: MOBS_CONFIG['alien'].maxHp, isEventAlien: true
            };
        }
        io.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: 'Obcy statek wylądował i otworzył luki!' });
    }, 6000);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('line', (input) => {
    const parts = input.trim().split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    if (!cmd) return;
    switch(cmd) {
        case 'say':
            const text = args.join(' ');
            if (text) {
                io.emit('chatMessage', { id: 'SERVER', nick: '[CONSOLE]', text: text });
                log('CMD', text);
            }
            break;
        case 'stop':
            io.emit('chatMessage', { id: 'SERVER', nick: '[SERWER]', text: 'Zamykanie serwera...' });
            saveAllPlayers(players, () => {
                log('SYSTEM', 'STOP');
                process.exit(0);
            });
            break;
    }
});

setInterval(() => {
    for (let dim in dimensions) {
        if (dimensions[dim].chunkQueue.size > 0) {
            const chunkToGen = dimensions[dim].chunkQueue.values().next().value;
            if (!dimensions[dim].chunks[chunkToGen]) {
                const chunkData = generateChunkData(chunkToGen, dim);
                dimensions[dim].chunks[chunkToGen] = chunkData;
                io.emit('newChunk', { chunkX: chunkToGen, data: chunkData, dimension: dim });
            }
            dimensions[dim].chunkQueue.delete(chunkToGen);
        }
    }

    gameTime++;
    if (gameTime >= DAY_DURATION) {
        gameTime = 0;
        daysPassed++;
    }

    wormholeTimer++;
    if (wormholeTimer === 9000) {
        isWormholeActive = true;
        io.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: 'Księżyc zbliża się do tunelu czasoprzestrzennego. Okno portali zostało aktywowane!' });
    } else if (wormholeTimer >= 10000) {
        isWormholeActive = false;
        wormholeTimer = 0;
        io.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: 'Oddalamy się od anomalii. Portale zostały dezaktywowane i uśpione.' });
    }

    const progress = gameTime / DAY_DURATION;
    const isNight = progress > 0.8 || progress < 0.2;

    if (gameTime % 600 === 0) {
        saveAllPlayers(players);
    }

    const earthPlayerIds = Object.keys(players).filter(id => players[id].dimension === 'earth');
    const moonPlayerIds = Object.keys(players).filter(id => players[id].dimension === 'moon');

    if (isNight && !isUfoEventTriggered && daysPassed >= 1 && earthPlayerIds.length > 0) {
        triggerUfoEvent();
    }

    if (earthPlayerIds.length > 0 && Object.keys(mobs).filter(id => mobs[id].dimension === 'earth').length < 12) {
        if (Math.random() < 0.015) {
            const p = players[earthPlayerIds[Math.floor(Math.random() * earthPlayerIds.length)]];
            const chunkX = Math.floor(p.x / (CHUNK_SIZE * TILE_SIZE));

            if (dimensions['earth'].chunks[chunkX]) {
                const id = mobIdCounter++;
                let type = 'zombie';
                if (!isNight) {
                    const passives = ['cow', 'pig', 'sheep'];
                    type = passives[Math.floor(Math.random() * passives.length)];
                }
                
                const spawnDirection = Math.random() < 0.5 ? -1 : 1;
                const spawnDistance = 500 + Math.random() * 500;
                const spawnX = p.x + (spawnDirection * spawnDistance);
                const gridX = Math.floor(spawnX / TILE_SIZE);
                
                const gridY = getSurfaceGridY(gridX, 'earth');
                const spawnY = (gridY * TILE_SIZE) - MOBS_CONFIG[type].height;
                
                mobs[id] = { 
                    id: id, type: type, dimension: 'earth', x: spawnX, y: spawnY, 
                    width: MOBS_CONFIG[type].width, height: MOBS_CONFIG[type].height, 
                    velX: 0, velY: 0, grounded: false, inWater: false, facingRight: true, timer: 0,
                    hp: MOBS_CONFIG[type].maxHp, maxHp: MOBS_CONFIG[type].maxHp
                };
            }
        }
    }

    if (moonPlayerIds.length > 0 && Object.keys(mobs).filter(id => mobs[id].dimension === 'moon').length < 8) {
        if (Math.random() < 0.008) {
            const p = players[moonPlayerIds[Math.floor(Math.random() * moonPlayerIds.length)]];
            const chunkX = Math.floor(p.x / (CHUNK_SIZE * TILE_SIZE));

            if (dimensions['moon'].chunks[chunkX]) {
                const id = mobIdCounter++;
                let type = Math.random() < 0.5 ? 'alien' : 'crawler';
                
                const spawnDirection = Math.random() < 0.5 ? -1 : 1;
                const spawnDistance = 200 + Math.random() * 400;
                const spawnX = p.x + (spawnDirection * spawnDistance);
                const gridX = Math.floor(spawnX / TILE_SIZE);
                
                let spawnY = -1;
                const surfaceY = getSurfaceGridY(gridX, 'moon');
                
                if (Math.random() < 0.6) {
                    for (let y = surfaceY + 2; y < MAP_HEIGHT - 2; y++) {
                        const t1 = getTile(gridX, y, dimensions['moon'].chunks, dimensions['moon'].worldChanges);
                        const t2 = getTile(gridX, y + 1, dimensions['moon'].chunks, dimensions['moon'].worldChanges);
                        if (t1 === 0 && t2 !== 0 && t2 !== 99) {
                            spawnY = (y * TILE_SIZE) - MOBS_CONFIG[type].height;
                            break;
                        }
                    }
                }

                if (spawnY === -1) {
                    spawnY = (surfaceY * TILE_SIZE) - MOBS_CONFIG[type].height;
                }
                
                mobs[id] = { 
                    id: id, type: type, dimension: 'moon', x: spawnX, y: spawnY, 
                    width: MOBS_CONFIG[type].width, height: MOBS_CONFIG[type].height, 
                    velX: 0, velY: 0, grounded: false, inWater: false, facingRight: true, timer: 0,
                    hp: MOBS_CONFIG[type].maxHp, maxHp: MOBS_CONFIG[type].maxHp
                };
            }
        }
    }

    for (let id in mobs) {
        let m = mobs[id];
        const config = MOBS_CONFIG[m.type];
        const speed = m.inWater ? config.speed * 0.5 : config.speed;

        if (m.type === 'zombie' || m.type === 'alien' || m.type === 'crawler') {
            if (m.type === 'zombie' && !isNight && m.dimension === 'earth') {
                if (gameTime % 30 === 0) {
                    m.hp -= 10;
                    io.emit('damageText', { x: m.x + m.width/2, y: m.y - 10, dmg: 10, dimension: m.dimension });
                }
                if (m.hp <= 0) {
                    delete mobs[id];
                    continue;
                }
            }

            let closestPlayer = null;
            let minDistance = 600;

            for (let pid in players) {
                let p = players[pid];
                if (p.isDead || p.isFlying || p.dimension !== m.dimension) continue;
                let dist = Math.hypot(p.x - m.x, p.y - m.y);
                if (dist < minDistance) {
                    minDistance = dist;
                    closestPlayer = p;
                }
            }

            if (closestPlayer) {
                if (closestPlayer.x < m.x) {
                    m.velX = -speed;
                    m.facingRight = false;
                } else {
                    m.velX = speed;
                    m.facingRight = true;
                }

                let canSeePlayer = false;
                if ((m.type === 'alien' || m.type === 'crawler') && minDistance < 350) {
                    canSeePlayer = hasLineOfSight(m, closestPlayer, dimensions[m.dimension].chunks, dimensions[m.dimension].worldChanges);
                }

                if ((m.type === 'alien' || m.type === 'crawler') && minDistance < 350 && minDistance > 50 && m.timer <= 0 && canSeePlayer) {
                    m.velX = 0;
                    io.emit('playerShoot', { x1: m.x + m.width/2, y1: m.y + 10, x2: closestPlayer.x + closestPlayer.width/2, y2: closestPlayer.y + closestPlayer.height/2, dimension: m.dimension, color: '#00FF00' });
                    takeDamage(closestPlayer.id, config.damage);
                    m.timer = 80;
                } else if (minDistance <= 50 && m.timer <= 0) {
                    takeDamage(closestPlayer.id, config.damage);
                    m.timer = 60; 
                }
            } else {
                m.velX = 0;
            }

            if (m.timer > 0) m.timer--;

        } else {
            if (isNight && m.dimension === 'earth') {
                delete mobs[id];
                continue;
            }

            m.timer--;
            if (m.timer <= 0) {
                m.timer = Math.floor(Math.random() * 100) + 50;
                const r = Math.random();
                if (r < 0.3) m.velX = 0; 
                else if (r < 0.6) { m.velX = speed; m.facingRight = true; } 
                else { m.velX = -speed; m.facingRight = false; }
            }
        }

        if (m.inWater) {
            m.velY = -2;
        } else {
            const frontX = m.velX > 0 ? m.x + m.width + 5 : m.x - 5;
            const tileLower = getTile(Math.floor(frontX / TILE_SIZE), Math.floor((m.y + m.height - 5) / TILE_SIZE), dimensions[m.dimension].chunks, dimensions[m.dimension].worldChanges);
            const tileUpper = getTile(Math.floor(frontX / TILE_SIZE), Math.floor((m.y + m.height - TILE_SIZE - 5) / TILE_SIZE), dimensions[m.dimension].chunks, dimensions[m.dimension].worldChanges);
            
            function isBlockSolid(t) { return !(t === 0 || t === 3 || t === 4 || t === 12 || t === 14 || t === 15 || t === 99); }
            if (m.velX !== 0 && m.grounded && (isBlockSolid(tileLower) || isBlockSolid(tileUpper))) {
                m.velY = config.jumpForce;
            }
        }

        applyPhysics(m, dimensions);
    }

    for (let id in players) {
        let p = players[id];

        if (p.isFlying) {
            p.flightTimer--;
            if (p.flightTimer <= 0) {
                p.isFlying = false;
                const destDim = p.flightDestination || 'earth';
                p.dimension = destDim;
                
                if (destDim === 'moon') {
                    const spawnGridX = 0;
                    const gridY = getSurfaceGridY(spawnGridX, 'moon');

                    if (!moonUfoBuilt) {
                        moonUfoBuilt = true;
                        spawnUfoStructure(spawnGridX, gridY, 'moon');
                    }
                    p.x = spawnGridX * TILE_SIZE;
                    p.y = (gridY - 1) * TILE_SIZE;
                } else {
                    const spawnGridX = Math.floor((Math.random() - 0.5) * 40);
                    const gridY = getSurfaceGridY(spawnGridX, 'earth');
                    p.x = spawnGridX * TILE_SIZE;
                    p.y = (gridY - 1) * TILE_SIZE;
                }

                p.velX = 0;
                p.velY = 0;

                const pChunkX = Math.floor(p.x / (CHUNK_SIZE * TILE_SIZE));
                for (let i = -2; i <= 2; i++) {
                    if (!dimensions[destDim].chunks[pChunkX + i]) {
                        dimensions[destDim].chunks[pChunkX + i] = generateChunkData(pChunkX + i, destDim);
                    }
                }

                io.to(id).emit('dimensionChange', { dimension: destDim });
                io.to(id).emit('initDimension', { 
                    dimension: destDim, 
                    chunks: dimensions[destDim].chunks, 
                    worldChanges: dimensions[destDim].worldChanges 
                });
                
                const txt = destDim === 'moon' ? 'Lot udany. Witaj na powierzchni Księżyca.' : 'Lądowanie zakończone. Witaj na Ziemi.';
                io.to(id).emit('chatMessage', { id: 'SYSTEM', nick: 'STORY', text: txt });
            }
            continue;
        }

        const speed = p.inWater ? 2.5 : 5;
        p.velX = 0;

        if (!p.isDead) {
            if (p.inWater) {
                p.air -= 0.2;
                if (p.air <= 0) {
                    p.air = 0;
                    if (gameTime % 30 === 0) takeDamage(id, 10);
                }
            } else {
                p.air += 1;
                if (p.air > p.maxAir) p.air = p.maxAir;
            }

            if (p.regenCooldown > 0) {
                p.regenCooldown--;
            } else if (p.hp < p.maxHp && gameTime % 30 === 0 && p.air > 0) {
                p.hp += 1;
            }

            if (p.inputs.left) p.velX = -speed;
            if (p.inputs.right) p.velX = speed;

            if (p.inputs.jump) {
                if (p.grounded) {
                    p.velY = -11;
                    p.grounded = false;
                }
                else if (p.inWater) {
                    if (!p.prevJump) p.velY = -6.5;
                    else if (p.velY > -2.5) p.velY -= 0.5;
                }
            }
        }
        p.prevJump = p.inputs.jump;

        applyPhysics(p, dimensions, takeDamage);

        const pChunkX = Math.floor(p.x / (CHUNK_SIZE * TILE_SIZE));
        for (let i = -2; i <= 2; i++) {
            if (!dimensions[p.dimension].chunks[pChunkX + i]) {
                dimensions[p.dimension].chunkQueue.add(pChunkX + i);
            }
        }
    }
}, 1000 / 60);

setInterval(() => {
    io.emit('gameState', { players, mobs, time: gameTime, wormhole: isWormholeActive });
}, 1000 / 20);

function handleCommand(socket, msg) {
    const parts = msg.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
        case 'nick':
            const newNick = args.join(' ').substring(0, 15);
            if (newNick && players[socket.id]) {
                const oldNick = players[socket.id].nick;
                if (oldNick !== "Gracz") savePlayer(oldNick, players[socket.id].x, players[socket.id].y, players[socket.id].dimension);
                players[socket.id].nick = newNick;
                io.emit('playerNickUpdate', { id: socket.id, nick: newNick });
                socket.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: `Zmieniono nick na ${newNick}` });
            }
            break;
        case 'tp':
            if (args.length >= 2 && players[socket.id]) {
                players[socket.id].x = parseInt(args[0]) * TILE_SIZE;
                players[socket.id].y = parseInt(args[1]) * TILE_SIZE;
                socket.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: 'Przeteleportowano.' });
            }
            break;
        case 'spawnufo':
            if (!isUfoEventTriggered) {
                triggerUfoEvent();
            } else {
                io.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: 'Statek UFO już został aktywowany.' });
            }
            break;
        case 'ufo':
            ufoDoorUnlocked = true;
            io.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: 'Zamek statku UFO został zresetowany mechanicznie.' });
            break;
        case 'moon':
            if(players[socket.id]) {
                players[socket.id].dimension = 'moon';
                const gridY = getSurfaceGridY(0, 'moon');
                if (!moonUfoBuilt) {
                    moonUfoBuilt = true;
                    spawnUfoStructure(0, gridY, 'moon');
                }
                players[socket.id].x = 0;
                players[socket.id].y = (gridY - 1) * TILE_SIZE;
                socket.emit('dimensionChange', { dimension: 'moon' });
                socket.emit('initDimension', { 
                    dimension: 'moon', 
                    chunks: dimensions['moon'].chunks, 
                    worldChanges: dimensions['moon'].worldChanges 
                });
                socket.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: 'Teleportacja zakończona.' });
            }
            break;
        case 'earth':
            if(players[socket.id]) {
                players[socket.id].dimension = 'earth';
                const spawnGridX = Math.floor((Math.random() - 0.5) * 40);
                const gridY = getSurfaceGridY(spawnGridX, 'earth');
                players[socket.id].x = spawnGridX * TILE_SIZE;
                players[socket.id].y = (gridY - 1) * TILE_SIZE;
                socket.emit('dimensionChange', { dimension: 'earth' });
                socket.emit('initDimension', { 
                    dimension: 'earth', 
                    chunks: dimensions['earth'].chunks, 
                    worldChanges: dimensions['earth'].worldChanges 
                });
                socket.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: 'Ewakuacja. Powrót na Ziemię udany.' });
            }
            break;
    }
}

io.on('connection', (socket) => {
    const spawnGridX = Math.floor((Math.random() - 0.5) * 40);
    const gridY = getSurfaceGridY(spawnGridX, 'earth');

    players[socket.id] = {
        id: socket.id, isPlayer: true, isDead: false, isFlying: false, flightTimer: 0, flightDestination: 'earth',
        dimension: 'earth', 
        hp: 100, maxHp: 100, air: 100, maxAir: 100,
        x: spawnGridX * TILE_SIZE, y: (gridY - 1) * TILE_SIZE, width: 20, height: 40, velX: 0, velY: 0, grounded: false, inWater: false,
        nick: "Gracz", color: '#' + Math.floor(Math.random()*16777215).toString(16),
        inputs: { left: false, right: false, jump: false },
        prevJump: false, regenCooldown: 0, characterClass: 'soldier'
    };

    socket.emit('initWorld', { 
        chunks: dimensions['earth'].chunks, 
        worldChanges: dimensions['earth'].worldChanges, 
        dayDuration: DAY_DURATION 
    });

    socket.on('setNick', (data) => {
        if (players[socket.id]) {
            const cleanNick = data.nick.substring(0, 15);
            players[socket.id].nick = cleanNick;
            players[socket.id].characterClass = data.characterClass || 'soldier';

            let storyText = 'Jesteś weteranem wojennym. Twoim głównym celem jest czysta eksterminacja.';
            if (data.characterClass === 'scientist') storyText = 'Jesteś naukowcem. Zbadaj dziwne minerały na tej planecie.';
            if (data.characterClass === 'engineer') storyText = 'Jesteś inżynierem. Skonstruuj bazę zdolną oprzeć się inwazji.';
            if (data.characterClass === 'scout') storyText = 'Jesteś zwiadowcą. Zbadaj teren i przetrwaj w nieznanym środowisku.';

            loadPlayer(cleanNick, (err, row) => {
                if (row) {
                    players[socket.id].x = row.x;
                    players[socket.id].y = row.y;
                    players[socket.id].dimension = row.dimension || 'earth';
                    
                    socket.emit('dimensionChange', { dimension: players[socket.id].dimension });
                    socket.emit('initDimension', { 
                        dimension: players[socket.id].dimension, 
                        chunks: dimensions[players[socket.id].dimension].chunks, 
                        worldChanges: dimensions[players[socket.id].dimension].worldChanges 
                    });

                    socket.emit('chatMessage', { id: 'SYSTEM', nick: 'STORY', text: storyText });
                    socket.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: `Witaj ponownie, ${cleanNick}!` });
                    socket.broadcast.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: `${cleanNick} powrócił do gry!` });
                } else {
                    socket.emit('chatMessage', { id: 'SYSTEM', nick: 'STORY', text: storyText });
                    io.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: `${cleanNick} dołączył do serwera!` });
                }
            });
        }
    });

    socket.on('interact', (data) => {
        if (players[socket.id] && !players[socket.id].isDead) {
            const dim = players[socket.id].dimension;
            const tile = getTile(data.x, data.y, dimensions[dim].chunks, dimensions[dim].worldChanges);
            
            if (tile === 14 && !players[socket.id].isFlying) {
                if (dim === 'earth') {
                    if (!ufoDoorUnlocked) {
                        socket.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: 'Drzwi są zapieczętowane z zewnątrz. Musisz pokonać wszystkie formy życia z tego statku!' });
                    } else {
                        players[socket.id].isFlying = true;
                        players[socket.id].flightTimer = 180; 
                        players[socket.id].flightDestination = 'moon';
                        socket.emit('chatMessage', { id: 'SYSTEM', nick: 'STORY', text: 'Inicjalizacja lotu...' });
                    }
                } else if (dim === 'moon') {
                    players[socket.id].isFlying = true;
                    players[socket.id].flightTimer = 180; 
                    players[socket.id].flightDestination = 'earth';
                    socket.emit('chatMessage', { id: 'SYSTEM', nick: 'STORY', text: 'Inicjalizacja powrotu...' });
                }
            } else if (tile === 15) {
                if (isWormholeActive) {
                    socket.emit('chatMessage', { id: 'SYSTEM', nick: 'PORTAL', text: 'Portal jest połączony z tunelem czasoprzestrzennym! Wymiary docelowe nie są jeszcze znane.' });
                } else {
                    socket.emit('chatMessage', { id: 'SYSTEM', nick: 'PORTAL', text: 'Brak zasilania. Tunel czasoprzestrzenny jest obecnie poza zasięgiem.' });
                }
            }
        }
    });

    socket.on('chatMessage', (msg) => {
        if (!msg) return;
        const cleanMsg = msg.trim().substring(0, 100);
        if (cleanMsg.startsWith('/')) handleCommand(socket, cleanMsg);
        else {
            const nick = players[socket.id] ? players[socket.id].nick : "Gracz";
            io.emit('chatMessage', { id: socket.id, nick: nick, text: cleanMsg });
        }
    });

    socket.on('input', (inputs) => {
        if (players[socket.id] && !players[socket.id].isDead) {
            players[socket.id].inputs = inputs;
        }
    });

    socket.on('respawn', () => {
        let p = players[socket.id];
        if (p && p.isDead) {
            p.hp = p.maxHp; p.air = p.maxAir;
            p.isDead = false; p.isFlying = false; p.flightTimer = 0;
            p.regenCooldown = 0; p.inputs = { left: false, right: false, jump: false };
            p.prevJump = false; 
            
            const currentDim = p.dimension;
            socket.emit('dimensionChange', { dimension: currentDim });
            
            const spawnGridX = Math.floor((Math.random() - 0.5) * 40);
            const gridY = getSurfaceGridY(spawnGridX, currentDim);
            p.x = spawnGridX * TILE_SIZE; 
            p.y = (gridY - 1) * TILE_SIZE;
            p.velY = 0; p.velX = 0; p.highestY = undefined;
        }
    });

    socket.on('shoot', (target) => {
        const shooter = players[socket.id];
        if (!shooter || shooter.isDead || shooter.isFlying) return;

        socket.broadcast.emit('playerShoot', { x1: shooter.x + shooter.width/2, y1: shooter.y + shooter.height/2, x2: target.x, y2: target.y, dimension: shooter.dimension, color: '#FF0000' });

        for (let id in mobs) {
            let m = mobs[id];
            if (m.dimension !== shooter.dimension) continue;
            if (target.x >= m.x && target.x <= m.x + m.width && target.y >= m.y && target.y <= m.y + m.height) {
                m.hp -= 25;
                io.emit('damageText', { x: m.x + m.width/2, y: m.y - 10, dmg: 25, dimension: m.dimension });
                if (m.hp <= 0) {
                    if (m.isEventAlien) {
                        eventAliensAlive--;
                        if (eventAliensAlive <= 0 && !ufoDoorUnlocked) {
                            ufoDoorUnlocked = true;
                            io.emit('chatMessage', { id: 'SYSTEM', nick: 'STORY', text: 'Zabezpieczenia padły. Kliknij na drzwi (PPM), aby wejść.' });
                        }
                    }
                    delete mobs[id];
                }
                break;
            }
        }

        for (let id in players) {
            if (id === socket.id) continue;
            let p = players[id];
            if (p.dimension !== shooter.dimension) continue;
            if (target.x >= p.x && target.x <= p.x + p.width && target.y >= p.y && target.y <= p.y + p.height && !p.isDead && !p.isFlying) {
                takeDamage(id, 25);
                break;
            }
        }
    });

    socket.on('blockUpdate', (data) => {
        const p = players[socket.id];
        if (p && (p.isDead || p.isFlying)) return;

        const { x, y, type } = data;
        const dim = p.dimension;
        const currentTile = getTile(x, y, dimensions[dim].chunks, dimensions[dim].worldChanges);
        if (currentTile === 99) return;
        if (type !== 0) {
            const isReplaceable = (currentTile === 0 || currentTile === 4 || currentTile === 12);
            if (!isReplaceable) return;
            function isSupport(t) { return t !== 0 && t !== 12 && t !== 4 && t !== 99 && t !== 14 && t !== 15; }
            if (!isSupport(getTile(x, y - 1, dimensions[dim].chunks, dimensions[dim].worldChanges)) && !isSupport(getTile(x, y + 1, dimensions[dim].chunks, dimensions[dim].worldChanges)) && !isSupport(getTile(x - 1, y, dimensions[dim].chunks, dimensions[dim].worldChanges)) && !isSupport(getTile(x + 1, y, dimensions[dim].chunks, dimensions[dim].worldChanges))) return;
        } else { if (currentTile === 0 || currentTile === 12) return; }

        dimensions[dim].worldChanges[`${x},${y}`] = type;
        io.emit('blockUpdate', { x, y, type, dimension: dim });
    });

    socket.on('disconnect', () => {
        if(players[socket.id]) {
            const p = players[socket.id];
            if (p.nick && p.nick !== "Gracz" && !p.isDead) {
                savePlayer(p.nick, p.x, p.y, p.dimension);
            }
            io.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: `${p.nick} opuścił serwer.` });
            delete players[socket.id];
        }
    });
});

http.listen(3000, () => console.log('OK'));