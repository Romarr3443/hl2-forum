const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./hl2forum.db');

// ВПИШИ СВОЙ НИКНЕЙМ СЮДА!
const myNickname = 'Капуста';

db.get("SELECT * FROM users WHERE username = ?", [myNickname], (err, user) => {
    if (err) {
        console.error('Ошибка:', err);
        db.close();
        return;
    }
    
    if (!user) {
        console.log('❌ Пользователь "' + myNickname + '" не найден!');
        console.log('Сначала зарегистрируйся на форуме: http://localhost:3000/register');
        db.close();
        return;
    }
    
    db.run("UPDATE users SET role = 'founder', tag = '👑 Основатель' WHERE username = ?", [myNickname], function(err) {
        if (err) {
            console.error('Ошибка:', err);
        } else {
            console.log('═══════════════════════════════════');
            console.log('  ✅ Успех!');
            console.log('  ' + myNickname + ' теперь 👑 Основатель!');
            console.log('═══════════════════════════════════');
            console.log('');
            console.log('  Ты можешь:');
            console.log('  🔨 Банить и мутить пользователей');
            console.log('  👥 Выдавать роли персоналу');
            console.log('  🗑️ Удалять темы и комментарии');
            console.log('  ⚙️ Заходить в /admin');
            console.log('');
            console.log('  HL2 Fan Forum готов к работе! 🎮');
            console.log('═══════════════════════════════════');
        }
        db.close();
    });
});