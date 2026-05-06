const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const logsDir = path.join(__dirname, 'logs');
const dbDir = path.join(__dirname, 'database');

if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

function log(category, message) {
    const now = new Date();
    const fileLine = `[${now.toLocaleDateString()} ${now.toLocaleTimeString()}] [${category}] ${message}\n`;
    fs.appendFile(path.join(logsDir, `server_log_${now.toISOString().split('T')[0]}.txt`), fileLine, (err) => {});
}

const db = new sqlite3.Database(path.join(dbDir, 'game.db'), (err) => {
    if (!err) {
        db.run(`CREATE TABLE IF NOT EXISTS players (nick TEXT PRIMARY KEY, x REAL, y REAL, dimension TEXT DEFAULT 'earth', inventory TEXT DEFAULT '{"999":1}')`, () => {
            db.run("ALTER TABLE players ADD COLUMN inventory TEXT DEFAULT '{\"999\":1}'", () => {});
        });
        db.run(`CREATE TABLE IF NOT EXISTS world_data (dimension TEXT PRIMARY KEY, changes TEXT)`);
    }
});

function savePlayer(nick, x, y, dimension, inventory) {
    if (nick && nick !== "Gracz") {
        const dim = dimension || 'earth';
        const inv = JSON.stringify(inventory || { 999: 1 });
        db.run("INSERT OR REPLACE INTO players (nick, x, y, dimension, inventory) VALUES (?, ?, ?, ?, ?)", [nick, x, y, dim, inv]);
    }
}

function loadPlayer(nick, callback) {
    db.get("SELECT x, y, dimension, inventory FROM players WHERE nick = ?", [nick], callback);
}

function saveAllPlayers(players, callback) {
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        for (let id in players) {
            const p = players[id];
            if (p.nick && p.nick !== "Gracz" && !p.isDead) {
                const dim = p.dimension || 'earth';
                const inv = JSON.stringify(p.inventory || { 999: 1 });
                db.run("INSERT OR REPLACE INTO players (nick, x, y, dimension, inventory) VALUES (?, ?, ?, ?, ?)", [p.nick, p.x, p.y, dim, inv]);
            }
        }
        db.run("COMMIT", callback);
    });
}

function saveWorldChanges(dimensions, callback) {
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        for (let dim in dimensions) {
            const changesStr = JSON.stringify(dimensions[dim].worldChanges);
            db.run("INSERT OR REPLACE INTO world_data (dimension, changes) VALUES (?, ?)", [dim, changesStr]);
        }
        db.run("COMMIT", callback);
    });
}

function loadWorldChanges(callback) {
    db.all("SELECT dimension, changes FROM world_data", [], (err, rows) => {
        let data = { earth: {}, moon: {} };
        if (rows) {
            rows.forEach(row => {
                if (row.changes) data[row.dimension] = JSON.parse(row.changes);
            });
        }
        callback(data);
    });
}

module.exports = { log, savePlayer, loadPlayer, saveAllPlayers, saveWorldChanges, loadWorldChanges };