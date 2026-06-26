const express = require("express");
const router = express.Router();

const { supabase } = require("../config/database");
const { authenticate } = require("../middleware/auth");
const { ok, err } = require("../utils/helpers");
const { runTaskNow } = require("../services/task.service");

router.use(authenticate);

function getUserEmail(req) {
  return String(req.user?.email || "").trim().toLowerCase();
}

router.get("/", async (req, res) => {
  try {
    const email = getUserEmail(req);

    if (!email) {
      return err(res, "Unauthorized", 401);
    }

    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("email", email)
      .order("created_at", { ascending: false });

    if (error) {
      return err(res, error.message, 400);
    }

    return ok(res, { tasks: data || [] });
  } catch (error) {
    return err(res, error.message || "Failed to load tasks", 500);
  }
});

router.post("/", async (req, res) => {
  try {
    const email = getUserEmail(req);

    const {
      title,
      agentId,
      prompt,
      scheduleType = "manual",
      requiresApproval = false
    } = req.body || {};

    if (!email) {
      return err(res, "Unauthorized", 401);
    }

    if (!title?.trim() || !agentId?.trim() || !prompt?.trim()) {
      return err(res, "Title, agent and prompt are required", 400);
    }

    const { data, error } = await supabase
      .from("tasks")
      .insert([
        {
          email,
          title: title.trim(),
          agent_id: agentId.trim(),
          prompt: prompt.trim(),
          schedule_type: scheduleType,
          requires_approval: Boolean(requiresApproval),
          approved: !Boolean(requiresApproval),
          status: "active"
        }
      ])
      .select()
      .single();

    if (error) {
      return err(res, error.message, 400);
    }

    return ok(res, { task: data });
  } catch (error) {
    return err(res, error.message || "Failed to create task", 500);
  }
});

router.post("/:id/approve", async (req, res) => {
  try {
    const email = getUserEmail(req);
    const taskId = req.params.id;
    const approved = Boolean(req.body?.approved);

    const { data, error } = await supabase
      .from("tasks")
      .update({
        approved,
        status: approved ? "active" : "paused",
        updated_at: new Date().toISOString()
      })
      .eq("id", taskId)
      .eq("email", email)
      .select()
      .single();

    if (error || !data) {
      return err(res, error?.message || "Task not found", 404);
    }

    return ok(res, { task: data });
  } catch (error) {
    return err(res, error.message || "Failed to update task", 500);
  }
});

router.post("/:id/run", async (req, res) => {
  try {
    const email = getUserEmail(req);
    const taskId = req.params.id;

    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .eq("email", email)
      .single();

    if (taskError || !task) {
      return err(res, taskError?.message || "Task not found", 404);
    }

    if (task.requires_approval && !task.approved) {
      return err(res, "This task needs approval before running", 400);
    }

    const result = await runTaskNow(task);

    return ok(res, {
      task,
      result
    });
  } catch (error) {
    return err(res, error.message || "Task failed", 500);
  }
});

router.get("/outputs", async (req, res) => {
  try {
    const email = getUserEmail(req);

    const { data, error } = await supabase
      .from("task_outputs")
      .select("*")
      .eq("email", email)
      .order("created_at", { ascending: false });

    if (error) {
      return err(res, error.message, 400);
    }

    return ok(res, { outputs: data || [] });
  } catch (error) {
    return err(res, error.message || "Failed to load outputs", 500);
  }
});

module.exports = router;
