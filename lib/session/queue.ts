import type { PlanBlock, PlanDay, PlanItem } from '@/lib/types';

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
  return partnerOf(entry) ? 0 : entry.block.rest_seconds;
}

export type { PlanBlock, PlanItem };
