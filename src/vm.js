// import { app } from 'electron'
// import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import Lima from '@noop-inc/foundation/lib/Lima.js'
import { readdir } from 'node:fs/promises'

const { resourcesPath } = process

const limaBinPath = join(resourcesPath, 'lima-and-qemu.macos-aarch64', 'bin')
// const userData = join(app.getPath('userData'), 'data')

const lima = new Lima({ binPath: limaBinPath })

export const createVm = async ({ projectsDir }) => {
  // try {
  //   await mkdir(userData, { recursive: true })
  // } catch (error) {
  //   if (error.code !== 'EEXIST') throw error
  // }

  const files = await readdir(resourcesPath)
  const workshopVmPath = join(resourcesPath, files.find(file => file.startsWith('noop-workshop-vm') && file.endsWith('.aarch64.qcow2')))

  const template = {
    arch: 'aarch64',
    images: [{ location: workshopVmPath, arch: 'aarch64' }],
    provision: [],
    containerd: {
      system: true,
      user: false
    },
    ssh: { loadDotSSHPubKeys: false },
    mounts: [
      {
        location: projectsDir,
        mountPoint: '/noop/projects',
        sshfs: { cache: false }
      }
      // {
      //   location: userData,
      //   mountPoint: '/noop/data',
      //   sshfs: { cache: false },
      //   write: true
      // }
    ],
    portForwards: [
      { guestPort: 1234, hostIP: '0.0.0.0' },
      { guestPort: 443, hostIP: '127.0.0.1' }
    ],
    hostResolver: {
      hosts: {
        'registry.workshop': '127.0.0.1'
      }
    }
  }

  try {
    await lima.get('workshop-vm')
    try {
      await stopVm()
    } catch (error) {
      // nothing to stop
    }
    try {
      await deleteVm()
    } catch (error) {
      // nothing to delete
    }
  } catch (error) {
    // workshop-vm does not exist
    console.error(error)
  }
  await lima.create('workshop-vm', template)
}

export const startVm = async () => {
  try {
    const start = lima.limactl(['start', 'workshop-vm'])
    start.on('log', console.log)
    await start.done()
  } catch (error) {
    console.error(error)
    throw error
  }
}

export const stopVm = async () => {
  try {
    const stop = lima.limactl(['stop', 'workshop-vm', '-f'])
    stop.on('log', console.log)
    await stop.done()
  } catch (error) {
    console.error(error)
    throw error
  }
}

export const deleteVm = async () => {
  try {
    const dlt = lima.limactl(['delete', 'workshop-vm', '-f'])
    dlt.on('log', console.log)
    await dlt.done()
  } catch (error) {
    console.error(error)
    throw error
  }
}
