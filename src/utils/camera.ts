import type { ApiVisionMode } from '../types/vision';

let analysisCanvas: HTMLCanvasElement | null = null;

function getAnalysisCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (!analysisCanvas) {
    analysisCanvas = document.createElement('canvas');
  }
  return analysisCanvas;
}

interface ContentProfile {
  edgeComplexity: number;
  contrastSpread: number;
}

/**
 * Samples a fast 80px-wide grayscale proxy of the video frame to measure
 * visual edge density and luminance contrast.
 */
function analyzeFrameContents(
  video: HTMLVideoElement,
  srcWidth: number,
  srcHeight: number
): ContentProfile {
  const probeCanvas = getAnalysisCanvas();
  if (!probeCanvas) {
    return { edgeComplexity: 12, contrastSpread: 40 };
  }

  const probeW = 80;
  const probeH = Math.max(1, Math.round((srcHeight / srcWidth) * probeW));
  probeCanvas.width = probeW;
  probeCanvas.height = probeH;

  const ctx = probeCanvas.getContext('2d', {
    alpha: false,
    willReadFrequently: true,
  });
  if (!ctx) {
    return { edgeComplexity: 12, contrastSpread: 40 };
  }

  ctx.drawImage(video, 0, 0, probeW, probeH);
  const { data } = ctx.getImageData(0, 0, probeW, probeH);

  const pixelCount = probeW * probeH;
  const luma = new Float32Array(pixelCount);

  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * 4;
    const y =
      0.299 * data[offset] +
      0.587 * data[offset + 1] +
      0.114 * data[offset + 2];
    luma[i] = y;
    sum += y;
    sumSq += y * y;
  }

  const mean = sum / pixelCount;
  const variance = Math.max(0, sumSq / pixelCount - mean * mean);
  const contrastSpread = Math.sqrt(variance);

  let edgeSum = 0;
  let edgeSamples = 0;
  for (let y = 0; y < probeH - 1; y += 1) {
    const rowOffset = y * probeW;
    for (let x = 0; x < probeW - 1; x += 1) {
      const idx = rowOffset + x;
      const dx = Math.abs(luma[idx] - luma[idx + 1]);
      const dy = Math.abs(luma[idx] - luma[idx + probeW]);
      edgeSum += dx + dy;
      edgeSamples += 2;
    }
  }

  const edgeComplexity = edgeSamples > 0 ? edgeSum / edgeSamples : 12;
  return { edgeComplexity, contrastSpread };
}

function chooseCompressionParams(
  mode: ApiVisionMode,
  profile: ContentProfile
): { maxWidth: number; quality: number; maxBase64Chars: number } {
  const { edgeComplexity, contrastSpread } = profile;

  // Read mode requires sharper text edges unless frame is nearly blank/uniform
  if (mode === 'read') {
    if (edgeComplexity < 4.5 && contrastSpread < 18) {
      return { maxWidth: 384, quality: 0.6, maxBase64Chars: 38000 };
    }
    return { maxWidth: 512, quality: 0.8, maxBase64Chars: 75000 };
  }

  // Uniform / blank wall / dark or covered camera: ultra-lightweight payload
  if (edgeComplexity < 5.5 && contrastSpread < 22) {
    return { maxWidth: 288, quality: 0.48, maxBase64Chars: 20000 };
  }

  // Moderate scene complexity (typical hallway, room, furniture)
  if (edgeComplexity < 14) {
    return { maxWidth: 352, quality: 0.58, maxBase64Chars: 32000 };
  }

  // Dense / detailed scene (crowded street, stairs, complex signage or small target)
  return { maxWidth: 416, quality: 0.65, maxBase64Chars: 44000 };
}

/**
 * Captures the current video frame onto an offscreen canvas, analyzes its
 * visual complexity, downscales to at most 512px wide, and compresses to JPEG
 * adaptively based on scene contents and active mode for faster processing.
 */
