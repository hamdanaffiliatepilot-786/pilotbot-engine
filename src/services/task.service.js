// src/services/task.service.js
const { supabase } = require('../config/database');
const { askAI } = require('./ai.service');
const { sanitizeText, sanitizeHTML } = require('../utils/sanitize');
const { toIso, computeNextRun, parallelWithLimit } = require('../utils/helpers');
const { getAgentSystemPrompt } = require('../prompts/agents');
const { TABLES } = require('../config/constants');
const logger = require('../utils/logger');

const DEFAULT_SETUP = {
  business_name: 'Unknown',
  business_type: 'General',
  website_url: 'N/A',
  target_audience: 'General audience',
  goals: 'Grow business',
  brand_tone: 'Professional',
  services: 'N/A',
  offers: 'N/A',
  channels: 'N/A',
  faq: 'N/A',
};

async function addTaskLog(taskId, email, status, message, output = '') {
  if (!supabase || !taskId) return;
  try {
    await supabase.from(TABLES.TASK_LOGS).insert({
      task_id: taskId,
      email: sanitizeText(email, 200),
      status,
      message: sanitizeText(message || '', 1000),
      output: typeof output === 'string' ? output.substring(0, 12000) : '',
    });
  } catch (e) {
    logger.warn('Task log insert failed:', e.message?.substring(0, 100));
  }
}

async function saveOutput(task, output) {
  if (!supabase) return;
  try {
    await supabase.from(TABLES.GENERATED_OUTPUTS).insert({
      email: sanitizeText(task.email, 200),
      task_id: task.id,
      agent_id: sanitizeText(task.agent_id, 100),
      title: sanitizeText(task.title, 200),
      output: sanitizeHTML(output, 50000),
      format: 'markdown',
    });
  } catch (e) {
    logger.warn('Save output failed:', e.message?.substring(0, 100));
  }
}

async function executeAutomationTask(task) {
  if (!supabase) return { success: false, error: 'Database not configured' };

  const timerDB = logger.startTimer('db:task:fetch-setup');
  const { data: setup } = await supabase
    .from(TABLES.CLIENT_PROFILES)
    .select('business_name, business_type, website_url, target_audience, goals, brand_tone, services, offers, channels, faq')
    .eq('email', task.email)
    .maybeSingle();
  logger.endTimer(timerDB);

  const safeSetup = setup || DEFAULT_SETUP;
  const safePrompt = sanitizeText(task.prompt || '', 8000);
  const systemPrompt = getAgentSystemPrompt(task.agent_id, safeSetup, { prompt: safePrompt });

  await addTaskLog(task.id, task.email, 'running', `Task started for ${task.agent_id}`);

  const timerAI = logger.startTimer('ai:automation-task');
  const result = await askAI(systemPrompt);
  const aiMs = logger.endTimer(timerAI);

  if (!result) {
    await supabase.from(TABLES.AUTOMATION_TASKS).update({
      status: 'failed',
      error_message: 'AI generation failed',
      updated_at: toIso(new Date()),
    }).eq('id', task.id);
    await addTaskLog(task.id, task.email, 'failed', `AI generation failed (${aiMs}ms)`);
    return { success: false, error: 'AI generation failed' };
  }

  const nextRun = computeNextRun(task.schedule_type, new Date());
  await supabase.from(TABLES.AUTOMATION_TASKS).update({
    status: task.schedule_type === 'manual' ? 'completed' : 'scheduled',
    output_preview: result.substring(0, 400),
    error_message: null,
    approved: task.requires_approval ? false : (task.approved ?? true),
    last_run_at: toIso(new Date()),
    next_run_at: nextRun,
    updated_at: toIso(new Date()),
  }).eq('id', task.id);

  await saveOutput(task, result);
  await addTaskLog(task.id, task.email, 'completed', `Task completed (${aiMs}ms)`, result);

  return { success: true, output: result };
}

async function runDueTasks(limit = 10) {
  if (!supabase) return { success: false, error: 'Database not configured', processed: 0 };

  const nowIso = toIso(new Date());
  const timer = logger.startTimer('db:task:fetch-due');

  const { data: tasks, error: tasksError } = await supabase
    .from(TABLES.AUTOMATION_TASKS)
    .select('id, email, agent_id, title, prompt, schedule_type, requires_approval, approved')
    .in('status', ['scheduled', 'pending'])
    .lte('next_run_at', nowIso)
    .eq('approved', true)
    .order('next_run_at', { ascending: true })
    .limit(limit);

  logger.endTimer(timer);

  if (tasksError) {
    logger.error('Fetch due tasks failed:', tasksError.message);
    return { success: false, error: tasksError.message, processed: 0 };
  }

  if (!tasks || tasks.length === 0) {
    logger.info('No due tasks found');
    return { success: true, processed: 0 };
  }

  logger.info(`Processing ${tasks.length} due tasks`);

  const results = await parallelWithLimit(tasks, 3, async (task) => {
    const result = await executeAutomationTask(task);
    return { taskId: task.id, ...result };
  });

  const succeeded = results.filter(r => r.success).length;
  logger.info(`Tasks completed: ${succeeded}/${tasks.length}`);

  return { success: true, processed: tasks.length, succeeded };
}

// ← FIX: Added runTaskNow export (routes/tasks.js /:id/run mein use hota hai)
async function runTaskNow(task) {
  return executeAutomationTask(task);
}

module.exports = { executeAutomationTask, runDueTasks, runTaskNow };
