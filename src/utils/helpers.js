function toIso(date) {
    return new Date(date).toISOString();
}

function normalizeOrigin(url) {
    return (url || '').trim().replace(/\/+$/, '');
}

function computeNextRun(scheduleType, fromDate = new Date()) {
    const now = new Date(fromDate);
    if (scheduleType === 'daily') {
        const next = new Date(now);
        next.setDate(next.getDate() + 1);
        return toIso(next);
    }
    if (scheduleType === 'weekly') {
        const next = new Date(now);
        next.setDate(next.getDate() + 7);
        return toIso(next);
    }
    return null;
}

function ok(res, data, code = 200) {
    res.status(code).json(data);
}

function err(res, msg, code = 500) {
    const isDev = process.env.NODE_ENV !== 'production';
    res.status(code).json({
        success: false,
        error: msg,
        ...(isDev && code >= 500 ? { timestamp: new Date().toISOString() } : {})
    });
}

async function parallelWithLimit(items, limit, fn) {
    const results = new Array(items.length);
    let index = 0;

    async function worker() {
        while (index < items.length) {
            const i = index++;
            try {
                results[i] = await fn(items[i], i);
            } catch (e) {
                results[i] = { success: false, error: e.message };
            }
        }
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

module.exports = { toIso, normalizeOrigin, computeNextRun, ok, err, parallelWithLimit };
