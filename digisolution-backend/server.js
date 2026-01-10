const express = require('express');
const cors = require('cors');
const app = express();

app.options('*', cors()) // include before other routes
app.use(cors());
app.use(express.json());

// Хранилище данных
let allItems = Array.from({ length: 1000000 }, (_, i) => ({ id: i + 1 }));
let selectedItems = [];
let selectedOrder = [];

// Очереди с дедупликацией
const addQueue = new Map();
const updateQueue = new Map();

// Обработчик очереди добавления (батчинг раз в 10 сек)
setInterval(() => {
    if (addQueue.size > 0) {
        const itemsToAdd = Array.from(addQueue.values());
        addQueue.clear();

        itemsToAdd.forEach(item => {
            if (!allItems.find(i => i.id === item.id)) {
                allItems.push(item);
            }
        });

        console.log(`Batch added ${itemsToAdd.length} items`);
    }
}, 10000);

// Обработчик очереди обновления (батчинг раз в секунду)
setInterval(() => {
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
            } else if (update.type === 'reorder') {
                selectedOrder = update.order;
            }
        });

        console.log(`Batch processed ${updates.length} updates`);
    }
}, 1000);

// Обработчик очереди получения данных (батчинг раз в секунду)
const pendingGetRequests = [];
setInterval(() => {
    if (pendingGetRequests.length > 0) {
        pendingGetRequests.forEach(req => req.resolve());
        pendingGetRequests.length = 0;
    }
}, 1000);

// Middleware для батчинга GET запросов
const batchGet = (req, res, next) => {
    return new Promise(resolve => {
        pendingGetRequests.push({ resolve });
    }).then(() => next());
};

// API: Получить доступные элементы (не выбранные)
app.get('/api/items/available', async (req, res) => {
    await batchGet(req, res, () => {});

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

// API: Получить выбранные элементы
app.get('/api/items/selected', async (req, res) => {
    await batchGet(req, res, () => {});

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

// API: Добавить новый элемент
app.post('/api/items', (req, res) => {
    const { id } = req.body;

    console.log("id:", +id);
    if (typeof +id !== 'number') {
        return res.status(400).json({ error: 'Invalid ID' });
    }

    // Дедупликация в очереди
    if (!addQueue.has(id) && !allItems.find(i => i.id === id)) {
        addQueue.set(id, { id });
        res.json({ message: 'Item queued for addition', id });
    } else {
        res.status(409).json({ error: 'Item already exists or queued' });
    }
});

// API: Выбрать элемент
app.post('/api/items/select', (req, res) => {
    const { id } = req.body;

    if (typeof +id !== 'number') {
        return res.status(400).json({ error: 'Invalid ID' });
    }

    updateQueue.set(`select-${id}`, { type: 'select', id });
    res.json({ message: 'Selection queued' });
});

// API: Отменить выбор элемента
app.post('/api/items/deselect', (req, res) => {
    const { id } = req.body;

    if (typeof +id !== 'number') {
        return res.status(400).json({ error: 'Invalid ID' });
    }

    updateQueue.set(`select-${id}`, { type: 'deselect', id });
    res.json({ message: 'Deselection queued' });
});

// API: Изменить порядок выбранных элементов
app.post('/api/items/reorder', (req, res) => {
    const { order } = req.body;

    if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'Invalid order array' });
    }

    updateQueue.set('reorder', { type: 'reorder', order });
    res.json({ message: 'Reorder queued' });
});

// API: Получить текущий порядок
app.get('/api/items/order', async (req, res) => {
    await batchGet(req, res, () => {});
    res.json({ order: selectedOrder });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});