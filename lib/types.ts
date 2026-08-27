export type Equipment =
  | 'barbell' | 'dumbbell' | 'cable' | 'machine' | 'kettlebell' | 'bands'
  | 'bodyweight' | 'other';

export type Level = 'beginner' | 'intermediate' | 'advanced';
export type Goal = 'strength' | 'hypertrophy' | 'fat_loss' | 'general';
export type Units = 'kg' | 'lb';
export type Category =
  | 'strength' | 'stretching' | 'plyometrics' | 'cardio'
  | 'strongman' | 'powerlifting' | 'olympic weightlifting';

export type BlockKind = 'warmup' | 'straight' | 'superset' | 'circuit';

/** Movement pattern; the plan generator slots exercises by this. */
export type Pattern =
  | 'squat' | 'hinge' | 'lunge'
  | 'h_push' | 'v_push' | 'h_pull' | 'v_pull'
  | 'core' | 'conditioning' | 'mobility'
  | 'biceps' | 'triceps' | 'delts' | 'calves' | 'traps' | 'forearms'
  | 'carry' | 'other';

export type MediaRefs =
  | { asset: string }
  | { start: string; end: string };

export interface Exercise {
  id: string;
  name: string;
  body_part: string;
  equipment: Equipment;
  mechanic: 'compound' | 'isolation' | null;
  force_type: string | null;
  level: Level;
  is_bodyweight: boolean;
  is_unilateral: boolean;
  met: number | null;
  primary_muscles: string[];
  secondary_muscles: string[];
  instructions: string[];
  tips: string[];
  media_kind: 'animated' | 'crossfade';
  media_refs: MediaRefs;
  category: Category;
  source: 'repdb' | 'fedb';
  pattern: Pattern;
}

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  units: Units;
  bodyweight_kg: number | null;
  height_cm: number | null;
  goal: Goal | null;
  experience: Level | null;
  days_per_week: number | null;
  session_minutes: number | null;
  equipment: Equipment[];
  limitations: string[];
  onboarded_at: string | null;
}

export interface PlanItem {
  id: string;
  item_index: number;
  exercise_id: string;
  sets: number;
  reps_low: number;
  reps_high: number;
  seconds: number | null;
  tempo: string | null;
  notes: string | null;
}

export interface PlanBlock {
  id: string;
  block_index: number;
  kind: BlockKind;
  title: string;
  rounds: number;
  rest_seconds: number;
  items: PlanItem[];
}

export interface PlanDay {
  id: string;
  day_index: number;
  name: string;
  focus: string;
  blocks: PlanBlock[];
}

export interface Plan {
  id: string;
  name: string;
  split: string;
  weeks: number;
  days: PlanDay[];
}

/** One logged set. Bodyweight movements carry load in added_load_kg. */
export interface SetLog {
  plan_item_id: string;
  exercise_id: string;
  set_index: number;
  reps: number | null;
  weight_kg: number | null;
  is_bodyweight: boolean;
  added_load_kg: number;
  rpe: number | null;
}
