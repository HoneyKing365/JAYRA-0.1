/**
 * JAYRA Code Studio — High-Performance Syntax Highlighted Editor
 * Real-time code colorization engine powered by Prism.js with synchronized dual-layer editing.
 * Features:
 *  - High-precision keyword, string, function, and comment tokenization
 *  - Zero-lag caret & selection synchronization
 *  - Auto-indentation on Enter & Tab indentation
 *  - Theme styling aligned with JAYRA's cybernetic JARVIS/Mark LV aesthetic
 */

import React, { useEffect, useRef, useMemo, useCallback } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-clike.js";
import "prismjs/components/prism-javascript.js";
import "prismjs/components/prism-typescript.js";
import "prismjs/components/prism-jsx.js";
import "prismjs/components/prism-tsx.js";
import "prismjs/components/prism-python.js";
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-bash.js";
import "prismjs/components/prism-markdown.js";
import "prismjs/components/prism-yaml.js";
import "prismjs/components/prism-css.js";

export interface CodeHighlightEditorProps {
  value: string;
  onChange: (value: string) => void;
  fileName: string;
  language?: string;
  fontSize?: number;
  cursorLine?: number;
  onCursorChange?: (line: number, col: number) => void;
  onSave?: () => void;
  className?: string;
}

/** Map file extension / language name to Prism language grammar */
function getPrismLanguage(fileName: string, langName?: string): { grammar: Prism.Grammar; id: string } {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const normalized = (langName || "").toLowerCase();

  if (ext === "py" || normalized.includes("python")) {
    return { grammar: Prism.languages.python || Prism.languages.clike, id: "python" };
  }
  if (ext === "ts" || ext === "tsx" || normalized.includes("typescript")) {
    return { grammar: Prism.languages.tsx || Prism.languages.typescript || Prism.languages.javascript, id: "tsx" };
  }
  if (ext === "js" || ext === "jsx" || normalized.includes("javascript")) {
    return { grammar: Prism.languages.jsx || Prism.languages.javascript, id: "jsx" };
  }
  if (ext === "json" || normalized.includes("json")) {
    return { grammar: Prism.languages.json || Prism.languages.javascript, id: "json" };
  }
  if (ext === "html" || ext === "htm" || ext === "svg" || ext === "xml" || normalized.includes("html") || normalized.includes("xml")) {
    return { grammar: Prism.languages.markup || Prism.languages.html, id: "markup" };
  }
  if (ext === "css" || ext === "scss" || normalized.includes("css")) {
    return { grammar: Prism.languages.css || Prism.languages.clike, id: "css" };
  }
  if (ext === "sh" || ext === "bash" || ext === "ps1" || ext === "bat" || normalized.includes("shell") || normalized.includes("bash")) {
    return { grammar: Prism.languages.bash || Prism.languages.clike, id: "bash" };
  }
  if (ext === "md" || normalized.includes("markdown")) {
    return { grammar: Prism.languages.markdown || Prism.languages.clike, id: "markdown" };
  }
  if (ext === "yml" || ext === "yaml" || normalized.includes("yaml")) {
    return { grammar: Prism.languages.yaml || Prism.languages.clike, id: "yaml" };
  }

  return { grammar: Prism.languages.clike || Prism.languages.javascript, id: "clike" };
}

