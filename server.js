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

const db = require('./database');

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
function getFingerprint(req) {
    return req.headers['user-agent'] || 'unknown';
}

const checkUser = (req, res, next) => {
    if (req.cookies.userId) {
        db.get(`SELECT * FROM users WHERE id = ?`, [req.cookies.userId], (err, user) => {
            if (err) { req.user = null; }
            else {
                req.user = user;
                if (user && user.is_muted && user.muted_until) {
                    const now = new Date();
                    const mutedUntil = new Date(user.muted_until);
                    if (now > mutedUntil) {
                        db.run(`UPDATE users SET is_muted = 0, muted_until = NULL WHERE id = ?`, [user.id]);
                        req.user.is_muted = 0;
                    }
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
        db.get(`SELECT u.*, b.reason, b.banned_until, b.is_permanent 
                FROM users u 
                LEFT JOIN bans b ON u.id = b.user_id 
                WHERE u.id = ? AND u.is_banned = 1 
                ORDER BY b.created_at DESC LIMIT 1`, 
            [req.cookies.userId], (err, user) => {
            if (user && user.is_banned) {
                if (!user.is_permanent && user.banned_until) {
                    const now = new Date();
                    const until = new Date(user.banned_until);
                    if (now > until) {
                        db.run(`UPDATE users SET is_banned = 0 WHERE id = ?`, [user.id]);
                        return next();
                    }
                }
                
                return res.send(`
                    <!DOCTYPE html>
                    <html><head><meta charset="UTF-8"><title>🚫 ВЫ ЗАБАНЕНЫ</title>
                    <style>
                        *{margin:0;padding:0;box-sizing:border-box}
                        body{background:#0a0000;color:#f00;font-family:'Courier New',monospace;display:flex;justify-content:center;align-items:center;height:100vh;overflow:hidden}
                        .ban-container{text-align:center;animation:shake .5s infinite;padding:50px;border:5px solid red;border-radius:20px;background:rgba(255,0,0,.1);box-shadow:0 0 100px rgba(255,0,0,.5)}
                        .ban-title{font-size:5em;font-weight:700;text-shadow:0 0 50px red;animation:pulse 1s infinite}
                        .ban-info{font-size:1.5em;margin:20px 0;color:#f66}
                        .ban-reason{font-size:1.2em;color:#f99;margin:15px 0;padding:15px;border:1px solid red;border-radius:10px;background:rgba(255,0,0,.2)}
                        @keyframes shake{0%,100%{transform:translateX(0)}10%,90%{transform:translateX(-5px)}20%,80%{transform:translateX(5px)}30%,70%{transform:translateX(-5px)}40%,60%{transform:translateX(5px)}}
                        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
                        .siren{position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;background:repeating-linear-gradient(0deg,transparent,transparent 20px,rgba(255,0,0,.05) 20px,rgba(255,0,0,.05) 40px);animation:siren-move 2s linear infinite}
                        @keyframes siren-move{0%{background-position:0 0}100%{background-position:0 40px}}
                    </style></head>
                    <body>
                        <div class="siren"></div>
                        <div class="ban-container">
                            <div class="ban-title">🚫 ВЫ ЗАБАНЕНЫ</div>
                            <div class="ban-info">
                                ${user.is_permanent ? '<p style="color:#f00;font-size:2em;">⚡ ПЕРМАНЕНТНЫЙ БАН</p>' : `<p>Бан истекает: <strong>${new Date(user.banned_until).toLocaleString('ru-RU')}</strong></p>`}
                            </div>
                            <div class="ban-reason"><strong>Причина:</strong> ${user.reason || 'Нарушение правил'}</div>
                            <p style="color:#888;margin-top:20px;">Подать апелляцию: <a href="/appeal" style="color:#ff9900;">здесь</a></p>
                        </div>
                    </body></html>
                `);
            }
            next();
        });
    } else {
        next();
    }
});

function checkAchievements(userId, rating) {
    db.all(`SELECT * FROM achievements WHERE min_rating <= ?`, [rating], (err, achievements) => {
        if (err) return;
        achievements.forEach(achievement => {
            db.run(`INSERT OR IGNORE INTO user_achievements (user_id, achievement_id) VALUES (?, ?)`, [userId, achievement.id], function(err) {
                if (!err && this.changes > 0) {
                    db.get(`SELECT a.tag FROM achievements a JOIN user_achievements ua ON a.id = ua.achievement_id WHERE ua.user_id = ? ORDER BY a.min_rating DESC LIMIT 1`, [userId], (err, best) => {
                        if (!err && best) db.run(`UPDATE users SET tag = ? WHERE id = ?`, [best.tag, userId]);
                    });
                }
            });
        });
    });
}

// ==================== МУЗЫКА ====================
app.get('/api/music-files', (req, res) => {
    const audioDir = path.join(__dirname, 'public', 'audio');
    fs.readdir(audioDir, (err, files) => {
        if (err) return res.json({ files: [] });
        res.json({ files: files.filter(f => f.endsWith('.mp3')) });
    });
});

// ==================== ГЛАВНАЯ ====================
// ВРЕМЕННЫЙ МАРШРУТ ДЛЯ СОЗДАНИЯ ОСНОВАТЕЛЯ
// После использования можно удалить
app.get('/make-me-founder/:secret', (req, res) => {
    if (req.params.secret !== 'hl2secret2026') return res.send('Неверный ключ!');
    
    db.run(`UPDATE users SET role = 'founder', tag = '👑 Основатель' WHERE username = ?`, 
        ['Сифан'],  // ЗАМЕНИ НА СВОЙ НИК!
        (err) => {
            if (err) return res.send('Ошибка: ' + err.message);
            res.send('✅ Ты теперь основатель! <a href="/">На форум</a>');
        }
    );
});

app.get('/', checkUser, (req, res) => {
    db.all(`SELECT topics.*, users.username, users.avatar, users.side FROM topics JOIN users ON topics.author_id = users.id WHERE topics.is_deleted = 0 ORDER BY topics.id DESC`, (err, topics) => {
        if (err) return res.send("Ошибка загрузки тем");
        res.render('index', { user: req.user, topics: topics });
    });
});

// ==================== АВТОРИЗАЦИЯ ====================
app.get('/login', checkUser, (req, res) => res.render('login', { user: req.user }));
app.get('/register', checkUser, (req, res) => res.render('register', { user: req.user }));

app.post('/register', (req, res) => {
    const { username, password } = req.body;
    const ip = getClientIP(req);
    const fingerprint = getFingerprint(req);
    
    if (password.length < 8) return res.send("❌ Пароль должен быть не менее 8 символов!");
    if (!/[A-Z]/.test(password)) return res.send("❌ Пароль должен содержать заглавную букву!");
    if (!/[0-9]/.test(password)) return res.send("❌ Пароль должен содержать цифру!");
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) return res.send("❌ Пароль должен содержать спецсимвол!");
    
    db.get(`SELECT * FROM permanent_bans WHERE ip_address = ? OR fingerprint = ?`, [ip, fingerprint], (err, ban) => {
        if (ban) return res.send("❌ ДОСТУП ЗАПРЕЩЁН! Вы навсегда забанены.");
        
        db.get(`SELECT * FROM user_ips WHERE ip_address = ? AND user_id IN (SELECT user_id FROM bans WHERE is_permanent = 1)`, [ip], (err, linkedBan) => {
            if (linkedBan) {
                db.run(`INSERT INTO permanent_bans (ip_address, fingerprint, reason) VALUES (?, ?, ?)`, [ip, fingerprint, 'Мульти-аккаунт']);
                return res.send("❌ ДОСТУП ЗАПРЕЩЁН! Ваш IP связан с забаненным аккаунтом.");
            }
            
            bcrypt.hash(password, 14, (err, hash) => {
                if (err) return res.send("Ошибка сервера");
                db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hash], function(err) {
                    if (err) return res.send("Ошибка: пользователь уже существует");
                    db.run(`INSERT INTO user_ips (user_id, ip_address, user_agent, fingerprint) VALUES (?, ?, ?, ?)`, [this.lastID, ip, fingerprint, fingerprint]);
                    res.redirect('/login');
                });
            });
        });
    });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
        if (err) return res.send("Ошибка базы данных");
        if (!user) return res.send('Пользователь не найден');
        if (user.is_banned) return res.send("Ваш аккаунт забанен.");
        bcrypt.compare(password, user.password, (err, match) => {
            if (err) return res.send("Ошибка");
            if (match) { res.cookie('userId', user.id); res.redirect('/'); }
            else res.send('Неверный пароль');
        });
    });
});

