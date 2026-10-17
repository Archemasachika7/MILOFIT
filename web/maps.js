// Original map layouts. Coordinates are in world pixels (canvas is 960x540).
// Each solid rectangle: {x, y, w, h}. Spawns: array of {x, y}.
const MAPS = {
  "Sandstone Pit": {
    width: 960, height: 540,
    platforms: [
      { x: 0, y: 510, w: 960, h: 30 },
      { x: 120, y: 420, w: 180, h: 18 },
      { x: 660, y: 420, w: 180, h: 18 },
      { x: 380, y: 340, w: 200, h: 18 },
      { x: 40, y: 260, w: 120, h: 18 },
      { x: 800, y: 260, w: 120, h: 18 },
      { x: 430, y: 180, w: 100, h: 18 }
    ],
    spawns: [{ x: 80, y: 470 }, { x: 860, y: 470 }, { x: 470, y: 130 }, { x: 440, y: 300 }]
  },
  "Frozen Tower": {
    width: 960, height: 540,
    platforms: [
      { x: 0, y: 510, w: 960, h: 30 },
      { x: 0, y: 380, w: 260, h: 18 },
      { x: 700, y: 380, w: 260, h: 18 },
      { x: 330, y: 300, w: 300, h: 18 },
      { x: 430, y: 220, w: 100, h: 18 },
      { x: 150, y: 160, w: 80, h: 18 },
      { x: 730, y: 160, w: 80, h: 18 }
    ],
    spawns: [{ x: 60, y: 330 }, { x: 880, y: 330 }, { x: 470, y: 170 }, { x: 180, y: 110 }]
  },
  "Jungle Ruins": {
    width: 960, height: 540,
    platforms: [
      { x: 0, y: 510, w: 300, h: 30 },
      { x: 660, y: 510, w: 300, h: 30 },
      { x: 300, y: 470, w: 360, h: 18 },
      { x: 60, y: 360, w: 140, h: 18 },
      { x: 760, y: 360, w: 140, h: 18 },
      { x: 360, y: 260, w: 240, h: 18 },
      { x: 20, y: 200, w: 120, h: 18 },
      { x: 820, y: 200, w: 120, h: 18 }
    ],
    spawns: [{ x: 100, y: 310 }, { x: 860, y: 310 }, { x: 480, y: 210 }, { x: 60, y: 150 }]
  }
};
