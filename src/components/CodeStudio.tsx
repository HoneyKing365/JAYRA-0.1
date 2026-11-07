/**
 * JAYRA Autonomous Code Studio — Professional-Grade IDE & Autonomous Coding Environment
 *
 * Inspired by VS Code and Antigravity IDE architecture:
 *  - Multi-tab file management (concurrent open files, dirty indicators, tab closing, shortcuts)
 *  - Synchronized scrolling line numbers with active cursor line highlighting & auto-indentation
 *  - Recursive interactive file & folder tree explorer (expand/collapse, create, rename, delete)
 *  - Autonomous AI Copilot & Tool Generation dock (self-coding, refactoring, agent dispatch)
 *  - Project template scaffolding (JAYRA Cognitive Tools, React Components, Express Routes, Python Workers)
 *  - Integrated workspace terminal runner with command history and diagnostic outputs
 *  - Dark cybernetic JARVIS / Zorion aesthetic with zero-lag performance
 */

import React, { useEffect, useState, useRef, useMemo } from "react";
import {
  Folder, FolderOpen, FileCode, FileText, File, Save, Sparkles, Terminal, Play,
  ChevronRight, ChevronDown, Loader2, X, Code2,
  Trash2, Edit3, Search, Maximize2, Minimize2, FilePlus, FolderPlus,
  Layers, Braces, TerminalSquare, RefreshCw
} from "lucide-react";
import type { AppSettings } from "../lib/appApi";
import { CodeHighlightEditor } from "./codeStudio/CodeHighlightEditor";

export interface WorkspaceItem {
  name: string;
  isDir: boolean;
  path: string;
  children?: WorkspaceItem[];
  isExpanded?: boolean;
  loadingChildren?: boolean;
}

export interface EditorTab {
  path: string;
  name: string;
  content: string;
  savedContent: string;
  isDirty: boolean;
  cursorLine: number;
  cursorCol: number;
  scrollRatio: number;
}

interface CodeStudioProps {
  isOpen: boolean;
  onClose: () => void;
  appSettings: AppSettings | null;
  onRunAgentTask?: (goal: string) => void;
}

// Helpers for file icons & language detection
function getFileLanguage(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "ts":
    case "tsx":
      return "TypeScript";
    case "js":
    case "jsx":
      return "JavaScript";
    case "py":
      return "Python";
    case "json":
      return "JSON";
    case "md":
      return "Markdown";
    case "html":
      return "HTML";
    case "css":
    case "scss":
      return "CSS";
    case "xml":
    case "svg":
      return "XML";
    case "sh":
    case "bash":
    case "ps1":
    case "bat":
      return "Shell";
    case "yml":
    case "yaml":
      return "YAML";
    default:
      return "Plain Text";
  }
}

function getFileIcon(fileName: string, isDir: boolean, isExpanded?: boolean) {
  if (isDir) {
    return isExpanded ? (
      <FolderOpen size={14} className="text-cyan-400 shrink-0" />
    ) : (
      <Folder size={14} className="text-cyan-500 shrink-0" />
    );
  }

  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "ts":
    case "tsx":
      return <FileCode size={14} className="text-cyan-400 shrink-0" />;
    case "js":
    case "jsx":
      return <FileCode size={14} className="text-yellow-400 shrink-0" />;
    case "py":
      return <FileCode size={14} className="text-emerald-400 shrink-0" />;
    case "json":
      return <Braces size={14} className="text-amber-400 shrink-0" />;
    case "md":
      return <FileText size={14} className="text-blue-400 shrink-0" />;
    case "html":
    case "css":
    case "scss":
      return <Code2 size={14} className="text-rose-400 shrink-0" />;
    default:
      return <File size={14} className="text-slate-400 shrink-0" />;
  }
}

