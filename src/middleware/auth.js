const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const logger = require('../utils/logger');
const { err } = require('../utils/helpers');

const JWT_SECRET = env('JWT_SECRET');

function generateToken(email) {
    if (!JWT_SECRET) {
        logger.error('JWT_SECRET not set — cannot generate token');
        return null;
    }
    return jwt.sign(
        { sub: email, iat: Math.floor(Date.now() / 1000) },
        JWT_SECRET,
        { expiresIn: '7d', algorithm: 'HS256' }
    );
}

function authenticate(req, res, next) {
    if (!JWT_SECRET) {
        logger.error('JWT_SECRET not configured');
        return err(res, 'Authentication not configured', 503);
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return err(res, 'Missing or invalid authorization header', 401);
    }

    const token = authHeader.slice(7);
    if (!token) return err(res, 'Empty token', 401);

    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        if (!decoded.sub || typeof decoded.sub !== 'string') {
            return err(res, 'Invalid token payload', 401);
        }
        req.user = { email: decoded.sub };
        next();
    } catch (e) {
        if (e.name === 'TokenExpiredError') return err(res, 'Token expired', 401);
        if (e.name === 'JsonWebTokenError') return err(res, 'Invalid token', 401);
        logger.error('Auth error:', e.message);
        return err(res, 'Authentication failed', 401);
    }
}

function optionalAuth(req, res, next) {
    if (!JWT_SECRET) {
        req.user = null;
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        req.user = null;
        return next();
    }
    const token = authHeader.slice(7);
    if (!token) { req.user = null; return next(); }

    try {
        const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
        req.user = decoded.sub ? { email: decoded.sub } : null;
    } catch {
        req.user = null;
    }
    next();
}

module.exports = { generateToken, authenticate, optionalAuth };
