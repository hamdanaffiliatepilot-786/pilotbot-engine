const { Router } = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { supabase } = require('../config/database');
const { sanitizeText } = require('../utils/sanitize');
const { validate } = require('../middleware/validator');
const { ok, err } = require('../utils/helpers');
const logger = require('../utils/logger');
const { sendVerificationEmail, sendResetEmail } = require('../utils/email');
const {
    generateAccessToken,
    generateRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    hashToken,
} = require('../middleware/auth');

const router = Router();

// ─── Rate Limiter ───

const rateLimits = new Map();

function rateLimit(key, maxAttempts, windowMs) {
    const now = Date.now();
    const record = rateLimits.get(key);

    if (!record || now - record.startTime > windowMs) {
        rateLimits.set(key, { count: 1, startTime: now });
        return false;
    }

    record.count++;
    if (record.count > maxAttempts) {
        const retryAfter = Math.ceil((record.startTime + windowMs - now) / 1000);
        return { retryAfter };
    }

    return false;
}

setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimits) {
        if (now - record.startTime > 900000) rateLimits.delete(key);
    }
}, 900000);

// ─── Helpers ───

function getErrorMessage(error, fallback) {
    const message = String(error?.message || error || '');
    if (!message || message.length > 300) return fallback;
    return message;
}

function extractBearerToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7).trim();
    return token || null;
}

function getUserResponse(user) {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar || null,
        is_pro: user.is_pro === true,
        plan_type: user.plan_type || 'free',
        email_verified: user.email_verified === true,
        created_at: user.created_at || null,
    };
}

function generateVerificationToken() {
    return crypto.randomBytes(32).toString('hex');
}

function generateResetToken() {
    return crypto.randomBytes(32).toString('hex');
}

async function createSession(userId, refreshToken, req) {
    if (!supabase) return null;

    const tokenHash = hashToken(refreshToken);
    const deviceInfo = req.headers['user-agent'] || null;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase.from('sessions').insert({
        user_id: userId,
        refresh_token_hash: tokenHash,
        device_info: deviceInfo,
        ip_address: ipAddress,
        expires_at: expiresAt,
        revoked: false,
    });

    if (error) {
        logger.error('Session create error:', error.message);
    }
}

async function revokeSession(refreshToken) {
    if (!supabase || !refreshToken) return;
    const tokenHash = hashToken(refreshToken);
    await supabase.from('sessions').update({ revoked: true }).eq('refresh_token_hash', tokenHash);
}

async function revokeAllSessions(userId) {
    if (!supabase || !userId) return;
    await supabase.from('sessions').update({ revoked: true }).eq('user_id', userId).eq('revoked', false);
}

async function cleanExpiredSessions() {
    if (!supabase) return;
    const now = new Date().toISOString();
    await supabase.from('sessions').delete().lt('expires_at', now);
}

setInterval(cleanExpiredSessions, 3600000);

// ─── SIGNUP ───

router.post('/signup', async (req, res) => {
    const { name, email, password } = req.body || {};

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
        const { data: existingUser, error: lookupError } = await supabase
            .from('users')
            .select('id')
            .eq('email', cleanEmail)
            .maybeSingle();

        if (lookupError) {
            logger.error('Signup lookup error:', lookupError.message);
            return err(res, `Database error: ${getErrorMessage(lookupError, 'Could not check existing account')}`, 500);
        }

        if (existingUser) {
            logger.auth('SIGNUP_FAILED', { email: cleanEmail, reason: 'exists', ip: req.ip, requestId: req.requestId });
            return err(res, 'An account with this email already exists. Please login instead.', 409);
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const verificationToken = generateVerificationToken();
        const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        const { data: user, error: insertError } = await supabase
            .from('users')
            .insert({
                email: cleanEmail,
                password_hash: passwordHash,
                name: cleanName,
                is_pro: false,
                plan_type: 'free',
                email_verified: false,
                verification_token: verificationToken,
                verification_token_expires: verificationExpiresAt,
            })
            .select('id, email, name, avatar, is_pro, plan_type, email_verified, created_at')
            .single();

        if (insertError) {
            logger.error('Signup insert error:', insertError.message);
            return err(res, `Failed to create account: ${getErrorMessage(insertError, 'Unknown database error')}`, 500);
        }

        try {
            await supabase.from('email_captures').upsert(
                { email: user.email, source: 'signup' },
                { onConflict: 'email' }
            );
        } catch (e) {
            logger.warn('Email capture skipped:', e?.message || e);
        }

        await sendVerificationEmail(user.email, verificationToken);

        const accessToken = generateAccessToken(user.id, user.email);
        const refreshToken = generateRefreshToken();

        if (!accessToken || !refreshToken) {
            return err(res, 'Auth not configured. Add JWT_SECRET in environment variables.', 503);
        }

        await createSession(user.id, refreshToken, req);

        logger.auth('SIGNUP', { userId: user.id, email: cleanEmail, name: cleanName, ip: req.ip, requestId: req.requestId });

        return ok(res, {
            success: true,
            token: accessToken,
            refresh_token: refreshToken,
            user: getUserResponse(user),
        });
    } catch (error) {
        logger.error('Signup exception:', error?.message || error);
        return err(res, `Failed to create account: ${getErrorMessage(error, 'Unexpected server error')}`, 500);
    }
});

