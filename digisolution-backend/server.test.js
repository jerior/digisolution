const request = require('supertest');
const express = require('express');

// Создаем тестовое приложение
function createTestApp() {
    const app = express();
    const cors = require('cors');

    app.use(cors());
    app.use(express.json());

    // Хранилище данных (меньше для тестов)
    let allItems = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
    let selectedItems = [];
    let selectedOrder = [];
    let nextId = 101;

    // Очереди с дедупликацией
    const addQueue = new Map();
    const updateQueue = new Map();
    const getQueue = new Map();

    // Экспортируем очереди для тестирования
    app.locals.addQueue = addQueue;
    app.locals.updateQueue = updateQueue;
    app.locals.allItems = allItems;
    app.locals.selectedItems = selectedItems;
    app.locals.selectedOrder = selectedOrder;

    // Функции обработки батчей (для ручного вызова в тестах)
    app.locals.processAddQueue = () => {
        if (addQueue.size > 0) {
            const itemsToAdd = Array.from(addQueue.values());
            addQueue.clear();

            itemsToAdd.forEach(item => {
                if (!allItems.find(i => i.id === item.id)) {
                    allItems.push(item);
                }
            });
        }
    };

    app.locals.processUpdateQueue = () => {
        if (updateQueue.size > 0) {
            const updates = Array.from(updateQueue.values());
            updateQueue.clear();

            updates.forEach(update => {
                if (update.type === 'select') {
                    const item = allItems.find(i => i.id === update.id);
                    if (item && !selectedItems.find(i => i.id === update.id)) {
                        selectedItems.push(item);
                        if (!selectedOrder.includes(update.id)) {
                            selectedOrder.push(update.id);
                        }
                    }
                } else if (update.type === 'deselect') {
                    selectedItems = selectedItems.filter(i => i.id !== update.id);
                    selectedOrder = selectedOrder.filter(id => id !== update.id);
                    app.locals.selectedItems = selectedItems;
                    app.locals.selectedOrder = selectedOrder;
                } else if (update.type === 'reorder') {
                    selectedOrder = update.order;
                    app.locals.selectedOrder = selectedOrder;
                }
            });
        }
    };

    // API endpoints
    app.get('/api/items/available', (req, res) => {
        const { page = 0, limit = 20, filter = '' } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        const selectedIds = new Set(selectedItems.map(i => i.id));
        let available = allItems.filter(item => !selectedIds.has(item.id));

        if (filter) {
            available = available.filter(item =>
                item.id.toString().includes(filter)
            );
        }

        const start = pageNum * limitNum;
        const end = start + limitNum;
        const items = available.slice(start, end);

        res.json({
            items,
            total: available.length,
            hasMore: end < available.length
        });
    });

    app.get('/api/items/selected', (req, res) => {
        const { page = 0, limit = 20, filter = '' } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        let ordered = selectedOrder
            .map(id => selectedItems.find(item => item.id === id))
            .filter(Boolean);

        if (filter) {
            ordered = ordered.filter(item =>
                item.id.toString().includes(filter)
            );
        }

        const start = pageNum * limitNum;
        const end = start + limitNum;
        const items = ordered.slice(start, end);

        res.json({
            items,
            total: ordered.length,
            hasMore: end < ordered.length,
            order: selectedOrder
        });
    });

    app.post('/api/items', (req, res) => {
        const { id } = req.body;

        if (!id || typeof id !== 'number') {
            return res.status(400).json({ error: 'Invalid ID' });
        }

        if (!addQueue.has(id) && !allItems.find(i => i.id === id)) {
            addQueue.set(id, { id });
            res.json({ message: 'Item queued for addition', id });
        } else {
            res.status(409).json({ error: 'Item already exists or queued' });
        }
    });

    app.post('/api/items/select', (req, res) => {
        const { id } = req.body;

        if (!id || typeof id !== 'number') {
            return res.status(400).json({ error: 'Invalid ID' });
        }

        updateQueue.set(`select-${id}`, { type: 'select', id });
        res.json({ message: 'Selection queued' });
    });

    app.post('/api/items/deselect', (req, res) => {
        const { id } = req.body;

        if (!id || typeof id !== 'number') {
            return res.status(400).json({ error: 'Invalid ID' });
        }

        updateQueue.set(`deselect-${id}`, { type: 'deselect', id });
        res.json({ message: 'Deselection queued' });
    });

    app.post('/api/items/reorder', (req, res) => {
        const { order } = req.body;

        if (!Array.isArray(order)) {
            return res.status(400).json({ error: 'Invalid order array' });
        }

        updateQueue.set('reorder', { type: 'reorder', order });
        res.json({ message: 'Reorder queued' });
    });

    app.get('/api/items/order', (req, res) => {
        res.json({ order: selectedOrder });
    });

    return app;
}

