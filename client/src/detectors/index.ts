import type { Detector } from "../lib/detector";
import { isTrusted, superhumanSubmit } from "./interaction/isTrusted";
import { cdpMouseLeak, mouseEntropy } from "./interaction/mouse";
import { suspiciousClientSideBehavior } from "./interaction/suspicious";
import { pasteVsType, typingCadence } from "./interaction/typing";
import { automationGlobals } from "./static/automationGlobals";
import { cdpConsoleTiming, cdpRuntimeLeak, cdpStackTrace } from "./static/cdp";
import { clientHints } from "./static/clientHints";
import { fingerprint } from "./static/fingerprint";
import { headlessSignals } from "./static/headless";
import { iframeWorkerConsistency } from "./static/iframeWorker";
import { permissionsMismatch } from "./static/permissions";
import { prototypeLies } from "./static/prototypeLies";
import { webdriver } from "./static/webdriver";
import { webglVendor } from "./static/webgl";

export const staticDetectors: Detector[] = [
  webdriver,
  automationGlobals,
  cdpRuntimeLeak,
  cdpStackTrace,
  cdpConsoleTiming,
  headlessSignals,
  clientHints,
  webglVendor,
  prototypeLies,
  iframeWorkerConsistency,
  permissionsMismatch,
  fingerprint,
];

export const interactionDetectors: Detector[] = [
  suspiciousClientSideBehavior,
  isTrusted,
  cdpMouseLeak,
  mouseEntropy,
  typingCadence,
  pasteVsType,
  superhumanSubmit,
];
