const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase } = require('../config/database');
const { sanitizeText } = require('../utils/sanitize');
const { validate } = require('../middleware/validator');
const { ok, err } = require('../utils/helpers');
const logger = require('../utils/logger');
const { env } = require('../config/env');

const router = Router();
const JWT_SECRET = env('JWT_SECRET');

function generateToken(userId, email) {
    if (!JWT_SECRET) {
        logger.error('JWT_SECRET not set');
        return null;
    }

    return jwt.sign(
        {
            sub: email,
            uid: userId,
            iat: Math.floor(Date.now() / 1000),
        },
        JWT_SECRET,
        {
            expiresIn: '7d',
            algorithm: 'HS256',
        }
    );
}

function extractUser(token) {
    return jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256'],
    });
}

function getAuthToken(req, res) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        err(res, 'Missing token', 401);
        return null;
    }

    const token = authHeader.slice(7).trim();

    if (!token) {
        err(res, 'Empty token', 401);
        return null;
    }

    return token;
}

function handleJwtError(res, error) {
    if (error?.name === 'TokenExpiredError') {
        return err(res, 'Token expired. Please login again.', 401);
    }

    if (error?.name === 'JsonWebTokenError') {
        return err(res, 'Invalid token. Please login again.', 401);
    }

    logger.error('JWT error:', error?.message || error);
    return err(res, 'Authentication failed', 401);
}

function cleanErrorMessage(error, fallback) {
    if (!error) return fallback;

    const message = String(error.message || error);

    if (message.length > 300) {
        return fallback;
    }

    return message;
}

/*
|--------------------------------------------------------------------------
| SIGNUP
|--------------------------------------------------------------------------
*/
router.post('/signup', async (req, res) => {
    const { name, email, password } = req.body || {};

    const errors = validate(
        { name, email, password },
        {
            name: {
                required: true,
                type: 'string',
                min: 2,
                max: 100,
            },
            email: {
                required: true,
                type: 'string',
                max: 200,
                email: true,
            },
            password: {
                required: true,
                type: 'string',
                min: 6,
                max: 100,
            },
        }
    );

    if (errors.length > 0) {
        return err(res, errors[0].message, 400);
    }

    if (!supabase) {
        return err(res, 'Database not configured', 503);
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = sanitizeText(name.trim(), 100);

    try {
        const { data: existingUser, error: existingUserError } = await supabase
            .from('users')
            .select('id, email')
            .eq('email', cleanEmail)
            .maybeSingle();

        if (existingUserError) {
            logger.error('Signup lookup error:', existingUserError.message);

            return err(
                res,
                `Database error: ${cleanErrorMessage(
                    existingUserError,
                    'Could not check existing account'
                )}`,
                500
            );
        }

        if (existingUser) {
            return err(
                res,
                'An account with this email already exists. Please login instead.',
                409
            );
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const insertData = {
            email: cleanEmail,
            password_hash: passwordHash,
            name: cleanName,
            is_active: true,
        };

        const { data: user, error: userError } = await supabase
            .from('users')
            .insert(insertData)
            .select('id, email, name, avatar, created_at, is_active')
            .single();

        if (userError) {
            logger.error('Signup insert error:', userError.message);

            return err(
                res,
                `Failed to create account: ${cleanErrorMessage(
                    userError,
                    'Unknown database error'
                )}`,
                500
            );
        }

        /*
         * Email capture is optional.
         * Signup should still work even if email_captures table has any issue.
         */
        try {
            await supabase
                .from('email_captures')
                .upsert(
                    {
                        email: user.email,
                        source: 'signup',
                    },
                    {
                        onConflict: 'email',
                    }
                );
        } catch (captureError) {
            logger.warn(
                'Email capture skipped:',
                captureError?.message || captureError
            );
        }

        const token = generateToken(user.id, user.email);

        if (!token) {
            return err(
                res,
                'Auth not configured. Please add JWT_SECRET in Render environment variables.',
                503
            );
        }

        logger.info(`New signup: ${user.email}`);

        return ok(res, {
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                avatar: user.avatar || null,
                created_at: user.created_at || null,
            },
        });
    } catch (error) {
        logger.error('Signup exception:', error?.message || error);

        return err(
            res,
            `Failed to create account: ${cleanErrorMessage(
                error,
                'Unexpected server error'
            )}`,
            500
        );
    }
});

/*
|--------------------------------------------------------------------------
| LOGIN
|--------------------------------------------------------------------------
*/
router.post('/login', async (req, res) => {
    const { email, password } = req.body || {};

    const errors = validate(
        { email, password },
        {
            email: {
                required: true,
                type: 'string',
                max: 200,
                email: true,
            },
            password: {
                required: true,
                type: 'string',
                min: 6,
                max: 100,
            },
        }
    );

    if (errors.length > 0) {
        return err(res, errors[0].message, 400);
    }

    if (!supabase) {
        return err(res, 'Database not configured', 503);
    }

    const cleanEmail = email.trim().toLowerCase();

    try {
        const { data: user, error: userError } = await supabase
            .from('users')
            .select(
                'id, email, name, avatar, password_hash, is_active, created_at'
            )
            .eq('email', cleanEmail)
            .maybeSingle();

        if (userError) {
            logger.error('Login lookup error:', userError.message);

            return err(
                res,
                `Database error: ${cleanErrorMessage(
                    userError,
                    'Could not find account'
                )}`,
                500
            );
        }

        if (!user) {
            return err(res, 'No account found with this email.', 404);
        }

        if (user.is_active === false) {
            return err(res, 'This account has been disabled.', 403);
        }

        if (!user.password_hash) {
            return err(
                res,
                'This account has no password set. Please create a new account.',
                400
            );
        }

        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatches) {
            return err(res, 'Incorrect email or password.', 401);
        }

        const token = generateToken(user.id, user.email);

        if (!token) {
            return err(
                res,
                'Auth not configured. Please add JWT_SECRET in Render environment variables.',
                503
            );
        }

        return ok(res, {
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                avatar: user.avatar || null,
                created_at: user.created_at || null,
            },
        });
    } catch (error) {
        logger.error('Login exception:', error?.message || error);

        return err(
            res,
            `Login failed: ${cleanErrorMessage(
                error,
                'Unexpected server error'
            )}`,
            500
        );
    }
});

