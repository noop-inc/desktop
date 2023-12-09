require('dotenv').config()

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
    ignore: (file) =>
      !(!file || file.startsWith('/.vite') || (file === '/package.json')),
    extraResource: [
      'assets/lima-and-qemu.macos-aarch64',
      'assets/noop-workshop-vm.aarch64.qcow2'
    ]
    // osxSign: {
    //   optionsForFile: filePath => ({
    //     entitlements: 'assets/entitlements.plist'
    //   })
    // },
    // osxNotarize: {
    //   tool: 'notarytool',
    //   appleId: process.env.APPLE_ID,
    //   appleIdPassword: process.env.APPLE_PASSWORD,
    //   teamId: process.env.APPLE_TEAM_ID
    // }
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
        format: 'ULFO'
      }
    }
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {}
    },
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
          }
        ]
      }
    }
  ]
}
