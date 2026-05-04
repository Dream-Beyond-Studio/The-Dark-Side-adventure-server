const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const path = require('path');
const readline = require('readline');

const { TILE_SIZE, CHUNK_SIZE, DAY_DURATION, MOBS_CONFIG } = require('./serverConfig');
const { log, savePlayer, loadPlayer, saveAllPlayers } = require('./database');
const { generateChunkData, getTerrainHeight } = require('./worldGenerator');
const { applyPhysics, getTile } = require('./physics');

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let mobs = {};
let mobIdCounter = 0;
let chunks = {};
let worldChanges = {};
let gameTime = 0;
let chunkQueue = new Set();

function takeDamage(playerId, amount) {
    let p = players[playerId];
    if (!p || p.isDead) return;

    p.hp -= amount;
    p.regenCooldown = 300;
    io.emit('damageText', { x: p.x + p.width/2, y: p.y - 10, dmg: amount });

    if (p.hp <= 0) {
        p.hp = 0;
        p.isDead = true;
        io.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: `${p.nick} zginął.` });
    }
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
        case 'list':
            Object.keys(players).forEach(id => {
                console.log(`${id} | ${players[id].nick} | ${Math.floor(players[id].x/32)} ${Math.floor(players[id].y/32)}`);
            });
            break;
        case 'kick':
            if (players[args[0]]) {
                io.sockets.sockets.get(args[0])?.disconnect(true);
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
    if (chunkQueue.size > 0) {
        const chunkToGen = chunkQueue.values().next().value;
        if (!chunks[chunkToGen]) {
            const chunkData = generateChunkData(chunkToGen);
            chunks[chunkToGen] = chunkData;
            io.emit('newChunk', { chunkX: chunkToGen, data: chunkData });
        }
        chunkQueue.delete(chunkToGen);
    }

    gameTime++;
    if (gameTime >= DAY_DURATION) gameTime = 0;

    const progress = gameTime / DAY_DURATION;
    const isNight = progress > 0.8 || progress < 0.2;

    if (gameTime % 600 === 0) {
        saveAllPlayers(players);
    }

    const playerIds = Object.keys(players);
    if (playerIds.length > 0 && Object.keys(mobs).length < 12) {
        if (Math.random() < 0.015) {
            const p = players[playerIds[Math.floor(Math.random() * playerIds.length)]];
            const id = mobIdCounter++;
            const type = isNight ? 'zombie' : 'cow';
            
            const spawnX = p.x + (Math.random() - 0.5) * 800;
            const gridX = Math.floor(spawnX / TILE_SIZE);
            const gridY = getTerrainHeight(gridX);
            const spawnY = gridY * TILE_SIZE - MOBS_CONFIG[type].height;
            
            mobs[id] = { 
                id: id, 
                type: type, 
                x: spawnX, 
                y: spawnY, 
                width: MOBS_CONFIG[type].width, 
                height: MOBS_CONFIG[type].height, 
                velX: 0, 
                velY: 0, 
                grounded: false, 
                inWater: false, 
                facingRight: true, 
                timer: 0,
                hp: MOBS_CONFIG[type].maxHp,
                maxHp: MOBS_CONFIG[type].maxHp
            };
        }
    }

    for (let id in mobs) {
        let m = mobs[id];
        const config = MOBS_CONFIG[m.type];
        const speed = m.inWater ? config.speed * 0.5 : config.speed;

        if (m.type === 'zombie') {
            if (!isNight) {
                if (gameTime % 30 === 0) {
                    m.hp -= 10;
                    io.emit('damageText', { x: m.x + m.width/2, y: m.y - 10, dmg: 10 });
                }
                if (m.hp <= 0) {
                    delete mobs[id];
                    continue;
                }
            }

            let closestPlayer = null;
            let minDistance = 400;

            for (let pid in players) {
                let p = players[pid];
                if (p.isDead) continue;
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

                if (minDistance < 30 && m.timer <= 0) {
                    takeDamage(closestPlayer.id, config.damage);
                    m.timer = 60; 
                }
            } else {
                m.velX = 0;
            }

            if (m.timer > 0) m.timer--;

        } else {
            if (isNight) {
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

        if (m.inWater) m.velY = -2;
        else {
            const checkX = m.velX > 0 ? m.x + m.width + 2 : m.x - 2;
            const tile = getTile(Math.floor(checkX / TILE_SIZE), Math.floor((m.y + m.height - 5) / TILE_SIZE), chunks, worldChanges);
            const solid = !(tile === 0 || tile === 3 || tile === 4 || tile === 12);
            if (m.velX !== 0 && m.grounded && solid) m.velY = config.jumpForce;
        }
        applyPhysics(m, chunks, worldChanges);
    }

    for (let id in players) {
        let p = players[id];
        const speed = p.inWater ? 2.5 : 5;
        p.velX = 0;

        if (!p.isDead) {
            if (p.regenCooldown > 0) {
                p.regenCooldown--;
            } else if (p.hp < p.maxHp && gameTime % 30 === 0) {
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
                    if (!p.prevJump) {
                        p.velY = -6.5;
                    }
                    else if (p.velY > -2.5) {
                        p.velY -= 0.5;
                    }
                }
            }
        }
        p.prevJump = p.inputs.jump;

        applyPhysics(p, chunks, worldChanges, takeDamage);

        const pChunkX = Math.floor(p.x / (CHUNK_SIZE * TILE_SIZE));
        for (let i = -2; i <= 2; i++) if (!chunks[pChunkX + i]) chunkQueue.add(pChunkX + i);
    }
}, 1000 / 60);

