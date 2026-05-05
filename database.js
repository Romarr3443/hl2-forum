const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'hl2forum.db');

let db;

// Загружаем или создаём базу данных
function initDatabase() {
    return initSqlJs().then(SQL => {
        if (fs.existsSync(DB_PATH)) {
            const buffer = fs.readFileSync(DB_PATH);
            db = new SQL.Database(buffer);
        } else {
            db = new SQL.Database();
        }

        // Создаём таблицы
        db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, avatar TEXT DEFAULT '/images/default_avatar.png', side TEXT DEFAULT 'Neutral', rating INTEGER DEFAULT 0, tag TEXT DEFAULT '', role TEXT DEFAULT 'user', is_banned INTEGER DEFAULT 0, is_muted INTEGER DEFAULT 0, muted_until DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS topics (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT, image TEXT, author_id INTEGER, is_deleted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, topic_id INTEGER, author_id INTEGER, content TEXT, likes INTEGER DEFAULT 0, dislikes INTEGER DEFAULT 0, is_deleted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, avatar TEXT, content TEXT, is_deleted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS private_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER, receiver_id INTEGER, content TEXT, file_path TEXT, is_deleted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS chat_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, creator_id INTEGER, is_public INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS group_members (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER, user_id INTEGER, status TEXT DEFAULT 'active', UNIQUE(group_id, user_id))`);
        db.run(`CREATE TABLE IF NOT EXISTS group_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER, sender_id INTEGER, content TEXT, file_path TEXT, is_deleted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS bans (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, admin_id INTEGER, reason TEXT, banned_until DATETIME, is_permanent INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS mutes (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, admin_id INTEGER, reason TEXT, muted_until DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS likes_track (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, comment_id INTEGER, value INTEGER DEFAULT 1, UNIQUE(user_id, comment_id))`);
        db.run(`CREATE TABLE IF NOT EXISTS achievements (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, tag TEXT, min_rating INTEGER, description TEXT, icon TEXT DEFAULT '🏆')`);
        db.run(`CREATE TABLE IF NOT EXISTS user_achievements (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, achievement_id INTEGER, UNIQUE(user_id, achievement_id))`);
        db.run(`CREATE TABLE IF NOT EXISTS support_tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, category TEXT, title TEXT, description TEXT, status TEXT DEFAULT 'open', assigned_to INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS ticket_replies (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER, user_id INTEGER, content TEXT, is_staff INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS user_ips (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, ip_address TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS permanent_bans (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, ip_address TEXT, reason TEXT, banned_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS appeals (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT DEFAULT 'ban', reason TEXT, status TEXT DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS user_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE, do_not_message INTEGER DEFAULT 0, show_online INTEGER DEFAULT 1)`);
        db.run(`CREATE TABLE IF NOT EXISTS group_roles (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER, name TEXT, color TEXT DEFAULT '#ffffff')`);
        db.run(`CREATE TABLE IF NOT EXISTS group_member_roles (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER, role_id INTEGER, UNIQUE(member_id, role_id))`);
        db.run(`CREATE TABLE IF NOT EXISTS profile_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, target_user_id INTEGER, author_id INTEGER, content TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS group_invites (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER, sender_id INTEGER, receiver_id INTEGER, status TEXT DEFAULT 'pending', UNIQUE(group_id, receiver_id))`);

        saveDatabase();
        console.log('✅ База данных готова!');
        return module.exports;
    });
}

function saveDatabase() {
    if (db) {
        const data = db.export();
        fs.writeFileSync(DB_PATH, Buffer.from(data));
    }
}

// Экспортируем методы
module.exports = {
    init: initDatabase,
    
    run: function(sql, params, callback) {
        try {
            db.run(sql, params);
            saveDatabase();
            if (callback) callback.call({ changes: 1 }, null);
        } catch (err) {
            if (callback) callback(err);
        }
    },
    
    get: function(sql, params, callback) {
        try {
            const stmt = db.prepare(sql);
            if (params) stmt.bind(params);
            let result = null;
            if (stmt.step()) {
                const cols = stmt.getColumnNames();
                const vals = stmt.get();
                result = {};
                cols.forEach((c, i) => result[c] = vals[i]);
            }
            stmt.free();
            if (callback) callback(null, result);
        } catch (err) {
            if (callback) callback(err);
        }
    },
    
    all: function(sql, params, callback) {
        try {
            const results = [];
            const stmt = db.prepare(sql);
            if (params) stmt.bind(params);
            while (stmt.step()) {
                const cols = stmt.getColumnNames();
                const vals = stmt.get();
                const row = {};
                cols.forEach((c, i) => row[c] = vals[i]);
                results.push(row);
            }
            stmt.free();
            if (callback) callback(null, results);
        } catch (err) {
            if (callback) callback(err);
        }
    },
    
    exec: function(sql) {
        return db ? db.exec(sql) : [];
    },
    
    save: saveDatabase
};

// Инициализируем базу сразу
initDatabase();
