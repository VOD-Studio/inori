export const PENDING_LABEL = 'autorelease: pending'
export const VERIFIED_LABEL = 'autorelease: verified'
const SHA = /^[a-f0-9]{40}$/
const VERSION = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function candidates(github, repo) {
  const pulls = await github.paginate('GET /repos/{owner}/{repo}/pulls', {
    ...repo,
    state: 'closed',
    base: 'main',
    per_page: 100,
  })
  return pulls.flatMap((pr) => {
    assert(pr !== null && typeof pr === 'object', 'Invalid pull request response')
    assert(
      Array.isArray(pr.labels) && pr.labels.every((label) => typeof label?.name === 'string'),
      `Invalid labels on PR #${pr.number}`,
    )
    const labels = pr.labels.map((label) => label.name)
    if (!labels.includes(PENDING_LABEL) && !labels.includes(VERIFIED_LABEL)) return []
    if (!pr.merged_at) return []
    assert(
      Number.isSafeInteger(pr.number) &&
        pr.number > 0 &&
        typeof pr.merged_at === 'string' &&
        Number.isFinite(Date.parse(pr.merged_at)) &&
        pr.base?.ref === 'main' &&
        typeof pr.merge_commit_sha === 'string' &&
        SHA.test(pr.merge_commit_sha),
      'Invalid release candidate',
    )
    return [
      { number: pr.number, sha: pr.merge_commit_sha, verified: labels.includes(VERIFIED_LABEL) },
    ]
  })
}

async function optionalRef(github, repo, tag) {
  try {
    return (await github.rest.git.getRef({ ...repo, ref: `tags/${tag}` })).data
  } catch (error) {
    if (typeof error === 'object' && error !== null && error.status === 404) return null
    throw error
  }
}

async function commitForRef(github, repo, ref) {
  let object = ref.object
  for (let depth = 0; depth < 10; depth += 1) {
    assert(SHA.test(object?.sha ?? ''), 'Invalid tag SHA')
    if (object.type === 'commit') return object.sha
    assert(object.type === 'tag', 'Tag must reference a commit')
    object = (await github.rest.git.getTag({ ...repo, tag_sha: object.sha })).data.object
  }
  throw new Error('Too many nested annotated tags')
}

async function latestReleases(github, repo) {
  const releases = await github.paginate('GET /repos/{owner}/{repo}/releases', {
    ...repo,
    per_page: 100,
  })
  const latest = new Map()
  for (const release of releases) {
    assert(
      release !== null &&
        typeof release === 'object' &&
        typeof release.tag_name === 'string' &&
        typeof release.draft === 'boolean' &&
        typeof release.prerelease === 'boolean',
      'Invalid release response',
    )
    if (release.draft || release.prerelease) continue
    const match = VERSION.exec(release.tag_name)
    if (!match) continue
    const version = match.slice(1).map(Number)
    assert(version.every(Number.isSafeInteger), 'Invalid release version')
    const previous = latest.get(version[0])
    if (
      !previous ||
      version[1] > previous.version[1] ||
      (version[1] === previous.version[1] && version[2] > previous.version[2])
    ) {
      latest.set(version[0], { tag: release.tag_name, version })
    }
  }
  const result = []
  for (const { tag } of latest.values()) {
    const ref = await optionalRef(github, repo, tag)
    assert(ref, `Release ${tag} is missing its tag`)
    result.push({ tag, sha: await commitForRef(github, repo, ref) })
  }
  return result
}

export async function planRelease(github, repo) {
  const pending = await candidates(github, repo)
  const shas = [...new Set(pending.map((item) => item.sha))]
  assert(shas.length <= 200, 'Too many release candidates for one verification run')
  return { candidates: pending, shas }
}

export async function planRecovery(github, repo) {
  const releases = await latestReleases(github, repo)
  const recovery = new Set()
  for (const release of releases) {
    const current = await optionalRef(github, repo, release.tag.split('.')[0])
    if (!current || (await commitForRef(github, repo, current)) !== release.sha) {
      recovery.add(release.sha)
    }
  }
  assert(recovery.size <= 200, 'Too many release recovery targets for one verification run')
  return { shas: [...recovery] }
}

function validatedShas(plan) {
  assert(
    Array.isArray(plan.shas) && plan.shas.every((sha) => typeof sha === 'string' && SHA.test(sha)),
    'Invalid verification plan',
  )
  return new Set(plan.shas)
}

// Called only by the job that needs the entire verification matrix to succeed.
export async function authorizeRelease(github, repo, plan) {
  const allowed = validatedShas(plan)
  const current = await candidates(github, repo)
  const planned = new Map(plan.candidates.map((item) => [item.number, item.sha]))
  for (const candidate of current) {
    if (candidate.verified) {
      assert(
        planned.get(candidate.number) === candidate.sha && allowed.has(candidate.sha),
        `Unverified release label on PR #${candidate.number}`,
      )
    }
  }
  for (const candidate of plan.candidates) {
    assert(
      allowed.has(candidate.sha) &&
        current.some((item) => item.number === candidate.number && item.sha === candidate.sha),
      `Release candidate #${candidate.number} changed after verification`,
    )
  }
  for (const candidate of plan.candidates) {
    await github.rest.issues.addLabels({
      ...repo,
      issue_number: candidate.number,
      labels: [PENDING_LABEL, VERIFIED_LABEL],
    })
  }
}

export async function reconcileMajorTags(github, repo, plan) {
  const allowed = validatedShas(plan)
  const releases = await latestReleases(github, repo)
  const result = { updated: [], skipped: [] }
  for (const release of releases) {
    const major = release.tag.split('.')[0]
    const current = await optionalRef(github, repo, major)
    const currentSha = current ? await commitForRef(github, repo, current) : null
    if (currentSha === release.sha) continue
    // Another job may have published a newer release while recovery was verifying.
    if (!allowed.has(release.sha)) {
      result.skipped.push(release.tag)
      continue
    }
    if (!current) {
      await github.rest.git.createRef({ ...repo, ref: `refs/tags/${major}`, sha: release.sha })
      result.updated.push(major)
      continue
    }
    const comparison = await github.rest.repos.compareCommitsWithBasehead({
      ...repo,
      basehead: `${currentSha}...${release.sha}`,
    })
    assert(
      comparison.data.status === 'ahead',
      `Refusing to move ${major} backwards or across divergent history`,
    )
    await github.rest.git.updateRef({
      ...repo,
      ref: `tags/${major}`,
      sha: release.sha,
      force: false,
    })
    result.updated.push(major)
  }
  return result
}
