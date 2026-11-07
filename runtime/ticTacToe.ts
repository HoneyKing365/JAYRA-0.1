export type TicTacToeMark = "X" | "O" | null;
export type TicTacToeBoard = TicTacToeMark[];
export type TicTacToeOutcome = "playing" | "x_wins" | "o_wins" | "draw";

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
] as const;

export function ticTacToeOutcome(board: TicTacToeBoard): TicTacToeOutcome {
  let xWins = false;
  let oWins = false;
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      if (board[a] === "X") xWins = true;
      else oWins = true;
    }
  }
  if (xWins && oWins) return "playing";
  if (xWins) return "x_wins";
  if (oWins) return "o_wins";
  return board.every(Boolean) ? "draw" : "playing";
}

/** Validate a user-X position and return the optimal O response. */
export function chooseTicTacToeMove(board: unknown): { board: TicTacToeBoard; move: number | null; outcome: TicTacToeOutcome } {
  if (!Array.isArray(board) || board.length !== 9 || board.some((cell) => cell !== null && cell !== "X" && cell !== "O")) {
    throw new Error("The game board must contain nine X, O or empty cells.");
  }
  const position = board as TicTacToeBoard;
  const xCount = position.filter((cell) => cell === "X").length;
  const oCount = position.filter((cell) => cell === "O").length;
  if (xCount !== oCount + 1) throw new Error("The board is not a valid position after the player's turn.");

  const outcome = ticTacToeOutcome(position);
  if (outcome === "o_wins") {
    throw new Error("The board contains an invalid previous game result.");
  }
  if (outcome !== "playing") return { board: [...position], move: null, outcome };

  let bestMove = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 0; index < position.length; index += 1) {
    if (position[index] !== null) continue;
    position[index] = "O";
    const score = minimax(position, true, 0);
    position[index] = null;
    if (score < bestScore) {
      bestMove = index;
      bestScore = score;
    }
  }

  if (bestMove < 0) throw new Error("No legal move is available.");
  const nextBoard = [...position];
  nextBoard[bestMove] = "O";
  return { board: nextBoard, move: bestMove, outcome: ticTacToeOutcome(nextBoard) };
}

function minimax(board: TicTacToeBoard, xTurn: boolean, depth: number): number {
  const outcome = ticTacToeOutcome(board);
  if (outcome === "o_wins") return -10 + depth;
  if (outcome === "x_wins") return 10 - depth;
  if (outcome === "draw") return 0;

  let best = xTurn ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  const mark = xTurn ? "X" : "O";
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] !== null) continue;
    board[index] = mark;
    const score = minimax(board, !xTurn, depth + 1);
    board[index] = null;
    best = xTurn ? Math.max(best, score) : Math.min(best, score);
  }
  return best;
}
