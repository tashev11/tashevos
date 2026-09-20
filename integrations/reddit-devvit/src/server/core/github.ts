import { settings } from '@devvit/web/server';

export type GitHubRelease = {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
};

export type GitHubIssue = {
  number: number;
  html_url: string;
  state: 'open' | 'closed';
};

const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const defaultRepos = [
  'tashev11/tashevos',
  'tashev11/tashev-relay',
  'tashev11/tashev-proof',
  'tashev11/tashev-crew',
];

const normalizeRepo = (value: string): string => {
  const repo = value.trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  if (!repoPattern.test(repo)) throw new Error(`Invalid GitHub repository: ${value}`);
  return repo;
};

export const getGitHubRepositories = async (): Promise<string[]> => {
  const configured = (await settings.get<string>('githubRepos'))?.trim();
  const legacy = (await settings.get<string>('githubRepo'))?.trim();
  const source = configured || legacy || defaultRepos.join('\n');
  const repos = source
    .split(/[\n,;]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normalizeRepo);
  return [...new Set(repos)];
};

const request = async <T>(
  path: string,
  init: RequestInit = {},
  requireToken = false
): Promise<T> => {
  const token = (await settings.get<string>('githubToken'))?.trim();
  if (requireToken && !token) {
    throw new Error('GitHub token is not configured in Devvit app settings.');
  }

  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('X-GitHub-Api-Version', '2022-11-28');
  headers.set('User-Agent', 'TashevOS-Reddit-Bridge');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`https://api.github.com${path}`, { ...init, headers });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`GitHub returned a non-JSON response (${response.status}).`);
  }

  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && 'message' in payload
        ? String(payload.message)
        : undefined;
    throw new Error(`GitHub API ${response.status}: ${detail ?? 'request failed'}`);
  }
  return payload;
};

export const getLatestRelease = async (repository: string): Promise<GitHubRelease | null> => {
  const repo = normalizeRepo(repository);
  try {
    return await request<GitHubRelease>(`/repos/${repo}/releases/latest`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('GitHub API 404')) return null;
    throw error;
  }
};

export const createFeedbackIssue = async (input: {
  repository: string;
  kind: 'bug' | 'feature';
  title: string;
  body: string;
}): Promise<GitHubIssue> => {
  const repo = normalizeRepo(input.repository);
  return request<GitHubIssue>(
    `/repos/${repo}/issues`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
      }),
    },
    true
  );
};

export const getIssue = async (
  repository: string,
  issueNumber: number
): Promise<GitHubIssue> => {
  const repo = normalizeRepo(repository);
  return request<GitHubIssue>(`/repos/${repo}/issues/${issueNumber}`, {}, true);
};
