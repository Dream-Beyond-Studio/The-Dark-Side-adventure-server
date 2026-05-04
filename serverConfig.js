const TILE_SIZE = 32;
const CHUNK_SIZE = 16;
const MAP_HEIGHT = 128;
const SEA_LEVEL = 60;
const GRAVITY = 0.5;
const DAY_DURATION = 14400;

const MOBS_CONFIG = { 
    cow: { width: 40, height: 28, speed: 1.2, jumpForce: -8, maxHp: 50 },
    zombie: { width: 20, height: 40, speed: 1.8, jumpForce: -10, maxHp: 100, damage: 15 }
};

module.exports = {
    TILE_SIZE, CHUNK_SIZE, MAP_HEIGHT, SEA_LEVEL, GRAVITY, DAY_DURATION, MOBS_CONFIG
};