setInterval(() => {
    io.emit('gameState', { players, mobs, time: gameTime });
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
                if (oldNick !== "Gracz") savePlayer(oldNick, players[socket.id].x, players[socket.id].y);
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
    }
}

io.on('connection', (socket) => {
    const spawnGridX = Math.floor((Math.random() - 0.5) * 40);
    const spawnGridY = getTerrainHeight(spawnGridX);
    const spawnX = spawnGridX * TILE_SIZE;
    const spawnY = spawnGridY * TILE_SIZE - 40;

    players[socket.id] = {
        id: socket.id,
        isPlayer: true,
        isDead: false,
        hp: 100,
        maxHp: 100,
        x: spawnX, y: spawnY, width: 20, height: 40, velX: 0, velY: 0, grounded: false, inWater: false,
        nick: "Gracz", color: '#' + Math.floor(Math.random()*16777215).toString(16),
        inputs: { left: false, right: false, jump: false },
        prevJump: false,
        regenCooldown: 0
    };

    socket.emit('initWorld', { chunks, worldChanges, dayDuration: DAY_DURATION });

    socket.on('setNick', (nick) => {
        if (players[socket.id]) {
            const cleanNick = nick.substring(0, 15);
            players[socket.id].nick = cleanNick;

            loadPlayer(cleanNick, (err, row) => {
                if (err) return;
                if (row) {
                    players[socket.id].x = row.x;
                    players[socket.id].y = row.y;
                    socket.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: `Witaj ponownie, ${cleanNick}!` });
                    socket.broadcast.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: `${cleanNick} powrócił do gry!` });
                } else {
                    io.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: `${cleanNick} dołączył do serwera!` });
                }
            });
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
            p.hp = p.maxHp;
            p.isDead = false;
            p.regenCooldown = 0;

            const spawnGridX = Math.floor((Math.random() - 0.5) * 40);
            const spawnGridY = getTerrainHeight(spawnGridX);
            p.x = spawnGridX * TILE_SIZE;
            p.y = spawnGridY * TILE_SIZE - 40;
            p.velY = 0;
            p.velX = 0;
            p.highestY = undefined;
        }
    });

    socket.on('shoot', (target) => {
        const shooter = players[socket.id];
        if (!shooter || shooter.isDead) return;

        socket.broadcast.emit('playerShoot', { x1: shooter.x + shooter.width/2, y1: shooter.y + shooter.height/2, x2: target.x, y2: target.y });

        for (let id in mobs) {
            let m = mobs[id];
            if (target.x >= m.x && target.x <= m.x + m.width && target.y >= m.y && target.y <= m.y + m.height) {
                m.hp -= 25;
                io.emit('damageText', { x: m.x + m.width/2, y: m.y - 10, dmg: 25 });
                if (m.hp <= 0) {
                    delete mobs[id];
                }
                break;
            }
        }

        for (let id in players) {
            if (id === socket.id) continue;
            let p = players[id];
            if (target.x >= p.x && target.x <= p.x + p.width && target.y >= p.y && target.y <= p.y + p.height && !p.isDead) {
                takeDamage(id, 25);
                break;
            }
        }
    });

    socket.on('blockUpdate', (data) => {
        if (players[socket.id] && players[socket.id].isDead) return;

        const { x, y, type } = data;
        const currentTile = getTile(x, y, chunks, worldChanges);
        if (currentTile === 99) return;
        if (type !== 0) {
            const isReplaceable = (currentTile === 0 || currentTile === 4 || currentTile === 12);
            if (!isReplaceable) return;
            function isSupport(t) { return t !== 0 && t !== 12 && t !== 4 && t !== 99; }
            if (!isSupport(getTile(x, y - 1, chunks, worldChanges)) && !isSupport(getTile(x, y + 1, chunks, worldChanges)) && !isSupport(getTile(x - 1, y, chunks, worldChanges)) && !isSupport(getTile(x + 1, y, chunks, worldChanges))) return;
        } else { if (currentTile === 0 || currentTile === 12) return; }

        worldChanges[`${x},${y}`] = type;
        io.emit('blockUpdate', { x, y, type });
    });

    socket.on('disconnect', () => {
        if(players[socket.id]) {
            const p = players[socket.id];
            if (p.nick && p.nick !== "Gracz" && !p.isDead) {
                savePlayer(p.nick, p.x, p.y);
            }
            io.emit('chatMessage', { id: 'SYSTEM', nick: 'INFO', text: `${p.nick} opuścił serwer.` });
            delete players[socket.id];
        }
    });
});

http.listen(3000, () => console.log('OK'));