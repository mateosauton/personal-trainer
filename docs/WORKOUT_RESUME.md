# Workout recovery

An active workout is saved on the device under its account ID. Home offers Resume workout even when the dashboard cannot load. Beginning another workout returns to the saved workout until its summary has been saved.

The snapshot contains the original training day, units, exercise progression, current set, drafts, rest deadline, and start/end times. Cursor changes are persisted before the player advances. Restarting the app restores that snapshot without fetching the plan. Rest timers use the original deadline; workout duration includes time spent paused and stops when the last set is completed.

A successful server progression receipt clears the matching snapshot. Failed summary synchronization keeps it for retry. A completed session opened without a snapshot goes directly to its summary. Account changes cancel pending navigation and hide the previous account's workout.

Storage errors keep the current step visible. Invalid snapshots are preserved rather than silently deleted, and the UI offers retry. Explicit recovery/export for damaged snapshots remains follow-up work.

## Verification and remaining work

Automated checks cover restarting storage, offline restoration, corrected sets, saved units, elapsed rest deadlines, stable completion duration, failed persistence, and account-switch navigation. These component checks do not establish a full flow on an installed native build.

Starting a new workout and calculating a new summary still require the backend. This change does not resolve delayed server writes overwriting newer set corrections. Production schema changes, native authentication redirects, and a fresh native release verification remain launch gates.
