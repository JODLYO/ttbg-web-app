export const STATIC_BASE       = '/static/aiedit/images';
export const MULTI_SELECT_BASE = `${STATIC_BASE}/multi_select_imgs`;
export const DRAW_STYLE_BASE   = `${STATIC_BASE}/draw_style_imgs`;
export const DRAW_IMG_BASE     = `${STATIC_BASE}/draw_imgs`;
export const HOME_IMG_BASE     = `${STATIC_BASE}/home_imgs`;

export const STYLE_NAMES = [
  'Robert_Delaunay,_1906,_Portrait.jpg',
  'candy.jpg',
  'composition_vii.jpg',
  'escher_sphere.jpg',
  'feathers.jpg',
  'frida_kahlo.jpg',
  'la_muse.jpg',
  'mosaic.jpg',
  'mosaic_ducks_massimo.jpg',
  'pencil.jpg',
  'picasso_selfport1907.jpg',
  'rain_princess.jpg',
  'seated-nude.jpg',
  'shipwreck.jpg',
  'starry_night.jpg',
  'stars2.jpg',
  'strip.jpg',
  'the_scream.jpg',
  'udnie.jpg',
  'wave.jpg',
  'woman-with-hat-matisse.jpg',
];

export const STYLE_ALT: Record<string, string> = {
  'Robert_Delaunay,_1906,_Portrait.jpg': 'Robert Delaunay',
  'candy.jpg': 'Candy',
  'composition_vii.jpg': 'Composition VII',
  'escher_sphere.jpg': 'Escher Sphere',
  'feathers.jpg': 'Feathers',
  'frida_kahlo.jpg': 'Frida Kahlo',
  'la_muse.jpg': 'La Muse',
  'mosaic.jpg': 'Mosaic',
  'mosaic_ducks_massimo.jpg': 'Mosaic Ducks',
  'pencil.jpg': 'Pencil',
  'picasso_selfport1907.jpg': 'Picasso',
  'rain_princess.jpg': 'Rain Princess',
  'seated-nude.jpg': 'Seated Nude',
  'shipwreck.jpg': 'Shipwreck',
  'starry_night.jpg': 'Starry Night',
  'stars2.jpg': 'Stars',
  'strip.jpg': 'Strip',
  'the_scream.jpg': 'The Scream',
  'udnie.jpg': 'Udnie',
  'wave.jpg': 'Wave',
  'woman-with-hat-matisse.jpg': 'Woman with Hat',
};

export const CANVAS_SIZE  = 512;
export const FPS          = 15;
export const FRAME_MS     = 1000 / FPS;
export const MAX_DURATION = 10;
