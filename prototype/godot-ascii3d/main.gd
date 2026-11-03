extends Spatial

var t := 0.0
var player: Spatial
var camera: Camera
var player_hp := 5
var player_iframes := 0.0
var enemies := []
var enemy_hp := []
var enemy_respawn := []
var projectiles := []
var effects := []
var player_attack := 0.0
var boss_flash := 0.0
var enemy_flash := []
var fire_cooldown := 0.0
var player_speed := 5.5
var dash_cooldown := 0.0
var dash_time := 0.0
var hud: Label
var score := 0
var pickups := []
var boss_defeated := false
var boss: Spatial
var boss_ring: Spatial
var boss_hp := 30
var boss_phase := 1
var boss_attack := 2.0
var boss_telegraph := 0.0
var camera_shake := 0.0
var kills := 0
var wave := 1
var paused_game := false
var last_boss_phase := 1

func _ready() -> void:
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color("05070c")
	e.ambient_light_color = Color("8ac7a8")
	e.ambient_light_energy = 0.7
	env.environment = e
	add_child(env)
	camera = Camera.new()
	camera.translation = Vector3(0, 7, 12)
	camera.look_at_from_position(camera.translation, Vector3(0, 0, 0), Vector3.UP)
	add_child(camera)
	_make_light()
	_make_hud()
	_make_ground()
	player = _make_actor(Color("7fe9c0"), Vector3(0, 1, 0), 0.8)
	for i in range(7):
		var a := float(i) * 0.897
		enemies.append(_make_actor(Color("ff6b72"), Vector3(cos(a) * 4.0, 0.8, sin(a) * 4.0), 0.55))
		enemy_hp.append(3)
		enemy_respawn.append(0.0)
		enemy_flash.append(0.0)
	boss = _make_actor(Color("c66bff"), Vector3(0, 0.95, -6), 1.15)
	boss.scale = Vector3(1.4, 1.4, 1.4)
	boss_ring = _make_actor(Color("ff527d"), Vector3(0, 0.08, -6), 1.0)
	boss_ring.scale = Vector3(3.2, 0.08, 3.2)

func _make_hud() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 20
	hud = Label.new()
	hud.rect_position = Vector2(18, 14)
	hud.add_color_override("font_color", Color("b8ffe0"))
	hud.add_color_override("font_shadow_color", Color("05070c"))
	hud.add_constant_override("shadow_offset_x", 2)
	hud.add_constant_override("shadow_offset_y", 2)
	hud.text = "GLYPH FALL // loading"
	layer.add_child(hud)
	add_child(layer)

func _make_light() -> void:
	var light := OmniLight.new()
	light.light_color = Color("b8ffe0")
	light.light_energy = 3.0
	light.omni_range = 25.0
	light.translation = Vector3(0, 7, 2)
	add_child(light)

func _make_ground() -> void:
	var mesh := MeshInstance.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(24, 24)
	mesh.mesh = plane
	var mat := SpatialMaterial.new()
	mat.albedo_color = Color("183524")
	mat.roughness = 1.0
	mesh.material_override = mat
	add_child(mesh)
	for x in range(-10, 11, 2):
		for z in range(-10, 11, 2):
			if (x + z) % 4 == 0:
				var rock := _make_actor(Color("52656a"), Vector3(x, 0.3, z), 0.18)
				rock.scale.y = 0.5

func _make_actor(color: Color, pos: Vector3, radius: float) -> Spatial:
	var node := MeshInstance.new()
	var mesh := CapsuleMesh.new()
	mesh.radius = radius
	node.mesh = mesh
	var mat := SpatialMaterial.new()
	mat.albedo_color = color
	mat.emission_enabled = true
	mat.emission = color.darkened(0.35)
	mat.emission_energy = 0.4
	node.material_override = mat
	node.translation = pos
	add_child(node)
	return node

func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.scancode == KEY_SPACE:
			_fire()
		elif event.scancode == KEY_SHIFT:
			_dash()
		elif event.scancode == KEY_R and boss_defeated:
			_reset_boss()
		elif event.scancode == KEY_P:
			paused_game = not paused_game

