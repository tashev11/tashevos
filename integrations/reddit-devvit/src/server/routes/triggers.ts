import { Hono } from 'hono';
import type {
  OnAppInstallRequest,
  OnAppUpgradeRequest,
  OnCommentCreateRequest,
  TriggerResponse,
} from '@devvit/web/shared';
import { processRedditFeedback, runBridge } from '../core/bridge';

export const triggers = new Hono();

const lifecycleSync = async (
  type: 'install' | 'upgrade'
): Promise<TriggerResponse> => {
  const result = await runBridge();
  return {
    status: 'success',
    message:
      `TashevOS ${type}: published=${result.published.length}, unchanged=${result.unchanged.length}, ` +
      `noRelease=${result.noRelease.length}, skipped=${result.skipped.length}, closedReplies=${result.closedReplies}`,
  };
};

triggers.post('/on-app-install', async (c) => {
  try {
    await c.req.json<OnAppInstallRequest>();
    return c.json<TriggerResponse>(await lifecycleSync('install'), 200);
  } catch (error) {
    console.error('TashevOS install sync failed', error);
    return c.json<TriggerResponse>(
      { status: 'error', message: 'Initial GitHub/Reddit synchronization failed.' },
      500
    );
  }
});

triggers.post('/on-app-upgrade', async (c) => {
  try {
    await c.req.json<OnAppUpgradeRequest>();
    return c.json<TriggerResponse>(await lifecycleSync('upgrade'), 200);
  } catch (error) {
    console.error('TashevOS upgrade sync failed', error);
    return c.json<TriggerResponse>(
      { status: 'error', message: 'Upgrade GitHub/Reddit synchronization failed.' },
      500
    );
  }
});

triggers.post('/on-comment-create', async (c) => {
  try {
    const input = await c.req.json<OnCommentCreateRequest>();
    await processRedditFeedback(input);
    return c.json<TriggerResponse>({}, 200);
  } catch (error) {
    console.error('TashevOS Reddit feedback mirror failed', error);
    return c.json<TriggerResponse>({}, 500);
  }
});
