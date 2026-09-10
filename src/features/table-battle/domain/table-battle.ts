export type TableBattleEventStatus = "SCHEDULED" | "REGISTRATION_OPEN" | "REGISTRATION_LOCKED" | "READY" | "WORD_QUIZ" | "FLOOR_GAME" | "BOMB_GAME" | "FINISHED" | "CANCELLED";
export type TableBattleParticipantStatus = "PENDING" | "APPROVED" | "REJECTED" | "ELIMINATED" | "WINNER" | "CANCELLED";
export type TableBattleRoundType = "WORD_QUIZ" | "FLOOR_GAME" | "BOMB_GAME";

export interface TableBattleEvent {
  id: string;
  title: string;
  status: TableBattleEventStatus;
  startsAt: string | null;
  registrationClosesAt: string | null;
  minimumOrderAmount: number;
  minimumParticipants: number;
}

export interface TableBattleParticipant {
  status: TableBattleParticipantStatus;
  teamName: string;
  eligibleAmountSnapshot: number;
  eliminatedRound: number | null;
  wordScore: number;
}

export interface TableBattleRound {
  id: string;
  type: TableBattleRoundType;
  sequence: number;
  prompt: string | null;
  hint: string | null;
  advanceCount: number | null;
  eliminationCount: number | null;
  submissionEndsAt: string | null;
  floorMap: boolean[][] | null;
  floorRevealUntil: string | null;
  floorSelectionEndsAt: string | null;
  answerSubmitted: boolean;
  choiceSubmitted: boolean;
}

export interface TableBattleState {
  tableNumber: number;
  event: TableBattleEvent | null;
  participant: TableBattleParticipant | null;
  eligibleAmount: number;
  currentRound: TableBattleRound | null;
  bomb: {
    ownerTableNumber: number;
    version: number;
    aliveTables: Array<{ tableNumber: number; teamName: string }>;
  } | null;
  winner: { tableNumber: number; teamName: string; rewardName: string | null } | null;
  serverNow: string;
}

export function isBattleRegistrationOpen(state: TableBattleState): boolean {
  return state.event?.status === "REGISTRATION_OPEN" && state.participant === null && state.eligibleAmount >= state.event.minimumOrderAmount;
}

export function remainingEligibilityAmount(state: TableBattleState): number {
  return Math.max(0, (state.event?.minimumOrderAmount ?? 0) - state.eligibleAmount);
}

export function canPlayBattleRound(state: TableBattleState): boolean {
  return state.participant?.status === "APPROVED" && ["WORD_QUIZ", "FLOOR_GAME", "BOMB_GAME"].includes(state.event?.status ?? "");
}
