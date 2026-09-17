# FBL-Clash

Rules-light hidden-combination interface for **Foundry VTT v13.351** and **Forbidden Lands v13.0.5**.

FBL-Clash deliberately does **not** roll dice, spend actions, inspect talents, or decide rules. It provides a synchronized table for hidden declarations, reveals, and a GM-controlled resolution queue.

## Installation

Copy the `fbl-clash` folder into:

`FoundryVTT/Data/modules/`

Restart Foundry if it is running, enable **FBL-Clash** in the world, and create a Script Macro with:

```js
game.fblClash.openLauncher();
```

Two ready-made macro files are included in `macros/`.

## Starting a Clash

The launcher uses controlled and targeted canvas tokens as quick presets. You can also enter names manually.

For each side choose:

- display name/token;
- user who submits that side's hidden declaration;
- number of hidden steps;
- reveal mode;
- default order inside each step;
- whether spectators can see the resolution.

The participant assigned to a side receives an editable sequence. The opponent sees only whether that side is still choosing or has locked its declaration.

## Planning

Each step contains:

- a visual category: Attack, Defense, Prepare, Maneuver, Hinder, Wait, Special, Other, or Empty;
- a free text field for the actual declaration.

Categories are purely visual. They have no rules effect.

The GM may add, remove, or reorder steps while both sides are unlocked. Each side presses **Lock** when ready.

## Reveal modes

### Step by step
Both actions in the next step are revealed together and added to the resolution queue using that step's configured order.

### Entire sequence
All steps are revealed and queued at once.

### Manual reveal
The GM reveals individual cards in any order. Each revealed card is added to the queue independently.

## Resolution order

Each hidden step can be configured as:

- simultaneous;
- left side first;
- right side first.

After reveal, the resulting entries appear in the **Resolution Queue**. The GM may:

- resolve, skip, or cancel entries;
- move entries up/down;
- drag entries to reorder them;
- add arbitrary extra actions before/after the current action or at the end;
- accept extra-action proposals from players.

A simultaneous pair remains a single queue entry containing both actions.

## Extra actions and Willpower abilities

FBL-Clash does not try to understand talents or WP spending.

A player can press **Propose extra action**, describe it, and send it to the GM. The GM can insert it:

- before the current queue entry;
- after the current queue entry;
- at the end.

The GM can also add an action directly. This is intended for Path of the Blade attacks, free parries, reactions, homebrew talents, spells, interruptions, or any ruling made at the table.

## Visibility

With **All players** visibility, participants see the planning interface and spectators automatically receive the public resolution board once the clash reaches the locked/reveal stage. Spectator auto-open can be disabled as a client setting.

With **Participants and GM only**, other players do not receive the interface.

## Rounds and history

**New Round** stores the current sequence in the clash history, clears declarations, and keeps the same participants and step structure.

**Finish** freezes the clash. The GM can then:

- post a compact summary to chat;
- archive and close the clash.

Archived clashes can be inspected from the launcher.

## API / macros

```js
// New clash launcher
game.fblClash.openLauncher();

// Re-open current clash
game.fblClash.open();

// Finish current clash (GM)
game.fblClash.finish();

// Post current summary to chat
game.fblClash.postSummary();

// Open archive
game.fblClash.archive();

// Read a cloned copy of the current state
game.fblClash.getState();
```

## Settings

FBL-Clash adds world/client settings for:

- default step count;
- default reveal mode;
- default within-step order;
- default visibility;
- spectator auto-open;
- custom visual categories;
- archive size.

Custom category names are separated by semicolons or line breaks.

## Design constraints

The module is intentionally system-light. It reads token/actor names and ownership to make setup convenient, but never calls Forbidden Lands attack, defense, damage, talent, or resource logic. This avoids conflicts with system updates and homebrew rules.


## Открытие окна у игроков

Участник столкновения получает окно автоматически. Если видимость выставлена на «Все игроки», зрители также могут получать окно автоматически. ГМ в любой момент может нажать **Открыть окна** в верхней панели Clash, чтобы принудительно открыть текущий Clash у всех подключённых пользователей, которым разрешён просмотр.
