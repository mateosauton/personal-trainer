import raw from '@/lib/data/exercises.json';
import type { Equipment, Exercise, Pattern } from '@/lib/types';

const source = new Map((raw as unknown as Exercise[]).map((exercise) => [exercise.id, exercise]));
const exercises: Exercise[] = [];
/** Only equivalent movements with the same loading convention may share recorded weights. */
export const GYM_ROUTINE_WEIGHT_ALIASES = new Map<string, string>();

/** Stable local IDs keep routine variations separate from the source catalog. */
export function gymExerciseId(name: string): string {
  return `gym_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
}

function alias(name: string, sourceId: string, overrides: Partial<Exercise> = {}) {
  const original = source.get(sourceId);
  if (!original) throw new Error(`Missing routine exercise source: ${sourceId}`);
  const exercise = { ...original, ...overrides, id: gymExerciseId(name), name };
  exercises.push(exercise);
  if (!/^light\b/i.test(name)
    && exercise.equipment === original.equipment
    && exercise.is_bodyweight === original.is_bodyweight) {
    GYM_ROUTINE_WEIGHT_ALIASES.set(exercise.id, sourceId);
  }
}

function movement(
  name: string,
  equipment: Equipment,
  pattern: Pattern,
  muscles: string[],
  instructions: string[],
  unilateral = false,
  level: Exercise['level'] = 'intermediate',
) {
  exercises.push({
    id: gymExerciseId(name), name, equipment, pattern,
    body_part: muscles[0], primary_muscles: muscles,
    secondary_muscles: [], mechanic: 'compound', force_type: null, level,
    is_bodyweight: equipment === 'bodyweight', is_unilateral: unilateral,
    instructions, category: pattern === 'mobility' ? 'stretching' : 'strength',
    // An image of one component would misrepresent a combination exercise.
    media_refs: { start: '', end: '' },
  });
}

// Exact movements keep the source demonstrations; names match the written plan.
alias('Bodyweight squat', 'Bodyweight_Squat');
alias('Incline push-up', 'Incline_Push-Up', {
  instructions: [
    'Place your hands slightly wider than shoulder width on a stable flat bench and step your feet back.',
    'Keep your trunk straight while bending your elbows to lower your chest toward the bench.',
    'Press back up with control without letting your lower back sag.',
  ],
});
alias('Light bent-over dumbbell row', 'Bent_Over_Two-Dumbbell_Row');
alias('Dead bug', 'Dead_Bug', { is_unilateral: true });
alias('Barbell bench press', 'Barbell_Bench_Press_-_Medium_Grip');
alias('Seated dumbbell shoulder press', 'Dumbbell_Shoulder_Press');
alias('Dumbbell lateral raise', 'Side_Lateral_Raise');
alias('Lying dumbbell triceps extension', 'Lying_Dumbbell_Tricep_Extension');
alias('Forearm plank', 'Plank');
alias('Light dumbbell floor press', 'Dumbbell_Floor_Press');
alias('Light lat-pulldown machine', 'Wide-Grip_Lat_Pulldown', { equipment: 'machine' });
alias('Reverse crunch', 'Reverse_Crunch');
alias('Pull-up', 'Pullups');
alias('Chest-supported dumbbell row', 'Dumbbell_Incline_Row');
alias('Seated row machine', 'Seated_Cable_Rows', { equipment: 'machine' });
alias('Straight-bar barbell curl', 'Barbell_Curl');
alias('Kettlebell gorilla row', 'Alternating_Kettlebell_Row', { is_unilateral: true });
alias('Glute bridge', 'Butt_Lift_Bridge');
alias('Light chest-supported dumbbell row', 'Dumbbell_Incline_Row');
alias('Barbell back squat', 'Barbell_Squat');
alias('Barbell Romanian deadlift', 'Romanian_Deadlift');
alias('Bulgarian split squat', 'Split_Squat_with_Dumbbells', { is_unilateral: true });
alias('Standing dumbbell calf raise', 'Standing_Dumbbell_Calf_Raise', {
  instructions: [
    'Stand on the floor holding dumbbells at your sides. Keep your feet about hip width apart.',
    'Rise onto the balls of your feet, pause briefly, then lower both heels slowly.',
    'Use a light hand on the rack for balance if needed and hold one dumbbell in the other hand.',
  ],
});
alias('Light seated row machine', 'Seated_Cable_Rows', { equipment: 'machine' });
alias('Incline barbell bench press', 'Barbell_Incline_Bench_Press_-_Medium_Grip');
alias('Parallel-bar dip', 'Parallel_Bar_Dip', { equipment: 'bodyweight', is_bodyweight: true });
alias('Seated dumbbell lateral raise', 'Seated_Side_Lateral_Raise');
alias('Seated overhead dumbbell triceps extension', 'Seated_Triceps_Press');
alias('Single-arm kettlebell push press', 'One-Arm_Kettlebell_Push_Press');
alias('Close-grip incline push-up', 'Incline_Push-Up_Close-Grip', {
  instructions: [
    'Place your hands close together on a stable flat bench and step your feet back into a straight body line.',
    'Bend your elbows to lower your chest toward the bench while keeping your trunk braced.',
    'Press back to the start with control, using a comfortable hand width and shoulder range.',
  ],
});
alias('Light incline-bench dumbbell reverse fly', 'Reverse_Flyes');
alias('Chin-up', 'Chin-Up');
alias('Barbell bent-over row', 'Bent_Over_Barbell_Row');
alias('Lat-pulldown machine', 'Wide-Grip_Lat_Pulldown', { equipment: 'machine' });
alias('Incline dumbbell curl', 'Incline_Dumbbell_Curl');
alias('Seated bench knee tuck', 'Seated_Flat_Bench_Leg_Pull-In');
alias('Light neutral-grip dumbbell bench press', 'Dumbbell_Bench_Press_with_Neutral_Grip');
alias('Barbell front squat', 'Front_Barbell_Squat');
alias('Barbell hip thrust', 'Barbell_Hip_Thrust');

movement('Dumbbell thruster', 'dumbbell', 'v_push', ['quadriceps', 'shoulders', 'abdominals'], [
  'Hold two light dumbbells at your shoulders with your feet around shoulder width apart.',
  'Squat through a controlled range, then stand and use the leg drive to press both weights overhead.',
  'Lower to your shoulders and repeat without leaning backward. One squat and press is one rep.',
], false, 'advanced');
movement('Reverse lunge, then single-arm dumbbell press', 'dumbbell', 'v_push', ['quadriceps', 'shoulders', 'abdominals'], [
  'Hold a light dumbbell at one shoulder. Step backward into a reverse lunge.',
  'Return fully to standing and establish your balance before pressing overhead.',
  'Lower to the shoulder, finish the prescribed reps, then switch sides. One lunge and press is one rep.',
], true, 'advanced');
movement('Push-up to alternating knee drive', 'bodyweight', 'h_push', ['chest', 'abdominals'], [
  'Begin in a high plank, hands beneath shoulders and trunk braced.',
  'Perform a controlled push-up, then bring one knee toward your chest and return it.',
  'Alternate the knee on each rep. One push-up and one knee drive counts as one rep.',
], false, 'advanced');
movement('Forward bear crawl', 'bodyweight', 'conditioning', ['abdominals', 'shoulders', 'quadriceps'], [
  'Start on hands and knees, with hands under shoulders and knees under hips.',
  'Lift your knees a few centimetres. Take small forward steps with opposite hand and foot.',
  'Keep your back level and breathe throughout. Turn around carefully if space is limited.',
]);
movement('Bench crunch', 'bodyweight', 'core', ['abdominals'], [
  'Lie lengthwise on a flat bench with knees bent and feet supported securely.',
  'Exhale and lift your shoulder blades a little while keeping your lower back controlled.',
  'Lower slowly. Keep your neck relaxed and use the floor if the bench feels unstable.',
]);
movement('High-plank shoulder tap', 'bodyweight', 'core', ['abdominals', 'shoulders'], [
  'Set up in a high plank with hands beneath shoulders and feet wide enough for balance.',
  'Touch one hand to the opposite shoulder, set it down, then switch.',
  'Keep hips facing the floor and move slowly. Count the prescribed reps on each side.',
], true);
movement('Side plank', 'bodyweight', 'core', ['abdominals', 'obliques'], [
  'Lie on your side with elbow beneath shoulder and legs stacked or staggered.',
  'Lift your hips so head, trunk, and legs form a straight line. Keep breathing.',
  'Hold for the prescribed time, then switch sides. Bend your knees for an easier option.',
], true);
movement('Bodyweight reverse lunge', 'bodyweight', 'lunge', ['quadriceps', 'glutes'], [
  'Stand tall, step one foot back, and bend both knees through a comfortable range.',
  'Push through your front foot to return to standing without bouncing.',
  'Alternate sides and complete the listed reps on each side.',
], true, 'beginner');
movement('Renegade row', 'dumbbell', 'h_pull', ['middle back', 'abdominals', 'shoulders'], [
  'Use stable, flat-sided dumbbells and take a wide-foot high-plank position.',
  'Brace your trunk and row one dumbbell toward your hip without rotating your pelvis.',
  'Lower with control and alternate sides. With round dumbbells, support one hand on a stable bench and row with the other.',
], true, 'advanced');
movement('Single-leg Romanian deadlift to dumbbell row', 'dumbbell', 'h_pull', ['hamstrings', 'middle back', 'abdominals'], [
  'Hold a light dumbbell opposite the standing leg. Keep a small bend in that knee.',
  'Hinge at the hip as the free leg reaches behind. Pause in a stable position, then row toward your hip.',
  'Lower the weight and stand. Complete both sides; use the free hand on a bench for balance if needed.',
], true, 'advanced');
movement('Farmer carry', 'dumbbell', 'carry', ['forearms', 'abdominals', 'traps'], [
  'Stand tall holding a dumbbell in each hand at your sides.',
  'Walk with short controlled steps, ribs stacked over hips, and shoulders relaxed.',
  'Keep a clear walking path. March in place if there is no room to walk.',
]);
movement('Hanging knee raise', 'bodyweight', 'core', ['abdominals'], [
  'Hang from the pull-up bar with a secure grip and shoulders controlled.',
  'Exhale and raise bent knees without swinging, gently curling the pelvis upward.',
  'Lower slowly. Use lying bent-knee raises if grip or shoulder control limits the movement.',
]);
movement('Supine straight-leg lowering', 'bodyweight', 'core', ['abdominals'], [
  'Lie on your back with legs lifted and arms resting on the floor.',
  'Brace your abdomen and lower your legs only as far as you can keep your back controlled.',
  'Return slowly. Bend the knees to shorten the lever if your lower back starts to arch.',
]);
movement('Quadruped shoulder tap', 'bodyweight', 'core', ['abdominals', 'shoulders'], [
  'Start on hands and knees with hands under shoulders and knees under hips.',
  'Lift one hand to touch the opposite shoulder without shifting or rotating the trunk.',
  'Return the hand, then alternate sides while breathing steadily.',
], true);
movement('Suitcase hold', 'dumbbell', 'core', ['obliques', 'abdominals', 'forearms'], [
  'Hold one dumbbell at your side and stand tall with both feet firmly planted.',
  'Keep your shoulders level and avoid leaning toward or away from the weight.',
  'Hold for the prescribed time, set the weight down with control, then switch hands.',
], true);
movement('Wall push-up', 'bodyweight', 'h_push', ['chest', 'triceps'], [
  'Place hands on a wall at shoulder height and step back slightly.',
  'Keep your trunk straight as you bend your elbows to bring your chest toward the wall.',
  'Press back to the start with control. Move your feet closer for an easier version.',
], false, 'beginner');
movement('Supine heel tap', 'bodyweight', 'core', ['abdominals'], [
  'Lie on your back with hips and knees bent to about 90 degrees.',
  'Brace your abdomen and lower one heel to tap the floor without arching your lower back.',
  'Bring it back up and alternate sides. Keep the motion small and controlled.',
], true);
movement('Dumbbell front-rack walking lunge', 'dumbbell', 'lunge', ['quadriceps', 'glutes', 'abdominals'], [
  'Hold two light dumbbells at shoulder height, with your trunk upright.',
  'Step forward into a controlled lunge, then stand and step through with the other leg.',
  'Complete the prescribed reps on each side. Use alternating stationary lunges if space is limited.',
], true, 'advanced');
movement('Goblet Cossack squat', 'kettlebell', 'squat', ['quadriceps', 'adductors', 'abdominals'], [
  'Hold a light kettlebell at your chest and take a wide stance.',
  'Shift toward one side, bending that knee while keeping the other leg long and your heel supported.',
  'Use a comfortable depth, return to the centre, and alternate sides. Do not force the range.',
], true, 'advanced');
movement('Single-leg Romanian deadlift with opposite-hand dumbbell', 'dumbbell', 'hinge', ['hamstrings', 'glutes', 'abdominals'], [
  'Hold one dumbbell in the hand opposite your standing leg. Soften the standing knee.',
  'Push your hips back as your free leg reaches behind, keeping your hips facing the floor.',
  'Return to standing with control. Use a bench for balance if needed, then complete the other side.',
], true, 'advanced');
movement('Single-arm kettlebell front squat, stand, then strict press', 'kettlebell', 'v_push', ['quadriceps', 'shoulders', 'abdominals'], [
  'Hold a light kettlebell at one shoulder with the bell resting comfortably against your forearm.',
  'Squat through a controlled range, then stand fully and regain balance.',
  'Press overhead without leg drive or backward lean, lower to the rack, and repeat. Complete both sides.',
], true, 'advanced');
movement('Bench reverse crunch', 'bodyweight', 'core', ['abdominals'], [
  'Lie lengthwise on a flat bench, holding the sides securely with knees bent.',
  'Draw your knees toward your chest and gently curl your pelvis off the bench.',
  'Lower slowly without swinging. Use the floor if the bench is not stable.',
]);
movement('Long-lever forearm plank', 'bodyweight', 'core', ['abdominals'], [
  'Begin in a forearm plank, then place your elbows a little farther in front of your shoulders.',
  'Brace your abdomen and glutes and maintain a straight line without letting the lower back sag.',
  'Hold while breathing. Move elbows back beneath shoulders if control is lost.',
]);
movement('Bird dog hold', 'bodyweight', 'core', ['abdominals', 'glutes'], [
  'Start on hands and knees with a level back.',
  'Reach one arm forward and the opposite leg back without rotating your hips.',
  'Hold and breathe, then change sides. Reach only as far as you can keep your trunk still.',
], true);
movement('Side-plank hip lift', 'bodyweight', 'core', ['obliques', 'abdominals'], [
  'Start in a side plank with elbow beneath shoulder and feet stacked or staggered.',
  'Lower your hips a little, then lift back to a straight body line without rolling forward.',
  'Complete both sides. Keep the lower knee on the floor for an easier variation.',
], true);
movement('Bodyweight lateral lunge', 'bodyweight', 'lunge', ['quadriceps', 'glutes', 'adductors'], [
  'Stand tall and step sideways, keeping your toes facing generally forward.',
  'Sit back into the stepping hip as that knee bends, keeping the other leg long.',
  'Push back to the start and alternate sides through a comfortable range.',
], true, 'beginner');
movement('Kneeling push-up', 'bodyweight', 'h_push', ['chest', 'triceps'], [
  'Place your hands just outside shoulder width and rest your knees on the floor.',
  'Keep a straight line from your head through your hips to your knees as you lower your chest.',
  'Press up with control without letting your lower back sag.',
], false, 'beginner');
movement('Bird dog with knee-to-elbow', 'bodyweight', 'core', ['abdominals', 'glutes'], [
  'From hands and knees, extend one arm and the opposite leg while keeping hips level.',
  'Draw the elbow and knee toward each other under your trunk, then extend again.',
  'Move slowly, complete the prescribed reps, and change sides.',
], true);
movement('Plate lateral lunge, then overhead press', 'other', 'v_push', ['quadriceps', 'shoulders', 'abdominals'], [
  'Hold a light weight plate securely at your chest with both hands.',
  'Step into a lateral lunge, then push back to standing and regain your balance.',
  'Press the plate overhead without leaning back, lower it, then alternate the lunge side.',
], true, 'advanced');
movement('Staggered-hand push-up to shoulder tap', 'bodyweight', 'h_push', ['chest', 'abdominals'], [
  'Start in a high plank with one hand slightly ahead of the other, keeping feet wide enough for balance.',
  'Perform one push-up, then tap the opposite shoulder with one hand while keeping hips level.',
  'Alternate the tapping side and switch the staggered hand position halfway through the set.',
], false, 'advanced');
movement('Overhead plate march', 'other', 'conditioning', ['shoulders', 'abdominals', 'quadriceps'], [
  'Press a light plate overhead with both hands and keep your ribs over your pelvis.',
  'March slowly in place while keeping the plate steady and avoiding a backward lean.',
  'Use a plate held at chest height if the overhead position is uncomfortable.',
]);
movement('Light plate-weighted curl-up', 'other', 'core', ['abdominals'], [
  'Lie on your back with knees bent and hold a light plate securely against your chest.',
  'Exhale and curl your shoulder blades a short distance off the floor.',
  'Lower slowly without pulling your neck forward. Use no weight if needed.',
]);
movement('Plank walkout', 'bodyweight', 'core', ['abdominals', 'shoulders'], [
  'Start standing, soften your knees, and place your hands on the floor.',
  'Walk your hands forward into a high plank without letting your hips sag.',
  'Walk your hands back toward your feet and return to standing. That sequence is one rep.',
]);
movement('High-plank dumbbell drag', 'dumbbell', 'core', ['abdominals', 'obliques'], [
  'Begin in a high plank with feet wide and a light dumbbell just outside one hand.',
  'Reach the opposite hand under your body and pull the dumbbell across to the other side.',
  'Return the hand to the floor and alternate. Keep hips level and place the weight down gently.',
], true);
movement('Offset dumbbell front-rack hold', 'dumbbell', 'core', ['abdominals', 'obliques', 'shoulders'], [
  'Hold one dumbbell securely at one shoulder and stand with feet about hip width apart.',
  'Keep your ribs over your pelvis and shoulders level without leaning to either side.',
  'Hold and breathe, then switch sides for the prescribed time.',
], true);
movement('Bodyweight split squat', 'bodyweight', 'lunge', ['quadriceps', 'glutes'], [
  'Take a stable staggered stance with both feet on the floor.',
  'Lower by bending both knees, keeping the front foot planted and trunk upright.',
  'Press through the front foot to rise. Complete the listed reps, then switch legs.',
], true, 'beginner');
movement('Bent-knee hollow hold', 'bodyweight', 'core', ['abdominals'], [
  'Lie on your back with knees bent, feet lifted, and arms reaching beside your hips.',
  'Gently lift your shoulder blades while keeping your lower back controlled against the floor.',
  'Hold and breathe. Set your feet down if you cannot maintain the trunk position.',
]);
movement('Reverse lunge, then one-arm dumbbell row', 'dumbbell', 'h_pull', ['quadriceps', 'middle back', 'abdominals'], [
  'Hold a light dumbbell in one hand and perform a controlled reverse lunge.',
  'Return to standing, then hinge into a stable position before rowing the weight toward your hip.',
  'Lower the weight and stand again. One lunge and row is one rep; complete both sides.',
], true, 'advanced');
movement('Staggered-stance double-kettlebell deadlift to row', 'kettlebell', 'h_pull', ['hamstrings', 'middle back', 'abdominals'], [
  'Take a short staggered stance and hold two light kettlebells at your sides.',
  'Hinge at the hips with soft knees, pause, then row both bells toward your ribs.',
  'Lower the bells before standing. One hinge-row-stand is one rep; switch the forward foot for the other side.',
], true, 'advanced');
movement('Bear-plank dumbbell pull-through', 'dumbbell', 'h_pull', ['abdominals', 'middle back', 'shoulders'], [
  'Start on hands and knees with a light dumbbell beside one hand, then hover your knees just off the floor.',
  'Reach the opposite hand underneath and pull the dumbbell across while keeping your back level.',
  'Replace the hand and alternate sides. Keep knees down if hovering prevents trunk control.',
], true, 'advanced');
movement('Kettlebell suitcase march', 'kettlebell', 'carry', ['abdominals', 'obliques', 'forearms'], [
  'Hold one kettlebell at your side and stand tall.',
  'March slowly in place without leaning or rotating toward the weight.',
  'Change hands halfway through the total station time and keep breathing.',
], true);
movement('Hollow-body rock', 'bodyweight', 'core', ['abdominals'], [
  'Lie on your back in a controlled hollow hold with shoulder blades and feet lifted.',
  'Rock gently as one unit, keeping the curve of your trunk unchanged.',
  'Use bent knees or a stationary hollow hold if you cannot keep your lower back controlled.',
]);
movement('Dead bug with plate held above chest', 'other', 'core', ['abdominals'], [
  'Lie on your back with hips and knees bent to 90 degrees and a light plate held securely above your chest.',
  'Keep the plate steady as you extend one leg only as far as you can control your lower back.',
  'Return and alternate legs. Set the plate down if it distracts from abdominal control.',
], true);
movement('Side plank with top-leg lift', 'bodyweight', 'core', ['obliques', 'abdominals', 'glutes'], [
  'Start in a side plank with elbow beneath shoulder and trunk in a straight line.',
  'Lift the top leg a small distance without rolling your pelvis, then lower with control.',
  'Complete both sides. Keep the bottom knee on the floor or omit the leg lift if needed.',
], true);
movement('Bodyweight good morning', 'bodyweight', 'hinge', ['hamstrings', 'glutes'], [
  'Stand with feet about hip width apart, hands on your hips, and knees slightly bent.',
  'Push your hips back to hinge forward while maintaining a long, controlled spine.',
  'Stop when you feel the hamstrings load, then stand by bringing the hips forward.',
], false, 'beginner');
movement('Light underhand dumbbell row', 'dumbbell', 'h_pull', ['middle back', 'biceps'], [
  'Hold two light dumbbells with palms facing forward and hinge at the hips with knees soft.',
  'Keep your trunk still as you row the weights toward your waist.',
  'Lower with control without rounding or swinging your back.',
]);
movement('Supine abdominal-braced march', 'bodyweight', 'core', ['abdominals'], [
  'Lie on your back with knees bent and both feet on the floor.',
  'Brace your abdomen gently, lift one foot a few centimetres without moving your pelvis, then lower it.',
  'Alternate sides while breathing, keeping your trunk still.',
], true, 'beginner');
movement('Dumbbell Romanian deadlift', 'dumbbell', 'hinge', ['hamstrings', 'glutes'], [
  'Stand holding two dumbbells in front of your thighs, knees slightly bent.',
  'Push your hips backward and lower the weights close to your legs until your hamstrings limit the range.',
  'Keep your spine controlled and stand by driving your hips forward without leaning back.',
]);
movement('Seated calf raise with dumbbells on thighs', 'dumbbell', 'calves', ['calves'], [
  'Sit on a flat bench with both feet flat and dumbbells resting securely on your thighs just above the knees.',
  'Keep hold of the dumbbells and raise both heels as high as is comfortable.',
  'Pause, then lower slowly. Use the floor; an elevated step is not required.',
]);
movement('Reverse lunge with single-arm overhead dumbbell hold', 'dumbbell', 'lunge', ['quadriceps', 'shoulders', 'abdominals'], [
  'Hold a light dumbbell overhead in one hand with ribs over hips and shoulder controlled.',
  'Step back into a reverse lunge, then return to a stable standing position.',
  'Complete both sides. Use a shoulder-height front-rack hold if overhead balance is difficult.',
], true, 'advanced');
movement('Dumbbell front-rack lateral lunge', 'dumbbell', 'lunge', ['quadriceps', 'glutes', 'abdominals'], [
  'Hold light dumbbells at your shoulders and stand tall.',
  'Step sideways and sit into that hip, keeping your trunk upright and opposite leg long.',
  'Push back to standing and alternate sides through a comfortable range.',
], true, 'advanced');
movement('Two-hand kettlebell swing, if already proficient', 'kettlebell', 'hinge', ['hamstrings', 'glutes', 'abdominals'], [
  'Use this movement only if you already know the swing. Otherwise perform a kettlebell deadlift for eight reps.',
  'With both hands on the bell, hinge at the hips and hike it back between your legs.',
  'Drive through your hips to float the bell toward chest height, then hinge as it returns. Keep arms relaxed and do not lift overhead.',
  'Stop swinging if fatigue affects control; set the bell down before changing to deadlifts.',
], false, 'advanced');
movement('Dumbbell squat to alternating overhead press', 'dumbbell', 'v_push', ['quadriceps', 'shoulders', 'abdominals'], [
  'Hold two light dumbbells at your shoulders.',
  'Perform a controlled squat, stand fully, then press one dumbbell overhead without leaning back.',
  'Lower the weight and repeat, alternating the pressing arm. One squat and one press is one total rep.',
], false, 'advanced');
movement('Lying bent-knee leg raise', 'bodyweight', 'core', ['abdominals'], [
  'Lie on your back with knees bent and arms resting by your sides.',
  'Brace your abdomen and bring both bent knees upward, keeping the movement controlled.',
  'Lower only as far as your back stays steady. Reduce the range or move one leg at a time if needed.',
]);
movement('Forearm plank with alternating leg lift', 'bodyweight', 'core', ['abdominals', 'glutes'], [
  'Begin in a forearm plank with elbows beneath shoulders and hips level.',
  'Lift one foot a small distance from the floor without arching or rotating your lower back.',
  'Lower and alternate sides with slow, controlled movement.',
], true);
movement('Floor dumbbell pullover with legs in tabletop', 'dumbbell', 'core', ['abdominals', 'lats'], [
  'Lie on your back with hips and knees at 90 degrees and a light dumbbell held securely above your chest.',
  'Keep your trunk braced as you lower the dumbbell behind your head only through a comfortable, controlled range.',
  'Bring it back above the chest without arching your back. Put your feet down or shorten the range if needed.',
]);
movement('Side-plank reach-through', 'bodyweight', 'core', ['obliques', 'abdominals'], [
  'Start in a side plank with elbow beneath shoulder and top arm reaching upward.',
  'Reach the top hand gently beneath your trunk, then rotate back to the starting position.',
  'Keep hips lifted and move through a small controlled range. Complete both sides.',
], true);

// Five minutes of unloaded preparation for each training session.
const warmups: [string, string[]][] = [
  ['Marching with arm swings', ['March at an easy pace and swing your arms naturally.', 'Keep breathing comfortably and gradually increase the range as you warm up.']],
  ['Squat-to-overhead-reach', ['Perform a shallow bodyweight squat, then stand and reach both arms overhead.', 'Use a smooth comfortable range without weights.']],
  ['Standing hip hinge', ['Stand with soft knees and hands on your hips.', 'Push your hips back, keeping your spine controlled, then stand tall.']],
  ['Alternating reverse lunge', ['Step one foot back into a shallow lunge, return to standing, and alternate.', 'Keep the movement easy and use a rack for balance if needed.']],
  ['Gentle torso rotation', ['Stand with knees soft and rotate gently from side to side.', 'Let your feet and hips turn naturally and avoid forcing the range.']],
  ['Low-impact step jacks', ['Step one foot sideways while raising your arms through a comfortable range.', 'Return and alternate sides at an easy pace without jumping.']],
  ['Shoulder rolls', ['Stand relaxed and slowly circle both shoulders forward and backward.', 'Keep your neck comfortable and avoid shrugging hard.']],
  ['Alternating knee hugs', ['Stand tall and gently lift one knee toward your chest with your hands.', 'Release it, step down, and alternate sides without rounding forcefully.']],
  ['Unweighted good mornings', ['With knees soft, push your hips back and hinge forward through a comfortable range.', 'Return to standing without weights or momentum.']],
  ['Quadruped thoracic rotations', ['Begin on hands and knees and place one hand lightly behind your head.', 'Rotate that elbow gently toward the ceiling, return, and switch sides halfway.']],
  ['Brisk walking in place', ['Walk in place with relaxed arm swings at a comfortable warmup pace.', 'Stay light on your feet and breathe freely.']],
  ['Ankle rocks', ['In a short staggered stance, gently move the front knee forward over the foot while keeping the heel down.', 'Use a comfortable range and switch sides halfway.']],
  ['Shallow squats with a reach', ['Sit into a shallow squat while reaching both arms forward.', 'Stand tall and repeat smoothly without weights.']],
  ['Lateral steps', ['Take easy side steps in each direction with knees soft.', 'Keep your trunk tall and feet controlled.']],
  ['Arm circles', ['Raise your arms to a comfortable height and make small circles.', 'Gradually enlarge the circles and reverse direction halfway.']],
  ['Alternating heel digs with arm swings', ['Tap one heel in front of you and swing your arms naturally.', 'Alternate feet at an easy steady pace.']],
  ['Arm sweeps across the chest', ['Open your arms gently, then sweep them across the chest.', 'Alternate the upper arm and avoid forcing the shoulder range.']],
  ['Alternating step-back reaches', ['Step one foot back lightly while reaching the same-side arm overhead.', 'Return to standing and alternate without leaning backward.']],
  ['Wall slides', ['Stand with your back near a wall and arms bent at a comfortable angle.', 'Slide your arms upward only as far as your shoulders allow without arching your lower back.']],
  ['Standing hip circles', ['Stand with feet planted and knees soft, using a rack for light support if needed.', 'Move your hips through small comfortable circles and reverse halfway.']],
  ['Side steps with arm swings', ['Step side to side at an easy pace while swinging both arms.', 'Keep the movement relaxed and gradually warm up.']],
  ['Standing elbow pullbacks', ['Stand tall with elbows bent and gently draw them backward.', 'Let your shoulder blades move without arching your lower back, then release.']],
  ['Dynamic hamstring sweep', ['Place one heel forward with that knee soft and hinge gently at your hips.', 'Sweep your hands toward the shin, rise, and alternate sides without bouncing.']],
  ['Walking knee lift', ['Walk in place and raise one knee at a time through a comfortable range.', 'Stay upright and alternate smoothly.']],
  ['Standing diagonal reach', ['Reach one arm upward across your body while turning your feet and hips gently.', 'Return to centre and alternate sides without forcing the spine.']],
  ['Easy low-knee marching', ['March in place with small comfortable knee lifts and relaxed arms.', 'Keep breathing freely and stay at an easy pace.']],
  ['Lateral weight shift', ['Take a wide stance and shift your weight gently from one foot to the other.', 'Bend the loaded knee slightly while keeping both feet grounded.']],
  ['Heel-to-toe rock', ['Stand tall and rock gently from heels to the balls of your feet.', 'Use the rack for balance and keep the range comfortable.']],
  ['Standing cross-crawl', ['March slowly, bringing each hand toward the opposite lifted knee.', 'Alternate sides with a relaxed trunk rotation.']],
  ['Easy plank-to-downward-dog', ['Begin in a high plank, then push your hips upward and back through a comfortable range.', 'Return smoothly to the plank, keeping knees bent if needed.']],
];

for (const [name, instructions] of warmups) {
  movement(name, 'bodyweight', 'mobility', ['full body'], instructions, false, 'beginner');
}

export const GYM_ROUTINE_EXERCISES: Exercise[] = exercises;
export const GYM_ROUTINE_EXERCISE_IDS = new Set(exercises.map((exercise) => exercise.id));
