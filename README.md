# Gamemaster Workbench

**Gamemaster Workbench** is a private, system-agnostic Foundry Virtual Tabletop module that gives Gamemasters a built-in Kanban board and campaign-prep notebook.

It is designed for the prep that normally ends up scattered across sticky notes, text files, browser tabs, and half-finished Journal Entries. Open the Workbench from its GM-only scene control, organize tasks at a glance, and keep the details one click away.

## Features

### Private Kanban Board

The default board includes five columns:

- Backlog
- To Do
- In Progress
- Blocked
- Done

Cards can be dragged between columns and reordered. On the board, **only the card title is shown**, keeping the interface clean during a session.

Click a card to open its full prep drawer. Cards support:

- Title
- Description / prep notes
- Low, Normal, or High priority
- Optional prep date
- Session assignment
- Custom tags
- Timestamped comments
- Multiple checklists
- Reorderable checklist items
- Linked Foundry documents
- Duplicate
- Archive / restore
- Permanent deletion

Default tags include NPC, Combat, Maps, Story, Treasure, and Session Prep. You can add your own tags from any card.

### Session Prep Mode

Create named prep sessions such as `Session 18`, set one as the current session, and assign cards to it.

The toolbar can switch between:

- **All Tasks**
- **Current Session**

The header displays current-session completion as the number of cards in the Done column versus the total assigned to that session.

### Private Notes

The Notes tab provides a separate campaign scratchpad. Create as many named notes as you need for things like:

- Session ideas
- Villain plans
- Things the players missed
- Encounter concepts
- Treasure ideas
- Rules reminders

The editor supports basic rich-text formatting including headings, bold, italic, underline, lists, and links.

### Foundry Document Linking

Drag a Foundry document directly onto a card to link it. Supported documents include Actors, Scenes, Journal Entries, Items, Roll Tables, Playlists, and compatible compendium documents.

Linked documents can be opened directly from the card.

Gamemaster Workbench also adds **Add to GM To-Do** to supported Foundry directory context menus. Using it creates a To Do card named `Prep: <Document Name>` and automatically links the source document.

### Search and Filters

Filter the board by:

- Search text
- Priority
- Tag
- Current prep session

Search checks card titles as well as prep descriptions, comments, checklists, tags, and linked-document names without making those details visible on the board itself.

## Privacy and Storage

Gamemaster Workbench is only exposed to users with the Gamemaster role.

Workbench data is stored using Foundry VTT v13's **user-scoped world settings**. This gives each GM account its own independent Workbench in that world and allows the same GM to access their prep from another browser or computer connected to that Foundry world.

The module does not intentionally broadcast Workbench contents over its own sockets and does not create player-visible Journal Entries.

As with other Foundry data, this is application-level privacy rather than encryption from the Foundry server administrator.

## Compatibility

- Foundry Virtual Tabletop: **Version 13**
- Game system: **System agnostic**
- No required dependencies

## Installation from GitHub

After publishing this repository and creating the release, install the module from Foundry's **Add-on Modules** screen using this manifest URL:

```text
https://raw.githubusercontent.com/jeremyrobertdavison/gamemaster-workbench/main/module.json
```

Then enable **Gamemaster Workbench** inside the desired world.

## GitHub Release Workflow

This repository includes a GitHub Actions workflow that builds the Foundry-ready ZIP whenever a version tag beginning with `v` is pushed.

For the initial release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow creates:

```text
gamemaster-workbench-v1.0.0.zip
```

and attaches it to the GitHub Release. The `download` field in `module.json` is already configured for that release asset.

## Using the Workbench

1. Enable the module in your world.
2. Log in as a Gamemaster.
3. Choose the **briefcase** control on Foundry's left-side scene controls.
4. Click the checklist tool to open Gamemaster Workbench.
5. Create cards, sessions, and private notes as needed.

You can also right-click supported documents in Foundry's directories and choose **Add to GM To-Do**.

## Module API

For macros or other modules:

```js
game.modules.get("gamemaster-workbench").api.open();
```

To create a linked card from a Foundry document:

```js
const actor = game.actors.getName("Example Actor");
await game.modules.get("gamemaster-workbench").api.createCardFromDocument(actor);
```

## Repository

https://github.com/jeremyrobertdavison/gamemaster-workbench

## Author

Jeremy Davison
