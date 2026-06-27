const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { env } = require('../config/env');
const { ACCESS_TOKEN_EXPIRY, REFRESH_TOKEN_EXPIRY } = require('../config/constants');
const logger = require('../utils/logger');
const { err } = require('../utils/helpers');

const JWT_SECRET = env('JWT_SECRET');

function generateAccessToken(userId, email) {
  if (!JWT_SECRET) {
    logger.error('JWT_SECRET not set');
    return null;
  }
  return jwt.sign(
    { sub: userId, email, type: 'access', iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY, algorithm: 'HS256' }
  );
}

function generateRefreshToken() {
  if (!JWT_SECRET) {
    logger.error('JWT_SECRET not set');
    return null;
  }
  return jwt.sign(
    { type: 'refresh', iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY, algorithm: 'HS256' }
  );
}

function verifyAccessToken(token) {
  if (!JWT_SECRET || !token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (decoded.type !== 'access' || !decoded.sub || !decoded.email) return null;
    return { userId: decoded.sub, email: decoded.email };
  } catch {
    return null;
  }
}

function verifyRefreshToken(token) {
  if (!JWT_SECRET || !token) return false;
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    return decoded.type === 'refresh';
  } catch {
    return false;
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function authenticate(req, res, next) {
  if (!JWT_SECRET) return err(res, 'Authentication not configured', 503);

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return err(res, 'Missing authorization header', 401);
  }

  const token = authHeader.slice(7).trim();
  if (!token) return err(res, 'Empty token', 401);

  const payload = verifyAccessToken(token);
  if (!payload) {
    try {
      const decoded = jwt.decode(token);
      if (decoded?.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
        return err(res, 'Token expired', 401);
      }
    } catch { /* ignore */ }
    return err(res, 'Invalid token', 401);
  }

  req.user = { id: payload.userId, email: payload.email };
  next();
}

function optionalAuth(req, res, next) {
  if (!JWT_SECRET) { req.user = null; return next(); }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) { req.user = null; return next(); }

  const token = authHeader.slice(7).trim();
  if (!token) { req.user = null; return next(); }

  const payload = verifyAccessToken(token);
  req.user = payload ? { id: payload.userId, email: payload.email } : null;
  next();
}

const dashboardAuth = authenticate;

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
  authenticate,
  optionalAuth,
  dashboardAuth,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY,
};