func _move_vector() -> Vector3:
	var v := Vector3()
	if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
		v.x -= 1.0
	if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
		v.x += 1.0
	if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
		v.z -= 1.0
	if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
		v.z += 1.0
	return v.normalized() if v.length_squared() > 0.0 else v

func _spawn_effect(pos: Vector3, color: Color, size: float, life: float) -> void:
	var fx := _make_actor(color, pos, size)
	effects.append({"node": fx, "life": life, "max_life": life, "start": size})

func _fire() -> void:
	if fire_cooldown > 0.0 or not player:
		return
	fire_cooldown = 0.28
	player_attack = 0.16
	_spawn_effect(player.translation + Vector3(0, 0.1, 0), Color("fff0a3"), 0.12, 0.16)
	var target := _nearest_enemy()
	var direction := Vector3(0, 0, -1)
	if target:
		direction = (target.translation - player.translation).normalized()
	var bolt := _make_actor(Color("ffb347"), player.translation + direction * 0.9, 0.16)
	projectiles.append({"node": bolt, "velocity": direction * 11.0, "life": 1.8})

func _nearest_enemy() -> Spatial:
	var best: Spatial = null
	var best_dist := 9999.0
	for enemy in enemies:
		if is_instance_valid(enemy) and enemy.visible:
			var d := player.translation.distance_squared_to(enemy.translation)
			if d < best_dist:
				best_dist = d
				best = enemy
	if boss and boss.visible:
		var boss_dist := player.translation.distance_squared_to(boss.translation)
		if boss_dist < best_dist:
			best = boss
	return best

func _respawn_enemy(index: int) -> void:
	var a := float(index) * 0.897 + t * 0.2
	var enemy: Spatial = enemies[index]
	enemy.translation = Vector3(cos(a) * 4.5, 0.8, sin(a) * 4.5)
	enemy.visible = true
	enemy_hp[index] = 3

func _spawn_boss_ring() -> void:
	if not boss or not boss.visible:
		return
	var count := 8 + boss_phase * 4
	for i in range(count):
		var angle := (float(i) * 6.2831853 / float(count)) + atan2(player.translation.z - boss.translation.z, player.translation.x - boss.translation.x)
		var direction := Vector3(cos(angle), 0, sin(angle)).normalized()
		var bolt := _make_actor(Color("ff527d"), boss.translation + direction * 1.2 + Vector3(0, 0.25, 0), 0.12)
		projectiles.append({"node": bolt, "velocity": direction * (3.4 + boss_phase * 0.45), "life": 3.0, "hostile": true})
	_spawn_effect(boss.translation + Vector3(0, 0.25, 0), Color("ff527d"), 0.28, 0.35)

func _dash() -> void:
	if dash_cooldown > 0.0 or not player:
		return
	var direction := _move_vector()
	if direction.length_squared() <= 0.0:
		direction = Vector3(0, 0, -1)
	player.translation += direction * 2.4
	dash_cooldown = 1.4
	dash_time = 0.18
	camera_shake = max(camera_shake, 0.12)
	_spawn_effect(player.translation, Color("7fe9c0"), 0.18, 0.28)

func _spawn_pickup(pos: Vector3, kind: String) -> void:
	var color := Color("70b7ff") if kind == "mana" else Color("ffd166")
	var node := _make_actor(color, Vector3(pos.x, 0.5, pos.z), 0.22)
	pickups.append({"node": node, "kind": kind})

func _reset_boss() -> void:
	boss_hp = 30
	boss_phase = 1
	boss_attack = 2.0
	boss_telegraph = 0.0
	boss_defeated = false
	paused_game = false
	for shot in projectiles:
		var old_node: Spatial = shot["node"]
		old_node.queue_free()
	projectiles.clear()
	boss.visible = true
	boss_ring.visible = false
	boss.translation = Vector3(0, 0.95, -6)

func _step_effects(delta: float) -> void:
	for i in range(effects.size() - 1, -1, -1):
		var fx: Dictionary = effects[i]
		var node: Spatial = fx["node"]
		fx["life"] -= delta
		var ratio: float = max(0.0, fx["life"] / fx["max_life"])
		node.scale = Vector3.ONE * (1.0 + (1.0 - ratio) * 2.8)
		node.translation.y += delta * 0.8
		if fx["life"] <= 0.0:
			node.queue_free()
			effects.remove(i)
		else:
			effects[i] = fx

