import child from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(function (command, done) {
  console.log(`Executing: '${command}'`)
  child.exec(command, (error, stdout, stderr) => {
    if (error) return done(error)
    console.error(stderr)
    console.log(stdout)
    done(null, { stdout, stderr })
  })
})

const githubRef = process.env.GITHUB_REF
if (!githubRef) throw new Error('Missing githubRef')

// matches format '1.2.3'
const latestMatch = /^v([0-9]+)\.([0-9]+)\.([0-9]+)$/
// matches format '1.2.3-4'
const nextMatch = /^v([0-9]+)\.([0-9]+)\.([0-9]+)\-([0-9]+)$/
// matches format '1.2.3-alpha.4'
const preMatch = /^v([0-9]+)\.([0-9]+)\.([0-9]+)\-[a-zA-Z0-9_]+\.([0-9]+)$/

if (!latestMatch.test(githubRef) && !nextMatch.test(githubRef) && !preMatch.test(githubRef)) {
  throw new Error('Unable to identify version number format')
}

const versionNumber = githubRef?.replace(/^v/, '')
if (!versionNumber) throw new Error('Missing versionNumber')

// bump version, but do not create associated tag/commit
await exec(`npm --no-git-tag-version version ${versionNumber}`)