export const CodeHighlightEditor: React.FC<CodeHighlightEditorProps> = ({
  value,
  onChange,
  fileName,
  language,
  fontSize = 13,
  cursorLine = 1,
  onCursorChange,
  onSave,
  className = "",
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  // Compute total lines
  const lines = useMemo(() => value.split("\n"), [value]);
  const lineCount = Math.max(1, lines.length);

  // Compute Prism-highlighted HTML
  const highlightedHtml = useMemo(() => {
    try {
      const { grammar, id } = getPrismLanguage(fileName, language);
      if (!grammar) return value;
      // Add trailing newline so pre height matches textarea exactly
      const textToHighlight = value.endsWith("\n") ? value + " " : value + "\n";
      return Prism.highlight(textToHighlight, grammar, id);
    } catch {
      return value;
    }
  }, [value, fileName, language]);

  // Synchronize scroll of textarea with pre overlay and line numbers gutter
  const handleScroll = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = ta.scrollTop;
    }
  }, []);

  // Update cursor position line & col
  const handleSelect = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta || !onCursorChange) return;
    const pos = ta.selectionStart;
    const textBefore = ta.value.substring(0, pos);
    const lineArr = textBefore.split("\n");
    const currentLine = lineArr.length;
    const currentCol = lineArr[lineArr.length - 1].length + 1;
    onCursorChange(currentLine, currentCol);
  }, [onCursorChange]);

  // Handle Tab, Enter auto-indent, and Save shortcut
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = textareaRef.current;
    if (!ta) return;

    // Ctrl+S / Cmd+S save
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave?.();
      return;
    }

    // Tab key: insert 2 spaces
    if (e.key === "Tab") {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const spaces = "  ";

      const nextVal = value.substring(0, start) + spaces + value.substring(end);
      onChange(nextVal);

      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + spaces.length;
        handleSelect();
      });
      return;
    }

    // Enter key: auto-indent to match previous line's leading whitespace
    if (e.key === "Enter") {
      const start = ta.selectionStart;
      const textBefore = value.substring(0, start);
      const currentLineText = textBefore.split("\n").pop() || "";
      const match = currentLineText.match(/^([ \t]+)/);
      const indent = match ? match[1] : "";

      // If current line ends with { or : increase indent by 2 spaces
      const extraIndent = /[{:]\s*$/.test(currentLineText) ? "  " : "";
      const fullIndent = indent + extraIndent;

      if (fullIndent) {
        e.preventDefault();
        const nextVal = value.substring(0, start) + "\n" + fullIndent + value.substring(ta.selectionEnd);
        onChange(nextVal);

        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 1 + fullIndent.length;
          handleSelect();
        });
        return;
      }
    }
  };

  return (
    <div className={`relative flex flex-1 min-h-0 min-w-0 overflow-hidden bg-[#050b14] select-text ${className}`}>
      {/* Inline styles for Prism tokens to match JAYRA's cybernetic theme */}
      <style>{`
        .token.comment, .token.prolog, .token.doctype, .token.cdata { color: #64748b; font-style: italic; }
        .token.punctuation { color: #94a3b8; }
        .token.property, .token.tag, .token.boolean, .token.number, .token.constant, .token.symbol { color: #f59e0b; font-weight: 500; }
        .token.selector, .token.attr-name, .token.string, .token.char, .token.builtin { color: #34d399; }
        .token.operator, .token.entity, .token.url { color: #38bdf8; }
        .token.atrule, .token.attr-value, .token.keyword { color: #f472b6; font-weight: 600; }
        .token.function, .token.class-name { color: #60a5fa; font-weight: 500; }
        .token.regex, .token.important, .token.variable { color: #fbbf24; }
      `}</style>

      {/* Synchronized Line Numbers Gutter */}
      <div
        ref={gutterRef}
        aria-hidden="true"
        className="w-12 select-none border-r border-white/10 bg-[#040810] py-3 text-right pr-2.5 font-mono text-slate-600 overflow-hidden shrink-0 pointer-events-none"
        style={{ fontSize: `${fontSize}px`, lineHeight: "1.6" }}
      >
        {Array.from({ length: lineCount }).map((_, i) => {
          const isCursor = cursorLine === i + 1;
          return (
            <div
              key={i}
              className={`transition-colors leading-[1.6] ${
                isCursor ? "text-cyan-300 font-bold bg-cyan-500/10 rounded-sm" : ""
              }`}
            >
              {i + 1}
            </div>
          );
        })}
      </div>

      {/* Dual-Layer Code Surface */}
      <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
        {/* Underlay: Syntax Highlighted Rendered HTML */}
        <pre
          ref={preRef}
          aria-hidden="true"
          className="absolute inset-0 m-0 p-3 font-mono overflow-hidden whitespace-pre pointer-events-none text-slate-200"
          style={{
            fontSize: `${fontSize}px`,
            lineHeight: "1.6",
            tabSize: 2,
            letterSpacing: "normal",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          }}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />

        {/* Overlay: Interactive Transparent Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          onSelect={handleSelect}
          onKeyUp={handleSelect}
          onClick={handleSelect}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className="absolute inset-0 m-0 w-full h-full resize-none bg-transparent p-3 font-mono text-transparent caret-cyan-400 outline-none overflow-auto whitespace-pre selection:bg-cyan-500/30"
          style={{
            fontSize: `${fontSize}px`,
            lineHeight: "1.6",
            tabSize: 2,
            letterSpacing: "normal",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          }}
        />
      </div>
    </div>
  );
};
