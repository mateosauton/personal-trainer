# Training preferences and the calendar

These paths are implemented locally. The new migrations and RPCs must be deployed together before using the updated client. Native flow validation remains required.

Profile edits goal, experience, days a week, session length, available equipment and limitations. Saving asks for confirmation and commits preferences with the matching generated plan in one transaction. The old plan becomes inactive; sessions, set logs and progression are retained. A failed plan write rolls the preferences back. Plan writes capture the expected account's token so a delayed action cannot write to the next signed-in account.

Equipment choices narrow the confirmed office inventory. Bodyweight remains available. The generator, fixed PPL activation and swap candidates apply the same equipment, experience and limitation filters, including primary and secondary muscle constraints. The PPL rotation keeps its authored six-session structure and 47-minute budget. It replaces or omits unavailable movements and rejects activation when an entire block has no compatible exercise. Its volume, goal and schedule are not personalized by this change.

Work exercises can be swapped in the session overview before beginning. Alternatives keep the same movement pattern, per-side convention and timed-versus-rep prescription. The choice changes that plan item for future rotations. Previously logged exercise identities remain intact. An unfinished session blocks edits to its day; a saved workout must be finished first. Old unfinished server sessions can require explicit recovery. They are never discarded based on age.

Session start and swaps lock the owner's profile row. Start also compares the overview's exact item/exercise template with the active plan. If another device swaps first, the stale overview cannot start. If start wins, the unfinished session blocks a swap. Profile rebuilds may retire a plan with server sessions on another device, but those original plan rows and sessions remain available for recovery.

## Home timezone

The app uses one stable home timezone for today, streaks, calendar membership and history dates. New users capture their device timezone at onboarding. Changing the device timezone while travelling does not change the home timezone. The dashboard passes its home-calendar today key to the streak and calendar, and refreshes it at home midnight and when the app returns to the foreground.

Existing profiles use the timezone of their earliest session with a valid recorded `tz`. If no such evidence exists, the migration assigns UTC. Older backfilled records have no reliable origin timezone; the app does not invent one. The chosen timezone is shown in Profile and the Plan tab.

Every displayed session date is derived from `started_at` in the profile's home timezone. Existing stored `local_day` and `tz` values remain unchanged as capture/backfill metadata. This intentionally puts all history on the same home calendar instead of mixing guessed UTC days and travel-local days. New session starts capture the server start timestamp, home `local_day`, timezone and original calculation context in one transaction.

Day arithmetic operates on calendar keys with UTC arithmetic, independent of device timezone and daylight-saving shifts. Tests cover home midnight, travel in both directions between UTC-3 and UTC+9, explicit UTC fallback for backfilled history, and nonnegative inactivity counts. The local database harness covers timezone validation and inference, plan/profile rollback, historical preservation, stale swaps and stale overview rejection.
