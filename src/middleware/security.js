const crypto = require('crypto');
const { env } = require('../config/env');
const { err } = require('../utils/helpers');

const INTERNAL_CRON_SECRET = env('CRON_SECRET');

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

module.exports = { verifyCronSecret };
