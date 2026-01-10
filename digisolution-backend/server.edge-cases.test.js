const request = require('supertest');
const express = require('express');

// Используем ту же функцию создания приложения
function createTestApp() {
    const app = express();
    const cors = require('cors');

    app.use(cors());
    app.use(express.json());

    let allItems = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
    let selectedItems = [];
    let selectedOrder = [];

    const addQueue = new Map();
    const updateQueue = new Map();

    app.locals.addQueue = addQueue;
    app.locals.updateQueue = updateQueue;
    app.locals.allItems = allItems;
    app.locals.selectedItems = selectedItems;
    app.locals.selectedOrder = selectedOrder;

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

    // API endpoints (те же что в server.test.js)
    app.get('/api/items/available', (req, res) => {
        const { page = 0, limit = 20, filter = '' } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const selectedIds = new Set(selectedItems.map(i => i.id));
        let available = allItems.filter(item => !selectedIds.has(item.id));
        if (filter) {
            available = available.filter(item => item.id.toString().includes(filter));
        }
        const start = pageNum * limitNum;
        const end = start + limitNum;
        const items = available.slice(start, end);
        res.json({ items, total: available.length, hasMore: end < available.length });
    });

    app.get('/api/items/selected', (req, res) => {
        const { page = 0, limit = 20, filter = '' } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        let ordered = selectedOrder.map(id => selectedItems.find(item => item.id === id)).filter(Boolean);
        if (filter) {
            ordered = ordered.filter(item => item.id.toString().includes(filter));
        }
        const start = pageNum * limitNum;
        const end = start + limitNum;
        const items = ordered.slice(start, end);
        res.json({ items, total: ordered.length, hasMore: end < ordered.length, order: selectedOrder });
    });

    app.post('/api/items', (req, res) => {
        const { id } = req.body;
        if (typeof +id !== 'number') {
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
        updateQueue.set(`select-${id}`, { type: 'deselect', id });
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

describe('Edge Cases and Stress Tests', () => {
    let app;

    beforeEach(() => {
        app = createTestApp();
    });

    describe('Boundary Conditions', () => {
        test('should handle page beyond available items', async () => {
            const response = await request(app)
                .get('/api/items/available?page=1000&limit=20')
                .expect(200);

            expect(response.body.items).toHaveLength(0);
            expect(response.body.hasMore).toBe(false);
        });

        test('should handle zero limit', async () => {
            const response = await request(app)
                .get('/api/items/available?limit=0')
                .expect(200);

            expect(response.body.items).toHaveLength(0);
        });

        test('should handle very large limit', async () => {
            const response = await request(app)
                .get('/api/items/available?limit=10000')
                .expect(200);

            expect(response.body.items.length).toBeLessThanOrEqual(100);
        });

        test('should handle negative page number', async () => {
            const response = await request(app)
                .get('/api/items/available?page=-1')
                .expect(200);

            expect(response.body.items).toHaveLength(0);
        });
    });

    describe('Filter Edge Cases', () => {
        test('should handle empty filter', async () => {
            const response = await request(app)
                .get('/api/items/available?filter=')
                .expect(200);

            expect(response.body.items.length).toBeGreaterThan(0);
        });

        test('should handle filter with no matches', async () => {
            const response = await request(app)
                .get('/api/items/available?filter=999999')
                .expect(200);

            expect(response.body.items).toHaveLength(0);
            expect(response.body.total).toBe(0);
        });

        test('should handle special characters in filter', async () => {
            const response = await request(app)
                .get('/api/items/available?filter=%20')
                .expect(200);

            expect(response.body).toHaveProperty('items');
        });

        test('should handle numeric filter correctly', async () => {
            const response = await request(app)
                .get('/api/items/available?filter=1')
                .expect(200);

            // Должны быть: 1, 10, 11, 12, ..., 19, 21, 31, ... 91, 100
            expect(response.body.items.length).toBeGreaterThan(0);
            response.body.items.forEach(item => {
                expect(item.id.toString()).toContain('1');
            });
        });
    });

    describe('Selection Edge Cases', () => {
        test('should handle selecting non-existent item', async () => {
            await request(app)
                .post('/api/items/select')
                .send({ id: 99999 })
                .expect(200);

            app.locals.processUpdateQueue();

            expect(app.locals.selectedItems.length).toBe(0);
        });

        test('should handle deselecting non-selected item', async () => {
            await request(app)
                .post('/api/items/deselect')
                .send({ id: 1 })
                .expect(200);

            app.locals.processUpdateQueue();

            expect(app.locals.selectedItems.length).toBe(0);
        });

        test('should handle selecting all items', async () => {
            // Выбираем первые 10 элементов
            for (let i = 1; i <= 10; i++) {
                await request(app).post('/api/items/select').send({ id: i });
            }

            app.locals.processUpdateQueue();

            expect(app.locals.selectedItems.length).toBe(10);

            const available = await request(app)
                .get('/api/items/available')
                .expect(200);

            expect(available.body.total).toBe(90);
        });

        test('should maintain order after multiple selections and deselections', async () => {
            // Выбираем
            await request(app).post('/api/items/select').send({ id: 1 });
            await request(app).post('/api/items/select').send({ id: 2 });
            await request(app).post('/api/items/select').send({ id: 3 });
            app.locals.processUpdateQueue();

            // Отменяем средний
            await request(app).post('/api/items/deselect').send({ id: 2 });
            app.locals.processUpdateQueue();

            // Выбираем новый
            await request(app).post('/api/items/select').send({ id: 4 });
            app.locals.processUpdateQueue();

            const order = await request(app).get('/api/items/order').expect(200);
            expect(order.body.order).toEqual([1, 3, 4]);
        });
    });

    describe('Reorder Edge Cases', () => {
        test('should handle empty reorder array', async () => {
            await request(app)
                .post('/api/items/reorder')
                .send({ order: [] })
                .expect(200);

            app.locals.processUpdateQueue();

            expect(app.locals.selectedOrder).toEqual([]);
        });

        test('should handle reorder with non-selected items', async () => {
            await request(app).post('/api/items/select').send({ id: 1 });
            await request(app).post('/api/items/select').send({ id: 2 });
            app.locals.processUpdateQueue();

            // Пытаемся добавить в порядок элемент, который не выбран
            await request(app)
                .post('/api/items/reorder')
                .send({ order: [1, 99, 2] })
                .expect(200);

            app.locals.processUpdateQueue();

            expect(app.locals.selectedOrder).toEqual([1, 99, 2]);
        });

        test('should handle reorder with duplicates', async () => {
            await request(app).post('/api/items/select').send({ id: 1 });
            await request(app).post('/api/items/select').send({ id: 2 });
            app.locals.processUpdateQueue();

            await request(app)
                .post('/api/items/reorder')
                .send({ order: [1, 1, 2] })
                .expect(200);

            app.locals.processUpdateQueue();

            // Порядок будет таким, как отправили (сервер не валидирует)
            expect(app.locals.selectedOrder).toEqual([1, 1, 2]);
        });
    });

    describe('Concurrent Operations', () => {
        test('should handle multiple simultaneous selections', async () => {
            const promises = [];
            for (let i = 1; i <= 20; i++) {
                promises.push(request(app).post('/api/items/select').send({ id: i }));
            }

            await Promise.all(promises);
            app.locals.processUpdateQueue();

            expect(app.locals.selectedItems.length).toBe(20);
        });

        test('should handle rapid add/remove of same item', async () => {
            await request(app).post('/api/items/select').send({ id: 1 });
            await request(app).post('/api/items/deselect').send({ id: 1 });
            await request(app).post('/api/items/select').send({ id: 1 });

            await app.locals.processUpdateQueue();

            console.log("Selected items: ", app.locals.selectedItems);

            // Последняя операция - select, поэтому элемент должен быть выбран
            expect(app.locals.selectedItems.some(i => i.id === 1)).toBe(true);
        });
    });

    describe('Add Queue Edge Cases', () => {
        test('should handle adding negative ID', async () => {
            await request(app)
                .post('/api/items')
                .send({ id: -1 })
                .expect(200);

            app.locals.processAddQueue();

            expect(app.locals.allItems.some(i => i.id === -1)).toBe(true);
        });

        test('should handle adding zero ID', async () => {
            await request(app)
                .post('/api/items')
                .send({ id: 0 })
                .expect(200);

            app.locals.processAddQueue();

            expect(app.locals.allItems.some(i => i.id === 0)).toBe(true);
        });

        test('should handle adding very large ID', async () => {
            const largeId = 999999999;

            await request(app)
                .post('/api/items')
                .send({ id: largeId })
                .expect(200);

            app.locals.processAddQueue();

            expect(app.locals.allItems.some(i => i.id === largeId)).toBe(true);
        });

    });

    describe('Malformed Requests', () => {
        test('should handle request with missing body', async () => {
            await request(app)
                .post('/api/items/select')
                .expect(400);
        });

        test('should handle request with null ID', async () => {
            await request(app)
                .post('/api/items/select')
                .send({ id: null })
                .expect(400);
        });

        test('should handle request with string ID', async () => {
            await request(app)
                .post('/api/items/select')
                .send({ id: "123" })
                .expect(400);
        });

        test('should handle request with object ID', async () => {
            await request(app)
                .post('/api/items/select')
                .send({ id: { value: 1 } })
                .expect(400);
        });

        test('should handle reorder with non-array order', async () => {
            await request(app)
                .post('/api/items/reorder')
                .send({ order: "1,2,3" })
                .expect(400);
        });
    });

    describe('Pagination with Filters', () => {
        test('should paginate filtered results correctly', async () => {
            const page1 = await request(app)
                .get('/api/items/available?filter=1&page=0&limit=5')
                .expect(200);

            const page2 = await request(app)
                .get('/api/items/available?filter=1&page=1&limit=5')
                .expect(200);

            expect(page1.body.items).toHaveLength(5);
            expect(page2.body.items.length).toBeGreaterThan(0);

            // Все результаты должны содержать '1'
            [...page1.body.items, ...page2.body.items].forEach(item => {
                expect(item.id.toString()).toContain('1');
            });
        });

        test('should handle last page with filter correctly', async () => {
            const response = await request(app)
                .get('/api/items/available?filter=1&page=10&limit=10')
                .expect(200);

            expect(response.body.hasMore).toBe(false);
        });
    });

    describe('State Consistency', () => {
        test('selected items should not appear in available', async () => {
            // Выбираем несколько элементов
            await request(app).post('/api/items/select').send({ id: 1 });
            await request(app).post('/api/items/select').send({ id: 5 });
            await request(app).post('/api/items/select').send({ id: 10 });
            app.locals.processUpdateQueue();

            // Проверяем available
            const available = await request(app)
                .get('/api/items/available?limit=100')
                .expect(200);

            const availableIds = new Set(available.body.items.map(i => i.id));
            expect(availableIds.has(1)).toBe(false);
            expect(availableIds.has(5)).toBe(false);
            expect(availableIds.has(10)).toBe(false);
        });

        test('total count should be consistent', async () => {
            const initial = await request(app).get('/api/items/available');
            const initialTotal = initial.body.total;

            // Выбираем 5 элементов
            for (let i = 1; i <= 5; i++) {
                await request(app).post('/api/items/select').send({ id: i });
            }
            app.locals.processUpdateQueue();

            const afterSelect = await request(app).get('/api/items/available');
            const selected = await request(app).get('/api/items/selected');

            expect(afterSelect.body.total).toBe(initialTotal - 5);
            expect(selected.body.total).toBe(5);
            expect(afterSelect.body.total + selected.body.total).toBe(initialTotal);
        });
    });

    describe('Performance Tests', () => {
        test('should handle 100 rapid requests', async () => {
            const promises = [];

            for (let i = 0; i < 100; i++) {
                promises.push(request(app).get('/api/items/available?page=0&limit=10'));
            }

            const responses = await Promise.all(promises);

            responses.forEach(response => {
                expect(response.status).toBe(200);
                expect(response.body.items).toHaveLength(10);
            });
        }, 15000);

        test('queue should handle many operations efficiently', async () => {
            // Добавляем 50 операций в очередь
            for (let i = 101; i <= 150; i++) {
                await request(app).post('/api/items').send({ id: i });
            }

            expect(app.locals.addQueue.size).toBe(50);

            const start = Date.now();
            app.locals.processAddQueue();
            const duration = Date.now() - start;

            expect(duration).toBeLessThan(100); // Должно выполниться за < 100ms
            expect(app.locals.allItems.length).toBe(150);
        });
    });
});