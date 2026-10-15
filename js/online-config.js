// Conexión del ranking en línea (Supabase). La "anon key" es pública por diseño: la tabla solo deja leer y agregar puntajes.
window.SL_ONLINE_CONFIG = window.SL_ONLINE_CONFIG || { url: "", key: "", table: "scores" };
