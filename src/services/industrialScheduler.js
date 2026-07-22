// src/services/industrialScheduler.js
import { Redis } from "@upstash/redis";
import schedule from "node-schedule";
import { removeMaintenanceSchedule } from "./operationsStore.js";
import { sendWhatsApp } from "./whatsapp.js";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL?.trim(),
  token: process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
});

const activeJobs = new Map();

/**
 * Start inspection/maintenance scheduler worker
 */
export async function startIndustrialScheduler() {
  console.log("⏳ Starting Node-Schedule industrial scheduler worker...");

  try {
    const allJobs = await redis.hgetall("whatsapp_active_schedules");
    if (allJobs) {
      console.log(`📋 Found ${Object.keys(allJobs).length} maintenance schedules in Upstash Redis. Rescheduling...`);
      for (const [jobId, jobDataStr] of Object.entries(allJobs)) {
        try {
          const jobData = typeof jobDataStr === "string" ? JSON.parse(jobDataStr) : jobDataStr;
          await scheduleJobInMemory(jobData);
        } catch (err) {
          console.error(`❌ Failed to reschedule maintenance job ${jobId}:`, err);
        }
      }
    }
    console.log("✅ Node-Schedule industrial scheduler is ready and initialized.");
  } catch (err) {
    console.error("❌ Failed to initialize schedules from Upstash Redis:", err);
  }
}

/**
 * Helper to schedule a job in memory using node-schedule
 */
async function scheduleJobInMemory(jobData) {
  const { to, text, sendAt, cron, jobId } = jobData;

  // If there's an existing job, cancel it first
  if (activeJobs.has(jobId)) {
    activeJobs.get(jobId).cancel();
  }

  if (sendAt) {
    const runDate = new Date(sendAt);
    if (runDate.getTime() <= Date.now()) {
      console.log(`⏱️ Job ${jobId} was scheduled in the past (${sendAt}). Running immediately.`);
      executeJob(jobData);
    } else {
      const job = schedule.scheduleJob(runDate, () => executeJob(jobData));
      if (job) {
        activeJobs.set(jobId, job);
      }
    }
  } else if (cron) {
    const job = schedule.scheduleJob(cron, () => executeJob(jobData));
    if (job) {
      activeJobs.set(jobId, job);
    }
  }
}

async function executeJob(jobData) {
  const { to, text, sendAt, jobId } = jobData;
  console.log(`⏰ [Node-Schedule] Maintenance alert fired for ${to}: "${text}"`);
  try {
    await sendWhatsApp({ to, text });
    if (sendAt) {
      await cancelMaintenanceSchedule(jobId);
      await removeMaintenanceSchedule(to, jobId);
    }
  } catch (err) {
    console.error(`❌ Failed to execute scheduled maintenance alert ${jobId}:`, err);
  }
}

/**
 * Schedule a one-off or repeatable maintenance job
 */
export async function scheduleAssetMaintenance({ to, text, sendAt, cron, meta }) {
  const jobId = `${to}-${Date.now()}`;
  const jobData = { to, text, sendAt, cron, meta, jobId };

  try {
    // Save to Upstash Redis for persistence
    await redis.hset("whatsapp_active_schedules", { [jobId]: JSON.stringify(jobData) });

    // Schedule in memory
    await scheduleJobInMemory(jobData);

    if (sendAt) {
      return { jobId, type: "once", sendAt };
    }
    if (cron) {
      return { jobId, type: "cron", cron };
    }
  } catch (err) {
    console.error("❌ Failed to schedule maintenance alert:", err);
    throw err;
  }

  throw new Error("Must provide sendAt or cron");
}

/**
 * Cancel a maintenance job
 */
export async function cancelMaintenanceSchedule(jobId) {
  try {
    let canceled = false;

    // Remove from node-schedule in memory
    const job = activeJobs.get(jobId);
    if (job) {
      job.cancel();
      activeJobs.delete(jobId);
      canceled = true;
    }

    // Remove from Upstash Redis
    const deletedCount = await redis.hdel("whatsapp_active_schedules", jobId);
    if (deletedCount > 0) {
      canceled = true;
    }

    // Also support repeatable jobs check
    const allJobs = await redis.hgetall("whatsapp_active_schedules");
    if (allJobs) {
      for (const [existingJobId, jobDataStr] of Object.entries(allJobs)) {
        if (existingJobId === jobId || existingJobId.includes(jobId)) {
          const inMemJob = activeJobs.get(existingJobId);
          if (inMemJob) {
            inMemJob.cancel();
            activeJobs.delete(existingJobId);
          }
          await redis.hdel("whatsapp_active_schedules", existingJobId);
          canceled = true;
          console.log(`🗑️ Removed repeatable cron rule ${existingJobId}`);
        }
      }
    }

    return canceled;
  } catch (err) {
    console.error(`❌ Failed to cancel maintenance schedule ${jobId}:`, err);
    return false;
  }
}
