const express = require('express');
const app = express();
const db = require('./database');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require("socket.io");
const bcrypt = require('bcryptjs');
const { isAdmin, isFounder, isModerator, isStaff } = require('./admin');
const { moderateMessage } = require('./moderation');

const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.json());

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: function(req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 10 * 1024 * 1024 } });

function getClientIP(req) {
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress || '127.0.0.1';
}

const checkUser = (req, res, next) => {
    if (req.cookies.userId) {
        db.get(`SELECT * FROM users WHERE id = ?`, [req.cookies.userId], (err, user) => {
            if (err || !user) { req.user = null; }
            else {
                req.user = user;
                if (user.is_muted && user.muted_until && new Date() > new Date(user.muted_until)) {
                    db.run(`UPDATE users SET is_muted = 0, muted_until = NULL WHERE id = ?`, [user.id]);
                    req.user.is_muted = 0;
                }
            }
            next();
        });
    } else { req.user = null; next(); }
};

app.use((req, res, next) => {
    if (req.cookies.userId) {
        db.get(`SELECT u.*, b.reason, b.banned_until, b.is_permanent FROM users u LEFT JOIN bans b ON u.id = b.user_id WHERE u.id = ? AND u.is_banned = 1 ORDER BY b.created_at DESC LIMIT 1`, [req.cookies.userId], (err, user) => {
            if (user) {
                if (!user.is_permanent && user.banned_until && new Date() > new Date(user.banned_until)) {
                    db.run(`UPDATE users SET is_banned = 0 WHERE id = ?`, [user.id]);
                    return next();
                }
                return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>🚫 ВЫ ЗАБАНЕНЫ</title><style>*{margin:0;padding:0}body{background:#0a0000;color:red;display:flex;justify-content:center;align-items:center;height:100vh;font-family:monospace}.ban-box{text-align:center;padding:50px;border:5px solid red;border-radius:20px;background:rgba(255,0,0,.1)}h1{font-size:4em}a{color:#ff9900}</style></head><body><div class="ban-box"><h1>🚫 ВЫ ЗАБАНЕНЫ</h1><p>${user.is_permanent ? '⚡ НАВСЕГДА' : 'До: ' + new Date(user.banned_until).toLocaleString('ru-RU')}</p><p>Причина: ${user.reason || 'Нарушение правил'}</p><a href="/appeal">📝 Подать апелляцию</a></div></body></html>`);
            }
            next();
        });
    } else next();
});

function checkAchievements(userId, rating) {
    db.all(`SELECT * FROM achievements WHERE min_rating <= ?`, [rating], (err, achievements) => {
        if (err) return;
        achievements.forEach(a => {
            db.run(`INSERT OR IGNORE INTO user_achievements (user_id, achievement_id) VALUES (?, ?)`, [userId, a.id], function(err) {
                if (!err && this.changes > 0) {
                    db.get(`SELECT a.tag FROM achievements a JOIN user_achievements ua ON a.id = ua.achievement_id WHERE ua.user_id = ? ORDER BY a.min_rating DESC LIMIT 1`, [userId], (err, best) => {
                        if (!err && best) db.run(`UPDATE users SET tag = ? WHERE id = ?`, [best.tag, userId]);
                    });
                }
            });
        });
    });
}

// Главная
app.get('/', checkUser, (req, res) => {
    db.all(`SELECT topics.*, users.username, users.avatar, users.side FROM topics JOIN users ON topics.author_id = users.id WHERE topics.is_deleted = 0 ORDER BY topics.id DESC`, (err, topics) => {
        res.render('index', { user: req.user, topics: topics || [] });
    });
});

// Логин/Регистрация
app.get('/login', checkUser, (req, res) => res.render('login', { user: req.user }));
app.get('/register', checkUser, (req, res) => res.render('register', { user: req.user }));

app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (password.length < 8) return res.send("Пароль не менее 8 символов!");
    bcrypt.hash(password, 10, (err, hash) => {
        db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hash], (err) => {
            if (err) return res.send("Пользователь уже существует");
            res.redirect('/login');
        });
    });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (!user) return res.send('Пользователь не найден');
        if (user.is_banned) return res.send("Вы забанены");
        bcrypt.compare(password, user.password, (err, match) => {
            if (match) { res.cookie('userId', user.id); res.redirect('/'); }
            else res.send('Неверный пароль');
        });
    });
});