app.get('/logout', (req, res) => { res.clearCookie('userId'); res.redirect('/'); });

// ==================== ТЕМЫ ====================
app.get('/new', checkUser, (req, res) => {
    if (!req.user) return res.redirect('/login');
    res.render('new_topic', { user: req.user });
});

app.post('/new', checkUser, upload.single('image'), (req, res) => {
    if (!req.user) return res.redirect('/login');
    const { title, content } = req.body;
    
    if (title.length < 3) return res.send("❌ Заголовок должен быть не менее 3 символов!");
    if (title.length > 200) return res.send("❌ Заголовок не должен превышать 200 символов!");
    if (content.length < 10) return res.send("❌ Описание должно быть не менее 10 символов!");
    if (content.length > 10000) return res.send("❌ Описание не должно превышать 10000 символов!");
    
    const moderation = moderateMessage(req.user.id, req.user.username, title + ' ' + content);
    if (!moderation.allowed) return res.send(moderation.message);
    
    const image = req.file ? '/uploads/' + req.file.filename : null;
    db.run(`INSERT INTO topics (title, content, image, author_id) VALUES (?, ?, ?, ?)`, [title, content, image, req.user.id], (err) => {
        if (err) return res.send("Ошибка при создании темы");
        res.redirect('/');
    });
});

