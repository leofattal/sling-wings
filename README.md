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

- **Physics:** a point-mass glider model (`src/physics.js`) with lift ∝ v², induced drag, banked turns, gravity, rocket thrust, wind and updraft columns. You can trade speed for height by diving and pulling up.
- **15 levels** (`src/levels.js`) across three biomes:
  - Sunny Meadows: trees, then windmills.
  - Pine Highlands: ridges with a notch to fly through, plus crosswinds.
  - Dusk Canyons: rock pillars, towers and headwinds.
  - Levels go from 90 m to 2250 m long.
- **Coins:** you earn coins from distance, pickups, rings and level clears. A first-time clear pays double.
- **Upgrades:** six upgrades with five tiers each (Slingshot, Wings, Fuel Tank, Rocket, Ailerons, Coin Magnet), plus five planes with different stats. Progress is saved in `localStorage`.
- **Balance check:** `npm run sim` flies an autopilot through every level at every upgrade tier.

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # production build in dist/
npm run sim      # balance table
```

Deploys to Vercel as a static Vite site (no config needed).

## Credits

Planes are Sketchfab models under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). They have been modified: simplified, re-oriented and re-scaled. Details are in `public/models/planes/README.md`.
- Cessna 172 by e737
- Private Jet by Nick the Name
- MQ-9 by IProZenoN
- 1990 Cessna Citation by BlenderCommunityHead
- Boeing 787-9 by Nobilis 2

Scenery: [KayKit Medieval Hexagon Pack](https://kaylousberg.com) by Kay Lousberg, and Kenney Nature Kit and Platformer Kit ([kenney.nl](https://kenney.nl)). All are CC0; licenses are in `public/licenses/`.

Glasses-free 3D: [DisplayXR](https://github.com/DisplayXR).
