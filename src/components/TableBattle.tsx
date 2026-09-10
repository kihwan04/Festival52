"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Bomb, Check, CircleAlert, Clock3, Crown, LoaderCircle, Send, Swords, Trophy } from "lucide-react";
import { canPlayBattleRound, isBattleRegistrationOpen, remainingEligibilityAmount, type TableBattleState } from "@/src/features/table-battle/domain/table-battle";

interface TableBattleProps {
  qrToken: string;
  tableNumber: number;
  demoMode?: boolean;
}

type BattleAction = "participate" | "word-answer" | "floor-choice" | "bomb-transfer";
type DemoStage = "REGISTRATION" | "PENDING" | "WAITING" | "WORD" | "FLOOR" | "BOMB" | "WINNER" | "ELIMINATED";

export function TableBattle({ qrToken, tableNumber, demoMode = false }: TableBattleProps) {
  const [state, setState] = useState<TableBattleState | null>(null);
  const [loading, setLoading] = useState(!demoMode);
  const [error, setError] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState<BattleAction | null>(null);
  const [demoStage, setDemoStage] = useState<DemoStage>("REGISTRATION");

  const loadState = useCallback(async (quiet = false) => {
    if (demoMode) return;
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/table-battle/state?qrToken=${encodeURIComponent(qrToken)}`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as ApiError | TableBattleState | null;
      if (!response.ok) throw new Error(messageFrom(body, "TABLE BATTLE 상태를 불러오지 못했습니다."));
      setState(body as TableBattleState);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "TABLE BATTLE 상태를 불러오지 못했습니다.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [demoMode, qrToken]);

  useEffect(() => {
    const id = window.setTimeout(() => void loadState(), 0);
    return () => window.clearTimeout(id);
  }, [loadState]);
  useEffect(() => {
    if (demoMode) return;
    const id = window.setInterval(() => void loadState(true), 3_000);
    return () => window.clearInterval(id);
  }, [demoMode, loadState]);

  const perform = async (action: BattleAction, path: string, payload: Record<string, unknown>) => {
    if (demoMode) {
      if (action === "participate") setDemoStage("PENDING");
      if (action === "word-answer") setDemoStage("FLOOR");
      if (action === "floor-choice") setDemoStage("BOMB");
      return;
    }
    setSubmitting(action);
    setError(null);
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ qrToken, ...payload }) });
      const body = await response.json().catch(() => null) as ApiError | TableBattleState | null;
      if (!response.ok) throw new Error(messageFrom(body, "요청을 처리하지 못했습니다."));
      setState(body as TableBattleState);
      if (action === "word-answer") setAnswer("");
    } catch (reason) {
      setError(!navigator.onLine ? "네트워크 연결을 확인한 뒤 다시 시도해 주세요." : reason instanceof Error ? reason.message : "요청을 처리하지 못했습니다.");
    } finally {
      setSubmitting(null);
    }
  };

  const viewState = demoMode ? demoBattleState(tableNumber, demoStage) : state;
  const isPlayer = canPlayBattleRound(viewState ?? emptyState(tableNumber));
  const body = (() => {
    if (loading && !viewState) return <BattleLoading />;
    if (!viewState) return <BattleProblem error={error} retry={() => void loadState()} />;
    if (!viewState.event) return <NoScheduledBattle tableNumber={viewState.tableNumber} />;
    if (viewState.event.status === "CANCELLED") return <BattleCancelled />;
    if (viewState.event.status === "FINISHED") return <FinishedBattle state={viewState} />;
    if (viewState.participant?.status === "ELIMINATED") return <EliminatedBattle state={viewState} />;
    if (viewState.participant?.status === "WINNER") return <FinishedBattle state={viewState} winner />;
    if (viewState.event.status === "REGISTRATION_OPEN" || viewState.event.status === "SCHEDULED") {
      return <Registration state={viewState} qrToken={qrToken} teamName={teamName} setTeamName={setTeamName} joining={submitting === "participate"} join={() => void perform("participate", "/api/table-battle/participate", { teamName })} />;
    }
    if (viewState.participant?.status === "PENDING") return <PendingApproval state={viewState} />;
    if (viewState.participant?.status === "REJECTED") return <RejectedApproval />;
    if (viewState.participant?.status !== "APPROVED") return <RegistrationClosed state={viewState} />;
    if (viewState.event.status === "READY" || viewState.event.status === "REGISTRATION_LOCKED") return <WaitingRoom state={viewState} />;
    if (viewState.event.status === "WORD_QUIZ") return <WordQuiz state={viewState} answer={answer} setAnswer={setAnswer} submitting={submitting === "word-answer"} submit={() => void perform("word-answer", "/api/table-battle/word-answer", { answer })} />;
    if (viewState.event.status === "FLOOR_GAME") return <FloorGame state={viewState} selecting={submitting === "floor-choice"} select={(tileX, tileY) => void perform("floor-choice", "/api/table-battle/floor-choice", { tileX, tileY })} />;
    if (viewState.event.status === "BOMB_GAME") return <BombGame state={viewState} transferring={submitting === "bomb-transfer"} transfer={(targetTableNumber) => void perform("bomb-transfer", "/api/table-battle/bomb-transfer", { targetTableNumber, expectedVersion: viewState.bomb?.version ?? -1 })} />;
    return <WaitingRoom state={viewState} />;
  })();

  return (
    <main className="battle-shell">
      <header className="battle-header">
        <a className="round-button" href={`/t/${encodeURIComponent(qrToken)}`} aria-label="주문 화면으로 돌아가기"><ArrowLeft size={20} /></a>
        <span><Swords size={17} /> TABLE BATTLE</span>
        <a className="battle-order-link" href={`/t/${encodeURIComponent(qrToken)}`}>주문하기</a>
        <i aria-label={isPlayer ? "게임 연결됨" : "상태 확인 중"} className={isPlayer ? "online" : ""} />
      </header>
      <section className="battle-hero"><span>TABLE {tableNumber}</span><h1>TABLE <em>BATTLE</em></h1><p>우리 테이블의 맛있는 승부, 지금 시작해요.</p></section>
      {demoMode && <DemoStageControls stage={demoStage} setStage={setDemoStage} />}
      {error && viewState && <p className="battle-inline-error" role="alert"><CircleAlert size={15} /> {error}</p>}
      {body}
    </main>
  );
}

function Registration({ state, qrToken, teamName, setTeamName, joining, join }: { state: TableBattleState; qrToken: string; teamName: string; setTeamName: (value: string) => void; joining: boolean; join: () => void }) {
  const event = state.event!;
  const eligible = isBattleRegistrationOpen(state);
  const missing = remainingEligibilityAmount(state);
  const notOpenYet = event.status === "SCHEDULED";
  return <section className="battle-card registration-card">
    <div className="battle-event-title"><span><Clock3 size={15} /> {event.title}</span><b>{event.status === "REGISTRATION_OPEN" ? "참가 접수 중" : "게임 예정"}</b></div>
    <h2>{notOpenYet ? "참가 접수를 기다리고 있어요" : eligible ? "우리 테이블도 도전할까요?" : "참여 조건을 확인해 주세요"}</h2>
    <p>결제 완료된 테이블 주문 금액이 기준을 넘으면 참가할 수 있어요.</p>
    <div className={`battle-amount ${eligible ? "ready" : ""}`}><span>현재 결제 완료 금액</span><strong>{state.eligibleAmount.toLocaleString("ko-KR")}<small> / {event.minimumOrderAmount.toLocaleString("ko-KR")}원</small></strong></div>
    {state.participant ? <ParticipantSummary state={state} /> : notOpenYet ? <div className="battle-shortfall">운영자가 참가 접수를 열면 이 화면에서 바로 신청할 수 있어요.</div> : eligible ? <form className="battle-join-form" onSubmit={(event) => { event.preventDefault(); join(); }}>
      <label>팀 이름<input value={teamName} minLength={2} maxLength={30} placeholder="예: 불타는 감자단" onChange={(event) => setTeamName(event.target.value)} /></label>
      <button className="battle-primary" type="submit" disabled={joining || teamName.trim().length < 2}>{joining ? <><LoaderCircle className="spin" size={17} /> 신청 중…</> : <><Swords size={17} /> 참가 신청</>}</button>
    </form> : <><div className="battle-shortfall"><span>{missing.toLocaleString("ko-KR")}원</span> 더 주문하면 참가할 수 있어요.</div><a className="battle-secondary" href={`/t/${encodeURIComponent(qrToken)}`}>메뉴 보러가기</a></>}
    <small className="battle-footnote">포장 주문과 결제 대기·취소 주문은 참가 금액에 포함되지 않아요.</small>
  </section>;
}

function ParticipantSummary({ state }: { state: TableBattleState }) {
  return <div className="battle-team-summary"><span>TABLE {state.tableNumber}</span><strong>{state.participant?.teamName}</strong><small>이미 참가 신청을 접수했어요.</small></div>;
}

function PendingApproval({ state }: { state: TableBattleState }) {
  return <section className="battle-card battle-status-card"><div className="battle-status-icon pending"><LoaderCircle className="spin" size={29} /></div><h2>관리자 승인 대기 중이에요</h2><ParticipantSummary state={state} /><p>승인되면 이 화면에서 바로 게임 대기방으로 이어집니다.</p></section>;
}

function RejectedApproval() { return <section className="battle-card battle-status-card"><div className="battle-status-icon rejected"><CircleAlert size={29} /></div><h2>참가 요청이 승인되지 않았어요</h2><p>참가 조건이나 운영 상황을 확인해야 할 수 있어요.<br />필요하면 운영 부스에 문의해 주세요.</p></section>; }

function RegistrationClosed({ state }: { state: TableBattleState }) { return <section className="battle-card battle-status-card"><div className="battle-status-icon"><Clock3 size={29} /></div><h2>참가 접수가 마감됐어요</h2><p>{state.event?.title}의 현재 접수 현황을 운영자가 확인하고 있습니다.</p></section>; }

function WaitingRoom({ state }: { state: TableBattleState }) {
  return <section className="battle-card battle-status-card waiting-room"><div className="battle-status-icon approved"><Check size={29} /></div><h2>참가 승인 완료!</h2><ParticipantSummary state={state} /><p>게임 시작 전까지 이 화면을 열어 두세요.<br />시작되면 자동으로 첫 라운드로 전환됩니다.</p><span className="battle-live"><i /> 3초마다 게임 상태 확인 중</span></section>;
}

function WordQuiz({ state, answer, setAnswer, submitting, submit }: { state: TableBattleState; answer: string; setAnswer: (value: string) => void; submitting: boolean; submit: () => void }) {
  const round = state.currentRound;
  const elimination = round?.eliminationCount ?? 0;
  return <section className="battle-card game-card"><RoundHeading round="ROUND 1" title="초성퀴즈" detail={elimination ? `시간 점수 하위 ${elimination}팀 탈락` : "시간 점수로 순위를 정해요"} /><div className="word-prompt"><strong>{round?.prompt ?? "문제를 준비하고 있어요"}</strong>{round?.hint && <span>{round.hint}</span>}</div><div className="battle-score"><span>현재 점수</span><strong>{state.participant?.wordScore ?? 0}점</strong>{round?.submissionEndsAt && <small><SecondsLeft key={state.serverNow} endAt={round.submissionEndsAt} serverNow={state.serverNow} /> 남음</small>}</div>{round?.answerSubmitted ? <div className="battle-action-done"><Check size={19} /> 정답을 제출했어요. 마감 후 점수로 탈락 팀을 정해요.</div> : <form className="battle-answer-form" onSubmit={(event) => { event.preventDefault(); submit(); }}><input value={answer} maxLength={80} placeholder="초성에 맞는 정답 입력" onChange={(event) => setAnswer(event.target.value)} /><button className="battle-primary" type="submit" disabled={submitting || !answer.trim()}>{submitting ? "정답 확인 중…" : "정답 제출"}</button></form>}<small className="battle-footnote">운영자가 등록한 정답만 인정되며, 남은 시간이 점수가 됩니다.</small></section>;
}

function FloorGame({ state, selecting, select }: { state: TableBattleState; selecting: boolean; select: (tileX: number, tileY: number) => void }) {
  const round = state.currentRound;
  return <section className="battle-card game-card"><RoundHeading round="ROUND 2" title="행운의 지뢰밭" detail="지도 없이, 오직 운으로 발판 하나를 고르세요" /><div className="battle-countdown">선택 시간 <strong>{round?.floorSelectionEndsAt ? <SecondsLeft key={state.serverNow} endAt={round.floorSelectionEndsAt} serverNow={state.serverNow} /> : "5"}초</strong></div><div className="floor-board lucky-floor" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>{Array.from({ length: 9 }, (_, index) => { const tileX = index % 3; const tileY = Math.floor(index / 3); return <button key={`${tileX}-${tileY}`} type="button" disabled={round?.choiceSubmitted || selecting} onClick={() => select(tileX, tileY)} aria-label={`발판 ${index + 1} 선택`}><span>{index + 1}</span></button>; })}</div>{round?.choiceSubmitted ? <div className="battle-action-done"><Check size={19} /> 발판을 밟았습니다. 지뢰가 아니면 다음 라운드로 갈 수 있어요.</div> : <p className="game-rule">지뢰를 밟는 즉시 💥 탈락합니다. 시간이 끝나도 탈락이에요.</p>}</section>;
}

function BombGame({ state, transferring, transfer }: { state: TableBattleState; transferring: boolean; transfer: (targetTableNumber: number) => void }) {
  const bomb = state.bomb;
  const ownBomb = bomb?.ownerTableNumber === state.tableNumber;
  return <section className="battle-card game-card bomb-game"><RoundHeading round="FINAL" title="폭탄 돌리기" detail="폭탄을 마지막까지 피하세요" /><div className={`bomb-owner ${ownBomb ? "own" : ""}`}><Bomb size={33} /><span>현재 폭탄</span><strong>TABLE {bomb?.ownerTableNumber ?? "-"}</strong>{ownBomb && <small>폭탄을 다른 테이블에 넘기세요!</small>}</div><div className="alive-table-list">{bomb?.aliveTables.map((table) => <button key={table.tableNumber} type="button" disabled={!ownBomb || transferring || table.tableNumber === state.tableNumber} onClick={() => transfer(table.tableNumber)}><span>TABLE {table.tableNumber}</span><strong>{table.teamName}</strong>{table.tableNumber === state.tableNumber ? "나" : ownBomb ? <Send size={15} /> : null}</button>)}</div><small className="battle-footnote">폭발 시각과 현재 폭탄 주인은 서버가 판정합니다.</small></section>;
}

function FinishedBattle({ state, winner = false }: { state: TableBattleState; winner?: boolean }) {
  const won = winner || state.winner?.tableNumber === state.tableNumber;
  return <section className={`battle-card battle-status-card final-result ${won ? "winner" : ""}`}><div className="battle-status-icon trophy"><Trophy size={30} /></div><p>TABLE BATTLE 종료</p><h2>{won ? "우승을 축하합니다!" : "오늘의 우승 테이블"}</h2>{state.winner && <div className="battle-winner"><Crown size={21} /><span>TABLE {state.winner.tableNumber}</span><strong>{state.winner.teamName}</strong>{state.winner.rewardName && <small>상품 · {state.winner.rewardName}</small>}</div>}<p>{won ? "운영 부스에서 상품을 확인해 주세요." : "다음 TABLE BATTLE에서 다시 도전하세요!"}</p></section>;
}

function EliminatedBattle({ state }: { state: TableBattleState }) { const steppedOnMine = state.event?.status === "FLOOR_GAME" && state.participant?.eliminatedRound === state.currentRound?.sequence; return <section className="battle-card battle-status-card"><div className="battle-status-icon rejected"><CircleAlert size={29} /></div><h2>{steppedOnMine ? "💥 지뢰가 터졌어요" : "이번 라운드는 여기까지예요"}</h2><p>{steppedOnMine ? "발판 선택은 오직 운이었어요. 다음 게임에서 다시 도전해 주세요." : "게임은 계속 관전할 수 있어요."}</p>{state.winner && <div className="battle-winner"><span>현재 우승</span><strong>TABLE {state.winner.tableNumber} · {state.winner.teamName}</strong></div>}</section>; }
function NoScheduledBattle({ tableNumber }: { tableNumber: number }) { return <section className="battle-card battle-status-card"><div className="battle-status-icon"><Swords size={29} /></div><h2>다음 TABLE BATTLE을 준비 중이에요</h2><p>TABLE {tableNumber}에서 주문을 즐기며 잠시만 기다려 주세요.<br />참가 접수가 열리면 이 화면에서 바로 신청할 수 있어요.</p></section>; }
function BattleCancelled() { return <section className="battle-card battle-status-card"><div className="battle-status-icon rejected"><CircleAlert size={29} /></div><h2>이번 게임은 종료됐어요</h2><p>운영 상황에 따라 TABLE BATTLE이 취소되었습니다.</p></section>; }
function DemoStageControls({ stage, setStage }: { stage: DemoStage; setStage: (stage: DemoStage) => void }) {
  const stages: Array<[DemoStage, string]> = [["REGISTRATION", "신청"], ["PENDING", "승인 대기"], ["WAITING", "대기방"], ["WORD", "퀴즈"], ["FLOOR", "바닥"], ["BOMB", "폭탄"], ["WINNER", "우승"], ["ELIMINATED", "탈락"]];
  return <nav className="battle-demo-controls" aria-label="데모 화면 전환">{stages.map(([value, label]) => <button type="button" key={value} className={stage === value ? "active" : ""} onClick={() => setStage(value)}>{label}</button>)}</nav>;
}

function demoBattleState(tableNumber: number, stage: DemoStage): TableBattleState {
  const event = { id: "00000000-0000-4000-8000-000000000018", title: "18:00 TABLE BATTLE", startsAt: "2026-09-10T09:00:00.000Z", registrationClosesAt: "2026-09-10T08:59:00.000Z", minimumOrderAmount: 10000, minimumParticipants: 2 };
  const participant = { status: "APPROVED" as const, teamName: "불타는 감자단", eligibleAmountSnapshot: 13000, eliminatedRound: null, wordScore: 0 };
  const round = { id: "00000000-0000-4000-8000-000000000001", sequence: 1, answerSubmitted: false, choiceSubmitted: false };
  if (stage === "REGISTRATION") return { tableNumber, event: { ...event, status: "REGISTRATION_OPEN" }, participant: null, eligibleAmount: 13000, currentRound: null, bomb: null, winner: null, serverNow: "2026-09-10T08:50:00.000Z" };
  if (stage === "PENDING") return { tableNumber, event: { ...event, status: "REGISTRATION_OPEN" }, participant: { ...participant, status: "PENDING" }, eligibleAmount: 13000, currentRound: null, bomb: null, winner: null, serverNow: "2026-09-10T08:51:00.000Z" };
  if (stage === "WAITING") return { tableNumber, event: { ...event, status: "READY" }, participant, eligibleAmount: 13000, currentRound: null, bomb: null, winner: null, serverNow: "2026-09-10T09:00:00.000Z" };
  if (stage === "WORD") return { tableNumber, event: { ...event, status: "WORD_QUIZ" }, participant: { ...participant, wordScore: 11 }, eligibleAmount: 13000, currentRound: { ...round, type: "WORD_QUIZ", prompt: "ㅂ ㄱ ㅌ", hint: "우리 부스의 메뉴입니다.", advanceCount: null, eliminationCount: 2, submissionEndsAt: "2026-09-10T09:01:15.000Z", floorMap: null, floorRevealUntil: null, floorSelectionEndsAt: null }, bomb: null, winner: null, serverNow: "2026-09-10T09:01:00.000Z" };
  if (stage === "FLOOR") return { tableNumber, event: { ...event, status: "FLOOR_GAME" }, participant, eligibleAmount: 13000, currentRound: { ...round, type: "FLOOR_GAME", prompt: null, hint: null, advanceCount: null, eliminationCount: null, submissionEndsAt: null, floorMap: null, floorRevealUntil: null, floorSelectionEndsAt: "2026-09-10T09:02:05.000Z" }, bomb: null, winner: null, serverNow: "2026-09-10T09:02:00.000Z" };
  if (stage === "BOMB") return { tableNumber, event: { ...event, status: "BOMB_GAME" }, participant, eligibleAmount: 13000, currentRound: { ...round, type: "BOMB_GAME", prompt: null, hint: null, advanceCount: null, eliminationCount: null, submissionEndsAt: null, floorMap: null, floorRevealUntil: null, floorSelectionEndsAt: null }, bomb: { ownerTableNumber: tableNumber, version: 12, aliveTables: [{ tableNumber, teamName: "불타는 감자단" }, { tableNumber: 3, teamName: "치즈러버" }, { tableNumber: 5, teamName: "개발자살려" }] }, winner: null, serverNow: "2026-09-10T09:03:00.000Z" };
  const winner = { tableNumber, teamName: "불타는 감자단", rewardName: "버갈튀 1개 무료" };
  if (stage === "WINNER") return { tableNumber, event: { ...event, status: "FINISHED" }, participant: { ...participant, status: "WINNER" }, eligibleAmount: 13000, currentRound: null, bomb: null, winner, serverNow: "2026-09-10T09:05:00.000Z" };
  return { tableNumber, event: { ...event, status: "BOMB_GAME" }, participant: { ...participant, status: "ELIMINATED", eliminatedRound: 3 }, eligibleAmount: 13000, currentRound: null, bomb: null, winner: { tableNumber: 3, teamName: "치즈러버", rewardName: "버갈튀 1개 무료" }, serverNow: "2026-09-10T09:04:00.000Z" };
}
function BattleLoading() { return <section className="battle-card battle-status-card"><div className="battle-status-icon pending"><LoaderCircle className="spin" size={29} /></div><h2>게임 정보를 불러오는 중이에요</h2></section>; }
function BattleProblem({ error, retry }: { error: string | null; retry: () => void }) { return <section className="battle-card battle-status-card"><div className="battle-status-icon rejected"><CircleAlert size={29} /></div><h2>게임 정보를 불러오지 못했어요</h2><p>{error ?? "잠시 후 다시 시도해 주세요."}</p><button className="battle-secondary" type="button" onClick={retry}>다시 시도</button></section>; }
function RoundHeading({ round, title, detail }: { round: string; title: string; detail: string }) { return <div className="round-heading"><span>{round}</span><h2>{title}</h2><p>{detail}</p></div>; }
function SecondsLeft({ endAt, serverNow }: { endAt: string; serverNow: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { const startedAt = Date.now(); const id = window.setInterval(() => setElapsed(Date.now() - startedAt), 250); return () => window.clearInterval(id); }, []);
  return <>{Math.max(0, Math.ceil((new Date(endAt).getTime() - (new Date(serverNow).getTime() + elapsed)) / 1_000))}</>;
}
function messageFrom(value: ApiError | TableBattleState | null, fallback: string) { return value && typeof value === "object" && "message" in value && typeof value.message === "string" ? value.message : fallback; }
function emptyState(tableNumber: number): TableBattleState { return { tableNumber, event: null, participant: null, eligibleAmount: 0, currentRound: null, bomb: null, winner: null, serverNow: "" }; }
interface ApiError { message?: string }
