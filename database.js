const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const LOG_FILE = path.join(__dirname, 'server_logs.txt');

function log(category, message) {
    const now = new Date();
    const time = now.toLocaleTimeString();
    const date = now.toLocaleDateString();
    if (category !== 'CMD_INPUT') console.log(`[${time}] [${category}] ${message}`);
    const fileLine = `[${date} ${time}] [${category}] ${message}\n`;
    fs.appendFile(LOG_FILE, fileLine, (err) => { if (err) console.error(err); });
}

const db = new sqlite3.Database(path.join(__dirname, 'game.db'), (err) => {
    if (err) {
        log('ERROR', err.message);
    } else {
        log('SYSTEM', 'DB OK');
        db.run(`CREATE TABLE IF NOT EXISTS players (
            nick TEXT PRIMARY KEY,
            x REAL,
            y REAL
        )`);
    }
});

function savePlayer(nick, x, y) {
    if (nick && nick !== "Gracz") {
        db.run("INSERT OR REPLACE INTO players (nick, x, y) VALUES (?, ?, ?)", [nick, x, y]);
    }
}

function loadPlayer(nick, callback) {
    db.get("SELECT x, y FROM players WHERE nick = ?", [nick], callback);
}

function saveAllPlayers(players, callback) {
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        for (let id in players) {
            const p = players[id];
            if (p.nick && p.nick !== "Gracz" && !p.isDead) {
                db.run("INSERT OR REPLACE INTO players (nick, x, y) VALUES (?, ?, ?)", [p.nick, p.x, p.y]);
            }
        }
        db.run("COMMIT", callback);
    });
}

module.exports = { log, savePlayer, loadPlayer, saveAllPlayers };