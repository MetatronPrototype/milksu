const invalidGitBranchChars = /[ \t\n\r\\~^:?*[]/

export function filterGitBranches(branches: readonly string[], query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return branches.slice()
  return branches.filter(branch => branch.toLocaleLowerCase().includes(normalized))
}

export function isValidGitBranchName(value: string) {
  const name = value.trim()
  if (!name) return false
  if (name.startsWith('-') || name.includes('..') || invalidGitBranchChars.test(name)) return false
  return [...name].length <= 255
}

export function canCreateGitBranch(branches: readonly string[], query: string) {
  const name = query.trim()
  if (!isValidGitBranchName(name)) return false
  return !branches.some(branch => branch === name)
}

export function resolveGitBranchSubmit(
  branches: readonly string[],
  current: string,
  query: string,
): { action: 'checkout' | 'create'; branch: string } | null {
  const name = query.trim()
  if (!name) return null
  const matches = filterGitBranches(branches, name)
  const exact = matches.find(branch => branch === name) ?? branches.find(branch => branch === name)
  if (exact) {
    return exact === current ? null : { action: 'checkout', branch: exact }
  }
  if (canCreateGitBranch(branches, name)) {
    return { action: 'create', branch: name }
  }
  const first = matches[0]
  if (first && first !== current) return { action: 'checkout', branch: first }
  return null
}
