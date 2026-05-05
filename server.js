const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('<h1>HL2 Forum работает!</h1><p>Скоро здесь будет форум.</p>');
});

app.listen(PORT, () => {
    console.log('Сервер запущен на порту ' + PORT);
});
