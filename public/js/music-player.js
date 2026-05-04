// public/js/music-player.js

document.addEventListener('DOMContentLoaded', function() {
    // 1. Создаем или находим аудио-элемент глобально
    let audio = document.getElementById('bgMusic');
    if (!audio) {
        audio = document.createElement('audio');
        audio.id = 'bgMusic';
        audio.loop = false; // Отключаем зацикливание трека, чтобы переключались треки
        document.body.appendChild(audio);
    }

    const musicBtn = document.getElementById('musicBtn');
    
    let soundtrackPlaylist = [];
    let currentTrackIndex = 0;
    let isPlaying = false;

    // 2. Загрузка списка музыки с сервера
    fetch('/api/music-files')
        .then(response => response.json())
        .then(data => {
            if (data.files && data.files.length > 0) {
                // Создаем полные пути к файлам
                soundtrackPlaylist = data.files.map(file => '/audio/' + file);
                console.log('Загружены файлы:', soundtrackPlaylist);
                
                // 3. Восстановление состояния из sessionStorage
                const savedPlaying = sessionStorage.getItem('musicPlaying') === 'true';
                const savedTrack = parseInt(sessionStorage.getItem('currentTrack')) || 0;
                const savedSrc = sessionStorage.getItem('currentSrc');
                
                // Если есть сохраненный трек и он есть в плейлисте
                if (savedPlaying && savedSrc && soundtrackPlaylist.includes(savedSrc)) {
                    currentTrackIndex = savedTrack;
                    audio.src = savedSrc;
                    
                    // Пытаемся запустить (браузер может блокировать автозапуск)
                    audio.play().then(() => {
                        if (musicBtn) musicBtn.textContent = '🔇 Выключить музыку';
                        isPlaying = true;
                    }).catch(e => {
                        console.log("Автозапуск заблокирован браузером");
                        if (musicBtn) musicBtn.textContent = '🔊 Включить музыку';
                        isPlaying = false;
                    });
                } else {
                    // Если восстановить не удалось, начинаем с первого трека
                    if (soundtrackPlaylist.length > 0) {
                        currentTrackIndex = 0;
                        audio.src = soundtrackPlaylist[0];
                    }
                }
            } else {
                console.log('Музыкальные файлы не найдены');
                if (musicBtn) musicBtn.style.display = 'none';
            }
        })
        .catch(error => {
            console.error('Ошибка загрузки списка файлов:', error);
        });

    // 4. Функция переключения музыки
    window.toggleMusic = function() {
        if (soundtrackPlaylist.length === 0) {
            console.log("Музыкальные файлы не найдены");
            return;
        }

        if (isPlaying) {
            audio.pause();
            if (musicBtn) musicBtn.textContent = '🔊 Включить музыку';
            isPlaying = false;
            sessionStorage.setItem('musicPlaying', 'false');
        } else {
            if (!audio.src && soundtrackPlaylist.length > 0) {
                audio.src = soundtrackPlaylist[currentTrackIndex];
            }
            audio.play().then(() => {
                if (musicBtn) musicBtn.textContent = '🔇 Выключить музыку';
                isPlaying = true;
                sessionStorage.setItem('musicPlaying', 'true');
                sessionStorage.setItem('currentSrc', audio.src);
                sessionStorage.setItem('currentTrack', currentTrackIndex);
            }).catch(e => {
                console.log("Ошибка воспроизведения:", e);
            });
        }
    };

    // 5. Автоматическое переключение треков
    audio.addEventListener('ended', function() {
        if (soundtrackPlaylist.length === 0) return;
        
        currentTrackIndex = (currentTrackIndex + 1) % soundtrackPlaylist.length;
        audio.src = soundtrackPlaylist[currentTrackIndex];
        
        sessionStorage.setItem('currentTrack', currentTrackIndex);
        sessionStorage.setItem('currentSrc', audio.src);
        
        if (isPlaying) {
            audio.play().catch(e => console.log("Ошибка воспроизведения:", e));
        }
    });

    // 6. Сохранение состояния при закрытии вкладки
    window.addEventListener('beforeunload', function() {
        sessionStorage.setItem('musicPlaying', isPlaying);
        sessionStorage.setItem('currentTrack', currentTrackIndex);
        sessionStorage.setItem('currentSrc', audio.src);
    });
});