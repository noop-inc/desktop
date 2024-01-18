// import { app } from 'electron'
// import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import Lima from '@noop-inc/foundation/lib/Lima.js'
import { readdir } from 'node:fs/promises'

const { resourcesPath } = process

const limaBinPath = (process.env.npm_lifecycle_event === 'serve')
  ? join(process.env.npm_config_local_prefix, 'node_modules/@noop-inc/desktop-lima/dist/lima-and-qemu.macos-aarch64/bin')
  : join(resourcesPath, 'lima-and-qemu.macos-aarch64', 'bin')

// const userData = join(app.getPath('userData'), 'data')

const lima = new Lima({ binPath: limaBinPath })

const logHandler = message => console.log(message)

export const createVm = async ({ projectsDir }) => {
  // try {
  //   await mkdir(userData, { recursive: true })
  // } catch (error) {
  //   if (error.code !== 'EEXIST') throw error
  // }

  console.log('Creating Workshop VM')

  const workshopVmPath = (process.env.npm_lifecycle_event === 'serve')
    ? join(process.env.npm_config_local_prefix, `noop-workshop-vm-${process.env.WORKSHOP_VM_VERSION}.aarch64.qcow2`)
    : join(resourcesPath, (await readdir(resourcesPath)).find(file => file.startsWith('noop-workshop-vm') && file.endsWith('.aarch64.qcow2')))

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
  console.log('Starting Workshop VM')

  let start
  try {
    start = lima.limactl(['start', 'workshop-vm'])
    start.on('log', logHandler)
    await start.done()
    start.off('log', logHandler)
  } catch (error) {
    start?.off('log', logHandler)
    console.error(error)
    throw error
  }
}

export const stopVm = async () => {
  console.log('Stopping Workshop VM')

  let stop
  try {
    stop = lima.limactl(['stop', 'workshop-vm', '-f'])
    stop.on('log', logHandler)
    await stop.done()
  } catch (error) {
    stop?.off('log', logHandler)
    console.error(error)
    throw error
  }
}

export const deleteVm = async () => {
  console.log('Deleting Workshop VM')

  let dlt
  try {
    dlt = lima.limactl(['delete', 'workshop-vm', '-f'])
    dlt.on('log', logHandler)
    await dlt.done()
    dlt.off('log', logHandler)
  } catch (error) {
    dlt?.off('log', logHandler)
    console.error(error)
    throw error
  }
}
