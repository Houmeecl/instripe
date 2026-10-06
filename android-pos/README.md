# Remesas en POS TUU (app Android)

App mínima para el POS TUU (Sunmi o Kozen). Muestra las pantallas de `/remesas` de la plataforma en un
WebView y entrega el cobro a la app de pago TUU por inter-app (`Intent.ACTION_SEND`, `text/json`,
`Intent.EXTRA_TEXT`). El resultado (`transactionResult`) vuelve a la página y la página lo informa
al servidor. El servidor confirma la venta en los reportes TUU (`/Report/get-report`) antes de
enviar el dinero por Global66.

## Compilar

Requiere Android Studio (AGP 8.5, JDK 17).

```bash
cd android-pos
gradle wrapper        # una vez, si no tienes el wrapper
./gradlew assembleDebug    # usa com.haulmer.paymentapp.dev (TUU Demo / DEV)
./gradlew assembleRelease  # usa com.haulmer.paymentapp
```

Antes de instalarla:

1. Activa el **modo integración** de la app de pago en el Espacio de Trabajo TUU.
2. Para pruebas instala **TUU Demo** (APK Sunmi o Kozen desde developers.tuu.cl/docs/tuu-demo).

Al abrirla por primera vez pide la dirección de la plataforma (solo `https://`) y el número de serie del
POS, tal como aparece en TUU. Ese número es el que se cruza con los reportes.

## Seguridad

- El puente `TuuBridge` solo responde a páginas del mismo origen configurado.
- La app no decide nada sobre el dinero: el servidor verifica la venta en TUU y Global66 solo se llama
  después de esa verificación (o de la aprobación de otro usuario de Operación).

## Pendiente

- Impresión del comprobante propio con QR. Hoy imprime la app de pago TUU (`printVoucherOnApp: true`)
  con el código de la remesa en los campos personalizados. Para Kozen existe la librería
  `POIPrinterManager` de TUU (se descarga aparte); Sunmi usa otra.
