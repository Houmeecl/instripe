# IAM para Bedrock Operations Advisor

## Resumen

El módulo OperationsAdvisor invoca Bedrock Converse API. En producción (ECS Fargate), la task asume un IAM role que necesita permisos explícitos para:

1. Invocar modelos foundational de Bedrock
2. (Opcional) Acceder a Knowledge Base si se implementa RAG
3. CloudWatch Logs para auditoría

## Política mínima de permisos

Para la tarea ECS que ejecuta `instripe`, agregar esta política en línea o como managed policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BedrockInvokeModel",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "arn:aws:bedrock:us-east-1::foundation-model/us.anthropic.claude-sonnet-4-6"
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:us-east-1:632404568231:log-group:/ecs/instripe-*"
    }
  ]
}
```

## Variantes

### Si se agrega Knowledge Base (RAG futuro)

Agregar:
```json
{
  "Sid": "BedrockKnowledgeBase",
  "Effect": "Allow",
  "Action": [
    "bedrock:Retrieve",
    "bedrock:RetrieveAndGenerate"
  ],
  "Resource": [
    "arn:aws:bedrock:us-east-1:632404568231:knowledge-base/*"
  ]
}
```

### Si se desea restringir a un modelo específico (recomendar en producción)

En lugar de `us.anthropic.claude-sonnet-4-6`, especificar:
- **Producción**: `us.anthropic.claude-sonnet-4-6` (última stable)
- **Dev**: `us.anthropic.claude-haiku-4-8` (más rápido, costo bajo)
- **Cambio futuro**: Actualizar ARN al cambiar modelo

## Verificación de disponibilidad del modelo

En AWS Production (us-east-1, 632404568231), confirmar:

```bash
aws bedrock list-foundation-models \
  --region us-east-1 \
  --query 'modelSummaries[?modelId==`us.anthropic.claude-sonnet-4-6`]'
```

Debe retornar el modelo disponible.

## Troubleshooting

| Error | Causa | Solución |
|-------|-------|----------|
| `AccessDeniedException` | Rol sin permisos `bedrock:InvokeModel` | Agregar ARN del modelo en Resource |
| `ValidationException` modelo no encontrado | Modelo no habilitado en región | Verificar `list-foundation-models` |
| `ThrottlingException` | Límite de tasa excedido | Configurar retry con backoff (ya en OperationsAdvisorModule) |
| `InvalidRequest` | Format Converse incorrecto | Verificar `messages`, `system` son arrays; sin `maxTokens` |

## Auditoria con CloudTrail

Bedrock invocations quedan en CloudTrail:

```bash
# Ver logs de Bedrock en últimas 24 horas
aws cloudtrail lookup-events \
  --region us-east-1 \
  --lookup-attributes AttributeKey=EventSource,AttributeValue=bedrock.amazonaws.com \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --query 'Events[].{Time:EventTime,Event:EventName,User:Username}'
```

Esto permite auditar quién consultó el asesor y cuándo.

## Próximos pasos

1. Agregar política IAM al ECS task role (`instripe-ecs-task-role`)
2. Desplegar OperationsAdvisor a staging
3. Probar end-to-end: crear consulta → verificar que Bedrock responda
4. Monitorizar CloudWatch Logs y CloudTrail para fallos/throttling
5. Configurar alarmas si `bedrock:InvokeModel` rate excede umbral
