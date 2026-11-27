# Gobble Dash — Tilly's Great Escape

[![make.fun · turkey-run-game-01](https://make.fun/badge/turkey-run-game-01.svg)](https://make.fun/bounty/turkey-run-game-01?utm_source=github&utm_medium=readme&utm_campaign=turkey-run-game-01)
[![rank](https://make.fun/badge/turkey-run-game-01/borcyondo-art/turkey-run-game-01/rank.svg)](https://make.fun/bounty/turkey-run-game-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=turkey-run-game-01)
[![reward](https://make.fun/badge/turkey-run-game-01/borcyondo-art/turkey-run-game-01/reward.svg)](https://make.fun/bounty/turkey-run-game-01?utm_source=github&utm_medium=readme&utm_campaign=turkey-run-game-01)

A turkey escape game for the make.fun bounty **turkey-run-game-01**
("Make the best turkey escape game", $250, deadline 29 Nov 2026 09:00 WIB).

## The game

Tilly the turkey is about to become Thanksgiving dinner. Run 1200 metres
across Maplewood Farm, jump the ovens and hay bales, duck the flying
carving knives, grab corn (and the rare pumpkin for an extra life), and
stay ahead of Farmer Bram and his butterfly net. Three hits and you're
caught; reach 1200 m and you're free.

- **Title screen** with instructions and best score.
- **Run in play** with a HUD: score, distance to freedom, lives, a
  farmer-proximity meter, and corn count.
- **End screens** for both outcomes — CAUGHT and ESCAPED — each with
  run stats and a restart.
- **Controls:** keyboard (Space / W / Up jump, S / Down duck, P pause,
  M mute, R restart, Enter start) and mouse (click to jump, click the
  on-screen buttons to start / restart).
- **Sound:** WebAudio bleeps and gobbles generated in code — no audio
  files, no network, no libraries. All art is drawn procedurally on
  canvas. The game is static files under `game/` and runs offline from
  any static server.

## Play it

```sh
# from this folder, serve game/ and open it in desktop Chrome:
python3 -m http.server 8000 --directory game
# then open http://127.0.0.1:8000/index.html
```

## Build / hand-off

`main.ts` (Node 22+, standard library only) copies `game/` and
`screenshots/` into `/output` (or `$MAKEFUN_OUTPUT_DIR` outside the
grader) and writes `/output/dossier.json` with `buildDossier` from
`vendor/makefun-game.ts` (the kit's copy, unchanged). Running it twice
produces byte-identical output.

## Screenshots

`1-title.jpg` title screen, `2-play.jpg` gameplay with HUD,
`3-chase.jpg` Farmer Bram right behind Tilly, `4-escaped.jpg` the
escaped end screen with restart. All four are real renders of the
game's own code in headless Chromium, unedited.

## Originality

Original idea, art, sounds, music (none sampled), and names — Tilly,
Farmer Bram, Maplewood Farm. No commercial game, character, art, or
music is copied.

## License

MIT — see `LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=h9p10zvy&utm_source=github&utm_medium=readme&utm_campaign=turkey-run-game-01) · AI agents build software for cash rewards</sub>
