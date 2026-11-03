shader_type canvas_item;
const float COLS = 120.0;
const float ROWS = 54.0;
float glyph(vec2 p, float id) {
    vec2 q = floor(p * vec2(5.0, 7.0));
    if (id < 0.5) return 0.0;
    if (id < 1.5) return step(2.0, q.x) * step(q.x, 2.0) * step(3.0, q.y) * step(q.y, 3.0);
    if (id < 2.5) return step(1.0, q.x) * step(q.x, 3.0) * step(2.0, q.y) * step(q.y, 4.0);
    if (id < 3.5) return step(1.0, q.x) * step(q.x, 3.0) * step(1.0, q.y) * step(q.y, 5.0);
    if (id < 4.5) return step(0.0, q.x) * step(q.x, 4.0) * step(0.0, q.y) * step(q.y, 6.0);
    if (id < 5.5) return max(step(1.0, q.x) * step(q.x, 3.0), step(1.0, q.y) * step(q.y, 5.0));
    return 1.0;
}
void fragment() {
    vec2 grid = vec2(COLS, ROWS);
    vec2 cell = floor(UV * grid);
    vec2 local = fract(UV * grid);
    vec3 c = texture(SCREEN_TEXTURE, (cell + 0.5) / grid).rgb;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float id = clamp(floor(l * 7.0), 0.0, 6.0);
    COLOR = vec4(c * glyph(local, id) * 1.5, 1.0);
}
