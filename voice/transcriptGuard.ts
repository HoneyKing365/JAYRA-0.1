const SINGLE_WORD_INTENTS = new Set([
  "cancel", "continue", "done", "help", "hello", "pause", "resume", "stop", "thanks", "undo",
  "yes", "no",
]);

const ACTION_VERB = /(?:ask|bring|call|change|check|click|close|compare|create|delete|disable|download|enable|find|go|help|launch|list|look|make|minimize|move|open|play|press|read|remove|rename|run|save|search|send|set|show|start|stop|tell|turn|type|update|write)/i;
const ACTION_INTENT = new RegExp(
  `^(?:(?:hey|hello|hi|jayra|please|um|uh|okay|ok|so|well)\\s+)*(?:(?:can|could|would|will)\\s+you\\s+)?${ACTION_VERB.source}\\b\\s+(?!${ACTION_VERB.source}\\b)[a-z0-9][a-z0-9'-]*`,
  "i",
);
const ACTION_REQUEST = new RegExp(`^(?:(?:hey|hello|hi|jayra)\\s+)*(?:please\\s+)?${ACTION_VERB.source}\\b`, "i");
const QUESTION_OR_REQUEST = /^(?:(?:hey|hello|hi|jayra)\s+)*(?:can|could|would|will|should|what|when|where|which|who|why|how|tell me|do you|is there|are there)\b/i;
const SENTENCE_SHAPE = /\b(?:i|we|you|he|she|it|they|this|that|there|my|our|your)\b.{0,100}\b(?:am|is|are|was|were|do|does|did|can|could|would|should|will|have|has|having|had|need|want|think|know|see|feel|looks|seems|working|happening)\b/i;

export function isPlausibleVoiceTranscript(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase().replace(/[^a-z0-9'\s]/g, " ").replace(/\s+/g, " ");
  if (!normalized || normalized.length > 1_000) return false;
  if (isVoiceActionIntent(normalized)) return true;

  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 1) return SINGLE_WORD_INTENTS.has(words[0]);
  if (words.length < 2) return false;

  const distinctWords = new Set(words);
  if (words.length >= 4 && distinctWords.size / words.length < 0.4) return false;
  return ACTION_REQUEST.test(normalized)
    || QUESTION_OR_REQUEST.test(normalized)
    || SENTENCE_SHAPE.test(normalized);
}

export function isVoiceActionIntent(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase().replace(/[^a-z0-9'\s]/g, " ").replace(/\s+/g, " ");
  return normalized.length > 1 && normalized.length <= 1_000 && ACTION_INTENT.test(normalized);
}
