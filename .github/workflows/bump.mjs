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

const versionInput = process.env.VERSION_INPUT
if (!versionInput) throw new Error('Missing versionInput')

// matches format '1.2.3'
const latestMatch = /^v([0-9]+)\.([0-9]+)\.([0-9]+)$/
// matches format '1.2.3-4'
const nextMatch = /^v([0-9]+)\.([0-9]+)\.([0-9]+)\-([0-9]+)$/
// matches format '1.2.3-alpha.4'
const preMatch = /^v([0-9]+)\.([0-9]+)\.([0-9]+)\-[a-zA-Z0-9_]+\.([0-9]+)$/

if (!latestMatch.test(versionInput) && !nextMatch.test(versionInput) && !preMatch.test(versionInput)) {
  throw new Error('Unable to identify version number format')
}

const versionNumber = versionInput?.replace(/^v/, '')
if (!versionNumber) throw new Error('Missing versionNumber')

// bump version
await exec(`npm version ${versionNumber}`)
await exec(`git push origin ${versionNumber} --force`)
