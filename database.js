const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./hl2forum.db', (err) => {
    if (err) console.error(err.message);
    console.log('База данных подключена.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        avatar TEXT DEFAULT '/images/default_avatar.png',
        side TEXT DEFAULT 'Neutral',
        rating INTEGER DEFAULT 0,
        tag TEXT DEFAULT '',
        role TEXT DEFAULT 'user',
        custom_prefix TEXT DEFAULT '',
        is_banned INTEGER DEFAULT 0,
        is_muted INTEGER DEFAULT 0,
        muted_until DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS topics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        content TEXT,
        image TEXT,
        author_id INTEGER,
        category TEXT DEFAULT 'general',
        is_deleted INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(author_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic_id INTEGER,
        author_id INTEGER,
        content TEXT,
        likes INTEGER DEFAULT 0,
        dislikes INTEGER DEFAULT 0,
        is_deleted INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(topic_id) REFERENCES topics(id),
        FOREIGN KEY(author_id) REFERENCES users(id)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS profile_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_user_id INTEGER,
        author_id INTEGER,
        content TEXT,
        is_deleted INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(target_user_id) REFERENCES users(id),
        FOREIGN KEY(author_id) REFERENCES users(id)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        avatar TEXT,
        content TEXT,
        is_deleted INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS private_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER,
        receiver_id INTEGER,
        content TEXT,
        file_path TEXT,
        group_id INTEGER DEFAULT NULL,
        is_deleted INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(sender_id) REFERENCES users(id),
        FOREIGN KEY(receiver_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS chat_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        creator_id INTEGER NOT NULL,
        is_public INTEGER DEFAULT 0,
        avatar TEXT DEFAULT '/images/group_default.png',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(creator_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS group_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        status TEXT DEFAULT 'active',
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(group_id) REFERENCES chat_groups(id),
        FOREIGN KEY(user_id) REFERENCES users(id),
        UNIQUE(group_id, user_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS group_invites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        sender_id INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(group_id) REFERENCES chat_groups(id),
        FOREIGN KEY(sender_id) REFERENCES users(id),
        FOREIGN KEY(receiver_id) REFERENCES users(id),
        UNIQUE(group_id, receiver_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS group_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        sender_id INTEGER NOT NULL,
        content TEXT,
        file_path TEXT,
        is_deleted INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(group_id) REFERENCES chat_groups(id),
        FOREIGN KEY(sender_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS bans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        admin_id INTEGER NOT NULL,
        reason TEXT,
        banned_until DATETIME,
        is_permanent INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(admin_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS mutes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        admin_id INTEGER NOT NULL,
        reason TEXT,
        muted_until DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(admin_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS likes_track (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        comment_id INTEGER NOT NULL,
        value INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(comment_id) REFERENCES comments(id),
        UNIQUE(user_id, comment_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS achievements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        tag TEXT NOT NULL,
        min_rating INTEGER NOT NULL,
        description TEXT,
        icon TEXT DEFAULT '🏆'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS user_achievements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        achievement_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(achievement_id) REFERENCES achievements(id),
        UNIQUE(user_id, achievement_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS support_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        category TEXT DEFAULT 'question',
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'open',
        assigned_to INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(assigned_to) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS ticket_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT,
        is_staff INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(ticket_id) REFERENCES support_tickets(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS user_ips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        ip_address TEXT NOT NULL,
        user_agent TEXT,
        fingerprint TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS permanent_bans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        ip_address TEXT,
        fingerprint TEXT,
        reason TEXT,
        banned_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS appeals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        ban_id INTEGER,
        type TEXT DEFAULT 'ban',
        reason TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        reviewed_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Таблица настроек пользователя
    db.run(`CREATE TABLE IF NOT EXISTS user_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE,
        do_not_message INTEGER DEFAULT 0,
        show_online INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // В database.js добавить:
db.run(`CREATE TABLE IF NOT EXISTS group_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#ffffff',
    can_manage_roles INTEGER DEFAULT 0,
    can_kick INTEGER DEFAULT 0,
    can_ban INTEGER DEFAULT 0,
    can_delete_messages INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(group_id) REFERENCES chat_groups(id)
)`);

db.run(`CREATE TABLE IF NOT EXISTS group_member_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    role_id INTEGER NOT NULL,
    FOREIGN KEY(member_id) REFERENCES group_members(id),
    FOREIGN KEY(role_id) REFERENCES group_roles(id),
    UNIQUE(member_id, role_id)
)`);
});

// Добавляем достижения только если таблица пуста
db.all(`SELECT COUNT(*) as count FROM achievements`, [], (err, result) => {
    if (err) return;
    
    if (result[0].count === 0) {
        const achievements = [
            ['Новичок', 'Новичок', 0, 'Только начал свой путь', '🌟'],
            ['Активист', 'Активист', 10, 'Активный участник форума', '⭐'],
            ['Ветеран', 'Ветеран', 50, 'Опытный участник', '💫'],
            ['Элита', 'Элита', 100, 'Элита форума', '👑'],
            ['Легенда', 'Легенда', 500, 'Легенда HL2 Форума', '🔥'],
            ['Хедкраб', 'Хедкраб', 5, 'Любитель хедкрабов', '🦀'],
            ['Вортигонт', 'Вортигонт', 25, 'Друг вортигонтов', '👽'],
            ['G-Man', 'G-Man', 200, 'Загадочная личность', '🎩']
        ];
        const stmt = db.prepare(`INSERT INTO achievements (name, tag, min_rating, description, icon) VALUES (?, ?, ?, ?, ?)`);
        achievements.forEach(a => stmt.run(a));
        stmt.finalize();
        console.log('✅ Достижения добавлены!');
    }
});

module.exports = db;