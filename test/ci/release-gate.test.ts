import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import {
  authorizeRelease,
  planRecovery,
  planRelease,
  reconcileMajorTags,
} from '../../scripts/release-gate.mjs'

const repo = { owner: 'owner', repo: 'repo' }
const oldSha = 'a'.repeat(40)
const newSha = 'b'.repeat(40)
const unknownSha = 'c'.repeat(40)
const pending = 'autorelease: pending'
const verified = 'autorelease: verified'
const pull = (number: number, sha: string, labels = [pending]) => ({
  number,
  merge_commit_sha: sha,
  merged_at: '2026-10-02',
  base: { ref: 'main' },
  labels: labels.map((name) => ({ name })),
})

function client(pulls: object[] = [], releases: object[] = [], refs: Record<string, string> = {}) {
  const github = {
    paginate: vi.fn(async (route: string) => (route.endsWith('/pulls') ? pulls : releases)),
    rest: {
      issues: { addLabels: vi.fn() },
      git: {
        getRef: vi.fn(async ({ ref }: { ref: string }) => {
          if (!(ref in refs)) throw Object.assign(new Error('Not found'), { status: 404 })
          return { data: { object: { type: 'commit', sha: refs[ref] } } }
        }),
        getTag: vi.fn(),
        createRef: vi.fn(),
        updateRef: vi.fn(),
      },
      repos: {
        compareCommitsWithBasehead: vi.fn().mockResolvedValue({ data: { status: 'ahead' } }),
      },
    },
  }
  return github
}

const release = (tag_name: string) => ({ tag_name, draft: false, prerelease: false })

describe('release candidate gate', () => {
  it('verifies exact merged SHAs including old pending and interrupted verified candidates', async () => {
    const github = client([
      pull(1, oldSha),
      pull(2, newSha, [verified]),
      { ...pull(3, unknownSha), merged_at: null },
    ])
    const plan = await planRelease(github, repo)
    expect(plan.shas).toEqual([oldSha, newSha])
    expect(plan.candidates.map((item: { number: number }) => item.number)).toEqual([1, 2])
    expect(github.rest.issues.addLabels).not.toHaveBeenCalled()
  })

  it('plans only the newest stable release per major for tag recovery', async () => {
    const github = client(
      [],
      [release('v0.2.4'), release('v0.2.5'), release('v1.0.0'), release('v2.0.0-rc.1')],
      {
        'tags/v0.2.5': oldSha,
        'tags/v1.0.0': newSha,
      },
    )
    const plan = await planRecovery(github, repo)
    expect(plan.shas).toEqual([oldSha, newSha])
    expect(github.rest.git.getRef).not.toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'tags/v0.2.4' }),
    )
  })

  it('does not revalidate a historical release whose major tag is already correct', async () => {
    const github = client([], [release('v0.2.5')], { 'tags/v0.2.5': oldSha, 'tags/v0': oldSha })
    expect(await planRecovery(github, repo)).toEqual({ shas: [] })
  })

  it('does not consult historical APIs when planning a new candidate', async () => {
    const github = client([pull(1, newSha)], [release('v0.2.5')])
    expect((await planRelease(github, repo)).shas).toEqual([newSha])
    expect(github.rest.git.getRef).not.toHaveBeenCalled()
    await expect(planRecovery(github, repo)).rejects.toThrow('missing its tag')
    expect((await planRelease(github, repo)).shas).toEqual([newSha])
  })

  it('leaves a new concurrent pending release outside the authorized snapshot', async () => {
    const github = client([pull(1, oldSha), pull(2, newSha)])
    await authorizeRelease(github, repo, {
      shas: [oldSha],
      candidates: [{ number: 1, sha: oldSha }],
    })
    expect(github.rest.issues.addLabels).toHaveBeenCalledExactlyOnceWith({
      ...repo,
      issue_number: 1,
      labels: [pending, verified],
    })
  })

  it('rejects a newly verified candidate before writing any labels', async () => {
    const github = client([pull(1, oldSha), pull(2, newSha, [pending, verified])])
    await expect(
      authorizeRelease(github, repo, { shas: [oldSha], candidates: [{ number: 1, sha: oldSha }] }),
    ).rejects.toThrow('Unverified')
    expect(github.rest.issues.addLabels).not.toHaveBeenCalled()
  })

  it('rejects a changed candidate SHA or missing verification proof', async () => {
    const github = client([pull(1, newSha)])
    await expect(
      authorizeRelease(github, repo, { shas: [oldSha], candidates: [{ number: 1, sha: oldSha }] }),
    ).rejects.toThrow('changed')
    await expect(
      authorizeRelease(github, repo, { shas: [], candidates: [{ number: 1, sha: newSha }] }),
    ).rejects.toThrow('changed')
    expect(github.rest.issues.addLabels).not.toHaveBeenCalled()
  })

  it('rejects malformed API candidates', async () => {
    await expect(planRelease(client([pull(1, 'main')]), repo)).rejects.toThrow(
      'Invalid release candidate',
    )
    await expect(
      planRelease(client([{ ...pull(1, oldSha), base: { ref: 'feature' } }]), repo),
    ).rejects.toThrow('Invalid release candidate')
  })

  it('does not advance any major tag to an unverified release', async () => {
    const github = client([], [release('v0.2.5'), release('v1.0.0')], {
      'tags/v0.2.5': oldSha,
      'tags/v1.0.0': newSha,
    })
    expect(await reconcileMajorTags(github, repo, { shas: [oldSha] })).toEqual({
      updated: ['v0'],
      skipped: ['v1.0.0'],
    })
    expect(github.rest.git.createRef).toHaveBeenCalledExactlyOnceWith({
      ...repo,
      ref: 'refs/tags/v0',
      sha: oldSha,
    })
    expect(github.rest.git.updateRef).not.toHaveBeenCalled()
  })

  it('does not let recovery move a tag after a new release won the race', async () => {
    const github = client([], [release('v0.2.5'), release('v0.2.6')], {
      'tags/v0.2.5': oldSha,
      'tags/v0.2.6': newSha,
      'tags/v0': oldSha,
    })
    expect(await reconcileMajorTags(github, repo, { shas: [oldSha] })).toEqual({
      updated: [],
      skipped: ['v0.2.6'],
    })
    expect(github.rest.git.updateRef).not.toHaveBeenCalled()
    expect(github.rest.git.createRef).not.toHaveBeenCalled()
  })

  it('recovers major movement after a Release was already created and is idempotent', async () => {
    const github = client([], [release('v0.2.5')], { 'tags/v0.2.5': newSha, 'tags/v0': oldSha })
    await reconcileMajorTags(github, repo, { shas: [newSha] })
    expect(github.rest.git.updateRef).toHaveBeenCalledExactlyOnceWith({
      ...repo,
      ref: 'tags/v0',
      sha: newSha,
      force: false,
    })
    const current = client([], [release('v0.2.5')], { 'tags/v0.2.5': newSha, 'tags/v0': newSha })
    await reconcileMajorTags(current, repo, { shas: [newSha] })
    expect(current.rest.git.updateRef).not.toHaveBeenCalled()
  })

  it('refuses downgrade and divergent major moves', async () => {
    const github = client([], [release('v0.2.5')], { 'tags/v0.2.5': newSha, 'tags/v0': oldSha })
    github.rest.repos.compareCommitsWithBasehead.mockResolvedValue({ data: { status: 'behind' } })
    await expect(reconcileMajorTags(github, repo, { shas: [newSha] })).rejects.toThrow('backwards')
    expect(github.rest.git.updateRef).not.toHaveBeenCalled()
  })
})