func _step_pickups() -> void:
	for i in range(pickups.size() - 1, -1, -1):
		var item: Dictionary = pickups[i]
		var node: Spatial = item["node"]
		node.translation.y = 0.5 + sin(t * 3.0 + i) * 0.12
		node.scale = Vector3.ONE * (1.0 + sin(t * 5.0 + i) * 0.12)
		if node.translation.distance_to(player.translation) < 1.1:
			if item["kind"] == "heart":
				player_hp = min(5, player_hp + 2)
			else:
				dash_cooldown = 0.0
				score += 25
			node.queue_free()
			pickups.remove(i)

func _step_projectiles(delta: float) -> void:
	for i in range(projectiles.size() - 1, -1, -1):
		var shot: Dictionary = projectiles[i]
		var node: Spatial = shot["node"]
		shot["life"] -= delta
		node.translation += shot["velocity"] * delta
		var remove: bool = shot["life"] <= 0.0
		if shot.get("hostile", false):
			if node.translation.distance_to(player.translation) < 0.75 and player_iframes <= 0.0:
				player_hp -= 1
				player_iframes = 0.8
				camera_shake = max(camera_shake, 0.22)
				_spawn_effect(player.translation, Color("ff527d"), 0.2, 0.3)
				if player_hp <= 0:
					player_hp = 5
					player.translation = Vector3(0, 1, 0)
				remove = true
			if remove:
				node.queue_free()
				projectiles.remove(i)
			else:
				projectiles[i] = shot
			continue
		for enemy_index in range(enemies.size()):
			var enemy: Spatial = enemies[enemy_index]
			if enemy.visible and node.translation.distance_to(enemy.translation) < 0.7:
				enemy_hp[enemy_index] -= 1
				kills += 1 if enemy_hp[enemy_index] <= 0 else 0
				camera_shake = max(camera_shake, 0.08)
				enemy_flash[enemy_index] = 0.14
				_spawn_effect(enemy.translation + Vector3(0, 0.5, 0), Color("fff0a3"), 0.16, 0.22)
				remove = true
				if enemy_hp[enemy_index] <= 0:
					_spawn_effect(enemy.translation, Color("ff6b72"), 0.28, 0.42)
					enemy.visible = false
					enemy.scale = Vector3.ONE * 0.1
					enemy_respawn[enemy_index] = 0.45
				break
		if not remove and boss and boss.visible and node.translation.distance_to(boss.translation) < 1.35:
			boss_hp -= 1
			boss_flash = 0.18
			_spawn_effect(boss.translation + Vector3(0, 0.7, 0), Color("f6b6ff"), 0.22, 0.28)
			score += 5
			remove = true
			camera_shake = max(camera_shake, 0.1)
			if boss_hp <= 0:
				_spawn_effect(boss.translation, Color("c66bff"), 0.45, 0.75)
				boss.visible = false
				boss_ring.visible = false
				boss_defeated = true
				score += 500
				_spawn_pickup(boss.translation, "heart")
				_spawn_pickup(boss.translation + Vector3(1, 0, 0), "mana")
		if remove:
			node.queue_free()
			projectiles.remove(i)
		else:
			projectiles[i] = shot


