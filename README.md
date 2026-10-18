# Swing Lab

Mide la velocidad, el tempo y la ruta de tu swing de golf con el celular (sensores o cámara, de frente o desde atrás) y mira el tiro en un simulador 3D: driving range y campos completos.

Con la cámara, la app usa obturador rápido donde el navegador lo permite (menos imagen corrida y más cuadros por segundo) y puede oír el impacto con el micrófono para marcarlo al milisegundo.

Campos disponibles, inspirados en hoyos reales (distancias, forma y trampas en su lugar):

- **Country Club de Bogotá · Los Fundadores** — 18 hoyos (a 2.600 m: la bola vuela más)
- **TPC Cartagena at Karibana** — 18 hoyos, junto al mar Caribe
- **Old Course · St Andrews** — hoyos 1, 17 y 18
- **Pebble Beach** — hoyos 7, 8 y 18
- **TPC Sawgrass · Stadium** — hoyos 16, 17 y 18
- **Swing Lab** — el campo ficticio original

En los campos colombianos se puede jugar ida (1-9), vuelta (10-18) o los 18. Los hoyos sin plano público están aproximados a partir de la tarjeta (par y distancia) y de descripciones publicadas.

Los nombres de los campos se usan solo como referencia; la app no está afiliada a ellos.

## Para bajar golpes

- **Matriz de wedges** (sistema del reloj): carry de cada wedge con swings de 7:30, 9:00, 10:30 y completo, con entrenamiento guiado.
- **Strokes Gained** por categoría (salida, al green, alrededor del green, putts) contra un hándicap 15 o el PGA Tour, más calles, greens en regulación, up & down y penalidades.
- **Estrategia según tu dispersión**: la elipse de tus tiros sobre el hoyo y el punto de apuntar con menos golpes esperados.

## Ranking en línea

El ranking usa una tabla de [Supabase](https://supabase.com) (plan gratuito):

1. Crea un proyecto en Supabase.
2. En **SQL Editor**, pega y ejecuta `supabase.sql`.
3. En **Project Settings → API**, copia la *Project URL* y la *anon public key* en `js/online-config.js`.

La anon key es pública por diseño: la tabla solo permite leer y agregar puntajes dentro de rangos razonables. Sin configurar, el ranking funciona solo en el teléfono y los puntajes quedan en cola para enviarse después.

Ábrela en el celular desde la página publicada y agrégala a la pantalla de inicio.