// ─── LOGIN ───

router.post('/login', async (req, res) => {
    const { email, password } = req.body || {};

    const errors = validate(
        { email, password },
        {
            email: { required: true, type: 'string', max: 200, email: true },
            password: { required: true, type: 'string', min: 6, max: 100 },
        }
    );

    if (errors.length > 0) return err(res, errors[0].message, 400);
    if (!supabase) return err(res, 'Database not configured', 503);

    const cleanEmail = email.trim().toLowerCase();

    const ipLimit = rateLimit(`login_ip:${req.ip}`, 20, 900000);
    if (ipLimit) {
        logger.auth('LOGIN_RATE_LIMITED', { email: cleanEmail, reason: 'ip', ip: req.ip, requestId: req.requestId });
        return err(res, `Too many login attempts. Try again in ${ipLimit.retryAfter} seconds.`, 429);
    }

    const emailLimit = rateLimit(`login_email:${cleanEmail}`, 10, 900000);
    if (emailLimit) {
        logger.auth('LOGIN_RATE_LIMITED', { email: cleanEmail, reason: 'email', ip: req.ip, requestId: req.requestId });
        return err(res, `Too many login attempts for this email. Try again in ${emailLimit.retryAfter} seconds.`, 429);
    }

    try {
        const { data: user, error: lookupError } = await supabase
            .from('users')
            .select('id, email, name, avatar, password_hash, is_pro, plan_type, email_verified, created_at')
            .eq('email', cleanEmail)
            .maybeSingle();

        if (lookupError) {
            logger.error('Login lookup error:', lookupError.message);
            return err(res, `Database error: ${getErrorMessage(lookupError, 'Could not find account')}`, 500);
        }

        if (!user) {
            logger.auth('LOGIN_FAILED', { email: cleanEmail, reason: 'not_found', ip: req.ip, requestId: req.requestId });
            return err(res, 'No account found with this email.', 404);
        }
        if (!user.password_hash) {
            logger.auth('LOGIN_FAILED', { email: cleanEmail, reason: 'no_password', ip: req.ip, requestId: req.requestId });
            return err(res, 'This account has no password set. Please create a new account.', 400);
        }

        const passwordMatches = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatches) {
            logger.auth('LOGIN_FAILED', { userId: user.id, email: cleanEmail, reason: 'wrong_password', ip: req.ip, requestId: req.requestId });
            return err(res, 'Incorrect email or password.', 401);
        }

        const accessToken = generateAccessToken(user.id, user.email);
        const refreshToken = generateRefreshToken();

        if (!accessToken || !refreshToken) {
            return err(res, 'Auth not configured. Add JWT_SECRET in environment variables.', 503);
        }

        await createSession(user.id, refreshToken, req);

        logger.auth('LOGIN', { userId: user.id, email: cleanEmail, name: user.name, ip: req.ip, requestId: req.requestId });

        return ok(res, {
            success: true,
            token: accessToken,
            refresh_token: refreshToken,
            user: getUserResponse(user),
        });
    } catch (error) {
        logger.error('Login exception:', error?.message || error);
        return err(res, `Login failed: ${getErrorMessage(error, 'Unexpected server error')}`, 500);
    }
});

// ─── REFRESH TOKEN ───

