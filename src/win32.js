'use strict'

const debug = require('debug')('electron-packager')
const path = require('path')
const { WrapperError } = require('cross-spawn-windows-exe')
const { sign } = require('@electron/windows-sign')

const App = require('./platform')
const common = require('./common')

function updateWineMissingException (err) {
  if (err instanceof WrapperError) {
    err.message += '\n\n' +
      'Wine is required to use the appCopyright, appVersion, buildVersion, icon, and \n' +
      'win32metadata parameters for Windows targets.\n\n' +
      'See https://github.com/electron/packager#building-windows-apps-from-non-windows-platforms for details.'
  }

  return err
}

class WindowsApp extends App {
  get originalElectronName () {
    return 'electron.exe'
  }

  get newElectronName () {
    return `${common.sanitizeAppName(this.executableName)}.exe`
  }

  get electronBinaryPath () {
    return path.join(this.stagingPath, this.newElectronName)
  }

  generateRceditOptionsSansIcon () {
    const win32metadata = {
      FileDescription: this.opts.name,
      InternalName: this.opts.name,
      OriginalFilename: this.newElectronName,
      ProductName: this.opts.name,
      ...this.opts.win32metadata
    }

    const rcOpts = { 'version-string': win32metadata }

    if (this.opts.appVersion) {
      rcOpts['product-version'] = rcOpts['file-version'] = this.opts.appVersion
    }

    if (this.opts.buildVersion) {
      rcOpts['file-version'] = this.opts.buildVersion
    }

    if (this.opts.appCopyright) {
      rcOpts['version-string'].LegalCopyright = this.opts.appCopyright
    }

    const manifestProperties = ['application-manifest', 'requested-execution-level']
    for (const manifestProperty of manifestProperties) {
      if (win32metadata[manifestProperty]) {
        rcOpts[manifestProperty] = win32metadata[manifestProperty]
      }
    }

    return rcOpts
  }

  async getIconPath () {
    if (!this.opts.icon) {
      return Promise.resolve()
    }

    return this.normalizeIconExtension('.ico')
  }

  needsRcedit () {
    return this.opts.icon || this.opts.win32metadata || this.opts.appCopyright || this.opts.appVersion || this.opts.buildVersion
  }

  async runRcedit () {
    /* istanbul ignore if */
    if (!this.needsRcedit()) {
      return Promise.resolve()
    }

    const rcOpts = this.generateRceditOptionsSansIcon()

    // Icon might be omitted or only exist in one OS's format, so skip it if normalizeExt reports an error
    const icon = await this.getIconPath()
    if (icon) {
      rcOpts.icon = icon
    }

    debug(`Running rcedit with the options ${JSON.stringify(rcOpts)}`)
    try {
      await require('rcedit')(this.electronBinaryPath, rcOpts)
    } catch (err) {
      throw updateWineMissingException(err)
    }
  }

  async signAppIfSpecified () {
    const windowsSignOpt = this.opts.windowsSign
    const windowsMetaData = this.opts.win32metadata

    if (windowsSignOpt) {
      const signOpts = createSignOpts(windowsSignOpt, windowsMetaData, this.renamedAppPath)
      debug(`Running @electron/windows-sign with the options ${JSON.stringify(signOpts)}`)
      try {
        await sign(signOpts)
      } catch (err) {
        // Although not signed successfully, the application is packed.
        if (signOpts.continueOnError) {
          common.warning(`Code sign failed; please retry manually. ${err}`, this.opts.quiet)
        } else {
          throw err
        }
      }
    }
  }

  async create () {
    await this.initialize()
    await this.renameElectron()
    await this.copyExtraResources()
    await this.runRcedit()
    await this.signAppIfSpecified()
    return this.move()
  }
}

function createSignOpts (properties, windowsMetaData, appDirectory) {
  let result = { appDirectory }

  if (typeof properties === 'object') {
    result = { ...properties, appDirectory }
  }

  // A little bit of convenience
  if (windowsMetaData && windowsMetaData.FileDescription && !result.description) {
    result.description = windowsMetaData.FileDescription
  }

  return result
}

module.exports = {
  App: WindowsApp,
  updateWineMissingException: updateWineMissingException
}