app.get('/topic/:id', checkUser, (req, res) => {
    const topicId = req.params.id;
    const error = req.query.error || null;
    db.get(`SELECT * FROM topics WHERE id = ? AND is_deleted = 0`, [topicId], (err, topic) => {
        if (err || !topic) return res.send("Тема не найдена");
        db.get(`SELECT username, avatar, side FROM users WHERE id = ?`, [topic.author_id], (err, author) => {
            if (err) return res.send("Ошибка");
            topic.author = author;
            db.all(`SELECT comments.*, users.username, users.avatar, users.side FROM comments JOIN users ON comments.author_id = users.id WHERE topic_id = ? AND comments.is_deleted = 0 ORDER BY id ASC`, [topicId], (err, comments) => {
                if (err) return res.send("Ошибка");
                res.render('topic', { user: req.user, topic: topic, comments: comments, error: error });
            });
        });
    });
});

app.post('/topic/:id/comment', checkUser, upload.single('image'), (req, res) => {
    if (!req.user) return res.redirect('/login');
    if (req.user.is_muted) return res.send("Вы замучены!");
    const topicId = req.params.id;
    const { content } = req.body;
    
    if (content.length < 2) return res.send("❌ Комментарий слишком короткий!");
    if (content.length > 5000) return res.send("❌ Комментарий не должен превышать 5000 символов!");
    
    const moderation = moderateMessage(req.user.id, req.user.username, content);
    if (!moderation.allowed) return res.send(moderation.message);
    
    const image = req.file ? '/uploads/' + req.file.filename : null;
    let fullContent = content;
    if (image) fullContent += `<br><img src="${image}" style="max-width:100%">`;
    db.run(`INSERT INTO comments (topic_id, author_id, content) VALUES (?, ?, ?)`, [topicId, req.user.id, fullContent], (err) => {
        if (err) return res.send("Ошибка");
        res.redirect(`/topic/${topicId}`);
    });
});

// ==================== ЛАЙКИ ====================
app.post('/comment/:id/rate', checkUser, (req, res) => {
    if (!req.user) return res.redirect('/login');
    const commentId = req.params.id;
    const type = req.body.type;
    const userId = req.user.id;
    if (type !== 'like' && type !== 'dislike') return res.redirect('/');
    
    db.get(`SELECT * FROM likes_track WHERE user_id = ? AND comment_id = ?`, [userId, commentId], (err, existing) => {
        if (err) return res.redirect('/');
        if (existing) {
            db.get(`SELECT topic_id FROM comments WHERE id = ?`, [commentId], (err, comment) => {
                res.redirect(`/topic/${comment.topic_id}?error=already_rated`);
            });
            return;
        }
        const value = type === 'like' ? 1 : -1;
        db.run(`INSERT INTO likes_track (user_id, comment_id, value) VALUES (?, ?, ?)`, [userId, commentId, value], (err) => {
            const field = type === 'like' ? 'likes' : 'dislikes';
            db.run(`UPDATE comments SET ${field} = ${field} + 1 WHERE id = ?`, [commentId], (err) => {
                db.get(`SELECT author_id FROM comments WHERE id = ?`, [commentId], (err, comment) => {
                    if (err || !comment) return res.redirect('/');
                    db.run(`UPDATE users SET rating = rating + ? WHERE id = ?`, [value, comment.author_id], (err) => {
                        db.get(`SELECT rating FROM users WHERE id = ?`, [comment.author_id], (err, user) => {
                            if (!err && user) checkAchievements(comment.author_id, user.rating);
                        });
                    });
                    db.get(`SELECT topic_id FROM comments WHERE id = ?`, [commentId], (err, comment) => {
                        res.redirect(`/topic/${comment.topic_id}`);
                    });
                });
            });
        });
    });
});

// ==================== ПРОФИЛЬ ====================
app.get('/user/:id', checkUser, (req, res) => {
    const userId = req.params.id;
    db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, profileUser) => {
        if (err || !profileUser) return res.send("Пользователь не найден");
        db.get(`SELECT COUNT(*) as count FROM likes_track WHERE comment_id IN (SELECT id FROM comments WHERE author_id = ?) AND value = 1`, [userId], (err, pr) => {
            const positiveRating = pr ? pr.count : 0;
            db.get(`SELECT COUNT(*) as count FROM likes_track WHERE comment_id IN (SELECT id FROM comments WHERE author_id = ?) AND value = -1`, [userId], (err, nr) => {
                const negativeRating = nr ? nr.count : 0;
                db.all(`SELECT * FROM topics WHERE author_id = ? AND is_deleted = 0 ORDER BY id DESC`, [userId], (err, topics) => {
                    if (err) topics = [];
                    db.all(`SELECT comments.*, topics.title FROM comments JOIN topics ON comments.topic_id = topics.id WHERE comments.author_id = ? AND comments.is_deleted = 0 ORDER BY id DESC`, [userId], (err, comments) => {
                        if (err) comments = [];
                        db.all(`SELECT pc.*, u.username, u.avatar FROM profile_comments pc JOIN users u ON pc.author_id = u.id WHERE pc.target_user_id = ? AND pc.is_deleted = 0 ORDER BY pc.created_at DESC`, [userId], (err, profileComments) => {
                            if (err) profileComments = [];
                            res.render('profile', { user: req.user, profileUser: profileUser, positiveRating: positiveRating, negativeRating: negativeRating, topics: topics, comments: comments, profileComments: profileComments });
                        });
                    });
                });
            });
        });
    });
});

