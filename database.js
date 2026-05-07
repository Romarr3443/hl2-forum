const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./hl2forum.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, avatar TEXT DEFAULT '/images/default_avatar.png', side TEXT DEFAULT 'Neutral', rating INTEGER DEFAULT 0, tag TEXT DEFAULT '', role TEXT DEFAULT 'user', is_banned INTEGER DEFAULT 0, is_muted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS topics (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT, image TEXT, author_id INTEGER, is_deleted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, topic_id INTEGER, author_id INTEGER, content TEXT, likes INTEGER DEFAULT 0, dislikes INTEGER DEFAULT 0, is_deleted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, avatar TEXT, content TEXT, is_deleted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS private_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER, receiver_id INTEGER, content TEXT, file_path TEXT, is_deleted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS bans (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, admin_id INTEGER, reason TEXT, banned_until DATETIME, is_permanent INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS mutes (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, admin_id INTEGER, reason TEXT, muted_until DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS likes_track (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, comment_id INTEGER, value INTEGER DEFAULT 1, UNIQUE(user_id, comment_id))`);
    db.run(`CREATE TABLE IF NOT EXISTS achievements (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, tag TEXT, min_rating INTEGER, description TEXT, icon TEXT DEFAULT '🏆')`);
});

module.exports = db;
