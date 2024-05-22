import { existsSync } from 'node:fs'
import { defineCommand } from 'citty'
import { resolve } from 'pathe'
import type { ProxifiedModule } from 'magicast'
import { loadFile, writeFile, parseModule } from 'magicast'
import consola from 'consola'
import { addDependency } from 'nypm'
import { $fetch } from 'ofetch'
import { satisfies } from 'semver'
import { colors } from 'consola/utils'
import { sharedArgs } from '../_shared'
import {
  checkNuxtCompatibility,
  fetchModules,
  getNuxtVersion,
  getProjectPackage,
} from './_utils'
import type { NuxtModule } from './_utils'

export default defineCommand({
  meta: {
    name: 'add',
    description: 'Add Nuxt modules',
  },
  args: {
    ...sharedArgs,
    moduleName: {
      type: 'positional',
      description: 'Module name',
      alias: 'm',
    },
    skipInstall: {
      type: 'boolean',
      description: 'Skip npm install',
      default: true,
    },
    skipConfig: {
      type: 'boolean',
      description: 'Skip nuxt.config.ts update',
      default: true,
    },
    peerDeps: {
      type: 'string',
      description:
        'Installing peer dependencies.\n\t \
           If not specified, peerDependencies from package.json will be installed.',
      alias: 'p',
      default: undefined,
    },
    devDeps: {
      type: 'boolean',
      description:
        'Use this with "-p" option.\n\t \
           Enabling this option will install to devDependencies.',
      alias: ['D'],
      default: false,
    },
  },
  async setup(ctx) {
    const cwd = resolve(ctx.args.cwd || './playground')
    const projectPkg = await getProjectPackage(cwd)

    if (!projectPkg.dependencies?.nuxt && !projectPkg.devDependencies?.nuxt) {
      consola.warn(`No \`nuxt\` dependency detected in \`${cwd}\`.`)
      const shouldContinue = await consola.prompt(
        `Do you want to continue anyway?`,
        {
          type: 'confirm',
          initial: false,
        },
      )
      if (shouldContinue !== true) {
        return false
      }
    }

    const addModules = ctx.args.moduleName.split(',')
    consola.warn('多分エラー出るよ:', addModules)
    // for (const m of addModules) {
    //   const r = await resolveModule(m, cwd)
    //   if (r === false) {
    //     return
    //   }
    //   const isDev = Boolean(projectPkg.devDependencies?.nuxt)
    //   consola.info(
    //     `Installing \`${r.pkg}\`${isDev ? ' development' : ''} dependency`,
    //   )

    //   await addDependency(m, {
    //     cwd,
    //     dev: isDev,
    //   }).catch((error) => {
    //     consola.error(error)
    //   })
    // }
    addModules.map(async (module) => {
      const r = await resolveModule(module, cwd)
      if (r === false) {
        return
      }
      const isDev = Boolean(projectPkg.devDependencies?.nuxt)
      consola.info(
        `Installing \`${r.pkg}\`${isDev ? ' development' : ''} dependency`,
      )

      await addDependency(module, {
        cwd,
        dev: isDev,
      }).catch((error) => {
        consola.error(error)
      })
    })

    // const r = await resolveModule(ctx.args.moduleName, cwd)
    // if (r === false) {
    //   return
    // }
    const r = false

    // Add npm dependency
    if (!ctx.args.skipInstall) {
      const isDev = Boolean(projectPkg.devDependencies?.nuxt)
      consola.info(
        `Installing \`${r.pkg}\`${isDev ? ' development' : ''} dependency`,
      )
      const res = await addDependency(r.pkg, { cwd, dev: isDev }).catch(
        (error) => {
          consola.error(error)
          return consola.prompt(
            `Install failed for ${colors.cyan(
              r.pkg,
            )}. Do you want to continue adding the module to ${colors.cyan(
              'nuxt.config',
            )}?`,
            {
              type: 'confirm',
              initial: false,
            },
          )
        },
      )
      if (res === false) {
        return
      }
    }

    // Update nuxt.config.ts
    if (!ctx.args.skipConfig) {
      await updateNuxtConfig(cwd, (config) => {
        if (!config.modules) {
          config.modules = []
        }

        if (config.modules.includes(r.pkgName)) {
          consola.info(`\`${r.pkgName}\` is already in the \`modules\``)
          return
        }
        consola.info(`Adding \`${r.pkgName}\` to the \`modules\``)
        config.modules.push(r.pkgName)
      }).catch((err) => {
        consola.error(err)
        consola.error(
          `Please manually add \`${r.pkgName}\` to the \`modules\` in \`nuxt.config.ts\``,
        )
      })
    }

    // Install peer dependencies
    const _deps = ctx.args.peerDeps
    if (typeof _deps === 'undefined') {
      consola.info('peer dependencies is not installed')
      // Note: if r.nuxtModule.peerDependencies is not empty, install them
      // } else if (deps.length === 0) {
      //   consola.start('Installing peer dependencies from package.json')
      //   consola.box(`${typeof deps}\n\n${deps}`)
    } else {
      consola.info(`Installing ${colors.cyan(_deps)} dependencies`)
      await addDependency(_deps, { cwd, dev: ctx.args.devDeps }).catch(
        (error) => {
          consola.error(error)
        },
      )
    }
  },
})