app.get('/logout', (req, res) => { res.clearCookie('userId'); res.redirect('/'); });

// Темы
app.get('/new', checkUser, (req, res) => {
    if (!req.user) return res.redirect('/login');
    res.render('new_topic', { user: req.user });
});

app.post('/new', checkUser, upload.single('image'), (req, res) => {
    if (!req.user) return res.redirect('/login');
    const { title, content } = req.body;
    if (title.length < 3) return res.send("Заголовок слишком короткий!");
    const moderation = moderateMessage(req.user.id, req.user.username, title + ' ' + content);
    if (!moderation.allowed) return res.send(moderation.message);
    const image = req.file ? '/uploads/' + req.file.filename : null;
    db.run(`INSERT INTO topics (title, content, image, author_id) VALUES (?, ?, ?, ?)`, [title, content, image, req.user.id], (err) => {
        res.redirect('/');
    });
});

app.get('/topic/:id', checkUser, (req, res) => {
    db.get(`SELECT * FROM topics WHERE id = ? AND is_deleted = 0`, [req.params.id], (err, topic) => {
        if (!topic) return res.send("Тема не найдена");
        db.get(`SELECT username, avatar, side FROM users WHERE id = ?`, [topic.author_id], (err, author) => {
            topic.author = author;
            db.all(`SELECT comments.*, users.username, users.avatar, users.side FROM comments JOIN users ON comments.author_id = users.id WHERE topic_id = ? AND comments.is_deleted = 0 ORDER BY id ASC`, [req.params.id], (err, comments) => {
                res.render('topic', { user: req.user, topic: topic, comments: comments || [] });
            });
        });
    });
});

app.post('/topic/:id/comment', checkUser, upload.single('image'), (req, res) => {
    if (!req.user) return res.redirect('/login');
    if (req.user.is_muted) return res.send("Вы замучены!");
    const { content } = req.body;
    const moderation = moderateMessage(req.user.id, req.user.username, content);
    if (!moderation.allowed) return res.send(moderation.message);
    const image = req.file ? '/uploads/' + req.file.filename : null;
    let fullContent = content;
    if (image) fullContent += `<br><img src="${image}" style="max-width:100%">`;
    db.run(`INSERT INTO comments (topic_id, author_id, content) VALUES (?, ?, ?)`, [req.params.id, req.user.id, fullContent], (err) => {
        res.redirect(`/topic/${req.params.id}`);
    });
});

// Лайки
app.post('/comment/:id/rate', checkUser, (req, res) => {
    if (!req.user) return res.redirect('/login');
    const { type } = req.body;
    db.get(`SELECT * FROM likes_track WHERE user_id = ? AND comment_id = ?`, [req.user.id, req.params.id], (err, existing) => {
        if (existing) return res.redirect(`/topic/${req.params.id}?error=already_rated`);
        const value = type === 'like' ? 1 : -1;
        db.run(`INSERT INTO likes_track (user_id, comment_id, value) VALUES (?, ?, ?)`, [req.user.id, req.params.id, value], (err) => {
            const field = type === 'like' ? 'likes' : 'dislikes';
            db.run(`UPDATE comments SET ${field} = ${field} + 1 WHERE id = ?`, [req.params.id]);
            db.get(`SELECT author_id, topic_id FROM comments WHERE id = ?`, [req.params.id], (err, c) => {
                if (c) {
                    db.run(`UPDATE users SET rating = rating + ? WHERE id = ?`, [value, c.author_id]);
                    db.get(`SELECT rating FROM users WHERE id = ?`, [c.author_id], (err, u) => {
                        if (u) checkAchievements(c.author_id, u.rating);
                    });
                    res.redirect(`/topic/${c.topic_id}`);
                } else res.redirect('/');
            });
        });
    });
});