export function CodeStudio({ isOpen, onClose, appSettings, onRunAgentTask }: CodeStudioProps) {
  // Workspace tree state
  const [rootPath, setRootPath] = useState<string>("");
  const [treeItems, setTreeItems] = useState<WorkspaceItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [treeLoading, setTreeLoading] = useState(false);

  // Tabs state
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);

  // Status & modal UI
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const sidebarWidth = 260;

  // File/Folder creation dialogs
  const [showCreateModal, setShowCreateModal] = useState<"file" | "folder" | "template" | null>(null);
  const [targetCreateDir, setTargetCreateDir] = useState<string>("");
  const [newItemName, setNewItemName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("jayra-tool");

  // Inline rename states
  const [renamingItem, setRenamingItem] = useState<{ path: string; currentName: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Terminal Runner state
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [terminalCommand, setTerminalCommand] = useState("");
  const [terminalOutput, setTerminalOutput] = useState("");
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [terminalExitCode, setTerminalExitCode] = useState<number | null>(null);

  // AI Copilot prompt state
  const isAiDockOpen = true;
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiStatus, setAiStatus] = useState<"idle" | "dispatching" | "ready">("idle");
  const [brainToolCount, setBrainToolCount] = useState<number | null>(null);
  const [brainLoading, setBrainLoading] = useState(false);
  const [pluginCount, setPluginCount] = useState<number | null>(null);
  const [pluginSyncing, setPluginSyncing] = useState(false);
  const [showToolGenerator, setShowToolGenerator] = useState(false);
  const [dynamicToolName, setDynamicToolName] = useState("");
  const [dynamicToolDescription, setDynamicToolDescription] = useState("");
  const [dynamicToolSchema, setDynamicToolSchema] = useState('{\n  "type": "object",\n  "properties": {},\n  "required": []\n}');
  const [dynamicToolCode, setDynamicToolCode] = useState("");
  const [dynamicToolSubmitting, setDynamicToolSubmitting] = useState(false);

  // References
  const terminalBottomRef = useRef<HTMLDivElement | null>(null);
  const lineNumbersRef = useRef<HTMLDivElement | null>(null);

  const refreshBrainRegistry = async (refreshSidecar = false) => {
    setBrainLoading(true);
    try {
      const response = await fetch(refreshSidecar ? "/api/brain/tools/refresh" : "/api/brain/tools", {
        method: refreshSidecar ? "POST" : "GET",
      });
      const data = await response.json() as { tools?: unknown[]; toolCount?: number; error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to load Brain tool registry.");
      setBrainToolCount(typeof data.toolCount === "number" ? data.toolCount : data.tools?.length ?? 0);
      const pluginsResponse = await fetch("/api/brain/plugins");
      const pluginsData = await pluginsResponse.json() as { plugins?: unknown[] };
      if (!pluginsResponse.ok) throw new Error("Failed to load plugin status.");
      setPluginCount(pluginsData.plugins?.length ?? 0);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to load Brain tool registry.");
    } finally {
      setBrainLoading(false);
    }
  };

  const syncPlugins = async () => {
    setPluginSyncing(true);
    try {
      const response = await fetch("/api/brain/plugins/sync", { method: "POST" });
      const data = await response.json() as { plugins?: unknown[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Plugin update sync failed.");
      await refreshBrainRegistry(true);
      setStatusMessage(`Plugin sync complete: ${data.plugins?.length ?? 0} package(s) updated.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Plugin update sync failed.");
    } finally {
      setPluginSyncing(false);
    }
  };

  useEffect(() => {
    if (isOpen) void refreshBrainRegistry();
  }, [isOpen]);

  const submitDynamicTool = async (event: React.FormEvent) => {
    event.preventDefault();
    let argumentsSchema: Record<string, unknown>;
    try {
      const parsed = JSON.parse(dynamicToolSchema) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("The arguments schema must be a JSON object.");
      }
      argumentsSchema = parsed as Record<string, unknown>;
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Invalid JSON schema.");
      return;
    }

    setDynamicToolSubmitting(true);
    try {
      const response = await fetch("/api/brain/tools/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spec: {
            name: dynamicToolName.trim(),
            description: dynamicToolDescription.trim(),
            arguments_schema: argumentsSchema,
            code: dynamicToolCode,
          },
        }),
      });
      const outcome = await response.json() as { status?: string; error?: string; success?: boolean };
      if (!response.ok) throw new Error(outcome.error || "Tool generation failed.");
      if (outcome.status === "confirmation_required") {
        setStatusMessage("Tool creation is waiting for your safety confirmation.");
      } else if (outcome.success) {
        setStatusMessage("Tool generated and registered with the Central Brain.");
        await refreshBrainRegistry(true);
        setShowToolGenerator(false);
      } else {
        throw new Error(outcome.error || "Tool generation failed.");
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Tool generation failed.");
    } finally {
      setDynamicToolSubmitting(false);
    }
  };

  // Active tab derived
  const activeTab = useMemo(() => {
    return tabs.find((t) => t.path === activeTabPath) || null;
  }, [tabs, activeTabPath]);

  // Configurations
  const ceConfig = appSettings?.codeEditor;
  const fontSize = ceConfig?.fontSize ?? 13;

  // -------------------------------------------------------------
  // Tree Loading & Expanding
  // -------------------------------------------------------------
  const loadDirectory = async (dir?: string): Promise<WorkspaceItem[]> => {
    try {
      const url = dir ? `/api/workspace/files?dir=${encodeURIComponent(dir)}` : "/api/workspace/files";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to list workspace files.");
      if (data.items) {
        if (!dir) setRootPath(data.root);
        return data.items.map((item: { name: string; isDir: boolean; path: string }) => ({
          ...item,
          isExpanded: false,
          children: item.isDir ? [] : undefined,
        }));
      }
      return [];
    } catch (err) {
      console.error("Error loading workspace directory:", err);
      setStatusMessage("Failed to list files");
      return [];
    }
  };

  const refreshTree = async () => {
    setTreeLoading(true);
    const items = await loadDirectory(ceConfig?.defaultWorkspace || undefined);
    setTreeItems(items);
    setTreeLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      void refreshTree();
    }
  }, [isOpen, ceConfig?.defaultWorkspace]);

  // Recursively toggle or load folder children
  const toggleFolder = async (folderPath: string) => {
    const updateRecursive = async (nodes: WorkspaceItem[]): Promise<WorkspaceItem[]> => {
      const result: WorkspaceItem[] = [];
      for (const node of nodes) {
        if (node.path === folderPath && node.isDir) {
          const nextExpanded = !node.isExpanded;
          let children = node.children || [];
          if (nextExpanded && (!children || children.length === 0)) {
            children = await loadDirectory(node.path);
          }
          result.push({ ...node, isExpanded: nextExpanded, children });
        } else if (node.isDir && node.children) {
          result.push({ ...node, children: await updateRecursive(node.children) });
        } else {
          result.push(node);
        }
      }
      return result;
    };

    const updated = await updateRecursive(treeItems);
    setTreeItems(updated);
  };

  // -------------------------------------------------------------
  // File Open & Tab Management
  // -------------------------------------------------------------
  const openFileInTab = async (filePath: string) => {
    const existing = tabs.find((t) => t.path === filePath);
    if (existing) {
      setActiveTabPath(filePath);
      return;
    }

    try {
      setStatusMessage(`Opening ${filePath.split(/[\\/]/).pop()}...`);
      const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to read file.");

      const content = data.content ?? "";
      const fileName = filePath.split(/[\\/]/).pop() || "untitled";
      const newTab: EditorTab = {
        path: filePath,
        name: fileName,
        content,
        savedContent: content,
        isDirty: false,
        cursorLine: 1,
        cursorCol: 1,
        scrollRatio: 0,
      };

      setTabs((prev) => [...prev, newTab]);
      setActiveTabPath(filePath);
      setStatusMessage(null);
    } catch (err) {
      console.error("Error opening workspace file:", err);
      setStatusMessage(err instanceof Error ? err.message : "Failed to open file");
    }
  };

  const closeTab = (path: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const tabToClose = tabs.find((t) => t.path === path);
    if (tabToClose?.isDirty) {
      if (!window.confirm(`"${tabToClose.name}" has unsaved changes. Discard changes and close?`)) {
        return;
      }
    }

    const nextTabs = tabs.filter((t) => t.path !== path);
    setTabs(nextTabs);

    if (activeTabPath === path) {
      if (nextTabs.length > 0) {
        setActiveTabPath(nextTabs[nextTabs.length - 1].path);
      } else {
        setActiveTabPath(null);
      }
    }
  };

  const updateActiveContent = (newContent: string) => {
    if (!activeTabPath) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.path === activeTabPath
          ? {
              ...t,
              content: newContent,
              isDirty: newContent !== t.savedContent,
            }
          : t,
      ),
    );
  };

  // -------------------------------------------------------------
  // File Saving
  // -------------------------------------------------------------
  const saveActiveFile = async () => {
    if (!activeTab) return;
    try {
      setStatusMessage(`Saving ${activeTab.name}...`);
      const res = await fetch("/api/workspace/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: activeTab.path, content: activeTab.content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save file.");

      setTabs((prev) =>
        prev.map((t) =>
          t.path === activeTab.path
            ? { ...t, savedContent: t.content, isDirty: false }
            : t,
        ),
      );
      setStatusMessage(`Saved ${activeTab.name}`);
      setTimeout(() => setStatusMessage(null), 2500);
    } catch (err) {
      console.error("Save error:", err);
      setStatusMessage(err instanceof Error ? err.message : "Failed to save file");
    }
  };

  // -------------------------------------------------------------
  // Synchronized Scrolling
  // -------------------------------------------------------------
  const handleEditorScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  // Cursor position tracking
  const handleTextareaSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const start = textarea.selectionStart;
    const val = textarea.value.slice(0, start);
    const lines = val.split("\n");
    const currentLine = lines.length;
    const currentCol = lines[lines.length - 1].length + 1;

    if (activeTabPath) {
      setTabs((prev) =>
        prev.map((t) =>
          t.path === activeTabPath ? { ...t, cursorLine: currentLine, cursorCol: currentCol } : t,
        ),
      );
    }
  };

  // -------------------------------------------------------------
  // Keyboard Shortcuts & Smart Indentation
  // -------------------------------------------------------------
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void saveActiveFile();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
      e.preventDefault();
      if (activeTabPath) closeTab(activeTabPath);
      return;
    }

    const textarea = e.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const content = textarea.value;

    // Tab / Shift+Tab
    if (e.key === "Tab") {
      e.preventDefault();
      if (!e.shiftKey) {
        const nextContent = content.substring(0, start) + "  " + content.substring(end);
        updateActiveContent(nextContent);
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        });
      } else {
        const lineStart = content.lastIndexOf("\n", start - 1) + 1;
        if (content.substring(lineStart, lineStart + 2) === "  ") {
          const nextContent = content.substring(0, lineStart) + content.substring(lineStart + 2);
          updateActiveContent(nextContent);
          requestAnimationFrame(() => {
            textarea.selectionStart = textarea.selectionEnd = Math.max(lineStart, start - 2);
          });
        }
      }
      return;
    }

    // Auto-indent on Enter
    if (e.key === "Enter") {
      e.preventDefault();
      const currentLineText = content.substring(0, start).split("\n").pop() || "";
      const match = currentLineText.match(/^(\s*)/);
      let indent = match ? match[1] : "";

      const trimmedEnd = currentLineText.trimEnd();
      if (trimmedEnd.endsWith("{") || trimmedEnd.endsWith("(") || trimmedEnd.endsWith("[") || trimmedEnd.endsWith(":")) {
        indent += "  ";
      }

      const nextContent = content.substring(0, start) + "\n" + indent + content.substring(end);
      updateActiveContent(nextContent);
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 1 + indent.length;
      });
      return;
    }

    // Bracket & quote auto-close
    const pairs: Record<string, string> = {
      "(": ")",
      "[": "]",
      "{": "}",
      '"': '"',
      "'": "'",
      "`": "`",
    };

    if (pairs[e.key]) {
      const closing = pairs[e.key];
      if (start !== end) {
        e.preventDefault();
        const selected = content.substring(start, end);
        const nextContent = content.substring(0, start) + e.key + selected + closing + content.substring(end);
        updateActiveContent(nextContent);
        requestAnimationFrame(() => {
          textarea.selectionStart = start + 1;
          textarea.selectionEnd = end + 1;
        });
      }
    }
  };

  // -------------------------------------------------------------
  // File & Folder Operations (Create, Rename, Delete)
  // -------------------------------------------------------------
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newItemName.trim();
    if (!name) return;

    const baseDir = targetCreateDir || rootPath;
    const targetPath = `${baseDir.replace(/[\\/]+$/, "")}\\${name}`;

    try {
      if (showCreateModal === "file") {
        const res = await fetch("/api/workspace/files/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: targetPath, content: "" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create file.");
        await refreshTree();
        await openFileInTab(data.path);
        setStatusMessage(`Created file: ${name}`);
      } else if (showCreateModal === "folder") {
        const res = await fetch("/api/workspace/folders/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: targetPath }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create folder.");
        await refreshTree();
        setStatusMessage(`Created folder: ${name}`);
      } else if (showCreateModal === "template") {
        const res = await fetch("/api/workspace/templates/scaffold", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateId: selectedTemplate, name, targetDir: baseDir }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to scaffold template.");
        await refreshTree();
        await openFileInTab(data.path);
        setStatusMessage(`Scaffolded ${selectedTemplate}: ${data.filename}`);
      }
      setShowCreateModal(null);
      setNewItemName("");
    } catch (err) {
      console.error("Create operation error:", err);
      setStatusMessage(err instanceof Error ? err.message : "Failed to create item");
    }
  };

  const handleRename = async () => {
    if (!renamingItem || !renameValue.trim()) return;
    const dir = renamingItem.path.substring(0, renamingItem.path.lastIndexOf("\\"));
    const newPath = `${dir}\\${renameValue.trim()}`;

    try {
      const res = await fetch("/api/workspace/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPath: renamingItem.path, newPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to rename item.");

      setTabs((prev) =>
        prev.map((t) =>
          t.path === renamingItem.path
            ? { ...t, path: newPath, name: renameValue.trim() }
            : t,
        ),
      );
      if (activeTabPath === renamingItem.path) setActiveTabPath(newPath);

      setRenamingItem(null);
      setRenameValue("");
      await refreshTree();
      setStatusMessage(`Renamed to ${renameValue.trim()}`);
    } catch (err) {
      console.error("Rename error:", err);
      setStatusMessage(err instanceof Error ? err.message : "Failed to rename");
    }
  };

  const handleDelete = async (targetPath: string) => {
    const itemName = targetPath.split(/[\\/]/).pop();
    if (!window.confirm(`Are you sure you want to delete "${itemName}"? This cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch("/api/workspace/files/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: targetPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete item.");

      closeTab(targetPath);
      await refreshTree();
      setStatusMessage(`Deleted ${itemName}`);
    } catch (err) {
      console.error("Delete error:", err);
      setStatusMessage(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  // -------------------------------------------------------------
  // Terminal Runner
  // -------------------------------------------------------------
  const runTerminalCommand = async (cmdToRun?: string) => {
    const cmd = (cmdToRun || terminalCommand).trim();
    if (!cmd) return;

    setTerminalRunning(true);
    setTerminalOutput((prev) => `${prev ? prev + "\n" : ""}> ${cmd}\nExecuting in workspace sandbox...`);
    setIsTerminalOpen(true);

    try {
      const res = await fetch("/api/workspace/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Command execution failed.");

      const result = data as { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean };
      setTerminalExitCode(result.exitCode);

      const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
      setTerminalOutput((prev) => `${prev}\n${combined || "(completed with no console output)"}\n[Exit code: ${result.exitCode}]`);
      setStatusMessage(`Exit code: ${result.exitCode}`);
      setTerminalCommand("");
    } catch (err) {
      console.error("Terminal execution error:", err);
      setTerminalOutput((prev) => `${prev}\n[Error]: ${err instanceof Error ? err.message : String(err)}`);
      setTerminalExitCode(1);
    } finally {
      setTerminalRunning(false);
      requestAnimationFrame(() => terminalBottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    }
  };

  // -------------------------------------------------------------
  // Autonomous JAYRA Copilot & Mind Execution
  // -------------------------------------------------------------
  const handleAiSynthesize = () => {
    if (!aiPrompt.trim()) return;
    setAiStatus("dispatching");

    const activeFileName = activeTab ? activeTab.path : "workspace files";
    const goal = `[JAYRA CODE STUDIO TASK]: Regarding file "${activeFileName}", execute the following implementation: ${aiPrompt}`;

    onRunAgentTask?.(goal);
    setStatusMessage("Task dispatched to JAYRA autonomous mind.");
    setAiPrompt("");
    setTimeout(() => setAiStatus("idle"), 2500);
  };

  const handleQuickAiAction = (actionType: string) => {
    if (!activeTab) return;
    let prompt = "";
    switch (actionType) {
      case "refactor":
        prompt = `Refactor this file for maximum readability, clean design, and modularity: ${activeTab.name}`;
        break;
      case "type-safety":
        prompt = `Ensure strict TypeScript types, runtime validation, and zero any types in ${activeTab.name}`;
        break;
      case "tests":
        prompt = `Generate comprehensive unit tests and verification steps for ${activeTab.name}`;
        break;
      case "doc":
        prompt = `Add clean JSDoc comments, type definitions, and architecture notes to ${activeTab.name}`;
        break;
    }
    setAiPrompt(prompt);
  };

  if (!isOpen) return null;

  // Filter tree items by search query
  const filterItems = (items: WorkspaceItem[], query: string): WorkspaceItem[] => {
    if (!query.trim()) return items;
    const lower = query.toLowerCase();
    const result: WorkspaceItem[] = [];

    for (const item of items) {
      if (item.name.toLowerCase().includes(lower)) {
        result.push(item);
      } else if (item.isDir && item.children) {
        const matchingChildren = filterItems(item.children, query);
        if (matchingChildren.length > 0) {
          result.push({ ...item, isExpanded: true, children: matchingChildren });
        }
      }
    }
    return result;
  };

  const visibleTree = filterItems(treeItems, searchQuery);
  const lineCount = activeTab ? activeTab.content.split("\n").length : 0;

  // Recursive Tree Node Renderer
  const renderTreeNodes = (nodes: WorkspaceItem[], depth = 0) => {
    return nodes.map((node) => {
      const isSelected = activeTabPath === node.path;
      return (
        <div key={node.path} className="select-none">
          <div
            className={`group relative flex items-center justify-between py-1 px-1.5 rounded-md cursor-pointer transition-colors text-xs font-mono ${
              isSelected
                ? "bg-cyan-950/80 text-cyan-300 border border-cyan-500/40"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
            style={{ paddingLeft: `${depth * 14 + 6}px` }}
            onClick={() => (node.isDir ? toggleFolder(node.path) : openFileInTab(node.path))}
          >
            <div className="flex items-center gap-1.5 truncate min-w-0">
              {node.isDir && (
                <span className="text-slate-500 hover:text-cyan-400">
                  {node.isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </span>
              )}
              {getFileIcon(node.name, node.isDir, node.isExpanded)}
              <span className="truncate">{node.name}</span>
            </div>

            {/* Quick action buttons on hover */}
            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 shrink-0 ml-1">
              {node.isDir && (
                <>
                  <button
                    type="button"
                    title="New file here"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTargetCreateDir(node.path);
                      setShowCreateModal("file");
                    }}
                    className="p-0.5 text-slate-400 hover:text-cyan-300"
                  >
                    <FilePlus size={11} />
                  </button>
                  <button
                    type="button"
                    title="New folder here"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTargetCreateDir(node.path);
                      setShowCreateModal("folder");
                    }}
                    className="p-0.5 text-slate-400 hover:text-cyan-300"
                  >
                    <FolderPlus size={11} />
                  </button>
                </>
              )}
              <button
                type="button"
                title="Rename"
                onClick={(e) => {
                  e.stopPropagation();
                  setRenamingItem({ path: node.path, currentName: node.name });
                  setRenameValue(node.name);
                }}
                className="p-0.5 text-slate-400 hover:text-yellow-400"
              >
                <Edit3 size={11} />
              </button>
              <button
                type="button"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDelete(node.path);
                }}
                className="p-0.5 text-slate-400 hover:text-rose-400"
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>

          {node.isDir && node.isExpanded && node.children && (
            <div>{renderTreeNodes(node.children, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  return (
    <div
      className={`fixed z-50 flex items-center justify-center bg-black/85 backdrop-blur-md transition-all ${
        isFullscreen ? "inset-0 p-0" : "inset-4 sm:inset-6"
      }`}
    >
      <div className="flex h-full w-full flex-col rounded-2xl border border-cyan-500/30 bg-[#060c14] shadow-2xl overflow-hidden font-sans">
        {/* TOP WINDOW HEADER */}
        <div className="flex h-11 items-center justify-between border-b border-cyan-500/20 bg-[#08121f] px-3 select-none">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Code2 size={17} className="text-cyan-400" />
              <h2 className="font-mono text-xs font-bold tracking-wider text-cyan-200 uppercase">
                JAYRA Code Studio
              </h2>
            </div>
            <span className="rounded bg-cyan-950/80 px-2 py-0.5 font-mono text-[10px] text-cyan-400 border border-cyan-500/30">
              v2.0 IDE
            </span>
            <button
              type="button"
              onClick={() => void refreshBrainRegistry(true)}
              disabled={brainLoading}
              title="Refresh Central Brain tool registry"
              className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-950/30 px-2 py-0.5 font-mono text-[10px] text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50"
            >
              <RefreshCw size={10} className={brainLoading ? "animate-spin" : ""} />
              Brain {brainToolCount === null ? "…" : brainToolCount}
            </button>
            <button
              type="button"
              onClick={() => setShowToolGenerator(true)}
              className="rounded border border-purple-500/30 bg-purple-950/30 px-2 py-0.5 font-mono text-[10px] text-purple-300 hover:bg-purple-900/40"
              title="Create a validated dynamic desktop tool"
            >
              + Tool
            </button>
            <button
              type="button"
              onClick={() => void syncPlugins()}
              disabled={pluginSyncing}
              title="Synchronize signed plugins from the configured update endpoint"
              className="flex items-center gap-1 rounded border border-amber-500/30 bg-amber-950/30 px-2 py-0.5 font-mono text-[10px] text-amber-300 hover:bg-amber-900/40 disabled:opacity-50"
            >
              <RefreshCw size={10} className={pluginSyncing ? "animate-spin" : ""} />
              Plugins {pluginCount === null ? "…" : pluginCount}
            </button>
            {rootPath && (
              <span className="hidden md:inline font-mono text-[10px] text-slate-500 truncate max-w-xs">
                {rootPath}
              </span>
            )}
          </div>

          {/* Quick Actions & Window Controls */}
          <div className="flex items-center gap-2">
            {activeTab && (
              <button
                type="button"
                onClick={() => void saveActiveFile()}
                disabled={!activeTab.isDirty}
                className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-950/60 px-2.5 py-1 text-xs font-mono text-cyan-300 hover:bg-cyan-900/50 disabled:opacity-40 transition cursor-pointer"
              >
                <Save size={13} />
                <span>Save (Ctrl+S)</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setTargetCreateDir(rootPath);
                setShowCreateModal("template");
              }}
              className="flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-950/60 px-2.5 py-1 text-xs font-mono text-purple-300 hover:bg-purple-900/50 transition cursor-pointer"
            >
              <Layers size={13} />
              <span>Scaffold Module</span>
            </button>

            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition cursor-pointer"
              title={isFullscreen ? "Restore window" : "Maximize window"}
            >
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/20 hover:text-rose-400 transition cursor-pointer"
              title="Close Code Studio"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* MAIN BODY: SIDEBAR + EDITOR + COPILOT */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* SIDEBAR: FILE EXPLORER */}
          <div
            className="flex flex-col border-r border-cyan-500/20 bg-[#04080e] select-none shrink-0"
            style={{ width: `${sidebarWidth}px` }}
          >
            {/* Explorer Toolbar */}
            <div className="flex items-center justify-between border-b border-white/5 p-2 px-3">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Explorer
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="New File"
                  onClick={() => {
                    setTargetCreateDir(rootPath);
                    setShowCreateModal("file");
                  }}
                  className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-cyan-300 cursor-pointer"
                >
                  <FilePlus size={13} />
                </button>
                <button
                  type="button"
                  title="New Folder"
                  onClick={() => {
                    setTargetCreateDir(rootPath);
                    setShowCreateModal("folder");
                  }}
                  className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-cyan-300 cursor-pointer"
                >
                  <FolderPlus size={13} />
                </button>
                <button
                  type="button"
                  title="Refresh"
                  onClick={() => void refreshTree()}
                  className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-cyan-300 cursor-pointer"
                >
                  <RefreshCw size={13} className={treeLoading ? "animate-spin text-cyan-400" : ""} />
                </button>
              </div>
            </div>

            {/* Tree Search Box */}
            <div className="p-2 border-b border-white/5">
              <div className="relative flex items-center">
                <Search size={12} className="absolute left-2 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search files..."
                  className="w-full rounded-md border border-white/10 bg-black/40 py-1 pl-7 pr-2 font-mono text-[11px] text-white placeholder-slate-500 outline-none focus:border-cyan-400/50"
                />
              </div>
            </div>

            {/* Tree Items List */}
            <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
              {treeLoading && treeItems.length === 0 ? (
                <div className="flex items-center justify-center p-6 text-xs text-slate-500 gap-2">
                  <Loader2 size={14} className="animate-spin text-cyan-400" />
                  <span>Loading workspace...</span>
                </div>
              ) : visibleTree.length === 0 ? (
                <div className="p-4 text-center font-mono text-xs text-slate-500">
                  {searchQuery ? "No matching files" : "Workspace is empty"}
                </div>
              ) : (
                renderTreeNodes(visibleTree)
              )}
            </div>

            {/* Bottom Quick Status */}
            <div className="border-t border-white/5 p-2 font-mono text-[10px] text-slate-500 flex items-center justify-between">
              <span>{visibleTree.length} items</span>
              <button
                type="button"
                onClick={() => setIsTerminalOpen(!isTerminalOpen)}
                className="text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <TerminalSquare size={12} />
                <span>Terminal</span>
              </button>
            </div>
          </div>

          {/* CENTER: MULTI-TAB EDITOR & BREADCRUMBS */}
          <div className="flex flex-1 flex-col min-w-0 bg-[#070d17]">
            {/* TAB BAR */}
            <div className="flex h-9 items-center border-b border-cyan-500/20 bg-[#050a12] overflow-x-auto select-none no-scrollbar">
              {tabs.length === 0 ? (
                <div className="px-3 font-mono text-[11px] text-slate-500 italic">No files open</div>
              ) : (
                tabs.map((tab) => {
                  const isActive = activeTabPath === tab.path;
                  return (
                    <div
                      key={tab.path}
                      onClick={() => setActiveTabPath(tab.path)}
                      onAuxClick={(e) => {
                        if (e.button === 1) closeTab(tab.path, e);
                      }}
                      className={`group flex items-center gap-2 border-r border-white/5 px-3 py-1.5 font-mono text-xs cursor-pointer transition shrink-0 ${
                        isActive
                          ? "bg-[#070d17] text-cyan-200 border-t-2 border-t-cyan-400"
                          : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                      }`}
                    >
                      {getFileIcon(tab.name, false)}
                      <span className="truncate max-w-[150px]">{tab.name}</span>
                      {tab.isDirty ? (
                        <span className="h-2 w-2 rounded-full bg-orange-400 shrink-0" title="Unsaved changes" />
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => closeTab(tab.path, e)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 hover:text-white"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* BREADCRUMB BAR */}
            {activeTab && (
              <div className="flex items-center gap-1.5 border-b border-white/5 bg-[#050c18] px-3 py-1 font-mono text-[11px] text-slate-400 select-none">
                <span className="text-cyan-500">workspace</span>
                {activeTab.path
                  .replace(rootPath, "")
                  .split(/[\\/]/)
                  .filter(Boolean)
                  .map((segment, idx, arr) => (
                    <React.Fragment key={idx}>
                      <ChevronRight size={11} className="text-slate-600" />
                      <span className={idx === arr.length - 1 ? "text-cyan-300 font-semibold" : "text-slate-400"}>
                        {segment}
                      </span>
                    </React.Fragment>
                  ))}
                {activeTab.isDirty && <span className="text-orange-400 font-bold ml-1">(Unsaved)</span>}
              </div>
            )}

            {/* CODE EDITOR WITH REAL-TIME SYNTAX HIGHLIGHTING & DUAL-LAYER SYNC */}
            {activeTab ? (
              <CodeHighlightEditor
                value={activeTab.content}
                onChange={updateActiveContent}
                fileName={activeTab.name}
                language={getFileLanguage(activeTab.name)}
                fontSize={fontSize}
                cursorLine={activeTab.cursorLine}
                onCursorChange={(line, col) => {
                  setTabs((prev) =>
                    prev.map((t) => (t.path === activeTab.path ? { ...t, cursorLine: line, cursorCol: col } : t))
                  );
                }}
                onSave={() => void saveActiveFile()}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-slate-500 font-mono text-xs gap-3">
                <Code2 size={42} className="text-slate-600 animate-pulse" />
                <span className="text-slate-400">Select a file from the explorer or scaffold a new module</span>
                <button
                  type="button"
                  onClick={() => {
                    setTargetCreateDir(rootPath);
                    setShowCreateModal("template");
                  }}
                  className="flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-950/40 px-3 py-1.5 font-mono text-xs text-cyan-300 hover:bg-cyan-900/40 transition cursor-pointer"
                >
                  <Layers size={13} />
                  <span>Open Template Scaffolder</span>
                </button>
              </div>
            )}

            {/* COLLAPSIBLE TERMINAL RUNNER */}
            {isTerminalOpen && (
              <div className="flex h-56 flex-col border-t border-cyan-500/20 bg-[#040810] shrink-0 font-mono">
                <div className="flex h-8 items-center justify-between border-b border-white/10 bg-[#060c18] px-3">
                  <div className="flex items-center gap-2">
                    <Terminal size={14} className="text-cyan-400" />
                    <span className="text-xs font-semibold text-cyan-200 uppercase">Workspace Terminal</span>
                    {terminalRunning && <Loader2 size={12} className="animate-spin text-cyan-400" />}
                    {terminalExitCode !== null && (
                      <span
                        className={`rounded px-1.5 py-0.2 text-[10px] ${
                          terminalExitCode === 0
                            ? "bg-emerald-950 text-emerald-400 border border-emerald-500/30"
                            : "bg-rose-950 text-rose-400 border border-rose-500/30"
                        }`}
                      >
                        Exit: {terminalExitCode}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setTerminalOutput("")}
                      className="text-[10px] text-slate-400 hover:text-white"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsTerminalOpen(false)}
                      className="text-slate-400 hover:text-white"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {/* Console Log Output */}
                <div className="flex-1 overflow-auto p-2 font-mono text-[11px] text-slate-300 bg-black/50 select-text">
                  <pre className="whitespace-pre-wrap">{terminalOutput || "Ready for command execution."}</pre>
                  <div ref={terminalBottomRef} />
                </div>

                {/* Command Input Dock */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runTerminalCommand();
                  }}
                  className="flex items-center gap-2 border-t border-white/5 bg-[#050a14] p-1.5 px-3"
                >
                  <span className="text-cyan-400 text-xs">$</span>
                  <input
                    type="text"
                    value={terminalCommand}
                    onChange={(e) => setTerminalCommand(e.target.value)}
                    placeholder="Enter command (e.g. npm test, npm run lint, git status)..."
                    className="flex-1 bg-transparent font-mono text-xs text-white placeholder-slate-600 outline-none"
                  />
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void runTerminalCommand("npm test")}
                      className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-cyan-300"
                    >
                      npm test
                    </button>
                    <button
                      type="submit"
                      disabled={terminalRunning || !terminalCommand.trim()}
                      className="flex items-center gap-1 rounded bg-cyan-900/60 border border-cyan-500/40 px-2 py-0.5 text-xs text-cyan-200 hover:bg-cyan-800/80 disabled:opacity-40 cursor-pointer"
                    >
                      <Play size={10} />
                      <span>Run</span>
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* STATUS FOOTER BAR */}
            <div className="flex h-7 items-center justify-between border-t border-white/10 bg-[#04080f] px-3 font-mono text-[10px] text-slate-500 select-none">
              <div className="flex items-center gap-3">
                {activeTab ? (
                  <>
                    <span>
                      Ln {activeTab.cursorLine}, Col {activeTab.cursorCol}
                    </span>
                    <span>{lineCount} lines</span>
                    <span>{getFileLanguage(activeTab.name)}</span>
                  </>
                ) : (
                  <span>Ready</span>
                )}
                {statusMessage && <span className="text-cyan-400 font-semibold">{statusMessage}</span>}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsTerminalOpen(!isTerminalOpen)}
                  className="text-slate-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                >
                  <Terminal size={11} />
                  <span>Terminal</span>
                </button>
                <span>UTF-8</span>
                <span>Spaces: 2</span>
                <span className="flex items-center gap-1 text-cyan-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                  JAYRA MIND ONLINE
                </span>
              </div>
            </div>
          </div>

          {/* RIGHT SIDE: AUTONOMOUS AI COPILOT DOCK */}
          {isAiDockOpen && (
            <div className="w-72 border-l border-cyan-500/20 bg-[#050a14] p-3 flex flex-col shrink-0">
              <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-3">
                <div className="flex items-center gap-1.5">
                  <Sparkles size={15} className="text-cyan-400 animate-pulse" />
                  <span className="font-mono text-xs font-semibold text-cyan-200 uppercase tracking-wider">
                    JAYRA Copilot
                  </span>
                </div>
                <span className="rounded bg-cyan-950/80 px-1.5 py-0.5 font-mono text-[9px] text-cyan-400 border border-cyan-500/30">
                  Autonomous
                </span>
              </div>

              {/* Quick Prompt Badges */}
              <div className="space-y-1.5 mb-3">
                <span className="font-mono text-[10px] text-slate-500 uppercase tracking-widest">
                  Quick Directives
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleQuickAiAction("refactor")}
                    disabled={!activeTab}
                    className="rounded border border-cyan-500/30 bg-cyan-950/40 p-1.5 text-left font-mono text-[10px] text-cyan-300 hover:bg-cyan-900/40 disabled:opacity-40 transition cursor-pointer"
                  >
                    ⚡ Refactor
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickAiAction("type-safety")}
                    disabled={!activeTab}
                    className="rounded border border-cyan-500/30 bg-cyan-950/40 p-1.5 text-left font-mono text-[10px] text-cyan-300 hover:bg-cyan-900/40 disabled:opacity-40 transition cursor-pointer"
                  >
                    🛡️ Type Safety
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickAiAction("tests")}
                    disabled={!activeTab}
                    className="rounded border border-cyan-500/30 bg-cyan-950/40 p-1.5 text-left font-mono text-[10px] text-cyan-300 hover:bg-cyan-900/40 disabled:opacity-40 transition cursor-pointer"
                  >
                    🧪 Unit Tests
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickAiAction("doc")}
                    disabled={!activeTab}
                    className="rounded border border-cyan-500/30 bg-cyan-950/40 p-1.5 text-left font-mono text-[10px] text-cyan-300 hover:bg-cyan-900/40 disabled:opacity-40 transition cursor-pointer"
                  >
                    📝 JSDoc & Types
                  </button>
                </div>
              </div>

              {/* Copilot Prompt Input Area */}
              <div className="flex-1 flex flex-col min-h-0 mb-3">
                <label className="font-mono text-[10px] text-slate-500 uppercase tracking-widest mb-1.5">
                  Autonomous Code Directive
                </label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Direct JAYRA to synthesize code, debug, refactor functions, or create new cognitive tools..."
                  className="flex-1 resize-none rounded-lg border border-cyan-500/30 bg-black/40 p-2.5 font-mono text-xs text-white placeholder-slate-600 outline-none focus:border-cyan-400"
                />
              </div>

              {/* Dispatch Button */}
              <button
                type="button"
                onClick={handleAiSynthesize}
                disabled={aiStatus === "dispatching" || !aiPrompt.trim()}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-900/60 py-2 font-mono text-xs text-cyan-200 hover:bg-cyan-800/80 disabled:opacity-40 transition cursor-pointer"
              >
                {aiStatus === "dispatching" ? (
                  <>
                    <Loader2 size={13} className="animate-spin text-cyan-400" />
                    <span>Dispatching Task...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={13} className="text-cyan-400" />
                    <span>Synthesize & Execute</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* MODAL: CREATE FILE / FOLDER / SCAFFOLD TEMPLATE */}
        {showCreateModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-xl border border-cyan-500/30 bg-[#08121f] p-5 shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
                <h3 className="font-mono text-sm font-semibold text-cyan-200 uppercase">
                  {showCreateModal === "file" && "Create New File"}
                  {showCreateModal === "folder" && "Create New Folder"}
                  {showCreateModal === "template" && "Scaffold Project Module"}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(null)}
                  className="rounded p-1 text-slate-400 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleCreateSubmit} className="space-y-4">
                {showCreateModal === "template" && (
                  <div>
                    <label className="block font-mono text-xs text-slate-400 mb-1">Select Module Template</label>
                    <select
                      value={selectedTemplate}
                      onChange={(e) => setSelectedTemplate(e.target.value)}
                      className="w-full rounded-lg border border-cyan-500/30 bg-black/50 p-2 font-mono text-xs text-white outline-none focus:border-cyan-400"
                    >
                      <option value="jayra-tool">JAYRA Autonomous Cognitive Tool (*Tool.ts)</option>
                      <option value="react-component">React UI Cybernetic Component (*.tsx)</option>
                      <option value="api-route">Node.js Express API Route (*Route.ts)</option>
                      <option value="python-automation">Python Worker Script (*_worker.py)</option>
                      <option value="readme">Project Markdown Documentation (*.md)</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="block font-mono text-xs text-slate-400 mb-1">
                    {showCreateModal === "template" ? "Module / Class Name" : "Item Name"}
                  </label>
                  <input
                    type="text"
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    placeholder={
                      showCreateModal === "template"
                        ? "e.g. CryptoPriceTracker"
                        : showCreateModal === "file"
                        ? "e.g. index.ts"
                        : "e.g. components"
                    }
                    autoFocus
                    className="w-full rounded-lg border border-cyan-500/30 bg-black/50 p-2 font-mono text-xs text-white placeholder-slate-600 outline-none focus:border-cyan-400"
                  />
                </div>

                <div className="font-mono text-[11px] text-slate-500 truncate">
                  Target directory: {targetCreateDir || rootPath}
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(null)}
                    className="rounded-lg border border-white/10 px-3 py-1.5 font-mono text-xs text-slate-300 hover:bg-white/5 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!newItemName.trim()}
                    className="rounded-lg border border-cyan-500/40 bg-cyan-900/60 px-4 py-1.5 font-mono text-xs text-cyan-200 hover:bg-cyan-800/80 disabled:opacity-40 cursor-pointer"
                  >
                    Confirm & Create
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showToolGenerator && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
            <form
              onSubmit={submitDynamicTool}
              className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-purple-500/30 bg-[#08121f] p-5 shadow-2xl"
            >
              <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
                <div>
                  <h3 className="font-mono text-sm font-semibold uppercase text-purple-200">Central Brain Tool Workshop</h3>
                  <p className="mt-1 font-mono text-[10px] text-slate-400">Validated Python tools require explicit safety approval before installation.</p>
                </div>
                <button type="button" onClick={() => setShowToolGenerator(false)} className="rounded p-1 text-slate-400 hover:text-white">
                  <X size={16} />
                </button>
              </div>
              <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto md:grid-cols-2">
                <label className="font-mono text-[10px] text-slate-400">
                  Tool name
                  <input
                    value={dynamicToolName}
                    onChange={(event) => setDynamicToolName(event.target.value)}
                    required
                    pattern="[A-Za-z][A-Za-z0-9_]{1,63}"
                    className="mt-1 w-full rounded border border-white/10 bg-black/50 p-2 text-xs text-white outline-none focus:border-purple-400"
                    placeholder="summarize_clipboard"
                  />
                </label>
                <label className="font-mono text-[10px] text-slate-400">
                  Purpose
                  <input
                    value={dynamicToolDescription}
                    onChange={(event) => setDynamicToolDescription(event.target.value)}
                    required
                    maxLength={1000}
                    className="mt-1 w-full rounded border border-white/10 bg-black/50 p-2 text-xs text-white outline-none focus:border-purple-400"
                    placeholder="Describe the narrow capability this tool provides"
                  />
                </label>
                <label className="font-mono text-[10px] text-slate-400">
                  Arguments JSON Schema
                  <textarea
                    value={dynamicToolSchema}
                    onChange={(event) => setDynamicToolSchema(event.target.value)}
                    required
                    spellCheck={false}
                    className="mt-1 h-48 w-full resize-y rounded border border-white/10 bg-black/50 p-2 font-mono text-[11px] text-white outline-none focus:border-purple-400"
                  />
                </label>
                <label className="font-mono text-[10px] text-slate-400">
                  Python function body
                  <textarea
                    value={dynamicToolCode}
                    onChange={(event) => setDynamicToolCode(event.target.value)}
                    required
                    spellCheck={false}
                    className="mt-1 h-48 w-full resize-y rounded border border-white/10 bg-black/50 p-2 font-mono text-[11px] text-white outline-none focus:border-purple-400"
                    placeholder={'"""Return a JSON-serializable result."""\nreturn {"ok": True}'}
                  />
                </label>
              </div>
              <div className="mt-4 flex justify-end gap-2 border-t border-white/5 pt-3">
                <button type="button" onClick={() => setShowToolGenerator(false)} className="rounded border border-white/10 px-3 py-1.5 font-mono text-xs text-slate-300 hover:bg-white/5">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={dynamicToolSubmitting}
                  className="flex items-center gap-2 rounded border border-purple-500/40 bg-purple-900/50 px-4 py-1.5 font-mono text-xs text-purple-200 hover:bg-purple-800/60 disabled:opacity-50"
                >
                  {dynamicToolSubmitting && <Loader2 size={12} className="animate-spin" />}
                  Validate & Request Approval
                </button>
              </div>
            </form>
          </div>
        )}

        {/* MODAL: INLINE RENAME */}
        {renamingItem && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-xl border border-yellow-500/30 bg-[#08121f] p-4 shadow-2xl">
              <h3 className="font-mono text-xs font-semibold text-yellow-300 uppercase mb-3">Rename Item</h3>
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
                className="w-full rounded-lg border border-yellow-500/30 bg-black/50 p-2 font-mono text-xs text-white outline-none focus:border-yellow-400 mb-4"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRenamingItem(null)}
                  className="rounded px-3 py-1 font-mono text-xs text-slate-400 hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRename}
                  disabled={!renameValue.trim() || renameValue === renamingItem.currentName}
                  className="rounded border border-yellow-500/40 bg-yellow-950/60 px-3 py-1 font-mono text-xs text-yellow-300 hover:bg-yellow-900/80 disabled:opacity-40"
                >
                  Rename
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
