# Beeper Muse work tracking

Before changing this project, read `docs/parity.md` and its current priorities.
Keep the user's reported bugs and unfinished parity work there across turns.
A new request adds or reprioritizes items; it does not implicitly close old ones.
Update the ledger with each relevant implementation or live observation.

Keep three things distinct: reported behavior, implemented behavior, and verified
behavior in the installed apps. Never close a parity item on mock tests alone.
Do not infer read receipts, original timestamps, delivery or typing from unrelated
UI signals. Preserve the single selected Muse conversation and fail safely on
ambiguous controls. Do not replay uncertain prompts or dismiss queued user work
as part of testing.

Use the development loop in `docs/development-loop.md`. Respect browser-tool
access restrictions. The optional diagnostic file is a user-selected, sanitized
export, not permission to inspect browser profiles or introduce a remote control
endpoint. Update the ledger before handing work back, including concrete blockers.