// Профиль
app.get('/user/:id', checkUser, (req, res) => {
    db.get(`SELECT * FROM users WHERE id = ?`, [req.params.id], (err, profileUser) => {
        if (!profileUser) return res.send("Не найден");
        db.get(`SELECT COUNT(*) as count FROM likes_track WHERE comment_id IN (SELECT id FROM comments WHERE author_id = ?) AND value = 1`, [req.params.id], (err, pr) => {
            const positiveRating = pr ? pr.count : 0;
            db.get(`SELECT COUNT(*) as count FROM likes_track WHERE comment_id IN (SELECT id FROM comments WHERE author_id = ?) AND value = -1`, [req.params.id], (err, nr) => {
                const negativeRating = nr ? nr.count : 0;
                db.all(`SELECT * FROM topics WHERE author_id = ? AND is_deleted = 0 ORDER BY id DESC`, [req.params.id], (err, topics) => {
                    db.all(`SELECT comments.*, topics.title FROM comments JOIN topics ON comments.topic_id = topics.id WHERE comments.author_id = ? AND comments.is_deleted = 0 ORDER BY id DESC`, [req.params.id], (err, comments) => {
                        db.all(`SELECT pc.*, u.username, u.avatar FROM profile_comments pc JOIN users u ON pc.author_id = u.id WHERE pc.target_user_id = ? ORDER BY pc.created_at DESC`, [req.params.id], (err, profileComments) => {
                            res.render('profile', { user: req.user, profileUser, positiveRating, negativeRating, topics: topics || [], comments: comments || [], profileComments: profileComments || [] });
                        });
                    });
                });
            });
        });
    });
});

app.post('/update_profile', checkUser, upload.single('avatar'), (req, res) => {
    const { username, side } = req.body;
    let avatarPath = req.user.avatar;
    if (req.file) avatarPath = '/uploads/' + req.file.filename;
    db.run(`UPDATE users SET username = ?, side = ?, avatar = ? WHERE id = ?`, [username, side, avatarPath, req.user.id], () => res.redirect(`/user/${req.user.id}`));
});

// Чат
app.get('/chat', checkUser, (req, res) => {
    if (!req.user) return res.redirect('/login');
    res.render('chat', { user: req.user });
});

app.get('/api/chat-history', (req, res) => {
    db.all(`SELECT * FROM chat_messages WHERE is_deleted = 0 ORDER BY created_at ASC LIMIT 50`, (err, m) => res.json(m || []));
});

// Группы
app.get('/groups', checkUser, (req, res) => {
    if (!req.user) return res.redirect('/login');
    db.all(`SELECT g.*, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as members_count FROM chat_groups g JOIN group_members gm ON g.id = gm.group_id WHERE gm.user_id = ? ORDER BY g.created_at DESC`, [req.user.id], (err, myGroups) => {
        db.all(`SELECT g.*, u.username as creator_username, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as members_count FROM chat_groups g JOIN users u ON g.creator_id = u.id WHERE g.is_public = 1 AND g.id NOT IN (SELECT group_id FROM group_members WHERE user_id = ?)`, [req.user.id], (err, publicGroups) => {
            db.all(`SELECT gi.*, g.name as group_name FROM group_invites gi JOIN chat_groups g ON gi.group_id = g.id WHERE gi.receiver_id = ? AND gi.status = 'pending'`, [req.user.id], (err, invites) => {
                res.render('groups', { user: req.user, myGroups: myGroups || [], publicGroups: publicGroups || [], invites: invites || [] });
            });
        });
    });
});

app.post('/create-group', checkUser, (req, res) => {
    const { name, is_public } = req.body;
    const isPublic = is_public ? 1 : 0;
    db.run(`INSERT INTO chat_groups (name, creator_id, is_public) VALUES (?, ?, ?)`, [name.trim(), req.user.id, isPublic], function(err) {
        db.run(`INSERT INTO group_members (group_id, user_id) VALUES (?, ?)`, [this.lastID, req.user.id]);
        res.redirect(`/group/${this.lastID}`);
    });
});

app.get('/group/:id', checkUser, (req, res) => {
    db.get(`SELECT * FROM group_members WHERE group_id = ? AND user_id = ? AND status = 'active'`, [req.params.id, req.user.id], (err, member) => {
        if (!member) return res.send("Вы не участник");
        db.get(`SELECT * FROM chat_groups WHERE id = ?`, [req.params.id], (err, group) => {
            db.all(`SELECT u.id as user_id, u.username, u.avatar FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ? AND gm.status = 'active'`, [req.params.id], (err, members) => {
                res.render('group_chat', { user: req.user, group, members: members || [] });
            });
        });
    });
});

