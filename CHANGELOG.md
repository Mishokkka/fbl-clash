# Changelog

## 0.1.2

- Added lightweight socket sender validation so accidental or malformed non-GM `STATE` / `OPEN_WINDOW` messages cannot replace the shared clash state or force windows open.
- Fixed the GM Clash window remaining visible after archiving and closing a clash.
- Fixed the resolution-order selector becoming unreadable on narrow windows.
- Kept the intentionally simple trusted-table synchronization model: hidden plans remain synchronized as shared state and are hidden by the UI rather than by anti-cheat transport.

## 0.1.1

- Fixed Foundry module socket registration so Clash state reaches player clients.
- Participants now receive and open the Clash window when a clash starts.
- Spectators with access can auto-open from the planning stage when their client setting allows it.
- Added GM button **Open Windows** to force-open the active Clash for every connected user allowed by the visibility setting.
- Added a contrast guard for inputs, selects, textareas, placeholders, disabled controls, modal headings and buttons to prevent dark-on-dark text under Foundry/system themes.

## 0.1.0

Initial playable build.

- GM launcher with token/user presets.
- Hidden free-form declarations for both sides.
- Variable and reorderable step sequence.
- Step, all-at-once, and manual reveal modes.
- Per-step simultaneous/left-first/right-first resolution.
- Public synchronized resolution board.
- Draggable GM resolution queue.
- Resolve/skip/cancel queue states.
- GM-inserted extra actions.
- Player extra-action proposals with GM placement controls.
- Multi-round history.
- Chat summary.
- Archive.
- Russian and English localization.
- Client spectator auto-open setting.
