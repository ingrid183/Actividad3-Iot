// Configuración del dashboard: es lo único que cambia entre instalaciones.
window.RUTA_CONFIG = {
  // URL de invocación de API Gateway, sin "/" final. Ejemplo:
  // "https://abc123.execute-api.us-east-1.amazonaws.com/prod"
  API_URL: "https://btv6k23frl.execute-api.us-east-1.amazonaws.com/Pruebas",
  // Ruta GET que devuelve las lecturas guardadas en DynamoDB.
  READINGS_PATH: "/valuesensor",
  // Ruta POST que publica {"message": "ON" | "OFF"} en data/actuators.
  ACTUATOR_PATH: "/actuator",
  DEVICE_ID: "esp32_01",
  // Solo si API Gateway exige una API key (cabecera x-api-key).
  API_KEY: "",
  REFRESH_SECONDS: 10
};
