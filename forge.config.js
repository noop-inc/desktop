require('dotenv').config()

const arch = process.arch.includes('arm') ? 'aarch64' : 'x86_64'

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
    {
      name: '@electron-forge/maker-zip'
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
            config: 'node_modules/@noop-inc/console/vite.config.mjs'
          },
          {
            name: 'eula_window',
            config: 'renderers/eula/vite.config.mjs'
          }
        ]
      }
    }
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
}
