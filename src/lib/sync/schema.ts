/**
 * 进度快照的服务端校验
 * ---------------------------------------------------------------------------
 * 客户端传来的 JSON 一律不可信：字段可能缺失、可能是旧版结构、可能被手工构造。
 * 这里用宽松但有界的 schema 归一化 —— 只保留已知字段、丢掉越界值，
 * 这样数据库里永远不会攒下脏数据导致前端读崩。
 */
import { z } from 'zod';

/** 单套卷/单题键的最大长度（`cet6/2026-06-2#55` 这类） */
const KEY = z.string().min(1).max(120);
/** 单篇草稿的最大长度（作文 200 词、翻译几行，2 万字足够宽松） */
const DRAFT = z.string().max(20_000);

export const zAnswerRecord = z.object({
  c: z.string().max(8),
  ok: z.boolean(),
  t: z.number(),
  n: z.number().int().min(0).max(1_000_000),
});

export const zProgressSnapshot = z.object({
  answers: z.record(KEY, zAnswerRecord).default({}),
  wrong: z.record(KEY, z.literal(1)).default({}),
  fav: z.record(KEY, z.number()).default({}),
  off: z.record(KEY, z.number()).default({}),
  drafts: z.record(KEY, DRAFT).default({}),
  draftAt: z.record(KEY, z.number()).default({}),
  positions: z.record(KEY, z.number()).default({}),
  positionAt: z.record(KEY, z.number()).default({}),
  submitted: z.record(KEY, z.number()).default({}),
});

export type ProgressSnapshotInput = z.infer<typeof zProgressSnapshot>;

/** 快照体积上限：防住「把 localStorage 塞爆」式的超大载荷 */
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
