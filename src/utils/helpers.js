const { DEFAULT_PAGE, DEFAULT_LIMIT, MAX_LIMIT } = require('../config/constants');

function toIso(date) {
  if (date === null || date === undefined) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeOrigin(url) {
  return (url || '').trim().replace(/\/+$/, '');
}

function computeNextRun(scheduleType, fromDate = new Date()) {
  const now = new Date(fromDate);
  if (isNaN(now.getTime())) return null;

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

function getErrorMessage(error, fallback = 'An unexpected error occurred') {
  const message = String(error?.message || error || '');
  if (!message || message.length > 300) return fallback;
  return message;
}

function parsePagination(query) {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);

  if (isNaN(page) || page < 1) page = DEFAULT_PAGE;
  if (isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const from = (page - 1) * limit;

  return { page, limit, from, to: from + limit - 1 };
}

function paginatedResponse(data, page, limit, total) {
  const safeLimit = Math.max(1, limit);
  const totalPages = Math.ceil(total / safeLimit);
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

async function parallelWithLimit(items, limit, fn) {
  if (!items || items.length === 0) return [];

  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        results[i] = {
          success: false,
          error: e?.message || 'Unknown error',
        };
      }
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return results;
}

const _pendingRequests = new Map();

async function dedupRequest(key, fn, ttlMs = 5000) {
  const existing = _pendingRequests.get(key);
  if (existing && Date.now() - existing.createdAt < ttlMs) {
    return existing.promise;
  }

  let promise;
  try {
    promise = fn();
  } catch (e) {
    promise = Promise.reject(e);
  }

  const cleanup = () => {
    const timer = setTimeout(() => {
      _pendingRequests.delete(key);
    }, ttlMs);

    timer.unref?.();
  };

  promise.then(cleanup, cleanup);

  _pendingRequests.set(key, { promise, createdAt: Date.now() });
  return promise;
}

module.exports = {
  toIso,
  normalizeOrigin,
  computeNextRun,
  ok,
  err,
  getErrorMessage,
  parsePagination,
  paginatedResponse,
  parallelWithLimit,
  dedupRequest,
};
