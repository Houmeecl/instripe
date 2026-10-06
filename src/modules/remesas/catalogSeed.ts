// Snapshot of Global66 public route catalog (api.global66.com/route/ext), trimmed.
// Used in demo mode without network and in tests. Live data replaces it when reachable.
export const CATALOG_SEED: unknown = {
 "routes": {
  "groups": [
   {
    "destinationCountry": "CO",
    "destinationCountryNames": {
     "nameES": "Colombia"
    },
    "routes": [
     {
      "routeId": 137,
      "originCountry": "CO",
      "originCurrency": "COP",
      "destinationCountry": "CO",
      "destinationCurrency": "COP",
      "originMinUsd": 20,
      "originMaxUsd": 100000,
      "slaHours": 13,
      "product": "REMITTANCE_B2B",
      "bankingCodes": [
       {
        "id": 46,
        "bankName": "Bancolombia"
       },
       {
        "id": 1198,
        "bankName": "Bancoomeva"
       },
       {
        "id": 888,
        "bankName": "Davivienda"
       },
       {
        "id": 35,
        "bankName": "Banco Caja Social BCSC"
       },
       {
        "id": 36,
        "bankName": "Banco de Bogotá"
       },
       {
        "id": 1199,
        "bankName": "Citibank"
       }
      ],
      "paymentTypes": [
       {
        "id": 7,
        "paymentType": "BREB"
       },
       {
        "id": 1,
        "paymentType": "WIRE_TRANSFER"
       }
      ]
     }
    ]
   },
   {
    "destinationCountry": "ES",
    "destinationCountryNames": {
     "nameES": "España"
    },
    "routes": [
     {
      "routeId": 36,
      "originCurrency": "EUR",
      "destinationCountry": "ES",
      "destinationCurrency": "EUR",
      "originMinUsd": 20,
      "originMaxUsd": 500000,
      "product": "REMITTANCE_B2B",
      "bankingCodes": [
       {
        "id": 1366,
        "bankName": "Banco de la Nación Argentina S.E."
       },
       {
        "id": 157,
        "bankName": "BBVA - Banco Bilbao Vizcaya Argentaria S.A."
       },
       {
        "id": 1284,
        "bankName": "Arquia Bank"
       },
       {
        "id": 977,
        "bankName": "Bankia"
       },
       {
        "id": 972,
        "bankName": "CAIXABANK S.A."
       },
       {
        "id": 976,
        "bankName": "Abanca Corporación Bancaria S.A."
       }
      ],
      "paymentTypes": [
       {
        "id": 1,
        "paymentType": "WIRE_TRANSFER"
       }
      ]
     }
    ]
   },
   {
    "destinationCountry": "PE",
    "destinationCountryNames": {
     "nameES": "Perú"
    },
    "routes": [
     {
      "routeId": 227,
      "originCountry": "PE",
      "originCurrency": "PEN",
      "destinationCountry": "PE",
      "destinationCurrency": "PEN",
      "originMinUsd": 20,
      "originMaxUsd": 100000,
      "slaHours": 8,
      "product": "REMITTANCE_B2B",
      "bankingCodes": [
       {
        "id": 3,
        "bankName": "Banco de Crédito del Peru (BCP)"
       },
       {
        "id": 11,
        "bankName": "INTERBANK"
       },
       {
        "id": 5,
        "bankName": "Banco Scotiabank"
       },
       {
        "id": 900,
        "bankName": "BBVA PERU"
       },
       {
        "id": 4,
        "bankName": "Banco de la Nacion"
       },
       {
        "id": 998,
        "bankName": "Banco Falabella"
       }
      ],
      "paymentTypes": [
       {
        "id": 1,
        "paymentType": "WIRE_TRANSFER"
       }
      ]
     }
    ]
   },
   {
    "destinationCountry": "PY",
    "destinationCountryNames": {
     "nameES": "Paraguay"
    },
    "routes": [
     {
      "routeId": 226,
      "originCurrency": "PYG",
      "destinationCountry": "PY",
      "destinationCurrency": "PYG",
      "originMinUsd": 20,
      "originMaxUsd": 20000,
      "slaHours": 7,
      "product": "REMITTANCE_B2B",
      "bankingCodes": [
       {
        "id": 1476,
        "bankName": "Banco Amambay S.A."
       },
       {
        "id": 1477,
        "bankName": "Banco Atlas S.A."
       },
       {
        "id": 1478,
        "bankName": "Banco Basa S.A."
       },
       {
        "id": 1480,
        "bankName": "Banco Busaif S.A. de Inversión y Fomento"
       },
       {
        "id": 1481,
        "bankName": "Banco Central del Paraguay"
       },
       {
        "id": 1482,
        "bankName": "Banco Comercial Paraguayo S.A."
       }
      ],
      "paymentTypes": [
       {
        "id": 1,
        "paymentType": "WIRE_TRANSFER"
       }
      ]
     }
    ]
   },
   {
    "destinationCountry": "US",
    "destinationCountryNames": {
     "nameES": "Estados Unidos"
    },
    "routes": [
     {
      "routeId": 59,
      "originCountry": "US",
      "originCurrency": "USD",
      "destinationCountry": "US",
      "destinationCurrency": "USD",
      "originMinUsd": 20,
      "originMaxUsd": 15000,
      "slaHours": 16,
      "product": "REMITTANCE_B2B",
      "bankingCodes": [
       {
        "id": 899,
        "bankName": "Bank of America"
       },
       {
        "id": 903,
        "bankName": "Wells Fargo"
       },
       {
        "id": 902,
        "bankName": "Chase Bank"
       },
       {
        "id": 901,
        "bankName": "Citibank"
       },
       {
        "id": 985,
        "bankName": "PNC Financial Services Group"
       },
       {
        "id": 983,
        "bankName": "TD Group"
       }
      ],
      "paymentTypes": [
       {
        "id": 1,
        "paymentType": "WIRE_TRANSFER"
       }
      ]
     }
    ]
   },
   {
    "destinationCountry": "VE",
    "destinationCountryNames": {
     "nameES": "Venezuela"
    },
    "routes": [
     {
      "routeId": 266,
      "originCurrency": "VES",
      "destinationCountry": "VE",
      "destinationCurrency": "VES",
      "originMinUsd": 20,
      "originMaxUsd": 20000,
      "slaHours": 6,
      "product": "REMITTANCE_B2B",
      "bankingCodes": [
       {
        "id": 891,
        "bankName": "Banesco"
       },
       {
        "id": 892,
        "bankName": "Mercantil"
       },
       {
        "id": 893,
        "bankName": "BBVA Provincial"
       },
       {
        "id": 895,
        "bankName": "Banco de Venezuela"
       },
       {
        "id": 894,
        "bankName": "Banco Bicentenario"
       },
       {
        "id": 898,
        "bankName": "Banco Nacional de Crédito"
       }
      ],
      "paymentTypes": [
       {
        "id": 1,
        "paymentType": "WIRE_TRANSFER"
       }
      ]
     }
    ]
   }
  ]
 },
 "fields": {
  "137": {
   "routeId": 137,
   "fields": [
    {
     "field": "accountType",
     "label": "Tipo de cuenta",
     "required": true,
     "type": "list",
     "minLength": 1,
     "maxLength": 50,
     "options": [
      {
       "value": "Saving",
       "label": "Cuenta de ahorro"
      },
      {
       "value": "Checking",
       "label": "Corriente"
      }
     ]
    },
    {
     "field": "accountNumber",
     "label": "Número de cuenta",
     "required": true,
     "type": "text",
     "minLength": 1,
     "maxLength": 50,
     "options": []
    },
    {
     "field": "routingCodeType1",
     "label": "SWIFT",
     "required": true,
     "type": "text",
     "minLength": 5,
     "maxLength": 5,
     "options": []
    },
    {
     "field": "routingCodeValue1",
     "label": "SWIFT",
     "required": false,
     "type": "text",
     "minLength": 8,
     "maxLength": 11,
     "options": []
    },
    {
     "field": "bankId",
     "label": "Bank Code",
     "required": false,
     "type": "number",
     "regex": "^[0-9]*$",
     "minLength": 1,
     "maxLength": 10,
     "options": []
    },
    {
     "field": "accountBankName",
     "label": "Nombre Banco",
     "required": true,
     "type": "text",
     "minLength": 1,
     "maxLength": 50,
     "options": []
    },
    {
     "field": "documentType",
     "label": "Tipo de identificación",
     "required": true,
     "type": "list",
     "minLength": 1,
     "maxLength": 20,
     "options": []
    },
    {
     "field": "documentNumber",
     "label": "Número de identificación",
     "required": true,
     "type": "alphanumeric",
     "minLength": 6,
     "maxLength": 30,
     "options": []
    }
   ]
  },
  "36": {
   "routeId": 36,
   "fields": [
    {
     "field": "accountType",
     "label": "Tipo de cuenta",
     "required": true,
     "type": "list",
     "minLength": 1,
     "maxLength": 50,
     "options": [
      {
       "value": "Saving",
       "label": "Cuenta de ahorro"
      },
      {
       "value": "Checking",
       "label": "Corriente"
      }
     ]
    },
    {
     "field": "accountNumber",
     "label": "Número de cuenta",
     "required": true,
     "type": "text",
     "minLength": 1,
     "maxLength": 50,
     "options": []
    },
    {
     "field": "routingCodeType1",
     "label": "SWIFT",
     "required": true,
     "type": "text",
     "minLength": 5,
     "maxLength": 5,
     "options": []
    },
    {
     "field": "routingCodeValue1",
     "label": "SWIFT",
     "required": false,
     "type": "text",
     "minLength": 8,
     "maxLength": 11,
     "options": []
    },
    {
     "field": "accountBankName",
     "label": "Nombre Banco",
     "required": true,
     "type": "text",
     "minLength": 1,
     "maxLength": 50,
     "options": []
    }
   ]
  },
  "227": {
   "routeId": 227,
   "fields": [
    {
     "field": "accountType",
     "label": "Tipo de cuenta",
     "required": true,
     "type": "list",
     "minLength": 1,
     "maxLength": 50,
     "options": [
      {
       "value": "Saving",
       "label": "Cuenta de ahorro"
      },
      {
       "value": "Checking",
       "label": "Corriente"
      }
     ]
    },
    {
     "field": "accountNumber",
     "label": "Número de cuenta",
     "required": true,
     "type": "text",
     "minLength": 1,
     "maxLength": 50,
     "options": []
    },
    {
     "field": "bankId",
     "label": "Bank Code",
     "required": false,
     "type": "number",
     "regex": "^[0-9]*$",
     "minLength": 1,
     "maxLength": 10,
     "options": []
    },
    {
     "field": "accountBankName",
     "label": "Nombre Banco",
     "required": true,
     "type": "text",
     "minLength": 1,
     "maxLength": 50,
     "options": []
    },
    {
     "field": "documentType",
     "label": "Tipo de identificación",
     "required": true,
     "type": "list",
     "minLength": 1,
     "maxLength": 20,
     "options": []
    },
    {
     "field": "documentNumber",
     "label": "Número de identificación",
     "required": true,
     "type": "alphanumeric",
     "minLength": 6,
     "maxLength": 30,
     "options": []
    }
   ]
  },
  "226": {
   "routeId": 226,
   "fields": [
    {
     "field": "accountType",
     "label": "Tipo de cuenta",
     "required": true,
     "type": "list",
     "minLength": 1,
     "maxLength": 50,
     "options": [
      {
       "value": "Saving",
       "label": "Cuenta de ahorro"
      },
      {
       "value": "Checking",
       "label": "Corriente"
      }
     ]
    },
    {
     "field": "accountNumber",
     "label": "Número de cuenta",
     "required": true,
     "type": "text",
     "minLength": 1,
     "maxLength": 50,
     "options": []
    },
    {
     "field": "routingCodeValue1",
     "label": "SIPAP",
     "required": true,
     "type": "text",
     "minLength": 16,
     "maxLength": 16,
     "options": []
    },
    {
     "field": "routingCodeType1",
     "label": "SIPAP",
     "required": true,
     "type": "text",
     "minLength": 5,
     "maxLength": 5,
     "options": []
    },
    {
     "field": "accountBankName",
     "label": "Nombre Banco",
     "required": true,
     "type": "text",
     "minLength": 1,
     "maxLength": 50,
     "options": []
    }
   ]
  },
  "59": {
   "routeId": 59,
   "fields": [
    {
     "field": "accountType",
     "label": "Tipo de cuenta",
     "required": true,
     "type": "list",
     "minLength": 1,
     "maxLength": 50,
     "options": [
      {
       "value": "Saving",
       "label": "Cuenta de ahorro"
      },
      {
       "value": "Checking",
       "label": "Corriente"
      }
     ]
    },
    {
     "field": "accountNumber",
     "label": "Número de cuenta",
     "required": true,
     "type": "text",
     "minLength": 1,
     "maxLength": 50,
     "options": []
    },
    {
     "field": "routingCodeValue1",
     "label": "ACH/ABA",
     "required": true,
     "type": "number",
     "regex": "^[0-9,$]*$",
     "minLength": 9,
     "maxLength": 9,
     "options": []
    },
    {
     "field": "routingCodeType1",
     "label": "ACH CODE",
     "required": true,
     "type": "text",
     "minLength": 8,
     "maxLength": 8,
     "options": []
    },
    {
     "field": "state",
     "label": "Estado donde se aperturó la cuenta",
     "required": true,
     "type": "list",
     "minLength": 1,
     "maxLength": 50,
     "options": []
    },
    {
     "field": "bankId",
     "label": "Bank Code",
     "required": false,
     "type": "number",
     "regex": "^[0-9]*$",
     "minLength": 1,
     "maxLength": 10,
     "options": []
    },
    {
     "field": "accountBankName",
     "label": "Nombre Banco",
     "required": true,
     "type": "text",
     "minLength": 1,
     "maxLength": 50,
     "options": []
    },
    {
     "field": "postCode",
     "label": "Código postal",
     "required": true,
     "type": "text",
     "minLength": 1,
     "maxLength": 100,
     "options": []
    },
    {
     "field": "documentType",
     "label": "Tipo de identificación",
     "required": true,
     "type": "list",
     "minLength": 1,
     "maxLength": 20,
     "options": []
    },
    {
     "field": "documentNumber",
     "label": "Número de identificación",
     "required": true,
     "type": "alphanumeric",
     "minLength": 6,
     "maxLength": 30,
     "options": []
    }
   ]
  },
  "266": {
   "routeId": 266,
   "fields": [
    {
     "field": "accountType",
     "label": "Tipo de cuenta",
     "required": true,
     "type": "list",
     "minLength": 1,
     "maxLength": 50,
     "options": [
      {
       "value": "Saving",
       "label": "Cuenta de ahorro"
      },
      {
       "value": "Checking",
       "label": "Corriente"
      }
     ]
    },
    {
     "field": "accountNumber",
     "label": "Número de cuenta",
     "required": true,
     "type": "text",
     "minLength": 1,
     "maxLength": 50,
     "options": []
    },
    {
     "field": "accountBankName",
     "label": "Nombre Banco",
     "required": true,
     "type": "text",
     "minLength": 1,
     "maxLength": 50,
     "options": []
    }
   ]
  }
 },
 "documents": {
  "CO": {
   "individual": [
    {
     "nameDisplay": "CC (Cédula de ciudadanía)",
     "value": "CC",
     "minSize": 6,
     "maxSize": 10,
     "characterType": "^\\d+$",
     "displayField": "Cédula de Ciudadanía",
     "fieldType": "number"
    },
    {
     "nameDisplay": "CE (Cédula de extranjería)",
     "value": "CE",
     "minSize": 6,
     "maxSize": 12,
     "characterType": "^\\d+$",
     "displayField": "Cédula de Extranjería",
     "fieldType": "number"
    },
    {
     "nameDisplay": "Pasaporte",
     "value": "PASS",
     "minSize": 5,
     "maxSize": 12,
     "characterType": "^\\w+$",
     "displayField": null,
     "fieldType": null
    },
    {
     "nameDisplay": "Permiso por Protección Temporal",
     "value": "PPT",
     "minSize": 1,
     "maxSize": 12,
     "characterType": null,
     "displayField": null,
     "fieldType": null
    },
    {
     "nameDisplay": "Carnet Diplomatico",
     "value": "CD",
     "minSize": 1,
     "maxSize": 12,
     "characterType": null,
     "displayField": null,
     "fieldType": null
    }
   ]
  },
  "ES": {
   "individual": [
    {
     "nameDisplay": "DNI",
     "value": "DNI",
     "minSize": 1,
     "maxSize": 50,
     "characterType": null,
     "displayField": null,
     "fieldType": null
    },
    {
     "nameDisplay": "Pasaporte",
     "value": "PASS",
     "minSize": 5,
     "maxSize": 20,
     "characterType": "^\\w+$",
     "displayField": null,
     "fieldType": null
    },
    {
     "nameDisplay": "NIE",
     "value": "NIE",
     "minSize": 1,
     "maxSize": 50,
     "characterType": null,
     "displayField": null,
     "fieldType": null
    },
    {
     "nameDisplay": "NIF",
     "value": "NIF",
     "minSize": 1,
     "maxSize": 50,
     "characterType": null,
     "displayField": null,
     "fieldType": null
    }
   ]
  },
  "PE": {
   "individual": [
    {
     "nameDisplay": "DNI",
     "value": "DNI",
     "minSize": 8,
     "maxSize": 9,
     "characterType": "^\\d+$",
     "displayField": "DNI",
     "fieldType": "number"
    },
    {
     "nameDisplay": "Carnet de Extranjería",
     "value": "CE",
     "minSize": 9,
     "maxSize": 9,
     "characterType": "^\\d+$",
     "displayField": "Carnet de Extranjería",
     "fieldType": "number"
    },
    {
     "nameDisplay": "Pasaporte",
     "value": "PASS",
     "minSize": 1,
     "maxSize": 50,
     "characterType": "^\\w+$",
     "displayField": null,
     "fieldType": null
    },
    {
     "nameDisplay": "RUC",
     "value": "RUC",
     "minSize": 11,
     "maxSize": 11,
     "characterType": "^\\d+$",
     "displayField": null,
     "fieldType": null
    }
   ]
  },
  "PY": {
   "individual": [
    {
     "nameDisplay": "Cédula de Identidad",
     "value": "CI",
     "minSize": 7,
     "maxSize": 7,
     "characterType": "^\\d+$",
     "displayField": null,
     "fieldType": null
    },
    {
     "nameDisplay": "Registro Único del Contribuyente",
     "value": "RUC",
     "minSize": 7,
     "maxSize": 9,
     "characterType": "^\\d+$",
     "displayField": null,
     "fieldType": null
    },
    {
     "nameDisplay": "Cédula de Identidad Civil",
     "value": "CIC",
     "minSize": 1,
     "maxSize": 50,
     "characterType": "",
     "displayField": null,
     "fieldType": null
    }
   ]
  },
  "US": {
   "individual": [
    {
     "nameDisplay": "PASAPORTE",
     "value": "PASS",
     "minSize": 1,
     "maxSize": 50,
     "characterType": null,
     "displayField": "PASS",
     "fieldType": "alphanumeric"
    },
    {
     "nameDisplay": "Licencia de Conducir",
     "value": "DRIVERS",
     "minSize": 1,
     "maxSize": 50,
     "characterType": null,
     "displayField": "Licencia de Conducir",
     "fieldType": "alphanumeric"
    }
   ]
  },
  "VE": {
   "individual": [
    {
     "nameDisplay": "Cédula de Identidad",
     "value": "national_id",
     "minSize": 6,
     "maxSize": 10,
     "characterType": "^\\d+$",
     "displayField": null,
     "fieldType": null
    }
   ]
  }
 }
};