router.post('/refresh', async (req, res) => {
    const { refresh_token } = req.body || {};

    if (!refresh_token || typeof refresh_token !== 'string' || !refresh_token.trim()) {
        return err(res, 'Refresh token required', 401);
    }

    if (!supabase) return err(res, 'Database not configured', 503);

    if (!verifyRefreshToken(refresh_token)) {
        logger.auth('REFRESH_FAILED', { reason: 'invalid_token', requestId: req.requestId });
        return err(res, 'Invalid or expired refresh token', 401);
    }

    const tokenHash = hashToken(refresh_token);

    try {
        const { data: session, error: sessionError } = await supabase
            .from('sessions')
            .select('id, user_id, expires_at, revoked')
            .eq('refresh_token_hash', tokenHash)
            .maybeSingle();

        if (sessionError) {
            logger.error('Session lookup error:', sessionError.message);
            return err(res, 'Session lookup failed', 500);
        }

        if (!session) {
            logger.auth('REFRESH_FAILED', { reason: 'session_not_found', requestId: req.requestId });
            return err(res, 'Session not found', 401);
        }
        if (session.revoked) {
            logger.auth('REFRESH_FAILED', { reason: 'session_revoked', requestId: req.requestId });
            return err(res, 'Session revoked', 401);
        }

        if (new Date(session.expires_at) < new Date()) {
            await supabase.from('sessions').update({ revoked: true }).eq('id', session.id);
            logger.auth('REFRESH_FAILED', { reason: 'session_expired', requestId: req.requestId });
            return err(res, 'Refresh token expired. Please login again.', 401);
        }

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, email, name, avatar, is_pro, plan_type, email_verified, created_at')
            .eq('id', session.user_id)
            .maybeSingle();

        if (userError || !user) {
            await supabase.from('sessions').update({ revoked: true }).eq('id', session.id);
            return err(res, 'User not found', 401);
        }

        const newAccessToken = generateAccessToken(user.id, user.email);
        const newRefreshToken = generateRefreshToken();

        if (!newAccessToken || !newRefreshToken) {
            return err(res, 'Auth not configured', 503);
        }

        await supabase.from('sessions').update({ revoked: true }).eq('id', session.id);
        await createSession(user.id, newRefreshToken, req);

        logger.auth('TOKEN_REFRESH', { userId: user.id, email: user.email, requestId: req.requestId });

        return ok(res, {
            success: true,
            token: newAccessToken,
            refresh_token: newRefreshToken,
            user: getUserResponse(user),
        });
    } catch (error) {
        logger.error('Refresh exception:', error?.message || error);
        return err(res, 'Token refresh failed', 500);
    }
});

// ─── LOGOUT ───

router.post('/logout', async (req, res) => {
    const refreshToken = req.body?.refresh_token;

    if (refreshToken) {
        await revokeSession(refreshToken);
    }

    logger.auth('LOGOUT', { requestId: req.requestId });

    return ok(res, { success: true, message: 'Logged out' });
});

// ─── GET CURRENT USER ───

router.get('/me', async (req, res) => {
    const token = extractBearerToken(req);
    if (!token) return err(res, 'Missing token', 401);

    const payload = verifyAccessToken(token);
    if (!payload) return err(res, 'Invalid or expired token', 401);

    if (!supabase) return err(res, 'Database not configured', 503);

    try {
        const { data: user, error: lookupError } = await supabase
            .from('users')
            .select('id, email, name, avatar, is_pro, plan_type, email_verified, created_at')
            .eq('id', payload.userId)
            .maybeSingle();

        if (lookupError) {
            logger.error('Current user lookup error:', lookupError.message);
            return err(res, `Database error: ${getErrorMessage(lookupError, 'Could not load user')}`, 500);
        }

        if (!user) return err(res, 'User not found', 404);

        return ok(res, { success: true, user: getUserResponse(user) });
    } catch (error) {
        logger.error('/me exception:', error?.message || error);
        return err(res, 'Failed to load user', 500);
    }
});

// ─── FORGOT PASSWORD ───

