import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type RefObject } from "react";
import { AudioLines, Clock3, Mic, MicOff, Plus, Radio, Send, Trash2, X } from "lucide-react";
import type { LiveState } from "../lib/audio";

interface DockMessage {
  id: string;
  role: "user" | "model";
  text: string;
  at: number;
  attachments?: Array<{ name: string; content: string }>;
}

interface SavedChat {
  id: string;
  title: string;
  updatedAt: number;
  messages: DockMessage[];
}

interface TranscriptUpdate {
  id: number;
  role: "user" | "model";
  text: string;
}

interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
  resultIndex: number;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

const STORAGE_KEY = "jayra.chat-sessions.v1";

function readSavedChats(): SavedChat[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((chat): chat is SavedChat =>
      chat && typeof chat.id === "string" && typeof chat.title === "string" &&
      typeof chat.updatedAt === "number" && Array.isArray(chat.messages),
    );
  } catch (error) {
    console.error("[FloatingChatDock] Could not load saved conversations:", error);
    return [];
  }
}

interface FloatingChatDockProps {
  mode: "live" | "history";
  liveState: LiveState;
  inputValue: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onInputChange(value: string): void;
  onSend(text: string, context?: string, attachments?: Array<{ name: string; content: string }>): void | Promise<void>;
  onToggleLive(): void;
  onSessionSwitch(): void;
  onModeChange(mode: "live" | "history"): void;
  onVoicePreviewChange(active: boolean): void;
  onError(message: string): void;
  transcriptUpdate: TranscriptUpdate | null;
}

