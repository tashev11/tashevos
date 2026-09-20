import { Hono } from 'hono';
import type { TaskRequest, TaskResponse } from '@devvit/web/server';
import { runBridge } from '../core/bridge';

export const schedulerRoutes = new Hono();

schedulerRoutes.post('/sync-github', async (c) => {
  try {
    await c.req.json<TaskRequest>();
    const result = await runBridge();
    console.log(
      `TashevOS scheduled sync: published=${result.published.length}, unchanged=${result.unchanged.length}, noRelease=${result.noRelease.length}, skipped=${result.skipped.length}, closedReplies=${result.closedReplies}`
    );
    return c.json<TaskResponse>({}, 200);
  } catch (error) {
    console.error('TashevOS scheduled GitHub/Reddit sync failed', error);
    return c.json<TaskResponse>({}, 500);
  }
});
