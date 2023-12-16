// import { app } from 'electron'
// import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import Lima from '@noop-inc/foundation/lib/Lima.js'
import { readdir } from 'node:fs/promises'

const { resourcesPath } = process

const limaBinPath = join(resourcesPath, 'lima-and-qemu.macos-aarch64', 'bin')
// const userData = join(app.getPath('userData'), 'data')

const lima = new Lima({ binPath: limaBinPath })

export const createVm = async () => {
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
        location: '~',
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
  } catch (error) {
    await lima.create('workshop-vm', template)
  }
}

export const startVm = async () => {
  const start = lima.limactl(['start', 'workshop-vm'])
  await start.done()
}

export const stopVm = async () => {
  const stop = lima.limactl(['stop', 'workshop-vm'])
  await stop.done()
}

export const deleteVm = async () => {
  const dlt = lima.limactl(['delete', 'workshop-vm'])
  await dlt.done()
}
