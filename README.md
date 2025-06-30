# 📊 DCA Tracker for Solana with Telegram Alerts

Мониторинг DCA-транзакций на Solana-программе с отправкой уведомлений в Telegram. Подходит для отслеживания действий в on-chain DCA-протоколах (например, DCA v2), отправляя форматированные отчёты о свапах с метаданными токенов.

## 🧠 Что это?

Это нода-приложение, которое:

- Подключается к RPC-ноде Solana  
- Мониторит транзакции для заданной программы (по PROGRAM_ID)  
- Определяет DCA-инструкции (OpenDcaV2)  
- Получает информацию о токенах через SolScan API  
- Отправляет сообщения в Telegram с деталями (сумма, ETA, цена токена, market cap и др.)

## 🔧 Как это работает?

1. Подключение к Solana через @solana/web3.js и @project-serum/anchor  
2. Использование Redis для исключения повторной обработки транзакций  
3. Получение IDL-программы для декодирования инструкций  
4. Поиск DCA-инструкций по логам и декодирование их данных  
5. Получение метаданных токенов через Solscan API  
6. Отправка отчёта в Telegram

## 🧪 Пример сообщения

$250.00 buying ABC 🟩

Frequency: $25.00 every 1h (10 cycles)  
ETA: 10h  

MC: $120.34M  
V24h: $4.56M  
Price: 0.1234  
CA: ABC123...

User: 7x...abc  
TX: 9Y...xyz

Period: Mon, 01 Jul 2025 10:00:00 GMT - Mon, 01 Jul 2025 20:00:00 GMT

## 🚀 Запуск

1. Скопируй .env.example и назови .env, заполни переменные:

RPC_ENDPOINT=https://...  
TARGET_PROGRAM_ID_STR=DCA265Vj8a9CEuX1eb1LWRnDT7uK6q1xMipnNyatn23M  
TG_BOT_TOKEN=...  
TG_CHAT_ID=...  
REDIS_URL=redis://localhost:6379  
SOLSCAN_TOKEN=...

2. Установи зависимости:

npm install

3. Запусти Redis (если ещё не запущен):

docker-compose up -d

4. Запусти трекер:

node index.js

## 📦 Зависимости

- @solana/web3.js, @project-serum/anchor — Solana SDK  
- redis — кэш для транзакций  
- axios, dotenv — HTTP-запросы и переменные окружения

## 🛠 Для чего можно использовать?

- 📉 Отслеживание активности в DCA-протоколах  
- 🛡 Аудит и аналитика пользовательских DCA-стратегий  
- 🤖 Интеграция с Telegram для мониторинга on-chain активностей
