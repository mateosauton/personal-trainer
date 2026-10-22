import type { PlanBlock, PlanDay, PlanItem } from '@/lib/types';
import { estimateSetWorkSeconds, getBlockDurationSeconds, proportionalSeconds } from '@/lib/plan/timing';

/**
 * One thing the user does: a single set of a single exercise. Flattening the
 * plan up front means the player is a cursor over a list rather than three
 * nested loops of block, round and set state.
 */
export interface QueueEntry {
  key: string;
  block: PlanBlock;
  item: PlanItem;
  /** 1-based round within a superset or circuit; always 1 for straight sets. */
  round: number;
  /** 1-based set within a straight-set block. */
  set: number;
  /** How many sets this exercise has in this block, for "Set 2 of 4". */
  setsTotal: number;
  blockOrdinal: number;
  blockCount: number;
  /** Timed blocks divide their complete budget across the prescribed sets. */
  slotSeconds?: number;
  workSeconds?: number;
  restSeconds?: number;
}

export function buildQueue(day: PlanDay): QueueEntry[] {
  const entries: QueueEntry[] = [];
  const workBlocks = day.blocks.filter((b) => b.kind !== 'warmup');
  const ordinalOf = new Map(workBlocks.map((b, i) => [b.id, i + 1]));

  for (const block of day.blocks) {
    const blockOrdinal = ordinalOf.get(block.id) ?? 0;
    const meta = { block, blockOrdinal, blockCount: workBlocks.length };

    if (block.kind === 'superset' || block.kind === 'circuit') {
      // Rounds rotate through the items: A1 B1, A2 B2, A3 B3.
      for (let round = 1; round <= block.rounds; round += 1) {
        for (const item of block.items) {
          entries.push({
            key: `${block.id}:${item.id}:${round}`,
            item,
            round,
            set: round,
            setsTotal: block.rounds,
            ...meta,
          });
        }
      }
      continue;
    }

    for (const item of block.items) {
      for (let set = 1; set <= item.sets; set += 1) {
        entries.push({
          key: `${block.id}:${item.id}:${set}`,
          item,
          round: 1,
          set,
          setsTotal: item.sets,
          ...meta,
        });
      }
    }
  }

  for (const block of day.blocks) {
    const duration = getBlockDurationSeconds(block);
    if (duration == null) continue;
    const blockEntries = entries.filter((entry) => entry.block.id === block.id);
    const work = blockEntries.map((entry) => estimateSetWorkSeconds(entry.item));
    const weights = blockEntries.map((entry, index) => {
      const betweenRounds = index % block.items.length === block.items.length - 1;
      const recovery = block.kind === 'warmup' ? 0
        : block.kind === 'straight' || betweenRounds ? block.rest_seconds : 10;
      return work[index] + recovery;
    });
    const slots = proportionalSeconds(duration, weights);
    blockEntries.forEach((entry, index) => {
      entry.slotSeconds = slots[index];
      entry.workSeconds = Math.min(work[index], slots[index]);
      entry.restSeconds = slots[index] - entry.workSeconds;
    });
  }
  return entries;
}

/** The next exercise before the round ends, shown as a peek card. */
export function partnerOf(entry: QueueEntry): PlanItem | null {
  if (entry.block.kind !== 'superset' && entry.block.kind !== 'circuit') return null;
  const index = entry.block.items.findIndex((item) => item.id === entry.item.id);
  return index >= 0 ? entry.block.items[index + 1] ?? null : null;
}

/** Supersets and circuits rest after the whole round, including block transitions. */
export function restAfter(entry: QueueEntry): number {
  return entry.restSeconds ?? (partnerOf(entry) ? 0 : entry.block.rest_seconds);
}

export type { PlanBlock, PlanItem };
