export interface CanvasPosition {
  x: number;
  y: number;
}

function samePosition(left: CanvasPosition, right: CanvasPosition): boolean {
  return left.x === right.x && left.y === right.y;
}

/**
 * Gives a locally dragged node precedence until its new position has been
 * recorded in the ledger. A committed ledger move, by contrast, is allowed to
 * update the Project Graph object on the next synchronization pass.
 */
export function shouldApplyLedgerPosition(
  ledgerPosition: CanvasPosition,
  canvasPosition: CanvasPosition,
  previousLedgerPosition: CanvasPosition | undefined,
): boolean {
  const canvasHasUnsavedMove =
    previousLedgerPosition !== undefined && !samePosition(canvasPosition, previousLedgerPosition);
  const ledgerPositionChanged =
    previousLedgerPosition === undefined || !samePosition(ledgerPosition, previousLedgerPosition);
  return !canvasHasUnsavedMove || ledgerPositionChanged;
}
