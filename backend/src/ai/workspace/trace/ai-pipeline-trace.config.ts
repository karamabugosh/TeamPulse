/**
 * Server-side controls for AI pipeline trace exposure.
 * Trace content is always sanitized — never includes secrets or raw private text.
 */
export type AiPipelineTraceMode = 'full' | 'minimal' | 'off';

export function getAiPipelineTraceMode(): AiPipelineTraceMode {
  const raw = (process.env.PULSE_AI_TRACE_MODE ?? 'full').trim().toLowerCase();
  if (raw === 'off' || raw === 'false' || raw === '0') return 'off';
  if (raw === 'minimal') return 'minimal';
  return 'full';
}

export function isAiPipelineTraceEnabled(): boolean {
  return getAiPipelineTraceMode() !== 'off';
}