app.post('/update_profile', checkUser, upload.single('avatar'), (req, res) => {
    if (!req.user) return res.redirect('/login');
    const { username, side } = req.body;
    let avatarPath = req.user.avatar;
    if (req.file) avatarPath = '/uploads/' + req.file.filename;
    db.run(`UPDATE users SET username = ?, side = ?, avatar = ? WHERE id = ?`, [username, side, avatarPath, req.user.id], (err) => {
        if (err) return res.send("Ошибка");
        res.redirect(`/user/${req.user.id}`);
    });
});

app.post('/user/:id/comment', checkUser, (req, res) => {
    if (!req.user) return res.redirect('/login');
    if (req.user.id == req.params.id) return res.redirect(`/user/${req.params.id}`);
    db.run(`INSERT INTO profile_comments (target_user_id, author_id, content) VALUES (?, ?, ?)`, [req.params.id, req.user.id, req.body.content], (err) => {
        res.redirect(`/user/${req.params.id}`);
    });
});

app.post('/user/:id/comment/:commentId/delete', checkUser, (req, res) => {
    db.run(`DELETE FROM profile_comments WHERE id = ? AND author_id = ?`, [req.params.commentId, req.user.id], (err) => {
        res.redirect(`/user/${req.params.id}`);
    });
});

// ==================== ЧАТ ====================
app.get('/chat', checkUser, (req, res) => {
    if (!req.user) return res.redirect('/login');
    res.render('chat', { user: req.user });
});

app.get('/api/chat-history', (req, res) => {
    db.all(`SELECT * FROM chat_messages WHERE is_deleted = 0 ORDER BY created_at ASC LIMIT 50`, (err, messages) => {
        if (err) return res.json([]);
        res.json(messages);
    });
});

app.get('/chat/:userId', checkUser, (req, res) => {
    if (!req.user) return res.redirect('/login');
    const receiverId = req.params.userId;
    db.get(`SELECT * FROM users WHERE id = ?`, [receiverId], (err, receiver) => {
        if (err || !receiver) return res.send("Пользователь не найден");
        res.render('private_chat', { user: req.user, receiver: receiver });
    });
});

app.get('/api/private-messages/:userId', checkUser, (req, res) => {
    const senderId = req.user.id;
    const receiverId = req.params.userId;
    db.all(`SELECT * FROM private_messages WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)) AND is_deleted = 0 ORDER BY created_at ASC`, [senderId, receiverId, receiverId, senderId], (err, messages) => {
        if (err) return res.json([]);
        res.json(messages);
    });
});

app.post('/api/send-private-message', checkUser, upload.single('file'), (req, res) => {
    if (!req.user) return res.redirect('/login');
    const { receiverId, content } = req.body;
    const moderation = moderateMessage(req.user.id, req.user.username, content);
    if (!moderation.allowed) return res.json({ error: moderation.message });
    const filePath = req.file ? '/uploads/' + req.file.filename : null;
    db.run(`INSERT INTO private_messages (sender_id, receiver_id, content, file_path) VALUES (?, ?, ?, ?)`, [req.user.id, receiverId, content, filePath], (err) => {
        if (err) return res.status(500).json({ error: "Ошибка" });
        res.json({ success: true, filePath: filePath });
    });
});

app.get('/dialogs', checkUser, (req, res) => {
    if (!req.user) return res.redirect('/login');
    res.render('dialogs', { user: req.user });
});

app.get('/api/dialogs', checkUser, (req, res) => {
    const userId = req.user.id;
    db.all(`SELECT pm.*, CASE WHEN pm.sender_id = ? THEN pm.receiver_id ELSE pm.sender_id END as dialog_user_id, u.username, u.avatar FROM private_messages pm JOIN users u ON (CASE WHEN pm.sender_id = ? THEN pm.receiver_id ELSE pm.sender_id END = u.id) WHERE (pm.sender_id = ? OR pm.receiver_id = ?) AND pm.is_deleted = 0 GROUP BY dialog_user_id ORDER BY pm.created_at DESC`, [userId, userId, userId, userId], (err, dialogs) => {
        if (err) return res.json([]);
        res.json(dialogs);
    });
});

// ==================== ГРУППЫ ====================
app.get('/groups', checkUser, (req, res) => {
    if (!req.user) return res.redirect('/login');
    
    db.all(`SELECT g.*, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as members_count FROM chat_groups g JOIN group_members gm ON g.id = gm.group_id WHERE gm.user_id = ? AND gm.status = 'active' ORDER BY g.created_at DESC`, [req.user.id], (err, myGroups) => {
        if (err) myGroups = [];
        
        db.all(`SELECT g.*, u.username as creator_username, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as members_count FROM chat_groups g JOIN users u ON g.creator_id = u.id WHERE g.is_public = 1 AND g.id NOT IN (SELECT group_id FROM group_members WHERE user_id = ?) ORDER BY g.created_at DESC`, [req.user.id], (err, publicGroups) => {
            if (err) publicGroups = [];
            
            db.all(`SELECT gi.*, g.name as group_name, u.username as sender_username FROM group_invites gi JOIN chat_groups g ON gi.group_id = g.id JOIN users u ON gi.sender_id = u.id WHERE gi.receiver_id = ? AND gi.status = 'pending' ORDER BY gi.created_at DESC`, [req.user.id], (err, invites) => {
                if (err) invites = [];
                
                res.render('groups', { 
                    user: req.user, 
                    myGroups: myGroups, 
                    publicGroups: publicGroups, 
                    invites: invites 
                });
            });
        });
    });
});

