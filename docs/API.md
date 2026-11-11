# SDReservas API: guía de uso

Guía rápida para quien consume la API. Describe qué ruta usar, qué enviar y qué esperar.

- **URL base (producción):** `https://sdreservas-api-1.onrender.com/api/v1`
- **URL base (local):** `http://localhost:3000/api/v1`
- **Formato:** JSON en peticiones y respuestas (`Content-Type: application/json`).

## Contenido

1. [Autenticación](#1-autenticación)
2. [Roles](#2-roles)
3. [Errores](#3-errores)
4. [Restaurantes](#4-restaurantes)
5. [Personal](#5-personal)
6. [Pisos, áreas y horarios](#6-pisos-áreas-y-horarios)
7. [Mesas](#7-mesas)
8. [Modalidades de reserva](#8-modalidades-de-reserva)
9. [Disponibilidad](#9-disponibilidad)
10. [Reservas del cliente](#10-reservas-del-cliente)
11. [Reservas del restaurante](#11-reservas-del-restaurante)
12. [Ciclo de vida de una reserva](#12-ciclo-de-vida-de-una-reserva)
13. [Reputación](#13-reputación)
14. [Lo que aún no está disponible](#14-lo-que-aún-no-está-disponible)

---

## 1. Autenticación

Todas las rutas, salvo `/health`, `/auth/register` y `/auth/login`, exigen el header:

```
Authorization: Bearer <token>
```

El token dura 8 horas. Después hay que iniciar sesión de nuevo.

### `GET /health`

Sin autenticación. Verifica que la API y la base de datos responden.

```json
{ "status": "ok", "db": "connected", "time": "2026-11-11T01:48:08.076Z" }
```

### `POST /auth/register`

Crea una cuenta de **cliente**. El rol no se puede elegir.

| Campo | Tipo | Reglas |
|---|---|---|
| `nombre` | string | 2 a 100 caracteres |
| `email` | string | Correo válido. Único en toda la plataforma |
| `password` | string | 8 a 128 caracteres |

Respuesta `201`:

```json
{
  "token": "eyJ...",
  "user": { "id": "uuid", "email": "ana@test.com", "nombre": "Ana", "rol": "CLIENTE" }
}
```

Si el correo ya existe responde `409`.

### `POST /auth/login`

Cuerpo: `{ "email": "...", "password": "..." }`. Responde `200` con el mismo formato que el registro, o `401` si los datos son incorrectos o la cuenta está desactivada.

### `GET /auth/me`

Devuelve el usuario del token: `{ "user": { "id", "rol", "email", "nombre" } }`.

---

## 2. Roles

| Rol | Cómo se crea | Qué puede hacer |
|---|---|---|
| `CLIENTE` | `POST /auth/register` | Reservar, ver y cancelar sus reservas, ver su reputación |
| `ADMIN` | Script de seed (no hay ruta pública) | Todo sobre **sus propios** restaurantes |
| `RECEPCIONISTA` | El admin lo da de alta | Operar reservas y estados de mesa del restaurante asignado |
| `MESERO` | El admin lo da de alta | Ver estructura y mesas. No gestiona reservas ni cambia estados de mesa |

---

## 3. Errores

Todos los errores tienen esta forma:

```json
{ "error": { "code": "CONFLICT", "message": "Texto legible", "details": [] } }
```

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `BAD_JSON` | JSON mal formado |
| 401 | `UNAUTHORIZED` | Falta el token, es inválido o la cuenta está desactivada |
| 403 | `FORBIDDEN` | El rol no tiene permiso para esa ruta o recurso |
| 403 | `REPUTATION_RESTRICTED` | La reputación no permite reservar con modalidades gratuitas |
| 404 | `NOT_FOUND` | No existe, o no pertenece al usuario |
| 409 | `CONFLICT` | Choca con el estado actual (duplicado, límite de mesas, etc.) |
| 409 | `LIMIT_PLATFORM` / `LIMIT_RESTAURANT` | Se alcanzó el máximo de reservas activas |
| 409 | `NO_TABLE_AVAILABLE` | No hay mesa libre para esa solicitud |
| 409 | `TABLE_TAKEN` | La mesa ya está reservada en ese horario |
| 409 | `TABLE_OUT_OF_SERVICE` | La mesa está fuera de servicio |
| 409 | `TABLE_OCCUPIED` | La mesa sigue ocupada por otra reserva |
| 409 | `CANCELLATION_WINDOW_CLOSED` | Faltan menos de 2 horas para la reserva |
| 409 | `PAID_CANCELLATION_UNAVAILABLE` | La cancelación de reservas pagadas aún no existe |
| 422 | `UNPROCESSABLE` | Los datos son válidos pero la regla de negocio no lo permite |
| 422 | `VALIDATION_ERROR` | Un campo no cumple el formato. `details` indica cuál |
| 500 | `INTERNAL` | Error del servidor |

Ejemplo de `VALIDATION_ERROR`:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Datos inválidos",
    "details": [{ "campo": "mesaIds", "mensaje": "Hay mesas repetidas" }]
  }
}
```

**Convenciones generales**

- Los identificadores son UUID.
- Las fechas y horas de las respuestas vienen en UTC (ISO 8601). Las que se envían (`fecha`, `hora`) se interpretan en la **zona horaria del restaurante**.
- Las rutas con `:id` o `:tableId` reciben un UUID. Si no lo es, responden `422`.

---

## 4. Restaurantes

### `POST /restaurants` (ADMIN)

| Campo | Tipo | Reglas |
|---|---|---|
| `nombre` | string | 2 a 120 |
| `tipoCocina` | string | 2 a 80 |
| `ubicacion` | string | 2 a 200 |
| `rfc` | string | Solo se valida el formato (ej. `XAXX010101000`). No se consulta al SAT |
| `limiteMesas` | number | Entero de 1 a 500 |
| `zonaHoraria` | string | Opcional. Por defecto `America/Mexico_City` |

Responde `201` con `{ "restaurante": { ... } }`.

### `GET /restaurants`

Lista según el rol: el admin ve los suyos, el cliente los activos, el personal los que tiene asignados. `rfc` y `limiteMesas` solo aparecen para el admin.

### `GET /restaurants/:id`

Detalle con horarios, pisos, áreas y mesas anidados. Los horarios en esta ruta vienen como minutos desde medianoche (`aperturaMin`, `cierreMin`). Para el formato `HH:MM` usa `GET /restaurants/:id/hours`.

### `PATCH /restaurants/:id` (ADMIN dueño)

Campos opcionales: `nombre`, `tipoCocina`, `ubicacion`, `activo`. Debe enviarse al menos uno. El límite de mesas **no se puede editar** por ahora.

---

## 5. Personal

Solo el ADMIN dueño del restaurante.

### `POST /restaurants/:id/employees`

| Campo | Tipo | Reglas |
|---|---|---|
| `nombre` | string | 2 a 100 |
| `email` | string | Único en la plataforma |
| `password` | string | 8 a 128. El admin define la contraseña inicial |
| `rol` | string | `RECEPCIONISTA` o `MESERO` |

Responde `201` con `{ "empleado": { id, email, nombre, rol, activo } }`.

### `GET /restaurants/:id/employees`

Lista `{ "empleados": [...] }`.

### `PATCH /employees/:id`

Campos opcionales: `activo` (boolean) y `rol` (`RECEPCIONISTA` o `MESERO`). Un empleado desactivado pierde el acceso de inmediato.

---

## 6. Pisos, áreas y horarios

Crear y borrar: solo ADMIN dueño. Consultar: el admin y el personal asignado.

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /restaurants/:id/floors` | `{ "nombre": "Planta baja", "orden": 0 }` (`orden` opcional) | `201 { piso }` |
| `GET /restaurants/:id/floors` | | `{ pisos }` |
| `DELETE /floors/:floorId` | | `204`. Responde `409` si el piso tiene mesas |
| `POST /restaurants/:id/areas` | `{ "pisoId": "uuid", "nombre": "Terraza" }` | `201 { area }` |
| `GET /restaurants/:id/areas` | | `{ areas }` |
| `DELETE /areas/:areaId` | | `204`. Responde `409` si el área tiene mesas |

Los nombres de piso son únicos por restaurante y los de área son únicos por piso (`409` si se repiten).

### `GET /restaurants/:id/hours`

Cualquier usuario autenticado. Devuelve la zona horaria y el horario:

```json
{
  "zonaHoraria": "America/Mexico_City",
  "horarios": [{ "diaSemana": 1, "apertura": "09:00", "cierre": "22:00" }]
}
```

`diaSemana`: `0` = domingo, `1` = lunes, ... `6` = sábado.

### `PUT /restaurants/:id/hours` (ADMIN dueño)

**Reemplaza el horario completo.** Los días que no se envíen quedan cerrados.

```json
{
  "horarios": [
    { "diaSemana": 1, "apertura": "09:00", "cierre": "22:00" },
    { "diaSemana": 2, "apertura": "09:00", "cierre": "22:00" }
  ]
}
```

Reglas: formato `HH:MM` (el cierre puede ser `24:00`), un intervalo por día, y el cierre debe ser posterior a la apertura. Cambiar el horario no cancela reservas ya confirmadas.

---

## 7. Mesas

### `POST /restaurants/:id/tables` (ADMIN dueño)

| Campo | Tipo | Reglas |
|---|---|---|
| `areaId` | uuid | Debe pertenecer al restaurante |
| `etiqueta` | string | Única en el restaurante (ej. `M1`) |
| `capacidad` | number | Entero de 1 a 100 |
| `forma` | string | Opcional. Por defecto `cuadrada` |

Responde `201 { mesa }`. Si ya se alcanzó el límite de mesas responde `409`, incluso con peticiones simultáneas.

### `GET /restaurants/:id/tables`

Admin y personal asignado (incluido el mesero). Devuelve `{ mesas }` con su área y piso.

### `PATCH /tables/:tableId` (ADMIN dueño)

Campos opcionales: `areaId`, `etiqueta`, `capacidad`, `forma`. No se puede cambiar `capacidad` ni `areaId` si la mesa tiene reservas futuras activas (`409`).

### `PATCH /tables/:tableId/status` (ADMIN o RECEPCIONISTA)

```json
{ "estado": "OUT_OF_SERVICE", "motivo": "Mesa en reparación" }
```

`estado`: `AVAILABLE`, `RESERVED`, `OCCUPIED` u `OUT_OF_SERVICE`. `motivo` es opcional. No se puede poner `OUT_OF_SERVICE` una mesa con reservas futuras activas (`409`); el intento queda registrado en auditoría.

### `DELETE /tables/:tableId` (ADMIN dueño)

`204`. Si la mesa tiene alguna reserva en su historial responde `409`.

---

## 8. Modalidades de reserva

Por ahora solo se pueden activar las gratuitas: `AUTO_FREE`, `ZONE_FREE` y `TABLE_FREE`.

| Código | Qué hace |
|---|---|
| `AUTO_FREE` | El sistema asigna la mesa libre con menor capacidad suficiente |
| `ZONE_FREE` | El cliente elige un área y el sistema asigna una mesa libre de esa área |
| `TABLE_FREE` | El cliente elige la mesa |

### `GET /reservation-methods`

Catálogo de la plataforma: `{ modalidades: [{ codigo, nombre, esPagada, habilitable }] }`.

### `GET /restaurants/:id/reservation-methods`

Modalidades del restaurante con su campo `activa`. Al cliente solo se le muestran las activas.

### `PUT /restaurants/:id/reservation-methods` (ADMIN dueño)

```json
{
  "modalidades": [
    { "codigo": "AUTO_FREE", "activa": true },
    { "codigo": "TABLE_FREE", "activa": false }
  ]
}
```

Activar una modalidad no habilitable responde `422`. Desactivar una no afecta reservas ya confirmadas.

---

## 9. Disponibilidad

### `GET /restaurants/:id/availability`

Query params, todos obligatorios:

| Parámetro | Ejemplo | Notas |
|---|---|---|
| `date` | `2026-11-23` | `YYYY-MM-DD`, fecha local del restaurante |
| `time` | `19:00` | `HH:MM`. Para clientes debe ser en intervalos de 30 minutos |
| `duration` | `90` | Solo `30`, `60`, `90`, `120` o `180` |
| `guests` | `2` | Número de personas |

Ejemplo:

```
GET /restaurants/:id/availability?date=2026-11-23&time=19:00&duration=90&guests=2
```

Respuesta `200` (siempre, aunque no haya lugar):

```json
{
  "disponible": true,
  "motivo": null,
  "ventana": { "inicio": "2026-11-24T01:00:00.000Z", "fin": "2026-11-24T02:30:00.000Z" },
  "zonas": [{ "areaId": "uuid", "area": "Terraza", "piso": "Planta baja", "mesasDisponibles": 2 }],
  "mesas": [{ "id": "uuid", "etiqueta": "M2", "capacidad": 4, "areaId": "uuid", "area": "Terraza", "piso": "Planta baja" }]
}
```

Si `disponible` es `false`, `motivo` explica por qué (cerrado ese día, fuera de horario, hora ya pasada, duración no permitida, sin mesas libres, etc.).

---

## 10. Reservas del cliente

### `POST /reservations` (CLIENTE)

| Campo | Tipo | Notas |
|---|---|---|
| `restauranteId` | uuid | |
| `modalidad` | string | `AUTO_FREE`, `ZONE_FREE` o `TABLE_FREE` |
| `fecha` | string | `YYYY-MM-DD` |
| `hora` | string | `HH:MM`, en intervalos de 30 min |
| `duracion` | number | `30`, `60`, `90`, `120` o `180` |
| `personas` | number | Entero de 1 a 100 |
| `areaId` | uuid | **Obligatorio** con `ZONE_FREE` |
| `mesaId` | uuid | **Obligatorio** con `TABLE_FREE` |

Ejemplo con `AUTO_FREE`:

```json
{
  "restauranteId": "uuid",
  "modalidad": "AUTO_FREE",
  "fecha": "2026-11-23",
  "hora": "19:00",
  "duracion": 90,
  "personas": 2
}
```

Responde `201 { reserva }` con estado `UPCOMING` y la mesa asignada en `mesas`. Una reserva de cliente usa siempre **una** mesa.

Errores frecuentes: `422` (horario, hora o duración inválidos, modalidad inactiva), `403 REPUTATION_RESTRICTED`, `409 LIMIT_PLATFORM`, `409 LIMIT_RESTAURANT`, `409 NO_TABLE_AVAILABLE`, `409 TABLE_TAKEN`.

### `GET /reservations/mine` (CLIENTE)

Sus reservas, de la más reciente a la más antigua. Filtro opcional: `?estado=UPCOMING`.

### `GET /reservations/:id`

El cliente solo ve las suyas (si no son suyas responde `404`). El admin y la recepcionista del restaurante pueden verlas. El mesero recibe `403`.

---

## 11. Reservas del restaurante

Solo ADMIN dueño y RECEPCIONISTA asignado.

### `POST /restaurants/:id/reservations`

Crea una reserva **presencial sin cuenta**. Empieza en el momento de la petición.

| Campo | Tipo | Notas |
|---|---|---|
| `nombre` | string | 2 a 100. Nombre de quien llega |
| `personas` | number | Entero de 1 a 200 |
| `mesaIds` | uuid[] | De 1 a 15 mesas del restaurante, de cualquier piso o área, sin repetir |
| `duracion` | number | Opcional. Por defecto `90` |

```json
{
  "nombre": "Familia López",
  "personas": 7,
  "mesaIds": ["uuid-mesa-1", "uuid-mesa-2"],
  "duracion": 90
}
```

La suma de capacidades de las mesas debe alcanzar para las personas (`422` si no). Si una mesa está ocupada o reservada en ese lapso responde `409 TABLE_TAKEN` y no reasigna ni cancela nada. No afecta la reputación de ningún cliente.

### `GET /restaurants/:id/reservations`

Filtros opcionales: `?date=2026-11-23` (día local del restaurante), `?estado=UPCOMING` y `?limit=100` (máximo 200). Orden por hora de inicio.

---

## 12. Ciclo de vida de una reserva

```
UPCOMING ──check-in──▶ CHECKED_IN ──complete──▶ COMPLETED
    │
    ├──noshow──▶ NO_SHOW
    └──cancel──▶ CANCELLED
```

Estados: `UPCOMING`, `CHECKED_IN`, `COMPLETED`, `CANCELLED`, `NO_SHOW`. Existe también `PENDING_PAYMENT`, reservado para pagos (aún no se usa). Las reservas en `PENDING_PAYMENT`, `UPCOMING` y `CHECKED_IN` están **activas**: ocupan la mesa y cuentan para los límites del cliente.

Todas las rutas siguientes son `POST`, sin cuerpo salvo que se indique.

| Ruta | Quién | Regla |
|---|---|---|
| `/reservations/:id/check-in` | ADMIN, RECEPCIONISTA | Desde la hora de inicio. La mesa pasa a `OCCUPIED`. Pasados 15 minutos sin no-show se acepta sin penalización y responde `llegadaTardia: true` |
| `/reservations/:id/complete` | ADMIN, RECEPCIONISTA | Solo desde `CHECKED_IN`. Libera todas las mesas (`AVAILABLE`) y aplica la recuperación de reputación |
| `/reservations/:id/noshow` | ADMIN, RECEPCIONISTA | Solo desde `UPCOMING` y pasados 15 minutos de tolerancia. Aplica −0.30 de reputación una sola vez. La reserva no se reabre |
| `/reservations/:id/cancel` | CLIENTE, ADMIN, RECEPCIONISTA | Ver abajo |

Las respuestas de `check-in`, `complete` y `noshow` incluyen la `reserva` actualizada. `complete` y `noshow` agregan `reputacion` (antes, después y delta) cuando la reserva es de un cliente con cuenta.

### Cancelación

Cuerpo: `{ "motivo": "texto" }`.

- **Cliente:** solo sus reservas gratuitas, con al menos 2 horas de anticipación. Sin penalización. El motivo es opcional. Si faltan menos de 2 horas responde `409 CANCELLATION_WINDOW_CLOSED`.
- **Admin o recepcionista:** en cualquier momento mientras esté `UPCOMING`. El `motivo` es **obligatorio** (`422` sin él) y no afecta la reputación del cliente.
- Se guarda quién canceló, cuándo, el motivo y la política aplicada (`FREE_CLIENT_2H` o `STAFF_CANCEL`).

---

## 13. Reputación

Cada cliente tiene una **sola reputación global** de 0.00 a 5.00. Empieza en 5.00.

| Nivel | Rango | Máx. reservas activas (plataforma / por restaurante) | Modalidades |
|---|---|---|---|
| Alta | más de 3.50 hasta 5.00 | 6 / 2 | Gratuitas y pagadas |
| Media | 1.50 a 3.50 | 4 / 2 | Solo pagadas |
| Baja | menos de 1.50 | 2 / 1 | Solo pagadas |

- **No-show:** resta 0.30 (mínimo 0.00). Solo lo marca el personal.
- **Reserva completada:** suma puntos según las reservas completadas seguidas desde el último no-show: `P(n) = min(0.20, 0.10 + 0.02 × (n − 1))`. Es decir +0.10, +0.12, +0.14, +0.16, +0.18 y luego +0.20. La reputación nunca pasa de 5.00.
- Las reservas presenciales sin cuenta no afectan a nadie.

### `GET /me/reputation` (CLIENTE)

```json
{
  "reputacion": 4.7,
  "nivel": "ALTA",
  "limites": { "plataforma": 6, "restaurante": 2, "gratuitas": true },
  "activas": { "plataforma": 1, "porRestaurante": [{ "restauranteId": "uuid", "total": 1 }] },
  "rachaPagadas": 0
}
```

### `GET /me/reputation/history` (CLIENTE)

Últimos 100 movimientos: `{ movimientos: [{ id, tipo, delta, reputacionAntes, reputacionDespues, reservaId, createdAt }] }`. `tipo` puede ser `NO_SHOW`, `RECOVERY` o `AJUSTE`.

---

## 14. Lo que aún no está disponible

- Modalidades **pagadas** y pagos simulados. Por eso un cliente con reputación media o baja todavía no puede reservar ni recuperar reputación.
- Cancelación de reservas pagadas y devoluciones.
- Modificar fecha, hora, duración o mesa de una reserva ya creada.
- Membresías (`MEMBER_ONLY`).
- Recuperación de contraseña.
- Editar el límite de mesas de un restaurante.
- Renombrar pisos y áreas.
