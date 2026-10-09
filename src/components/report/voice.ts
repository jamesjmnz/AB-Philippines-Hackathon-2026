/**
 * Best-effort voice capture. `expo-audio` is loaded and the microphone permission is requested only
 * when the person taps record, so nothing on the SOS path can ever trigger a permission prompt.
 */
export type Recording = { stop(): Promise<string | null> };

export type StartResult = { ok: true; recording: Recording } | { ok: false; reason: 'permission_denied' | 'recorder_failed' };

export async function startRecording(): Promise<StartResult> {
  try {
    const audio = await import('expo-audio');
    const permission = await audio.requestRecordingPermissionsAsync();
    if (!permission.granted) return { ok: false, reason: 'permission_denied' };
    await audio.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    // 16 kHz mono 16-bit PCM in a WAV container: what on-device transcription expects.
    const recorder = new audio.AudioModule.AudioRecorder({
      extension: '.wav',
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 256000,
      ios: {
        outputFormat: audio.IOSOutputFormat.LINEARPCM,
        audioQuality: audio.AudioQuality.HIGH,
        linearPCMBitDepth: 16,
        linearPCMIsBigEndian: false,
        linearPCMIsFloat: false,
      },
    });
    await recorder.prepareToRecordAsync();
    recorder.record();
    return {
      ok: true,
      recording: {
        async stop() {
          try {
            await recorder.stop();
            const uri = recorder.uri;
            recorder.release();
            await audio.setAudioModeAsync({ allowsRecording: false });
            return uri;
          } catch {
            return null;
          }
        },
      },
    };
  } catch {
    return { ok: false, reason: 'recorder_failed' };
  }
}
