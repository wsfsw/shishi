Source: fanyuantaier/wechatauto-replica, Apache-2.0.
Pinned commit: 91dc0e1a601013b759b261061d8f7642f736af90.
Original db.py is preserved unmodified for provenance; LICENSE accompanies it.
Shishi loads a restricted AST allowlist of read-only primitives, without the
upstream constructor, logger, plaintext cache, UI modules or history exporter.
Shishi implements its own authenticated RAM snapshot, selected-group queries,
durable delivery queue and standalone supervisor in scripts/background_*.py
and background-supervisor.mjs.
