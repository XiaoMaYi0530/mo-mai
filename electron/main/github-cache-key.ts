/** Source is part of identity: never fall back to a different repository's data. */
export function githubCacheKey(repo: string, branch: string, path: string): string {
  return JSON.stringify(['github-v2', repo, branch, path])
}