app.post('/create-group', checkUser, (req, res) => {
    if (!req.user) return res.redirect('/login');
    const { name, is_public } = req.body;
    const isPublic = is_public ? 1 : 0;
    if (!name || name.trim() === '') return res.send("Введите название группы");
    db.run(`INSERT INTO chat_groups (name, creator_id, is_public) VALUES (?, ?, ?)`, [name.trim(), req.user.id, isPublic], function(err) {
        if (err) return res.send("Ошибка создания группы");
        db.run(`INSERT INTO group_members (group_id, user_id) VALUES (?, ?)`, [this.lastID, req.user.id], (err) => {
            res.redirect(`/group/${this.lastID}`);
        });
    });
});

app.get('/group/:id', checkUser, (req, res) => {
    if (!req.user) return res.redirect('/login');
    const groupId = req.params.id;
    db.get(`SELECT * FROM group_members WHERE group_id = ? AND user_id = ? AND status = 'active'`, [groupId, req.user.id], (err, member) => {
        if (err || !member) {
            // Проверяем, открытая ли группа
            db.get(`SELECT * FROM chat_groups WHERE id = ? AND is_public = 1`, [groupId], (err, group) => {
                if (group) {
                    db.run(`INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)`, [groupId, req.user.id]);
                    return res.redirect(`/group/${groupId}`);
                }
                return res.send("Вы не являетесь участником этой группы");
            });
            return;
        }
        db.get(`SELECT * FROM chat_groups WHERE id = ?`, [groupId], (err, group) => {
            if (err || !group) return res.send("Группа не найдена");
            db.all(`SELECT u.id as user_id, u.username, u.avatar, gm.status FROM group_members gm JOIN users u ON gm.user_id = u.id WHERE gm.group_id = ? AND gm.status = 'active'`, [groupId], (err, members) => {
                if (err) members = [];
                res.render('group_chat', { user: req.user, group: group, members: members });
            });
        });
    });
});

app.get('/api/group-messages/:id', checkUser, (req, res) => {
    db.all(`SELECT gm.*, u.username, u.avatar FROM group_messages gm JOIN users u ON gm.sender_id = u.id WHERE gm.group_id = ? AND gm.is_deleted = 0 ORDER BY gm.created_at ASC LIMIT 100`, [req.params.id], (err, messages) => {
        if (err) return res.json([]);
        res.json(messages);
    });
});

app.post('/api/send-group-message', checkUser, upload.single('file'), (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Не авторизован" });
    if (req.user.is_muted) return res.status(403).json({ error: "Вы замучены" });
    const { groupId, content } = req.body;
    const moderation = moderateMessage(req.user.id, req.user.username, content);
    if (!moderation.allowed) return res.json({ error: moderation.message });
    const filePath = req.file ? '/uploads/' + req.file.filename : null;
    db.run(`INSERT INTO group_messages (group_id, sender_id, content, file_path) VALUES (?, ?, ?, ?)`, [groupId, req.user.id, content, filePath], function(err) {
        if (err) return res.status(500).json({ error: "Ошибка отправки" });
        const msg = { id: this.lastID, group_id: groupId, sender_id: req.user.id, username: req.user.username, avatar: req.user.avatar, content: content, file_path: filePath, created_at: new Date().toISOString() };
        io.to(`group_${groupId}`).emit('group_message', msg);
        res.json({ success: true, messageId: this.lastID, filePath: filePath });
    });
});

app.post('/api/invite-to-group', checkUser, (req, res) => {
    const { groupId, username } = req.body;
    db.get(`SELECT * FROM chat_groups WHERE id = ? AND creator_id = ?`, [groupId, req.user.id], (err, group) => {
        if (err || !group) return res.json({ error: "Только создатель может приглашать" });
        db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, u) => {
            if (err || !u) return res.json({ error: "Пользователь не найден" });
            if (u.id === req.user.id) return res.json({ error: "Нельзя пригласить себя" });
            db.get(`SELECT * FROM group_invites WHERE group_id = ? AND receiver_id = ? AND status = 'pending'`, [groupId, u.id], (err, inv) => {
                if (inv) return res.json({ error: "Приглашение уже отправлено" });
                db.run(`INSERT INTO group_invites (group_id, sender_id, receiver_id) VALUES (?, ?, ?)`, [groupId, req.user.id, u.id], (err) => {
                    res.json({ success: true, message: "Приглашение отправлено!" });
                });
            });
        });
    });
});

app.post('/api/handle-invite', checkUser, (req, res) => {
    const { inviteId, status } = req.body;
    db.get(`SELECT * FROM group_invites WHERE id = ? AND receiver_id = ? AND status = 'pending'`, [inviteId, req.user.id], (err, invite) => {
        if (err || !invite) return res.json({ error: "Приглашение не найдено" });
        db.run(`UPDATE group_invites SET status = ? WHERE id = ?`, [status, inviteId], (err) => {
            if (status === 'accepted') {
                db.run(`INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)`, [invite.group_id, req.user.id], (err) => {
                    res.json({ success: true, groupId: invite.group_id });
                });
            } else { res.json({ success: true }); }
        });
    });
});

