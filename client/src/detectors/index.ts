import type { Detector } from "../lib/detector";
import { clickTeleport } from "./interaction/clickTeleport";
import { delayedButton } from "./interaction/delayedButton";
import { exactCenterClick } from "./interaction/exactCenterClick";
import { gridChallenge } from "./interaction/gridChallenge";
import { honeypot } from "./interaction/honeypot";
import { isTrusted, superhumanSubmit } from "./interaction/isTrusted";
import { keyboardDynamics } from "./interaction/keyboardDynamics";
import { cdpMouseLeak, mouseEntropy } from "./interaction/mouse";
import { mouseKinematics } from "./interaction/mouseKinematics";
import { scrollDynamics } from "./interaction/scrollDynamics";
import { shiftKeyConsistency } from "./interaction/shiftKeyConsistency";
import { sliderDrag } from "./interaction/sliderDrag";
import { suspiciousClientSideBehavior } from "./interaction/suspicious";
import { pasteVsType, typingCadence } from "./interaction/typing";
import { audioFingerprint } from "./static/audio";
import { automationGlobals } from "./static/automationGlobals";
import { batteryApi } from "./static/batteryApi";
import { canvasRender } from "./static/canvasRender";
import { cdpRuntimeLeak, cdpStackTrace } from "./static/cdp";
import { clientHints } from "./static/clientHints";
import { cspBypass } from "./static/cspBypass";
import { domRect } from "./static/domRect";
import { electronDetection } from "./static/electron";
import { engineCoherence } from "./static/engineCoherence";
import { exposeFunctionLeak } from "./static/exposeFunctionLeak";
import { fingerprint } from "./static/fingerprint";
import { fonts } from "./static/fonts";
import { headlessSignals } from "./static/headless";
import { iframeWorkerConsistency } from "./static/iframeWorker";
import { localeTimezone } from "./static/localeTimezone";
import { mainWorldExecution } from "./static/mainWorldExecution";
import { mediaCodecs } from "./static/mediaCodecs";
import { nativeToString } from "./static/nativeToString";
import { permissionsMismatch } from "./static/permissions";
import { pointerCapabilities } from "./static/pointerCapabilities";
import { screenAnomalies } from "./static/screenAnomalies";
import { speechVoices } from "./static/speechVoices";
import { webdriver } from "./static/webdriver";
import { webglVendor } from "./static/webgl";
import { webgl2Params } from "./static/webgl2Params";
import { webrtcLeak } from "./static/webrtc";

export const staticDetectors: Detector[] = [
  // automation / CDP traces
  webdriver,
  automationGlobals,
  cdpRuntimeLeak,
  cdpStackTrace,
  cspBypass,
  nativeToString,
  exposeFunctionLeak,
  mainWorldExecution,
  electronDetection,
  // headless / environment tells
  headlessSignals,
  engineCoherence,
  clientHints,
  screenAnomalies,
  speechVoices,
  mediaCodecs,
  pointerCapabilities,
  localeTimezone,
  batteryApi,
  permissionsMismatch,
  // rendering / lies
  webglVendor,
  webgl2Params,
  canvasRender,
  domRect,
  iframeWorkerConsistency,
  // fingerprint surfaces
  fingerprint,
  audioFingerprint,
  fonts,
  webrtcLeak,
];

export const interactionDetectors: Detector[] = [
  honeypot, // decisive: touched a human-invisible control
  gridChallenge, // motion between ordered tile clicks
  sliderDrag, // drag kinematics to a target
  delayedButton, // react to a visual state change
  suspiciousClientSideBehavior,
  isTrusted,
  shiftKeyConsistency, // KILLER: physically impossible keystroke
  exactCenterClick, // hard physical tell: pixel-perfect centroid click
  cdpMouseLeak,
  mouseEntropy,
  mouseKinematics,
  clickTeleport,
  scrollDynamics,
  typingCadence,
  keyboardDynamics,
  pasteVsType,
  superhumanSubmit,
];
