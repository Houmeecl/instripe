# Backoffice de remesas en Appsmith

Appsmith es la web donde Operación administra los POS, las remesas, el ledger y la conciliación.
No guarda datos propios: todo lo lee y lo escribe en la API de instripe, que mantiene las reglas
(verificación TUU, 30 minutos de aprobación de fondos, saldo SICR3P, doble control, partida doble).

## 1. Despliegue en Coolify

1. En Coolify: **New resource → Docker Compose**, repositorio `Houmeecl/instripe`, archivo `docker-compose.yml`.
2. En **Environment** carga al menos `AUTH_SEED_PASSWORD` y, para operar en real, las credenciales de
   Global66 SICR3P y TUU (ver `.env.example`).
3. Coolify asigna un dominio con SSL a cada servicio (`instripe` y `appsmith`).
4. En Global66 Empresas → Integraciones API registra la **IP pública del VPS** en la credencial, y
   el webhook `https://<dominio instripe>/webhooks/global66`.
5. Abre el dominio de `appsmith` y crea la cuenta de administrador de Appsmith.

## 2. Datasource

**Datasources → New → Authenticated API**

| Campo | Valor |
|---|---|
| URL | `http://instripe:3000` (red interna de Docker; no sale a Internet) |
| Header | `Authorization: Bearer {{appsmith.store.token}}` |
| Header | `Content-Type: application/json` |

Cada persona entra con **su** usuario de instripe. El token es su sesión (12 horas), así se
conservan los roles y el doble control: quien creó una remesa no puede aprobarla ni adelantarla.

## 3. Página Login

Query `login` (POST `/api/session`):

```json
{ "email": "{{Email.text}}", "password": "{{Clave.text}}" }
```

Header extra: `X-Client: api` (sin él la API no devuelve el token).

Botón **Entrar**, onClick:

```js
{{ login.run().then(() => { storeValue("token", login.data.token); storeValue("user", login.data.user); navigateTo("Remesas"); })
   .catch(() => showAlert(login.data.error || "Correo o clave incorrectos", "error")) }}
```

Si `login.data.user.mustChangePassword` es `true`, el usuario tiene que cambiar la clave inicial
(POST `/api/session/password` con `{ currentPassword, newPassword }`).

## 4. Página Remesas

| Query | Método y ruta | Uso |
|---|---|---|
| `remesas` | GET `/api/remesas` | Tabla principal (ejecutar al cargar la página y cada 30 s) |
| `saldo` | GET `/api/remesas/saldo` | Saldo de la wallet CLP SICR3P en Global66 |
| `retener` | POST `/api/remesas/{{Tabla.selectedRow.id}}/retener` body `{ "reason": "{{Motivo.text}}" }` | Detener antes del envío |
| `enviarAhora` | POST `/api/remesas/{{Tabla.selectedRow.id}}/enviar-ahora` | Adelantar el envío (otro usuario) |
| `aprobar` | POST `/api/remesas/{{Tabla.selectedRow.id}}/aprobar` | Liberar una retenida |
| `actualizar` | POST `/api/remesas/{{Tabla.selectedRow.id}}/actualizar` | Reconsultar TUU o Global66 |

Columnas sugeridas para la tabla (`{{remesas.data.remesas}}`):

| Columna | Valor |
|---|---|
| Código | `{{currentRow.code}}` |
| Estado | `{{currentRow.status}}` |
| Remitente | `{{currentRow.remitter.name}}` · `{{currentRow.remitter.rut}}` |
| Beneficiario | `{{currentRow.beneficiary.firstName + " " + currentRow.beneficiary.lastName}}` |
| Cobrado | `{{currentRow.quote.total}}` |
| Convierte | `{{currentRow.quote.amountToConvert}}` |
| Recibe | `{{currentRow.global66?.destinationAmount ?? currentRow.quote.receiveAmount}} {{currentRow.quote.currency}}` |
| Sale de Global66 | `{{currentRow.sendAt}}` |
| Llegada estimada | `{{currentRow.estimatedArrival}}` |
| POS | `{{currentRow.payment?.serialNumber}}` |
| Liquidación TUU | `{{currentRow.settlement ? "Liquidado " + currentRow.settlement.date : "Pendiente depósito"}}` |

Cuenta regresiva de la aprobación de fondos:
`{{ Math.max(0, Math.round((new Date(currentRow.sendAt) - Date.now()) / 60000)) + " min" }}`.

Estados: `awaiting_payment`, `payment_unverified`, `funds_hold` (aprobación de fondos),
`pending_review` (retenida), `paid`, `processing`, `sent`, `successful`, `rejected`,
`payment_failed`, `transfer_failed`.

## 5. Página Equipos POS

| Query | Método y ruta |
|---|---|
| `pos` | GET `/api/remesas/pos` |
| `guardarPos` | PUT `/api/remesas/pos/{{Serie.text}}` body `{ "label": "{{Nombre.text}}", "companyId": "{{Empresa.selectedOptionValue}}", "active": {{Activo.isChecked}} }` |
| `empresas` | GET `/api/empresas` (para el selector de comercio: `{{empresas.data.companies}}`) |

En producción solo se aceptan pagos informados por POS **registrados y activos**, y un comercio solo
puede usar sus propios POS.

## 6. Página Ledger y conciliación

| Query | Método y ruta |
|---|---|
| `ledger` | GET `/api/remesas/ledger` → `lines` (asientos) y `balances` (saldo por cuenta) |
| `conciliar` | POST `/api/remesas/conciliar` body `{ "date": "{{Fecha.formattedDate}}" }` (formato `YYYY-MM-DD`) |
| `csv` | Enlace a `https://<dominio instripe>/api/remesas/export` (requiere sesión en el navegador) |

Asientos por remesa (cada uno cuadra, debe = haber):

| Evento | Debe | Haber |
|---|---|---|
| `despacho` (Global66 aceptó el envío) | Cuenta por cobrar TUU: total cobrado | Fondo Global66: monto convertido · Ingreso comisión: total − convertido |
| `rechazo` (Global66 devolvió el envío) | Fondo Global66: monto convertido | Devoluciones por pagar a clientes |
| `deposito_tuu` (conciliación) | Banco: neto depositado · Gasto comisión TUU | Cuenta por cobrar TUU: total |

La conciliación toma, para cada remesa pagada ese día, el neto y la comisión de la venta en el
reporte de TUU. Las que no aparecen quedan en `pending` con el motivo.

## 7. Página Tasas

| Query | Método y ruta |
|---|---|
| `config` | GET `/api/remesas/config` (corredores del catálogo Global66) |
| `guardarTasa` | PUT `/api/remesas/corredores/{{Tabla.selectedRow.country}}` body `{ "rate": {{Tasa.text}}, "commissionPct": {{Comision.text}}, "conversionPct": {{Conversion.text}}, "enabled": {{Habilitado.isChecked}} }` |

La tasa es CLP por 1 unidad de la moneda de destino. Los porcentajes van en decimal (0.03 = 3 %).

## 8. Seguridad

- Appsmith habla con instripe por la red interna (`http://instripe:3000`). No expongas la API sin TLS.
- El token se guarda en `appsmith.store` del navegador del usuario y expira a las 12 horas.
- Usa un usuario de instripe por persona; no compartas un usuario de Operación entre varias personas,
  porque rompe el doble control.
