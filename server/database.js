const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const logsDir = path.join(__dirname, 'logs');
const dbDir = path.join(__dirname, 'database');

if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

function log(category, message) {
    const now = new Date();
    const time = now.toLocaleTimeString();
    const date = now.toLocaleDateString();
    
    const fileNameDate = now.toISOString().split('T')[0];
    const logFile = path.join(logsDir, `server_log_${fileNameDate}.txt`);

    if (category !== 'CMD_INPUT') console.log(`[${time}] [${category}] ${message}`);
    const fileLine = `[${date} ${time}] [${category}] ${message}\n`;
    
    fs.appendFile(logFile, fileLine, (err) => { if (err) console.error(err); });
}

const db = new sqlite3.Database(path.join(dbDir, 'game.db'), (err) => {
    if (err) {
        log('ERROR', err.message);
    } else {
        log('SYSTEM', 'DB OK');
        db.run(`CREATE TABLE IF NOT EXISTS players (
            nick TEXT PRIMARY KEY,
            x REAL,
            y REAL,
            dimension TEXT DEFAULT 'earth'
        )`, () => {
            db.run("ALTER TABLE players ADD COLUMN dimension TEXT DEFAULT 'earth'", (err) => {});
        });
    }
});

function savePlayer(nick, x, y, dimension) {
    if (nick && nick !== "Gracz") {
        const dim = dimension || 'earth';
        db.run("INSERT OR REPLACE INTO players (nick, x, y, dimension) VALUES (?, ?, ?, ?)", [nick, x, y, dim]);
    }
}

function loadPlayer(nick, callback) {
    db.get("SELECT x, y, dimension FROM players WHERE nick = ?", [nick], callback);
}

function saveAllPlayers(players, callback) {
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        for (let id in players) {
            const p = players[id];
            if (p.nick && p.nick !== "Gracz" && !p.isDead) {
                const dim = p.dimension || 'earth';
                db.run("INSERT OR REPLACE INTO players (nick, x, y, dimension) VALUES (?, ?, ?, ?)", [p.nick, p.x, p.y, dim]);
            }
        }
        db.run("COMMIT", callback);
    });
}

module.exports = { log, savePlayer, loadPlayer, saveAllPlayers };