describe('Backend API Tests', () => {
    let app;

    beforeEach(() => {
        app = createTestApp();
    });

    describe('GET /api/items/available', () => {
        test('should return first 20 available items', async () => {
            const response = await request(app)
                .get('/api/items/available')
                .expect(200);

            expect(response.body.items).toHaveLength(20);
            expect(response.body.total).toBe(100);
            expect(response.body.hasMore).toBe(true);
            expect(response.body.items[0]).toHaveProperty('id');
        });

        test('should return second page of items', async () => {
            const response = await request(app)
                .get('/api/items/available?page=1&limit=20')
                .expect(200);

            expect(response.body.items).toHaveLength(20);
            expect(response.body.items[0].id).toBe(21);
        });

        test('should filter items by ID', async () => {
            const response = await request(app)
                .get('/api/items/available?filter=1')
                .expect(200);

            response.body.items.forEach(item => {
                expect(item.id.toString()).toContain('1');
            });
        });

        test('should respect custom limit', async () => {
            const response = await request(app)
                .get('/api/items/available?limit=10')
                .expect(200);

            expect(response.body.items).toHaveLength(10);
        });

        test('should exclude selected items', async () => {
            // Выбираем элемент
            await request(app)
                .post('/api/items/select')
                .send({ id: 1 })
                .expect(200);

            // Обрабатываем очередь
            app.locals.processUpdateQueue();

            // Проверяем что элемент исключен
            const response = await request(app)
                .get('/api/items/available')
                .expect(200);

            const hasItem = response.body.items.some(item => item.id === 1);
            expect(hasItem).toBe(false);
        });
    });

    describe('GET /api/items/selected', () => {
        test('should return empty list initially', async () => {
            const response = await request(app)
                .get('/api/items/selected')
                .expect(200);

            expect(response.body.items).toHaveLength(0);
            expect(response.body.total).toBe(0);
            expect(response.body.order).toEqual([]);
        });

        test('should return selected items in correct order', async () => {
            // Выбираем несколько элементов
            await request(app).post('/api/items/select').send({ id: 5 });
            await request(app).post('/api/items/select').send({ id: 3 });
            await request(app).post('/api/items/select').send({ id: 10 });

            app.locals.processUpdateQueue();

            const response = await request(app)
                .get('/api/items/selected')
                .expect(200);

            expect(response.body.items).toHaveLength(3);
            expect(response.body.items[0].id).toBe(5);
            expect(response.body.items[1].id).toBe(3);
            expect(response.body.items[2].id).toBe(10);
            expect(response.body.order).toEqual([5, 3, 10]);
        });

        test('should filter selected items', async () => {
            // Выбираем элементы
            await request(app).post('/api/items/select').send({ id: 11 });
            await request(app).post('/api/items/select').send({ id: 21 });
            await request(app).post('/api/items/select').send({ id: 31 });

            app.locals.processUpdateQueue();

            const response = await request(app)
                .get('/api/items/selected?filter=1')
                .expect(200);

            expect(response.body.items.length).toBeGreaterThan(0);
            response.body.items.forEach(item => {
                expect(item.id.toString()).toContain('1');
            });
        });
    });

    describe('POST /api/items', () => {
        test('should queue new item for addition', async () => {
            const response = await request(app)
                .post('/api/items')
                .send({ id: 101 })
                .expect(200);

            expect(response.body.message).toBe('Item queued for addition');
            expect(response.body.id).toBe(101);
            expect(app.locals.addQueue.has(101)).toBe(true);
        });

        test('should reject invalid ID', async () => {
            await request(app)
                .post('/api/items')
                .send({ id: 'invalid' })
                .expect(400);

            await request(app)
                .post('/api/items')
                .send({})
                .expect(400);
        });

        test('should reject duplicate ID', async () => {
            await request(app)
                .post('/api/items')
                .send({ id: 1 })
                .expect(409);
        });

        test('should\'t add existing items', async () => {
            await request(app).post('/api/items').send({ id: 101 });

            const response = await request(app)
                .post('/api/items')
                .send({ id: 101 })
                .expect(409);

            expect(response.body.error).toContain('already exists or queued');
        });

        test('should deduplicate items in queue', async () => {
            await request(app).post('/api/items').send({ id: 10333 });
            await request(app).post('/api/items').send({ id: 10333 });

            expect(app.locals.addQueue.size).toBe(1);

            app.locals.processAddQueue();

            expect(app.locals.allItems.find(i => i.id === 10333)).toBeDefined();
        });

        test('should process add queue correctly', async () => {
            await request(app).post('/api/items').send({ id: 101 });
            await request(app).post('/api/items').send({ id: 102 });

            expect(app.locals.addQueue.size).toBe(2);

            app.locals.processAddQueue();

            expect(app.locals.addQueue.size).toBe(0);
            expect(app.locals.allItems.length).toBe(102);
            expect(app.locals.allItems.find(i => i.id === 101)).toBeDefined();
            expect(app.locals.allItems.find(i => i.id === 102)).toBeDefined();
        });
    });

    describe('POST /api/items/select', () => {
        test('should queue item selection', async () => {
            const response = await request(app)
                .post('/api/items/select')
                .send({ id: 1 })
                .expect(200);

            expect(response.body.message).toBe('Selection queued');
            expect(app.locals.updateQueue.has('select-1')).toBe(true);
        });

        test('should reject invalid ID', async () => {
            await request(app)
                .post('/api/items/select')
                .send({ id: 'invalid' })
                .expect(400);
        });

        test('should process selection correctly', async () => {
            await request(app).post('/api/items/select').send({ id: 5 });

            app.locals.processUpdateQueue();

            expect(app.locals.selectedItems.length).toBe(1);
            expect(app.locals.selectedItems[0].id).toBe(5);
            expect(app.locals.selectedOrder).toEqual([5]);
        });

        test('should not duplicate selected items', async () => {
            await request(app).post('/api/items/select').send({ id: 5 });
            app.locals.processUpdateQueue();

            await request(app).post('/api/items/select').send({ id: 5 });
            app.locals.processUpdateQueue();

            expect(app.locals.selectedItems.length).toBe(1);
        });
    });

    describe('POST /api/items/deselect', () => {
        test('should queue item deselection', async () => {
            const response = await request(app)
                .post('/api/items/deselect')
                .send({ id: 1 })
                .expect(200);

            expect(response.body.message).toBe('Deselection queued');
            expect(app.locals.updateQueue.has('deselect-1')).toBe(true);
        });

        test('should process deselection correctly', async () => {
            // Сначала выбираем
            await request(app).post('/api/items/select').send({ id: 5 });
            app.locals.processUpdateQueue();

            expect(app.locals.selectedItems.length).toBe(1);

            // Затем отменяем выбор
            await request(app).post('/api/items/deselect').send({ id: 5 });
            app.locals.processUpdateQueue();

            expect(app.locals.selectedItems.length).toBe(0);
            expect(app.locals.selectedOrder).toEqual([]);
        });
    });

    describe('POST /api/items/reorder', () => {
        test('should queue reorder operation', async () => {
            const newOrder = [3, 1, 2];
            const response = await request(app)
                .post('/api/items/reorder')
                .send({ order: newOrder })
                .expect(200);

            expect(response.body.message).toBe('Reorder queued');
            expect(app.locals.updateQueue.has('reorder')).toBe(true);
        });

        test('should reject invalid order', async () => {
            await request(app)
                .post('/api/items/reorder')
                .send({ order: 'invalid' })
                .expect(400);
        });

        test('should process reorder correctly', async () => {
            // Выбираем элементы
            await request(app).post('/api/items/select').send({ id: 1 });
            await request(app).post('/api/items/select').send({ id: 2 });
            await request(app).post('/api/items/select').send({ id: 3 });
            app.locals.processUpdateQueue();

            // Изменяем порядок
            await request(app).post('/api/items/reorder').send({ order: [3, 1, 2] });
            app.locals.processUpdateQueue();

            expect(app.locals.selectedOrder).toEqual([3, 1, 2]);
        });
    });

    describe('GET /api/items/order', () => {
        test('should return current order', async () => {
            await request(app).post('/api/items/select').send({ id: 5 });
            await request(app).post('/api/items/select').send({ id: 3 });
            app.locals.processUpdateQueue();

            const response = await request(app)
                .get('/api/items/order')
                .expect(200);

            expect(response.body.order).toEqual([5, 3]);
        });
    });

    describe('Queue Deduplication', () => {
        test('should deduplicate add queue', async () => {
            await request(app).post('/api/items').send({ id: 200 });
            await request(app).post('/api/items').send({ id: 200 });

            expect(app.locals.addQueue.size).toBe(1);
        });

        test('should deduplicate update queue for same operation', async () => {
            await request(app).post('/api/items/select').send({ id: 1 });
            await request(app).post('/api/items/select').send({ id: 1 });

            const selectKeys = Array.from(app.locals.updateQueue.keys())
                .filter(k => k.startsWith('select-1'));

            expect(selectKeys.length).toBe(1);
        });
    });

    describe('Pagination', () => {
        test('should handle pagination correctly for available items', async () => {
            const page1 = await request(app)
                .get('/api/items/available?page=0&limit=10')
                .expect(200);

            const page2 = await request(app)
                .get('/api/items/available?page=1&limit=10')
                .expect(200);

            expect(page1.body.items).toHaveLength(10);
            expect(page2.body.items).toHaveLength(10);
            expect(page1.body.items[0].id).toBe(1);
            expect(page2.body.items[0].id).toBe(11);
        });

        test('should indicate hasMore correctly', async () => {
            const lastPage = await request(app)
                .get('/api/items/available?page=9&limit=10')
                .expect(200);

            expect(lastPage.body.hasMore).toBe(false);
        });
    });

    describe('Integration Tests', () => {
        test('complete workflow: add, select, reorder, deselect', async () => {
            // 1. Добавляем новый элемент
            await request(app).post('/api/items').send({ id: 150 });
            app.locals.processAddQueue();

            let available = await request(app).get('/api/items/available');
            expect(available.body.total).toBe(101);

            // 2. Выбираем элементы
            await request(app).post('/api/items/select').send({ id: 150 });
            await request(app).post('/api/items/select').send({ id: 1 });
            await request(app).post('/api/items/select').send({ id: 2 });
            app.locals.processUpdateQueue();

            let selected = await request(app).get('/api/items/selected');
            expect(selected.body.items).toHaveLength(3);
            expect(selected.body.order).toEqual([150, 1, 2]);

            // 3. Меняем порядок
            await request(app).post('/api/items/reorder').send({ order: [1, 150, 2] });
            app.locals.processUpdateQueue();

            selected = await request(app).get('/api/items/selected');
            expect(selected.body.order).toEqual([1, 150, 2]);

            // 4. Отменяем выбор
            await request(app).post('/api/items/deselect').send({ id: 150 });
            app.locals.processUpdateQueue();

            selected = await request(app).get('/api/items/selected');
            expect(selected.body.items).toHaveLength(2);
            expect(selected.body.order).toEqual([1, 2]);

            // 5. Проверяем что элемент вернулся в available
            available = await request(app).get('/api/items/available?filter=150');
            const has150 = available.body.items.some(i => i.id === 150);
            expect(has150).toBe(true);
        });
    });
});