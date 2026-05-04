// admin.js - Мидлвары для проверки прав администратора

// Проверка на админа (admin или founder)
function isAdmin(req, res, next) {
    if (!req.user) return res.redirect('/login');
    if (['admin', 'founder'].includes(req.user.role)) {
        return next();
    }
    res.status(403).send('Доступ запрещён. Только для администрации.');
}

// Проверка на основателя (только founder)
function isFounder(req, res, next) {
    if (!req.user) return res.redirect('/login');
    if (req.user.role === 'founder') {
        return next();
    }
    res.status(403).send('Доступ запрещён. Только для основателя.');
}

// Проверка на модератора и выше (moderator, admin, founder)
function isModerator(req, res, next) {
    if (!req.user) return res.redirect('/login');
    if (['admin', 'founder', 'moderator'].includes(req.user.role)) {
        return next();
    }
    // Если нет прав - показываем ошибку вместо редиректа
    res.status(403).send('Доступ запрещён. <a href="/">На главную</a>');
}

// Проверка на персонал (moderator, support, admin, founder)
function isStaff(req, res, next) {
    if (!req.user) return res.redirect('/login');
    if (['founder', 'admin', 'support', 'moderator'].includes(req.user.role)) {
        return next();
    }
    res.status(403).send('Доступ запрещён. Только для персонала.');
}

// Функция для получения префикса роли
function getRolePrefix(role) {
    const prefixes = {
        'founder': '👑 Основатель',
        'admin': '🛡️ Администратор',
        'support': '🔧 Техподдержка',
        'moderator': '⚡ Модератор',
        'user': ''
    };
    return prefixes[role] || '';
}

// Экспортируем все функции
module.exports = { isAdmin, isFounder, isModerator, isStaff, getRolePrefix };