// ==================== НАСТРОЙКИ ГРУПП ====================
app.get('/group/:id/settings', checkUser, (req, res) => {
    if (!req.user) return res.redirect('/login');
    db.get(`SELECT * FROM chat_groups WHERE id = ?`, [req.params.id], (err, group) => {
        if (err || !group) return res.send("Группа не найдена");
        if (group.creator_id !== req.user.id) return res.send("Только создатель может настраивать группу");
        db.all(`SELECT * FROM group_roles WHERE group_id = ?`, [req.params.id], (err, roles) => {
            if (err) roles = [];
            db.all(`SELECT gm.*, u.username, u.avatar, gmr.role_id FROM group_members gm JOIN users u ON gm.user_id = u.id LEFT JOIN group_member_roles gmr ON gm.id = gmr.member_id WHERE gm.group_id = ? AND gm.status = 'active'`, [req.params.id], (err, members) => {
                if (err) members = [];
                res.render('group_settings', { user: req.user, group: group, roles: roles, members: members });
            });
        });
    });
});

app.post('/group/:id/update', checkUser, (req, res) => {
    const { name, is_public } = req.body;
    db.run(`UPDATE chat_groups SET name = ?, is_public = ? WHERE id = ? AND creator_id = ?`, [name, is_public ? 1 : 0, req.params.id, req.user.id], (err) => {
        res.redirect(`/group/${req.params.id}/settings`);
    });
});

