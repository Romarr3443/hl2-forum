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
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || '127.0.0.1';
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
    } else {
        req.user = null;
        next();
    }
};

app.use((req, res, next) => {
    if (req.cookies.userId) {
        db.get(`SELECT u.*, b.reason, b.banned_until, b.is_permanent FROM users u LEFT JOIN bans b ON u.id = b.user_id WHERE u.id = ? AND u.is_banned = 1 ORDER BY b.created_at DESC LIMIT 1`, [req.cookies.userId], (err, user) => {
            if (user) {
                if (!user.is_permanent && user.banned_until && new Date() > new Date(user.banned_until)) {
                    db.run(`UPDATE users SET is_banned = 0 WHERE id = ?`, [user.id]);
                    return next();
                }
                return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>🚫 ВЫ ЗАБАНЕНЫ</title><style>*{margin:0;padding:0}body{background:#0a0000;color:red;display:flex;justify-content:center;align-items:center;height:100vh;font-family:monospace}.ban-box{text-align:center;padding:50px;border:5px solid red;border-radius:20px;background:rgba(255,0,0,.1)}h1{font-size:4em}button{padding:10px 20px;background:#ff9900;border:none;border-radius:5px;cursor:pointer;margin-top:20px}</style></head><body><div class="ban-box"><h1>🚫 ВЫ ЗАБАНЕНЫ</h1><p>${user.is_permanent ? '⚡ НАВСЕГДА' : 'До: ' + new Date(user.banned_until).toLocaleString('ru-RU')}</p><p>Причина: ${user.reason || 'Нарушение правил'}</p><a href="/appeal"><button>📝 Подать апелляцию</button></a></div></body></html>`);
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
        if (err) return res.send("Ошибка загрузки тем");
        res.render('index', { user: req.user, topics: topics || [] });
    });
});

// Логин/Регистрация
app.get('/login', checkUser, (req, res) => res.render('login', { user: req.user }));
app.get('/register', checkUser, (req, res) => res.render('register', { user: req.user }));

app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (password.length < 8) return res.send("❌ Пароль не менее 8 символов!");
    if (!/[A-Z]/.test(password)) return res.send("❌ Нужна заглавная буква!");
    if (!/[0-9]/.test(password)) return res.send("❌ Нужна цифра!");
    
    bcrypt.hash(password, 10, (err, hash) => {
        if (err) return res.send("Ошибка сервера");
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
    if (content.length < 10) return res.send("Описание слишком короткое!");
    const moderation = moderateMessage(req.user.id, req.user.username, title + ' ' + content);
    if (!moderation.allowed) return res.send(moderation.message);
    const image = req.file ? '/uploads/' + req.file.filename : null;
    db.run(`INSERT INTO topics (title, content, image, author_id) VALUES (?, ?, ?, ?)`, [title, content, image, req.user.id], (err) => {
        if (err) return res.send("Ошибка");
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
            db.get(`SELECT author_id FROM comments WHERE id = ?`, [req.params.id], (err, c) => {
                if (c) {
                    db.run(`UPDATE users SET rating = rating + ? WHERE id = ?`, [value, c.author_id]);
                    db.get(`SELECT rating FROM users WHERE id = ?`, [c.author_id], (err, u) => {
                        if (u) checkAchievements(c.author_id, u.rating);
                    });
                }
            });
            res.redirect(`/topic/${req.params.id}`);
        });
    });
});

// Профиль
app.get('/user/:id', checkUser, (req, res) => {
    db.get(`SELECT * FROM users WHERE id = ?`, [req.params.id], (err, profileUser) => {
        if (!profileUser) return res.send("Не найден");
        db.all(`SELECT * FROM topics WHERE author_id = ? AND is_deleted = 0 ORDER BY id DESC`, [req.params.id], (err, topics) => {
            db.all(`SELECT comments.*, topics.title FROM comments JOIN topics ON comments.topic_id = topics.id WHERE comments.author_id = ? AND comments.is_deleted = 0 ORDER BY id DESC`, [req.params.id], (err, comments) => {
                db.all(`SELECT pc.*, u.username, u.avatar FROM profile_comments pc JOIN users u ON pc.author_id = u.id WHERE pc.target_user_id = ? ORDER BY pc.created_at DESC`, [req.params.id], (err, profileComments) => {
                    res.render('profile', { user: req.user, profileUser, positiveRating: 0, negativeRating: 0, topics: topics || [], comments: comments || [], profileComments: profileComments || [] });
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

// Админ-панель
app.get('/admin', (req, res) => {
    if (!req.cookies.userId) return res.redirect('/login');
    db.get(`SELECT * FROM users WHERE id = ?`, [req.cookies.userId], (err, user) => {
        if (!user || !['founder','admin','moderator','support'].includes(user.role)) return res.send('Нет доступа');
        db.all(`SELECT * FROM users ORDER BY id DESC`, (err, users) => {
            res.render('admin_panel', { user, users: users || [], bans: [], mutes: [], topics: [], comments: [] });
        });
    });
});

// API
app.get('/api/top-users', (req, res) => {
    db.all(`SELECT id, username, avatar, rating FROM users WHERE is_banned = 0 ORDER BY rating DESC LIMIT 10`, (err, u) => res.json(u || []));
});

app.get('/api/popular-topics', (req, res) => {
    db.all(`SELECT t.id, t.title, COUNT(c.id) as comments_count FROM topics t LEFT JOIN comments c ON t.id = c.topic_id AND c.is_deleted = 0 WHERE t.is_deleted = 0 GROUP BY t.id ORDER BY comments_count DESC LIMIT 5`, (err, t) => res.json(t || []));
});

// ВРЕМЕННО: Сделать основателем
app.get('/make-me-founder/:secret', (req, res) => {
    if (req.params.secret !== 'hl2secret2026') return res.send('Неверный ключ!');
    db.run(`UPDATE users SET role = 'founder', tag = '👑 Основатель' WHERE username = 'ТВОЙ_НИК'`, [], (err) => {
        if (err) return res.send('Ошибка: ' + err.message);
        res.send('✅ Ты теперь основатель! <a href="/">На форум</a>');
    });
});

// Апелляция
app.get('/appeal', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Апелляция</title><link rel="stylesheet" href="/css/style.css"></head><body><div class="container auth-form"><h2>📝 Подача апелляции</h2><form action="/submit-appeal" method="POST"><input name="username" placeholder="Ник" required><select name="type"><option value="ban">Бан</option><option value="mute">Мут</option></select><textarea name="reason" placeholder="Опишите ситуацию..." required></textarea><button type="submit">Отправить</button></form></div></body></html>`);
});

app.post('/submit-appeal', (req, res) => {
    db.get(`SELECT id FROM users WHERE username = ?`, [req.body.username], (err, u) => {
        if (!u) return res.send("Не найден");
        db.run(`INSERT INTO appeals (user_id, type, reason) VALUES (?, ?, ?)`, [u.id, req.body.type, req.body.reason]);
        res.send('<h2>✅ Отправлено!</h2><a href="/">На главную</a>');
    });
});

// Поддержка
app.get('/support', checkUser, (req, res) => {
    if (!req.user) return res.redirect('/login');
    db.all(`SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC`, [req.user.id], (err, tickets) => {
        res.render('support', { user: req.user, tickets: tickets || [] });
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
});

serverHttp.listen(PORT, () => console.log(`Сервер: http://localhost:${PORT}`));