func _step_boss(delta: float) -> void:
	if not boss or not boss.visible:
		return
	boss_attack -= delta
	if boss_attack <= 0.0 and boss_telegraph <= 0.0:
		boss_telegraph = 1.0
		boss_attack = max(1.8, 3.2 - boss_phase * 0.45)
	if boss_telegraph > 0.0:
		boss_telegraph -= delta
		boss_ring.visible = true
		boss_ring.translation = Vector3(boss.translation.x, 0.08, boss.translation.z)
		boss_ring.scale = Vector3.ONE * (2.1 + (1.0 - boss_telegraph) * 1.4) * (1.0 + sin(t * 18.0) * 0.08)
		if boss_telegraph <= 0.0:
			_spawn_boss_ring()
			camera_shake = max(camera_shake, 0.16)
		if boss_telegraph <= 0.0 and player_iframes <= 0.0 and boss.translation.distance_to(player.translation) < 3.5:
			player_hp -= 2
			player_iframes = 0.9
			if player_hp <= 0:
				player_hp = 5
				player.translation = Vector3(0, 1, 0)
	else:
		boss_ring.visible = false
	var to_player := player.translation - boss.translation
	to_player.y = 0.0
	if to_player.length_squared() > 5.0:
		boss.translation += to_player.normalized() * (0.45 + boss_phase * 0.18) * delta
	boss.translation.y = 0.95 + sin(t * 2.0) * 0.12
	boss_phase = 1 if boss_hp > 20 else (2 if boss_hp > 10 else 3)
	if boss_phase != last_boss_phase:
		last_boss_phase = boss_phase
		_spawn_effect(boss.translation, Color("f6b6ff"), 0.5, 0.6)
		camera_shake = max(camera_shake, 0.18)
	boss.scale = Vector3.ONE * (1.2 + boss_phase * 0.12) * (1.0 + boss_flash * 0.9)
	boss_flash = max(0.0, boss_flash - delta)

func _process(delta: float) -> void:
	if paused_game:
		if hud:
			hud.text = "GLYPH FALL  //  PAUSED\nPress P to resume"
		return
	t += delta
	fire_cooldown = max(0.0, fire_cooldown - delta)
	dash_cooldown = max(0.0, dash_cooldown - delta)
	dash_time = max(0.0, dash_time - delta)
	player_attack = max(0.0, player_attack - delta)
	player_iframes = max(0.0, player_iframes - delta)
	camera_shake = max(0.0, camera_shake - delta)
	if player:
		var movement := _move_vector()
		player.translation += movement * player_speed * delta
		player.translation.x = clamp(player.translation.x, -10.0, 10.0)
		player.translation.z = clamp(player.translation.z, -10.0, 10.0)
		player.translation.y = 1.0 + sin(t * 3.0) * 0.08
		player.scale = Vector3.ONE * (1.0 + player_attack * 1.8)
	for i in range(enemies.size()):
		var enemy: Spatial = enemies[i]
		if not enemy.visible:
			enemy_respawn[i] -= delta
			if enemy_respawn[i] <= 0.0:
				_respawn_enemy(i)
			continue
		var direction := (player.translation - enemy.translation)
		direction.y = 0.0
		if direction.length_squared() > 0.4:
			enemy.translation += direction.normalized() * (1.2 + i * 0.05) * delta
		enemy.translation.y = 0.8 + sin(t * 2.0 + i) * 0.12
		enemy_flash[i] = max(0.0, enemy_flash[i] - delta)
		enemy.scale = Vector3.ONE * (1.0 + enemy_flash[i] * 2.2)
		var contact := enemy.translation.distance_to(player.translation)
		if contact < 1.15:
			var push := (enemy.translation - player.translation)
			push.y = 0.0
			if push.length_squared() > 0.001:
				enemy.translation += push.normalized() * 0.08
			if player_iframes <= 0.0:
				player_hp -= 1
				player_iframes = 0.7
				if player_hp <= 0:
					player_hp = 5
					player.translation = Vector3(0, 1, 0)
	_step_boss(delta)
	_step_pickups()
	if hud:
		var boss_line := "DEFEATED // press R to reset" if boss_defeated else "BOSS %02d/30 // PHASE %d" % [boss_hp, boss_phase]
		hud.text = "GLYPH FALL  //  HP %d/5  //  SCORE %04d  //  DASH %s\n%s\nKILLS %02d  WAVE %02d\nWASD move  SHIFT dash  SPACE fire  P pause  R restart boss" % [player_hp, score, ("READY" if dash_cooldown <= 0.0 else "%.1f" % dash_cooldown), boss_line, kills, wave]
	if camera and player:
		var shake := Vector3(sin(t * 71.0), 0, cos(t * 83.0)) * camera_shake
		camera.translation = Vector3(player.translation.x, 7.0, player.translation.z + 12.0) + shake
		camera.look_at_from_position(camera.translation, player.translation, Vector3.UP)
	_step_effects(delta)
	_step_projectiles(delta)
