const { FusesPlugin } = require('@electron-forge/plugin-fuses')
const { FuseV1Options, FuseVersion } = require('@electron/fuses')
const { parseArgs } = require('node:util')
// const { spawn: spawnCallback } = require('node:child_process')
// const { rm, cp, rename } = require('node:fs/promises')
// const { resolve } = require('node:path')

require('dotenv').config()

const args = process.argv.slice(2)
const options = { arch: { type: 'string' } }
const { values } = parseArgs({ args, options })
const arch = ['x64', 'arm64'].includes(values?.arch)
  ? { x64: 'x86_64', arm64: 'aarch64' }[values.arch]
  : (process.arch.includes('arm') ? 'aarch64' : 'x86_64')

// const spawn = async (...args) => await new Promise((resolve, reject) => {
//   const spawnArgs = [...args]
//   spawnArgs[2] = { ...spawnArgs[2], stdio: [process.stdin, process.stdout, process.stderr] }
//   const cp = spawnCallback(...spawnArgs)
//   cp.on('close', code => {
//     code ? reject(new Error('dekstop-lima install error', { code, args })) : resolve()
//   })
// })

module.exports = {
  packagerConfig: {
    asar: true,
    name: 'Noop',
    appBundleId: 'app.noop.desktop',
    icon: 'assets/icon',
    protocols: [
      {
        name: 'noop',
        schemes: ['noop']
      }
    ],
    ignore: file =>
      !(
        !file ||
        file.startsWith('/.vite') ||
        (file.startsWith('/node_modules') && !file.split('/').at(-1).startsWith('.')) ||
        (file === '/package.json')
      ),
    ...(
      ['dev', 'serve'].includes(process.env.npm_lifecycle_event)
        ? {}
        : {
            extraResource: [
              `node_modules/@noop-inc/desktop-lima/dist/lima-and-qemu.macos-${arch}`,
              `noop-workshop-vm-${process.env.WORKSHOP_VM_VERSION}.${arch}.disk`
            ]
          }
    ),
    osxSign: {
      optionsForFile: filePath => ({
        entitlements: 'assets/entitlements.plist'
      })
    },
    osxNotarize: {
      tool: 'notarytool',
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_PASSWORD,
      teamId: process.env.TEAM_ID
    }
  },
  rebuildConfig: {},
  makers: [
    // {
    //   name: '@electron-forge/maker-squirrel',
    //   config: {}
    // },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin']
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        // Path to the icon to use for the app in the DMG window
        icon: 'assets/icon.icns',
        format: 'ULMO',
        additionalDMGOptions: {
          filesystem: 'APFS'
        }
      }
    }
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
        // If you are familiar with Vite configuration, it will look really familiar.
        build: [
          {
            // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
            entry: 'src/main.js',
            config: 'vite.main.config.mjs'
          },
          {
            entry: 'src/preload.js',
            config: 'vite.preload.config.mjs'
          }
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.mjs'
          },
          {
            name: 'eula_window',
            config: 'renderers/eula/vite.config.mjs'
          }
        ]
      }
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'noop-inc',
          name: 'desktop'
        },
        prerelease: true,
        draft: true,
        force: true
      }
    }
  ]
  // hooks: {
  //   prePackage: async (config, platform, arch) => {
  //     if (['package', 'make'].includes(process.env.npm_lifecycle_event)) {
  //       if (platform === 'darwin') {
  //         const foundArch = ({
  //           arm64: 'aarch64',
  //           x64: 'x86_64'
  //         })[arch]

  //         const qemuDistDir = resolve(__dirname, 'node_modules/@noop-inc/desktop-lima/dist')

  //         const qemuX86Zip = resolve(qemuDistDir, 'lima-and-qemu.macos-x86_64.zip')
  //         const qemuArmZip = resolve(qemuDistDir, 'lima-and-qemu.macos-aarch64.zip')

  //         const qemuX86Dir = resolve(qemuDistDir, 'lima-and-qemu.macos-x86_64')
  //         const qemuArmDir = resolve(qemuDistDir, 'lima-and-qemu.macos-aarch64')

  //         // const qemuArmZip = resolve(__dirname, 'node_modules/@noop-inc/desktop-lima/dist/lima-and-qemu.macos-aarch64.zip')

  //         // const qemuX86Dir = resolve(__dirname, 'lima-and-qemu.macos-x86_64')
  //         // const qemuArmDir = resolve(__dirname, 'lima-and-qemu.macos-aarch64')
  //         // const qemuDir = resolve(__dirname, 'lima-and-qemu.macos')

  //         const workshopVmImageX86 = resolve(__dirname, `noop-workshop-vm-${process.env.WORKSHOP_VM_VERSION}.x86_64.disk`)
  //         const workshopVmImageArm = resolve(__dirname, `noop-workshop-vm-${process.env.WORKSHOP_VM_VERSION}.aarch64.disk`)
  //         // const workshopVmImage = resolve(__dirname, `noop-workshop-vm-${process.env.WORKSHOP_VM_VERSION}.disk`)

  //         // await rm(qemuDir, { recursive: true, force: true })
  //         // await rm(workshopVmImage, { recursive: true, force: true })

  //         if (foundArch === 'aarch64') {
  //           await rm(qemuArmDir, { recursive: true, force: true })
  //           await spawn('ditto', ['-x', '-k', qemuArmZip, qemuDistDir])
  //           config.packagerConfig.extraResource = [
  //             qemuArmDir,
  //             workshopVmImageArm
  //           ]

  //           // await rename(qemuArmDir, qemuDir)
  //           // await cp(workshopVmImageArm, workshopVmImage, { recursive: true, force: true })
  //         }

  //         if (foundArch === 'x86_64') {
  //           await rm(qemuX86Dir, { recursive: true, force: true })
  //           await spawn('ditto', ['-x', '-k', qemuX86Zip, qemuDistDir])
  //           config.packagerConfig.extraResource = [
  //             qemuX86Dir,
  //             workshopVmImageX86
  //           ]

  //           // await rename(qemuX86Dir, qemuDir)
  //           // await cp(workshopVmImageX86, workshopVmImage, { recursive: true, force: true })
  //         }
  //       }
  //     }
  //   }
  // }
}
