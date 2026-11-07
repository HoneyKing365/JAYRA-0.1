import type { AppSettings } from "../settings/appSettings";

export type AssistantLanguage = AppSettings["localization"]["language"];
export type ScriptStyle = AppSettings["localization"]["scriptStyle"];
export type SummaryLanguage = AppSettings["localization"]["summaryLanguage"];

export function buildLocalizationInstructions(localization?: AppSettings["localization"]): string {
  if (!localization) {
    return [
      "LANGUAGE & LOCALIZATION (DEFAULT):",
      "- Default to English. When the user speaks Urdu or Hindi/Hinglish, you may match their language seamlessly using Latin script (Roman Urdu / Roman Hindi).",
      "- Keep replies natural, concise, and expressive.",
    ].join("\n");
  }

  const lang = localization.language || "en";
  const scriptStyle = localization.scriptStyle || "latin";
  const lines: string[] = ["USER LANGUAGE & SCRIPT PREFERENCE:"];

  switch (lang) {
    case "roman_urdu":
      lines.push(
        "- PRIMARY LANGUAGE: Roman Urdu (Urdu written phonetically using the Latin alphabet).",
        "- Speak and write primarily in natural, friendly Roman Urdu (e.g., 'Haan main dekh rahi hoon', 'Aaj aapne 3 ghante code kiya hai', 'Main task verify kar leti hoon').",
        "- Keep vocabulary conversational, warm, and natural — just like everyday chat. Avoid difficult formal Arabicized words.",
        "- Do NOT output Nastaliq/Arabic script unless explicitly asked; ALWAYS write in Roman/Latin script for instant readability on HUD and TTS.",
      );
      break;

    case "roman_hindi":
      lines.push(
        "- PRIMARY LANGUAGE: Roman Hindi / Hinglish (Hindi written phonetically using the Latin alphabet).",
        "- Speak and write primarily in natural, conversational Roman Hindi / Hinglish (e.g., 'Haan ji, main check kar rahi hoon', 'Aaj ka session kafi productive raha', 'Task complete ho gaya hai').",
        "- Blend natural tech terminology in English with everyday Hindi phrasing.",
        "- Do NOT output Devanagari script unless explicitly asked; ALWAYS write in Roman/Latin script.",
      );
      break;

    case "custom_script":
      lines.push(
        "- PRIMARY LANGUAGE & SCRIPT (CUSTOM USER DIRECTIVE):",
        localization.customPrompt.trim()
          ? `  "${localization.customPrompt.trim()}"`
          : "  Follow the user's custom dialect preference with Latin alphabet transliteration.",
      );
      break;

    case "en":
    default:
      lines.push(
        "- PRIMARY LANGUAGE: English.",
        "- Speak and articulate in natural, clear English.",
        "- If the user addresses you in Roman Urdu or Hindi, you may respond in kind or acknowledge in English according to context.",
      );
      break;
  }

  if (scriptStyle === "latin") {
    lines.push("- SCRIPT RULE: Strictly use Latin (Roman) alphabet. Do not render non-ASCII scripts unless specifically commanded.");
  } else if (scriptStyle === "native") {
    lines.push("- SCRIPT RULE: You may use native script (Urdu or Devanagari) when specifically requested by the user.");
  } else if (scriptStyle === "mixed") {
    lines.push("- SCRIPT RULE: Mixed script allowed; provide Roman transliteration when helpful.");
  }

  return lines.join("\n");
}

