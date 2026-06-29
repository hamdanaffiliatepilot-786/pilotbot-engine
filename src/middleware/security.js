const crypto = require('crypto');
const { env, envBool } = require('../config/env');
const { err } = require('../utils/helpers');
const logger = require('../utils/logger');

const INTERNAL_CRON_SECRET = env('CRON_SECRET');
const CSRF_SECRET = env('CSRF_SECRET') || 'pilotstaff-csrf-secret-2024';

// CSRF Token Generation
function generateCSRFToken() {
  const timestamp = Date.now().toString();
  const randomBytes = crypto.randomBytes(16).toString('hex');
  const payload = `${timestamp}:${randomBytes}`;
  const signature = crypto.createHmac('sha256', CSRF_SECRET).update(payload).digest('hex');
  return `${payload}:${signature}`;
}

// CSRF Token Verification
function verifyCSRFToken(token) {
  if (!token) return false;
  const parts = token.split(':');
  if (parts.length !== 3) return false;
  const [timestamp, randomBytes, signature] = parts;
  const payload = `${timestamp}:${randomBytes}`;
  const expectedSignature = crypto.createHmac('sha256', CSRF_SECRET).update(payload).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return false;
  } catch { return false; }
  const tokenAge = Date.now() - parseInt(timestamp, 10);
  if (tokenAge > 86400000) return false;
  return true;
}

// CSRF Middleware
function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = req.headers['x-csrf-token'] || req.body?._csrf || '';
  if (!verifyCSRFToken(token)) {
    logger.warn(`CSRF validation failed for ${req.method} ${req.path}`, { ip: req.ip, requestId: req.requestId });
    return err(res, 'Invalid CSRF token', 403);
  }
  next();
}

function requestId(req, res, next) {
  const id = req.headers['x-request-id'] || crypto.randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  res.setHeader('X-CSRF-Token', generateCSRFToken());
  next();
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.removeHeader('X-Powered-By');
  next();
}

function cors(req, res, next) {
  const isDev = process.env.NODE_ENV === 'development';
  const configuredOrigins = [
    env('FRONTEND_URL'),
    ...env('FRONTEND_URLS')
      .split(',')
      .map((u) => u.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    ...(isDev ? ['http://localhost:3000'] : []),
  ].filter(Boolean);

  const origin = (req.headers.origin || '').trim().replace(/\/+$/, '');
  const isAllowed = !origin
    || configuredOrigins.includes(origin)
    || (envBool('ALLOW_VERCEL_PREVIEWS') && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin));

  if (!isAllowed && origin) {
    logger.warn(`Blocked CORS origin: ${origin}`);
  }

  if (isAllowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id, X-Cron-Secret');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
}

// ─── Centralized Rate Limiter ───
const rateLimitStore = new Map();

function rateLimit(options = {}) {
  const {
    windowMs = 60000,
    max = 100,
    keyGenerator = (req) => req.ip,
    message = 'Too many requests. Try again later.',
  } = options;

  return (req, res, next) => {
    const key = `rl:${keyGenerator(req)}`;
    const now = Date.now();
    const record = rateLimitStore.get(key);

    if (!record || now - record.startTime > windowMs) {
      rateLimitStore.set(key, { count: 1, startTime: now });
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(max - 1));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));
      return next();
    }

    record.count++;

    const remaining = Math.max(0, max - record.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil((record.startTime + windowMs) / 1000)));

    if (record.count > max) {
      const retryAfter = Math.ceil((record.startTime + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return err(res, message, 429);
    }

    next();
  };
}

// Cleanup expired rate limit entries every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore) {
    if (now - record.startTime > 900000) rateLimitStore.delete(key);
  }
}, 300000);

// ─── Request Logger ───
function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const rid = req.requestId || '-';

    if (status >= 500) {
      logger.error(`[${rid}] ${method} ${originalUrl} ${status} ${duration}ms`);
    } else if (status >= 400) {
      logger.warn(`[${rid}] ${method} ${originalUrl} ${status} ${duration}ms`);
    } else {
      logger.info(`[${rid}] ${method} ${originalUrl} ${status} ${duration}ms`);
    }
  });

  next();
}

// ─── Cron Secret ───
function verifyCronSecret(req, res, next) {
  const secret = req.headers['x-cron-secret'] || req.body?.secret || req.query?.secret;

  if (!INTERNAL_CRON_SECRET) {
    return err(res, 'Cron secret not configured', 503);
  }

  if (!secret) {
    return err(res, 'Unauthorized', 401);
  }

  try {
    const expected = Buffer.from(INTERNAL_CRON_SECRET, 'utf-8');
    const provided = Buffer.from(secret, 'utf-8');

    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
      return err(res, 'Unauthorized', 401);
    }
  } catch {
    return err(res, 'Unauthorized', 401);
  }

  next();
}

module.exports = {
  verifyCronSecret,
  requestId,
  securityHeaders,
  cors,
  rateLimit,
  requestLogger,
  csrfProtection,
  generateCSRFToken,
  verifyCSRFToken,
};
