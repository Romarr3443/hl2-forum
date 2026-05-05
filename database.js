const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'hl2forum.db'));
db.pragma('journal_mode = WAL');

// Создаём таблицы
db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, avatar TEXT DEFAULT '/images/default_avatar.png', side TEXT DEFAULT 'Neutral', rating INTEGER DEFAULT 0, tag TEXT DEFAULT '', role TEXT DEFAULT 'user', is_banned INTEGER DEFAULT 0, is_muted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS topics (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT, image TEXT, author_id INTEGER, is_deleted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, topic_id INTEGER, author_id INTEGER, content TEXT, likes INTEGER DEFAULT 0, dislikes INTEGER DEFAULT 0, is_deleted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, avatar TEXT, content TEXT, is_deleted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS private_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER, receiver_id INTEGER, content TEXT, file_path TEXT, is_deleted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS bans (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, admin_id INTEGER, reason TEXT, banned_until DATETIME, is_permanent INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS mutes (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, admin_id INTEGER, reason TEXT, muted_until DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS likes_track (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, comment_id INTEGER, value INTEGER DEFAULT 1, UNIQUE(user_id, comment_id));
CREATE TABLE IF NOT EXISTS achievements (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, tag TEXT, min_rating INTEGER, description TEXT, icon TEXT DEFAULT '🏆')`);

// Добавляем достижения
const count = db.prepare('SELECT COUNT(*) as c FROM achievements').get();
if (count.c === 0) {
    const stmt = db.prepare('INSERT INTO achievements (name, tag, min_rating, description, icon) VALUES (?, ?, ?, ?, ?)');
[
    ['Новичок', 'Новичок', 0, 'Только начал свой путь', '🌟'],
    ['Хедкраб', 'Хедкраб', 5, 'Любитель хедкрабов', '🦀'],
    ['Активист', 'Активист', 10, 'Активный участник форума', '⭐'],
    ['Вортигонт', 'Вортигонт', 25, 'Друг вортигонтов', '👽'],
    ['Ветеран', 'Ветеран', 50, 'Опытный участник', '💫'],
    ['Элита', 'Элита', 100, 'Элита форума', '👑'],
    ['G-Man', 'G-Man', 200, 'Загадочная личность', '🎩'],
    ['Легенда', 'Легенда', 500, 'Легенда HL2 Форума', '🔥']
].forEach(a => stmt.run(a));
}

console.log('✅ База готова!');

module.exports = db;
