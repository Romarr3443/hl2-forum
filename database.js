const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'hl2forum.db');

let db;

function initDatabase() {
    return initSqlJs().then(SQL => {
        if (fs.existsSync(DB_PATH)) {
            db = new SQL.Database(fs.readFileSync(DB_PATH));
        } else {
            db = new SQL.Database();
        }

        // Создаём таблицы
        db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, avatar TEXT DEFAULT '/images/default_avatar.png', side TEXT DEFAULT 'Neutral', rating INTEGER DEFAULT 0, tag TEXT DEFAULT '', role TEXT DEFAULT 'user', is_banned INTEGER DEFAULT 0, is_muted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS topics (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT, image TEXT, author_id INTEGER, is_deleted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, topic_id INTEGER, author_id INTEGER, content TEXT, likes INTEGER DEFAULT 0, dislikes INTEGER DEFAULT 0, is_deleted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, avatar TEXT, content TEXT, is_deleted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS private_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER, receiver_id INTEGER, content TEXT, file_path TEXT, is_deleted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS bans (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, admin_id INTEGER, reason TEXT, banned_until DATETIME, is_permanent INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS mutes (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, admin_id INTEGER, reason TEXT, muted_until DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS likes_track (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, comment_id INTEGER, value INTEGER DEFAULT 1, UNIQUE(user_id, comment_id))`);
        db.run(`CREATE TABLE IF NOT EXISTS achievements (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, tag TEXT, min_rating INTEGER, description TEXT, icon TEXT DEFAULT '🏆')`);
        
        // Добавляем достижения если таблица пуста
        const count = db.exec('SELECT COUNT(*) as c FROM achievements');
        const achievementCount = count.length > 0 && count[0].values.length > 0 ? count[0].values[0][0] : 0;
        
        if (achievementCount === 0) {
            const achievements = [
                ['Новичок', 'Новичок', 0, 'Только начал свой путь', '🌟'],
                ['Хедкраб', 'Хедкраб', 5, 'Любитель хедкрабов', '🦀'],
                ['Активист', 'Активист', 10, 'Активный участник форума', '⭐'],
                ['Вортигонт', 'Вортигонт', 25, 'Друг вортигонтов', '👽'],
                ['Ветеран', 'Ветеран', 50, 'Опытный участник', '💫'],
                ['Элита', 'Элита', 100, 'Элита форума', '👑'],
                ['G-Man', 'G-Man', 200, 'Загадочная личность', '🎩'],
                ['Легенда', 'Легенда', 500, 'Легенда HL2 Форума', '🔥']
            ];
            const stmt = db.prepare('INSERT INTO achievements (name, tag, min_rating, description, icon) VALUES (?, ?, ?, ?, ?)');
            achievements.forEach(a => stmt.run(a));
            stmt.free();
        }

        saveDatabase();
        console.log('✅ База данных готова!');
        return true;
    });
}

function saveDatabase() {
    if (db) fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

// Инициализируем сразу
initDatabase();

// Экспортируем методы для совместимости
module.exports = {
    run: function(sql, params, callback) {
        try {
            db.run(sql, params || []);
            saveDatabase();
            if (callback) callback.call({ changes: 1, lastID: 0 }, null);
        } catch (e) { if (callback) callback(e); }
    },
    get: function(sql, params, callback) {
        try {
            const stmt = db.prepare(sql);
            if (params) stmt.bind(params);
            let result = null;
            if (stmt.step()) {
                result = {};
                stmt.getColumnNames().forEach((c, i) => result[c] = stmt.get()[i]);
            }
            stmt.free();
            if (callback) callback(null, result);
        } catch (e) { if (callback) callback(e); }
    },
    all: function(sql, params, callback) {
        try {
            const results = [];
            const stmt = db.prepare(sql);
            if (params) stmt.bind(params);
            while (stmt.step()) {
                const row = {};
                stmt.getColumnNames().forEach((c, i) => row[c] = stmt.get()[i]);
                results.push(row);
            }
            stmt.free();
            if (callback) callback(null, results);
        } catch (e) { if (callback) callback(e); }
    }
};