/*
|--------------------------------------------------------------------------
| CURRENT USER
|--------------------------------------------------------------------------
*/
router.get('/me', async (req, res) => {
    const token = getAuthToken(req, res);

    if (!token) {
        return;
    }

    if (!JWT_SECRET) {
        return err(
            res,
            'Auth not configured. Please add JWT_SECRET in Render environment variables.',
            503
        );
    }

    try {
        const decoded = extractUser(token);

        if (!decoded?.uid) {
            return err(res, 'Invalid token', 401);
        }

        if (!supabase) {
            return err(res, 'Database not configured', 503);
        }

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, email, name, avatar, created_at, is_active')
            .eq('id', decoded.uid)
            .maybeSingle();

        if (userError) {
            logger.error('Current user lookup error:', userError.message);

            return err(
                res,
                `Database error: ${cleanErrorMessage(
                    userError,
                    'Could not load user'
                )}`,
                500
            );
        }

        if (!user) {
            return err(res, 'User not found', 404);
        }

        if (user.is_active === false) {
            return err(res, 'Account disabled', 403);
        }

        return ok(res, {
            success: true,
            user,
        });
    } catch (error) {
        return handleJwtError(res, error);
    }
});

/*
|--------------------------------------------------------------------------
| IMPORTANT
|--------------------------------------------------------------------------
| src/index.js uses:
| app.use('/api/auth', require('./routes/auth'));
|
| So this MUST export the router directly, not an object.
|--------------------------------------------------------------------------
*/
module.exports = router;

/*
|--------------------------------------------------------------------------
| Optional helper functions attached to router.
| This keeps app.use(...) working and allows other files to use helpers if needed.
|--------------------------------------------------------------------------
*/
module.exports.getAuthToken = getAuthToken;
module.exports.extractUser = extractUser;
module.exports.handleJwtError = handleJwtError;
