// Rate Limiter - максимум 10 запросов в секунду
class RateLimiter {
    constructor(maxRequests, interval) {
        this.maxRequests = maxRequests;
        this.interval = interval;
        this.queue = [];
        this.timestamps = [];
    }

    async execute(requestFn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ requestFn, resolve, reject });
            this.processQueue();
        });
    }

    processQueue() {
        const now = Date.now();
        
        // Удаляем старые таймстампы
        this.timestamps = this.timestamps.filter(ts => ts > now - this.interval);
        
        // Обрабатываем запросы, если есть доступные слоты
        while (this.timestamps.length < this.maxRequests && this.queue.length > 0) {
            const { requestFn, resolve, reject } = this.queue.shift();
            this.timestamps.push(now);
            
            requestFn()
                .then(resolve)
                .catch(reject);
        }
        
        // Запланировать следующую обработку
        if (this.queue.length > 0) {
            const nextExecution = Math.max(0, (this.timestamps[0] || 0) + this.interval - now);
            setTimeout(() => this.processQueue(), nextExecution);
        }
    }
}

// Создаем rate limiter (10 запросов в секунду)
const apiLimiter = new RateLimiter(10, 1000);

// Кэш данных
let stockDataCache = [];
let lastUpdateTime = null;

// Функция для безопасного запроса с обработкой ошибок
async function safeFetch(url) {
    try {
        const response = await apiLimiter.execute(() => fetch(url));
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('Ошибка запроса:', error);
        throw error;
    }
}

// Загрузка данных с MOEX
async function loadStockData() {
    try {
        // Проверяем, есть ли свежие данные в localStorage
        const cachedData = localStorage.getItem('moexData');
        const cachedTime = localStorage.getItem('moexDataTimestamp');
        
        if (cachedData && cachedTime && (Date.now() - parseInt(cachedTime)) < 5 * 60 * 1000) {
            stockDataCache = JSON.parse(cachedData);
            lastUpdateTime = parseInt(cachedTime);
            console.log('Используются кэшированные данные');
            return;
        }
        
        // Загружаем данные с MOEX
        const data = await safeFetch(
            'https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off'
        );
        
        // Парсинг данных
        const securities = data.securities.data;
        const columns = data.securities.columns;
        
        const secIdIndex = columns.indexOf('SECID');
        const nameIndex = columns.indexOf('SHORTNAME');
        const lotSizeIndex = columns.indexOf('LOTSIZE');
        const minStepIndex = columns.indexOf('MINSTEP');
        
        if (secIdIndex === -1 || nameIndex === -1 || lotSizeIndex === -1 || minStepIndex === -1) {
            throw new Error('Не удалось найти необходимые колонки в ответе MOEX');
        }
        
        stockDataCache = securities.map(item => ({
            ticker: item[secIdIndex],
            name: item[nameIndex],
            shares_per_lot: parseInt(item[lotSizeIndex]) || 1,
            step: parseFloat(item[minStepIndex]) || 0.01
        })).filter(item => item.ticker && item.name);
        
        // Сохраняем в localStorage
        lastUpdateTime = Date.now();
        localStorage.setItem('moexData', JSON.stringify(stockDataCache));
        localStorage.setItem('moexDataTimestamp', lastUpdateTime.toString());
        
        console.log('Данные с MOEX успешно загружены');
    } catch (error) {
        console.error('Ошибка при загрузке данных:', error);
        
        // Fallback на статические данные, если есть кэш
        if (localStorage.getItem('moexData')) {
            stockDataCache = JSON.parse(localStorage.getItem('moexData'));
            console.warn('Используем кэшированные данные из-за ошибки');
        } else {
            // Минимальный набор данных для работы
            stockDataCache = [
                {
                    ticker: "SBER",
                    name: "Сбербанк",
                    shares_per_lot: 10,
                    step: 0.01
                },
                {
                    ticker: "GAZP",
                    name: "Газпром",
                    shares_per_lot: 10,
                    step: 0.01
                }
            ];
            console.warn('Используем fallback данные');
        }
        
        throw error;
    }
}

// Получение данных
function getStockData() {
    return stockDataCache;
}

// Получение времени последнего обновления
function getLastUpdateTime() {
    return lastUpdateTime;
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadStockData();
        console.log('Данные инициализированы');
    } catch (error) {
        console.error('Ошибка инициализации данных:', error);
    }
});

// Экспорт для использования в других скриптах
window.MOEX_API = {
    loadStockData,
    getStockData,
    getLastUpdateTime
};