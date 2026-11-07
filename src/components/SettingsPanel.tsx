/**
 * Settings — one place for everything JAYRA can be configured to do.
 *
 * Two stores back this page:
 *  - local renderer settings (src/lib/settingsStore.ts): wake word, mic,
 *    startup, animations, character shine;
 *  - server settings (/api/app-settings, settings/appSettings.ts) plus the
 *    permission policy (/api/permissions), which the agent enforces.
 * Only settings that the app actually honours are shown here.
 */
import React, { useEffect, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Settings, X, Power, Mic, Cpu, Info, Check, AlertTriangle, Sparkles, KeyRound, Loader2, Brain, ShieldCheck,
  Bell, Eye, MonitorSmartphone, Lock, Wrench, Hand, Layout, Code2, Box, Volume2, Gamepad2,
  Plus, Pencil, Trash2, Search, Server, Globe, RefreshCw,
} from "lucide-react";
import type { MyraaSettings } from "../lib/settingsStore";
import { getBrowserSpeechVoices, MARK_LV_VOICES, EDGE_TTS_POPULAR_VOICES, BrowserTts, type TtsProvider } from "../lib/tts";
import { api, LOCKED_CAPABILITIES, type ProviderKeyPoolDetails, type DiscoveredModelsResult, type AppSettings, type AppSettingsPatch, type CustomAutomationAction, type Decision, type ModelCatalogue, type PermissionsView, type MessageConfirmationMode, type Utility } from "../lib/appApi";
import { ModelSelectorPanel } from "./ModelSelector";
import { MiniGamesHub } from "./MiniGamesHub";

export type SettingsSection = "general" | "localization" | "ai" | "voice" | "persona" | "agent" | "gestures" | "hud" | "codeEditor" | "models3d" | "privacy" | "presence" | "character" | "system" | "about";

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Local renderer settings (owned by App so wake-word state stays in sync). */
  settings: MyraaSettings;
  onChange: (patch: Partial<MyraaSettings>) => void;
  /** Server-side settings (owned by App; null while loading). */
  appSettings: AppSettings | null;
  onAppSettingsChange: (patch: AppSettingsPatch) => void;
  onAppSettingsSaved: (settings: AppSettings) => void;
  initialSection?: SettingsSection;
  onOpenStudio: () => void;
  onRestartOnboarding: () => void;
  themeColor: string;
}

const SECTIONS: { id: SettingsSection; label: string; icon: typeof Power }[] = [
  { id: "general", label: "General", icon: Power },
  { id: "localization", label: "Language & Localization", icon: Globe },
  { id: "ai", label: "AI models & keys", icon: Brain },
  { id: "voice", label: "Voice", icon: Mic },
  { id: "persona", label: "Persona & Mood", icon: Sparkles },
  { id: "agent", label: "PC control & safety", icon: ShieldCheck },
  { id: "gestures", label: "Hand Gestures", icon: Hand },
  { id: "hud", label: "HUD & Visual Modes", icon: Layout },
  { id: "codeEditor", label: "Code Studio", icon: Code2 },
  { id: "privacy", label: "Privacy", icon: Lock },
  { id: "presence", label: "Presence", icon: Bell },
  { id: "character", label: "Character & companion", icon: Sparkles },
  { id: "system", label: "System", icon: Cpu },
  { id: "about", label: "About", icon: Info },
];

// Gemini Live prebuilt voices (name, character). The first group suits a
// young, cute companion.
const VOICES: Array<[string, string]> = [
  ["Leda", "youthful"],
  ["Zephyr", "bright"],
  ["Autonoe", "bright"],
  ["Laomedeia", "upbeat"],
  ["Achernar", "soft"],
  ["Aoede", "breezy"],
  ["Kore", "firm"],
  ["Callirrhoe", "easy-going"],
  ["Vindemiatrix", "gentle"],
  ["Sulafat", "warm"],
  ["Puck", "upbeat (male)"],
  ["Charon", "informative (male)"],
  ["Fenrir", "excitable (male)"],
  ["Orus", "firm (male)"],
];

// ---- primitives ------------------------------------------------------------------------

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="max-w-3xl">
        <h4 className="text-[11px] font-bold font-mono uppercase tracking-[.16em] text-slate-200">{title}</h4>
        {hint && <p className="mt-1 text-xs leading-relaxed text-slate-400">{hint}</p>}
      </div>
      <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/[0.03]">{children}</div>
    </section>
  );
}

const Row: React.FC<{ label: string; description?: string; children: ReactNode }> = ({ label, description, children }) => {
  return (
    <div className="flex min-w-0 flex-col items-stretch gap-3 px-4 py-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-snug text-slate-100">{label}</div>
        {description && <div className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">{description}</div>}
      </div>
      <div className="jayra-setting-control flex w-full min-w-0 items-center">{children}</div>
    </div>
  );
};

function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} disabled={disabled}
      className={`h-5 w-10 rounded-full p-0.5 transition-colors duration-200 cursor-pointer disabled:cursor-wait disabled:opacity-50 ${checked ? "bg-cyan-500" : "bg-white/10"}`}>
      <div className={`h-4 w-4 transform rounded-full bg-white shadow-md transition duration-200 ${checked ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

function ToggleRow({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <Row label={label} description={description}><Switch checked={checked} onChange={onChange} label={label} disabled={disabled} /></Row>;
}

function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg border border-white/10 bg-black/30 p-0.5">
      {options.map(([id, text]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)}
          className={`rounded-md px-2.5 py-1 text-[11px] transition cursor-pointer ${value === id ? "bg-cyan-500/20 text-cyan-100" : "text-slate-400 hover:text-white"}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

function SliderRow({ label, description, value, min, max, step = 1, unit = "", onChange }: { label: string; description?: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-100">{label}</div>
        <span className="text-[11px] font-mono text-cyan-300">{draft}{unit}</span>
      </div>
      {description && <div className="mt-0.5 text-[11px] text-slate-500">{description}</div>}
      <input type="range" aria-label={label} min={min} max={max} step={step} value={draft}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={() => draft !== value && onChange(draft)}
        onKeyUp={() => draft !== value && onChange(draft)}
        className="mt-2 w-full accent-cyan-500 cursor-pointer" />
    </div>
  );
}

function Note({ tone = "info", children }: { tone?: "info" | "warn" | "ok"; children: ReactNode }) {
  const styles = tone === "warn" ? "border-amber-400/20 bg-amber-400/5 text-amber-200/90" : tone === "ok" ? "border-emerald-400/20 bg-emerald-400/5 text-emerald-200/90" : "border-cyan-400/10 bg-cyan-400/[0.04] text-slate-300";
  return <div className={`rounded-xl border px-3 py-2 text-[11px] leading-relaxed ${styles}`}>{children}</div>;
}

function CustomAutomationManager() {
  const [actions, setActions] = useState<CustomAutomationAction[]>([]);
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("");
  const [scriptPath, setScriptPath] = useState("");
  const [runAsAdministrator, setRunAsAdministrator] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      setActions(await api.automations());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load automation actions.");
    }
  };
  useEffect(() => { void load(); }, []);

  const reset = () => {
    setEditingId(null);
    setName("");
    setTrigger("");
    setScriptPath("");
    setRunAsAdministrator(false);
  };
  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const body = { name, trigger, scriptPath, runAsAdministrator };
      if (editingId) await api.updateAutomation(editingId, body);
      else await api.addAutomation(body);
      await load();
      reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the automation.");
    } finally {
      setBusy(false);
    }
  };
  const run = async (action: CustomAutomationAction) => {
    setBusy(true);
    setMessage(`Waiting for permission and running ${action.name}…`);
    try {
      const result = await api.runAutomation(action.id);
      setMessage(`${result.name} completed successfully.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The automation could not run.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (action: CustomAutomationAction) => {
    setBusy(true);
    setMessage(null);
    try {
      await api.deleteAutomation(action.id);
      await load();
      if (editingId === action.id) reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete the automation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group title="Custom automation actions" hint="Save a script and an exact voice phrase. Running scripts always uses JAYRA's command permission and may ask you to approve each run. Administrator actions also trigger the Windows UAC prompt.">
      <div className="space-y-3 px-4 py-3">
        {actions.length > 0 && (
          <ul className="space-y-2">
            {actions.map((action) => (
              <li key={action.id} className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-white">{action.name}</div>
                  <div className="mt-0.5 text-[10px] text-cyan-200">Say “{action.trigger}”</div>
                  <div className="truncate font-mono text-[10px] text-slate-500">{action.scriptPath}{action.runAsAdministrator ? " · UAC" : ""}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" disabled={busy} onClick={() => void run(action)} className="rounded border border-emerald-300/20 px-2 py-1 text-[10px] text-emerald-200 disabled:opacity-50">Run</button>
                  <button type="button" disabled={busy} aria-label={`Edit ${action.name}`} onClick={() => {
                    setEditingId(action.id);
                    setName(action.name);
                    setTrigger(action.trigger);
                    setScriptPath(action.scriptPath);
                    setRunAsAdministrator(action.runAsAdministrator);
                  }} className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-50"><Pencil size={13} /></button>
                  <button type="button" disabled={busy} aria-label={`Delete ${action.name}`} onClick={() => void remove(action)} className="rounded p-1 text-slate-400 hover:bg-rose-400/10 hover:text-rose-200 disabled:opacity-50"><Trash2 size={13} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <input aria-label="Automation name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Action name (e.g. Clean workspace)" className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-white outline-none focus:border-cyan-400/40" />
          <input aria-label="Automation voice trigger" maxLength={100} value={trigger} onChange={(event) => setTrigger(event.target.value)} placeholder="Exact voice phrase (e.g. clean my PC)" className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-white outline-none focus:border-cyan-400/40" />
        </div>
        <input aria-label="Automation script path" maxLength={1024} value={scriptPath} onChange={(event) => setScriptPath(event.target.value)} placeholder="Absolute path to a .bat, .cmd, or .ps1 script" className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 font-mono text-[11px] text-white outline-none focus:border-cyan-400/40" />
        <ToggleRow label="Run as administrator (Windows UAC)" description="Off by default. Enabling this causes Windows to request elevated consent when the script runs." checked={runAsAdministrator} onChange={setRunAsAdministrator} />
        <div className="flex justify-end gap-2">
          {editingId && <button type="button" onClick={reset} className="rounded-lg px-3 py-1.5 text-[11px] text-slate-400 hover:bg-white/5">Cancel edit</button>}
          <button type="button" disabled={busy || !name.trim() || !trigger.trim() || !scriptPath.trim()} onClick={() => void save()} className="rounded-lg bg-cyan-400/20 px-3 py-1.5 text-[11px] text-cyan-100 disabled:opacity-50">{editingId ? "Save Changes" : "Add Action"}</button>
        </div>
        {message && <div role="status" className="text-[11px] text-cyan-200">{message}</div>}
      </div>
    </Group>
  );
}

function WellnessMessageEditor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return;
    const timer = window.setTimeout(() => onChange(draft), 400);
    return () => window.clearTimeout(timer);
  }, [draft, value, onChange]);
  return (
    <label className="block space-y-1 px-4 py-2 text-[11px] text-slate-300">
      <span>{label}</span>
      <textarea aria-label={label} maxLength={240} rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} className="w-full resize-y rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-white outline-none focus:border-cyan-400/40" />
    </label>
  );
}

function UtilitiesManager() {
  const [items, setItems] = useState<Utility[]>([]);
  const [label, setLabel] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try {
      setItems((await api.utilities()).filter((item) => item.kind === "reminder"));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load reminders.");
    }
  };
  useEffect(() => { void load(); }, []);
  const add = async () => {
    try {
      await api.addUtility({ kind: "reminder", label: label.trim(), inSeconds: minutes * 60 });
      setLabel("");
      await load();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Could not schedule reminder.");
    }
  };
  const cancel = async (id: string) => {
    try {
      await api.cancelUtility(id);
      await load();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Could not cancel reminder.");
    }
  };
  return (
    <Group title="Your timed reminders" hint="One-time reminders are saved locally and still appear if JAYRA restarts.">
      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <input aria-label="Reminder message" maxLength={200} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="What should JAYRA remind you about?" className="min-w-[180px] flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-white outline-none focus:border-cyan-400/40" />
          <input aria-label="Reminder delay in minutes" type="number" min={1} max={525600} value={minutes} onChange={(event) => setMinutes(Math.max(1, Math.min(525600, Number(event.target.value) || 1)))} className="w-24 rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-white outline-none" />
          <button type="button" disabled={!label.trim()} onClick={() => void add()} className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-[11px] text-cyan-100 disabled:opacity-50">Add reminder</button>
        </div>
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{item.label}<span className="ml-2 text-[10px] text-slate-500">{new Date(item.dueAt).toLocaleString()}</span></span>
            <button type="button" aria-label={`Cancel reminder ${item.label}`} onClick={() => void cancel(item.id)} className="rounded p-1.5 text-slate-400 hover:bg-rose-400/10 hover:text-rose-200"><X size={13} /></button>
          </div>
        ))}
        {error && <div role="alert" className="text-[11px] text-rose-300">{error}</div>}
      </div>
    </Group>
  );
}

function CustomPersonaManager({
  personas,
  activePersonaId,
  patch,
  onSaved,
}: {
  personas: AppSettings["persona"]["customPersonas"];
  activePersonaId: string | null;
  patch: (p: AppSettingsPatch) => void;
  onSaved: (settings: AppSettings) => void;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startCreate = () => {
    setEditorOpen(true);
    setEditingId(null);
    setTitle("");
    setDescription("");
    setError(null);
  };
  const startEdit = (persona: AppSettings["persona"]["customPersonas"][number]) => {
    setEditorOpen(true);
    setEditingId(persona.id);
    setTitle(persona.title);
    setDescription(persona.description);
    setError(null);
  };
  const save = async () => {
    const cleanTitle = title.trim();
    const cleanDescription = description.trim();
    if (!cleanTitle || !cleanDescription) {
      setError("Enter a role title and description before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = editingId
        ? await api.updateCustomPersona(editingId, { title: cleanTitle, description: cleanDescription })
        : await api.createCustomPersona({ title: cleanTitle, description: cleanDescription });
      onSaved(updated);
      setEditorOpen(false);
      setEditingId(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save this persona.");
    } finally {
      setSaving(false);
    }
  };
  const remove = async (id: string) => {
    try {
      onSaved(await api.deleteCustomPersona(id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete this persona.");
    }
  };
  const suggestTitle = async () => {
    const text = description.trim();
    if (!text) {
      setError("Add a description first so the AI can suggest a fitting role.");
      return;
    }
    setSuggesting(true);
    setError(null);
    try {
      const suggestion = await api.suggestPersonaTitle(text);
      setTitle(suggestion.title);
    } catch (suggestionError) {
      setError(suggestionError instanceof Error ? suggestionError.message : "Could not suggest a role title.");
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-slate-100">Your custom personas</div>
          <div className="mt-0.5 text-[11px] text-slate-500">Create and keep as many named styles as you need.</div>
        </div>
        <button type="button" onClick={startCreate} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1.5 text-[11px] text-cyan-100 hover:bg-cyan-300/20">
          <Plus size={13} /> Create New Persona
        </button>
      </div>
      {personas.length > 0 ? (
        <ul className="space-y-2">
          {personas.map((persona) => (
            <li key={persona.id} className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 ${activePersonaId === persona.id ? "border-cyan-300/30 bg-cyan-300/[0.07]" : "border-white/10 bg-black/20"}`}>
              <button type="button" onClick={() => patch({ persona: { activeCustomPersonaId: persona.id } })} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-xs text-white">{persona.title}{activePersonaId === persona.id && <span className="ml-2 text-[10px] text-cyan-300">Active</span>}</span>
                <span className="mt-1 line-clamp-2 block text-[11px] text-slate-400">{persona.description}</span>
              </button>
              <div className="flex shrink-0 gap-1">
                <button type="button" aria-label={`Edit ${persona.title}`} title="Edit persona" onClick={() => startEdit(persona)} className="rounded p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"><Pencil size={13} /></button>
                <button type="button" aria-label={`Delete ${persona.title}`} title="Delete persona" onClick={() => void remove(persona.id)} className="rounded p-1.5 text-slate-400 hover:bg-rose-400/10 hover:text-rose-200"><Trash2 size={13} /></button>
              </div>
            </li>
          ))}
        </ul>
      ) : <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-slate-500">No custom personas yet.</div>}

      {editorOpen && (
        <div role="dialog" aria-modal="true" aria-label={editingId ? "Edit custom persona" : "Create custom persona"} className="space-y-3 rounded-xl border border-cyan-300/20 bg-[#080b13] p-3">
          <div className="text-xs font-medium text-white">{editingId ? "Edit Persona" : "New Persona"}</div>
          <label className="block space-y-1 text-[11px] text-slate-300">
            <span>Role / title</span>
            <input aria-label="Persona role title" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Playful Tech Mentor" className="w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-xs text-white outline-none focus:border-cyan-300/40" />
          </label>
          <label className="block space-y-1 text-[11px] text-slate-300">
            <span>How should this persona behave?</span>
            <textarea aria-label="Persona description" maxLength={2000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe how the character behaves, speaks, and responds." className="w-full resize-y rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-xs text-white outline-none focus:border-cyan-300/40" />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={() => void suggestTitle()} disabled={suggesting || !description.trim()} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300/20 bg-violet-300/10 px-2.5 py-1.5 text-[11px] text-violet-100 disabled:opacity-50">
              {suggesting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {suggesting ? "Suggesting…" : "Auto-Suggest Role"}
            </button>
            <span className="text-[10px] text-slate-500">{description.length}/2000</span>
          </div>
          {error && <div role="alert" className="text-[11px] text-rose-300">{error}</div>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setEditorOpen(false); setEditingId(null); setTitle(""); setDescription(""); setError(null); }} className="rounded-lg px-3 py-1.5 text-[11px] text-slate-400 hover:bg-white/5">Cancel</button>
            <button type="button" onClick={() => void save()} disabled={saving} className="rounded-lg bg-cyan-400/20 px-3 py-1.5 text-[11px] text-cyan-100 hover:bg-cyan-400/30 disabled:opacity-50">{saving ? "Saving…" : "Save Persona"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

type AssetCategory = "models" | "objects" | "animations" | "audio" | "voices" | "tts";
type AssetCatalog = Record<AssetCategory, string[]>;

const ASSET_CATEGORIES: Array<[AssetCategory, string, string]> = [
  ["models", "3D characters", "PMX, PMD, GLB, GLTF, VRM, FBX, ZIP"],
  ["objects", "3D objects", "GLB, GLTF, OBJ, FBX, STL"],
  ["animations", "Animations", "VMD, BVH, FBX, JSON"],
  ["voices", "Voice audio", "MP3, WAV, OGG, AAC"],
  ["tts", "TTS voice models", "ONNX, BIN, SAFETENSORS, MODEL, JSON, ZIP"],
  ["audio", "Audio / sound effects", "MP3, WAV, OGG, AAC"],
];

const EMPTY_ASSET_CATALOG: AssetCatalog = { models: [], objects: [], animations: [], audio: [], voices: [], tts: [] };

function CustomPersonaPromptEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onChange(draft), 350);
    return () => clearTimeout(timer);
  }, [draft, value, onChange]);

  return (
    <div className="px-4 py-3">
      <label htmlFor="custom-persona-prompt" className="text-xs text-slate-100">Custom Personality Prompt / Rules</label>
      <p className="mt-0.5 text-[11px] text-slate-500">Optional style guidance, up to 2,000 characters. Tool permissions, safety, and accuracy rules remain in effect.</p>
      <textarea id="custom-persona-prompt" aria-label="Custom Personality Prompt / Rules" maxLength={2000}
        value={draft} onChange={(event) => setDraft(event.target.value)}
        placeholder="e.g. Act like an anime character who loves tech, speaks with slight playfulness, and encourages my coding progress."
        rows={5}
        className="mt-2 w-full resize-y rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs leading-relaxed text-white outline-none focus:border-cyan-400/50" />
      <div className="mt-1 text-right text-[10px] text-slate-500">{draft.length}/2000</div>
    </div>
  );
}

