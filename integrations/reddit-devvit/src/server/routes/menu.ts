import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { runBridge } from '../core/bridge';

export const menu = new Hono();

menu.post('/sync-now', async (c) => {
  try {
    const result = await runBridge();
    return c.json<UiResponse>(
      {
        showToast:
          `TashevOS: published ${result.published.length}, unchanged ${result.unchanged.length}, ` +
          `no release ${result.noRelease.length}, skipped ${result.skipped.length}`,
      },
      200
    );
  } catch (error) {
    console.error('Manual TashevOS sync failed', error);
    return c.json<UiResponse>({ showToast: 'TashevOS sync failed. Check app logs.' }, 500);
  }
});
