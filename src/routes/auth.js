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

function extractUser(token) {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (!decoded.sub) throw new Error('Invalid token');
    return decoded;
}

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

function handleJwtError(res, e) {
    if (e.name === 'TokenExpiredError') return err(res, 'Token expired. Please login again.', 401);
    if (e.name === 'JsonWebTokenError') return err(res, 'Invalid token', 401);
    logger.error('JWT error:', e.message);
    return err(res, 'Authentication failed', 401);
}

const router = Router();

// SIGNUP
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
        const { data: existing } = await supabase
            .from('users')
            .select('id, email, password_hash')
            .eq('email', email)
            .single();

        if (existing) {
            return err(res, 'An account with this email already exists. Please login instead.', 409);
        }

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);

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

        try {
            await supabase.from('email_captures').upsert({
                email: user.email,
                source: 'signup',
                captured_at: new Date().toISOString()
            }, { onConflict: 'email' });
        } catch (e) { /* non-critical */ }

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

// EMAIL-ONLY LOGIN (backward compat)
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

        try {
            await supabase.from('email_captures').upsert({
                email: email.trim().toLowerCase(),
                source: 'login-email',
                captured_at: new Date().toISOString()
            }, { onConflict: 'email' });
        } catch (e) { /* non-critical */ }

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
                : { id: userId, email: email.trim().toLowerCase(), name: email.split('@')[0] },
            notice
        });
    } catch (e) {
        logger.error('Email login error:', e.message);
        err(res, 'Login failed', 500);
    }
}

// LOGIN (Email + Password)
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

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

// GET CURRENT USER
router.get('/me', async (req, res) => {
    const token = getAuthToken(req, res);
    if (!token) return;

    try {
        const decoded = extractUser(token);

        const { data: user } = await supabase
            .from('users')
            .select('id, email, name, avatar, created_at, updated_at')
            .eq('email', decoded.sub)
            .single();

        if (!user) return err(res, 'User not found', 404);

        ok(res, {
            success: true,
            user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar, created_at: user.created_at, updated_at: user.updated_at }
        });
    } catch (e) {
        handleJwtError(res, e);
    }
});

// GET PROFILE
router.get('/profile', async (req, res) => {
    const token = getAuthToken(req, res);
    if (!token) return;

    try {
        const decoded = extractUser(token);

        const { data: user } = await supabase
            .from('users')
            .select('id, email, name, avatar, created_at')
            .eq('email', decoded.sub)
            .single();

        if (!user) return err(res, 'User not found', 404);

        const { data: staffSubs } = await supabase
            .from('subscriptions')
            .select('agent_id, plan_name, price, active, created_at')
            .eq('email', decoded.sub)
            .eq('active', true);

        const { data: toolSub } = await supabase
            .from('tool_subscriptions')
            .select('*')
            .eq('email', decoded.sub)
            .eq('active', true)
            .single();

        ok(res, {
            success: true,
            user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar, created_at: user.created_at },
            subscriptions: staffSubs || [],
            toolsPlan: toolSub || null
        });
    } catch (e) {
        handleJwtError(res, e);
    }
});

// UPDATE PROFILE
router.patch('/profile', async (req, res) => {
    const token = getAuthToken(req, res);
    if (!token) return;

    try {
        const decoded = extractUser(token);

        const updates = {};
        if (req.body.name !== undefined) updates.name = sanitizeText(req.body.name, 100);
        if (req.body.avatar !== undefined) updates.avatar = sanitizeText(req.body.avatar, 500);

        if (Object.keys(updates).length === 0) {
            return err(res, 'Nothing to update', 400);
        }
        updates.updated_at = new Date().toISOString();

        const { data: user } = await supabase
            .from('users')
            .update(updates)
            .eq('email', decoded.sub)
            .select('id, email, name, avatar, updated_at')
            .single();

        ok(res, {
            success: true,
            user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar, updated_at: user.updated_at }
        });
    } catch (e) {
        err(res, 'Update failed', 500);
    }
});

// CHANGE PASSWORD
router.post('/change-password', async (req, res) => {
    const token = getAuthToken(req, res);
    if (!token) return;

    const errors = validate(req.body, {
        currentPassword: { required: true, type: 'string', min: 6 },
        newPassword: { required: true, type: 'string', min: 6, max: 100 },
        confirmPassword: { required: true, type: 'string', min: 6, max: 100 },
    });
    if (errors.length > 0) return err(res, errors[0].message, 400);

    try {
        const decoded = extractUser(token);

        const { data: user } = await supabase
            .from('users')
            .select('id, email, password_hash')
            .eq('email', decoded.sub)
            .single();

        if (!user) return err(res, 'User not found', 404);
        if (!user.password_hash) return err(res, 'Contact support to set password', 400);

        const match = await bcrypt.compare(req.body.currentPassword, user.password_hash);
        if (!match) return err(res, 'Current password is incorrect', 401);

        if (req.body.newPassword !== req.body.confirmPassword) {
            return err(res, 'Passwords do not match', 400);
        }

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(req.body.newPassword, salt);

        await supabase
            .from('users')
            .update({ password_hash: hash, updated_at: new Date().toISOString() })
            .eq('email', decoded.sub);

        logger.info('Password changed for:', decoded.sub);
        ok(res, { success: true, message: 'Password changed successfully' });
    } catch (e) {
        handleJwtError(res, e);
    }
});

module.exports = router;