router.post('/forgot-password', async (req, res) => {
    const { email } = req.body || {};

    const errors = validate(
        { email },
        { email: { required: true, type: 'string', max: 200, email: true } }
    );

    if (errors.length > 0) return err(res, errors[0].message, 400);
    if (!supabase) return err(res, 'Database not configured', 503);

    const cleanEmail = email.trim().toLowerCase();

    const limit = rateLimit(`forgot:${cleanEmail}`, 3, 900000);
    if (limit) {
        logger.auth('FORGOT_PASSWORD_RATE_LIMITED', { email: cleanEmail, ip: req.ip, requestId: req.requestId });
        return err(res, `Too many requests. Try again in ${limit.retryAfter} seconds.`, 429);
    }

    try {
        const { data: user, error: lookupError } = await supabase
            .from('users')
            .select('id, email')
            .eq('email', cleanEmail)
            .maybeSingle();

        if (lookupError) {
            logger.error('Forgot password lookup error:', lookupError.message);
            return err(res, 'Something went wrong', 500);
        }

        if (user) {
            const resetToken = generateResetToken();
            const resetExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

            const { error: updateError } = await supabase
                .from('users')
                .update({
                    reset_token: resetToken,
                    reset_token_expires: resetExpiresAt,
                })
                .eq('id', user.id);

            if (!updateError) {
                await sendResetEmail(user.email, resetToken);
                logger.auth('FORGOT_PASSWORD', { userId: user.id, email: cleanEmail, ip: req.ip, requestId: req.requestId });
            }
        }

        return ok(res, {
            success: true,
            message: 'If an account exists with this email, you will receive a password reset link.',
        });
    } catch (error) {
        logger.error('Forgot password exception:', error?.message || error);
        return ok(res, {
            success: true,
            message: 'If an account exists with this email, you will receive a password reset link.',
        });
    }
});

// ─── RESET PASSWORD ───

