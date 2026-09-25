/**
 * Photo pool for the rotation puzzle. Every image is a real photograph from
 * Wikimedia Commons released under CC0 1.0 (sources in client/public/puzzle/CREDITS.txt),
 * resized to 720x480 and addressed here in 360x240 user-space units. `spots` are
 * centers where the circular cut-out may be placed — picked automatically on the
 * busiest (highest-detail) regions so the fitted angle is unambiguous.
 */
export interface PuzzleScene {
  file: string;
  spots: [number, number][];
}

export const PUZZLE_SCENES: PuzzleScene[] = [
  {
    file: "photo-01-lake-mountain.jpg",
    spots: [
      [282, 54],
      [96, 150],
      [198, 114],
    ],
  },
  {
    file: "photo-02-chateau-dusk.jpg",
    spots: [
      [150, 84],
      [300, 174],
      [72, 180],
    ],
  },
  {
    file: "photo-03-desert-dunes.jpg",
    spots: [
      [144, 168],
      [246, 168],
    ],
  },
  {
    file: "photo-04-forest-path.jpg",
    spots: [
      [186, 54],
      [192, 180],
      [78, 180],
    ],
  },
  {
    file: "photo-05-beach-parasols.jpg",
    spots: [
      [198, 180],
      [282, 90],
      [72, 90],
    ],
  },
  {
    file: "photo-06-winter-barn.jpg",
    spots: [
      [180, 150],
      [78, 150],
    ],
  },
  {
    file: "photo-07-alpine-village.jpg",
    spots: [
      [204, 150],
      [90, 180],
      [282, 84],
    ],
  },
  {
    file: "photo-08-flower-garden.jpg",
    spots: [
      [300, 180],
      [300, 72],
      [198, 66],
    ],
  },
  {
    file: "photo-09-lighthouse.jpg",
    spots: [
      [126, 108],
      [228, 180],
      [54, 180],
    ],
  },
  {
    file: "photo-10-harbor-boats.jpg",
    spots: [
      [174, 108],
      [294, 126],
      [54, 96],
    ],
  },
];
