require('dotenv').config();

// ─── Startup Validation — fail fast if critical vars missing in production ───

const { validateEnv } = require('./config/validate');
validateEnv();

// ─── App ───

const express = require('express');
const compression = require('compression');

const { env, envBool } = require('./config/env');
const { GEMINI_KEY, GROQ_KEY } = require('./config/ai');
const { supabase } = require('./config/database');
const {
    requestId,
    securityHeaders,
    cors,
    rateLimit,
    requestLogger,
    verifyCronSecret,
} = require('./middleware/security');
const { runDueTasks } = require('./services/task.service');
const { ok, err } = require('./utils/helpers');
const logger = require('./utils/logger');

const app = express();

app.set('trust proxy', 1);
app.locals.supabase = supabase;

// ─── Core Middleware ───
app.use(requestId);
app.use(securityHeaders);
app.use(cors);
app.use(compression());
app.use(requestLogger);

// ─── Body Parser ───
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Rate Limiters ───
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: 'Too many requests. Please wait a few minutes and try again.',
});

const aiLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 150,
    message: 'AI usage limit reached. Please try again later.',
});

app.use('/api/tool', aiLimiter);
app.use('/api/agent', aiLimiter);
app.use('/api', globalLimiter);

// ─── Routes ───
app.use('/', require('./routes/health'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tool', require('./routes/tools'));
app.use('/api/agent', require('./routes/agents'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api', require('./routes/subscriptions'));
app.use('/api/client', require('./routes/client'));
app.use('/api', require('./routes/capture'));
app.use('/api', require('./routes/referrals'));

// ─── Cron ───
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
            logger.error('Automation error:', error?.message || error);
            return err(res, 'Automation failed', 500);
        }
    }
);

// ─── 404 Handler ───
app.use((req, res) => {
    logger.warn(`[${req.requestId || '-'}] Endpoint not found: ${req.method} ${req.originalUrl}`);
    return res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.originalUrl,
    });
});

// ─── Error Handler — with Error ID + Request ID ───
app.use((error, req, res, _next) => {
    const rid = req.requestId || '-';
    const eid = logger.errorId();

    logger.error(`[${rid}][ERR:${eid}] Unhandled error on ${req.method} ${req.originalUrl}: ${error?.message || error}`);

    return res.status(500).json({
        success: false,
        error: 'Internal server error',
        error_id: eid,
    });
});

// ─── Server ───
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
    logger.info(`PilotStaff API running on port ${PORT}`);
    logger.info(`Gemini: ${GEMINI_KEY ? 'enabled' : 'missing'} | Groq: ${GROQ_KEY ? 'enabled' : 'missing'}`);
});

function shutdown(signal) {
    logger.info(`${signal} received - shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