app.get('/api/group-messages/:id', (req, res) => {
    db.all(`SELECT gm.*, u.username, u.avatar FROM group_messages gm JOIN users u ON gm.sender_id = u.id WHERE gm.group_id = ? AND gm.is_deleted = 0 ORDER BY gm.created_at ASC LIMIT 100`, [req.params.id], (err, m) => res.json(m || []));
});

// Поддержка
app.get('/support', checkUser, (req, res) => {
    if (!req.user) return res.redirect('/login');
    db.all(`SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC`, [req.user.id], (err, tickets) => {
        res.render('support', { user: req.user, tickets: tickets || [] });
    });
});

// Админ-панель
app.get('/admin', (req, res) => {
    if (!req.cookies.userId) return res.redirect('/login');
    db.get(`SELECT * FROM users WHERE id = ?`, [req.cookies.userId], (err, user) => {
        if (!user || !['founder','admin','moderator','support'].includes(user.role)) return res.send('Нет доступа');
        db.all(`SELECT * FROM users ORDER BY id DESC`, (err, users) => {
            db.all(`SELECT b.*, u.username, u.avatar FROM bans b JOIN users u ON b.user_id = u.id WHERE b.banned_until > datetime('now') OR b.is_permanent = 1`, (err, bans) => {
                db.all(`SELECT m.*, u.username, u.avatar FROM mutes m JOIN users u ON m.user_id = u.id WHERE m.muted_until > datetime('now')`, (err, mutes) => {
                    db.all(`SELECT t.*, u.username as author_username FROM topics t JOIN users u ON t.author_id = u.id WHERE t.is_deleted = 0 ORDER BY t.id DESC LIMIT 20`, (err, topics) => {
                        db.all(`SELECT c.*, u.username as author_username, t.title as topic_title FROM comments c JOIN users u ON c.author_id = u.id JOIN topics t ON c.topic_id = t.id WHERE c.is_deleted = 0 ORDER BY c.id DESC LIMIT 20`, (err, comments) => {
                            res.render('admin_panel', { user, users: users || [], bans: bans || [], mutes: mutes || [], topics: topics || [], comments: comments || [] });
                        });
                    });
                });
            });
        });
    });
});

app.post('/api/ban-user', (req, res) => {
    const { userId, reason, duration } = req.body;
    const m = duration === 'permanent' ? [1, null] : [0, new Date(Date.now() + parseInt(duration) * 3600000).toISOString()];
    db.run(`INSERT INTO bans (user_id, admin_id, reason, banned_until, is_permanent) VALUES (?, ?, ?, ?, ?)`, [userId, req.cookies.userId, reason, m[1], m[0]]);
    db.run(`UPDATE users SET is_banned = 1 WHERE id = ?`, [userId]);
    res.json({ success: true });
});

app.post('/api/unban-user', (req, res) => {
    db.run(`UPDATE users SET is_banned = 0 WHERE id = ?`, [req.body.userId]);
    db.run(`DELETE FROM bans WHERE user_id = ?`, [req.body.userId]);
    res.json({ success: true });
});

app.post('/api/mute-user', (req, res) => {
    const m = new Date(Date.now() + parseInt(req.body.duration) * 3600000).toISOString();
    db.run(`INSERT INTO mutes (user_id, admin_id, reason, muted_until) VALUES (?, ?, ?, ?)`, [req.body.userId, req.cookies.userId, req.body.reason, m]);
    db.run(`UPDATE users SET is_muted = 1, muted_until = ? WHERE id = ?`, [m, req.body.userId]);
    res.json({ success: true });
});

app.post('/api/unmute-user', (req, res) => {
    db.run(`UPDATE users SET is_muted = 0 WHERE id = ?`, [req.body.userId]);
    res.json({ success: true });
});

app.post('/api/delete-topic', (req, res) => {
    db.run(`UPDATE topics SET is_deleted = 1 WHERE id = ?`, [req.body.topicId]);
    res.json({ success: true });
});

app.post('/api/delete-comment', (req, res) => {
    db.run(`UPDATE comments SET is_deleted = 1 WHERE id = ?`, [req.body.commentId]);
    res.json({ success: true });
});