describe('workflow wiring', () => {
  const workflow = parse(readFileSync('.github/workflows/release-please.yml', 'utf8'))
  it('authorizes only after the complete exact-SHA validation matrix succeeds', () => {
    expect(workflow.jobs.verify.strategy.matrix.sha).toContain('needs.plan.outputs.plan')
    expect(workflow.jobs.verify.with.ref).toContain('matrix.sha')
    expect(workflow.jobs.plan.if).toContain("github.ref == 'refs/heads/main'")
    expect(workflow.jobs.publish.needs).toEqual(['plan', 'verify'])
    expect(workflow.jobs.publish.if).toContain("needs.verify.result == 'success'")
    expect(workflow.jobs.publish.if).not.toContain("needs.verify.result == 'failure'")
    expect(workflow.jobs.publish.if).not.toContain('always()')
    expect(workflow.jobs.publish.if).not.toContain("needs.verify.result == 'skipped'")
    const steps = workflow.jobs.publish.steps
    expect(
      steps.find((step: { name: string }) => step.name === 'Publish verified releases').with[
        'skip-github-pull-request'
      ],
    ).toBe(true)
    expect(workflow.jobs.maintain.steps[0].with['skip-github-release']).toBe(true)
  })

  it('isolates recovery failures from new publication and release PR maintenance', () => {
    expect(workflow.jobs.publish.needs).toEqual(['plan', 'verify'])
    expect(workflow.jobs.maintain.needs).toBeUndefined()
    expect(workflow.jobs.maintain.if).toContain("github.ref == 'refs/heads/main'")
    expect(workflow.jobs['verify-recovery'].needs).toBe('recovery-plan')
    expect(workflow.jobs.recover.needs).toEqual(['recovery-plan', 'verify-recovery'])
    expect(workflow.jobs.recover.if).toContain("needs.verify-recovery.result == 'success'")
    expect(workflow.jobs.recover.if).not.toContain('always()')
  })

  it('keeps both release configurations identical except the verified-label gate', () => {
    const source = JSON.parse(readFileSync('release-please-config.json', 'utf8'))
    const { label, ...publish } = JSON.parse(
      readFileSync('release-please-release-config.json', 'utf8'),
    )
    expect(label).toBe(`${pending},${verified}`)
    expect(publish).toEqual(source)
  })
})
