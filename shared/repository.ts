/** Read-only composer validation; invalid paths never create a plan or worktree. */
export interface RepositoryValidation {
  valid: boolean;
  repoPath: string | null;
  branch: string | null;
  message: string;
}
