require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { env, envBool } = require('./config/env');
const { GEMINI_KEY, GROQ_KEY } = require('./config/ai');
const { supabase } = require('./config/database');
const { verifyCronSecret } = require('./middleware/security');
const { runDueTasks } = require('./services/task.service');
const { ok, err } = require('./utils/helpers');
const logger = require('./utils/logger');

const app = express();

app.set('trust proxy', 1);
app.locals.supabase = supabase;

app.use(
    helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
    })
);

app.use(compression());
app.use(morgan(':method :url :status :response-time ms - :remote-addr'));

const configuredOrigins = [
    env('FRONTEND_URL'),
    ...env('FRONTEND_URLS')
        .split(',')
        .map((url) => url.trim().replace(/\/+$/, ''))
        .filter(Boolean),
    'http://localhost:3000',
].filter(Boolean);

app.use(
    cors({
        origin(origin, callback) {
            if (!origin) {
                return callback(null, true);
            }

            const normalizedOrigin = origin.trim().replace(/\/+$/, '');

            const allowed =
                configuredOrigins.includes(normalizedOrigin) ||
                (envBool('ALLOW_VERCEL_PREVIEWS') &&
                    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(
                        normalizedOrigin
                    ));

            if (allowed) {
                return callback(null, true);
            }

            logger.warn(`Blocked CORS origin: ${normalizedOrigin}`);
            return callback(new Error('Not allowed by CORS'));
        },
        methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'x-cron-secret',
        ],
        credentials: true,
        optionsSuccessStatus: 204,
    })
);

app.options('*', cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'Too many requests. Please wait a few minutes and try again.',
    },
});

const aiLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 150,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        error: 'AI usage limit reached. Please try again later.',
    },
});

app.use('/api/tool', aiLimiter);
app.use('/api/agent', aiLimiter);
app.use('/api', globalLimiter);

app.use('/', require('./routes/health'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tool', require('./routes/tools'));
app.use('/api/agent', require('./routes/agents'));
app.use('/api/tasks', require('./routes/tasks'));

/*
|--------------------------------------------------------------------------
| Subscription routes exist ONLY in subscriptions.js
|--------------------------------------------------------------------------
*/
app.use('/api', require('./routes/subscriptions'));

app.use('/api/client', require('./routes/client'));
app.use('/api', require('./routes/capture'));
app.use('/api', require('./routes/referrals'));

app.post(
    '/api/internal/run-automation',
    verifyCronSecret,
    async (req, res) => {
        try {
            logger.info('Cron triggered');

            const result = await runDueTasks(12);

            if (!result.success) {
                return err(res, result.error || 'Automation failed', 500);
            }

            return ok(res, {
                success: true,
                processed: result.processed,
                succeeded: result.succeeded,
            });
        } catch (error) {
            logger.error(
                'Automation error:',
                error?.message || error
            );

            return err(res, 'Automation failed', 500);
        }
    }
);

app.use((req, res) => {
    logger.warn(`Endpoint not found: ${req.method} ${req.originalUrl}`);

    return res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.originalUrl,
    });
});

app.use((error, req, res, next) => {
    logger.error(
        `Unhandled error on ${req.method} ${req.originalUrl}: ${
            error?.message || error
        }`
    );

    if (error?.message === 'Not allowed by CORS') {
        return res.status(403).json({
            success: false,
            error: 'Request blocked by CORS configuration.',
        });
    }

    return res.status(500).json({
        success: false,
        error: 'Internal server error',
    });
});

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
    logger.info(`PilotStaff API running on port ${PORT}`);
    logger.info(
        `Gemini: ${GEMINI_KEY ? 'enabled' : 'missing'} | Groq: ${
            GROQ_KEY ? 'enabled' : 'missing'
        }`
    );
    logger.info(
        `Allowed frontend origins: ${
            configuredOrigins.join(', ') || 'none configured'
        }`
    );
});

function shutdown(signal) {
    logger.info(`${signal} received - shutting down`);

    server.close(() => {
        process.exit(0);
    });

    setTimeout(() => {
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
