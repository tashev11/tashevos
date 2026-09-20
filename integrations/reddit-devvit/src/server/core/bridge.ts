import { context, reddit, redis, settings } from '@devvit/web/server';
import type { OnCommentCreateRequest } from '@devvit/web/shared';
import { T1 } from '@devvit/shared-types/tid.js';
import {
  createFeedbackIssue,
  getGitHubRepositories,
  getIssue,
  getLatestRelease,
  type GitHubRelease,
} from './github';

const POSTS_KEY = 'bridge:posts';
const COMMENTS_KEY = 'bridge:processed-comments';
const ISSUES_KEY = 'bridge:issue-mappings';
const LAST_RELEASES_KEY = 'bridge:last-releases';
const LAST_SKIPPED_KEY = 'bridge:last-skipped-releases';

type FeedbackKind = 'bug' | 'feature' | 'other';

type StoredPost = {
  repository: string;
  releaseId: number;
  tag: string;
  postId: string;
  permalink: string;
};

type IssueMapping = {
  repository: string;
  issueNumber: number;
  issueUrl: string;
  commentId: string;
  commentUrl: string;
  notifiedClosed: boolean;
};

export type BridgeRun = {
  published: string[];
  unchanged: string[];
  skipped: string[];
  noRelease: string[];
  closedReplies: number;
};

const clean = (value: string, max: number): string => {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
};