router.post('/reset-password', async (req, res) => {
    const { token, password } = req.body || {};

    const errors = validate(
        { token, password },
        {
            token: { required: true, type: 'string', min: 1, max: 200 },
            password: { required: true, type: 'string', min: 6, max: 100 },
        }
    );

    if (errors.length > 0) return err(res, errors[0].message, 400);
    if (!supabase) return err(res, 'Database not configured', 503);

    try {
        const { data: user, error: lookupError } = await supabase
            .from('users')
            .select('id, email, reset_token, reset_token_expires')
            .eq('reset_token', token)
            .maybeSingle();

        if (lookupError) {
            logger.error('Reset password lookup error:', lookupError.message);
            return err(res, 'Something went wrong', 500);
        }

        if (!user || !user.reset_token) {
            logger.auth('RESET_PASSWORD_FAILED', { reason: 'invalid_token', requestId: req.requestId });
            return err(res, 'Invalid or expired reset link', 400);
        }

        if (new Date(user.reset_token_expires) < new Date()) {
            logger.auth('RESET_PASSWORD_FAILED', { userId: user.id, email: user.email, reason: 'expired', requestId: req.requestId });
            return err(res, 'Reset link has expired. Please request a new one.', 400);
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const { error: updateError } = await supabase
            .from('users')
            .update({
                password_hash: passwordHash,
                reset_token: null,
                reset_token_expires: null,
            })
            .eq('id', user.id);

        if (updateError) {
            logger.error('Reset password update error:', updateError.message);
            return err(res, 'Failed to reset password', 500);
        }

        await revokeAllSessions(user.id);

        logger.auth('PASSWORD_RESET', { userId: user.id, email: user.email, ip: req.ip, requestId: req.requestId });

        return ok(res, {
            success: true,
            message: 'Password reset successful. Please login with your new password.',
        });
    } catch (error) {
        logger.error('Reset password exception:', error?.message || error);
        return err(res, 'Failed to reset password', 500);
    }
});

// ─── VERIFY EMAIL ───

router.post('/verify-email', async (req, res) => {
    const { token } = req.body || {};

    if (!token || typeof token !== 'string' || !token.trim()) {
        return err(res, 'Verification token required', 400);
    }

    if (!supabase) return err(res, 'Database not configured', 503);

    try {
        const { data: user, error: lookupError } = await supabase
            .from('users')
            .select('id, email, email_verified, verification_token, verification_token_expires')
            .eq('verification_token', token)
            .maybeSingle();

        if (lookupError) {
            logger.error('Verify email lookup error:', lookupError.message);
            return err(res, 'Something went wrong', 500);
        }

        if (!user || !user.verification_token) {
            return err(res, 'Invalid verification link', 400);
        }

        if (user.email_verified) {
            return ok(res, { success: true, message: 'Email is already verified.' });
        }

        if (new Date(user.verification_token_expires) < new Date()) {
            return err(res, 'Verification link has expired. Please request a new one.', 400);
        }

        const { error: updateError } = await supabase
            .from('users')
            .update({
                email_verified: true,
                verification_token: null,
                verification_token_expires: null,
            })
            .eq('id', user.id);

        if (updateError) {
            logger.error('Verify email update error:', updateError.message);
            return err(res, 'Failed to verify email', 500);
        }

        logger.auth('EMAIL_VERIFIED', { userId: user.id, email: user.email, requestId: req.requestId });

        return ok(res, { success: true, message: 'Email verified successfully.' });
    } catch (error) {
        logger.error('Verify email exception:', error?.message || error);
        return err(res, 'Failed to verify email', 500);
    }
});

// ─── RESEND VERIFICATION EMAIL ───

router.post('/resend-verification', async (req, res) => {
    const accessToken = extractBearerToken(req);
    if (!accessToken) return err(res, 'Missing token', 401);

    const payload = verifyAccessToken(accessToken);
    if (!payload) return err(res, 'Invalid or expired token', 401);

    if (!supabase) return err(res, 'Database not configured', 503);

    const limit = rateLimit(`verify_resend:${payload.userId}`, 2, 300000);
    if (limit) return err(res, `Too many requests. Try again in ${limit.retryAfter} seconds.`, 429);

    try {
        const { data: user, error: lookupError } = await supabase
            .from('users')
            .select('id, email, email_verified')
            .eq('id', payload.userId)
            .maybeSingle();

        if (lookupError || !user) return err(res, 'User not found', 404);
        if (user.email_verified) return err(res, 'Email is already verified', 400);

        const verificationToken = generateVerificationToken();
        const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        const { error: updateError } = await supabase
            .from('users')
            .update({
                verification_token: verificationToken,
                verification_token_expires: verificationExpiresAt,
            })
            .eq('id', user.id);

        if (updateError) {
            logger.error('Resend verification update error:', updateError.message);
            return err(res, 'Failed to send verification email', 500);
        }

        await sendVerificationEmail(user.email, verificationToken);

        logger.auth('VERIFICATION_RESENT', { userId: user.id, email: user.email, requestId: req.requestId });

        return ok(res, { success: true, message: 'Verification email sent.' });
    } catch (error) {
        logger.error('Resend verification exception:', error?.message || error);
        return err(res, 'Failed to send verification email', 500);
    }
});

// ─── CHANGE PASSWORD ───

router.post('/change-password', async (req, res) => {
    const accessToken = extractBearerToken(req);
    if (!accessToken) return err(res, 'Missing token', 401);

    const payload = verifyAccessToken(accessToken);
    if (!payload) return err(res, 'Invalid or expired token', 401);

    const { current_password, new_password } = req.body || {};

    const errors = validate(
        { current_password, new_password },
        {
            current_password: { required: true, type: 'string', min: 6, max: 100 },
            new_password: { required: true, type: 'string', min: 6, max: 100 },
        }
    );

    if (errors.length > 0) return err(res, errors[0].message, 400);
    if (!supabase) return err(res, 'Database not configured', 503);

    try {
        const { data: user, error: lookupError } = await supabase
            .from('users')
            .select('id, email, password_hash')
            .eq('id', payload.userId)
            .maybeSingle();

        if (lookupError || !user) return err(res, 'User not found', 404);

        const passwordMatches = await bcrypt.compare(current_password, user.password_hash);
        if (!passwordMatches) {
            logger.auth('CHANGE_PASSWORD_FAILED', { userId: user.id, email: user.email, reason: 'wrong_current', requestId: req.requestId });
            return err(res, 'Current password is incorrect', 401);
        }

        const passwordHash = await bcrypt.hash(new_password, 10);

        const { error: updateError } = await supabase
            .from('users')
            .update({ password_hash: passwordHash })
            .eq('id', user.id);

        if (updateError) {
            logger.error('Change password error:', updateError.message);
            return err(res, 'Failed to change password', 500);
        }

        await revokeAllSessions(user.id);

        logger.auth('PASSWORD_CHANGED', { userId: user.id, email: user.email, ip: req.ip, requestId: req.requestId });

        return ok(res, { success: true, message: 'Password changed. Please login again.' });
    } catch (error) {
        logger.error('Change password exception:', error?.message || error);
        return err(res, 'Failed to change password', 500);
    }
});

module.exports = router;