export function captureDownscaledFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  mode: ApiVisionMode = 'describe'
): string | null {
  const srcWidth = video.videoWidth;
  const srcHeight = video.videoHeight;

  if (!srcWidth || !srcHeight || video.readyState < 2) {
    return null;
  }

  const profile = analyzeFrameContents(video, srcWidth, srcHeight);
  const { maxWidth, quality, maxBase64Chars } = chooseCompressionParams(
    mode,
    profile
  );

  const targetWidth = Math.min(srcWidth, maxWidth, 512);
  const scale = targetWidth / srcWidth;
  const targetHeight = Math.max(1, Math.round(srcHeight * scale));

  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

  const encode = (q: number) => {
    const dataUrl = canvas.toDataURL('image/jpeg', q);
    const commaIdx = dataUrl.indexOf(',');
    return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  };

  let base64 = encode(quality);

  // Guard against low-light sensor noise bloating JPEG payload size
  if (base64.length > maxBase64Chars) {
    base64 = encode(Math.max(0.45, quality - 0.14));
  }

  return base64;
}

export interface SceneSignature {
  blocks: Float32Array;
  meanLuma: number;
}

let signatureCanvas: HTMLCanvasElement | null = null;

function getSignatureCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (!signatureCanvas) {
    signatureCanvas = document.createElement('canvas');
  }
  return signatureCanvas;
}

/**
 * Downsamples the current video frame into a 20x15 block-averaged luminance
 * grid (~300 zones). Box-filtering absorbs minor hand tremor while holding
 * the phone while remaining sensitive to camera turns and approaching obstacles.
 */
export function computeSceneSignature(
  video: HTMLVideoElement
): SceneSignature | null {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
    return null;
  }

  const sigCanvas = getSignatureCanvas();
  if (!sigCanvas) return null;

  const cols = 20;
  const rows = 15;
  sigCanvas.width = cols;
  sigCanvas.height = rows;

  const ctx = sigCanvas.getContext('2d', {
    alpha: false,
    willReadFrequently: true,
  });
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, cols, rows);
  const { data } = ctx.getImageData(0, 0, cols, rows);

  const count = cols * rows;
  const blocks = new Float32Array(count);
  let sum = 0;

  for (let i = 0; i < count; i += 1) {
    const offset = i * 4;
    const y =
      0.299 * data[offset] +
      0.587 * data[offset + 1] +
      0.114 * data[offset + 2];
    blocks[i] = y;
    sum += y;
  }

  return {
    blocks,
    meanLuma: sum / count,
  };
}

/**
 * Returns true when the scene has shifted significantly compared to the
 * previous analyzed frame, ignoring minor hand-holding micro-movements.
 */
export function hasSignificantSceneChange(
  prev: SceneSignature | null,
  next: SceneSignature
): boolean {
  if (!prev || prev.blocks.length !== next.blocks.length) {
    return true;
  }

  const globalLumaDelta = Math.abs(next.meanLuma - prev.meanLuma);
  if (globalLumaDelta >= 22) {
    return true;
  }

  const count = next.blocks.length;
  let sumDiff = 0;
  let changedBlocks = 0;

  for (let i = 0; i < count; i += 1) {
    const prevCentered = prev.blocks[i] - prev.meanLuma;
    const nextCentered = next.blocks[i] - next.meanLuma;
    const diff = Math.abs(nextCentered - prevCentered);
    sumDiff += diff;
    if (diff >= 15) {
      changedBlocks += 1;
    }
  }

  const changedRatio = changedBlocks / count;
  const meanStructuralDiff = sumDiff / count;

  return changedRatio >= 0.16 || meanStructuralDiff >= 10;
}

const ULTRA_WIDE_LABEL_RE =
  /ultra\s*-?\s*wide|0\.5x?|fisheye|super\s*wide/i;
const MULTI_WIDE_LABEL_RE = /triple\s*camera|dual\s*wide/i;
const FRONT_LABEL_RE = /front|facetime|selfie|user/i;
const EXCLUDED_REAR_RE = /telephoto|macro|depth|infrared|\bir\b|bokeh/i;

function scoreRearUltraWideDevice(label: string): number {
  const lower = label.toLowerCase();
  if (!lower) return 0;
  if (FRONT_LABEL_RE.test(lower)) return -1000;
  if (EXCLUDED_REAR_RE.test(lower)) return -200;

  let score = 0;
  if (ULTRA_WIDE_LABEL_RE.test(lower)) {
    score += 120;
  } else if (MULTI_WIDE_LABEL_RE.test(lower)) {
    score += 75;
  }

  if (/back|rear|environment/i.test(lower)) {
    score += 30;
  }
  return score;
}

