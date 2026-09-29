# Operations Advisor — Asesor de Operación con Bedrock

Módulo experimental que integra AWS Bedrock Converse API para proporcionar análisis de operación en lenguaje natural.

## Características

- **Consultas sin ejecución**: El usuario hace preguntas sobre el estado operacional (cuentas, pagos, pólizas, etc.)
- **Análisis con Bedrock**: Claude Sonnet genera propuestas y recomendaciones no vinculantes
- **Rol restringido**: Solo `operacion` puede consultar; revisores (`operacion`, `administrador_empresa`) aprueban propuestas
- **Propuestas auditables**: Cada propuesta queda registrada, pendiente de revisión humana
- **Sin secretos en logs**: Sistema evita registrar PII, PAN completo, contraseñas en claro

## Endpoints

### Crear consulta (operacion)

```
POST /api/advisor/query
{
  "category": "accounts" | "payments" | "policies" | "exits" | "rules",
  "question": "¿Cuál es el saldo total en pesos?",
  "context": { "timeRange": "last_7_days" }  // opcional
}

Response 201:
{
  "query": { "id": "aq_...", "category": "accounts", "question": "...", "createdAt": "...", "requestedBy": "usr_..." },
  "proposal": { "id": "ap_...", "status": "draft", "analysis": "...", "recommendation": "..." }  // si Bedrock está disponible
}
```

### Listar consultas (operacion)

```
GET /api/advisor/queries?limit=50
Response: { "queries": [...] }
```

### Obtener consulta

```
GET /api/advisor/queries/:id
Response: { "query": {...} }
```

### Listar propuestas (operacion, administrador_empresa)

```
GET /api/advisor/proposals?status=draft|reviewed|approved|rejected|executed
Response: { "proposals": [...] }
```

### Obtener propuesta

```
GET /api/advisor/proposals/:id
Response: { "proposal": {...} }
```

### Revisar propuesta (operacion, administrador_empresa)

```
POST /api/advisor/proposals/:id/review
{
  "approved": true|false,
  "notes": "Comentarios de revisión"  // opcional
}

Response: { "proposal": { "status": "approved|rejected", "reviewedBy": "usr_..." } }
```

## Configuración

### Ambiente necesario para Bedrock

```bash
export AWS_REGION=us-east-1
export BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-6  # opcional
```

Sin `AWS_REGION`, el módulo funciona en modo **local**: almacena consultas y propuestas pero no invoca Bedrock.

### Permisos IAM mínimos

El rol de ejecución de la aplicación debe tener:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": "arn:aws:bedrock:us-east-1::foundation-model/us.anthropic.claude-sonnet-4-6"
    }
  ]
}
```

## Limitaciones y diseño

1. **Solo análisis**: El módulo genera propuestas, nunca ejecuta cambios.
2. **Datos filtrados**: Las consultas deben pasarse con contexto específico; no expone todo el estado.
3. **Auditoría completa**: Cada consulta, análisis y revisión queda registrado.
4. **Temperatura baja** (0.1): Redacción factual, no creativa.
5. **Máximo 8000 tokens**: Propuestas concisas.

## Ejemplo de flujo

1. Usuario `operacion@proveedorregional.cl` hace una consulta:
   ```
   POST /api/advisor/query
   {
     "category": "accounts",
     "question": "¿Hay cuentas con saldo negativo?",
     "context": { "status": "active" }
   }
   ```

2. Sistema registra la consulta y llama a Bedrock con el prompt filtrado.

3. Bedrock responde:
   ```
   analysis: "Revisar el libro mayor, los saldos normales... La cuenta xyz tiene..."
   recommendation: "Propuesta para revisión: [descripción de acciones sugeridas]"
   ```

4. La propuesta se crea con `status: "draft"`.

5. Un revisor (`operacion` u `administrador_empresa`):
   ```
   POST /api/advisor/proposals/ap_xxx/review
   {
     "approved": true,
     "notes": "OK, proceder según lo propuesto"
   }
   ```

6. La propuesta se marca como `approved` pero **no ejecuta nada automáticamente**.

7. El operador actúa manualmente según la propuesta aprobada.

## Notas de seguridad

- **PII masking**: El sistema intenta evitar incluir en la solicitud a Bedrock:
  - PAN completo (últimos 4 dígitos sí, pero nunca el número entero)
  - Contraseñas o seed passwords
  - Tokens de autenticación
- **Logs**: Consultas y análisis se almacenan localmente sin encriptación en el store SQLite/PostgreSQL. En producción, considerar:
  - Auditoría con CloudTrail en Bedrock
  - Criptografía en reposo
  - Retención limitada de propuestas
- **Cuotas**: Bedrock tiene límites de tasa; se configura `maxAttempts: 3` con `retryMode: adaptive`.

## Desarrollo local

```bash
# Sin Bedrock (modo almacenamiento local):
npm run dev

# Con Bedrock (requiere AWS_REGION y credenciales):
export AWS_REGION=us-east-1
npm run dev
```

Las consultas siempre se almacenan; solo con `AWS_REGION` se invoca Bedrock.
