const TILE_SIZE = 32;
const CHUNK_SIZE = 16;
const MAP_HEIGHT = 128;
const SEA_LEVEL = 60;
const GRAVITY = 0.5;
const DAY_DURATION = 14400;

const MOBS_CONFIG = { 
    cow: { width: 40, height: 28, speed: 1.2, jumpForce: -8, maxHp: 50 },
    pig: { width: 28, height: 20, speed: 1.4, jumpForce: -7, maxHp: 30 },
    sheep: { width: 36, height: 28, speed: 1.1, jumpForce: -9, maxHp: 40 },
    zombie: { width: 20, height: 40, speed: 1.5, jumpForce: -10, maxHp: 60, damage: 8 },
    alien: { width: 24, height: 38, speed: 2.0, jumpForce: -12, maxHp: 150, damage: 20 },
    crawler: { width: 28, height: 16, speed: 2.2, jumpForce: -8, maxHp: 90, damage: 12 }
};

module.exports = {
    TILE_SIZE, CHUNK_SIZE, MAP_HEIGHT, SEA_LEVEL, GRAVITY, DAY_DURATION, MOBS_CONFIG
};