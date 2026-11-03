extends Spatial

var t := 0.0
var player: Spatial
var enemies := []

func _ready() -> void:
    var env := WorldEnvironment.new()
    var e := Environment.new()
    e.background_mode = Environment.BG_COLOR
    e.background_color = Color("05070c")
    e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
    e.ambient_light_color = Color("8ac7a8")
    e.ambient_light_energy = 0.7
    env.environment = e
    add_child(env)
    var camera := Camera.new()
    camera.translation = Vector3(0, 7, 12)
    camera.look_at_from_position(camera.translation, Vector3(0, 0, 0), Vector3.UP)
    add_child(camera)
    _make_light()
    _make_ground()
    player = _make_actor(Color("7fe9c0"), Vector3(0, 1, 0), 0.8)
    for i in range(7):
        var a := float(i) * 0.897
        enemies.append(_make_actor(Color("ff6b72"), Vector3(cos(a) * 4.0, 0.8, sin(a) * 4.0), 0.55))

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
    mesh.height = radius * 2.8
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

func _process(delta: float) -> void:
    t += delta
    if player:
        player.translation.y = 1.0 + sin(t * 3.0) * 0.08
    for i in range(enemies.size()):
        var e: Spatial = enemies[i]
        var a := float(i) * 0.897 + t * (0.18 + i * 0.01)
        e.translation = Vector3(cos(a) * (4.0 + sin(t + i) * 0.5), 0.8 + sin(t * 2.0 + i) * 0.12, sin(a) * (4.0 + sin(t + i) * 0.5))
