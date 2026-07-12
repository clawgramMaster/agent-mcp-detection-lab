import type { Detector } from "../lib/detector";
import { clickTeleport } from "./interaction/clickTeleport";
import { exactCenterClick } from "./interaction/exactCenterClick";
import { isTrusted, superhumanSubmit } from "./interaction/isTrusted";
import { keyboardDynamics } from "./interaction/keyboardDynamics";
import { cdpMouseLeak, mouseEntropy } from "./interaction/mouse";
import { shiftKeyConsistency } from "./interaction/shiftKeyConsistency";
import { suspiciousClientSideBehavior } from "./interaction/suspicious";
import { pasteVsType, typingCadence } from "./interaction/typing";
import { audioFingerprint } from "./static/audio";
import { automationGlobals } from "./static/automationGlobals";
import { cdpRuntimeLeak, cdpStackTrace } from "./static/cdp";
import { clientHints } from "./static/clientHints";
import { fingerprint } from "./static/fingerprint";
import { fonts } from "./static/fonts";
import { headlessSignals } from "./static/headless";
import { iframeWorkerConsistency } from "./static/iframeWorker";
import { permissionsMismatch } from "./static/permissions";
import { prototypeLies } from "./static/prototypeLies";
import { screenAnomalies } from "./static/screenAnomalies";
import { speechVoices } from "./static/speechVoices";
import { webdriver } from "./static/webdriver";
import { webglVendor } from "./static/webgl";
import { webrtcLeak } from "./static/webrtc";

export const staticDetectors: Detector[] = [
  // automation / CDP traces
  webdriver,
  automationGlobals,
  cdpRuntimeLeak,
  cdpStackTrace,
  // headless / environment tells
  headlessSignals,
  clientHints,
  screenAnomalies,
  speechVoices,
  permissionsMismatch,
  // rendering / lies
  webglVendor,
  prototypeLies,
  iframeWorkerConsistency,
  // fingerprint surfaces
  fingerprint,
  audioFingerprint,
  fonts,
  webrtcLeak,
];

export const interactionDetectors: Detector[] = [
  suspiciousClientSideBehavior,
  isTrusted,
  shiftKeyConsistency, // KILLER: physically impossible keystroke
  exactCenterClick, // hard physical tell: pixel-perfect centroid click
  cdpMouseLeak,
  mouseEntropy,
  clickTeleport,
  typingCadence,
  keyboardDynamics,
  pasteVsType,
  superhumanSubmit,
];
