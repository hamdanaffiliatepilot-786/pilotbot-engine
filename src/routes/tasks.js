const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { requireDB } = require('../config/database');
const { executeAutomationTask } = require('../services/task.service');
const { sanitizeText } = require('../utils/sanitize');
const { validate } = require('../middleware/validator');
const { toIso, computeNextRun, ok, err } = require('../utils/helpers');
const logger = require('../utils/logger');

const router = Router();

// Sab task routes mein auth zaroori hai
router.use(authenticate);

const ALLOWED_SCHEDULES = ['manual', 'daily', 'weekly'];

// ─── Get all tasks ───
router.get('/', async (req, res) => {
    if (!requireDB(res)) return;

    try {
        const { data, error } = await req.app.locals.supabase
            .from('automation_tasks')
            .select('*')
            .eq('email', req.user.email)
            .order('created_at', { ascending: false });

        if (error) {
            logger.error('Tasks fetch error:', error.message);
            return err(res, 'Failed to fetch tasks', 500);
        }

        ok(res, { success: true, tasks: data || [] });
    } catch (e) {
        logger.error('Tasks fetch exception:', e.message);
        err(res, 'Failed to fetch tasks', 500);
    }
});

// ─── Create task ───
router.post('/', async (req, res) => {
    if (!requireDB(res)) return;

    const payload = {
        email: req.user.email,
        title: req.body.title,
        agentId: req.body.agentId,
        prompt: req.body.prompt,
        scheduleType: req.body.scheduleType || 'manual',
        requiresApproval: !!req.body.requiresApproval
    };

    const validationErrors = validate(payload, {
        title: { required: true, type: 'string', max: 200 },
        agentId: { required: true, type: 'string', max: 100 },
        prompt: { required: true, type: 'string', max: 8000 },
        scheduleType: { required: true, type: 'string', enum: ALLOWED_SCHEDULES }
    });

    if (validationErrors.length > 0) {
        return err(res, `Validation: ${validationErrors[0].message}`, 400);
    }

    const now = new Date();
    const insertPayload = {
        email: req.user.email,
        title: sanitizeText(payload.title, 200),
        agent_id: sanitizeText(payload.agentId, 100),
        prompt: sanitizeText(payload.prompt, 8000),
        schedule_type: payload.scheduleType,
        requires_approval: payload.requiresApproval,
        approved: !payload.requiresApproval,
        status: payload.scheduleType === 'manual' ? 'pending' : 'scheduled',
        next_run_at: payload.scheduleType === 'manual' ? toIso(now) : computeNextRun(payload.scheduleType, now),
        created_at: toIso(now),
        updated_at: toIso(now)
    };

    try {
        const { data, error } = await req.app.locals.supabase
            .from('automation_tasks')
            .insert(insertPayload)
            .select('*')
            .single();

        if (error) {
            logger.error('Task create error:', error.message);
            return err(res, 'Failed to create task', 500);
        }

        logger.info('Task created:', data.id, 'for:', req.user.email);
        ok(res, { success: true, task: data });
    } catch (e) {
        logger.error('Task create exception:', e.message);
        err(res, 'Failed to create task', 500);
    }
});

// ─── Approve/unapprove task ───
router.post('/:id/approve', async (req, res) => {
    if (!requireDB(res)) return;

    const taskId = sanitizeText(req.params.id, 100);
    const approved = req.body.approved !== false;

    if (!taskId) return err(res, 'Task ID required', 400);

    try {
        const { data: task, error: fetchError } = await req.app.locals.supabase
            .from('automation_tasks')
            .select('*')
            .eq('id', taskId)
            .eq('email', req.user.email)
            .single();

        if (fetchError || !task) return err(res, 'Task not found', 404);

        const { error } = await req.app.locals.supabase.from('automation_tasks').update({
            approved,
            status: approved && task.schedule_type !== 'manual' ? 'scheduled' : task.status,
            updated_at: toIso(new Date())
        }).eq('id', taskId);

        if (error) {
            logger.error('Task approve error:', error.message);
            return err(res, 'Failed to update task', 500);
        }

        ok(res, { success: true, message: approved ? 'Task approved' : 'Task paused' });
    } catch (e) {
        logger.error('Task approve exception:', e.message);
        err(res, 'Failed to update task', 500);
    }
});

// ─── Run task manually ───
router.post('/:id/run', async (req, res) => {
    if (!requireDB(res)) return;

    const taskId = sanitizeText(req.params.id, 100);
    if (!taskId) return err(res, 'Task ID required', 400);

    try {
        const { data: task, error: fetchError } = await req.app.locals.supabase
            .from('automation_tasks')
            .select('*')
            .eq('id', taskId)
            .eq('email', req.user.email)
            .single();

        if (fetchError || !task) return err(res, 'Task not found', 404);

        logger.info('Manual task run:', taskId, 'by:', req.user.email);
        const result = await executeAutomationTask({ ...task, approved: true });

        if (!result.success) return err(res, result.error || 'Task run failed', 500);
        ok(res, { success: true, output: result.output });
    } catch (e) {
        logger.error('Task run exception:', e.message);
        err(res, 'Task run failed', 500);
    }
});

// ─── Get generated outputs ───
router.get('/outputs', async (req, res) => {
    if (!requireDB(res)) return;

    try {
        const { data, error } = await req.app.locals.supabase
            .from('generated_outputs')
            .select('*')
            .eq('email', req.user.email)
            .order('created_at', { ascending: false })
            .limit(30);

        if (error) {
            logger.error('Outputs fetch error:', error.message);
            return err(res, 'Failed to fetch outputs', 500);
        }

        ok(res, { success: true, outputs: data || [] });
    } catch (e) {
        logger.error('Outputs fetch exception:', e.message);
        err(res, 'Failed to fetch outputs', 500);
    }
});

module.exports = router;
