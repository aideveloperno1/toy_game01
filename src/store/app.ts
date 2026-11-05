import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createRound, resultsFromRanking } from '../core/draw';
import type { GameId, HistoryEntry, OutcomeConfig, Participant, Round, RoundResult } from '../core/types';

export type Screen = 'home' | 'players' | 'outcome' | 'picker' | 'play' | 'result' | 'history' | 'settings' | 'instant';

/** 참가자 색 팔레트: 어두운 배경에서 서로 구분되는 12색 */
export const PLAYER_COLORS = [
  '#ff6b6b', '#ffc93c', '#4fd8b4', '#5aa9ff', '#c58bff', '#ff9a4d',
  '#7be06b', '#ff7fc8', '#47d1e8', '#e8e06b', '#a3a8ff', '#f0a07a',
];

export type Group = { id: string; name: string; members: string[]; config?: OutcomeConfig; updatedAt: number };

export type SessionPlayer = Participant & { excluded?: boolean };

export type Settings = { sound: boolean; vibration: boolean; fast: boolean; theme: 'system' | 'dark' | 'light' };

type State = {
  screen: Screen;
  settings: Settings;
  groups: Group[];
  players: SessionPlayer[];
  groupId?: string;
  config: OutcomeConfig;
  recentLabels: string[];
  history: HistoryEntry[];
  round: Round | null;
  results: RoundResult | null;
  lastStart: { key: string; at: number; attempt: number } | null;
  /** 결과 화면에서 다시 보기로 들어온 판인지 */
  replay: boolean;

  go(screen: Screen): void;
  setSettings(p: Partial<Settings>): void;
  setPlayers(names: string[]): void;
  addPlayers(names: string[]): void;
  removePlayer(id: string): void;
  toggleExcluded(id: string): void;
  setConfig(c: OutcomeConfig): void;
  saveGroup(name: string): void;
  loadGroup(id: string): void;
  deleteGroup(id: string): void;
  start(gameId: GameId): void;
  finish(results?: RoundResult): void;
  replayEntry(entryId: string): void;
  logInstant(total: number, picked: number): void;
  clearHistory(): void;
};

