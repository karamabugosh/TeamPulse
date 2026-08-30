/**
 * UI display flags for AI Workspace chat.
 */
export function showAiChatSources(): boolean {
  const raw = String(import.meta.env.VITE_SHOW_AI_SOURCES ?? 'false')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/** Show AI Pipeline Trace panel (developer/admin diagnostics). */
export function showAiPipelineTrace(): boolean {
  const raw = String(import.meta.env.VITE_SHOW_AI_TRACE ?? 'true')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}
