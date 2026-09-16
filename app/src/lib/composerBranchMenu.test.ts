import { describe, expect, it } from 'vitest'
import {
  canCreateGitBranch,
  filterGitBranches,
  isValidGitBranchName,
  resolveGitBranchSubmit,
} from '@/lib/composerBranchMenu'

const branches = ['main', 'feat/react-shadcn-ui', 'feat/follow-harness-decisions']

describe('composer branch menu', () => {
  it('filters local branches by substring', () => {
    expect(filterGitBranches(branches, 'react')).toEqual(['feat/react-shadcn-ui'])
    expect(filterGitBranches(branches, '')).toEqual(branches)
  })

  it('rejects names Git would refuse', () => {
    expect(isValidGitBranchName('ok-name')).toBe(true)
    expect(isValidGitBranchName('-leading')).toBe(false)
    expect(isValidGitBranchName('has space')).toBe(false)
    expect(isValidGitBranchName('a..b')).toBe(false)
  })

  it('offers create only for a new valid name', () => {
    expect(canCreateGitBranch(branches, 'hotfix')).toBe(true)
    expect(canCreateGitBranch(branches, 'main')).toBe(false)
    expect(canCreateGitBranch(branches, 'bad name')).toBe(false)
  })

  it('submits checkout for an exact match and create when the query is new', () => {
    expect(resolveGitBranchSubmit(branches, 'main', 'feat/react-shadcn-ui')).toEqual({
      action: 'checkout',
      branch: 'feat/react-shadcn-ui',
    })
    expect(resolveGitBranchSubmit(branches, 'main', 'hotfix')).toEqual({
      action: 'create',
      branch: 'hotfix',
    })
    expect(resolveGitBranchSubmit(branches, 'main', 'main')).toBeNull()
    expect(resolveGitBranchSubmit(branches, 'main', '')).toBeNull()
  })
})
