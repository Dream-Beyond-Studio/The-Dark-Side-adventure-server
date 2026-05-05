const { TILE_SIZE, CHUNK_SIZE, MAP_HEIGHT, GRAVITY } = require('./serverConfig');

function getTile(gridX, gridY, chunks, worldChanges) {
    if (gridY >= MAP_HEIGHT) return 99;
    if (gridY < 0) return 0;
    const key = `${gridX},${gridY}`;
    if (worldChanges[key] !== undefined) return worldChanges[key];
    const chunkX = Math.floor(gridX / CHUNK_SIZE);
    const localX = ((gridX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    if (!chunks[chunkX]) return 99;
    return chunks[chunkX][gridY][localX];
}

function isSolid(x, y, chunks, worldChanges) {
    const tile = getTile(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE), chunks, worldChanges);
    return !(tile === 0 || tile === 3 || tile === 4 || tile === 12);
}

function applyPhysics(entity, chunks, worldChanges, takeDamageCallback) {
    const gridX = Math.floor((entity.x + entity.width/2) / TILE_SIZE);
    const centerY = Math.floor((entity.y + entity.height/2) / TILE_SIZE);
    const feetY = Math.floor((entity.y + entity.height - 2) / TILE_SIZE);
    entity.inWater = (getTile(gridX, centerY, chunks, worldChanges) === 12) || (getTile(gridX, feetY, chunks, worldChanges) === 12);

    if (entity.inWater) {
        entity.velY += GRAVITY * 0.4;
        if (entity.velY > 4) entity.velY = 4;
        entity.highestY = undefined;
    } else {
        entity.velY += GRAVITY;
        if (entity.velY > 12) entity.velY = 12;
    }

    if (!entity.grounded && entity.velY > 0 && !entity.inWater) {
        if (entity.highestY === undefined) entity.highestY = entity.y;
    } else if (entity.velY < 0) {
        entity.highestY = undefined;
    }

    entity.y += entity.velY;
    entity.grounded = false;

    const pointsX = [entity.x + 2, entity.x + entity.width - 2];
    for (let px of pointsX) {
        if (entity.velY > 0 && isSolid(px, entity.y + entity.height, chunks, worldChanges)) {
            entity.y = Math.floor((entity.y + entity.height) / TILE_SIZE) * TILE_SIZE - entity.height;
            entity.grounded = true;

            if (entity.isPlayer && entity.highestY !== undefined && !entity.isDead) {
                const fallDist = (entity.y - entity.highestY) / TILE_SIZE;
                if (fallDist > 6) {
                    const dmg = Math.floor((fallDist - 6) * 10);
                    if (dmg > 0 && takeDamageCallback) takeDamageCallback(entity.id, dmg);
                }
            }
            entity.highestY = undefined;
            entity.velY = 0;
            break;
        } else if (entity.velY < 0 && isSolid(px, entity.y, chunks, worldChanges)) {
            entity.y = (Math.floor(entity.y / TILE_SIZE) + 1) * TILE_SIZE;
            entity.velY = 0; break;
        }
    }

    entity.x += entity.velX;
    const pointsY = [entity.y + 2, entity.y + entity.height / 2, entity.y + entity.height - 2];
    for (let py of pointsY) {
        if (entity.velX > 0 && isSolid(entity.x + entity.width, py, chunks, worldChanges)) {
            entity.x = Math.floor((entity.x + entity.width) / TILE_SIZE) * TILE_SIZE - entity.width;
            entity.velX = 0; break;
        } else if (entity.velX < 0 && isSolid(entity.x, py, chunks, worldChanges)) {
            entity.x = (Math.floor(entity.x / TILE_SIZE) + 1) * TILE_SIZE;
            entity.velX = 0; break;
        }
    }
}

module.exports = { applyPhysics, getTile };