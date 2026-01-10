module.exports = {
    // Тестовое окружение
    testEnvironment: 'node',

    // Паттерны для поиска тестовых файлов
    testMatch: [
        '**/__tests__/**/*.js',
        '**/?(*.)+(spec|test).js'
    ],

    // Игнорирование путей при сборе coverage
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/coverage/'
    ],

    // Таймаут для тестов (10 секунд)
    testTimeout: 15000,

    // Verbose вывод
    verbose: true,

    // Пороги покрытия кода
    coverageThreshold: {
        global: {
            branches: 70,
            functions: 80,
            lines: 80,
            statements: 80
        }
    },

    // Форматы отчетов о покрытии
    coverageReporters: [
        'text',
        'text-summary',
        'html',
        'lcov'
    ],

    // Директория для отчетов
    coverageDirectory: 'coverage',

    // Очистка моков между тестами
    clearMocks: true,

    // Сброс состояния моков между тестами
    resetMocks: true,

    // Восстановление моков между тестами
    restoreMocks: true,

    // Максимальное количество воркеров для параллельного выполнения
    maxWorkers: '50%',

    // Коллекция покрытия из всех файлов
    collectCoverageFrom: [
        'server.js',
        '!node_modules/**',
        '!coverage/**'
    ]
};