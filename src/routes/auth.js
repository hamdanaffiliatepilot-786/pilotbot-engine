const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase } = require('../config/database');
const { sanitizeText } = require('../utils/sanitize');
const { validate } = require('../middleware/validator');
const { ok, err } = require('../utils/helpers');
const logger = require('../utils/logger');
const { env } = require('../config/env');

const JWT_SECRET = env('JWT_SECRET');

function generateToken(userId, email) {
    if (!JWT_SECRET) {
        logger.error('JWT_SECRET not set');
        return null;
    }
    return jwt.sign(
        { sub: email, uid: userId, iat: Math.floor(Date.now() / 1000) },
        JWT_SECRET,
        { expiresIn: '7d', algorithm: 'HS256' }
    );
}

// ─── Helper: Extract user from JWT token ───
function extractUser(token) {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (!decoded.sub) throw new Error('Invalid token');
    return decoded;
}

// ─── Helper: Get auth token from request ───
function getAuthToken(req, res) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        err(res, 'Missing token', 401);
        return null;
    }
    const token = authHeader.slice(7);
    if (!token) {
        err(res, 'Empty token', 401);
        return null;
    }
    return token;
}

// ─── Helper: Handle JWT errors consistently ───
function handleJwtError(res, e) {
    if (e.name === 'TokenExpiredError') return err(res, 'Token expired. Please login again.', 401);
    if (e.name === 'JsonWebTokenError') return err(res, 'Invalid token', 401);
    logger.error('JWT error:', e.message);
    return err(res, 'Authentication failed', 401);
}

const router = Router();

// ─── SIGNUP ───
router.post('/signup', async (req, res) => {
    const { name, email, password } = req.body;

    const errors = validate({ name, email, password }, {
        name: { required: true, type: 'string', min: 2, max: 100 },
        email: { required: true, type: 'string', max: 200, email: true },
        password: { required: true, type: 'string', min: 6, max: 100 },
    });
    if (errors.length > 0) return err(res, errors[0].message, 400);

    if (!supabase) return err(res, 'Database not configured', 503);

    try {
        // Check if email already exists
        const { data: existing } = await supabase
            .from('users')
            .select('id, email, password_hash')
            .eq('email', email)
            .single();

        if (existing) {
            return err(res, 'An account with this email already exists. Please login instead.', 409);
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);

        // Create user
        const { data: user, error: userError } = await supabase
            .from('users')
            .insert({
                email: email.trim().toLowerCase(),
                password_hash: hash,
                name: sanitizeText(name, 100),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select('id, email, name, avatar, created_at')
            .single();

        if (userError) {
            logger.error('Signup error:', userError.message);
            return err(res, 'Failed to create account', 500);
        }

        // Also save to email_captures for lead tracking
        try {
            await supabase.from('email_captures').upsert({
                email: user.email,
                source: 'signup',
                captured_at: new Date().toISOString()
            }, { onConflict: 'email' });
        } catch (e) {
            // Non-critical, don't fail signup
        }

        const token = generateToken(user.id, user.email);
        if (!token) return err(res, 'Auth not configured', 503);

        logger.info('New signup:', user.email);
        ok(res, {
            success: true,
            token,
            user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar, created_at: user.created_at }
        });
    } catch (e) {
        logger.error('Signup exception:', e.message);
        err(res, 'Failed to create account', 500);
    }
});

// ─── LOGIN (Email + Password) ───
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    // Backward compatibility: if no password, treat as email-only login
    if (!password) {
        return handleEmailOnlyLogin(req, res);
    }

    const errors = validate({ email, password }, {
        email: { required: true, type: 'string', max: 200, email: true },
        password: { required: true, type: 'string', min: 6, max: 100 },
    });
    if (errors.length > 0) return err(res, errors[0].message, 400);

    if (!supabase) return err(res, 'Database not configured', 503);

    try {
        const { data: user } = await supabase
            .from('users')
            .select('id, email, name, avatar, password_hash, is_active')
            .eq('email', email.trim().toLowerCase())
            .single();

        if (!user) {
            return err(res, 'No account found with this email. Please sign up first.', 404);
        }

        if (!user.is_active) {
            return err(res, 'Account is deactivated. Contact support.', 403);
        }

        if (!user.password_hash) {
            return err(res, 'This account was created with social login. Please use social login or reset password.', 400);
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return err(res, 'Incorrect password', 401);
        }

        const token = generateToken(user.id, user.email);
        if (!token) return err(res, 'Auth not configured', 503);

        logger.info('Login:', user.email);
        ok(res, {
            success: true,
            token,
            user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar, created_at: user.created_at }
        });
    } catch (e) {
        logger.error('Login exception:', e.message);
        err(res, 'Login failed', 500);
    }
});

// ─── EMAIL-ONLY LOGIN (Backward compat for old users) ───
async function handleEmailOnlyLogin(req, res) {
    const { email } = req.body;

    if (!email) return err(res, 'Email is required', 400);

    const errors = validate({ email }, {
        email: { required: true, type: 'string', max: 200, email: true },
    });
    if (errors.length > 0) return err(res, errors[0].message, 400);

    if (!supabase) return err(res, 'Database not configured', 503);

    try {
        const { data: user } = await supabase
            .from('users')
            .select('id, email, name, avatar, password_hash, is_active')
            .eq('email', email.trim().toLowerCase())
            .single();

        if (user && user.password_hash && user.is_active) {
            return err(res, 'Please login with your password. If you forgot, use "Forgot Password" feature.', 400);
        }

        // Generate a random password for accounts without one
        const randomPass = Math.random().toString(36).substring(2, 10);
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(randomPass, salt);

        let userId;

        if (user) {
            await supabase
                .from('users')
                .update({ password_hash: hash, updated_at: new Date().toISOString() })
                .eq('email', email.trim().toLowerCase());
            userId = user.id;
        } else {
            const { data: newUser } = await supabase
                .from('users')
                .insert({
                    email: email.trim().toLowerCase(),
                    password_hash: hash,
                    name: email.split('@')[0],
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .select('id, email, name')
                .single();
            userId = newUser.id;
        }

        // Save to email_captures
        try {
            await supabase.from('email_captures').upsert({
                email: email.trim().toLowerCase(),
                source: 'login-email',
                captured_at: new Date().toISOString()
            }, { onConflict: 'email' });
        } catch (e) {
            // Non-critical
        }

        const token = generateToken(userId, email.trim().toLowerCase());
        if (!token) return err(res, 'Auth not configured', 503);

        const notice = user && !user.password_hash
            ? 'Account upgraded! Please set a password for security.'
            : null;

        logger.info('Email login:', email);
        ok(res, {
            success: true,
            token,
            user: user
                ? { id: user.id, email: user.email, name: user.name, avatar: user.avatar }
                : { id: userId, email: email.trim().toLowerCase(), name: email.split('@')[0