export function FloatingChatDock({
  mode,
  liveState,
  inputValue,
  inputRef,
  onInputChange,
  onSend,
  onToggleLive,
  onSessionSwitch,
  onModeChange,
  onVoicePreviewChange,
  onError,
  transcriptUpdate,
}: FloatingChatDockProps) {
  const [chats, setChats] = useState<SavedChat[]>(readSavedChats);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isListeningForText, setIsListeningForText] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Array<{ name: string; content: string }>>([]);
  const logRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldListenRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const transcriptDraftRef = useRef("");
  const finalTranscriptRef = useRef("");
  const lastTranscriptIdRef = useRef(0);
  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null;

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
    } catch (error) {
      console.error("[FloatingChatDock] Could not save conversations:", error);
      onError("Could not save conversations in local storage.");
    }
  }, [chats, onError]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [activeChat?.messages.length, mode]);

  useEffect(() => {
    if (!transcriptUpdate || transcriptUpdate.id <= lastTranscriptIdRef.current) return;
    lastTranscriptIdRef.current = transcriptUpdate.id;
    if (mode !== "history" || !activeChatId || !transcriptUpdate.text.trim()) return;

    const text = transcriptUpdate.text.trim();
    setChats((previous) => previous.map((chat) => {
      if (chat.id !== activeChatId) return chat;
      const messages = [...chat.messages];
      const latest = messages[messages.length - 1];
      if (transcriptUpdate.role === "user" && latest?.role === "user" && latest.text && transcriptUpdate.text.includes(latest.text)) {
        return chat;
      }
      if (transcriptUpdate.role === "model" && latest?.role === "model") {
        messages[messages.length - 1] = { ...latest, text: latest.text + text };
      } else {
        messages.push({ id: crypto.randomUUID(), role: transcriptUpdate.role, text, at: Date.now() });
      }
      return {
        ...chat,
        title: chat.title === "New conversation" && transcriptUpdate.role === "user" ? text.slice(0, 48) : chat.title,
        updatedAt: Date.now(),
        messages,
      };
    }));
  }, [activeChatId, mode, transcriptUpdate]);

  useEffect(() => () => {
    shouldListenRef.current = false;
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    recognitionRef.current?.stop();
    onVoicePreviewChange(false);
  }, []);

  const startNewChat = () => {
    onSessionSwitch();
    const chat: SavedChat = {
      id: crypto.randomUUID(),
      title: "New conversation",
      updatedAt: Date.now(),
      messages: [],
    };
    setChats((previous) => [chat, ...previous]);
    setActiveChatId(chat.id);
    onModeChange("history");
    setSpeechError(null);
  };

  const selectChat = (chat: SavedChat) => {
    if (chat.id !== activeChatId || mode !== "history") onSessionSwitch();
    setActiveChatId(chat.id);
    onModeChange("history");
    setSpeechError(null);
  };

  const deleteChat = (chat: SavedChat) => {
    if (!window.confirm(`Permanently delete "${chat.title}"?`)) return;
    setChats((previous) => previous.filter((item) => item.id !== chat.id));
    if (activeChatId === chat.id) {
      onSessionSwitch();
      setActiveChatId(null);
      onModeChange("live");
    }
  };

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files: File[] = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!files.length) return;
    const maxFileBytes = 128 * 1024;
    if (files.length + attachments.length > 5) {
      const message = "Attach up to five files per message.";
      setSpeechError(message);
      onError(message);
      return;
    }
    if (files.reduce<number>((total, file) => total + file.size, attachments.reduce((sum, file) => sum + file.content.length, 0)) > 512 * 1024) {
      const message = "Attachments must total 512 KB or less.";
      setSpeechError(message);
      onError(message);
      return;
    }
    const supportedTextFile = (file: File) =>
      file.type.startsWith("text/") || /\.(txt|md|csv|json|log|xml|yaml|yml|html|css|js|ts|py)$/i.test(file.name);
    try {
      const next = await Promise.all(files.map(async (file) => {
        if (!supportedTextFile(file)) throw new Error(`${file.name}: only text and source files can be attached.`);
        if (file.size > maxFileBytes) throw new Error(`${file.name}: each attachment must be 128 KB or smaller.`);
        return { name: file.name, content: await file.text() };
      }));
      setAttachments((previous) => [...previous, ...next]);
      setSpeechError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read the selected attachment.";
      setSpeechError(message);
      onError(message);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = inputValue.trim();
    if (!text && attachments.length === 0) return;
    const attachedFiles = attachments;
    const visibleText = text || attachedFiles.map((file) => `[Attached: ${file.name}]`).join("\n");
    const conversation = activeChat?.messages.slice(-12).map((message) =>
      `${message.role === "user" ? "User" : "JAYRA"}: ${message.text}${message.attachments?.length ? `\n${message.attachments.map((file) => `Attached file ${file.name}:\n${file.content}`).join("\n")}` : ""}`,
    ).join("\n").slice(-16000) ?? "";
    if (mode === "history" && activeChatId) {
      setChats((previous) => previous.map((chat) => chat.id === activeChatId ? {
        ...chat,
        title: chat.title === "New conversation" ? visibleText.slice(0, 48) : chat.title,
        updatedAt: Date.now(),
        messages: [...chat.messages, { id: crypto.randomUUID(), role: "user", text: visibleText, attachments: attachedFiles, at: Date.now() }],
      } : chat));
    }
    setAttachments([]);
    onInputChange("");
    void onSend(
      attachedFiles.length ? `${text}\n\n${attachedFiles.map((file) => `Attached file: ${file.name}\n${file.content}`).join("\n\n")}` : text,
      conversation,
      attachedFiles,
    );
  };

  const toggleVoicePreview = () => {
    if (shouldListenRef.current) {
      shouldListenRef.current = false;
      if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
      recognitionRef.current?.stop();
      setIsListeningForText(false);
      onVoicePreviewChange(false);
      return;
    }

    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setSpeechError("Speech-to-text preview is not supported by this browser.");
      onError("Speech-to-text preview is not supported by this browser.");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    shouldListenRef.current = true;
    onVoicePreviewChange(true);
    transcriptDraftRef.current = inputValue;
    finalTranscriptRef.current = "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript ?? "";
        if (result?.isFinal) finalTranscriptRef.current += transcript;
        else interim += transcript;
      }
      onInputChange(`${transcriptDraftRef.current}${finalTranscriptRef.current}${interim}`.trimStart());
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed" || event.error === "audio-capture") {
        shouldListenRef.current = false;
        setIsListeningForText(false);
        onVoicePreviewChange(false);
        const message = `Voice preview failed: ${event.error}`;
        setSpeechError(message);
        onError(message);
      }
    };
    recognition.onend = () => {
      if (!shouldListenRef.current) {
        recognitionRef.current = null;
        setIsListeningForText(false);
        onVoicePreviewChange(false);
        return;
      }
      if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null;
        if (!shouldListenRef.current) return;
        try {
          recognition.start();
        } catch (error) {
          shouldListenRef.current = false;
          recognitionRef.current = null;
          setIsListeningForText(false);
          onVoicePreviewChange(false);
          const message = error instanceof Error ? error.message : "Could not resume speech recognition.";
          setSpeechError(message);
          onError(message);
        }
      }, 180);
    };
    recognitionRef.current = recognition;
    setSpeechError(null);
    setIsListeningForText(true);
    try {
      recognition.start();
    } catch (error) {
      shouldListenRef.current = false;
      recognitionRef.current = null;
      setIsListeningForText(false);
      onVoicePreviewChange(false);
      const message = error instanceof Error ? error.message : "Could not start speech recognition.";
      setSpeechError(message);
      onError(message);
    }
  };

  const messages = mode === "history" ? activeChat?.messages ?? [] : [];

  return (
    <section
      aria-label={mode === "live" ? "JAYRA live input dock" : "JAYRA chat history"}
      className={`jayra-chat-dock fixed bottom-4 left-1/2 z-50 flex w-[min(760px,calc(100vw-32px))] -translate-x-1/2 flex-col text-white ${mode === "history" ? "h-[min(500px,70vh)] overflow-hidden rounded-[22px] border border-white/15 bg-slate-950/75 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl" : "overflow-visible"}`}
    >
      {mode === "history" && (
        <>
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <AudioLines size={16} className="shrink-0 text-cyan-300" />
              <span className="text-xs font-semibold tracking-wide">Chat History</span>
              {activeChat && <span className="max-w-48 truncate rounded-full bg-white/10 px-2 py-1 text-[10px] text-white/65">{activeChat.title}</span>}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button type="button" onClick={() => { onSessionSwitch(); onModeChange("live"); setSpeechError(null); }} className="rounded-lg px-2.5 py-1.5 text-[11px] text-white/70 transition hover:bg-white/10">
                Live Assistant
              </button>
              <button type="button" onClick={startNewChat} className="flex items-center gap-1 rounded-lg bg-cyan-400/15 px-2.5 py-1.5 text-[11px] text-cyan-100 transition hover:bg-cyan-400/25">
                <Plus size={13} /> New Chat
              </button>
            </div>
          </header>
          <div className="flex min-h-0 flex-1">
            <nav aria-label="Saved conversations" className="w-48 shrink-0 space-y-1 overflow-y-auto border-r border-white/10 p-2">
              {chats.map((chat) => (
                <div key={chat.id} className={`flex items-center rounded-lg ${chat.id === activeChatId ? "bg-white/12 text-white" : "text-white/55 hover:bg-white/8 hover:text-white/80"}`}>
                  <button type="button" onClick={() => selectChat(chat)} className="min-w-0 flex-1 truncate px-2.5 py-2 text-left text-[11px]" title={chat.title}>{chat.title}</button>
                  <button type="button" onClick={() => deleteChat(chat)} aria-label={`Delete ${chat.title}`} title="Delete conversation" className="mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-white/40 hover:bg-rose-400/15 hover:text-rose-200">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {chats.length === 0 && <p className="px-2 py-3 text-[10px] text-white/40">No saved chats yet.</p>}
            </nav>
            <div ref={logRef} aria-live="polite" className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.length ? messages.map((message) => (
          <article key={message.id} className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
            <div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${message.role === "user" ? "rounded-br-md bg-cyan-400/15 text-cyan-50" : "rounded-bl-md border border-white/8 bg-white/8 text-white/90"}`}>{message.text}</div>
            <time className="mt-1 flex items-center gap-1 px-1 text-[9px] text-white/35" dateTime={new Date(message.at).toISOString()}>
              <Clock3 size={10} /> {new Date(message.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </time>
          </article>
              )) : <div className="flex h-full min-h-28 items-center justify-center text-center text-xs text-white/45">{activeChat ? "Start a conversation. Messages are saved on this device." : "Choose a saved chat or create a new one."}</div>}
            </div>
          </div>
        </>
      )}

      {speechError && (
        <p role="status" className="mb-2 self-center rounded-lg bg-slate-950/80 px-3 py-1.5 text-[11px] text-rose-300 shadow-lg">{speechError}</p>
      )}
      {attachments.length > 0 && (
        <div className="mb-2 flex shrink-0 flex-wrap gap-1.5 rounded-xl border border-white/10 bg-slate-950/85 px-3 py-2 shadow-lg backdrop-blur-xl" aria-label="Attachments">
          {attachments.map((file, index) => (
            <span key={`${file.name}-${index}`} className="flex max-w-48 items-center gap-1 rounded-md bg-white/8 px-2 py-1 text-[10px] text-white/70">
              <span className="truncate">{file.name}</span>
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments((previous) => previous.filter((_, itemIndex) => itemIndex !== index))} className="text-white/45 hover:text-white"><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <form onSubmit={submit} className={`flex shrink-0 items-center gap-2 border border-white/15 bg-slate-950/85 p-2.5 shadow-[0_18px_55px_rgba(0,0,0,0.45)] backdrop-blur-2xl ${mode === "history" ? "rounded-b-[22px]" : "rounded-2xl"}`}>
        <input ref={fileInputRef} type="file" multiple accept=".txt,.md,.csv,.json,.log,.xml,.yaml,.yml,.html,.css,.js,.ts,.py,text/*" onChange={(event) => { void handleFiles(event); }} className="hidden" aria-label="Choose text attachments" />
        <button type="button" onClick={() => fileInputRef.current?.click()} aria-label="Attach text files" title="Attach text or source files (up to 512 KB each)" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-white/70 transition hover:bg-white/10">
          <Plus size={17} />
        </button>
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(event) => onInputChange(event.target.value)}
          aria-label="Message JAYRA"
          placeholder={isListeningForText ? "Listening… review transcript before sending" : "Ask JAYRA..."}
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/35 focus:border-cyan-300/40"
        />
        <button type="button" onClick={toggleVoicePreview} aria-label={isListeningForText ? "Stop voice preview" : "Start voice-to-text preview"} title={isListeningForText ? "Stop preview" : "Speak, review, then send"} className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition ${isListeningForText ? "border-rose-300/40 bg-rose-400/15 text-rose-200" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"}`}>
          {isListeningForText ? <MicOff size={16} /> : <Mic size={16} />}
        </button>
        <button type="submit" aria-label="Send message" disabled={!inputValue.trim() && attachments.length === 0} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cyan-300 text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-35">
          <Send size={16} />
        </button>
        <button type="button" onClick={onToggleLive} aria-label={liveState === "disconnected" ? "Start Live Assistant voice" : "Stop Live Assistant voice"} title={liveState === "disconnected" ? "Start Live Assistant voice" : "Stop Live Assistant voice"} className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition ${liveState === "disconnected" ? "border-white/10 bg-white/5 text-white/70 hover:bg-white/10" : "border-emerald-300/40 bg-emerald-400/15 text-emerald-100"}`}>
          <Radio size={16} />
        </button>
      </form>
    </section>
  );
}