async function applyUltraWideZoomIfSupported(
  stream: MediaStream
): Promise<boolean> {
  const track = stream.getVideoTracks()[0];
  if (!track || typeof track.getCapabilities !== 'function') {
    return false;
  }

  try {
    const caps = track.getCapabilities() as MediaTrackCapabilities & {
      zoom?: { min?: number; max?: number; step?: number };
    };
    if (
      caps.zoom &&
      typeof caps.zoom.min === 'number' &&
      caps.zoom.min < 0.95
    ) {
      const targetZoom = Math.max(caps.zoom.min, 0.5);
      await track.applyConstraints({
        advanced: [{ zoom: targetZoom } as MediaTrackConstraintSet],
      });
      return true;
    }
  } catch {
    // Ignore zoom constraint failures on browsers/drivers that disallow it
  }

  return false;
}

async function findBestRearUltraWideDevice(): Promise<MediaDeviceInfo | null> {
  if (typeof navigator.mediaDevices.enumerateDevices !== 'function') {
    return null;
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  let bestDevice: MediaDeviceInfo | null = null;
  let bestScore = 0;

  for (const device of devices) {
    if (device.kind !== 'videoinput' || !device.deviceId || !device.label) {
      continue;
    }
    const score = scoreRearUltraWideDevice(device.label);
    if (score >= 75 && score > bestScore) {
      bestScore = score;
      bestDevice = device;
    }
  }

  return bestDevice;
}

/**
 * Opens the preferred camera stream:
 * - For rear ('environment'): automatically selects the 0.5x ultra-wide camera
 *   on iOS/Android when available (via Back Ultra Wide device label or optical
 *   zoom capability < 1.0) for wider spatial perception.
 * - For front ('user'): opens the front camera or cycles available inputs.
 */
export async function openPreferredCameraStream(
  targetFacing: 'environment' | 'user',
  previousDeviceId?: string,
  useExact = false
): Promise<{ stream: MediaStream; isUltraWide: boolean }> {
  if (targetFacing === 'environment') {
    // Fast path when permissions were already granted and ultra-wide label is known
    const knownWide = await findBestRearUltraWideDevice();
    if (knownWide) {
      try {
        const wideStream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: knownWide.deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        const zoomed = await applyUltraWideZoomIfSupported(wideStream);
        const label = wideStream.getVideoTracks()[0]?.label || knownWide.label;
        return {
          stream: wideStream,
          isUltraWide: zoomed || ULTRA_WIDE_LABEL_RE.test(label),
        };
      } catch {
        // Fall through to standard facingMode open
      }
    }
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: useExact ? { exact: targetFacing } : { ideal: targetFacing },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
  } catch {
    let cycledStream: MediaStream | null = null;
    if (typeof navigator.mediaDevices.enumerateDevices === 'function') {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      const nextDevice = videoInputs.find(
        (d) => d.deviceId && d.deviceId !== previousDeviceId
      );
      if (nextDevice) {
        cycledStream = await navigator.mediaDevices
          .getUserMedia({
            video: {
              deviceId: { exact: nextDevice.deviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          })
          .catch(() => null);
      }
    }

    stream =
      cycledStream ||
      (await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      }));
  }

  if (targetFacing === 'user') {
    return { stream, isUltraWide: false };
  }

  // After initial permission grant, labels become available: upgrade to 0.5x ultra-wide if present
  const activeTrack = stream.getVideoTracks()[0];
  const activeDeviceId = activeTrack?.getSettings?.()?.deviceId;
  const postGrantWide = await findBestRearUltraWideDevice();

  if (postGrantWide && postGrantWide.deviceId !== activeDeviceId) {
    stream.getTracks().forEach((t) => t.stop());
    try {
      const wideStream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: postGrantWide.deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      const zoomed = await applyUltraWideZoomIfSupported(wideStream);
      const label = wideStream.getVideoTracks()[0]?.label || postGrantWide.label;
      return {
        stream: wideStream,
        isUltraWide: zoomed || ULTRA_WIDE_LABEL_RE.test(label),
      };
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: useExact ? { exact: targetFacing } : { ideal: targetFacing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
    }
  }

  const currentTrack = stream.getVideoTracks()[0];
  const zoomed = await applyUltraWideZoomIfSupported(stream);
  const activeLabel = currentTrack?.label || '';
  return {
    stream,
    isUltraWide: zoomed || ULTRA_WIDE_LABEL_RE.test(activeLabel),
  };
}