app.post('/api/change-role', (req, res) => {
    const p = { admin: '🛡️ Администратор', support: '🔧 Техподдержка', moderator: '⚡ Модератор', user: '' };
    db.run(`UPDATE users SET role = ?, tag = ? WHERE id = ?`, [req.body.role, p[req.body.role] || '', req.body.userId]);
    res.json({ success: true });
});

// API
app.get('/api/top-users', (req, res) => {
    db.all(`SELECT id, username, avatar, rating FROM users WHERE is_banned = 0 ORDER BY rating DESC LIMIT 10`, (err, u) => res.json(u || []));
});

app.get('/api/popular-topics', (req, res) => {
    db.all(`SELECT t.id, t.title, COUNT(c.id) as comments_count FROM topics t LEFT JOIN comments c ON t.id = c.topic_id AND c.is_deleted = 0 WHERE t.is_deleted = 0 GROUP BY t.id ORDER BY comments_count DESC LIMIT 5`, (err, t) => res.json(t || []));
});

app.get('/api/achievements/:userId', (req, res) => {
    db.all(`SELECT a.*, CASE WHEN ua.id IS NOT NULL THEN 1 ELSE 0 END as unlocked FROM achievements a LEFT JOIN user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = ? ORDER BY a.min_rating ASC`, [req.params.userId], (err, a) => res.json(a || []));
});

app.get('/settings', checkUser, (req, res) => {
    db.get(`SELECT * FROM user_settings WHERE user_id = ?`, [req.user.id], (err, s) => res.render('settings', { user: req.user, settings: s }));
});

app.post('/api/update-settings', checkUser, (req, res) => {
    db.run(`INSERT OR REPLACE INTO user_settings (user_id, do_not_message, show_online) VALUES (?, ?, ?)`, [req.user.id, req.body.doNotMessage, req.body.showOnline]);
    res.json({ success: true });
});

// Основатель
app.get('/make-me-founder/:secret', (req, res) => {
    if (req.params.secret !== 'hl2secret2026') return res.send('Неверный ключ!');
    db.run(`UPDATE users SET role = 'founder', tag = '👑 Основатель' WHERE username = 'Сифан'`, [], (err) => {
        if (err) return res.send('Ошибка: ' + err.message);
        res.send('✅ Ты теперь основатель! <a href="/">На форум</a>');
    });
});

// Апелляция
app.get('/appeal', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Апелляция</title><link rel="stylesheet" href="/css/style.css"></head><body><div class="container auth-form"><h2>📝 Апелляция</h2><form action="/submit-appeal" method="POST"><input name="username" placeholder="Ник" required><select name="type"><option value="ban">Бан</option><option value="mute">Мут</option></select><textarea name="reason" placeholder="Опишите..." required></textarea><button type="submit">Отправить</button></form></div></body></html>`);
});

app.post('/submit-appeal', (req, res) => {
    db.get(`SELECT id FROM users WHERE username = ?`, [req.body.username], (err, u) => {
        if (!u) return res.send("Не найден");
        db.run(`INSERT INTO appeals (user_id, type, reason) VALUES (?, ?, ?)`, [u.id, req.body.type, req.body.reason]);
        res.send('<h2>✅ Отправлено!</h2><a href="/">На главную</a>');
    });
});

app.use((req, res) => { res.status(404).send("Страница не найдена"); });

const serverHttp = http.createServer(app);
const io = new Server(serverHttp);

io.on('connection', (socket) => {
    socket.on('chat message', (msg) => {
        const mod = moderateMessage(msg.userId, msg.username, msg.content);
        if (!mod.allowed) return socket.emit('chat message', { userId: 0, username: 'Система', content: mod.message });
        db.run(`INSERT INTO chat_messages (user_id, username, avatar, content) VALUES (?, ?, ?, ?)`, [msg.userId, msg.username, msg.avatar, msg.content], () => io.emit('chat message', msg));
    });
    socket.on('join_group', (data) => socket.join(`group_${data.groupId}`));
    socket.on('group_message', (msg) => io.to(`group_${msg.group_id}`).emit('group_message', msg));
});

serverHttp.listen(PORT, () => console.log(`Сервер: http://localhost:${PORT}`));
