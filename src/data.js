export const ITEMS = {
  herb: { name: 'HERB', kind: 'consumable', heal: 18, value: 4 },
  mana: { name: 'MANA ROOT', kind: 'consumable', mana: 22, value: 6 },
  dagger: { name: 'DAGGER', kind: 'weapon', dmg: 3, value: 20 },
  blade: { name: 'GLYPH BLADE', kind: 'weapon', dmg: 7, value: 60 },
  coat: { name: 'COAT', kind: 'armor', def: 2, value: 25 },
  ward: { name: 'WARD COAT', kind: 'armor', def: 5, value: 70 },
};

export const SKILLS = {
  spark: { name: 'SPARK', mp: 8, cd: 0.45, speed: 420, life: 1.1, r: 6, kind: 'projectile' },
  heal: { name: 'HEAL', mp: 10, cd: 2.5, amount: 24, kind: 'heal' },
  frost: { name: 'FROST NOVA', mp: 14, cd: 3.2, amount: 18, radius: 96, kind: 'nova' },
};

export const DIALOGUES = {
  elder: [
    { q: 'The stack is corrupt.', a: 'Glyph beasts chew the render loop. Thin five of them and the tower holds.' },
    { q: 'What are you?', a: 'I kept this valley compiling when the servers went dark.' },
    { q: 'Goodbye.', a: 'Go. Mind the water; it eats sprites.' },
  ],
  trader: [
    { q: 'Sell me a blade.', a: 'GLYPH BLADE, 60 marks. Bring me herbs and I will make something.' },
    { q: 'Potions?', a: 'HERB mends 18. MANA ROOT fills the blue. Pick them yourself, they are free.' },
  ],
};