app.post('/api/group/:id/create-role', checkUser, (req, res) => {
    const { name, color, can_manage_roles, can_kick, can_ban, can_delete_messages } = req.body;
    db.run(`INSERT INTO group_roles (group_id, name, color, can_manage_roles, can_kick, can_ban, can_delete_messages) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [req.params.id, name, color, can_manage_roles, can_kick, can_ban, can_delete_messages], (err) => {
        if (err) return res.json({ error: "Ошибка" });
        res.json({ success: true });
    });
});

app.post('/api/group/:id/delete-role', checkUser, (req, res) => {
    db.run(`DELETE FROM group_roles WHERE id = ?`, [req.body.roleId]);
    db.run(`DELETE FROM group_member_roles WHERE role_id = ?`, [req.body.roleId]);
    res.json({ success: true });
});

app.post('/api/group/:id/assign-role', checkUser, (req, res) => {
    const { userId, roleId } = req.body;
    db.get(`SELECT id FROM group_members WHERE group_id = ? AND user_id = ? AND status = 'active'`, [req.params.id, userId], (err, member) => {
        if (err || !member) return res.json({ error: "Участник не найден" });
        db.run(`DELETE FROM group_member_roles WHERE member_id = ?`, [member.id]);
        if (roleId) db.run(`INSERT INTO group_member_roles (member_id, role_id) VALUES (?, ?)`, [member.id, roleId]);
        res.json({ success: true });
    });
});

// ==================== АДМИН-ПАНЕЛЬ ====================
app.get('/admin', (req, res) => {
    if (!req.cookies.userId) return res.redirect('/login');
    db.get(`SELECT * FROM users WHERE id = ?`, [req.cookies.userId], (err, user) => {
        if (err || !user) { res.clearCookie('userId'); return res.redirect('/login'); }
        if (!['founder','admin','moderator','support'].includes(user.role)) return res.status(403).send('Нет доступа');
        
        db.all(`SELECT * FROM users ORDER BY id DESC`, [], (err, users) => {
            if (err) users = [];
            db.all(`SELECT b.*, u.username, u.avatar FROM bans b JOIN users u ON b.user_id = u.id WHERE b.banned_until > datetime('now') OR b.is_permanent = 1 ORDER BY b.created_at DESC`, [], (err, bans) => {
                if (err) bans = [];
                db.all(`SELECT m.*, u.username, u.avatar FROM mutes m JOIN users u ON m.user_id = u.id WHERE m.muted_until > datetime('now') ORDER BY m.created_at DESC`, [], (err, mutes) => {
                    if (err) mutes = [];
                    db.all(`SELECT t.*, u.username as author_username FROM topics t JOIN users u ON t.author_id = u.id WHERE t.is_deleted = 0 ORDER BY t.id DESC LIMIT 20`, [], (err, topics) => {
                        if (err) topics = [];
                        db.all(`SELECT c.*, u.username as author_username, t.title as topic_title FROM comments c JOIN users u ON c.author_id = u.id JOIN topics t ON c.topic_id = t.id WHERE c.is_deleted = 0 ORDER BY c.id DESC LIMIT 20`, [], (err, comments) => {
                            if (err) comments = [];
                            res.render('admin_panel', { user: user, users: users, bans: bans, mutes: mutes, topics: topics, comments: comments });
                        });
                    });
                });
            });
        });
    });
});

app.post('/api/ban-user', (req, res) => {
    if (!req.cookies.userId) return res.json({ error: "Не авторизован" });
    db.get(`SELECT role FROM users WHERE id = ?`, [req.cookies.userId], (err, admin) => {
        if (!admin || !['founder','admin','moderator'].includes(admin.role)) return res.json({ error: "Нет прав" });
        const { userId, reason, duration } = req.body;
        let bannedUntil = null, isPermanent = 0;
        if (duration === 'permanent') isPermanent = 1;
        else bannedUntil = new Date(Date.now() + parseInt(duration) * 60 * 60 * 1000).toISOString();
        db.run(`INSERT INTO bans (user_id, admin_id, reason, banned_until, is_permanent) VALUES (?, ?, ?, ?, ?)`, [userId, req.cookies.userId, reason, bannedUntil, isPermanent], (err) => {
            db.run(`UPDATE users SET is_banned = 1 WHERE id = ?`, [userId]);
            if (isPermanent) {
                db.all(`SELECT ip_address, fingerprint FROM user_ips WHERE user_id = ?`, [userId], (err, ips) => {
                    if (ips) ips.forEach(ip => db.run(`INSERT INTO permanent_bans (user_id, ip_address, fingerprint, reason) VALUES (?, ?, ?, ?)`, [userId, ip.ip_address, ip.fingerprint, reason]));
                });
            }
            res.json({ success: true });
        });
    });
});

app.post('/api/unban-user', (req, res) => {
    db.run(`UPDATE users SET is_banned = 0 WHERE id = ?`, [req.body.userId]);
    db.run(`DELETE FROM bans WHERE user_id = ?`, [req.body.userId]);
    db.run(`DELETE FROM permanent_bans WHERE user_id = ?`, [req.body.userId]);
    res.json({ success: true });
});

app.post('/api/mute-user', (req, res) => {
    const { userId, reason, duration } = req.body;
    const mutedUntil = new Date(Date.now() + parseInt(duration) * 60 * 60 * 1000).toISOString();
    db.run(`INSERT INTO mutes (user_id, admin_id, reason, muted_until) VALUES (?, ?, ?, ?)`, [userId, req.cookies.userId, reason, mutedUntil]);
    db.run(`UPDATE users SET is_muted = 1, muted_until = ? WHERE id = ?`, [mutedUntil, userId]);
    res.json({ success: true });
});

app.post('/api/unmute-user', (req, res) => {
    db.run(`UPDATE users SET is_muted = 0, muted_until = NULL WHERE id = ?`, [req.body.userId]);
    db.run(`DELETE FROM mutes WHERE user_id = ?`, [req.body.userId]);
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
    if (!req.cookies.userId) return res.json({ error: "Не авторизован" });
    db.get(`SELECT role FROM users WHERE id = ?`, [req.cookies.userId], (err, admin) => {
        if (!admin || admin.role !== 'founder') return res.json({ error: "Только основатель" });
        const { userId, role } = req.body;
        const prefixes = { admin: '🛡️ Администратор', support: '🔧 Техподдержка', moderator: '⚡ Модератор', user: '' };
        db.run(`UPDATE users SET role = ?, tag = ? WHERE id = ?`, [role, prefixes[role] || '', userId], (err) => {
            res.json({ success: true });
        });
    });
});

// ==================== ПОДДЕРЖКА ====================
app.get('/support', checkUser, (req, res) => {
    if (!req.user) return res.redirect('/login');
    db.all(`SELECT t.*, u.username as assigned_username FROM support_tickets t LEFT JOIN users u ON t.assigned_to = u.id WHERE t.user_id = ? ORDER BY t.created_at DESC`, [req.user.id], (err, tickets) => {
        if (err) tickets = [];
        if (['founder','admin','support'].includes(req.user.role)) {
            db.all(`SELECT t.*, u.username as author_username, u2.username as assigned_username FROM support_tickets t JOIN users u ON t.user_id = u.id LEFT JOIN users u2 ON t.assigned_to = u2.id WHERE t.status IN ('open','in_progress') ORDER BY t.created_at DESC`, [], (err, all) => {
                if (!err) tickets = all;
                res.render('support', { user: req.user, tickets: tickets });
            });
        } else res.render('support', { user: req.user, tickets: tickets });
    });
});

app.post('/create-ticket', checkUser, (req, res) => {
    db.run(`INSERT INTO support_tickets (user_id, category, title, description) VALUES (?, ?, ?, ?)`, [req.user.id, req.body.category, req.body.title, req.body.description], function(err) {
        res.redirect('/ticket/' + this.lastID);
    });
});

app.get('/ticket/:id', checkUser, (req, res) => {
    db.get(`SELECT t.*, u.username as author_username, u2.username as assigned_username FROM support_tickets t JOIN users u ON t.user_id = u.id LEFT JOIN users u2 ON t.assigned_to = u2.id WHERE t.id = ?`, [req.params.id], (err, ticket) => {
        if (err || !ticket) return res.send("Обращение не найдено");
        db.all(`SELECT r.*, u.username FROM ticket_replies r JOIN users u ON r.user_id = u.id WHERE r.ticket_id = ? ORDER BY r.created_at ASC`, [req.params.id], (err, replies) => {
            if (err) replies = [];
            res.render('ticket', { user: req.user, ticket: ticket, replies: replies });
        });
    });
});

app.post('/ticket/:id/reply', checkUser, (req, res) => {
    const isStaff = ['founder','admin','support'].includes(req.user.role) ? 1 : 0;
    db.run(`INSERT INTO ticket_replies (ticket_id, user_id, content, is_staff) VALUES (?, ?, ?, ?)`, [req.params.id, req.user.id, req.body.content, isStaff], (err) => {
        if (isStaff) db.run(`UPDATE support_tickets SET status='in_progress', assigned_to=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='open'`, [req.user.id, req.params.id]);
        res.redirect('/ticket/' + req.params.id);
    });
});

app.post('/api/update-ticket-status', checkUser, (req, res) => {
    db.run(`UPDATE support_tickets SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [req.body.status, req.body.ticketId]);
    res.json({ success: true });
});

