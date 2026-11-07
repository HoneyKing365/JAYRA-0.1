import assert from "node:assert/strict";
import test from "node:test";
import { chooseTicTacToeMove, ticTacToeOutcome, type TicTacToeBoard } from "./ticTacToe";

test("the opponent takes an immediate win", () => {
  const result = chooseTicTacToeMove(["O", "O", null, "X", "X", null, "X", null, null]);
  assert.equal(result.move, 2);
  assert.deepEqual(result.board, ["O", "O", "O", "X", "X", null, "X", null, null]);
  assert.equal(result.outcome, "o_wins");
});

test("the opponent blocks an immediate player win", () => {
  const result = chooseTicTacToeMove(["X", "X", null, "O", null, null, "X", null, "O"]);
  assert.equal(result.move, 2);
  assert.equal(result.outcome, "playing");
});

test("perfect play cannot lose to the opponent", () => {
  const play = (board: TicTacToeBoard, xTurn: boolean): boolean => {
    const outcome = ticTacToeOutcome(board);
    if (outcome === "x_wins") return false;
    if (outcome === "o_wins" || outcome === "draw") return true;
    if (xTurn) {
      for (let index = 0; index < board.length; index += 1) {
        if (board[index] !== null) continue;
        board[index] = "X";
        const safe = play(board, false);
        board[index] = null;
        if (!safe) return false;
      }
      return true;
    }
    const move = chooseTicTacToeMove(board).move;
    assert.notEqual(move, null);
    board[move!] = "O";
    const safe = play(board, true);
    board[move!] = null;
    return safe;
  };

  assert.equal(play(Array<TicTacToeBoard[number]>(9).fill(null), true), true);
});

test("the game endpoint rejects malformed and out-of-turn board states", () => {
  assert.throws(() => chooseTicTacToeMove(["X"]), /nine/);
  assert.throws(() => chooseTicTacToeMove(["X", "X", null, null, null, null, null, null, null]), /valid position/);
});

test("a finished player win is returned without an opponent move", () => {
  const result = chooseTicTacToeMove(["X", "X", "X", "O", "O", null, null, null, null]);
  assert.equal(result.move, null);
  assert.equal(result.outcome, "x_wins");
});
