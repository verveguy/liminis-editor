/**
 * Shared MathJax v4 configuration module.
 * Provides centralized TeX package imports and factory functions for creating
 * MathJax documents with either liteAdaptor (server/export) or browserAdaptor (desktop).
 *
 * All TeX packages are bundled explicitly for full offline support in Electron and mobile.
 */

// Import ESM async loader for proper ESM support
import '@mathjax/src/js/util/asyncLoad/esm.js'

// Core MathJax imports
import { mathjax } from '@mathjax/src/js/mathjax.js'
import { TeX } from '@mathjax/src/js/input/tex.js'
import { SVG } from '@mathjax/src/js/output/svg.js'
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js'

// Adaptor imports (static ESM, not require())
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js'
import { browserAdaptor } from '@mathjax/src/js/adaptors/browserAdaptor.js'
import type { LiteElement } from '@mathjax/src/js/adaptors/lite/Element.js'

// Import all TeX package configurations explicitly
// These side-effect imports register the packages with the TeX parser
// NOTE: File names must match the exact CamelCase used in @mathjax/src v4
import '@mathjax/src/js/input/tex/action/ActionConfiguration.js'
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js'
import '@mathjax/src/js/input/tex/amscd/AmsCdConfiguration.js'
import '@mathjax/src/js/input/tex/autoload/AutoloadConfiguration.js'
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js'
import '@mathjax/src/js/input/tex/bbox/BboxConfiguration.js'
import '@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js'
import '@mathjax/src/js/input/tex/braket/BraketConfiguration.js'
import '@mathjax/src/js/input/tex/bussproofs/BussproofsConfiguration.js'
import '@mathjax/src/js/input/tex/cancel/CancelConfiguration.js'
import '@mathjax/src/js/input/tex/centernot/CenternotConfiguration.js'
import '@mathjax/src/js/input/tex/color/ColorConfiguration.js'
import '@mathjax/src/js/input/tex/colortbl/ColortblConfiguration.js'
import '@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js'
import '@mathjax/src/js/input/tex/empheq/EmpheqConfiguration.js'
import '@mathjax/src/js/input/tex/enclose/EncloseConfiguration.js'
import '@mathjax/src/js/input/tex/extpfeil/ExtpfeilConfiguration.js'
import '@mathjax/src/js/input/tex/gensymb/GensymbConfiguration.js'
import '@mathjax/src/js/input/tex/html/HtmlConfiguration.js'
import '@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js'
import '@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js'
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js'
import '@mathjax/src/js/input/tex/noerrors/NoErrorsConfiguration.js'
import '@mathjax/src/js/input/tex/noundefined/NoUndefinedConfiguration.js'
import '@mathjax/src/js/input/tex/physics/PhysicsConfiguration.js'
import '@mathjax/src/js/input/tex/require/RequireConfiguration.js'
import '@mathjax/src/js/input/tex/setoptions/SetOptionsConfiguration.js'
import '@mathjax/src/js/input/tex/tagformat/TagFormatConfiguration.js'
import '@mathjax/src/js/input/tex/textcomp/TextcompConfiguration.js'
import '@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js'
import '@mathjax/src/js/input/tex/unicode/UnicodeConfiguration.js'
import '@mathjax/src/js/input/tex/verb/VerbConfiguration.js'

/**
 * All TeX packages bundled for offline support.
 * These correspond to the package configurations imported above.
 */
export const TEX_PACKAGES = [
  'base',
  'ams',
  'newcommand',
  'require',
  'autoload',
  'configmacros',
  'action',
  'amscd',
  'bbox',
  'boldsymbol',
  'braket',
  'bussproofs',
  'cancel',
  'centernot',
  'color',
  'colortbl',
  'empheq',
  'enclose',
  'extpfeil',
  'gensymb',
  'html',
  'mathtools',
  'mhchem',
  'noerrors',
  'noundefined',
  'physics',
  'setoptions',
  'tagformat',
  'textcomp',
  'textmacros',
  'unicode',
  'verb',
] as const

export type TeXPackage = (typeof TEX_PACKAGES)[number]

/**
 * MathJax document type, generic over the node type produced by convert().
 * TNode depends on the adaptor: LiteElement for liteAdaptor, HTMLElement for browserAdaptor.
 */
export interface MathDocument<TNode> {
  convert(
    expression: string,
    options?: { display?: boolean }
  ): TNode
}

/**
 * Result of creating a liteAdaptor MathJax instance.
 * Returning both ensures callers use a single adaptor instance.
 */
export interface LiteMathJaxInstance {
  adaptor: ReturnType<typeof liteAdaptor>
  document: MathDocument<LiteElement>
}

/**
 * Result of creating a browserAdaptor MathJax instance.
 */
export interface BrowserMathJaxInstance {
  adaptor: ReturnType<typeof browserAdaptor>
  document: MathDocument<HTMLElement>
}

interface LiteAdaptorDocumentOptions {
  fontCache?: 'none' | 'local' | 'global'
}

/**
 * Track if handlers have been registered to avoid duplicate registration.
 */
let liteHandlerRegistered = false
let browserHandlerRegistered = false

/**
 * Create a MathJax adaptor+document configured for liteAdaptor (server-side/export).
 * Used by routes.ts (mobile API) and EquationNode.tsx (DOM export).
 * Returns both adaptor and document to avoid duplicate adaptor creation.
 */
export function createLiteAdaptorDocument(
  options: LiteAdaptorDocumentOptions = {}
): LiteMathJaxInstance {
  const adaptor = liteAdaptor()

  if (!liteHandlerRegistered) {
    RegisterHTMLHandler(adaptor)
    liteHandlerRegistered = true
  }

  return {
    adaptor,
    document: mathjax.document('', {
      InputJax: new TeX({ packages: TEX_PACKAGES.slice() }),
      OutputJax: new SVG({ fontCache: options.fontCache ?? 'none' }),
    }) as MathDocument<LiteElement>,
  }
}

/**
 * Create a MathJax adaptor+document configured for browserAdaptor (desktop rendering).
 * Used by EquationComponent.tsx for live equation rendering.
 * Returns both adaptor and document to avoid duplicate adaptor creation.
 */
export function createBrowserAdaptorDocument(
  targetDocument: Document
): BrowserMathJaxInstance {
  const adaptor = browserAdaptor()

  if (!browserHandlerRegistered) {
    RegisterHTMLHandler(adaptor)
    browserHandlerRegistered = true
  }

  return {
    adaptor,
    document: mathjax.document(targetDocument, {
      InputJax: new TeX({ packages: TEX_PACKAGES.slice() }),
      OutputJax: new SVG({ fontCache: 'local' }),
    }) as MathDocument<HTMLElement>,
  }
}
