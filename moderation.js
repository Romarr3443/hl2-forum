// moderation.js - Система модерации контента
const db = require('./database');

// Список запрещённых слов
const bannedWords = [
    'porn', 'xxx', 'sex', 'порно', 'секс', 'трах', 'nude', 'naked',
    'gay porn', 'hentai', 'транс', 'интим', 'эскорт', 'проститут',
];

// Хранилище сообщений пользователей для проверки спама
const userMessages = {};
const userWarnings = {};

function checkSpam(userId, content) {
    const now = Date.now();
    
    if (!userMessages[userId]) {
        userMessages[userId] = [];
    }
    
    // Очищаем старые сообщения (старше 10 секунд)
    userMessages[userId] = userMessages[userId].filter(t => now - t < 10000);
    
    // Добавляем текущее время
    userMessages[userId].push(now);
    
    // Проверяем на спам (более 5 сообщений за 10 секунд)
    if (userMessages[userId].length > 5) {
        return { isSpam: true, reason: 'Слишком много сообщений! Подождите 10 секунд.' };
    }
    
    // Проверка на повторение одинакового контента
    const recentMessages = userMessages[userId];
    if (recentMessages.length >= 3) {
        return { isSpam: true, reason: 'Спам запрещён! Не повторяйте сообщения.' };
    }
    
    return { isSpam: false };
}

function checkContent(content) {
    const lowerContent = content.toLowerCase();
    
    for (const word of bannedWords) {
        if (lowerContent.includes(word)) {
            return { 
                isBanned: true, 
                reason: `Запрещённый контент: "${word}"` 
            };
        }
    }
    
    return { isBanned: false };
}

function moderateMessage(userId, username, content) {
    // Проверка на спам
    const spamCheck = checkSpam(userId, content);
    if (spamCheck.isSpam) {
        // Выдаём предупреждение
        if (!userWarnings[userId]) userWarnings[userId] = 0;
        userWarnings[userId]++;
        
        if (userWarnings[userId] >= 3) {
            // Автоматический мут на 30 минут
            const mutedUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
            db.run(`UPDATE users SET is_muted = 1, muted_until = ? WHERE id = ?`, [mutedUntil, userId]);
            db.run(`INSERT INTO mutes (user_id, admin_id, reason, muted_until) VALUES (?, 1, ?, ?)`, 
                [userId, 'Автомут: спам', mutedUntil]);
            userWarnings[userId] = 0;
            
            return { 
                allowed: false, 
                action: 'mute',
                message: `🚫 ${username} замучен на 30 минут за спам!` 
            };
        }
        
        return { 
            allowed: false, 
            action: 'warn',
            message: `⚠️ ${username}, ${spamCheck.reason} (Предупреждение ${userWarnings[userId]}/3)` 
        };
    }
    
    // Проверка контента
    const contentCheck = checkContent(content);
    if (contentCheck.isBanned) {
        // Автоматический мут на 1 час
        const mutedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        db.run(`UPDATE users SET is_muted = 1, muted_until = ? WHERE id = ?`, [mutedUntil, userId]);
        db.run(`INSERT INTO mutes (user_id, admin_id, reason, muted_until) VALUES (?, 1, ?, ?)`, 
            [userId, contentCheck.reason, mutedUntil]);
        
        return { 
            allowed: false, 
            action: 'mute',
            message: `🚫 ${username} замучен на 1 час. Причина: ${contentCheck.reason}` 
        };
    }
    
    return { allowed: true };
}

// Очистка предупреждений (вызывать периодически)
setInterval(() => {
    for (const userId in userWarnings) {
        userWarnings[userId] = Math.max(0, userWarnings[userId] - 1);
    }
}, 300000); // Каждые 5 минут

module.exports = { moderateMessage };