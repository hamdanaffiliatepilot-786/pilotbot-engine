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

function handleJwtError(res, error) {
    if (error.name === 'TokenExpiredError') {
        return err(res, 'Token expired. Please login again.', 401);
    }

    if (error.name === 'JsonWebTokenError') {
        return err(res, 'Invalid token', 401);
    }

    logger.error('JWT error:', error.message);
    return err(res, 'Authentication failed', 401);
}

const router = Router();

router.post('/signup', async (req, res) => {
    const { name, email, password } = req.body;

    const errors = validate(
        { name, email, password },
        {
            name: { required: true, type: 'string', min: 2, max: 100 },
            email: { required: true, type: 'string', max: 200, email: true },
            password: { required: true, type: 'string', min: 6, max: 100 },
        }
    );

    if (errors.length > 0) return err(res, errors[0].message, 400);

    if (!supabase) return err(res, 'Database not configured', 503);

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = sanitizeText(name.trim(), 100);

    try {
        const { data: existing, error: existingError } = await supabase
            .from('users')
            .select('id, email')
            .eq('email', cleanEmail)
            .maybeSingle();

        if (existingError) {
            logger.error('Signup user lookup error:', existingError.message);
            return err(res, `Database error: ${existingError.message}`, 500);
        }

        if (existing) {
            return err(res, 'An account with this email already exists. Please login instead.', 409);
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const { data: user, error: userError } = await supabase
            .from('users')
            .insert({
                email: cleanEmail,
                password_hash: passwordHash,
                name: cleanName,
                is_active: true,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select('id, email, name, avatar, created_at, is_active')
            .single();

        if (userError) {
            logger.error('Signup insert error:', userError.message);

            return err(
                res,
                `Failed to create account: ${userError.message}`,
                500
            );
        }

        try {
            await supabase.from('email_captures').upsert(
                {
                    email: user.email,
                    source: 'signup',
                    captured_at: new Date().toISOString(),
                },
                { onConflict: 'email' }
            );
        } catch (captureError) {
            logger.warn('Email capture skipped:', captureError.message);
        }

        const token = generateToken(user.id, user.email);

        if (!token) {
            return err(res, 'Auth not configured. Add JWT_SECRET in Render Environment.', 503);
        }

        logger.info('New signup:', user.email);

        return ok(res, {
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                avatar: user.avatar,
                created_at: user.created_at,
            },
        });
    } catch (error) {
        logger.error('Signup exception:', error.message);
        return err(res, `Failed to create account: ${error.message}`, 500);
    }
});

async function handleEmailOnlyLogin(req, res) {
    const { email } = req.body;

    if (!email) return err(res, 'Email is required', 400);

    const errors = validate(
        { email },
        {
            email: { required: true, type: 'string', max: 200, email: true },
        }
    );

    if (errors.length > 0) return err(res, errors[0].message, 400);

    if (!supabase) return err(res, 'Database not configured', 503);

    try {
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, email, name, avatar, password_hash, is_active')
            .eq('email', email.trim().toLowerCase())
            .maybeSingle();

        if (userError) {
            logger.error('Email login lookup error:', userError.message);
            return err(res, 'Database error', 500);
        }

        if (user && user.password_hash && user.is_active !== false) {
            return err(
                res,
                'Please login with your password. If you forgot, use Forgot Password.',
                400
            );
        }

        const randomPass = Math.random().toString(36).substring(2, 10);
        const passwordHash = await bcrypt.hash(randomPass, 10);
        let userId;

        if (!user) {
            const { data: newUser, error: createError } = await supabase
                .from('users')
                .insert({
                    email: email.trim().toLowerCase(),
                    password_hash: passwordHash,
                    name: email.split('@')[0],
                    is_active: true,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .select('id, email, name, avatar, created_at')
                .single();

            if (createError) return err(res, createError.message, 500);
            userId = newUser.id;
        } else {
            userId = user.id;
        }

        const token = generateToken(userId, email.trim().toLowerCase());

        if (!token) return err(res, 'Auth not configured', 503);

        return ok(res, {
            success: true,
            token,
            user: {
                id: userId,
                email: email.trim().toLowerCase(),
                name: user?.name || email.split('@')[0],
                avatar: user?.avatar || null,
            },
        });
    } catch (error) {
        logger.error('Email login exception:', error.message);
        return err(res, 'Login failed', 500);
    }
}

router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!password) {
        return handleEmailOnlyLogin(req, res);
    }

    const errors = validate(
        { email, password },
        {
            email: { required: true, type: 'string', max: 200, email: true },
            password: { required: true, type: 'string', min: 6, max: 100 },
        }
    );

    if (errors.length > 0) return err(res, errors[0].message, 400);

    if (!supabase) return err(res, 'Database not configured', 503);

    try {
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, email, name, avatar, password_hash, is_active, created_at')
            .eq('email', email.trim().toLowerCase())
            .maybeSingle();

        if (userError) {
            logger.error('Login lookup error:', userError.message);
            return err(res, 'Database error', 500);
        }

        if (!user) return err(res, 'No account found with this email.', 404);

        if (user.is_active === false) {
            return err(res, 'This account has been disabled.', 403);
        }

        if (!user.password_hash) {
            return err(res, 'This account has no password set. Please contact support.', 400);
        }

        const passwordMatches = await bcrypt.compare(password, user.password_hash);

        if (!passwordMatches) {
            return err(res, 'Incorrect email or password.', 401);
        }

        const token = generateToken(user.id, user.email);

        if (!token) {
            return err(res, 'Auth not configured. Add JWT_SECRET in Render Environment.', 503);
        }

        return ok(res, {
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                avatar: user.avatar,
                created_at: user.created_at,
            },
        });
    } catch (error) {
        logger.error('Login exception:', error.message);
        return err(res, 'Login failed', 500);
    }
});

router.get('/me', async (req, res) => {
    const token = getAuthToken(req, res);
    if (!token) return;

    try {
        const decoded = extractUser(token);

        if (!supabase) return err(res, 'Database not configured', 503);

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, email, name, avatar, created_at, is_active')
            .eq('id', decoded.uid)
            .maybeSingle();

        if (userError) return err(res, 'Database error', 500);
        if (!user) return err(res, 'User not found', 404);
        if (user.is_active === false) return err(res, 'Account disabled', 403);

        return ok(res, { success: true, user });
    } catch (error) {
        return handleJwtError(res, error);
    }
});

module.exports = {
    router,
    getAuthToken,
    extractUser,
    handleJwtError,
};
