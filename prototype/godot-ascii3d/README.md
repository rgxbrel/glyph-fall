# Godot ASCII 3D prototype

This isolated prototype tests the ASCII Realms direction without changing the main Glyph Fall client.

- Godot 3.6 scene with 3D terrain, player, enemies and lighting
- ASCII canvas shader post-process
- Arrow keys/WASD move the player (bounded arena)
- Space fires homing animated projectiles at the nearest enemy
- Enemies pursue the player, collide, deal contact damage with brief invulnerability, take three hits, disappear briefly, then respawn
- Camera follows the player while keeping the bounded arena in view
- A three-phase boss has 30 HP, an expanding telegraph ring and a timed area attack

Run with Godot 3.x and `project.godot`.

- HUD shows HP, score, dash cooldown and boss phase. Shift dashes, boss defeat drops a heart and mana pickup, and R restarts the boss.