// ==================== АПЕЛЛЯЦИИ ====================
app.get('/appeal', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Апелляция</title><link rel="stylesheet" href="/css/style.css"></head><body><div class="container auth-form"><h2>📝 Подача апелляции</h2><form action="/submit-appeal" method="POST"><input type="text" name="username" placeholder="Ваш никнейм" required><select name="type"><option value="ban">🚫 Бан</option><option value="mute">🔇 Мут</option></select><textarea name="reason" rows="5" placeholder="Опишите ситуацию..." required></textarea><button type="submit">Отправить</button></form></div></body></html>`);
});

app.post('/submit-appeal', (req, res) => {
    db.get(`SELECT id FROM users WHERE username = ?`, [req.body.username], (err, user) => {
        if (!user) return res.send("Пользователь не найден");
        db.run(`INSERT INTO appeals (user_id, type, reason) VALUES (?, ?, ?)`, [user.id, req.body.type, req.body.reason]);
        res.send('<div class="container auth-form" style="text-align:center;"><h2>✅ Апелляция отправлена!</h2><p><a href="/">На главную</a></p></div>');
    });
});

// ==================== API ====================
app.get('/api/top-users', (req, res) => {
    db.all(`SELECT id, username, avatar, rating FROM users WHERE is_banned = 0 ORDER BY rating DESC LIMIT 10`, (err, users) => {
        res.json(users || []);
    });
});

app.get('/api/popular-topics', (req, res) => {
    db.all(`SELECT t.id, t.title, COUNT(c.id) as comments_count FROM topics t LEFT JOIN comments c ON t.id = c.topic_id AND c.is_deleted = 0 WHERE t.is_deleted = 0 GROUP BY t.id ORDER BY comments_count DESC LIMIT 5`, (err, topics) => {
        res.json(topics || []);
    });
});

app.get('/settings', checkUser, (req, res) => {
    db.get(`SELECT * FROM user_settings WHERE user_id = ?`, [req.user.id], (err, settings) => {
        res.render('settings', { user: req.user, settings: settings });
    });
});

app.post('/api/update-settings', checkUser, (req, res) => {
    db.run(`INSERT OR REPLACE INTO user_settings (user_id, do_not_message, show_online) VALUES (?, ?, ?)`, [req.user.id, req.body.doNotMessage, req.body.showOnline]);
    res.json({ success: true });
});

app.get('/api/achievements/:userId', (req, res) => {
    db.all(`SELECT a.*, CASE WHEN ua.id IS NOT NULL THEN 1 ELSE 0 END as unlocked FROM achievements a LEFT JOIN user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = ? ORDER BY a.min_rating ASC`, [req.params.userId], (err, a) => {
        res.json(a || []);
    });
});
app.get('/settings', checkUser, (req, res) => {
    if (!req.user) return res.redirect('/login');
    db.get(`SELECT * FROM user_settings WHERE user_id = ?`, [req.user.id], (err, settings) => {
        if (err) settings = null;
        res.render('settings', { user: req.user, settings: settings });
    });
});

// ==================== 404 ====================
app.use((req, res) => { res.status(404).send("Страница не найдена"); });

// ==================== SOCKET.IO ====================
const serverHttp = http.createServer(app);
const io = new Server(serverHttp);

io.on('connection', (socket) => {
    console.log('Пользователь подключился');
    socket.on('join_group', (data) => socket.join(`group_${data.groupId}`));
    socket.on('chat message', (msgData) => {
        const mod = moderateMessage(msgData.userId, msgData.username, msgData.content);
        if (!mod.allowed) { socket.emit('chat message', { userId: 0, username: 'Система', avatar: '/images/default_avatar.png', content: mod.message }); return; }
        db.run(`INSERT INTO chat_messages (user_id, username, avatar, content) VALUES (?, ?, ?, ?)`, [msgData.userId, msgData.username, msgData.avatar, msgData.content], (err) => { if (!err) io.emit('chat message', msgData); });
    });
    socket.on('private_message', (msgData) => {
        db.run(`INSERT INTO private_messages (sender_id, receiver_id, content, file_path) VALUES (?, ?, ?, ?)`, [msgData.sender_id, msgData.receiver_id, msgData.content, msgData.file_path], (err) => { if (!err) io.emit('private_message', msgData); });
    });
    socket.on('disconnect', () => console.log('Отключился'));
});

serverHttp.listen(PORT, () => console.log(`Сервер: http://localhost:${PORT}`));
