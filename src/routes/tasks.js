const express = require("express");
const router = express.Router();

const { supabase } = require("../config/database");
const { authenticate } = require("../middleware/auth");
const { ok, err, parsePagination, paginatedResponse, getErrorMessage } = require("../utils/helpers");
const { TABLES, CACHE_TTL } = require("../config/constants");
const { runTaskNow } = require("../services/task.service");
const cache = require("../utils/cache");
const logger = require("../utils/logger");

router.use(authenticate);

function getUserEmail(req) {
  return String(req.user?.email || "").trim().toLowerCase();
}

// FIXED: Added pagination + select specific columns
router.get("/", async (req, res) => {
  try {
    const email = getUserEmail(req);
    if (!email) return err(res, "Unauthorized", 401);

    const { page, limit, from, to } = parsePagination(req.query);
    const status = req.query.status;

    let query = supabase
      .from(TABLES.TASKS)
      .select('id, title, agent_id, prompt, schedule_type, status, requires_approval, approved, created_at, updated_at', { count: 'exact' })
      .eq("email", email)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;

    if (error) {
      logger.error('Tasks fetch error:', error.message);
      return err(res, error.message, 400);
    }

    return ok(res, paginatedResponse(data || [], page, limit, count || 0));
  } catch (error) {
    logger.reportError(error, { endpoint: 'GET /tasks' });
    return err(res, getErrorMessage(error, "Failed to load tasks"), 500);
  }
});

router.post("/", async (req, res) => {
  try {
    const email = getUserEmail(req);
    if (!email) return err(res, "Unauthorized", 401);

    const {
      title,
      agentId,
      prompt,
      scheduleType = "manual",
      requiresApproval = false,
    } = req.body || {};

    if (!title?.trim() || !agentId?.trim() || !prompt?.trim()) {
      return err(res, "Title, agent and prompt are required", 400);
    }

    const { data, error } = await supabase
      .from(TABLES.TASKS)
      .insert([
        {
          email,
          title: title.trim(),
          agent_id: agentId.trim(),
          prompt: prompt.trim(),
          schedule_type: scheduleType,
          requires_approval: Boolean(requiresApproval),
          approved: !Boolean(requiresApproval),
          status: "active",
        },
      ])
      .select('id, title, agent_id, schedule_type, status, requires_approval, approved, created_at')
      .single();

    if (error) {
      logger.error('Task create error:', error.message);
      return err(res, error.message, 400);
    }

    // Clear task list cache
    cache.delete(`tasks:${email}`);

    return ok(res, { task: data });
  } catch (error) {
    logger.reportError(error, { endpoint: 'POST /tasks' });
    return err(res, getErrorMessage(error, "Failed to create task"), 500);
  }
});

router.post("/:id/approve", async (req, res) => {
  try {
    const email = getUserEmail(req);
    const taskId = req.params.id;
    const approved = Boolean(req.body?.approved);

    const { data, error } = await supabase
      .from(TABLES.TASKS)
      .update({
        approved,
        status: approved ? "active" : "paused",
        updated_at: new Date().toISOString(),
      })
      .eq("id", taskId)
      .eq("email", email)
      .select('id, title, agent_id, status, approved, updated_at')
      .single();

    if (error || !data) {
      return err(res, error?.message || "Task not found", 404);
    }

    cache.delete(`tasks:${email}`);

    return ok(res, { task: data });
  } catch (error) {
    logger.reportError(error, { endpoint: 'POST /tasks/:id/approve' });
    return err(res, getErrorMessage(error, "Failed to update task"), 500);
  }
});

router.post("/:id/run", async (req, res) => {
  try {
    const email = getUserEmail(req);
    const taskId = req.params.id;

    const { data: task, error: taskError } = await supabase
      .from(TABLES.TASKS)
      .select('id, email, agent_id, title, prompt, schedule_type, requires_approval, approved')
      .eq("id", taskId)
      .eq("email", email)
      .maybeSingle();

    if (taskError || !task) {
      return err(res, taskError?.message || "Task not found", 404);
    }

    if (task.requires_approval && !task.approved) {
      return err(res, "This task needs approval before running", 400);
    }

    const timer = logger.startTimer('ai:task-run');
    const result = await runTaskNow(task);
    logger.endTimer(timer);

    return ok(res, { task, result });
  } catch (error) {
    logger.reportError(error, { endpoint: 'POST /tasks/:id/run' });
    return err(res, getErrorMessage(error, "Task failed"), 500);
  }
});

// FIXED: Added pagination + select specific columns
router.get("/outputs", async (req, res) => {
  try {
    const email = getUserEmail(req);
    if (!email) return err(res, "Unauthorized", 401);

    const { page, limit, from, to } = parsePagination(req.query);

    const { data, error, count } = await supabase
      .from(TABLES.TASK_OUTPUTS)
      .select('id, task_id, agent_id, title, created_at', { count: 'exact' })
      .eq("email", email)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      logger.error('Outputs fetch error:', error.message);
      return err(res, error.message, 400);
    }

    return ok(res, paginatedResponse(data || [], page, limit, count || 0));
  } catch (error) {
    logger.reportError(error, { endpoint: 'GET /tasks/outputs' });
    return err(res, getErrorMessage(error, "Failed to load outputs"), 500);
  }
});

module.exports = router;