const classify = (body: string): FeedbackKind => {
  const text = body.toLowerCase();
  if (/\b(bug|broken|crash(?:es|ed)?|error|exception|fail(?:s|ed|ing)?|regression|not working|doesn['’]?t work|ошибк|не работает|падает)\b/i.test(text)) {
    return 'bug';
  }
  if (/\b(feature|feature request|enhancement|please add|could you add|would be nice|support for|wish|request|добавьте|добавить|функци)\b/i.test(text)) {
    return 'feature';
  }
  return 'other';
};

const ruleBlock = (rules: Awaited<ReturnType<typeof reddit.getRules>>): string | undefined => {
  const text = rules
    .map((rule) => `${rule.shortName}\n${rule.description}\n${rule.violationReason}`)
    .join('\n')
    .toLowerCase();

  const checks: Array<[RegExp, string]> = [
    [/\bno\s+(?:self[- ]?promotion|promotion|advertis(?:ing|ements?))\b/i, 'promotion is prohibited'],
    [/\b(?:self[- ]?promotion|promotion|advertis(?:ing|ements?))\b.{0,80}\b(?:not allowed|prohibited|forbidden|banned)\b/i, 'promotion is prohibited'],
    [/\b(?:self[- ]?promotion|promotion)\b.{0,120}\b(?:only|megathread|weekly|monthly|saturdays?|sundays?|mod approval|moderator approval)\b/i, 'promotion is conditional'],
    [/\b(?:ask|message|contact)\s+(?:the\s+)?mods?\b/i, 'moderator review is required'],
    [/\bno\s+(?:bots?|automated posts?|automation)\b/i, 'bots or automated posts are prohibited'],
  ];
  return checks.find(([pattern]) => pattern.test(text))?.[1];
};

const renderRelease = (
  repository: string,
  release: GitHubRelease
): { title: string; body: string } => {
  const tag = clean(release.tag_name, 60);
  const name = clean(release.name ?? '', 120);
  const title = clean(
    name && name.toLowerCase() !== tag.toLowerCase()
      ? `${repository}: ${name} (${tag})`
      : `${repository}: ${tag} released`,
    290
  );
  const notes = (release.body ?? '')
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/^#+\s*/gm, '')
    .trim()
    .slice(0, 7000) || 'A new release is available.';

  return {
    title,
    body: [
      notes,
      '',
      `Release: ${release.html_url}`,
      `Source: https://github.com/${repository}`,
      '',
      '_Posted automatically by the TashevOS app account. Actionable bug reports and feature requests in replies may be mirrored to the matching GitHub repository._',
    ].join('\n'),
  };
};

const publishLatestReleases = async (): Promise<Omit<BridgeRun, 'closedReplies'>> => {
  const autoPublish = (await settings.get<boolean>('autoPublish')) ?? true;
  const subredditEnabled = (await settings.get<boolean>('subredditEnabled')) ?? true;
  const result = {
    published: [] as string[],
    unchanged: [] as string[],
    skipped: [] as string[],
    noRelease: [] as string[],
  };
  if (!autoPublish || !subredditEnabled) return result;

  const subredditName = context.subredditName;
  if (!subredditName) throw new Error('Devvit subreddit context is unavailable.');

  const repositories = await getGitHubRepositories();
  const blocked = ruleBlock(await reddit.getRules(subredditName));

  for (const repository of repositories) {
    const release = await getLatestRelease(repository);
    if (!release || release.draft) {
      result.noRelease.push(repository);
      continue;
    }

    const id = String(release.id);
    if ((await redis.hGet(LAST_RELEASES_KEY, repository)) === id) {
      result.unchanged.push(repository);
      continue;
    }
    if ((await redis.hGet(LAST_SKIPPED_KEY, repository)) === id) {
      result.skipped.push(repository);
      continue;
    }
    if (blocked) {
      await redis.hSet(LAST_SKIPPED_KEY, { [repository]: id });
      result.skipped.push(`${repository}: ${blocked}`);
      continue;
    }

    const rendered = renderRelease(repository, release);
    const post = await reddit.submitPost({
      subredditName,
      title: rendered.title,
      text: rendered.body,
      runAs: 'APP',
      sendreplies: true,
    });

    const stored: StoredPost = {
      repository,
      releaseId: release.id,
      tag: release.tag_name,
      postId: post.id,
      permalink: post.permalink,
    };
    await redis.hSet(POSTS_KEY, { [post.id]: JSON.stringify(stored) });
    await redis.hSet(LAST_RELEASES_KEY, { [repository]: id });
    await redis.hDel(LAST_SKIPPED_KEY, [repository]);
    result.published.push(`${repository}: https://www.reddit.com${post.permalink}`);
  }

  return result;
};

const issueTitle = (kind: Exclude<FeedbackKind, 'other'>, body: string): string => {
  const prefix = kind === 'bug' ? 'Bug' : 'Feature';
  return clean(`[Reddit] ${prefix}: ${clean(body, 120) || 'feedback'}`, 250);
};

export const processRedditFeedback = async (
  input: OnCommentCreateRequest
): Promise<'ignored' | 'mirrored'> => {
  const comment = input.comment;
  if (!comment?.id || !comment.postId || !comment.body) return 'ignored';

  const rawPost = await redis.hGet(POSTS_KEY, comment.postId);
  if (!rawPost) return 'ignored';

  let storedPost: StoredPost;
  try {
    storedPost = JSON.parse(rawPost);
  } catch {
    return 'ignored';
  }

  const appUser = await reddit.getAppUser();
  if (appUser && input.author?.name.toLowerCase() === appUser.username.toLowerCase()) {
    return 'ignored';
  }

  const kind = classify(comment.body);
  if (kind === 'other') return 'ignored';
  if ((await redis.hSetNX(COMMENTS_KEY, comment.id, 'processing')) === 0) return 'ignored';

  try {
    const commentUrl = comment.permalink.startsWith('http')
      ? comment.permalink
      : `https://www.reddit.com${comment.permalink}`;
    const issue = await createFeedbackIssue({
      repository: storedPost.repository,
      kind,
      title: issueTitle(kind, comment.body),
      body: [
        'Imported automatically from Reddit by TashevOS.',
        '',
        `**Type:** ${kind}`,
        `**Repository:** ${storedPost.repository}`,
        `**Subreddit:** r/${context.subredditName ?? 'unknown'}`,
        `**Reddit post:** https://www.reddit.com${storedPost.permalink}`,
        `**Reddit comment:** ${commentUrl}`,
        `**Author:** u/${clean(input.author?.name ?? comment.author, 80)}`,
        '',
        '### Feedback',
        '',
        comment.body.trim(),
        '',
        `<!-- tashevos-reddit:${comment.id} -->`,
      ].join('\n'),
    });

    const mapping: IssueMapping = {
      repository: storedPost.repository,
      issueNumber: issue.number,
      issueUrl: issue.html_url,
      commentId: comment.id,
      commentUrl,
      notifiedClosed: false,
    };
    await redis.hSet(ISSUES_KEY, { [comment.id]: JSON.stringify(mapping) });
    await redis.hSet(COMMENTS_KEY, { [comment.id]: `issue:${issue.number}` });
    return 'mirrored';
  } catch (error) {
    await redis.hDel(COMMENTS_KEY, [comment.id]);
    throw error;
  }
};

const syncClosedIssues = async (): Promise<number> => {
  const mappings = await redis.hGetAll(ISSUES_KEY);
  let replied = 0;

  for (const [field, raw] of Object.entries(mappings)) {
    let mapping: IssueMapping;
    try {
      mapping = JSON.parse(raw);
    } catch {
      continue;
    }
    if (mapping.notifiedClosed) continue;

    const issue = await getIssue(mapping.repository, mapping.issueNumber);
    if (issue.state !== 'closed') continue;

    const comment = await reddit.getCommentById(T1(mapping.commentId));
    await comment.reply({
      text: `GitHub issue #${mapping.issueNumber} in ${mapping.repository} has been closed: ${mapping.issueUrl}`,
      runAs: 'APP',
    });

    mapping.notifiedClosed = true;
    await redis.hSet(ISSUES_KEY, { [field]: JSON.stringify(mapping) });
    replied += 1;
  }

  return replied;
};

export const runBridge = async (): Promise<BridgeRun> => {
  const releases = await publishLatestReleases();
  let closedReplies = 0;
  const token = (await settings.get<string>('githubToken'))?.trim();
  if (token) closedReplies = await syncClosedIssues();
  return { ...releases, closedReplies };
};
