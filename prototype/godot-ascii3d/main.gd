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
var fire_cooldown := 0.0
var player_speed := 5.5

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
	_make_ground()
	player = _make_actor(Color("7fe9c0"), Vector3(0, 1, 0), 0.8)
	for i in range(7):
		var a := float(i) * 0.897
		enemies.append(_make_actor(Color("ff6b72"), Vector3(cos(a) * 4.0, 0.8, sin(a) * 4.0), 0.55))
		enemy_hp.append(3)
		enemy_respawn.append(0.0)

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
	if event is InputEventKey and event.pressed and not event.echo and event.scancode == KEY_SPACE:
		_fire()

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

func _fire() -> void:
	if fire_cooldown > 0.0 or not player:
		return
	fire_cooldown = 0.28
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
	return best

func _respawn_enemy(index: int) -> void:
	var a := float(index) * 0.897 + t * 0.2
	var enemy: Spatial = enemies[index]
	enemy.translation = Vector3(cos(a) * 4.5, 0.8, sin(a) * 4.5)
	enemy.visible = true
	enemy_hp[index] = 3

func _step_projectiles(delta: float) -> void:
	for i in range(projectiles.size() - 1, -1, -1):
		var shot: Dictionary = projectiles[i]
		var node: Spatial = shot["node"]
		shot["life"] -= delta
		node.translation += shot["velocity"] * delta
		var remove: bool = shot["life"] <= 0.0
		for enemy_index in range(enemies.size()):
			var enemy: Spatial = enemies[enemy_index]
			if enemy.visible and node.translation.distance_to(enemy.translation) < 0.7:
				enemy_hp[enemy_index] -= 1
				remove = true
				if enemy_hp[enemy_index] <= 0:
					enemy.visible = false
					enemy_respawn[enemy_index] = 0.45
				break
		if remove:
			node.queue_free()
			projectiles.remove(i)
		else:
			projectiles[i] = shot

func _process(delta: float) -> void:
	t += delta
	fire_cooldown = max(0.0, fire_cooldown - delta)
	player_iframes = max(0.0, player_iframes - delta)
	if player:
		var movement := _move_vector()
		player.translation += movement * player_speed * delta
		player.translation.x = clamp(player.translation.x, -10.0, 10.0)
		player.translation.z = clamp(player.translation.z, -10.0, 10.0)
		player.translation.y = 1.0 + sin(t * 3.0) * 0.08
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
	if camera and player:
		camera.translation = Vector3(player.translation.x, 7.0, player.translation.z + 12.0)
		camera.look_at_from_position(camera.translation, player.translation, Vector3.UP)
	_step_projectiles(delta)
