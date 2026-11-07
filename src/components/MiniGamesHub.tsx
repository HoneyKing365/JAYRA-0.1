import React, { useRef, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { ticTacToeOutcome, type TicTacToeBoard, type TicTacToeOutcome } from "../../runtime/ticTacToe";

interface MiniGamesHubProps {
  onClose: () => void;
}

const EMPTY_BOARD = (): TicTacToeBoard => Array(9).fill(null);

function outcomeText(outcome: TicTacToeOutcome, pending: boolean): string {
  if (pending) return "JAYRA is thinking…";
  if (outcome === "x_wins") return "You win!";
  if (outcome === "o_wins") return "JAYRA wins this round.";
  if (outcome === "draw") return "It’s a draw.";
  return "Your turn — you are X.";
}

export function MiniGamesHub({ onClose }: MiniGamesHubProps) {
  const [board, setBoard] = useState<TicTacToeBoard>(EMPTY_BOARD);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const outcome = ticTacToeOutcome(board);
  const finished = outcome !== "playing";

  const reset = () => {
    generation.current += 1;
    setBoard(EMPTY_BOARD());
    setPending(false);
    setError(null);
  };

  const play = async (index: number) => {
    if (pending || finished || board[index] !== null) return;
    const next = [...board];
    next[index] = "X";
    setBoard(next);
    setError(null);
    const currentGeneration = generation.current;
    setPending(true);
    try {
      const response = await fetch("/api/games/tic-tac-toe/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board: next }),
      });
      const result = await response.json() as { board?: TicTacToeBoard; error?: string };
      if (!response.ok) throw new Error(result.error || `Move failed (${response.status}).`);
      if (currentGeneration !== generation.current) return;
      if (!Array.isArray(result.board) || result.board.length !== 9) throw new Error("The game server returned an invalid board.");
      setBoard(result.board);
    } catch (cause) {
      if (currentGeneration === generation.current) {
        setBoard(EMPTY_BOARD());
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (currentGeneration === generation.current) setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section aria-labelledby="mini-games-title" className="w-full max-w-sm rounded-2xl border border-cyan-300/20 bg-[#0b1020] p-5 text-white shadow-2xl">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="mini-games-title" className="text-lg font-semibold">Tic-Tac-Toe</h2>
            <p className="text-xs text-slate-400">Play X against JAYRA’s perfect-play opponent.</p>
          </div>
          <button type="button" aria-label="Close game" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"><X size={18} /></button>
        </header>
        <p aria-live="polite" className="mb-3 min-h-5 text-sm text-cyan-200">{outcomeText(outcome, pending)}</p>
        <div role="grid" aria-label="Tic-Tac-Toe board" className="grid grid-cols-3 gap-2">
          {board.map((mark, index) => (
            <button key={index} type="button" role="gridcell" aria-label={`Row ${Math.floor(index / 3) + 1}, column ${index % 3 + 1}${mark ? `, ${mark}` : ", empty"}`}
              disabled={pending || finished || mark !== null}
              onClick={() => void play(index)}
              className="aspect-square rounded-xl border border-white/10 bg-white/[0.04] text-4xl font-semibold text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-80">
              {mark}
            </button>
          ))}
        </div>
        {error && <p role="alert" className="mt-3 text-xs text-rose-300">{error}</p>}
        <button type="button" onClick={reset} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/10">
          <RotateCcw size={14} /> New round
        </button>
      </section>
    </div>
  );
}
