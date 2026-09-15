import { describe, expect, it } from 'vitest'
import {
  assessDestructiveRequest,
  parseDestructiveTargets,
  protectedMatch,
} from './destructiveTarget'

describe('destructive target parsing', () => {
  // Defect 11: a `find … -delete` used to be reported as the whole workspace root.
  it('reports the find root, not the workspace, for find -delete', () => {
    const [target] = parseDestructiveTargets("find work/logs -name '*.log' -delete", '/Users/me/project')
    expect(target.path).toBe('/Users/me/project/work/logs')
    expect(target.kind).toBe('directory-tree')
    expect(target.recursive).toBe(true)
    expect(target.reason).toContain('-name')
  })

  it('treats a bare find -delete as the tree under its start directory', () => {
    const [target] = parseDestructiveTargets('find . -delete', '/Users/me/project')
    expect(target.path).toBe('/Users/me/project')
    expect(target.reason).toContain('整个起始目录树')
  })

  it('separates a single file removal from a recursive directory removal', () => {
    const [file] = parseDestructiveTargets('rm -f /tmp/notes.txt')
    expect(file.kind).toBe('file')
    expect(file.recursive).toBe(false)

    const [tree] = parseDestructiveTargets('rm -rf /tmp/build')
    expect(tree.kind).toBe('directory-tree')
    expect(tree.recursive).toBe(true)
  })

  it('lists every operand of a multi-target rm', () => {
    const targets = parseDestructiveTargets('rm -rf a b', '/work')
    expect(targets.map(target => target.path)).toEqual(['/work/a', '/work/b'])
  })

  // Piped deletes cannot be scoped from the command text: the card must say so.
  it('marks xargs deletes as undetermined', () => {
    const [target] = parseDestructiveTargets('ls /tmp/old | xargs rm -rf')
    expect(target.kind).toBe('unknown')
    expect(target.reason).toContain('xargs')
  })

  it('marks an rm without operands as undetermined', () => {
    const [target] = parseDestructiveTargets('rm -rf')
    expect(target.kind).toBe('unknown')
  })
})

describe('protected rules and user data', () => {
  it('protects the temporary build caches', () => {
    expect(protectedMatch('/private/tmp/milksu-restore-check-oWZogJ')).toEqual({
      protected: true,
      rule: '/private/tmp/milksu-*',
    })
    expect(protectedMatch('/private/tmp/mairecord-backup')).toEqual({
      protected: true,
      rule: '/private/tmp/mairecord-*',
    })
  })

  it('protects user data but allows explicit caches', () => {
    expect(protectedMatch(`${process.env.HOME}/Library/Application Support/com.milksu.app.beta/runtime-data`).protected)
      .toBe(true)
    expect(protectedMatch(`${process.env.HOME}/Library/Caches/whatever`).protected).toBe(false)
    expect(protectedMatch('/Users/me/Documents/report.pdf').protected).toBe(true)
  })
})

describe('destructive assessment', () => {
  it('calls a rebuildable app copy low risk', () => {
    const assessment = assessDestructiveRequest(
      'rm -rf /Users/me/Applications/.MilkSU\\ Beta\\ Test.app.bak-20260914-112838',
      [{ exists: true, inGitRepository: true, gitTracked: true, rebuildable: true, rebuildSource: 'a602733a' }],
    )
    expect(assessment.risk).toBe('low')
    expect(assessment.verdict).toContain('可重建')
    expect(assessment.undetermined).toBe(false)
  })

  it('calls an untracked, unbacked target high risk', () => {
    const assessment = assessDestructiveRequest(
      'rm -rf /Users/me/work/notes',
      [{ exists: true, inGitRepository: true, gitTracked: false, rebuildable: false }],
    )
    expect(assessment.risk).toBe('high')
    expect(assessment.verdict).toContain('无法恢复')
  })

  it('raises risk for protected targets even when they look rebuildable', () => {
    const assessment = assessDestructiveRequest(
      `rm -rf ${process.env.HOME}/Library/Application Support/com.milksu.app.beta/runtime-data`,
      [{ exists: true, rebuildable: true }],
    )
    expect(assessment.risk).toBe('high')
    expect(assessment.protections.length).toBeGreaterThan(0)
    expect(assessment.verdict).toContain('受保护清单')
  })

  // The allow button is gated on `undetermined`: an unscopable command never passes.
  it('stays undetermined when the scope cannot be established', () => {
    const assessment = assessDestructiveRequest('ls /tmp | xargs rm')
    expect(assessment.undetermined).toBe(true)
    expect(assessment.risk).not.toBe('low')
  })

  it('reports measured size in the verdict', () => {
    const assessment = assessDestructiveRequest(
      'rm -rf /Users/me/backups/old',
      [{ exists: true, fileCount: 42, totalBytes: 3 * 1024 * 1024, sampled: true }],
    )
    expect(assessment.verdict).toContain('42 个文件')
    expect(assessment.verdict).toContain('仅采样')
  })
})