function assetUrl(category: AssetCategory, file: string): string {
  const encoded = file.split(/[\\/]/).map(encodeURIComponent).join("/");
  if (category === "models") return `/custom_models/${encoded}`;
  if (category === "objects") return `/custom_models/objects/${encoded}`;
  if (category === "animations") return `/animations/${encoded}`;
  if (category === "audio") return `/custom_assets/${encoded}`;
  return `/custom_assets/${category}/${encoded}`;
}

function CustomAssetManager({ onUseModel }: { onUseModel: (modelPath: string) => void }) {
  const [category, setCategory] = useState<AssetCategory>("models");
  const [catalog, setCatalog] = useState<AssetCatalog>(EMPTY_ASSET_CATALOG);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    const response = await fetch("/api/assets/custom", { cache: "no-store" });
    const result = await response.json() as Partial<AssetCatalog> & { error?: string };
    if (!response.ok) throw new Error(result.error || `Could not load assets (${response.status}).`);
    setCatalog({ ...EMPTY_ASSET_CATALOG, ...result });
  };

  useEffect(() => {
    void refresh().catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)));
  }, []);

  const importAsset = async () => {
    const bridge = (window as unknown as { myraa?: { pickCustomAsset?: (kind: AssetCategory) => Promise<string | null> } }).myraa;
    if (!bridge?.pickCustomAsset) {
      setMessage("Asset import is available in the JAYRA desktop app.");
      return;
    }
    const source = await bridge.pickCustomAsset(category);
    if (!source) return;
    setBusy(true);
    setMessage("Copying the selected file into JAYRA’s local asset library…");
    try {
      const response = await fetch("/api/assets/custom/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, source }),
      });
      const result = await response.json() as { error?: string; asset?: { fileName?: string } };
      if (!response.ok) throw new Error(result.error || `Asset import failed (${response.status}).`);
      await refresh();
      setMessage(`Added ${result.asset?.fileName || "asset"} to ${category}. Your original file was not changed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group title="Local asset library" hint="Copy extra models, objects, animations, audio and TTS files into JAYRA. Originals remain untouched. GLB/VRM files are best for single-file 3D imports.">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <select aria-label="Asset category" value={category} onChange={(event) => setCategory(event.target.value as AssetCategory)}
          className="max-w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none">
          {ASSET_CATEGORIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <button type="button" disabled={busy} onClick={() => void importAsset()}
          className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-1.5 text-[11px] text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-50">
          {busy ? "Importing…" : "Choose file"}
        </button>
        <span className="text-[10px] text-slate-500">{ASSET_CATEGORIES.find(([id]) => id === category)?.[2]}</span>
      </div>
      {message && <p role="status" className="px-4 pb-3 text-[11px] text-slate-300">{message}</p>}
      <div className="max-h-48 space-y-2 overflow-y-auto px-4 pb-3">
        {ASSET_CATEGORIES.map(([id, label]) => catalog[id].length > 0 && (
          <div key={id}>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
            <ul className="space-y-1">
              {catalog[id].map((file) => (
                <li key={`${id}/${file}`} className="truncate text-[11px]">
                  <a className="text-cyan-200 hover:underline" href={assetUrl(id, file)} target="_blank" rel="noreferrer">{file}</a>
                  {id === "models" && /\.(glb|gltf)$/i.test(file) && (
                    <button type="button" onClick={() => onUseModel(assetUrl(id, file))}
                      className="ml-2 rounded border border-cyan-300/20 px-1.5 py-0.5 text-[10px] text-cyan-100 hover:bg-cyan-400/10">
                      Use in hologram
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {!Object.values(catalog).some((files: string[]) => files.length) && <p className="text-[11px] text-slate-500">No custom assets yet.</p>}
      </div>
    </Group>
  );
}

// ---- sections that load their own data ----------------------------------------------------


const PROVIDER_TABS = [
  { id: "gemini", name: "Google Gemini", defaultUrl: "" },
  { id: "groq", name: "Groq Cloud", defaultUrl: "https://api.groq.com/openai/v1" },
  { id: "openai", name: "OpenAI", defaultUrl: "https://api.openai.com/v1" },
  { id: "anthropic", name: "Anthropic", defaultUrl: "https://api.anthropic.com/v1" },
  { id: "deepseek", name: "DeepSeek", defaultUrl: "https://api.deepseek.com" },
  { id: "local", name: "Local / Ollama", defaultUrl: "http://127.0.0.1:11434" },
];

function UniversalKeyPoolManager({ onCatalogueUpdated }: { onCatalogueUpdated?: (cat: ModelCatalogue) => void }) {
  const [activeTab, setActiveTab] = useState("gemini");
  const [allPools, setAllPools] = useState<Record<string, ProviderKeyPoolDetails>>({});
  const [addKeyValue, setAddKeyValue] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [poolMessage, setPoolMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Discovery engine state
  const [discKey, setDiscKey] = useState("");
  const [discUrl, setDiscUrl] = useState("");
  const [discProvider, setDiscProvider] = useState("auto");
  const [discBusy, setDiscBusy] = useState(false);
  const [discResult, setDiscResult] = useState<DiscoveredModelsResult | null>(null);
  const [discError, setDiscError] = useState<string | null>(null);
  const [registerBusy, setRegisterBusy] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState<string | null>(null);

  const loadAllPools = async () => {
    try {
      const res = await api.allKeyPools();
      if (res && res.providers) {
        setAllPools(res.providers);
      }
    } catch {
      // Fallback: poll current active provider
      try {
        const single = await api.keyPoolStatus(activeTab);
        if (single) setAllPools((prev) => ({ ...prev, [activeTab]: single }));
      } catch {}
    }
  };

  useEffect(() => {
    void loadAllPools();
    const timer = setInterval(loadAllPools, 8000);
    return () => clearInterval(timer);
  }, [activeTab]);

  const handleAddKey = async () => {
    const raw = addKeyValue.trim();
    if (!raw || addBusy) return;
    setAddBusy(true);
    setPoolMessage(null);
    try {
      const res = await api.addKeyToPool(activeTab, raw);
      if (res.ok) {
        setAddKeyValue("");
        setPoolMessage({ ok: true, text: "Key(s) added to pool successfully." });
        if (res.details) {
          setAllPools((prev) => ({ ...prev, [activeTab]: res.details! }));
        } else {
          void loadAllPools();
        }
      }
    } catch (err) {
      setPoolMessage({ ok: false, text: err instanceof Error ? err.message : "Failed to add key." });
    } finally {
      setAddBusy(false);
    }
  };

  const handleRemoveKey = async (masked: string) => {
    try {
      const res = await api.removeKeyFromPool(activeTab, masked);
      if (res.details) {
        setAllPools((prev) => ({ ...prev, [activeTab]: res.details! }));
      } else {
        void loadAllPools();
      }
      setPoolMessage({ ok: true, text: "Key removed from pool." });
    } catch (err) {
      setPoolMessage({ ok: false, text: err instanceof Error ? err.message : "Failed to remove key." });
    }
  };

  const handleTestKey = async (provider: string, masked: string) => {
    setPoolMessage({ ok: true, text: `Testing key ${masked}...` });
    try {
      const res = await api.testKeyInPool(provider, masked);
      if (res.ok) {
        setPoolMessage({ ok: true, text: `Key ${masked} healthy (Latency: ${res.latencyMs || 0}ms)` });
      } else {
        setPoolMessage({ ok: false, text: `Key ${masked} error: ${res.error || "Validation failed"}` });
      }
    } catch (err) {
      setPoolMessage({ ok: false, text: err instanceof Error ? err.message : "Validation failed." });
    }
  };

  const handleDiscover = async () => {
    if ((!discKey.trim() && !discUrl.trim()) || discBusy) return;
    setDiscBusy(true);
    setDiscError(null);
    setDiscResult(null);
    setRegisterSuccess(null);
    try {
      const res = await api.discoverModels({
        apiKey: discKey.trim() || undefined,
        baseUrl: discUrl.trim() || undefined,
        provider: discProvider !== "auto" ? discProvider : undefined,
      });
      if (res.ok) {
        setDiscResult(res);
        if (res.provider) setActiveTab(res.provider);
      } else {
        throw new Error(res.error || "Could not validate key or discover models.");
      }
    } catch (err) {
      setDiscError(err instanceof Error ? err.message : "Discovery request failed.");
    } finally {
      setDiscBusy(false);
    }
  };

  const handleRegisterDiscovered = async () => {
    if (!discResult || registerBusy) return;
    setRegisterBusy(true);
    try {
      const res = await api.registerDiscovered({
        apiKey: discKey.trim() || undefined,
        baseUrl: discResult.baseUrl || discUrl.trim() || undefined,
        provider: discResult.provider,
        providerName: discResult.providerName,
        apiType: discResult.apiType,
        models: discResult.models,
      });
      if (res.ok) {
        setRegisterSuccess(`Registered ${res.registeredCount} models to ${discResult.providerName} successfully!`);
        setDiscKey("");
        if (res.details) {
          setAllPools((prev) => ({ ...prev, [discResult.provider]: res.details }));
        }
        void loadAllPools();
        try {
          const freshCatalogue = await api.refreshModels();
          if (onCatalogueUpdated && freshCatalogue) {
            onCatalogueUpdated(freshCatalogue);
          }
        } catch {}
      }
    } catch (err) {
      setDiscError(err instanceof Error ? err.message : "Failed to register models.");
    } finally {
      setRegisterBusy(false);
    }
  };

  const currentPool = allPools[activeTab] || {
    provider: activeTab,
    total: 0,
    healthy: 0,
    coolingDown: 0,
    keys: [],
  };

  return (
    <div className="space-y-4 px-4 py-3">
      {/* Auto-Discovery Engine Box */}
      <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-indigo-400" />
            <h4 className="text-xs font-semibold text-indigo-200 uppercase tracking-wider font-mono">
              Dynamic Key Test & Model Auto-Discovery
            </h4>
          </div>
          <span className="text-[10px] text-indigo-300/80 font-mono">Any Provider • Local • Cloud</span>
        </div>
        <p className="text-[11px] text-slate-400">
          Paste any API key (Gemini, Groq, OpenAI, Anthropic, DeepSeek) or local URL (Ollama, LM Studio). The engine will automatically detect the provider, validate authentication, and retrieve all supported models.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="sm:col-span-2">
            <input
              type="password"
              value={discKey}
              onChange={(e) => setDiscKey(e.target.value)}
              placeholder="Paste API Key (e.g. AIza..., gsk_..., sk-ant-..., sk-...)"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-white outline-none focus:border-indigo-400/50"
            />
          </div>
          <div>
            <select
              value={discProvider}
              onChange={(e) => setDiscProvider(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-slate-200 outline-none focus:border-indigo-400/50"
            >
              <option value="auto">Auto-Detect Provider</option>
              <option value="gemini">Google Gemini</option>
              <option value="groq">Groq Cloud</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="deepseek">DeepSeek</option>
              <option value="local">Local Endpoint / Ollama</option>
            </select>
          </div>
        </div>

        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5">
            <Globe size={13} className="text-slate-500 shrink-0" />
            <input
              type="text"
              value={discUrl}
              onChange={(e) => setDiscUrl(e.target.value)}
              placeholder="Optional Custom Base URL (e.g. http://127.0.0.1:11434, http://localhost:1234/v1)"
              className="min-w-0 flex-1 bg-transparent font-mono text-xs text-white outline-none placeholder:text-slate-600"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleDiscover()}
            disabled={discBusy || (!discKey.trim() && !discUrl.trim())}
            className="flex items-center gap-1.5 rounded-lg border border-indigo-400/40 bg-indigo-500/20 px-4 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-indigo-200 hover:bg-indigo-500/30 disabled:opacity-40 transition-colors cursor-pointer shrink-0"
          >
            {discBusy ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
            <span>Test & Discover</span>
          </button>
        </div>

        {discError && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-[11px] text-rose-300">
            {discError}
          </div>
        )}

        {/* Discovery Success Card */}
        {discResult && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-3 space-y-2.5 animate-fadeIn">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Check size={14} className="text-emerald-400" />
                <span className="text-xs font-bold text-emerald-300 font-mono">
                  {discResult.providerName} Verified
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  • {discResult.latencyMs}ms latency • {discResult.models.length} model{discResult.models.length === 1 ? "" : "s"} found
                </span>
              </div>
              <button
                type="button"
                onClick={() => void handleRegisterDiscovered()}
                disabled={registerBusy}
                className="flex items-center gap-1 rounded border border-emerald-400/40 bg-emerald-500/20 px-2.5 py-1 text-[10px] font-mono font-semibold uppercase tracking-wider text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40 transition-colors"
              >
                {registerBusy ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                <span>Save Key & Register Models</span>
              </button>
            </div>

            {/* Models list badges */}
            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-1">
              {discResult.models.map((m, idx) => (
                <span
                  key={idx}
                  className="rounded border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300"
                >
                  {m.name || m.id}
                </span>
              ))}
            </div>
          </div>
        )}

        {registerSuccess && (
          <p className="text-[11px] text-emerald-300 font-medium">✓ {registerSuccess}</p>
        )}
      </div>

      {/* Provider Pools Section */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound size={15} className="text-slate-300" />
            <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider font-mono">
              Provider Multi-Key Pools & Rotation
            </h4>
          </div>
          <button
            type="button"
            onClick={() => void loadAllPools()}
            className="flex items-center gap-1 text-[10px] font-mono text-slate-400 hover:text-slate-200 transition-colors"
          >
            <RefreshCw size={11} /> Refresh Pools
          </button>
        </div>

        {/* Provider Tabs */}
        <div className="flex flex-wrap gap-1 border-b border-white/10 pb-2">
          {PROVIDER_TABS.map((tab) => {
            const p = allPools[tab.id];
            const hasKeys = Boolean(p && p.total > 0);
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  setPoolMessage(null);
                }}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-mono transition-colors ${
                  activeTab === tab.id
                    ? "bg-indigo-500/20 text-indigo-200 border border-indigo-400/30"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                }`}
              >
                <span>{tab.name}</span>
                <span
                  className={`rounded px-1.5 py-0.2 text-[9px] ${
                    hasKeys
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      : "bg-white/5 text-slate-500"
                  }`}
                >
                  {hasKeys ? `${p.total} key${p.total > 1 ? "s" : ""}` : "0"}
                </span>
              </button>
            );
          })}
        </div>

        {/* Selected Provider Card */}
        <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-100 font-mono uppercase tracking-wider">
                {PROVIDER_TABS.find((t) => t.id === activeTab)?.name || activeTab.toUpperCase()} Key Pool
              </span>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Keys rotate automatically upon rate limits (429) or quota recovery.
              </p>
            </div>
            <span
              className={`rounded-full border px-2 py-0.5 text-[9px] font-mono uppercase ${
                currentPool.total > 0
                  ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                  : "border-amber-400/25 bg-amber-400/10 text-amber-300"
              }`}
            >
              {currentPool.total > 0
                ? `${currentPool.total} Keys (${currentPool.healthy} Ready)`
                : "No Keys"}
            </span>
          </div>

          {/* Active Keys List */}
          {currentPool.keys && currentPool.keys.length > 0 ? (
            <div className="space-y-1.5">
              {currentPool.keys.map((k, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-2 rounded border border-white/5 bg-white/[0.02] px-2.5 py-1.5 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`h-2 w-2 rounded-full shrink-0 ${
                        k.healthy
                          ? "bg-emerald-400 shadow-[0_0_6px_#10b981]"
                          : "bg-amber-400 shadow-[0_0_6px_#f59e0b] animate-pulse"
                      }`}
                      title={k.healthy ? "Healthy & Ready" : `Cooldown (${k.cooldownRemainingSeconds}s left)`}
                    />
                    <span className="font-mono text-[11px] text-slate-200 truncate">{k.masked}</span>
                    {!k.healthy && (
                      <span className="text-[10px] text-amber-400/90 font-mono">
                        cooling down ({k.cooldownRemainingSeconds}s)
                      </span>
                    )}
                    {k.successCount > 0 && (
                      <span className="text-[10px] text-slate-500 font-mono">✓ {k.successCount}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleTestKey(activeTab, k.masked)}
                      className="rounded px-2 py-0.5 text-[10px] font-mono text-slate-400 hover:bg-white/10 hover:text-slate-200 transition-colors"
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveKey(k.masked)}
                      className="rounded p-1 text-slate-500 hover:bg-rose-500/20 hover:text-rose-300 transition-colors"
                      title="Remove Key"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 italic py-1">
              No keys configured in this pool yet. Paste one below or use Auto-Discovery above.
            </p>
          )}

          {/* Add Key Input */}
          <div className="flex gap-2 pt-1">
            <input
              type="password"
              value={addKeyValue}
              onChange={(e) => {
                setAddKeyValue(e.target.value);
                setPoolMessage(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && void handleAddKey()}
              placeholder={`Paste ${PROVIDER_TABS.find((t) => t.id === activeTab)?.name || activeTab} API key(s)`}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 font-mono text-xs text-white outline-none focus:border-indigo-400/50"
            />
            <button
              type="button"
              onClick={() => void handleAddKey()}
              disabled={addBusy || !addKeyValue.trim()}
              className="flex items-center gap-1 rounded-lg border border-indigo-400/25 bg-indigo-500/15 px-3 py-1.5 text-[10px] font-mono uppercase text-indigo-200 hover:bg-indigo-500/25 disabled:opacity-40 cursor-pointer"
            >
              {addBusy ? <Loader2 size={12} className="animate-spin" /> : <><Plus size={12} /> Add Key</>}
            </button>
          </div>

          {poolMessage && (
            <p className={`text-[11px] ${poolMessage.ok ? "text-emerald-300" : "text-rose-300"}`}>
              {poolMessage.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}


function AiSection() {
  const [catalogue, setCatalogue] = useState<ModelCatalogue | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api.models().then(setCatalogue).catch((e) => setError(e instanceof Error ? e.message : "Could not load models."));
  }, []);
  return (
    <div className="space-y-5">
      <Group title="API Keys & Model Pools">
        <UniversalKeyPoolManager onCatalogueUpdated={setCatalogue} />
      </Group>
      <section className="space-y-2">
        <h4 className="text-[10px] font-mono uppercase tracking-widest text-slate-400">Which model does what</h4>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          {catalogue ? <ModelSelectorPanel catalogue={catalogue} onChanged={setCatalogue} /> : error ? <p className="text-[11px] text-rose-300">{error}</p> : <Loader2 size={16} className="animate-spin text-slate-400" />}
        </div>
      </section>
      <Note tone="warn">Multi-key rotation automatically balances quota across healthy keys and switches providers on rate exhaustion.</Note>
    </div>
  );
}const DECISION_OPTIONS: [Decision, string][] = [["allow", "Allow"], ["ask", "Ask"], ["deny", "Block"]];
const RISK_TONE = { low: "text-emerald-300/80", medium: "text-amber-300/80", high: "text-rose-300/80" } as const;

export function usePermissions() {
  const [view, setView] = useState<PermissionsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => void api.permissions().then(setView).catch((e) => setError(e instanceof Error ? e.message : "Could not load permissions."));
  useEffect(load, []);
  const set = async (capability: string, decision: Decision) => {
    try {
      await api.setPermission(capability, decision);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change permission.");
    }
  };
  return { view, error, set, load };
}

export function PermissionRows({ view, capabilities, onSet }: { view: PermissionsView; capabilities: string[]; onSet: (c: string, d: Decision) => void }) {
  return (
    <>
      {capabilities.filter((c) => view.info[c]).map((capability) => {
        const info = view.info[capability];
        const decision = view.policy.capabilities[capability]?.decision ?? "ask";
        const locked = LOCKED_CAPABILITIES.has(capability);
        return (
          <Row key={capability} label={info.label} description={`${info.description}${locked ? " Always asks first." : ""}`}>
            <div className="flex items-center gap-2">
              <span className={`hidden text-[9px] font-mono uppercase sm:inline ${RISK_TONE[info.risk]}`}>{info.risk}</span>
              <Choice label={`${info.label} permission`} value={decision}
                options={locked ? DECISION_OPTIONS.filter(([d]) => d !== "allow") : DECISION_OPTIONS}
                onChange={(d) => onSet(capability, d)} />
            </div>
          </Row>
        );
      })}
    </>
  );
}

const ACTION_CAPABILITIES = ["LAUNCH_APP", "BROWSE_WEB", "CONTROL_INPUT", "READ_FILE", "WRITE_FILE", "DELETE_FILE", "DOWNLOAD_FILE", "EXECUTE_DOWNLOAD", "RUN_COMMAND", "INSTALL_SOFTWARE", "MODIFY_SYSTEM_SETTINGS", "SEND_MESSAGE", "NETWORK_API", "PURCHASE", "ACCOUNT_CHANGE", "POWER_CONTROL"];
const PRIVACY_CAPABILITIES = ["SCREEN_CAPTURE", "CLIPBOARD", "ACCESS_MICROPHONE", "ACCESS_CAMERA"];

const MESSAGE_MODES: [MessageConfirmationMode, string][] = [
  ["always_confirm", "Always ask before sending"],
  ["confirm_new_recipients", "Ask for new recipients"],
  ["trusted_without_confirmation", "Trusted contacts send without asking"],
  ["never_without_preview", "Always show a preview"],
];

function AgentSection({ app, patch }: { app: AppSettings; patch: (p: AppSettingsPatch) => void }) {
  const { view, error, set, load } = usePermissions();
  return (
    <div className="space-y-5">
      <Group title="While JAYRA works">
        <ToggleRow label="Show the task panel" description="See the plan, each step and pause / stop buttons while JAYRA uses your PC. Approval requests always appear."
          checked={app.autonomy.showTaskHud} onChange={(v) => patch({ autonomy: { showTaskHud: v } })} />
        <SliderRow label="Step limit per task" description="A task that needs more actions than this is stopped. Applies to new tasks." value={app.autonomy.maxSteps} min={5} max={80} onChange={(v) => patch({ autonomy: { maxSteps: v } })} />
        <SliderRow label="Wait when you use the mouse" description="How long JAYRA pauses when you move the mouse or type during a task." value={app.autonomy.conflictWaitSec} min={1} max={30} unit=" s" onChange={(v) => patch({ autonomy: { conflictWaitSec: v } })} />
        <Row label="Emergency stop shortcut" description="Stops every task immediately, even when JAYRA is hidden.">
          <kbd className="rounded-md border border-white/15 bg-black/40 px-2 py-1 font-mono text-[11px] text-slate-200">{app.autonomy.emergencyShortcut.replace(/\+/g, " + ")}</kbd>
        </Row>
      </Group>

      <Group title="What JAYRA may do" hint="Allow: does it without asking. Ask: shows an approval window first. Block: never. Risky actions such as installs, purchases and power always ask.">
        {view ? <PermissionRows view={view} capabilities={ACTION_CAPABILITIES} onSet={set} /> : <div className="px-4 py-3">{error ? <span className="text-[11px] text-rose-300">{error}</span> : <Loader2 size={14} className="animate-spin text-slate-400" />}</div>}
      </Group>

      {view && (
        <Group title="Messages">
          <Row label="Before sending a message" description="Applies to WhatsApp and other messaging apps.">
            <select aria-label="Message confirmation" value={view.policy.messageConfirmation}
              onChange={(e) => void api.setMessageConfirmation(e.target.value as MessageConfirmationMode).then(load)}
              className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none cursor-pointer">
              {MESSAGE_MODES.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
            </select>
          </Row>
        </Group>
      )}
    </div>
  );
}

function PrivacySection() {
  const { view, error, set } = usePermissions();
  return (
    <div className="space-y-5">
      <Group title="What JAYRA can sense" hint="Blocking a capability stops the agent from using it at all. Voice still needs the microphone while you talk to JAYRA.">
        {view ? <PermissionRows view={view} capabilities={PRIVACY_CAPABILITIES} onSet={set} /> : <div className="px-4 py-3">{error ? <span className="text-[11px] text-rose-300">{error}</span> : <Loader2 size={14} className="animate-spin text-slate-400" />}</div>}
      </Group>
      <Note>
        When JAYRA looks at your screen for a task, the screenshot stays in memory for that step and is sent only to the AI model you chose; it is not saved to disk.
        Logs are scrubbed of API keys, tokens and passwords. The continuous <b>Share screen</b> mode in the header is separate and only runs while you have it switched on.
      </Note>
    </div>
  );
}

function NetworkingGatewaySection({ settings, onChange }: { settings: MyraaSettings; onChange: (patch: Partial<MyraaSettings>) => void }) {
  const [status, setStatus] = useState<{ enabled: boolean; localIps: string[]; gatewayPort: number; active: boolean; serverUrl?: string; qrDataUrl?: string; pairingCode?: string; pairingEndpoint?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/network/status", { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not read network status.");
      setStatus(data);
      if (typeof data.enabled === "boolean" && data.enabled !== settings.networkAccessEnabled) {
        onChange({ networkAccessEnabled: data.enabled });
      }
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not read network status."));
  }, []);

  const setNetworkAccess = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/network/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not change network access.");
      setStatus(data);
      onChange({ networkAccessEnabled: enabled });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not change network access.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group title="Networking & Mobile Gateway">
      <ToggleRow label="Enable Network Access (LAN Gateway)" description="Allows paired devices on your trusted local network to connect to JAYRA." checked={status?.enabled ?? settings.networkAccessEnabled} onChange={(enabled) => void setNetworkAccess(enabled)} disabled={busy} />
      <Row label="Local IP Address">
        <span className="max-w-48 break-all text-right font-mono text-[11px] text-slate-300">{status?.localIps.length ? status.localIps.join(", ") : "No LAN address found"}</span>
      </Row>
      <Row label="Gateway port">
        <span className="font-mono text-[11px] text-slate-300">{status?.gatewayPort ?? 8765} · {status?.active ? "Online" : "Offline"}</span>
      </Row>
      {status?.enabled && (
        <div className="flex flex-col items-center gap-2 p-4 bg-black/40 rounded-xl border border-cyan-500/30 m-3">
          <div className="text-center">
            <div className="text-xs font-semibold text-cyan-300">Instant Phone Pairing</div>
            <p className="text-[10px] text-slate-400">Scan with JAYRA Companion or enter the pairing code on the same Wi-Fi network</p>
          </div>
          <div className="p-2 bg-white rounded-lg shadow-xl min-w-[144px] min-h-[144px] flex items-center justify-center">
            {status.qrDataUrl ? (
              <img src={status.qrDataUrl} alt="JAYRA Mobile Pairing QR Code" className="w-36 h-36" />
            ) : (
              <Loader2 className="w-8 h-8 text-cyan-600 animate-spin" />
            )}
          </div>
          <div className="text-center">
            <span className="font-mono text-[10px] text-cyan-200 bg-slate-900/90 px-2 py-1 rounded border border-white/10 select-all">
              {status.serverUrl || `http://${status.localIps?.[0] || "127.0.0.1"}:3000`}
            </span>
          </div>
          {status.pairingCode && (
            <div className="text-center">
              <div className="text-[10px] text-slate-400">Manual Android pairing code</div>
              <div className="mt-1 font-mono text-lg tracking-[0.3em] text-cyan-200">{status.pairingCode}</div>
              <div className="text-[9px] text-slate-500">Stable across refreshes and server restarts</div>
            </div>
          )}
        </div>
      )}
      {error && <div className="px-4 pb-3 text-[11px] text-rose-300">{error}</div>}
    </Group>
  );
}


function LocalizationSection({
  app,
  settings,
  onChange,
  patch,
}: {
  app: AppSettings;
  settings: MyraaSettings;
  onChange: (patch: Partial<MyraaSettings>) => void;
  patch: (p: AppSettingsPatch) => void;
}) {
  const loc = app.localization ?? {
    language: "en",
    customPrompt: "",
    scriptStyle: "latin",
    summaryLanguage: "multilingual",
    dailyBoardSync: true,
  };

  return (
    <div className="space-y-5">
      <Group title="Language & Conversational Style" hint="Configure JAYRA's conversational dialect, Roman script transliteration, and daily retrospective style.">
        <Row label="Primary Language" description="The primary language JAYRA uses when responding to speech, chat, and autonomous tasks.">
          <Choice
            label="Primary Language"
            value={loc.language}
            options={[
              ["en", "English"],
              ["roman_urdu", "Roman Urdu"],
              ["roman_hindi", "Roman Hindi"],
              ["custom_script", "Custom Script"],
            ]}
            onChange={(language) => {
              patch({ localization: { language } });
              onChange({ language });
            }}
          />
        </Row>

        {loc.language === "custom_script" && (
          <div className="px-4 py-3">
            <div className="text-xs text-slate-100">Custom Dialect & Script Prompt</div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              Provide instructions on how JAYRA should speak (e.g. regional slang, transliteration rules, mixed vernacular).
            </div>
            <textarea
              value={loc.customPrompt}
              onChange={(e) => patch({ localization: { customPrompt: e.target.value } })}
              rows={3}
              placeholder="e.g. Speak in friendly colloquial Punjabi with Roman English transliteration..."
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/40 p-2 text-xs text-white placeholder-slate-500 focus:border-cyan-500/50 focus:outline-none"
            />
          </div>
        )}

        <Row label="Script & Character Style" description="Rendering preference for HUD, subtitles, and text cards.">
          <Choice
            label="Script Style"
            value={loc.scriptStyle}
            options={[
              ["latin", "Romanized (Latin)"],
              ["native", "Native Script"],
              ["mixed", "Mixed / Dual"],
            ]}
            onChange={(scriptStyle) => patch({ localization: { scriptStyle } })}
          />
        </Row>
      </Group>

      <Group title="Daily Summary & Flashcard Retrospectives" hint="Control how the Knowledge Graph synthesizes your daily retrospective.">
        <Row label="Summary Flashcard Language" description="Preferred dialect for daily accomplishment highlights and developer pulse.">
          <Choice
            label="Summary Language"
            value={loc.summaryLanguage}
            options={[
              ["multilingual", "Multilingual (All)"],
              ["roman_urdu", "Roman Urdu"],
              ["roman_hindi", "Roman Hindi"],
              ["en", "English Only"],
            ]}
            onChange={(summaryLanguage) => patch({ localization: { summaryLanguage } })}
          />
        </Row>

        <ToggleRow
          label="Autonomous Daily Board Sync"
          description="Automatically synchronize daily knowledge graph summaries and active task board with the Android Companion and memory."
          checked={loc.dailyBoardSync}
          onChange={(dailyBoardSync) => patch({ localization: { dailyBoardSync } })}
        />
      </Group>

      <Group title="Autonomous Perception Hub" hint="Configure background sensory triggers and proactive awareness.">
        <ToggleRow
          label="Proactive Screen Companion"
          description="Allow JAYRA to form model-generated observations from foreground activity and any screen frame you explicitly share."
          checked={app.behavior.proactiveCompanionEnabled ?? true}
          onChange={(proactiveCompanionEnabled) => patch({ behavior: { proactiveCompanionEnabled } })}
        />

        <Row label="Proactive Commentary Frequency" description="Quiet disables spontaneous remarks; Balanced and Lively control how often JAYRA may initiate one.">
          <Choice
            label="Commentary Frequency"
            value={app.behavior.proactivity}
            options={[
              ["quiet", "Quiet (Off)"],
              ["balanced", "Balanced"],
              ["lively", "Frequent"],
            ]}
            onChange={(proactivity) => patch({ behavior: { proactivity } })}
          />
        </Row>

        <ToggleRow
          label="Auto-DND During Fullscreen Apps"
          description="Silence autonomous voice interruptions when gaming, presenting, or coding fullscreen."
          checked={app.behavior.autoDndFullscreen}
          onChange={(autoDndFullscreen) => patch({ behavior: { autoDndFullscreen } })}
        />
      </Group>

      <Note>
        Language preferences guide both the Gemini Live conversational engine and the offline Knowledge Graph synthesis. You can switch between Roman Urdu, Roman Hindi, and English at any time without resetting history.
      </Note>
    </div>
  );
}

function SystemSection({ app, settings, onChange, patch, onRestartOnboarding }: { app: AppSettings; settings: MyraaSettings; onChange: (patch: Partial<MyraaSettings>) => void; patch: (p: AppSettingsPatch) => void; onRestartOnboarding: () => void }) {
  const [agent, setAgent] = useState<{ online: boolean; toolCount?: number }>({ online: false });
  const [startingAgent, setStartingAgent] = useState(false);
  const [agentMessage, setAgentMessage] = useState<string | null>(null);

  const probe = async () => {
    try {
      const res = await fetch("/api/desktop-agent/status", { cache: "no-store" });
      const data = res.ok ? await res.json() : null;
      setAgent({ online: Boolean(data?.online), toolCount: data?.tool_count });
    } catch {
      setAgent({ online: false });
    }
  };

  useEffect(() => {
    void probe();
    const id = setInterval(probe, 5000);
    return () => clearInterval(id);
  }, []);

  const handleStartAgent = async () => {
    setStartingAgent(true);
    setAgentMessage(null);
    try {
      const res = await fetch("/api/desktop-agent/start", { method: "POST" });
      const data = await res.json();
      if (data?.online) {
        setAgent({ online: true, toolCount: data.tool_count });
        setAgentMessage(data.message || "Desktop agent is running.");
      } else {
        setAgentMessage(data.message || data.error || "Agent could not be started.");
      }
    } catch (err: any) {
      setAgentMessage(err?.message || "Failed to start agent.");
    } finally {
      setStartingAgent(false);
      void probe();
    }
  };

  return (
    <div className="space-y-5">
      <Group title="System Telemetry HUD" hint="Locally sampled hardware metrics stream over JAYRA's existing event connection.">
        <ToggleRow
          label="Show live diagnostics"
          description="Display CPU, RAM, GPU/VRAM, storage, network ping, and bandwidth in the HUD."
          checked={app.systemMonitor.enabled}
          onChange={(v) => patch({ systemMonitor: { enabled: v } })}
        />
        <Row label="Update frequency" description="More frequent sampling can add small CPU and network overhead.">
          <select
            aria-label="Telemetry update frequency"
            value={app.systemMonitor.updateIntervalSeconds}
            onChange={(e) => patch({ systemMonitor: { updateIntervalSeconds: Number(e.target.value) as 1 | 3 | 5 } })}
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none cursor-pointer"
          >
            <option value={1}>1 second</option>
            <option value={3}>3 seconds</option>
            <option value={5}>5 seconds</option>
          </select>
        </Row>
        <Row label="HUD corner" description="Choose where the collapsible telemetry panel is pinned.">
          <select
            aria-label="Telemetry HUD corner"
            value={app.systemMonitor.corner}
            onChange={(e) => patch({ systemMonitor: { corner: e.target.value as AppSettings["systemMonitor"]["corner"] } })}
            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none cursor-pointer"
          >
            <option value="top-left">Top left</option>
            <option value="top-right">Top right</option>
            <option value="bottom-left">Bottom left</option>
            <option value="bottom-right">Bottom right</option>
          </select>
        </Row>
      </Group>
      <NetworkingGatewaySection settings={settings} onChange={onChange} />
      <Group title="Desktop control agent">
        <Row
          label={agent.online ? "Running" : "Not running"}
          description={
            agent.online
              ? `${agent.toolCount ?? 0} PC tools available`
              : "JAYRA starts it automatically. Click Start Agent to launch the sidecar immediately."
          }
        >
          <div className="flex items-center gap-2.5">
            <span className={`block h-2.5 w-2.5 rounded-full ${agent.online ? "bg-emerald-400 animate-pulse" : "bg-rose-400"}`} />
            <button
              type="button"
              disabled={startingAgent}
              onClick={handleStartAgent}
              className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/20 cursor-pointer disabled:opacity-50 transition"
            >
              {startingAgent ? "Starting..." : agent.online ? "Restart Agent" : "Start Agent"}
            </button>
          </div>
        </Row>
        {agentMessage && (
          <div className="px-4 pb-2 text-[10px] text-cyan-300 font-mono">
            {agentMessage}
          </div>
        )}
      </Group>
      <CustomAutomationManager />
      <Group title="Developer">
        <ToggleRow label="Debug view" description="Streams internal agent logs to this window." checked={app.developer.debugView} onChange={(v) => patch({ developer: { debugView: v } })} />
        <ToggleRow label="Verbose log files" description="Writes detailed logs to disk. Takes effect after a restart." checked={app.developer.verboseLogs} onChange={(v) => patch({ developer: { verboseLogs: v } })} />
        <ToggleRow label="Show Error & Diagnostic Console" description="Show runtime errors, API failures, and live connection diagnostics in a floating console. When disabled, they remain in developer tools and log files." checked={app.developer.showErrorConsole} onChange={(v) => patch({ developer: { showErrorConsole: v } })} />
      </Group>
      <Group title="Setup">
        <Row label="Run the welcome setup again" description="Walks through character, models, permissions and the desktop companion.">
          <button type="button" onClick={onRestartOnboarding} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-slate-200 hover:bg-white/10 cursor-pointer">Start</button>
        </Row>
      </Group>
    </div>
  );
}

function GesturesSection({ app, patch }: { app: AppSettings; patch: (p: AppSettingsPatch) => void }) {
  const g = app.gestures || {
    enabled: true,
    mode: "hud_control",
    sensitivity: 1.0,
    cameraIndex: 0,
    smoothFactor: 0.6,
    feedbackAudio: true,
    visualLandmarks: true,
  };
  return (
    <div className="space-y-5">
      <Group title="MediaPipe Hand Tracking" hint="Control JAYRA and the holographic HUD using your hands in real-time.">
        <ToggleRow label="Enable Hand Gestures" description="Uses webcam feed with MediaPipe 21-point hand landmark tracking." checked={g.enabled} onChange={(v) => patch({ gestures: { enabled: v } })} />
        <Row label="Interaction Mode" description="HUD Control interacts with this window; Air Mouse moves/clicks the Windows cursor across apps and browsers; Presentation enables slide paging. In Air Mouse, pinch holds/drags, two-hand stretch zooms, and release drops the click. Requires the desktop app and this mode remains off until selected.">
          <Choice label="Interaction Mode" value={g.mode} options={[["hud_control", "HUD Control"], ["air_mouse", "Air Mouse"], ["presentation", "Presentation"]]} onChange={(v) => patch({ gestures: { mode: v } })} />
        </Row>
        <SliderRow label="Tracking Sensitivity" description="Adjusts the hand-to-screen mapping range for finer movement or faster edge reach." value={Math.round(g.sensitivity * 100)} min={10} max={300} step={10} unit="%" onChange={(v) => patch({ gestures: { sensitivity: v / 100 } })} />
        <SliderRow label="Motion Smoothing" description="Speed-adaptive One Euro filter: higher values reduce idle jitter while fast movement stays responsive." value={Math.round(g.smoothFactor * 100)} min={10} max={95} step={5} unit="%" onChange={(v) => patch({ gestures: { smoothFactor: v / 100 } })} />
      </Group>
      <Group title="Audio & Visual Feedback">
        <ToggleRow label="Chime on Gesture Recognition" description="Play sci-fi acoustic cue when a gesture is recognized (pinch, swipe, grab)." checked={g.feedbackAudio} onChange={(v) => patch({ gestures: { feedbackAudio: v } })} />
        <ToggleRow label="Overlay Landmark Wireframe" description="Render 21-node holographic skeleton over active hand in camera preview." checked={g.visualLandmarks} onChange={(v) => patch({ gestures: { visualLandmarks: v } })} />
      </Group>
      <Note tone="ok">
        <Check size={12} className="mr-1 inline" /> Gestures run 100% locally on your machine with low-latency client-side inference. No video frames are ever recorded or uploaded.
      </Note>
    </div>
  );
}

function HudSection({ app, patch, onOpenStudio }: { app: AppSettings; patch: (p: AppSettingsPatch) => void; onOpenStudio: () => void }) {
  const h = app.hud || {
    visualMode: "character",
    theme: "mark_lv_neon",
    soundEffects: true,
    scanlines: true,
    particleField: true,
    diagnosticGauges: true,
    ringOpacity: 0.85,
  };
  const m = app.models3d || {
    activeModel: "jayra_prime",
    customModelPath: "",
    wireframeMode: false,
    hologramGlitch: true,
    rotationSpeed: 0.5,
  };

  const visualMode = h.visualMode || (m.activeModel === "hologram_core" ? "orb" : "character");

  return (
    <div className="space-y-5">
      <Group title="Primary Visual Display Mode" hint="Select the primary avatar and visualization style rendered in JAYRA's holographic viewport.">
        <Row label="Active Display Mode" description="Switch between 3D interactive companion, cybernetic holographic face, or Mark LV gyro-orb.">
          <Choice
            label="Visual Mode"
            value={visualMode}
            options={[
              ["character", "3D Companion"],
              ["hologram_face", "Holographic Face"],
              ["orb", "Jarvis Holographic Orb"],
            ]}
            onChange={(v) => patch({ hud: { visualMode: v as any } })}
          />
        </Row>
      </Group>

      {/* Mode-specific settings */}
      {visualMode === "character" && (
        <Group title="3D Companion Customization" hint="Configure realistic rendering, gaze tracking, and character models.">
          <Row label="Character Studio" description="Import 3D models, customize hair/cloth physics, and adjust pose.">
            <button
              type="button"
              onClick={onOpenStudio}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-slate-200 hover:bg-white/10 cursor-pointer"
            >
              <Wrench size={12} /> Open Character Studio
            </button>
          </Row>
          <Row label="Graphics Quality" description="Lower = higher frame rates and reduced GPU load. Auto balances dynamically.">
            <select
              aria-label="Graphics quality"
              value={app.graphics?.quality ?? "auto"}
              onChange={(e) => {
                const quality = e.target.value as AppSettings["graphics"]["quality"];
                void api.updateAppSettings({ graphics: { quality, autoStep: 0 } }).catch(() => undefined).then(() => window.location.reload());
              }}
              className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none cursor-pointer"
            >
              <option value="auto">Auto (recommended)</option>
              <option value="high">High</option>
              <option value="balanced">Medium</option>
              <option value="low">Optimized</option>
              <option value="potato">Potato PC</option>
            </select>
          </Row>
          <SliderRow
            label="Realism"
            description="Shading blend from flat anime (0%) to physically based studio reflections (100%)."
            value={Math.round((app.graphics?.realism ?? 0.85) * 100)}
            min={0}
            max={100}
            step={5}
            unit="%"
            onChange={(v) => patch({ graphics: { realism: v / 100 } })}
          />
          <Row label="Eye Focus Mode" description="Fixed gaze or subtle cursor tracking.">
            <Choice
              label="Eye Focus Mode"
              value={app.character?.eyeFollowCursor ? "cursor" : "screen"}
              options={[["screen", "Fixed Screen"], ["cursor", "Follow Cursor"]]}
              onChange={(value) => patch({ character: { eyeFollowCursor: value === "cursor" } })}
            />
          </Row>
        </Group>
      )}

      {visualMode === "hologram_face" && (
        <Group title="Holographic Face VFX" hint="Fine-tune cybernetic wireframe and neural spectrum animations.">
          <ToggleRow
            label="Cyber Scanlines & Glitch"
            description="CRT beam scanlines, glitch jitter, and chromatic aberration."
            checked={h.scanlines}
            onChange={(v) => patch({ hud: { scanlines: v } })}
          />
          <ToggleRow
            label="Ambient Particle Field"
            description="Floating reactive quantum dust motes responding to cognitive states."
            checked={h.particleField}
            onChange={(v) => patch({ hud: { particleField: v } })}
          />
        </Group>
      )}

      {visualMode === "orb" && (
        <Group title="Jarvis Orb Visualizer & Performance" hint="Configure procedural 3D math, Fibonacci particle swarms, and GPU rendering efficiency.">
          <Row label="Rendering Quality & FPS Target" description="Controls particle resolution, segment count, and frame budget.">
            <Choice
              label="Orb Quality"
              value={app.orbVisualizer?.quality ?? "high"}
              options={[
                ["high", "High (Smooth 60fps)"],
                ["balanced", "Balanced (Eco 60fps)"],
                ["low", "Power Saver (30fps Cap)"],
              ]}
              onChange={(v) => patch({ orbVisualizer: { quality: v as any } })}
            />
          </Row>
          <Row label="Particle Swarm Density" description="Total Fibonacci sphere nodes rendered on concentric shells.">
            <Choice
              label="Density"
              value={app.orbVisualizer?.particleDensity ?? "balanced"}
              options={[
                ["high", "Hyper-Dense (1100+ Nodes)"],
                ["balanced", "Standard (750 Nodes)"],
                ["low", "Minimal (400 Nodes)"],
              ]}
              onChange={(v) => patch({ orbVisualizer: { particleDensity: v as any } })}
            />
          </Row>
          <Row label="Aesthetic Visual Style" description="Geometric accent profile for gyro rings and filaments.">
            <Choice
              label="Visual Style"
              value={app.orbVisualizer?.style ?? "jarvis_classic"}
              options={[
                ["jarvis_classic", "Jarvis Mark LV"],
                ["reactive_pulse", "Neural Resonance"],
                ["quantum_matrix", "Quantum Matrix"],
                ["minimal", "Minimalist"],
              ]}
              onChange={(v) => patch({ orbVisualizer: { style: v as any } })}
            />
          </Row>
          <SliderRow
            label="Orbital Spin Velocity"
            description="Relative speed multiplier of concentric gyro rings and filament arcs."
            value={Math.round((app.orbVisualizer?.spinSpeed ?? 1.0) * 100)}
            min={20}
            max={250}
            step={10}
            unit="%"
            onChange={(v) => patch({ orbVisualizer: { spinSpeed: v / 100 } })}
          />
          <ToggleRow
            label="Two-Pass Luminous Bloom"
            description="Downsampled additive bloom pass for radiant outer corona glow."
            checked={app.orbVisualizer?.bloomEffect ?? true}
            onChange={(v) => patch({ orbVisualizer: { bloomEffect: v } })}
          />
          <ToggleRow
            label="Floor Reflection Plane"
            description="Mirrored floor projection plane below the holographic stage."
            checked={app.orbVisualizer?.floorReflection ?? true}
            onChange={(v) => patch({ orbVisualizer: { floorReflection: v } })}
          />
        </Group>
      )}

      {/* Global Tactical HUD & Audio Settings */}
      <Group title="Mark LV Holographic Tactical HUD" hint="Theme palette and interface diagnostics.">
        <Row label="HUD Visual Theme" description="Color scheme and aesthetic palette for all HUD dials, rings, and holographic readouts.">
          <Choice
            label="HUD Theme"
            value={h.theme}
            options={[
              ["mark_lv_neon", "Mark LV Cyan"],
              ["iron_man_gold", "Stark Gold"],
              ["cyber_cyan", "Cyberpunk"],
              ["stealth_dark", "Stealth Dark"],
            ]}
            onChange={(v) => patch({ hud: { theme: v } })}
          />
        </Row>
        <SliderRow
          label="Arc Reactor Ring Opacity"
          description="Alpha transparency for rotating holographic rings and telemetry circles."
          value={Math.round(h.ringOpacity * 100)}
          min={10}
          max={100}
          step={5}
          unit="%"
          onChange={(v) => patch({ hud: { ringOpacity: v / 100 } })}
        />
        <ToggleRow
          label="Sound Effects (SFX)"
          description="Jarvis-style interface beeps, pulse chimes, and power-up sequences."
          checked={h.soundEffects}
          onChange={(v) => patch({ hud: { soundEffects: v } })}
        />
        <ToggleRow
          label="Diagnostic Telemetry Gauges"
          description="Real-time CPU, GPU, Memory, and Agent pipeline state readouts."
          checked={h.diagnosticGauges}
          onChange={(v) => patch({ hud: { diagnosticGauges: v } })}
        />
        <ToggleRow
          label="Show Subtitles"
          description="Show live subtitles toast bar overlay during conversation."
          checked={h.showSubtitles ?? true}
          onChange={(v) => patch({ hud: { showSubtitles: v } })}
        />
      </Group>
    </div>
  );
}

function CodeEditorSection({ app, patch }: { app: AppSettings; patch: (p: AppSettingsPatch) => void }) {
  const ce = app.codeEditor || {
    enabled: true,
    theme: "cyber-punk",
    fontSize: 14,
    autoComplete: true,
    aiAssistance: true,
    defaultWorkspace: "",
  };
  return (
    <div className="space-y-5">
      <Group title="Built-in Autonomous Code Studio" hint="Integrated development environment embedded directly inside JAYRA.">
        <ToggleRow label="Enable Code Studio" description="Allows JAYRA to view, edit, refactor, and run workspace files alongside you." checked={ce.enabled} onChange={(v) => patch({ codeEditor: { enabled: v } })} />
        <Row label="Editor Syntax Theme" description="Color syntax highlighting theme.">
          <Choice label="Editor Theme" value={ce.theme} options={[["cyber-punk", "Cyber Neon"], ["vs-dark", "VS Dark"], ["hc-black", "High Contrast"]]} onChange={(v) => patch({ codeEditor: { theme: v } })} />
        </Row>
        <SliderRow label="Font Size" value={ce.fontSize} min={10} max={24} step={1} unit="px" onChange={(v) => patch({ codeEditor: { fontSize: v } })} />
      </Group>
      <Group title="AI Assistance & Intelligence">
        <ToggleRow label="Autonomous Code Suggestions" description="JAYRA synthesizes diffs and edits files directly upon agent task instructions." checked={ce.aiAssistance} onChange={(v) => patch({ codeEditor: { aiAssistance: v } })} />
        <ToggleRow label="IntelliSense & Auto-complete" description="Inline type hints and code completion." checked={ce.autoComplete} onChange={(v) => patch({ codeEditor: { autoComplete: v } })} />
        <Row label="Default Workspace Folder" description="Folder opened by default when launching Code Studio.">
          <input type="text" aria-label="Default Workspace" value={ce.defaultWorkspace} onChange={(e) => patch({ codeEditor: { defaultWorkspace: e.target.value } })} placeholder="Current Project Root" className="w-56 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-400/50" />
        </Row>
      </Group>
    </div>
  );
}

// ---- panel ----------------------------------------------------------------------------------

export function SettingsPanel({ isOpen, onClose, settings, onChange, appSettings, onAppSettingsChange, onAppSettingsSaved, initialSection = "general", onOpenStudio, onRestartOnboarding, themeColor }: SettingsPanelProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [showMiniGames, setShowMiniGames] = useState(false);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [speechVoices, setSpeechVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (isOpen) setSection(initialSection);
  }, [isOpen, initialSection]);

  useEffect(() => {
    if (!isOpen || section !== "voice" || !navigator.mediaDevices?.enumerateDevices) return;
    void navigator.mediaDevices.enumerateDevices().then((d) => setMics(d.filter((x) => x.kind === "audioinput"))).catch(() => undefined);
  }, [isOpen, section]);

  useEffect(() => {
    if (!isOpen || section !== "voice" || !window.speechSynthesis) return;
    const synthesis = window.speechSynthesis;
    const refresh = () => setSpeechVoices(getBrowserSpeechVoices());
    const previousHandler = synthesis.onvoiceschanged;
    refresh();
    synthesis.onvoiceschanged = refresh;
    return () => {
      if (synthesis.onvoiceschanged === refresh) synthesis.onvoiceschanged = previousHandler;
    };
  }, [isOpen, section]);

  useEffect(() => {
    if (!isOpen) return;
    const escape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [isOpen, onClose]);

  const app = appSettings;
  const patch = onAppSettingsChange;
  const accent = themeColor === "crimson" || themeColor === "rose" ? "text-rose-300" : themeColor === "emerald" ? "text-emerald-300" : themeColor === "gold" ? "text-amber-300" : "text-cyan-300";
  const needsApp = section !== "general" && section !== "about" && section !== "ai" && section !== "privacy";

  return (
    <>
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm" />
          <motion.div
            initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            role="dialog" aria-modal="true" aria-label="Settings"
            className="jayra-left-drawer jayra-left-drawer-panel jayra-settings-dialog absolute inset-y-0 z-50 flex w-full flex-col border-r border-white/15 bg-[#020206]/95 shadow-[0_0_50px_rgba(0,0,0,0.8)] backdrop-blur-2xl overscroll-contain"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div className="flex items-center gap-3">
                <Settings size={18} className={accent} />
                <div>
                  <h3 className="font-display text-lg font-medium tracking-tight text-white">Settings</h3>
                  <p className="text-[11px] text-slate-500">Changes save automatically</p>
                </div>
              </div>
              <button type="button" onClick={onClose} aria-label="Close settings" className="rounded-xl border border-white/5 bg-white/5 p-2 text-slate-400 hover:bg-white/10 hover:text-white cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
              <nav aria-label="Settings sections" className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/5 p-3 sm:w-56 sm:flex-col sm:overflow-y-auto sm:overscroll-contain sm:border-b-0 sm:border-r sm:p-4">
                {SECTIONS.map(({ id, label, icon: Icon }) => (
                  <button key={id} type="button" onClick={() => setSection(id)} aria-current={section === id ? "page" : undefined}
                    className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition cursor-pointer ${section === id ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"}`}>
                    <Icon size={14} className={section === id ? accent : ""} />
                    <span className="whitespace-nowrap">{label}</span>
                  </button>
                ))}
              </nav>

              <div className="min-h-0 flex-1 space-y-7 overflow-y-auto overscroll-contain p-5 sm:p-8 lg:p-10">
                {needsApp && !app && <Loader2 size={16} className="animate-spin text-slate-400" />}

                {section === "localization" && app && (
                  <LocalizationSection app={app} settings={settings} onChange={onChange} patch={patch} />
                )}

                {section === "general" && (
                  <div className="space-y-5">
                    <Group title="Startup & appearance">
                      <Row label="View mode" description="Choose whether JAYRA lives on the desktop or opens as a full window.">
                        <select
                          aria-label="View mode"
                          value={settings.uiViewMode}
                          onChange={(event) => onChange({ uiViewMode: event.target.value as MyraaSettings["uiViewMode"] })}
                          className="max-w-52 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none"
                        >
                          <option value="companion">Desktop Companion</option>
                          <option value="windowed">Windowed HUD</option>
                        </select>
                      </Row>
                      <ToggleRow label="Launch at Windows startup" description="Start JAYRA quietly when you log in." checked={settings.autoStart}
                        onChange={(v) => onChange({ autoStart: v })} />
                      <ToggleRow label="Animations" description="Motion and transitions in the interface." checked={settings.animations} onChange={(v) => onChange({ animations: v })} />
                    </Group>
                    {app && (
                      <Group title="How chatty JAYRA is">
                        <Row label="Talks on her own" description="Quiet disables spontaneous remarks; Balanced and Frequent increase the initiation cadence.">
                          <Choice label="Commentary frequency" value={app.behavior.proactivity} options={[["quiet", "Quiet (Off)"], ["balanced", "Balanced"], ["lively", "Frequent"]]} onChange={(v) => patch({ behavior: { proactivity: v } })} />
                        </Row>
                        <ToggleRow label="Do not disturb" description="No spoken interruptions until you turn this off. Alarms still ring." checked={app.behavior.dndManual} onChange={(v) => patch({ behavior: { dndManual: v } })} />
                      </Group>
                    )}
                  </div>
                )}

                {section === "ai" && <AiSection />}

                {section === "persona" && app && (
                  <div className="space-y-5">
                    <Group title="Persona & Mood" hint="Changes save immediately. Typed turns and task/proactive voice prompts use the latest profile; a voice conversation already in progress keeps its opening system prompt until it reconnects.">
                      <Row label="Active persona" description="Choose a built-in style or one of your saved custom personas. Serious or sensitive topics always take priority.">
                        <select aria-label="Active persona" value={app.persona.activeCustomPersonaId ? `custom:${app.persona.activeCustomPersonaId}` : `preset:${app.persona.preset}`}
                          onChange={(event) => {
                            const value = event.target.value;
                            if (value.startsWith("custom:")) {
                              patch({ persona: { activeCustomPersonaId: value.slice("custom:".length) } });
                            } else {
                              patch({ persona: { preset: value.slice("preset:".length) as AppSettings["persona"]["preset"], activeCustomPersonaId: null } });
                            }
                          }}
                          className="max-w-60 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none">
                          <optgroup label="Built-in personas">
                            <option value="preset:friendly_caring">Friendly &amp; Caring</option>
                            <option value="preset:fun_witty">Fun &amp; Witty</option>
                            <option value="preset:naughty_teasing">Naughty &amp; Teasing</option>
                            <option value="preset:professional_assistant">Professional / Assistant</option>
                          </optgroup>
                          {app.persona.customPersonas.length > 0 && (
                            <optgroup label="Your custom personas">
                              {app.persona.customPersonas.map((persona) => <option key={persona.id} value={`custom:${persona.id}`}>{persona.title}</option>)}
                            </optgroup>
                          )}
                        </select>
                      </Row>
                      <Row label="Relationship role" description="A roleplay framing for conversation, not a claim of human feelings or a real-world relationship.">
                        <select aria-label="Relationship role" value={app.persona.relationshipRole}
                          onChange={(event) => patch({ persona: { relationshipRole: event.target.value as AppSettings["persona"]["relationshipRole"] } })}
                          className="max-w-60 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none">
                          <option value="close_friend">Close Friend / Bestie</option>
                          <option value="companion_waifu">Companion / Waifu</option>
                          <option value="custom_role">Custom Role</option>
                        </select>
                      </Row>
                      {app.persona.relationshipRole === "custom_role" && (
                        <Row label="Custom relationship role" description="Describe the role in up to 120 characters.">
                          <input aria-label="Custom relationship role" maxLength={120} value={app.persona.customRole}
                            onChange={(event) => patch({ persona: { customRole: event.target.value } })}
                            placeholder="e.g. curious coding buddy"
                            className="w-60 max-w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-400/50" />
                        </Row>
                      )}
                      <Row label="Mood" description="Sets the overall energy; JAYRA still adapts to the user's context.">
                        <select aria-label="Persona mood" value={app.persona.mood}
                          onChange={(event) => patch({ persona: { mood: event.target.value as AppSettings["persona"]["mood"] } })}
                          className="max-w-60 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none">
                          <option value="balanced">Balanced</option>
                          <option value="cheerful">Cheerful</option>
                          <option value="calm">Calm</option>
                          <option value="encouraging">Encouraging</option>
                          <option value="focused">Focused</option>
                        </select>
                      </Row>
                      <CustomPersonaManager
                        personas={app.persona.customPersonas}
                        activePersonaId={app.persona.activeCustomPersonaId}
                        patch={patch}
                        onSaved={onAppSettingsSaved}
                      />
                      <CustomPersonaPromptEditor
                        value={app.persona.customPrompt}
                        onChange={(customPrompt) => patch({ persona: { customPrompt } })}
                      />
                    </Group>
                    <Note>Persona preferences guide tone only. They cannot change tool permissions, required confirmations, or JAYRA’s accuracy and safety rules.</Note>
                  </div>
                )}

                {section === "voice" && (
                  <div className="space-y-5">
                    <Group title="Voice synthesis engine">
                      <Row label="Voice provider" description="Select which voice engine delivers speech and answers.">
                        <select
                          aria-label="Voice provider"
                          value={settings.ttsProvider ?? "gemini"}
                          onChange={(e) => {
                            const p = e.target.value as TtsProvider;
                            onChange({ ttsProvider: p });
                            patch({ voice: { ttsProvider: p } });
                          }}
                          className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none cursor-pointer"
                        >
                          <option value="gemini">Gemini Live Native (Cloud Audio Stream)</option>
                          <option value="mark_lv_jarvis">Mark LV JARVIS (Paul Bettany / British AI)</option>
                          <option value="edge_tts">Microsoft Edge TTS (Neural Cloud)</option>
                          <option value="web_speech">Web Speech API (Local System)</option>
                        </select>
                      </Row>
                    </Group>

                    {/* Mark LV JARVIS Voice Section */}
                    {settings.ttsProvider === "mark_lv_jarvis" && (
                      <Group title="Mark LV JARVIS Voice" hint="Ported directly from Mark LV 5 JARVIS HUD references.">
                        <Row label="JARVIS Voice Model" description="Select the British or US JARVIS tone profile.">
                          <select
                            aria-label="JARVIS Voice Model"
                            value={settings.ttsVoice || "en-GB-RyanNeural"}
                            onChange={(e) => onChange({ ttsVoice: e.target.value })}
                            className="max-w-[14rem] rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none cursor-pointer"
                          >
                            {MARK_LV_VOICES.map((v) => (
                              <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                          </select>
                        </Row>
                        <Row label="Test Voice" description="Play an instant audio preview of the JARVIS neural model.">
                          <button
                            type="button"
                            onClick={() => {
                              const tts = new BrowserTts();
                              tts.speak("JAYRA systems online. JARVIS neural voice active and operational.", {
                                provider: settings.ttsProvider,
                                voiceURI: settings.ttsVoice || "en-GB-RyanNeural",
                                rate: settings.speechRate,
                                pitch: settings.speechPitch,
                                volume: settings.speechVolume,
                              });
                            }}
                            className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/20 cursor-pointer transition flex items-center gap-1.5"
                          >
                            <Volume2 size={13} className="text-cyan-400" /> Play Voice Sample
                          </button>
                        </Row>
                        <SliderRow label="Speech rate" value={settings.speechRate} min={0.5} max={2} step={0.05} unit="x" onChange={(v) => onChange({ speechRate: v })} />
                        <SliderRow label="Speech pitch" value={settings.speechPitch} min={0.5} max={2} step={0.1} onChange={(v) => onChange({ speechPitch: v })} />
                        <SliderRow label="Speech volume" value={Math.round(settings.speechVolume * 100)} min={0} max={100} unit="%" onChange={(v) => onChange({ speechVolume: v / 100 })} />
                      </Group>
                    )}

                    {/* Edge TTS Section */}
                    {settings.ttsProvider === "edge_tts" && (
                      <Group title="Microsoft Edge TTS" hint="High-quality online neural voices with natural cadence.">
                        <Row label="Neural Voice" description="Online neural voices from Edge TTS platform.">
                          <select
                            aria-label="Neural Voice"
                            value={settings.ttsVoice || "en-GB-RyanNeural"}
                            onChange={(e) => onChange({ ttsVoice: e.target.value })}
                            className="max-w-[14rem] rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none cursor-pointer"
                          >
                            {EDGE_TTS_POPULAR_VOICES.map((v) => (
                              <option key={v.id} value={v.id}>{v.name} ({v.tone})</option>
                            ))}
                          </select>
                        </Row>
                        <Row label="Test Voice" description="Play an instant audio preview of the Edge neural voice.">
                          <button
                            type="button"
                            onClick={() => {
                              const tts = new BrowserTts();
                              tts.speak("JAYRA systems online. Microsoft Edge neural voice synthesis operational.", {
                                provider: settings.ttsProvider,
                                voiceURI: settings.ttsVoice || "en-GB-RyanNeural",
                                rate: settings.speechRate,
                                pitch: settings.speechPitch,
                                volume: settings.speechVolume,
                              });
                            }}
                            className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/20 cursor-pointer transition flex items-center gap-1.5"
                          >
                            <Volume2 size={13} className="text-cyan-400" /> Play Voice Sample
                          </button>
                        </Row>
                        <SliderRow label="Speech rate" value={settings.speechRate} min={0.5} max={2} step={0.05} unit="x" onChange={(v) => onChange({ speechRate: v })} />
                        <SliderRow label="Speech pitch" value={settings.speechPitch} min={0.5} max={2} step={0.1} onChange={(v) => onChange({ speechPitch: v })} />
                        <SliderRow label="Speech volume" value={Math.round(settings.speechVolume * 100)} min={0} max={100} unit="%" onChange={(v) => onChange({ speechVolume: v / 100 })} />
                      </Group>
                    )}

                    {/* Gemini Live Native Voice Section */}
                    {(!settings.ttsProvider || settings.ttsProvider === "gemini") && app && (
                      <Group title="Gemini Live Voice">
                        <Row label="Voice" description="Used from the next time you connect.">
                          <select aria-label="Voice" value={app.voice.voiceName} onChange={(e) => patch({ voice: { voiceName: e.target.value } })}
                            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none cursor-pointer">
                            {VOICES.map(([v, note]) => <option key={v} value={v}>{note ? `${v} — ${note}` : v}</option>)}
                          </select>
                        </Row>
                        <Row label="Speaking style" description="Anime: bright, cute and lively delivery with little giggles. Used from the next time you connect.">
                          <Choice label="Speaking style" value={app.voice.style} options={[["natural", "Natural"], ["anime", "Anime girl"]]} onChange={(v) => patch({ voice: { style: v } })} />
                        </Row>
                        <Row label="Voice pitch" description="Lifts her voice higher and younger-sounding. Used from the next time you connect.">
                          <select aria-label="Voice pitch" value={String(app.voice.pitch ?? 0)} onChange={(e) => patch({ voice: { pitch: Number(e.target.value) } })}
                            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none cursor-pointer">
                            {[[0, "Normal"], [1, "+1 (slightly higher)"], [2, "+2 (cute)"], [3, "+3 (very cute)"], [4, "+4"], [5, "+5 (max)"]].map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                          </select>
                        </Row>
                        <Row label="Spoken task updates" description="What JAYRA says out loud while she works on your PC.">
                          <Choice label="Spoken task updates" value={app.voice.speakTaskUpdates} options={[["all", "Everything"], ["important", "Important"], ["none", "Nothing"]]} onChange={(v) => patch({ voice: { speakTaskUpdates: v } })} />
                        </Row>
                        <ToggleRow label="Show Subtitles" description="Display spoken captions in a non-intrusive floating toast bar." checked={app.voice.showSubtitles ?? true} onChange={(v) => patch({ voice: { showSubtitles: v } })} />
                      </Group>
                    )}

                    {/* Web Speech Section */}
                    {settings.ttsProvider === "web_speech" && (
                      <Group title="Browser speech synthesis" hint="Local offline voices provided by your operating system.">
                        <Row label="System voice" description="System speech voices available in this browser.">
                          <select aria-label="System voice" value={settings.ttsVoice} onChange={(e) => onChange({ ttsVoice: e.target.value })}
                            className="max-w-[14rem] rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none cursor-pointer">
                            <option value="">System default</option>
                            {speechVoices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>)}
                          </select>
                        </Row>
                        <Row label="Test Voice" description="Play an instant audio preview of the system speech synthesis voice.">
                          <button
                            type="button"
                            onClick={() => {
                              const tts = new BrowserTts();
                              tts.speak("JAYRA systems online. Local system speech synthesis active.", {
                                provider: settings.ttsProvider,
                                voiceURI: settings.ttsVoice,
                                rate: settings.speechRate,
                                pitch: settings.speechPitch,
                                volume: settings.speechVolume,
                              });
                            }}
                            className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/20 cursor-pointer transition flex items-center gap-1.5"
                          >
                            <Volume2 size={13} className="text-cyan-400" /> Play Voice Sample
                          </button>
                        </Row>
                        <SliderRow label="Speech rate" value={settings.speechRate} min={0.5} max={2} step={0.05} unit="x" onChange={(v) => onChange({ speechRate: v })} />
                        <SliderRow label="Speech pitch" value={settings.speechPitch} min={0.5} max={2} step={0.1} onChange={(v) => onChange({ speechPitch: v })} />
                        <SliderRow label="Speech volume" value={Math.round(settings.speechVolume * 100)} min={0} max={100} unit="%" onChange={(v) => onChange({ speechVolume: v / 100 })} />
                      </Group>
                    )}
                    <Group title="Wake word & microphone">
                      <ToggleRow label="Wake word" description="Listen for the phrase below while JAYRA is asleep." checked={settings.wakeWordEnabled} onChange={(v) => onChange({ wakeWordEnabled: v })} />
                      <Row label="Wake phrase">
                        <input type="text" aria-label="Wake phrase" value={settings.wakePhrase} onChange={(e) => onChange({ wakePhrase: e.target.value })} placeholder="hey jayra"
                          className="w-40 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-400/50" />
                      </Row>
                      <Row label="Microphone" description={mics.length ? `${mics.length} found` : "Allow microphone access to list devices"}>
                        <select aria-label="Microphone" value={settings.micDeviceId} onChange={(e) => onChange({ micDeviceId: e.target.value })}
                          className="max-w-[12rem] rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none cursor-pointer">
                          <option value="">System default</option>
                          {mics.map((m, i) => <option key={m.deviceId || i} value={m.deviceId}>{m.label || `Microphone ${i + 1}`}</option>)}
                        </select>
                      </Row>
                      <SliderRow label="Wake-word sensitivity" description="Higher reacts faster but may trigger by mistake." value={settings.sensitivity} min={0} max={100} onChange={(v) => onChange({ sensitivity: v })} />
                    </Group>
                    <Note>The wake word only works while this window is open (it can be minimised).</Note>
                  </div>
                )}

                {section === "agent" && app && <AgentSection app={app} patch={patch} />}

                {section === "gestures" && app && <GesturesSection app={app} patch={patch} />}

                {section === "hud" && app && <HudSection app={app} patch={patch} onOpenStudio={onOpenStudio} />}

                {section === "codeEditor" && app && <CodeEditorSection app={app} patch={patch} />}

                {section === "models3d" && app && <HudSection app={app} patch={patch} onOpenStudio={onOpenStudio} />}

                {section === "privacy" && <PrivacySection />}

                {section === "presence" && app && (
                  <div className="space-y-5">
                    <Group title="Living Companion & Screen Consciousness" hint="When active, JAYRA observes desktop activity trends and spontaneously initiates contextual banter, witty observations, and roasts matching her active persona.">
                      <ToggleRow label="Autonomous Screen Companion" description="Allows JAYRA to periodically comment on what you're working on, games being played, or tabs open." checked={app.behavior.proactiveCompanionEnabled} onChange={(v) => patch({ behavior: { proactiveCompanionEnabled: v } })} />
                      <ToggleRow label="Focus Mode / Deep Work" description="Completely silences all spontaneous chat, commentary, and non-critical alerts for distraction-free work." checked={app.behavior.focusMode} onChange={(v) => patch({ behavior: { focusMode: v } })} />
                      {app.behavior.focusMode && (
                        <Row label="Focus duration" description="How long Focus Mode should stay active before resuming autonomous companionship.">
                          <select aria-label="Focus duration" value={app.behavior.focusModeDurationMin ?? 0} onChange={(e) => {
                            const val = Number(e.target.value);
                            patch({ behavior: { focusModeDurationMin: val === 0 ? null : val } });
                          }}>
                            <option value={0}>Until turned off manually</option>
                            <option value={25}>25 minutes (Pomodoro)</option>
                            <option value={50}>50 minutes</option>
                            <option value={90}>90 minutes</option>
                            <option value={120}>2 hours</option>
                          </select>
                        </Row>
                      )}
                    </Group>
                    <Group title="When you step away">
                      <SliderRow label="Count me as away after" value={app.behavior.awayAfterMin} min={2} max={60} unit=" min" onChange={(v) => patch({ behavior: { awayAfterMin: v } })} />
                      <ToggleRow label="Check in when I'm away" description="A gentle one-line check after a long break." checked={app.behavior.awayCheckin} onChange={(v) => patch({ behavior: { awayCheckin: v } })} />
                      <ToggleRow label="Welcome me back" description="A short greeting when you return." checked={app.behavior.returnGreeting} onChange={(v) => patch({ behavior: { returnGreeting: v } })} />
                    </Group>
                    <Group title="Automatic do not disturb">
                      <ToggleRow label="During full-screen apps and games" checked={app.behavior.autoDndFullscreen} onChange={(v) => patch({ behavior: { autoDndFullscreen: v } })} />
                      <ToggleRow label="During meetings and calls" checked={app.behavior.autoDndMeetings} onChange={(v) => patch({ behavior: { autoDndMeetings: v } })} />
                      <ToggleRow label="While recording software runs" checked={app.behavior.autoDndRecording} onChange={(v) => patch({ behavior: { autoDndRecording: v } })} />
                    </Group>
                    <Group title="Smart break & wellness alerts" hint="Activity is measured locally. Alerts pause during full-screen apps, meetings, Do Not Disturb, locked sessions, and extended inactivity.">
                      <ToggleRow label="Enable health and break alerts" checked={app.wellness.enabled} onChange={(value) => patch({ wellness: { enabled: value } })} />
                      {app.wellness.enabled && (
                        <>
                          <Row label="Activity interval" description="How long to be active before a wellness reminder.">
                            <select aria-label="Wellness alert interval" value={app.wellness.intervalMinutes}
                              onChange={(event) => patch({ wellness: { intervalMinutes: Number(event.target.value) as AppSettings["wellness"]["intervalMinutes"] } })}
                              className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none">
                              <option value={30}>30 minutes</option>
                              <option value={45}>45 minutes</option>
                              <option value={60}>60 minutes</option>
                            </select>
                          </Row>
                          <ToggleRow label="Speak wellness alerts" description="Uses an active voice session only; it will never start the microphone or interrupt a protected full-screen session." checked={app.wellness.voiceAlerts} onChange={(value) => patch({ wellness: { voiceAlerts: value } })} />
                          <WellnessMessageEditor label="Break message" value={app.wellness.breakMessage} onChange={(value) => patch({ wellness: { breakMessage: value } })} />
                          <WellnessMessageEditor label="Water message" value={app.wellness.waterMessage} onChange={(value) => patch({ wellness: { waterMessage: value } })} />
                          <WellnessMessageEditor label="Eye rest message" value={app.wellness.eyeRestMessage} onChange={(value) => patch({ wellness: { eyeRestMessage: value } })} />
                        </>
                      )}
                    </Group>
                    <UtilitiesManager />
                  </div>
                )}

                {section === "character" && (
                  <div className="space-y-5">
                    <Group title="Character">
                      <Row label="Character Studio" description="Change character, import your own models, pose, fingers and hair/cloth physics.">
                        <button type="button" onClick={onOpenStudio} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-slate-200 hover:bg-white/10 cursor-pointer">
                          <Wrench size={12} /> Open
                        </button>
                      </Row>
                      {app && (
                        <Row label="Graphics quality" description="Lower = less GPU memory and fewer crashes. Optimized: smaller textures, 30 fps, no cloth. Potato PC: lowest resolution, no shadows, 24 fps, and she is drawn only once (on the desktop) when the desktop companion is on. Auto picks for your PC and steps down by itself if she crashes.">
                          <select aria-label="Graphics quality" value={app.graphics?.quality ?? "auto"}
                            onChange={(e) => {
                              const quality = e.target.value as AppSettings["graphics"]["quality"];
                              // Re-create her right away with the new budget (both windows reload).
                              void api.updateAppSettings({ graphics: { quality, autoStep: 0 } }).catch(() => undefined).then(() => window.location.reload());
                            }}
                            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none cursor-pointer">
                            <option value="auto">Auto (recommended)</option>
                            <option value="high">High</option>
                            <option value="balanced">Medium</option>
                            <option value="low">Optimized</option>
                            <option value="potato">Potato PC</option>
                          </select>
                        </Row>
                      )}
                      {app && (
                        <SliderRow label="Realism" description="0% is flat anime shading. Higher adds skin depth, fabric sheen and soft studio reflections."
                          value={Math.round((app.graphics?.realism ?? 0.85) * 100)} min={0} max={100} step={5} unit="%"
                          onChange={(v) => patch({ graphics: { realism: v / 100 } })} />
                      )}
                      {app && (
                        <Row label="Eye Focus Mode" description="Screen focus keeps her gaze on you; cursor follow adds subtle eye and head tracking.">
                          <Choice label="Eye Focus Mode" value={app.character.eyeFollowCursor ? "cursor" : "screen"}
                            options={[["screen", "Fixed / Screen"], ["cursor", "Follow Cursor"]]}
                            onChange={(value) => patch({ character: { eyeFollowCursor: value === "cursor" } })} />
                        </Row>
                      )}
                      {app && (
                        <ToggleRow label="Enable Desktop Manga Bubbles" description="Show JAYRA's spoken dialogue in a manga-style bubble only while the desktop companion overlay is active. Windowed mode keeps its existing subtitle panel."
                          checked={app.companion.mangaBubbles} onChange={(value) => patch({ companion: { mangaBubbles: value } })} />
                      )}
                      {app && (
                        <ToggleRow label="Real cloth" description="Clothes move like fabric: they swing and trail when she moves, and you can drag them with the mouse. They always stay on."
                          checked={app.physics.clothEnabled ?? true} onChange={(v) => patch({ physics: { clothEnabled: v } })} />
                      )}
                      {app && (app.physics.clothEnabled ?? true) && (
                        <SliderRow label="Cloth looseness" description="How much the fabric swings away from her body."
                          value={Math.round((app.physics.clothLooseness ?? 1) * 100)} min={0} max={200} step={10} unit="%"
                          onChange={(v) => patch({ physics: { clothLooseness: v / 100 } })} />
                      )}
                      <SliderRow label="Shine" description="Reflection highlights on the character (not scene brightness)." value={settings.characterShine} min={0} max={100} unit="%" onChange={(v) => onChange({ characterShine: v })} />
                    </Group>
                    {app && (
                      <Group title="Desktop companion" hint="JAYRA standing on your desktop or taskbar outside this window. Drag her around; right-click for options.">
                        <ToggleRow label="Show on the desktop" checked={app.companion.enabled} onChange={(v) => patch({ companion: { enabled: v } })} />
                        <SliderRow label="Size" value={Math.round(app.companion.scale * 100)} min={40} max={250} step={5} unit="%" onChange={(v) => patch({ companion: { scale: v / 100 } })} />
                        <Row label="In full-screen apps and games" description="What the companion does when something goes full screen.">
                          <select aria-label="Full-screen behaviour" value={app.companion.fullscreenBehavior} onChange={(e) => patch({ companion: { fullscreenBehavior: e.target.value as AppSettings["companion"]["fullscreenBehavior"] } })}
                            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none cursor-pointer">
                            <option value="game_aware">Hide in games</option>
                            <option value="hide">Always hide</option>
                            <option value="notifications_only">Only for alerts</option>
                            <option value="always">Stay visible</option>
                          </select>
                        </Row>
                        <Row label="How lively" description="How often she does things on her own: walks, sits on window edges, stretches, peeks in from the screen edge.">
                          <select aria-label="Companion liveliness" value={app.companion.interactionLevel} onChange={(e) => patch({ companion: { interactionLevel: e.target.value as AppSettings["companion"]["interactionLevel"] } })}
                            className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white outline-none cursor-pointer">
                            <option value="minimal">Calm</option>
                            <option value="normal">Normal</option>
                            <option value="playful">Playful</option>
                          </select>
                        </Row>
                        <ToggleRow label="Walk around" description="She strolls along the taskbar and window tops." checked={app.companion.walkAround} onChange={(v) => patch({ companion: { walkAround: v } })} />
                        <ToggleRow label="Hide and peek" description="Now and then she slips behind a screen edge, then peeks back in, hands first. Talking to her calls her out." checked={app.companion.hideAndPeek ?? true} onChange={(v) => patch({ companion: { hideAndPeek: v } })} />
                        <ToggleRow label="Shy cursor reactions" description="A gentle expression when the pointer first reaches her silhouette; does not change click-through or drag behavior." checked={app.companion.cursorReactions} onChange={(v) => patch({ companion: { cursorReactions: v } })} />
                        <ToggleRow label="Dance with voice audio" description="A short procedural sway when JAYRA is speaking. Audio is analyzed locally and never recorded for this reaction." checked={app.companion.danceOnAudio} onChange={(v) => patch({ companion: { danceOnAudio: v } })} />
                        <Row label="Mini-games" description="Play Tic-Tac-Toe against JAYRA’s perfect-play opponent.">
                          <button type="button" onClick={() => setShowMiniGames(true)} className="flex items-center gap-1.5 rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-3 py-1.5 text-[11px] text-cyan-100 hover:bg-cyan-400/20">
                            <Gamepad2 size={13} /> Play
                          </button>
                        </Row>
                        <ToggleRow label="Play with desktop icons" description="She may tug an icon out of place. Its old spot is saved; say “put the icons back” (or use her right-click menu) and she restores every icon she moved." checked={app.companion.iconPlay ?? false} onChange={(v) => patch({ companion: { iconPlay: v } })} />
                        <SliderRow label="Stand out from the wallpaper" description="A thin outline and soft shadow so she never blends into a busy background." value={Math.round((app.companion.standOut ?? 0.7) * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => patch({ companion: { standOut: v / 100 } })} />
                      </Group>
                    )}
                    <CustomAssetManager onUseModel={(customModelPath) => patch({ models3d: { activeModel: "custom", customModelPath } })} />
                  </div>
                )}

                {section === "system" && app && <SystemSection app={app} settings={settings} onChange={onChange} patch={patch} onRestartOnboarding={onRestartOnboarding} />}

                {section === "about" && (
                  <div className="space-y-5">
                    <Group title="JAYRA">
                      <Row label="Version"><span className="font-mono text-[11px] text-slate-300">0.1</span></Row>
                      <Row label="Created by"><span className="text-[11px] text-slate-300">Honey King (هنی کنگ)</span></Row>
                      <Row label="AI"><span className="text-[11px] text-slate-300">Google Gemini, with your own key</span></Row>
                      <Row label="PC control"><span className="text-[11px] text-slate-300">Local desktop agent, permission-checked</span></Row>
                    </Group>
                    <Note>
                      JAYRA’s architecture and selected source snippets draw inspiration from open-source projects and public references. Their original authors retain credit for their respective work.
                    </Note>
                    <Note tone="warn">
                      <AlertTriangle size={12} className="mr-1 inline" />
                      Characters you import stay on this PC. Many fan-made models forbid redistribution, so JAYRA never uploads or shares them.
                    </Note>
                    <Note tone="ok"><Check size={12} className="mr-1 inline" /><Eye size={12} className="mr-1 inline" /> Everything runs locally except requests to the AI provider you chose.</Note>
                    <Note><MonitorSmartphone size={12} className="mr-1 inline" /> Tip: in the main view, WASD rotates the camera and Q/E zooms.</Note>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
    {showMiniGames && <MiniGamesHub onClose={() => setShowMiniGames(false)} />}
    </>
  );
}