const uid = () => {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

export const MAX_PLAYERS = 30;
export const MAX_NAME = 8;

/** 이름 정리: 앞뒤 공백 제거, 길이 제한, 중복은 "민수(2)"처럼 구분 */
function normalizeNames(existing: string[], incoming: string[]): string[] {
  const out: string[] = [];
  const taken = new Set(existing);
  for (const raw of incoming) {
    const base = raw.trim().slice(0, MAX_NAME);
    if (!base) continue;
    let name = base;
    let k = 2;
    while (taken.has(name)) name = `${base}(${k++})`;
    taken.add(name);
    out.push(name);
  }
  return out;
}

function makePlayers(names: string[], startIndex = 0): SessionPlayer[] {
  return names.map((name, i) => ({ id: uid(), name, color: PLAYER_COLORS[(startIndex + i) % PLAYER_COLORS.length] }));
}

export const activePlayers = (s: Pick<State, 'players'>): Participant[] =>
  s.players.filter((p) => !p.excluded).map(({ id, name, color }) => ({ id, name, color }));

export const DEFAULT_CONFIG: OutcomeConfig = { mode: 'loser', count: 1, label: '꽝', good: false };

function rememberLabels(recent: string[], config: OutcomeConfig): string[] {
  const labels =
    config.mode === 'loser' ? [config.label] : config.mode === 'items' ? config.items.map((i) => i.label) : [];
  const merged = [...labels.map((l) => l.trim()).filter(Boolean), ...recent];
  return [...new Set(merged)].slice(0, 6);
}

export const useApp = create<State>()(
  persist(
    (set, get) => ({
      screen: 'home',
      settings: { sound: true, vibration: true, fast: false, theme: 'system' },
      groups: [],
      players: [],
      groupId: undefined,
      config: DEFAULT_CONFIG,
      recentLabels: ['꽝', '커피 쏘기', '밥값', '설거지'],
      history: [],
      round: null,
      results: null,
      lastStart: null,
      replay: false,

      go: (screen) => {
        set({ screen });
        window.scrollTo?.(0, 0);
      },
      setSettings: (p) => set({ settings: { ...get().settings, ...p } }),
      setPlayers: (names) => set({ players: makePlayers(normalizeNames([], names)), groupId: undefined }),
      addPlayers: (names) => {
        const cur = get().players;
        const room = MAX_PLAYERS - cur.length;
        const fresh = normalizeNames(cur.map((p) => p.name), names).slice(0, Math.max(0, room));
        set({ players: [...cur, ...makePlayers(fresh, cur.length)] });
      },
      removePlayer: (id) => set({ players: get().players.filter((p) => p.id !== id) }),
      toggleExcluded: (id) =>
        set({ players: get().players.map((p) => (p.id === id ? { ...p, excluded: !p.excluded } : p)) }),
      setConfig: (config) => set({ config }),
      saveGroup: (name) => {
        const { groups, players, groupId, config } = get();
        const members = players.map((p) => p.name);
        const existing = groups.find((g) => g.id === groupId) ?? groups.find((g) => g.name === name.trim());
        if (existing) {
          set({
            groups: groups.map((g) => (g.id === existing.id ? { ...g, name: name.trim() || g.name, members, config, updatedAt: Date.now() } : g)),
            groupId: existing.id,
          });
        } else {
          const g: Group = { id: uid(), name: name.trim() || '우리 모임', members, config, updatedAt: Date.now() };
          set({ groups: [g, ...groups].slice(0, 20), groupId: g.id });
        }
      },
      loadGroup: (id) => {
        const g = get().groups.find((x) => x.id === id);
        if (!g) return;
        set({
          players: makePlayers(g.members),
          groupId: g.id,
          config: g.config ?? get().config,
          groups: get().groups.map((x) => (x.id === id ? { ...x, updatedAt: Date.now() } : x)),
        });
      },
      deleteGroup: (id) => set({ groups: get().groups.filter((g) => g.id !== id), groupId: get().groupId === id ? undefined : get().groupId }),

      start: (gameId) => {
        const s = get();
        const participants = activePlayers(s);
        const key = participants.map((p) => p.name).sort().join('|') + '#' + JSON.stringify(s.config);
        const now = Date.now();
        const attempt = s.lastStart && s.lastStart.key === key && now - s.lastStart.at < 5 * 60_000 ? s.lastStart.attempt + 1 : 1;
        const round = createRound({ gameId, participants, config: s.config, groupId: s.groupId, attempt });
        set({
          round,
          results: null,
          replay: false,
          screen: 'play',
          lastStart: { key, at: now, attempt },
          recentLabels: rememberLabels(s.recentLabels, s.config),
        });
      },
      finish: (results) => {
        const { round, replay, history, groups } = get();
        if (!round) return;
        const final = results ?? resultsFromRanking(round);
        const entry: HistoryEntry = {
          id: round.id,
          createdAt: round.createdAt,
          gameId: round.gameId,
          groupId: round.groupId,
          participants: round.participants,
          config: round.config,
          seed: round.seed,
          results: final,
          attempt: round.attempt,
        };
        set({
          results: final,
          screen: 'result',
          history: replay ? history : [entry, ...history.filter((h) => h.id !== entry.id)].slice(0, 50),
          // 모임 그룹의 마지막 결과 구성도 기억한다
          groups: round.groupId ? groups.map((g) => (g.id === round.groupId ? { ...g, config: round.config } : g)) : groups,
        });
      },
      replayEntry: (entryId) => {
        const h = get().history.find((x) => x.id === entryId);
        if (!h) return;
        const round = createRound({ gameId: h.gameId, participants: h.participants, config: h.config, groupId: h.groupId, attempt: h.attempt, seed: h.seed });
        round.createdAt = h.createdAt;
        set({ round, results: null, replay: true, screen: 'play' });
      },
      logInstant: (total, picked) => {
        const entry: HistoryEntry = {
          id: uid(),
          createdAt: Date.now(),
          gameId: 'finger',
          participants: [],
          config: { mode: 'loser', count: picked, label: '선택', good: true },
          seed: '',
          results: {},
          attempt: 1,
          instant: { total, picked },
        };
        set({ history: [entry, ...get().history].slice(0, 50) });
      },
      clearHistory: () => set({ history: [] }),
    }),
    {
      name: 'bokbulbok-v1',
      partialize: (s) => ({
        settings: s.settings,
        groups: s.groups,
        players: s.players,
        groupId: s.groupId,
        config: s.config,
        recentLabels: s.recentLabels,
        history: s.history,
        lastStart: s.lastStart,
      }),
    },
  ),
);