// -- Internal Utils --

async function updateNuxtConfig(
  rootDir: string,
  update: (config: any) => void,
) {
  let _module: ProxifiedModule
  const nuxtConfigFile = resolve(rootDir, 'nuxt.config.ts')
  if (existsSync(nuxtConfigFile)) {
    consola.info('Updating `nuxt.config.ts`')
    _module = await loadFile(nuxtConfigFile)
  } else {
    consola.info('Creating `nuxt.config.ts`')
    _module = parseModule(getDefaultNuxtConfig())
  }
  const defaultExport = _module.exports.default
  if (!defaultExport) {
    throw new Error('`nuxt.config.ts` does not have a default export!')
  }
  if (defaultExport.$type === 'function-call') {
    update(defaultExport.$args[0])
  } else {
    update(defaultExport)
  }
  await writeFile(_module as any, nuxtConfigFile)
  consola.success('`nuxt.config.ts` updated')
}

function getDefaultNuxtConfig() {
  return `
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: []
})`
}

// Based on https://github.com/dword-design/package-name-regex
const packageRegex =
  /^(@[a-z0-9-~][a-z0-9-._~]*\/)?([a-z0-9-~][a-z0-9-._~]*)(@[^@]+)?$/

async function resolveModule(
  moduleName: string,
  cwd: string,
): Promise<
  | false
  | {
      nuxtModule?: NuxtModule
      pkg: string
      pkgName: string
      pkgVersion: string
    }
> {
  let pkgName = moduleName
  let pkgVersion: string | undefined

  const reMatch = moduleName.match(packageRegex)
  if (reMatch) {
    if (reMatch[3]) {
      pkgName = `${reMatch[1] || ''}${reMatch[2] || ''}`
      pkgVersion = reMatch[3].slice(1)
    }
  } else {
    consola.error(`Invalid package name \`${pkgName}\`.`)
    return false
  }

  const modulesDB = await fetchModules().catch((err) => {
    consola.warn('Cannot search in the Nuxt Modules database: ' + err)
    return []
  })

  const matchedModule = modulesDB.find(
    (module) =>
      module.name === moduleName ||
      module.npm === pkgName ||
      module.aliases?.includes(pkgName),
  )

  if (matchedModule?.npm) {
    pkgName = matchedModule.npm
  }

  if (matchedModule && matchedModule.compatibility.nuxt) {
    // Get local Nuxt version
    const nuxtVersion = await getNuxtVersion(cwd)

    // Check for Module Compatibility
    if (!checkNuxtCompatibility(matchedModule, nuxtVersion)) {
      consola.warn(
        `The module \`${pkgName}\` is not compatible with Nuxt \`${nuxtVersion}\` (requires \`${matchedModule.compatibility.nuxt}\`)`,
      )
      const shouldContinue = await consola.prompt(
        'Do you want to continue installing incompatible version?',
        {
          type: 'confirm',
          initial: false,
        },
      )
      if (shouldContinue !== true) {
        return false
      }
    }

    // Match corresponding version of module for local Nuxt version
    const versionMap = matchedModule.compatibility.versionMap
    if (versionMap) {
      for (const [_nuxtVersion, _moduleVersion] of Object.entries(versionMap)) {
        if (satisfies(nuxtVersion, _nuxtVersion)) {
          if (!pkgVersion) {
            pkgVersion = _moduleVersion
          } else {
            consola.warn(
              `Recommended version of \`${pkgName}\` for Nuxt \`${nuxtVersion}\` is \`${_moduleVersion}\` but you have requested \`${pkgVersion}\``,
            )
            pkgVersion = await consola.prompt('Choose a version:', {
              type: 'select',
              options: [_moduleVersion, pkgVersion],
            })
          }
          break
        }
      }
    }
  }

  // Fetch package on npm
  pkgVersion = pkgVersion || 'latest'
  const pkg = await $fetch(
    `https://registry.npmjs.org/${pkgName}/${pkgVersion}`,
  )
  const pkgDependencies = Object.assign(
    pkg.dependencies || {},
    pkg.devDependencies || {},
  )
  if (
    !pkgDependencies['nuxt'] &&
    !pkgDependencies['nuxt-edge'] &&
    !pkgDependencies['@nuxt/kit']
  ) {
    consola.warn(`It seems that \`${pkgName}\` is not a Nuxt module.`)
    const shouldContinue = await consola.prompt(
      `Do you want to continue installing \`${pkgName}\` anyway?`,
      {
        type: 'confirm',
        initial: false,
      },
    )
    if (shouldContinue !== true) {
      return false
    }
  }

  return {
    nuxtModule: matchedModule,
    pkg: `${pkgName}@${pkgVersion}`,
    pkgName,
    pkgVersion,
  }
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest
  describe('add', () => {
    it('should add a module', async () => {
      const ctx = {
        args: {
          moduleName: 'nuxt-content',
          skipInstall: true,
          skipConfig: true,
        },
      }
      await resolveModule(ctx.args.moduleName, './playground')
    })
  })
}
