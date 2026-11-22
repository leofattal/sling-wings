# Sling Wings ✈️

A 3D slingshot-glider upgrade game built with **three.js** and the **DisplayXR** web SDK (`@displayxr/inline3d`).
Pull back the slingshot, launch your plane down a valley, steer through rings and coins, and spend what you earn on upgrades
until you can clear all **15 levels**.

Open it in the DisplayXR Browser on a spatial (light-field) display and the game renders in glasses-free 3D. On any other browser it plays as a normal 3D game.

## Play

- **Launch:** drag back from the plane and let go. Pull down for a steeper launch, sideways to aim. Keyboard: hold `Space` to charge, then release; arrow keys aim.
- **Fly:** `W`/`S` or `↑`/`↓` to climb or dive, `A`/`D` or `←`/`→` to steer, and hold `Space` to boost. On touch screens, drag anywhere to steer and hold 🔥 to boost.
- `R` retries the level and `Esc` ends the flight.

## Game systems

- **Physics:** a point-mass glider model (`src/physics.js`) with lift ∝ v², induced drag, banked turns, gravity, rocket thrust, wind and updraft columns. Landing gear lets the plane bounce off the ground.
- **15 levels plus Endless** (`src/levels.js`), from 150 m to 3.8 km, across three biomes. Each valley is generated in 120 m chunks as you fly. Crossing the finish line doesn't end the flight: you keep flying, and a smooth landing pays a bonus.
- **Things in the valleys:** coins, gems placed high up, fuel cans, star power (double coins and a full tank), rings, hot-air balloons you bounce off, seagull flocks that slow you down, updrafts, ridges with a gap to fly through, and trees, windmills, rock pillars and towers.
- **Earning coins:**
  - distance, plus a bonus every 250 m
  - pickups and rings
  - close calls with obstacles, balloon bounces and gear bounces
  - top speed and max height
  - landings (perfect landings pay most)
  - level clears (first time ×2) and 3 stars per level
  - 24 missions
- **Plane evolution:** 9 upgrades with 8 tiers each. Every upgrade bolts a visible part onto the plane: wing extensions and winglets, a nose cone, rocket engines (1 to 3), fuel pods, tail fins and canards, wheels, a roof magnet and a lucky star. The slingshot upgrades from wood to metal to gold. Buying enough tiers lets you **evolve** the plane through 5 airframes: Skipper → Drifter → Courier → Falcon → Jumbo.
- **Sound:** fully procedural Web Audio:
  - engine hum and wind gusts that follow airspeed
  - rocket roar with crackle
  - a slingshot creak that rises as you pull back
  - chimes that climb in pitch as you chain coins
  - stereo-panned pickups, plus reverb and a compressor
  - generative background music that speeds up as you fly faster
- **Balance check:** `npm run sim` flies an autopilot through every level at every upgrade tier and airframe.

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # production build in dist/
npm run sim      # balance table
```

Deploys to Vercel as a static Vite site (no config needed).

## Credits

- Orbiter (UFO) model: "Ufo" by hat_my_guy, CC0 1.0, via [Poly Pizza](https://poly.pizza/m/NgURFR5T9m). The Comet form reuses the rocket part model.

Planes are Sketchfab models under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). They have been modified: simplified, re-oriented and re-scaled. Details are in `public/models/planes/README.md`.
- Cessna 172 by e737
- Private Jet by Nick the Name
- MQ-9 by IProZenoN
- 1990 Cessna Citation by BlenderCommunityHead
- Boeing 787-9 by Nobilis 2

Items and parts from [Poly Pizza](https://poly.pizza):
- [Hot air balloon](https://poly.pizza/m/7Fej0Jd3_Di) by Poly by Google (CC BY 3.0). Re-tinted in game.
- [Flying seagull](https://poly.pizza/m/6Tpj_vcWP3f) by Poly by Google (CC BY 3.0)
- [Magnet](https://poly.pizza/m/dD2RIIea6WR) by Poly by Google (CC BY 3.0)
- [Rocketship](https://poly.pizza/m/ah8WSBbizA6) by jeremy (CC BY 3.0)
- [Missile](https://poly.pizza/m/1Xid2Qhqn2s) by Jarlan Perez (CC BY 3.0), used as fuel pods
- [Gas Can](https://poly.pizza/m/eS1OXGo51c) by Quaternius (CC0)

Scenery and pickups:
- [KayKit Medieval Hexagon Pack](https://kaylousberg.com) by Kay Lousberg
- Kenney Nature Kit, Platformer Kit (coins, gem, star) and Car Kit (wheels), from [kenney.nl](https://kenney.nl)

These are all CC0; licenses are in `public/licenses/`.

Glasses-free 3D: [DisplayXR](https://github.com/DisplayXR).

## Garage, cards and runway

- **Evolution garage:** buy planes and merge two of the same form to evolve them: Skipper → Drifter → Courier → Falcon → Jumbo → Comet → Orbiter. Making a form for the first time unlocks it and plays the evolution scene.
- **Idle income:** every plane in the garage earns coins per minute, including while the game is closed (up to 2 hours).
- **Reward cards:** after every flight of 20 m or more, pick 1 of 3: a free upgrade tier (sometimes; capped by levels cleared), a coin pouch, or a lucky flight (next flight pays ×1.25).
- **Runway launch:** toggle on the aim screen. Hold to accelerate down the runway and let go on the green zone for a perfect takeoff with extra speed; the plane leaves the deck level.
